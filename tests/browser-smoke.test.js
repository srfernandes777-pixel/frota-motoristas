"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const edge = process.env.EDGE_PATH || (process.platform === "win32" && path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"));

async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result; } catch (e) { /* retry until timeout */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Tempo esgotado aguardando navegador.");
}

test("navegação, câmera, reinício e troca de usuário no navegador", { skip: !edge || !fs.existsSync(edge), timeout: 60000 }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "frota-browser-test-"));
  const hoje = new Date(), data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const respostas = {
    app_nomes: ["Ana", "Bia"],
    app_listas: { veiculos: [{ placa: "ABC", tipo: "Caminhão" }], combustiveis: ["Diesel"], postos: [], clientes: [] },
    app_locais: [], app_manutencoes: [], app_historico_manutencao: [],
    app_meus: [{ _tipo: "abast", status: "aprovado", data_abast: data, placa: "ABC", posto: "Posto", valor_total: 100, valor_litro: 5, litros: 20, km_rodados: 200 }]
  };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/rest/v1/rpc/")) {
      let body = ""; req.on("data", c => { body += c; }); req.on("end", () => {
        const nome = req.url.split("/").pop();
        const data = nome === "app_login" ? { ok: true, token: "token-" + JSON.parse(body).p_nome, nome: JSON.parse(body).p_nome } : respostas[nome];
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(data || []));
      }); return;
    }
    if (req.url === "/config.js") { res.writeHead(200, { "content-type": "application/javascript" }); res.end('window.CONFIG={SUPABASE_URL:location.origin,SUPABASE_KEY:"test-key"}'); return; }
    const nome = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0];
    if (!["index.html", "app.js", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"].includes(nome)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": nome.endsWith(".js") ? "application/javascript" : nome.endsWith(".html") ? "text/html" : "application/octet-stream" });
    fs.createReadStream(path.join(process.cwd(), nome)).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = spawn(edge, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, `http://127.0.0.1:${server.address().port}/`], { stdio: "ignore" });
  let ws;
  try {
    const port = await waitFor(() => {
      const file = path.join(profile, "DevToolsActivePort");
      return fs.existsSync(file) && Number(fs.readFileSync(file, "utf8").split("\n")[0]);
    });
    const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === "page" && x.webSocketDebuggerUrl));
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = event => {
      const m = JSON.parse(event.data), p = pending.get(m.id);
      if (p) { pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
    };
    const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async expression => {
      const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const ready = selector => waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`));
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const value = (selector, v) => evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); })()`);
    await call("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
    await ready("#lg_nome"); await waitFor(() => evaluate('Array.from(document.querySelector("#lg_nome").options).some(x=>x.value==="Ana")'));
    await value("#lg_nome", "Ana"); await value("#lg_pin", "1234"); await click('[data-act="entrar"]');
    await ready("#veiculo"); await value("#veiculo", "ABC"); await click('[data-act="selecionar-veiculo"]');
    await ready('[data-t="manutencao"]'); await click('[data-t="manutencao"]');
    await ready("#ma_desc"); await value("#ma_desc", "Vazamento no freio"); await value("#ma_odo", "123");
    const layout = await evaluate(`(() => {
      const faixa=document.querySelector(".topo-acoes").getBoundingClientRect();
      const inicio=document.querySelector('.topo-acoes [data-t="home"]').getBoundingClientRect();
      const relatos=document.querySelector('.topo-acoes [data-t="manutencoes"]').getBoundingClientRect();
      return { esquerda: inicio.left-faixa.left, direita: faixa.right-relatos.right, separacao: relatos.left-inicio.right, alinhamento: Math.abs(inicio.top-relatos.top), largura: faixa.width };
    })()`);
    assert.ok(layout.largura >= 300);
    assert.ok(Math.abs(layout.esquerda) < 1 && Math.abs(layout.direita) < 1, JSON.stringify(layout));
    assert.ok(layout.separacao > 50 && layout.alinhamento < 1, JSON.stringify(layout));
    assert.equal(await evaluate('document.querySelector("#ma_cam").getAttribute("capture")'), "environment");
    await evaluate(`(() => { const el=document.querySelector("#ma_cam"), dt=new DataTransfer(); dt.items.add(new File(["foto"],"foto.jpg",{type:"image/jpeg"})); el.files=dt.files; el.dispatchEvent(new Event("change",{bubbles:true})); })()`);
    await waitFor(() => evaluate('window.__frota.S.anexos.length === 1'));
    await evaluate("window.__frota.sincronizar(true)");
    assert.equal(await evaluate('document.querySelector("#ma_desc").value'), "Vazamento no freio");
    assert.equal(await evaluate("window.__frota.S.anexos.length"), 1);
    await click('[data-t="manutencoes"]'); await ready('[data-t="home"]'); await click('[data-t="home"]');
    await ready('[data-t="manutencao"]'); await click('[data-t="manutencao"]'); await ready("#ma_desc");
    assert.equal(await evaluate('document.querySelector("#ma_desc").value'), "Vazamento no freio");
    assert.equal(await evaluate("window.__frota.S.anexos.length"), 1);
    await waitFor(() => evaluate(`new Promise(resolve=>{const r=indexedDB.open("frota",1);r.onsuccess=()=>{const q=r.result.transaction("cache").objectStore("cache").get("contexto:Ana");q.onsuccess=()=>resolve(!!(q.result && q.result.v.tela==="manutencao" && q.result.v.rascunhos["manutencao:ABC"] && q.result.v.rascunhos["manutencao:ABC"].anexos.length));};})`));
    await call("Page.reload");
    await ready("#ma_desc");
    assert.equal(await evaluate("window.__frota.S.veiculo"), "ABC");
    assert.equal(await evaluate('document.querySelector("#ma_desc").value'), "Vazamento no freio");
    assert.equal(await evaluate("window.__frota.S.anexos.length"), 1);
    await click('[data-act="trocar"]'); await ready("#lg_nome");
    assert.equal(await evaluate('localStorage.getItem("frota_sessao")'), null);
    await call("Page.reload"); await ready("#lg_nome");
    await waitFor(() => evaluate('Array.from(document.querySelector("#lg_nome").options).some(x=>x.value==="Bia")'));
    await value("#lg_nome", "Bia"); await value("#lg_pin", "1234"); await click('[data-act="entrar"]');
    await ready("#veiculo"); assert.equal(await evaluate("window.__frota.S.veiculo"), "");
    assert.equal(await evaluate("Object.keys(window.__frota.S.rascunhos).length"), 0);
    await click('[data-act="trocar"]'); await ready("#lg_nome");
    await value("#lg_nome", "Ana"); await value("#lg_pin", "1234"); await click('[data-act="entrar"]');
    await ready("#ma_desc");
    assert.equal(await evaluate('document.querySelector("#ma_desc").value'), "Vazamento no freio");
    assert.equal(await evaluate("window.__frota.S.anexos.length"), 1);
    await click('[data-t="home"]'); await ready('[data-t="dre"]'); await click('[data-t="dre"]');
    await waitFor(() => evaluate('document.querySelector("#app").textContent.includes("200 km")'));
    assert.match(await evaluate('document.querySelector("#app").textContent'), /R\$ 100,00/);
    assert.match(await evaluate('document.querySelector("#app").textContent'), /10,00/);
    await call("Browser.close").catch(() => {});
  } finally {
    if (ws) ws.close();
    if (browser.exitCode === null) browser.kill();
    await new Promise(resolve => server.close(resolve));
    await waitFor(() => browser.exitCode !== null || browser.signalCode !== null, 5000).catch(() => {});
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { console.error("Não foi possível remover perfil temporário:", profile); }
  }
});
