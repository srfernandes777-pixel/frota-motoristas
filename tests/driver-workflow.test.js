"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function app() {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", value: "", checked: false, dataset: {}, querySelectorAll: () => [], setAttribute() {}, addEventListener() {} });
    return elements.get(selector);
  }
  const listeners = {};
  const storage = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
  const context = {
    console, Blob, Uint8Array, Date, Math, JSON, Number, String, Object, Array, Promise, Error, AbortController,
    setTimeout, clearTimeout, setInterval() {}, localStorage: storage(), sessionStorage: storage(),
    navigator: { onLine: true }, location: { protocol: "file:" },
    document: { querySelector: element, querySelectorAll: () => [], addEventListener: (name, fn) => { listeners[name] = fn; }, documentElement: { dataset: {} }, head: { appendChild() {} }, createElement: () => ({}) },
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(b => { this.result = "data:application/octet-stream;base64," + Buffer.from(b).toString("base64"); this.onload(); }); } },
    fetch: async () => { throw new Error("offline"); }
  };
  context.window = { CONFIG: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_KEY: "test-key" }, crypto: context.crypto, addEventListener() {} };
  let source = fs.readFileSync("app.js", "utf8");
  source = source.replace("window.__frota = { S, acoes, sincronizar, idb, iniciar };", "window.__frota = { S, acoes, sincronizar, idb, iniciar, render, atualizarListas, carregarManutencoes };");
  source = source.replace("  iniciar();", "");
  vm.runInNewContext(source, context);
  const api = context.window.__frota, stores = { fila: new Map(), cache: new Map() };
  api.idb.put = async (s, v) => { stores[s].set(v.id_cliente || v.k, structuredClone(v)); };
  api.idb.get = async (s, k) => structuredClone(stores[s].get(k));
  api.idb.all = async s => Array.from(stores[s].values(), v => structuredClone(v));
  api.idb.del = async (s, k) => stores[s].delete(k);
  api.S.sessao = { nome: "Ana", token: "token" };
  return { api, context, element, stores, listeners };
}

test("caminhão é escolhido explicitamente entre os veículos cadastrados", () => {
  const { api, element } = app();
  api.S.tela = "veiculos"; api.S.listas = { veiculos: [{ placa: "ABC1234", tipo: "Caminhão" }] };
  api.render();
  assert.match(element("#app").innerHTML, /Escolha seu caminhão/);
  element("#veiculo").value = "INVÁLIDA"; api.acoes["selecionar-veiculo"]();
  assert.equal(api.S.tela, "veiculos");
  element("#veiculo").value = "ABC1234"; api.acoes["selecionar-veiculo"]();
  assert.equal(api.S.veiculo, "ABC1234");
  assert.equal(api.S.tela, "home");
  api.acoes["trocar-veiculo"]();
  assert.equal(api.S.veiculo, "");
  assert.equal(api.S.tela, "veiculos");
});

test("login consulta veículos, não turnos, e exige escolha manual", async () => {
  const { api, context, element } = app(), chamadas = [];
  context.fetch = async url => {
    const nome = url.split("/").pop(); chamadas.push(nome);
    const respostas = { app_login: { ok: true, token: "token", nome: "Ana" }, app_listas: { veiculos: [{ placa: "ABC", tipo: "Caminhão" }] }, app_locais: [] };
    return { ok: true, json: async () => respostas[nome] };
  };
  api.S.sessao = null; api.S.tela = "login";
  element("#lg_nome").value = "Ana"; element("#lg_pin").value = "1234";
  await api.acoes.entrar();
  assert.equal(api.S.tela, "veiculos"); assert.equal(api.S.veiculo, "");
  assert.deepEqual(chamadas, ["app_login", "app_listas", "app_locais"]);
});

test("lista offline usa cache com aviso e preserva seleção manual", async () => {
  const { api, context, element } = app();
  await api.idb.put("cache", { k: "listas", v: { veiculos: [{ placa: "ABC" }] } });
  context.fetch = async () => { throw new Error("offline"); };
  api.S.tela = "veiculos";
  await api.atualizarListas(); api.render();
  assert.match(element("#app").innerHTML, /lista salva, que pode estar desatualizada/);
  element("#veiculo").value = "ABC"; api.acoes["selecionar-veiculo"]();
  assert.equal(api.S.veiculo, "ABC");
});

test("fallback mostra apenas o último abastecimento do veículo fora do período", () => {
  const { api, element } = app();
  api.S.tela = "frota"; api.S.abastVeiculo = "ABC"; api.S.abastDias = 7;
  api.S.listas = { veiculos: [{ placa: "ABC" }] };
  api.S.ultimosAbast = [
    { placa: "ABC", data_abast: "2020-01-02", motorista: "Ana", combustivel: "Diesel", litros: 30, odometro: 5, valor_total: 100 },
    { placa: "XYZ", data_abast: "2020-02-02", motorista: "Outro", combustivel: "Diesel", litros: 30, odometro: 5, valor_total: 100 }
  ];
  api.render();
  assert.match(element("#app").innerHTML, /fora do período selecionado/);
  assert.match(element("#app").innerHTML, /02\/01\/2020/);
  assert.doesNotMatch(element("#app").innerHTML, /Outro/);
});

test("períodos de 7 e 30 dias preservam resultados e identificam corretamente o fallback", () => {
  const { api, element } = app();
  const data = dias => {
    const d = new Date(); d.setDate(d.getDate() - dias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const registro = (dias, motorista, criado) => ({ placa: "ABC", data_abast: data(dias), criado_em: criado, motorista, combustivel: "Diesel", litros: 30, odometro: 5, valor_total: 100 });
  api.S.tela = "frota"; api.S.abastVeiculo = "ABC"; api.S.abastDias = 7;
  api.S.listas = { veiculos: [{ placa: "ABC" }] };
  api.S.ultimosAbast = [registro(20, "Anterior", "2020-01-01T10:00:00"), registro(20, "Mais recente", "2020-01-01T12:00:00")];
  api.render();
  assert.match(element("#app").innerHTML, /fora do período selecionado/);
  assert.match(element("#app").innerHTML, /Mais recente/);
  assert.doesNotMatch(element("#app").innerHTML, /Anterior/);
  api.S.abastDias = 30; api.render();
  assert.doesNotMatch(element("#app").innerHTML, /fora do período selecionado/);
  assert.match(element("#app").innerHTML, /Mais recente/);
  assert.match(element("#app").innerHTML, /Anterior/);
  api.S.ultimosAbast = [registro(31, "Antigo", "2020-01-01T12:00:00")];
  api.render();
  assert.match(element("#app").innerHTML, /fora do período selecionado/);
  assert.match(element("#app").innerHTML, /Antigo/);
  api.S.ultimosAbast = []; api.render();
  assert.match(element("#app").innerHTML, /Nenhum abastecimento nos últimos 30 dias/);
  assert.doesNotMatch(element("#app").innerHTML, /fora do período selecionado/);
});

test("envio retoma evidência em blocos sem reenviar relato nem descartar fila", async () => {
  const { api, context, stores } = app(), chamadas = [];
  let falhar = true;
  context.fetch = async (url, opts) => {
    const nome = url.split("/").pop(), args = JSON.parse(opts.body);
    chamadas.push({ nome, args });
    if (nome === "app_enviar_manutencao") return { ok: true, json: async () => ({ ok: true, id: 9 }) };
    if (falhar && args.p_indice === 1) throw new Error("sem rede");
    return { ok: true, json: async () => ({ ok: true, completo: args.p_indice === args.p_total - 1 }) };
  };
  const it = { id_cliente: "report", tipo: "manutencao", motorista: "Ana", registrado_em: "2026-11-13", reg: { turno_id: 12 }, anexos: [{ id: "file", tipo: "video", mime: "video/mp4", blob: new Blob([new Uint8Array(256 * 1024 + 1)]), proximo: 0 }] };
  await api.idb.put("fila", it); await api.sincronizar();
  assert.equal(stores.fila.get("report").servidor_id, 9);
  assert.equal(stores.fila.get("report").anexos[0].proximo, 1);
  falhar = false; await api.sincronizar();
  assert.equal(stores.fila.size, 0);
  assert.equal(chamadas.filter(x => x.nome === "app_enviar_manutencao").length, 1);
  const partes = chamadas.filter(x => x.nome === "app_anexar_manutencao");
  assert.deepEqual(partes.map(x => x.args.p_indice), [0, 1, 1]);
  assert.equal(Buffer.from(partes[0].args.p_dados, "base64").length, 256 * 1024);
  assert.equal(partes[0].args.p_total, 2);
});

test("fila antiga com turno e relato novo por placa são enviados sem alteração", async () => {
  const { api, context } = app(), enviados = [];
  context.fetch = async (url, opts) => {
    assert.equal(url.split("/").pop(), "app_enviar_manutencao");
    enviados.push(JSON.parse(opts.body).p_reg);
    return { ok: true, json: async () => ({ ok: true, id: enviados.length }) };
  };
  for (const [id, reg] of [["antigo", { turno_id: 12, descricao: "antigo" }], ["novo", { placa: "ABC", data: "2026-11-13", descricao: "novo" }]]) {
    await api.idb.put("fila", { id_cliente: id, tipo: "manutencao", motorista: "Ana", registrado_em: id === "antigo" ? "2026-11-12" : "2026-11-13", reg, anexos: [] });
  }
  await api.sincronizar();
  assert.equal(enviados[0].turno_id, 12); assert.equal(enviados[0].placa, undefined);
  assert.equal(enviados[1].placa, "ABC"); assert.equal(enviados[1].turno_id, undefined);
  assert.equal(enviados[1].data, "2026-11-13");
  assert.equal((await api.idb.all("fila")).length, 0);
});

test("placa removida é sinalizada e relato permanece na fila", async () => {
  const { api, context } = app();
  context.fetch = async () => ({ ok: false, json: async () => ({ message: "veiculo_nao_cadastrado" }) });
  await api.idb.put("fila", { id_cliente: "novo", tipo: "manutencao", motorista: "Ana", registrado_em: "2026-11-13", reg: { placa: "ABC" }, anexos: [] });
  await api.sincronizar();
  const item = await api.idb.get("fila", "novo");
  assert.match(item.erro, /veículo não está mais cadastrado/);
  assert.equal(item.reg.placa, "ABC");
});

test("relatos mostram visualização e histórico limitado ao caminhão selecionado", async () => {
  const { api, context, element } = app();
  api.S.veiculo = "ABC"; api.S.tela = "manutencoes";
  context.fetch = async (url, opts) => {
    const nome = url.split("/").pop(), args = JSON.parse(opts.body);
    if (nome === "app_historico_manutencao") {
      assert.equal(args.p_placa, "ABC");
      return { ok: true, json: async () => Array.from({ length: 6 }, (_, i) => ({ categoria: "pneus_rodas", descricao: "Serviço " + i, concluido_em: "2026-11-10" })) };
    }
    return { ok: true, json: async () => [{ placa: "ABC", categoria: "freios_suspensao", criticidade: "critico", descricao: "Freio", status: "visualizado", visualizado_em: "2026-11-13" }] };
  };
  await api.carregarManutencoes();
  assert.match(element("#app").innerHTML, /Visto pelo responsável/);
  assert.match(element("#app").innerHTML, /🔴 Crítico/);
  assert.match(element("#app").innerHTML, /10\/11\/2026/);
  assert.doesNotMatch(element("#app").innerHTML, /Serviço 5/);
});

test("relato offline mantém dados e evidências na fila", async () => {
  const { api, context, element, stores } = app();
  context.navigator.onLine = false;
  api.S.tela = "manutencao"; api.S.tipo = "manutencao"; api.S.veiculo = "ABC";
  element("#ma_odo").value = "120.300"; element("#ma_hora").value = "42,5";
  element("#ma_cat").value = "freios_suspensao"; element('input[name="criticidade"]:checked').value = "critico";
  element("#ma_desc").value = "Freio com defeito";
  api.S.anexos = [{ id: "foto", tipo: "foto", mime: "image/jpeg", blob: new Blob(["imagem"]), proximo: 0 }];
  api.acoes["validar-manutencao"]();
  assert.equal(api.S.fase, "confirmar");
  element("#cf_ok").checked = true;
  await api.acoes["salvar-manutencao"]();
  const item = Array.from(stores.fila.values())[0];
  assert.equal(item.reg.placa, "ABC"); assert.equal(item.reg.turno_id, undefined);
  assert.match(item.reg.data, /^\d{4}-\d{2}-\d{2}$/); assert.equal(item.reg.odometro, 120300);
  assert.equal(item.reg.horimetro, 42.5); assert.equal(item.reg.criticidade, "critico");
  assert.equal(item.anexos[0].blob.size, 6);
  assert.match(element("#app").innerHTML, /AINDA NÃO ENVIADO/);
});

test("tema segue sistema e escolha manual persiste", async () => {
  const { api, context, element } = app(), dados = new Map(), eventos = {};
  context.localStorage = { getItem: k => dados.get(k) || null, setItem: (k, v) => dados.set(k, v), removeItem: k => dados.delete(k) };
  context.window.matchMedia = () => ({ matches: true, addEventListener() {} });
  element("#tema").addEventListener = (name, fn) => { eventos[name] = fn; };
  context.fetch = async () => ({ ok: true, json: async () => [] });
  await api.iniciar();
  assert.equal(context.document.documentElement.dataset.tema, "escuro");
  eventos.click();
  assert.equal(dados.get("frota_tema"), "claro");
  assert.equal(context.document.documentElement.dataset.tema, "claro");
  assert.equal(element("#tema").textContent, "🌙 Tema escuro");
});

test("vídeo respeita duração, tamanho e tipo antes de entrar na fila", async () => {
  const { api, context, listeners } = app();
  let duracao = 15;
  context.URL = { createObjectURL: () => "blob:test", revokeObjectURL() {} };
  context.document.createElement = () => ({
    duration: duracao, removeAttribute() {}, load() {},
    set src(value) { queueMicrotask(() => this.onloadedmetadata()); }
  });
  api.S.tela = "manutencao"; api.S.fase = "form";
  const arquivo = (size, type) => { const f = new Blob([new Uint8Array(size)], { type }); f.name = "evidencia"; return f; };
  const selecionar = async f => listeners.change({ target: { id: "ma_video", type: "file", files: [f], value: "x" } });
  await selecionar(arquivo(20 * 1024 * 1024, "video/mp4"));
  assert.equal(api.S.anexos.length, 1);
  api.S.anexos = []; duracao = 15.01;
  await selecionar(arquivo(100, "video/mp4"));
  assert.equal(api.S.anexos.length, 0);
  duracao = 15;
  await selecionar(arquivo(20 * 1024 * 1024 + 1, "video/mp4"));
  assert.equal(api.S.anexos.length, 0);
  await selecionar(arquivo(100, "video/avi"));
  assert.equal(api.S.anexos.length, 0);
});
