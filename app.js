"use strict";
(function () {
  const CFG = window.CONFIG || {};
  const TARAS = { 20: 1.8, 60: 3.5, 200: 8.5 };
  const MAX_SALTO = 3000, DIAS_ATRAS = 7, OUTRO = "__outro__";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ============================ formatação e máscaras ============================
  const num = (v, d) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  const fmtInt = v => Math.round(Number(v)).toLocaleString("pt-BR");
  const fmtDec = v => String(Math.round(Number(v) * 100) / 100).replace(".", ",");
  const round2 = v => Math.round(v * 100) / 100;
  function parseNum(txt) {
    let t = String(txt || "").replace(/[^\d,.]/g, "");
    if (!t) return null;
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    else if ((t.match(/\./g) || []).length === 1 && t.split(".")[1].length <= 2) { /* ponto decimal */ }
    else t = t.replace(/\./g, "");
    const v = parseFloat(t);
    return isNaN(v) ? null : v;
  }
  const parseIntBR = txt => { const d = String(txt || "").replace(/\D/g, ""); return d ? parseInt(d, 10) : null; };
  const milhar = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  function mask(kind, v) {
    if (kind === "money") { let d = v.replace(/\D/g, "").replace(/^0+/, ""); if (!d) return ""; d = d.padStart(3, "0"); return milhar(d.slice(0, -2)) + "," + d.slice(-2); }
    if (kind === "int") return milhar(v.replace(/\D/g, "").replace(/^0+(?=\d)/, ""));
    if (kind === "dec") { let t = v.replace(/[^\d,]/g, ""); const i = t.indexOf(","); if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/,/g, "").slice(0, 2); return t; }
    if (kind === "pin") return v.replace(/\D/g, "").slice(0, 6);
    return v;
  }
  function aplicarMascaras(root) {
    root.querySelectorAll("[data-mask]").forEach(el => {
      const k = el.dataset.mask;
      el.setAttribute("inputmode", k === "dec" ? "decimal" : "numeric");
      el.addEventListener("input", () => { const nv = mask(k, el.value); if (nv !== el.value) el.value = nv; });
    });
  }
  const isoData = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hoje = () => isoData(new Date());
  const diasAtras = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoData(d); };
  const brData = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });

  // ============================ armazenamento no celular (IndexedDB) ============================
  const idb = (() => {
    let dbp;
    const abrir = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("frota", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("fila", { keyPath: "id_cliente" }); r.result.createObjectStore("cache", { keyPath: "k" }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (store, modo, fn) => {
      const d = await abrir();
      return new Promise((res, rej) => {
        const t = d.transaction(store, modo); const rq = fn(t.objectStore(store));
        t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    };
    return {
      get: (s, k) => tx(s, "readonly", o => o.get(k)), put: (s, v) => tx(s, "readwrite", o => o.put(v)),
      del: (s, k) => tx(s, "readwrite", o => o.delete(k)), all: s => tx(s, "readonly", o => o.getAll())
    };
  })();

  // ============================ comunicação com o servidor ============================
  class ApiErro extends Error { constructor(msg, rede) { super(msg); this.rede = !!rede; } }
  async function rpc(fn, args) {
    const h = { "Content-Type": "application/json", apikey: CFG.SUPABASE_KEY };
    if ((CFG.SUPABASE_KEY || "").startsWith("eyJ")) h.Authorization = "Bearer " + CFG.SUPABASE_KEY;
    let r; const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 25000);
    try {
      r = await fetch(`${String(CFG.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args || {}), signal: ac.signal });
    } catch (e) { throw new ApiErro("Sem conexão", true); } finally { clearTimeout(to); }
    let corpo = null; try { corpo = await r.json(); } catch (e) { /* sem corpo */ }
    if (!r.ok) throw new ApiErro((corpo && corpo.message) || ("Erro " + r.status), false);
    return corpo;
  }
  const MSG = { sessao_invalida: "Sua sessão expirou. Entre de novo.", dados_invalidos: "O servidor não aceitou os dados. Confira os valores.",
    foto_grande: "A foto é grande demais.", nao_alteravel: "Este registro já foi aprovado ou cancelado e não pode mais ser alterado." };
  const msgErro = e => e.rede ? "Sem sinal no momento." : (MSG[e.message] || e.message);

  const configPendente = () => { const u = String(CFG.SUPABASE_URL || ""), k = String(CFG.SUPABASE_KEY || ""); return !/^https?:\/\//i.test(u) || /x{5,}/i.test(u) || !k || /x{8,}/i.test(k); };
  function diagnostico(e) {
    const m = String(e && e.message || "");
    if (e && e.rede) return "Não consegui falar com o servidor. Confira a URL no config.js e a internet.";
    if (/PGRST202|find the function|schema cache/i.test(m)) return "O banco ainda não tem as funções do app offline. Rode o arquivo schema_v3_offline.sql no Supabase e aguarde 1 minuto.";
    if (/api key|apikey|jwt|401|403|permission/i.test(m)) return "A chave do config.js foi recusada. Use a chave PUBLICÁVEL (sb_publishable_...) do seu projeto.";
    return "Erro do servidor: " + m;
  }

  // ============================ estado ============================
  const S = { tela: "login", sessao: null, listas: null, nomes: [], tipo: null, fase: "form", rasc: null, foto: null, edit: null, filaN: 0, meus: null, meusErro: "", sync: false, okMsg: "", aviso: "", erroNomes: "" };
  const app = () => $("#app");
  const online = () => navigator.onLine !== false;

  function lerSessao() { try { return JSON.parse(localStorage.getItem("frota_sessao") || sessionStorage.getItem("frota_sessao") || "null"); } catch (e) { return null; } }
  function gravarSessao(s, manter) {
    localStorage.removeItem("frota_sessao"); sessionStorage.removeItem("frota_sessao");
    (manter ? localStorage : sessionStorage).setItem("frota_sessao", JSON.stringify(s));
  }
  function limparSessao() { localStorage.removeItem("frota_sessao"); sessionStorage.removeItem("frota_sessao"); }
  const token = () => S.sessao && S.sessao.token;

  async function contarFila() {
    const todos = await idb.all("fila");
    S.filaN = S.sessao ? todos.filter(i => i.motorista === S.sessao.nome).length : 0;
    return todos;
  }
  async function carregarNomes() {
    S.erroNomes = "";
    if (configPendente()) { S.erroNomes = "O arquivo config.js ainda não foi preenchido com a URL e a chave do seu Supabase."; return; }
    if (!online()) { if (!S.nomes.length) S.erroNomes = "Sem sinal. Na primeira vez é preciso abrir o app com internet."; return; }
    try {
      const n = await rpc("app_nomes"); S.nomes = n || []; await idb.put("cache", { k: "nomes", v: S.nomes });
      if (!S.nomes.length) S.erroNomes = "Nenhum motorista ativo foi encontrado. Cadastre os motoristas no sistema (aba Celular → Motoristas e PINs).";
    } catch (e) { if (!S.nomes.length) S.erroNomes = diagnostico(e); }
  }
  async function atualizarListas() {
    try {
      const l = await rpc("app_listas", { p_token: token() });
      S.listas = l; await idb.put("cache", { k: "listas", v: l });
    } catch (e) {
      if (!e.rede && e.message === "sessao_invalida") { sessaoExpirada(); return false; }
      const c = await idb.get("cache", "listas"); if (c) S.listas = c.v;
    }
    return true;
  }
  function sessaoExpirada() {
    limparSessao(); S.sessao = null; S.tela = "login"; S.aviso = "Sua sessão expirou. Entre de novo para continuar. Seus registros salvos no celular continuam guardados.";
    render();
  }
  function ultimoOdo(placa, excluirId) {
    const v = ((S.listas && S.listas.veiculos) || []).find(x => x.placa === placa);
    let base = v ? Number(v.ultimo_odometro || 0) : 0;
    (S._fila || []).forEach(i => { if (i.tipo === "abast" && i.reg.placa === placa && i.id_cliente !== excluirId) base = Math.max(base, Number(i.reg.odometro)); });
    return base;
  }
  const tipoVeiculo = placa => { const v = ((S.listas && S.listas.veiculos) || []).find(x => x.placa === placa); return (v && v.tipo) || ""; };

  // ============================ envio da fila ============================
  async function bumpUltimo(placa, odo) {  // depois de enviar, o último odômetro guardado no celular acompanha
    const v = S.listas && S.listas.veiculos.find(x => x.placa === placa);
    if (v && Number(odo) > Number(v.ultimo_odometro || 0)) { v.ultimo_odometro = Number(odo); await idb.put("cache", { k: "listas", v: S.listas }); }
  }
  async function sincronizar() {
    if (S.sync || !S.sessao || !online()) return;
    S.sync = true;
    try {
      const todos = await idb.all("fila");
      const meus = todos.filter(i => i.motorista === S.sessao.nome).sort((a, b) => a.registrado_em < b.registrado_em ? -1 : 1);
      for (const it of meus) {
        try {
          await rpc("app_enviar", { p_token: token(), p_tabela: it.tipo, p_reg: Object.assign({}, it.reg, { id_cliente: it.id_cliente, registrado_em: it.registrado_em }), p_foto: it.foto || null });
          await idb.del("fila", it.id_cliente);
          if (it.tipo === "abast") await bumpUltimo(it.reg.placa, it.reg.odometro);
        } catch (e) {
          if (e.rede) break;
          if (e.message === "sessao_invalida") { sessaoExpirada(); break; }
          it.erro = msgErro(e); await idb.put("fila", it);
        }
      }
    } finally {
      S.sync = false; S._fila = await contarFila();
      if (["home", "meus"].includes(S.tela)) { if (S.tela === "meus") await carregarMeus(); render(); }
    }
  }

  // ============================ foto ============================
  const lerBase64 = blob => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(",")[1]); f.onerror = () => rej(f.error); f.readAsDataURL(blob); });
  async function processarFoto(file) {
    try {  // reduz para no máx. 1600 px e comprime (economiza dados móveis e espaço)
      if (typeof createImageBitmap !== "function" || !document.createElement("canvas").getContext) throw new Error("sem canvas");
      const bmp = await createImageBitmap(file);
      const esc1 = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * esc1); c.height = Math.round(bmp.height * esc1);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.8));
      if (!blob) throw new Error("falhou");
      return await lerBase64(blob);
    } catch (e) {
      if (file.size > 1800000) throw new Error("A foto é grande demais para este aparelho. Tente outra.");
      return await lerBase64(file);
    }
  }

  // ============================ telas ============================
  const opts = (lista, atual, vazio) => (vazio ? `<option value="">${vazio}</option>` : "") + lista.map(x => `<option value="${esc(x)}" ${x === atual ? "selected" : ""}>${esc(x)}</option>`).join("");
  const optsPlaca = atual => '<option value="">— selecione —</option>' + ((S.listas && S.listas.veiculos) || []).map(v => `<option value="${esc(v.placa)}" ${v.placa === atual ? "selected" : ""}>${esc(v.placa)} — ${esc(v.tipo || "")}</option>`).join("");
  function seletorOutro(id, rotulo, lista, atual, txtRotulo) {
    const outro = atual && !lista.includes(atual);
    return `<label>${rotulo}</label><select id="${id}" data-act="outro" data-alvo="${id}_txt"><option value="">— selecione —</option>${lista.map(x => `<option value="${esc(x)}" ${x === atual ? "selected" : ""}>${esc(x)}</option>`).join("")}<option value="${OUTRO}" ${outro ? "selected" : ""}>➕ Outro (digitar)</option></select>
      <input id="${id}_txt" placeholder="${txtRotulo}" value="${outro ? esc(atual) : ""}" style="margin-top:.5rem;${outro ? "" : "display:none"}">`;
  }
  function barra() {
    const chip = online() ? '<span class="chip ok">● online</span>' : '<span class="chip off">● sem sinal</span>';
    const n = S.filaN;
    return `<div class="barra"><div>👤 <b>${esc(S.sessao.nome)}</b>${chip}</div><button data-act="trocar">Trocar</button></div>` +
      (n ? `<div class="aviso">📥 ${n} registro(s) aguardando envio.${online() ? ' <button data-act="sincronizar">Enviar agora</button>' : " Serão enviados quando houver sinal."}</div>` : "");
  }
  function vLogin() {
    return `<h1>🚛 Registros da Frota</h1>${S.aviso ? `<div class="aviso">${esc(S.aviso)}</div>` : ""}
      <label>Quem é você?</label><select id="lg_nome">${opts(S.nomes, "", "— selecione —")}</select>
      <label>PIN (4 a 6 números)</label><input id="lg_pin" type="password" data-mask="pin" maxlength="6" autocomplete="off">
      <label class="chk"><input type="checkbox" id="lg_manter" checked> Manter conectado neste celular</label>
      <p class="peq">Desmarque se este celular for de outra pessoa ou se for emprestado.</p>
      <div id="msg"></div><button class="pri" data-act="entrar">Entrar</button>
      ${S.erroNomes ? `<div class="erro">${esc(S.erroNomes)}<br><br><button data-act="recarregar-nomes">🔄 Tentar de novo</button></div>` : ""}
      ${online() ? "" : '<div class="aviso">Sem sinal. Na primeira vez é preciso entrar com internet; depois o app funciona sem sinal.</div>'}
      <p class="peq">Servidor: ${esc((() => { try { return new URL(CFG.SUPABASE_URL).host; } catch (e) { return "não configurado"; } })())}</p>`;
  }
  function vHome() {
    return `${barra()}<h1>Olá, ${esc(S.sessao.nome.split(" ")[0])}! 👋</h1><p class="peq">O que você quer registrar?</p>
      <div class="grade3"><button class="pri" data-act="ir" data-t="abast">⛽<br>Abastecimento</button><button class="pri" data-act="ir" data-t="coleta">📦<br>Coleta</button><button class="pri" data-act="ir" data-t="meus">📋<br>Meus registros</button></div>`;
  }
  function blocoFoto(pref, obrigatoria) {
    const tem = S.foto || (S.edit && S.edit.fotoExistente);
    return `<label>📷 Foto ${obrigatoria ? "do comprovante (obrigatória)" : "(opcional)"}</label>
      <div class="linha"><button data-act="foto" data-alvo="${pref}_cam">📷 Tirar foto</button><button data-act="foto" data-alvo="${pref}_gal">🖼️ Galeria</button></div>
      <input type="file" accept="image/*" capture="environment" id="${pref}_cam" hidden><input type="file" accept="image/*" id="${pref}_gal" hidden>
      <div id="${pref}_prev">${S.foto ? `<img class="prev" src="data:image/jpeg;base64,${S.foto}">` : (tem ? '<p class="peq">✔ A foto enviada antes será mantida (escolha outra para trocar).</p>' : "")}</div>`;
  }
  const topo = titulo => `${barra()}<button data-act="ir" data-t="home" style="width:auto;min-height:2.6rem">← Início</button><h2>${titulo}</h2>` +
    (S.edit ? '<div class="info">✏️ Você está corrigindo um registro. Ao salvar, ele volta para conferência.</div>' : "");

  function vAbast() {
    const r = S.rasc || {}, L = S.listas;
    if (!L || !L.veiculos.length || !L.combustiveis.length) return `${topo("⛽ Abastecimento")}<div class="erro">Faltam veículos ou combustíveis. Conecte-se à internet uma vez ou avise o responsável.</div>`;
    const minimo = r.data_abast && r.data_abast < diasAtras(DIAS_ATRAS) ? r.data_abast : diasAtras(DIAS_ATRAS);
    return `${topo("⛽ Abastecimento")}
      <label>Placa do veículo</label><select id="ab_placa">${optsPlaca(r.placa)}</select>
      <label>Combustível</label><select id="ab_comb">${opts(L.combustiveis, r.combustivel, "— selecione —")}</select>
      <label>Data do abastecimento</label><input type="date" id="ab_data" value="${r.data_abast || hoje()}" min="${minimo}" max="${hoje()}">
      ${seletorOutro("ab_posto", "Posto", L.postos || [], r.posto, "Nome do posto")}
      <label>Valor total pago (R$)</label><input id="ab_total" data-mask="money" placeholder="0,00" value="${r.valor_total ? num(r.valor_total) : ""}">
      <label>Valor por litro (R$)</label><input id="ab_litro" data-mask="money" placeholder="0,00" value="${r.valor_litro ? num(r.valor_litro) : ""}">
      <label>Odômetro (km) — como está no painel</label><input id="ab_odo" data-mask="int" placeholder="Ex.: 125.430" value="${r.odometro ? fmtInt(r.odometro) : ""}">
      ${blocoFoto("ab", true)}<div id="msg"></div><button class="pri" data-act="validar-abast" style="margin-top:1rem">Continuar</button>`;
  }
  function vConfAbast() {
    const r = S.rasc;
    return `${topo("Confira os dados")}<div class="card"><b>Motorista:</b> ${esc(S.sessao.nome)}<br><b>Placa:</b> ${esc(r.placa)}<br><b>Combustível:</b> ${esc(r.combustivel)}<br>
      <b>Data:</b> ${brData(r.data_abast)}<br><b>Posto:</b> ${esc(r.posto)}<br><b>Valor total:</b> R$ ${num(r.valor_total)}<br><b>Valor por litro:</b> R$ ${num(r.valor_litro)}<br><b>Odômetro:</b> ${fmtInt(r.odometro)} km</div>
      <div class="metr"><div><b>${num(r.litros)}</b><span>Litros</span></div><div><b>${r.km != null ? fmtInt(r.km) : "—"}</b><span>Km rodados</span></div><div><b>${r.consumo != null ? num(r.consumo, 1) : "—"}</b><span>Km/L</span></div></div>
      ${S.foto ? `<img class="prev" src="data:image/jpeg;base64,${S.foto}">` : ""}${(r.alertas || []).map(a => `<div class="aviso">${esc(a)}</div>`).join("")}
      <label class="chk"><input type="checkbox" id="cf_ok"> Confirmo que os dados conferem com o comprovante</label><div id="msg"></div>
      <div class="linha" style="margin-top:1rem"><button data-act="voltar-form">← Corrigir</button><button class="pri" id="btn_salvar" data-act="salvar">${online() ? "✅ Enviar" : "💾 Salvar (envio depois)"}</button></div>`;
  }
  const passo = (id, rotulo, v) => `<label>${rotulo}</label><div class="passo"><button data-act="passo" data-alvo="${id}" data-d="-1">−</button><input id="${id}" type="number" inputmode="numeric" min="0" max="500" value="${v || 0}"><button data-act="passo" data-alvo="${id}" data-d="1">+</button></div>`;
  function vColeta() {
    const r = S.rasc || {}, L = S.listas;
    if (!L || !L.veiculos.length) return `${topo("📦 Coleta")}<div class="erro">Faltam veículos. Conecte-se à internet uma vez ou avise o responsável.</div>`;
    const minimo = r.data_coleta && r.data_coleta < diasAtras(DIAS_ATRAS) ? r.data_coleta : diasAtras(DIAS_ATRAS);
    return `${topo("📦 Coleta")}
      <label>Placa do veículo</label><select id="co_placa">${optsPlaca(r.placa)}</select>
      ${seletorOutro("co_cli", "Cliente / local da coleta (opcional)", L.clientes || [], r.cliente, "Nome do cliente")}
      <label>Data da coleta</label><input type="date" id="co_data" value="${r.data_coleta || hoje()}" min="${minimo}" max="${hoje()}">
      <h2>Quantidade de bombonas</h2>${passo("co_q20", "Bombonas de 20 L", r.qtd_20)}${passo("co_q60", "Bombonas de 60 L", r.qtd_60)}${passo("co_q200", "Bombonas de 200 L", r.qtd_200)}
      <label>Peso na balança (kg) — se já pesou</label><input id="co_peso" data-mask="dec" placeholder="Ex.: 245,5" value="${r.peso_bruto ? fmtDec(r.peso_bruto) : ""}">
      <label>Observações (opcional)</label><textarea id="co_obs" maxlength="300" placeholder="Ex.: cliente pediu retorno na sexta, bombona danificada...">${esc(r.observacoes || "")}</textarea>
      ${blocoFoto("co", false)}<div id="msg"></div><button class="pri" data-act="validar-coleta" style="margin-top:1rem">Continuar</button>`;
  }
  function vConfColeta() {
    const r = S.rasc;
    return `${topo("Confira a coleta")}<div class="card"><b>Motorista:</b> ${esc(S.sessao.nome)}<br><b>Placa:</b> ${esc(r.placa)}<br><b>Cliente:</b> ${esc(r.cliente || "—")}<br><b>Data:</b> ${brData(r.data_coleta)}</div>
      <div class="metr"><div><b>${r.qtd_20}</b><span>20 L</span></div><div><b>${r.qtd_60}</b><span>60 L</span></div><div><b>${r.qtd_200}</b><span>200 L</span></div></div>
      <div class="metr"><div><b>${fmtDec(r.tara)} kg</b><span>Tara</span></div><div><b>${r.peso_bruto ? fmtDec(r.peso_bruto) + " kg" : "—"}</b><span>Peso bruto</span></div><div><b>${r.peso_bruto ? fmtDec(r.peso_bruto - r.tara) + " kg" : "—"}</b><span>Peso líquido</span></div></div>
      ${r.observacoes ? `<p><b>Observações:</b> ${esc(r.observacoes)}</p>` : ""}${S.foto ? `<img class="prev" src="data:image/jpeg;base64,${S.foto}">` : ""}
      ${(r.alertas || []).map(a => `<div class="aviso">${esc(a)}</div>`).join("")}
      <label class="chk"><input type="checkbox" id="cf_ok"> Confirmo que as quantidades estão corretas</label><div id="msg"></div>
      <div class="linha" style="margin-top:1rem"><button data-act="voltar-form">← Corrigir</button><button class="pri" id="btn_salvar" data-act="salvar">${online() ? "✅ Enviar" : "💾 Salvar (envio depois)"}</button></div>`;
  }
  function vOk() {
    return `${barra()}<div class="ok" style="font-size:1.1rem">${esc(S.okMsg)}</div><p class="peq">Errou algo? Em <b>Meus registros</b> você corrige ou cancela enquanto ele não for aprovado.</p>
      <button class="pri" data-act="ir" data-t="${S.tipo}">➕ Fazer outro registro</button><div style="height:.6rem"></div><button data-act="ir" data-t="home">🏠 Início</button>`;
  }
  const STATUS = { pendente: "🟡 Aguardando conferência", aprovado: "🟢 Aprovado", rejeitado: "🔴 Devolvido para correção", cancelado: "⚫ Cancelado" };
  function resumo(tipo, r) {
    return tipo === "abast"
      ? `<b>⛽ Abastecimento</b> · ${brData(r.data_abast)}<br>${esc(r.placa)} · ${esc(r.combustivel)} · R$ ${num(r.valor_total)} · odômetro ${fmtInt(r.odometro)}`
      : `<b>📦 Coleta</b> · ${brData(r.data_coleta)}<br>${esc(r.placa)} · ${esc(r.cliente || "sem cliente")}<br>20 L × ${r.qtd_20} · 60 L × ${r.qtd_60} · 200 L × ${r.qtd_200}`;
  }
  function vMeus() {
    const fila = (S._fila || []).filter(i => i.motorista === S.sessao.nome);
    const locais = fila.map(i => `<div class="card">${resumo(i.tipo, i.reg)}<div class="st">📥 Aguardando envio</div>${i.erro ? `<div class="erro">${esc(i.erro)}</div>` : ""}
      <div class="linha"><button data-act="corrigir-fila" data-id="${i.id_cliente}">✏️ Corrigir</button><button class="perigo" data-act="excluir-fila" data-id="${i.id_cliente}">🗑️ Excluir</button></div></div>`).join("");
    let servidor;
    if (S.meus == null) servidor = `<div class="info">${esc(S.meusErro || "Carregando…")}</div>`;
    else if (!S.meus.length) servidor = '<p class="peq">Nenhum registro enviado nos últimos 30 dias.</p>';
    else servidor = S.meus.map(r => `<div class="card">${resumo(r._tipo, r)}<div class="st">${STATUS[r.status] || esc(r.status)}</div>${r.status === "rejeitado" && r.motivo ? `<div class="erro">Motivo: ${esc(r.motivo)}</div>` : ""}
      ${["pendente", "rejeitado"].includes(r.status) ? `<div class="linha"><button data-act="corrigir-srv" data-id="${r.id}" data-t="${r._tipo}">✏️ Corrigir</button><button class="perigo" data-act="cancelar-srv" data-id="${r.id}" data-t="${r._tipo}">🗑️ Cancelar</button></div>` : ""}</div>`).join("");
    return `${barra()}<button data-act="ir" data-t="home" style="width:auto;min-height:2.6rem">← Início</button><h2>📋 Meus registros</h2><div id="msg"></div>
      ${locais ? `<h2>No celular (ainda não enviados)</h2>${locais}` : ""}<h2>Já enviados (últimos 30 dias)</h2>${servidor}`;
  }

  function render() {
    const v = { login: vLogin, home: vHome, meus: vMeus }[S.tela]
      || (S.tela === "abast" ? (S.fase === "form" ? vAbast : S.fase === "confirmar" ? vConfAbast : vOk)
        : S.tela === "coleta" ? (S.fase === "form" ? vColeta : S.fase === "confirmar" ? vConfColeta : vOk) : vHome);
    app().innerHTML = v(); aplicarMascaras(app());
  }
  const msg = (html, tipo) => { const m = $("#msg"); if (m) m.innerHTML = html ? `<div class="${tipo || "erro"}">${html}</div>` : ""; };

  // ============================ ações ============================
  function limparFluxo() { S.rasc = null; S.foto = null; S.edit = null; S.fase = "form"; S.okMsg = ""; }
  async function carregarMeus() {
    try { S.meus = await rpc("app_meus", { p_token: token() }); S.meusErro = ""; }
    catch (e) { S.meus = null; S.meusErro = e.rede ? "Sem sinal: não consigo buscar os registros já enviados." : msgErro(e); if (!e.rede && e.message === "sessao_invalida") sessaoExpirada(); }
  }
  async function irPara(t) {
    limparFluxo(); S.tela = t; S.tipo = (t === "abast" || t === "coleta") ? t : S.tipo;
    S._fila = await contarFila();
    if (t === "meus") { S.meus = null; S.meusErro = online() ? "Carregando…" : "Sem sinal: não consigo buscar os registros já enviados."; render(); await carregarMeus(); }
    render();
  }
  function lerAbast() {
    const g = id => $("#" + id), erros = [], alertas = [];
    const placa = g("ab_placa").value, comb = g("ab_comb").value, data = g("ab_data").value;
    const sel = g("ab_posto").value, posto = sel === OUTRO ? g("ab_posto_txt").value.trim() : sel;
    const total = parseNum(g("ab_total").value), litro = parseNum(g("ab_litro").value), odo = parseIntBR(g("ab_odo").value);
    if (!placa) erros.push("Selecione a placa."); if (!comb) erros.push("Selecione o combustível."); if (!data) erros.push("Informe a data.");
    if (!posto) erros.push("Selecione o posto (ou escolha “Outro” e digite o nome).");
    else if (sel === OUTRO && !(S.listas.postos || []).includes(posto)) alertas.push("Posto novo (não está na lista): " + posto);
    if (!total || total <= 0) erros.push("Informe o valor total pago.");
    if (!litro || litro < 2 || litro > 20) erros.push("Valor por litro inválido (esperado entre R$ 2,00 e R$ 20,00).");
    if (!odo) erros.push("Informe o odômetro.");
    if (!S.foto && !(S.edit && S.edit.fotoExistente)) erros.push("Tire a foto do comprovante (ou escolha da galeria).");
    let litros = null, km = null, consumo = null, odoMsg = null;
    if (!erros.length) {
      litros = round2(total / litro);
      const ult = ultimoOdo(placa, S.edit && S.edit.origem === "fila" ? S.edit.id : null);
      if (ult > 0) {
        if (odo <= ult) odoMsg = `O odômetro (${fmtInt(odo)} km) precisa ser maior que o último registrado desta placa (${fmtInt(ult)} km). Confira o número.`;
        else if (odo - ult > MAX_SALTO) odoMsg = `Diferença de ${fmtInt(odo - ult)} km desde o último registro é grande demais. Confira o odômetro.`;
        else {
          km = odo - ult; consumo = round2(km / litros);
          const moto = tipoVeiculo(placa).toLowerCase() === "moto", f = moto ? [10, 70] : [1.5, 25];
          if (consumo < f[0] || consumo > f[1]) alertas.push(`Consumo calculado de ${num(consumo, 1)} km/L está fora do comum. Confira os valores.`);
        }
      } else alertas.push("Primeiro registro deste veículo no sistema.");
      if (litros > 400) alertas.push(`${fmtInt(litros)} litros é muito para um abastecimento. Confira o valor.`);
    }
    if (odoMsg) {
      if ($("#ovr") && $("#ovr").checked) alertas.push("Odômetro confirmado pelo motorista: " + odoMsg);
      else { erros.push(odoMsg + '<label class="chk" style="margin-top:.6rem"><input type="checkbox" id="ovr"> Conferi no painel: o odômetro está certo</label>'); }
    }
    return { erros, rasc: { placa, combustivel: comb, data_abast: data, posto, valor_total: total, valor_litro: litro, odometro: odo, litros, km, consumo, alertas } };
  }
  function lerColeta() {
    const g = id => $("#" + id), erros = [], alertas = [];
    const placa = g("co_placa").value, data = g("co_data").value;
    const sel = g("co_cli").value, cliente = sel === OUTRO ? g("co_cli_txt").value.trim() : sel;
    const q = { 20: parseInt(g("co_q20").value, 10) || 0, 60: parseInt(g("co_q60").value, 10) || 0, 200: parseInt(g("co_q200").value, 10) || 0 };
    const pesoTxt = g("co_peso").value.trim(); let peso = 0;
    if (!placa) erros.push("Selecione a placa."); if (!data) erros.push("Informe a data.");
    if (q[20] + q[60] + q[200] === 0) erros.push("Informe a quantidade de ao menos um tipo de bombona.");
    if (Object.values(q).some(v => v < 0 || v > 500)) erros.push("Quantidade de bombonas inválida.");
    if (pesoTxt) { peso = parseNum(pesoTxt); if (!peso || peso <= 0) { erros.push("Peso inválido. Digite só números (ex.: 245,5) ou deixe em branco."); peso = 0; } }
    const tara = round2(q[20] * TARAS[20] + q[60] * TARAS[60] + q[200] * TARAS[200]);
    if (peso && peso < tara) erros.push(`O peso na balança (${fmtDec(peso)} kg) é menor que a tara das bombonas (${fmtDec(tara)} kg). Confira os números.`);
    [[20, 40], [60, 25], [200, 10]].forEach(([k, lim]) => { if (q[k] > lim) alertas.push(`${q[k]} bombonas de ${k} L é bastante. Confira a quantidade.`); });
    if (sel === OUTRO && cliente && !(S.listas.clientes || []).includes(cliente)) alertas.push("Cliente novo (não está na lista): " + cliente);
    return { erros, rasc: { placa, cliente: cliente || null, data_coleta: data, qtd_20: q[20], qtd_60: q[60], qtd_200: q[200], peso_bruto: peso, tara, observacoes: g("co_obs").value.trim() || null, alertas } };
  }
  const payload = (tipo, r) => tipo === "abast"
    ? { placa: r.placa, combustivel: r.combustivel, data_abast: r.data_abast, posto: r.posto, valor_total: r.valor_total, valor_litro: r.valor_litro, odometro: r.odometro }
    : { placa: r.placa, cliente: r.cliente, data_coleta: r.data_coleta, qtd_20: r.qtd_20, qtd_60: r.qtd_60, qtd_200: r.qtd_200, peso_bruto: r.peso_bruto, observacoes: r.observacoes };

  async function salvar() {
    if (!$("#cf_ok").checked) return msg("Marque a confirmação para continuar.");
    const btn = $("#btn_salvar"); btn.disabled = true;
    const tipo = S.tipo, r = S.rasc;
    try {
      if (S.edit && S.edit.origem === "servidor") {
        await rpc("app_corrigir", { p_token: token(), p_tabela: tipo, p_id: S.edit.id, p_reg: payload(tipo, r), p_foto: S.foto || null });
        S.okMsg = "✅ Correção enviada!";
      } else {
        const id = S.edit && S.edit.origem === "fila" ? S.edit.id : uuid();
        await idb.put("fila", { id_cliente: id, tipo, motorista: S.sessao.nome, registrado_em: (S.edit && S.edit.registrado_em) || new Date().toISOString(), reg: payload(tipo, r), foto: S.foto || null, erro: null });
        S._fila = await contarFila(); await sincronizar();
        const ainda = await idb.get("fila", id);
        S.okMsg = ainda ? "📥 Salvo no celular! Será enviado automaticamente quando houver sinal." : "✅ Enviado!";
      }
      S.fase = "ok"; S._fila = await contarFila(); render();
    } catch (e) { btn.disabled = false; msg(esc(msgErro(e)) + (e.rede ? " A correção de um registro já enviado precisa de internet." : "")); if (!e.rede && e.message === "sessao_invalida") sessaoExpirada(); }
  }
  function abrirEdicao(tipo, r, edit, foto) { limparFluxo(); S.tela = tipo; S.tipo = tipo; S.rasc = r; S.edit = edit; S.foto = foto || null; S.fase = "form"; render(); }

  const acoes = {
    async entrar() {
      const nome = $("#lg_nome").value, pin = $("#lg_pin").value;
      if (!nome) return msg("Selecione o seu nome."); if (!/^\d{4,6}$/.test(pin)) return msg("Digite o seu PIN (4 a 6 números).");
      if (!online()) return msg("Sem sinal. Para entrar pela primeira vez é preciso estar com internet.");
      try {
        const r = await rpc("app_login", { p_nome: nome, p_pin: pin });
        if (!r.ok) return msg(esc(r.msg));
        S.sessao = { token: r.token, nome: r.nome }; gravarSessao(S.sessao, $("#lg_manter").checked); S.aviso = "";
        await atualizarListas(); S._fila = await contarFila(); S.tela = "home"; render(); sincronizar();
      } catch (e) { msg(esc(msgErro(e))); }
    },
    async trocar() {
      await contarFila();
      if (S.filaN && !confirm(`Você tem ${S.filaN} registro(s) ainda não enviados. Se trocar agora, eles ficam guardados no celular até você entrar de novo com sinal. Trocar mesmo assim?`)) return;
      limparSessao(); S.sessao = null; S.tela = "login"; limparFluxo(); S.aviso = ""; render();
    },
    ir(a) { irPara(a.dataset.t); },
    sincronizar() { sincronizar(); },
    async "recarregar-nomes"() { await carregarNomes(); render(); },
    foto(a) { $("#" + a.dataset.alvo).click(); },
    outro(a) { /* tratado no evento change */ },
    passo(a) { const el = $("#" + a.dataset.alvo); el.value = Math.max(0, Math.min(500, (parseInt(el.value, 10) || 0) + parseInt(a.dataset.d, 10))); },
    "validar-abast"() {
      const { erros, rasc } = lerAbast();
      if (erros.length) return msg(erros.join("<br>"));
      S.rasc = rasc; S.fase = "confirmar"; render();
    },
    "validar-coleta"() {
      const { erros, rasc } = lerColeta();
      if (erros.length) return msg(erros.join("<br>"));
      S.rasc = rasc; S.fase = "confirmar"; render();
    },
    "voltar-form"() { S.fase = "form"; render(); },
    salvar() { salvar(); },
    async "corrigir-fila"(a) {
      const it = (await idb.get("fila", a.dataset.id)); if (!it) return;
      abrirEdicao(it.tipo, Object.assign({}, it.reg), { origem: "fila", id: it.id_cliente, registrado_em: it.registrado_em }, it.foto);
    },
    async "excluir-fila"(a) {
      if (!confirm("Excluir este registro do celular? Ele não será enviado.")) return;
      await idb.del("fila", a.dataset.id); S._fila = await contarFila(); render();
    },
    "corrigir-srv"(a) {
      const r = (S.meus || []).find(x => String(x.id) === a.dataset.id && x._tipo === a.dataset.t); if (!r) return;
      const base = a.dataset.t === "abast"
        ? { placa: r.placa, combustivel: r.combustivel, data_abast: r.data_abast, posto: r.posto, valor_total: Number(r.valor_total), valor_litro: Number(r.valor_litro), odometro: Number(r.odometro) }
        : { placa: r.placa, cliente: r.cliente, data_coleta: r.data_coleta, qtd_20: r.qtd_20, qtd_60: r.qtd_60, qtd_200: r.qtd_200, peso_bruto: Number(r.peso_bruto), observacoes: r.observacoes };
      abrirEdicao(a.dataset.t, base, { origem: "servidor", id: Number(r.id), fotoExistente: !!r.foto_path });
    },
    async "cancelar-srv"(a) {
      if (!confirm("Cancelar este registro?")) return;
      try { await rpc("app_cancelar", { p_token: token(), p_tabela: a.dataset.t, p_id: Number(a.dataset.id) }); await carregarMeus(); render(); }
      catch (e) { msg(esc(msgErro(e))); if (!e.rede && e.message === "sessao_invalida") sessaoExpirada(); }
    }
  };

  document.addEventListener("click", ev => {
    const a = ev.target.closest("[data-act]"); if (!a || a.tagName === "SELECT") return;
    ev.preventDefault(); const f = acoes[a.dataset.act]; if (f) f(a);
  });
  document.addEventListener("change", async ev => {
    const el = ev.target;
    if (el.tagName === "SELECT" && el.dataset.act === "outro") { const t = $("#" + el.dataset.alvo); if (t) { t.style.display = el.value === OUTRO ? "" : "none"; if (el.value === OUTRO) t.focus(); } }
    if (el.type === "file" && el.files && el.files[0]) {
      const pref = el.id.split("_")[0], alvo = $("#" + pref + "_prev");
      try { S.foto = await processarFoto(el.files[0]); alvo.innerHTML = `<img class="prev" src="data:image/jpeg;base64,${S.foto}">`; msg(""); }
      catch (e) { msg(esc(e.message)); }
      el.value = "";
    }
  });
  window.addEventListener("online", async () => { if (S.sessao) { atualizarListas(); sincronizar(); } else if (S.tela === "login") await carregarNomes(); if (["home", "meus", "login"].includes(S.tela)) render(); });
  window.addEventListener("offline", () => { if (["home", "meus", "login"].includes(S.tela)) render(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.sessao) sincronizar(); });
  setInterval(() => { if (S.sessao && S.filaN && online()) sincronizar(); }, 30000);

  // ============================ início ============================
  async function iniciar() {
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(() => { });
    const c = await idb.get("cache", "nomes"); S.nomes = c ? c.v : [];
    S.sessao = lerSessao();
    if (S.sessao) { const l = await idb.get("cache", "listas"); if (l) S.listas = l.v; S._fila = await contarFila(); S.tela = "home"; render(); atualizarListas().then(() => { if (S.tela === "home") render(); }); sincronizar(); }
    else render();
    await carregarNomes(); if (S.tela === "login") render();
  }
  window.__frota = { S, acoes, sincronizar, idb, iniciar };
  iniciar();
})();
