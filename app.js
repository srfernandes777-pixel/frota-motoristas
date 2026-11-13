"use strict";
(function () {
  const CFG = window.CONFIG || {};
  const TARAS = { 20: 1.8, 60: 3.5, 200: 8.5 };
  const MAX_SALTO = 3000, DIAS_ATRAS = 7, MAX_FOTOS = 5, OUTRO = "__outro__";
  const CATEGORIAS = { hidraulico_compactador: "Sistema Hidráulico e Compactador", freios_suspensao: "Freios e Suspensão", pneus_rodas: "Pneus e Rodas", motor_transmissao: "Motor e Transmissão", eletrico_iluminacao: "Sistema Elétrico e Iluminação", carroceria_seguranca: "Carroceria e Segurança" };
  const CRITICIDADES = { leve: "🟢 Leve / Pode rodar", atencao: "🟡 Atenção / Agendar", critico: "🔴 Crítico / Parar veículo" };
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
  // Aceita a URL mesmo com "/rest/v1/" ou espaços sobrando: usa só https://xxxx.supabase.co
  const baseUrl = () => { try { return new URL(String(CFG.SUPABASE_URL).trim()).origin; } catch (e) { return String(CFG.SUPABASE_URL || "").trim().replace(/\/+$/, ""); } };
  const chaveApi = () => String(CFG.SUPABASE_KEY || "").trim();
  async function rpc(fn, args) {
    const h = { "Content-Type": "application/json", apikey: chaveApi() };
    if (chaveApi().startsWith("eyJ")) h.Authorization = "Bearer " + chaveApi();
    let r; const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 25000);
    try {
      r = await fetch(`${baseUrl()}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args || {}), signal: ac.signal });
    } catch (e) { throw new ApiErro("Sem conexão", true); } finally { clearTimeout(to); }
    let corpo = null; try { corpo = await r.json(); } catch (e) { /* sem corpo */ }
    if (!r.ok) throw new ApiErro((corpo && corpo.message) || ("Erro " + r.status), false);
    return corpo;
  }
  const MSG = { sessao_invalida: "Sua sessão expirou. Entre de novo.", dados_invalidos: "O servidor não aceitou os dados. Confira os valores.",
    foto_grande: "A foto é grande demais.", nao_alteravel: "Este registro já foi aprovado ou cancelado e não pode mais ser alterado." };
  const msgErro = e => e.rede ? "Sem sinal no momento." : (MSG[e.message] || ("Erro no servidor: " + e.message));

  const configPendente = () => { const u = String(CFG.SUPABASE_URL || "").trim(), k = String(CFG.SUPABASE_KEY || "").trim(); return !/^https?:\/\//i.test(u) || /x{5,}/i.test(u) || !k || /x{8,}/i.test(k); };
  function diagnostico(e) {
    const m = String(e && e.message || "");
    if (e && e.rede) return "Não consegui falar com o servidor. Confira a URL no config.js e a internet.";
    if (/invalid path/i.test(m)) return "A URL do config.js tem algo depois de .supabase.co. Deixe só o endereço do projeto, no formato https://xxxx.supabase.co";
    if (/PGRST202|find the function|schema cache/i.test(m)) return "O banco ainda não tem as funções do app offline. Rode o arquivo schema_v3_offline.sql no Supabase e aguarde 1 minuto.";
    if (/api key|apikey|jwt|401|403|permission/i.test(m)) return "A chave do config.js foi recusada. Use a chave PUBLICÁVEL (sb_publishable_...) do seu projeto.";
    return "Erro do servidor: " + m;
  }

  // ============================ estado ============================
  const S = { protocolos: {}, dreDias: 30, tela: "login", sessao: null, listas: null, nomes: [], tipo: null, fase: "form", rasc: null, fotos: [], anexos: [], edit: null, filaN: 0, meus: null, meusErro: "", ultimosAbast: null, ultimosAbastErro: "", ultimosAbastCarregando: false, abastVeiculo: "", abastDias: 7, sync: false, okMsg: "", aviso: "", erroNomes: "", syncMsg: null, locais: {}, turnos: null, turno: null, turnoErro: "", manutencoes: null, historico: null, manutErro: "" };
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
    try {  // localizações aprovadas dos clientes (sem sinal, ou banco ainda sem a função: fica o que já está guardado)
      const lo = await rpc("app_locais", { p_token: token() });
      S.locais = Object.fromEntries((lo || []).map(x => [x.nome, x])); await idb.put("cache", { k: "locais", v: S.locais });
    } catch (e) { /* mantém o cache */ }
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
  async function sincronizar(manual) {
    if (!S.sessao || S.sync) return;
    if (!online()) { if (manual) { S.syncMsg = { t: "Sem sinal no momento. O envio acontece sozinho quando o sinal voltar.", c: "aviso" }; render(); } return; }
    S.sync = true;
    let enviados = 0, falhas = 0, ultimoErro = "", semRede = false, expirou = false;
    if (manual) { S.syncMsg = { t: "Enviando…", c: "info" }; render(); }
    try {
      const todos = await idb.all("fila");
      const meus = todos.filter(i => i.motorista === S.sessao.nome).sort((a, b) => a.registrado_em < b.registrado_em ? -1 : 1);
      for (const it of meus) {
        try {
          const regEnv = Object.assign({}, it.reg, { id_cliente: it.id_cliente, registrado_em: it.registrado_em });
          let resp; if (it.tipo === "manutencao") resp = await enviarManutencao(it);
          else if (it.tipo === "local") resp = await rpc("app_enviar_local", { p_token: token(), p_reg: regEnv });
          else resp = await rpc("app_enviar", { p_token: token(), p_tabela: it.tipo, p_reg: regEnv, p_foto: null, p_fotos: it.fotos || (it.foto ? [it.foto] : []) });
          S.protocolos[it.id_cliente] = resp && resp.id != null ? resp.id : "dup"; await idb.del("fila", it.id_cliente); enviados++;
          if (it.tipo === "abast") await bumpUltimo(it.reg.placa, it.reg.odometro);
        } catch (e) {
          if (e.rede) { semRede = true; break; }
          if (e.message === "sessao_invalida") { expirou = true; break; }
          falhas++; ultimoErro = msgErro(e); it.erro = ultimoErro; await idb.put("fila", it);
        }
      }
    } finally { S.sync = false; S._fila = await contarFila(); }
    if (expirou) return sessaoExpirada();
    if (S.fase === "ok" && S.okIdc && S.protocolos[S.okIdc] !== undefined) { S.okNum = S.protocolos[S.okIdc]; S.okIdc = null; S.okErro = ""; render(); }
    if (manual || falhas) {
      S.syncMsg = semRede ? { t: "Sem sinal: não consegui enviar agora. Tento de novo sozinho.", c: "aviso" }
        : falhas ? { t: `⚠️ ${falhas} registro(s) não aceito(s) pelo servidor: ${ultimoErro}`, c: "erro" }
        : enviados ? { t: `✅ ${enviados} registro(s) enviado(s)!`, c: "ok" } : { t: "Não há nada para enviar.", c: "info" };
    } else if (enviados) S.syncMsg = null;
    if (["home", "meus", "frota", "manutencoes"].includes(S.tela)) {
      if (S.tela === "meus") await carregarMeus();
      if (S.tela === "frota") await carregarUltimosAbast();
      if (S.tela === "manutencoes" && enviados) await carregarManutencoes();
      render();
    }
  }

  // ============================ foto ============================
  const lerBase64 = blob => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(",")[1]); f.onerror = () => rej(f.error); f.readAsDataURL(blob); });
  async function enviarManutencao(it) {
    if (!it.servidor_id) {
      const resp = await rpc("app_enviar_manutencao", { p_token: token(), p_reg: Object.assign({}, it.reg, { id_cliente: it.id_cliente }) });
      if (!resp || !resp.ok || resp.id == null) throw new Error("Resposta inválida ao enviar relato.");
      it.servidor_id = resp.id;
      await idb.put("fila", it);
    }
    for (const anexo of it.anexos || []) {
      const tamanho = 256 * 1024, total = Math.ceil(anexo.blob.size / tamanho);
      for (let indice = anexo.proximo || 0; indice < total; indice++) {
        const dados = await lerBase64(anexo.blob.slice(indice * tamanho, (indice + 1) * tamanho));
        const resp = await rpc("app_anexar_manutencao", { p_token: token(), p_manutencao_id: it.servidor_id, p_id_cliente: anexo.id, p_tipo: anexo.tipo, p_mime: anexo.mime, p_indice: indice, p_total: total, p_dados: dados });
        if (!resp || !resp.ok || (indice === total - 1 && !resp.completo)) throw new Error("O servidor não confirmou a evidência.");
        anexo.proximo = indice + 1;
        await idb.put("fila", it);
      }
    }
    return { id: it.servidor_id };
  }
  const listarAnexos = () => S.anexos.map((a, i) => `<div class="card">${a.tipo === "foto" ? "📷" : "🎬"} ${esc(a.nome)} <button data-act="rm-anexo" data-i="${i}">Remover</button></div>`).join("");
  function duracaoVideo(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video"), url = URL.createObjectURL(file);
      const timer = setTimeout(() => terminar(new Error("Não foi possível verificar a duração do vídeo.")), 15000);
      function terminar(erro) {
        clearTimeout(timer); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
        if (erro) reject(erro); else resolve();
      }
      video.preload = "metadata";
      video.onloadedmetadata = () => terminar(!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 15 ? new Error("O vídeo deve ter até 15 segundos e duração verificável.") : null);
      video.onerror = () => terminar(new Error("Não foi possível ler o vídeo neste aparelho."));
      video.src = url;
    });
  }
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

  // ============================ localização (GPS) ============================
  const LOC_PREC_MAX = 60;  // metros: pior que isso, pede para tentar de novo
  const round6 = v => Math.round(v * 1e6) / 1e6;
  const semAcento = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Fica até 20 s ouvindo o GPS e guarda a melhor leitura (a primeira costuma ser imprecisa).
  function posicao(ms, alvo) {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("Este aparelho não oferece localização para o navegador."));
      let melhor = null, fim = false, id = null, t = null;
      const fechar = erro => {
        if (fim) return; fim = true; navigator.geolocation.clearWatch(id); clearTimeout(t);
        if (erro) rej(erro); else if (melhor) res(melhor); else rej(new Error("Não consegui achar o GPS. Vá para um local aberto e tente de novo."));
      };
      id = navigator.geolocation.watchPosition(p => { if (!melhor || p.coords.accuracy < melhor.accuracy) melhor = p.coords; if (melhor.accuracy <= alvo) fechar(); },
        e => { if (e.code === 1) fechar(new Error("A localização está bloqueada. Permita a localização para este app nas configurações do celular/navegador.")); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: ms });
      t = setTimeout(() => fechar(), ms);
    });
  }
  async function marcarLocal(nome) {
    const c = await posicao(20000, 15), prec = Math.round(c.accuracy);
    if (prec > LOC_PREC_MAX) throw new Error(`O GPS está com pouca precisão (${prec} m). Vá para um local aberto, sem teto por cima, e tente de novo.`);
    await idb.put("fila", { id_cliente: uuid(), tipo: "local", motorista: S.sessao.nome, registrado_em: new Date().toISOString(),
      reg: { cliente: nome, latitude: round6(c.latitude), longitude: round6(c.longitude), precisao_m: prec }, fotos: [], erro: null });
    S._fila = await contarFila(); sincronizar();
    return prec;
  }
  async function acaoMarcar(nome, btn, alvo) {
    nome = String(nome || "").trim();
    const out = (h, tp) => { if (alvo) alvo.innerHTML = h ? `<div class="${tp || "erro"}">${h}</div>` : ""; };
    if (!nome) return out("Escolha ou digite o nome do cliente primeiro.");
    if (!confirm(`Você está no local de "${nome}"? A posição de agora será enviada para conferência.`)) return;
    const txt = btn.textContent; btn.disabled = true; btn.textContent = "📡 Buscando GPS…";
    out("📡 Buscando o sinal de GPS. Pode levar até 20 segundos: fique parado.", "info");
    try {
      const prec = await marcarLocal(nome);
      out(`✅ Localização de ${esc(nome)} guardada (precisão ${prec} m).${online() ? "" : " Será enviada quando houver sinal."}`, "ok");
    } catch (e) { out(esc(e.message)); }
    finally { btn.disabled = false; btn.textContent = txt; }
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
    const comErro = (S._fila || []).filter(i => i.motorista === S.sessao.nome && i.erro);
    const msgEnvio = S.syncMsg ? `<div class="${S.syncMsg.c}">${esc(S.syncMsg.t)}</div>` : "";
    const msgErroFila = comErro.length && !(S.syncMsg && S.syncMsg.c === "erro")
      ? `<div class="erro">⚠️ ${comErro.length} registro(s) não aceito(s) pelo servidor: ${esc(comErro[0].erro)}<br>Consulte <b>Meus registros</b> ou <b>Manutenção</b> e avise o responsável se necessário. Toque em <b>Enviar agora</b> para tentar de novo.</div>` : "";
    return `<div class="barra"><div>👤 <b>${esc(S.sessao.nome)}</b>${chip}</div><button data-act="trocar">Trocar</button></div>` +
      (n ? `<div class="aviso">📥 ${n} registro(s) aguardando envio.${online() ? ' <button data-act="sincronizar">Enviar agora</button>' : " Serão enviados quando houver sinal."}</div>` : "") + msgEnvio + msgErroFila;
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
      ${S.turno ? `<div class="card"><b>🚚 ${esc(S.turno.placa)}</b> · ${esc(S.turno.rota || "Sem rota")} · ${esc(S.turno.periodo)}<button data-act="trocar-turno">Trocar turno</button></div>` : ""}
      <div class="grade3" style="grid-template-columns:repeat(2,1fr)"><button class="pri" data-act="ir" data-t="manutencao">🔧<br>Manutenção</button><button class="pri" data-act="ir" data-t="abast">⛽<br>Abastecimento</button><button class="pri" data-act="ir" data-t="coleta">📦<br>Coleta</button><button class="pri" data-act="ir" data-t="clientes">🧭<br>Clientes</button><button class="pri" data-act="ir" data-t="meus">📋<br>Meus registros</button><button class="pri" data-act="ir" data-t="frota">🚚<br>Registros da Frota</button><button class="pri" style="grid-column:1/-1" data-act="ir" data-t="dre">📊<br>Meu painel (gastos e rendimento)</button></div>`;
  }
  function vTurnos() {
    const opcoes = (S.turnos || []).map(t => `<option value="${esc(t.id)}">${esc(t.placa)} · ${esc(t.rota || "Sem rota")} · ${esc(t.periodo)}</option>`).join("");
    return `${barra()}<h1>Escolha seu turno</h1><p class="peq">Selecione o caminhão e a rota atribuídos a você.</p>
      <label for="turno_data">Data do turno</label><input id="turno_data" type="date" value="${esc(S.turnoData || hoje())}">
      ${S.turnoErro ? `<div class="aviso">${esc(S.turnoErro)}</div>` : ""}
      ${opcoes ? `<label for="turno">Turno atribuído</label><select id="turno"><option value="">— selecione —</option>${opcoes}</select><div id="msg" role="alert"></div><button class="pri" data-act="selecionar-turno">Continuar</button>` : `<div class="info">${S.turnos == null ? "Carregando turnos…" : "Nenhum turno atribuído para esta data. Avise o responsável."}</div>`}
      <button data-act="recarregar-turnos">🔄 Atualizar turnos</button>`;
  }
  function vManutencao() {
    const r = S.rasc || {}, t = S.turno;
    return `${topo("🔧 Relatar manutenção")}<div class="card"><b>Caminhão:</b> ${esc(t.placa)}<br><b>Rota:</b> ${esc(t.rota || "—")}<br><b>Turno:</b> ${esc(t.periodo)} · ${esc(brData(t.data))}</div>
      <label for="ma_odo">Odômetro (km)</label><input id="ma_odo" data-mask="int" value="${r.odometro != null ? fmtInt(r.odometro) : ""}">
      <label for="ma_hora">Horímetro (horas)</label><input id="ma_hora" data-mask="dec" value="${r.horimetro != null ? fmtDec(r.horimetro) : ""}">
      <label for="ma_cat">Sistema</label><select id="ma_cat"><option value="">— selecione —</option>${Object.entries(CATEGORIAS).map(([v, texto]) => `<option value="${v}" ${r.categoria === v ? "selected" : ""}>${esc(texto)}</option>`).join("")}</select>
      <fieldset><legend>Nível de criticidade</legend>${Object.entries(CRITICIDADES).map(([v, texto]) => `<label class="chk"><input type="radio" name="criticidade" value="${v}" ${r.criticidade === v ? "checked" : ""}> ${texto}</label>`).join("")}</fieldset>
      <label for="ma_desc">Descreva o problema</label><textarea id="ma_desc" maxlength="2000">${esc(r.descricao || "")}</textarea>
      <label for="ma_fotos">Fotos (opcional, até 5, 5 MiB cada)</label><input type="file" id="ma_fotos" accept="image/jpeg,image/png,image/webp" multiple>
      <label for="ma_video">Vídeo curto (opcional, até 15 segundos e 20 MiB)</label><input type="file" id="ma_video" accept="video/mp4,video/webm,video/quicktime"><div id="ma_anexos">${listarAnexos()}</div>
      <div id="msg"></div><button class="pri" data-act="validar-manutencao">Continuar</button>
      <button data-act="ir" data-t="manutencoes">📋 Acompanhar relatos e histórico</button>`;
  }
  function vConfManutencao() {
    const r = S.rasc;
    return `${topo("Confira o relato")}<div class="card"><b>Caminhão:</b> ${esc(S.turno.placa)}<br><b>Rota:</b> ${esc(S.turno.rota || "—")}<br><b>Turno:</b> ${esc(S.turno.periodo)}<br><b>Odômetro:</b> ${fmtInt(r.odometro)} km<br><b>Horímetro:</b> ${fmtDec(r.horimetro)} h<br><b>Sistema:</b> ${esc(CATEGORIAS[r.categoria])}<br><b>Criticidade:</b> ${esc(CRITICIDADES[r.criticidade])}<br><b>Problema:</b> ${esc(r.descricao)}</div>
      <p>${S.anexos.length} evidência(s) selecionada(s)</p>
      <label class="chk"><input type="checkbox" id="cf_ok"> Confirmo os dados do relato</label><div id="msg"></div><div class="linha"><button data-act="voltar-form">← Corrigir</button><button class="pri" id="btn_salvar" data-act="salvar-manutencao" disabled>✅ Salvar relato</button></div>`;
  }
  function vManutencoes() {
    const fila = (S._fila || []).filter(i => i.tipo === "manutencao" && i.motorista === S.sessao.nome);
    const locais = fila.map(i => `<div class="card"><b>${esc(CATEGORIAS[i.reg.categoria])}</b> · ${esc(i.placa)}<br>${esc(CRITICIDADES[i.reg.criticidade])}<div class="st">📥 ${i.servidor_id ? "Relato enviado; evidências aguardando envio" : "Aguardando envio"}</div>${i.erro ? `<div class="erro">${esc(i.erro)}</div>` : ""}${!i.servidor_id ? `<button class="perigo" data-act="excluir-fila" data-id="${esc(i.id_cliente)}">Excluir relato local</button>` : ""}</div>`).join("");
    const estados = { recebido: "Recebido", visualizado: "Visualizado", agendado: "Agendado", em_andamento: "Em andamento", concluido: "Concluído", cancelado: "Cancelado" };
    const relatos = S.manutencoes == null ? `<div class="info">${esc(S.manutErro || "Carregando relatos…")}</div>` : S.manutencoes.length ? S.manutencoes.map(r => `<div class="card"><b>${esc(CATEGORIAS[r.categoria] || r.categoria)}</b> · ${esc(r.placa)}<br>${esc(CRITICIDADES[r.criticidade] || r.criticidade)}<br>${esc(r.descricao)}<div class="st">${r.visualizado_em ? "✅ Visto pelo responsável" : "⏳ Ainda não visualizado"}</div><div>Estado: ${esc(estados[r.status] || r.status || "registrado")}</div></div>`).join("") : '<p class="peq">Nenhum relato enviado.</p>';
    const hist = S.historico == null ? `<div class="info">${esc(S.manutErro || "Carregando histórico…")}</div>` : S.historico.length ? S.historico.map(r => `<div class="card"><b>${esc(CATEGORIAS[r.categoria] || r.categoria || "Manutenção")}</b>${r.concluido_em ? ` · ${esc(brData(String(r.concluido_em).slice(0, 10)))}` : ""}<br>${esc(r.descricao || "")}</div>`).join("") : '<p class="peq">Nenhuma manutenção concluída encontrada.</p>';
    return `${topo("📋 Manutenção")}<div id="msg"></div>${locais ? `<h2>No celular</h2>${locais}` : ""}<h2>Meus relatos</h2>${relatos}<h2>Últimas 5 manutenções concluídas · ${esc(S.turno.placa)}</h2>${hist}<button data-act="atualizar-manutencoes">🔄 Atualizar</button>`;
  }
  const fotosExistentes = () => (S.edit && S.edit.fotosExistentes) || 0;
  const miniaturas = fotos => fotos.length ? `<div class="miniaturas">${fotos.map(f => `<div class="mini"><img src="data:image/jpeg;base64,${f}"></div>`).join("")}</div>` : "";
  function pintarFotos(pref) {
    const prev = $("#" + pref + "_prev"); if (!prev) return;
    const ex = fotosExistentes(), total = ex + S.fotos.length;
    prev.innerHTML = (ex ? `<p class="peq">✔ ${ex} foto(s) enviada(s) antes serão mantidas.</p>` : "")
      + (S.fotos.length ? `<div class="miniaturas">${S.fotos.map((f, i) => `<div class="mini"><img src="data:image/jpeg;base64,${f}"><button class="x" data-act="rm-foto" data-i="${i}" data-pref="${pref}" aria-label="Remover foto">✕</button></div>`).join("")}</div>` : "");
    const c = $("#" + pref + "_cont"); if (c) c.textContent = `(${total}/${MAX_FOTOS})`;
    ["cam", "gal"].forEach(k => { const bt = $("#" + pref + "_b" + k); if (bt) bt.disabled = total >= MAX_FOTOS; });
  }
  function blocoFoto(pref, obrigatoria) {
    return `<label>📷 Fotos ${obrigatoria ? "do comprovante (pelo menos 1)" : "(opcional)"} <span id="${pref}_cont" class="peq"></span></label>
      <div class="linha"><button data-act="foto" data-alvo="${pref}_cam" id="${pref}_bcam">📷 Tirar foto</button><button data-act="foto" data-alvo="${pref}_gal" id="${pref}_bgal">🖼️ Galeria</button></div>
      <input type="file" accept="image/*" capture="environment" id="${pref}_cam" hidden><input type="file" accept="image/*" multiple id="${pref}_gal" hidden>
      <div id="${pref}_prev"></div>`;
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
      ${miniaturas(S.fotos)}${(r.alertas || []).map(a => `<div class="aviso">${esc(a)}</div>`).join("")}
      <label class="chk"><input type="checkbox" id="cf_ok"> Confirmo que os dados conferem com o comprovante</label><div id="msg"></div>
      <div class="linha" style="margin-top:1rem"><button data-act="voltar-form">← Corrigir</button><button class="pri" id="btn_salvar" data-act="salvar" disabled>${online() ? "✅ Enviar" : "💾 Salvar (envio depois)"}</button></div>`;
  }
  const passo = (id, rotulo, v) => `<label>${rotulo}</label><div class="passo"><button data-act="passo" data-alvo="${id}" data-d="-1">−</button><input id="${id}" type="number" inputmode="numeric" min="0" max="500" value="${v || 0}"><button data-act="passo" data-alvo="${id}" data-d="1">+</button></div>`;
  function vColeta() {
    const r = S.rasc || {}, L = S.listas;
    if (!L || !L.veiculos.length) return `${topo("📦 Coleta")}<div class="erro">Faltam veículos. Conecte-se à internet uma vez ou avise o responsável.</div>`;
    const minimo = r.data_coleta && r.data_coleta < diasAtras(DIAS_ATRAS) ? r.data_coleta : diasAtras(DIAS_ATRAS);
    return `${topo("📦 Coleta")}
      <label>Placa do veículo</label><select id="co_placa">${optsPlaca(r.placa)}</select>
      ${seletorOutro("co_cli", "Cliente / local da coleta (opcional)", L.clientes || [], r.cliente, "Nome do cliente")}
      <div id="nav_cli">${navCliente(r.cliente)}</div>
      <button data-act="marcar-coleta" style="margin-top:.6rem">📍 Marcar localização deste cliente</button><div id="msg_loc"></div><p class="peq">Toque só quando estiver no local do cliente.</p>
      <label>Data da coleta</label><input type="date" id="co_data" value="${r.data_coleta || hoje()}" min="${minimo}" max="${hoje()}">
      <h2>📥 Bombonas coletadas (com resíduo)</h2>${passo("co_q20", "Bombonas de 20 L", r.qtd_20)}${passo("co_q60", "Bombonas de 60 L", r.qtd_60)}${passo("co_q200", "Bombonas de 200 L", r.qtd_200)}
      <h2>📤 Bombonas entregues (vazias, deixadas no cliente)</h2><p class="peq">Deixe em 0 se não deixou nenhuma.</p>${passo("co_e20", "Bombonas de 20 L", r.qtd_ent_20)}${passo("co_e60", "Bombonas de 60 L", r.qtd_ent_60)}${passo("co_e200", "Bombonas de 200 L", r.qtd_ent_200)}
      <label>Peso na balança (kg) — só das coletadas, se já pesou</label><input id="co_peso" data-mask="dec" placeholder="Ex.: 245,5" value="${r.peso_bruto ? fmtDec(r.peso_bruto) : ""}">
      <label>Observações (opcional)</label><textarea id="co_obs" maxlength="300" placeholder="Ex.: cliente pediu retorno na sexta, bombona danificada...">${esc(r.observacoes || "")}</textarea>
      ${blocoFoto("co", false)}<div id="msg"></div><button class="pri" data-act="validar-coleta" style="margin-top:1rem">Continuar</button>`;
  }
  function vConfColeta() {
    const r = S.rasc;
    return `${topo("Confira a coleta")}<div class="card"><b>Motorista:</b> ${esc(S.sessao.nome)}<br><b>Placa:</b> ${esc(r.placa)}<br><b>Cliente:</b> ${esc(r.cliente || "—")}<br><b>Data:</b> ${brData(r.data_coleta)}</div>
      <p class="peq"><b>📥 Coletadas (com resíduo)</b></p><div class="metr"><div><b>${r.qtd_20}</b><span>20 L</span></div><div><b>${r.qtd_60}</b><span>60 L</span></div><div><b>${r.qtd_200}</b><span>200 L</span></div></div>
      <p class="peq"><b>📤 Entregues (vazias)</b></p><div class="metr"><div><b>${r.qtd_ent_20}</b><span>20 L</span></div><div><b>${r.qtd_ent_60}</b><span>60 L</span></div><div><b>${r.qtd_ent_200}</b><span>200 L</span></div></div>
      <div class="metr"><div><b>${fmtDec(r.tara)} kg</b><span>Tara</span></div><div><b>${r.peso_bruto ? fmtDec(r.peso_bruto) + " kg" : "—"}</b><span>Peso bruto</span></div><div><b>${r.peso_bruto ? fmtDec(r.peso_bruto - r.tara) + " kg" : "—"}</b><span>Peso líquido</span></div></div>
      ${r.observacoes ? `<p><b>Observações:</b> ${esc(r.observacoes)}</p>` : ""}${miniaturas(S.fotos)}
      ${(r.alertas || []).map(a => `<div class="aviso">${esc(a)}</div>`).join("")}
      <label class="chk"><input type="checkbox" id="cf_ok"> Confirmo que as quantidades coletadas e entregues estão corretas</label><div id="msg"></div>
      <div class="linha" style="margin-top:1rem"><button data-act="voltar-form">← Corrigir</button><button class="pri" id="btn_salvar" data-act="salvar" disabled>${online() ? "✅ Enviar" : "💾 Salvar (envio depois)"}</button></div>`;
  }
  function vOk() {
    const tipoTxt = S.tipo === "coleta" ? "Coleta" : S.tipo === "manutencao" ? "Manutenção" : "Abastecimento", enviado = S.okNum != null, corrigido = /Correção/.test(S.okMsg);
    const numTxt = S.okNum === "dup" ? "já registrado antes" : "Nº " + S.okNum;
    const caixa = enviado
      ? `<div class="ok-grande"><div class="ok-icone">✅</div><div class="ok-titulo">${corrigido ? "CORREÇÃO ENVIADA" : "REGISTRO ENVIADO"}</div><div class="ok-tipo">${tipoTxt}</div><div class="ok-num">${esc(numTxt)}</div><p class="peq">Guarde este número. Se precisar, informe-o ao responsável.</p></div>`
      : `<div class="ok-grande pend"><div class="ok-icone">📥</div><div class="ok-titulo">AINDA NÃO ENVIADO</div><div class="ok-tipo">${S.okErro ? esc(S.okErro) : "Salvo só neste celular. Será enviado sozinho quando houver sinal."}</div>${online() ? '<button class="pri" data-act="sincronizar" style="margin-top:.8rem">Enviar agora</button>' : ""}<p class="peq">Só vale como enviado quando aparecer o número do registro.</p></div>`;
    return `${barra()}${caixa}${S.okReg ? `<div class="card">${resumo(S.tipo, S.okReg)}</div>` : ""}
      <p class="peq">${S.tipo === "manutencao" ? 'Acompanhe o relato e as evidências em <b>Manutenção</b>.' : 'Errou algo? Em <b>Meus registros</b> você corrige ou cancela enquanto ele não for aprovado.'}</p>
      <button class="pri" data-act="ir" data-t="${S.tipo}">➕ Fazer outro registro</button><div style="height:.6rem"></div><button data-act="ir" data-t="home">🏠 Início</button>`;
  }
  const STATUS = { pendente: "🟡 Aguardando conferência", aprovado: "🟢 Aprovado", rejeitado: "🔴 Devolvido para correção", cancelado: "⚫ Cancelado" };
  function resumo(tipo, r) {
    if (tipo === "local") return `<b>📍 Localização</b><br>${esc(r.cliente)} · precisão ${esc(r.precisao_m)} m`;
    if (tipo === "manutencao") return `<b>🔧 Manutenção</b><br>${esc(r.placa || "")} · ${esc(CATEGORIAS[r.categoria] || r.categoria)}<br>${esc(CRITICIDADES[r.criticidade] || r.criticidade)}`;
    return tipo === "abast"
      ? `<b>⛽ Abastecimento</b> · ${brData(r.data_abast)}<br>${esc(r.placa)} · ${esc(r.combustivel)} · R$ ${num(r.valor_total)} · odômetro ${fmtInt(r.odometro)}`
      : `<b>📦 Coleta</b> · ${brData(r.data_coleta)}<br>${esc(r.placa)} · ${esc(r.cliente || "sem cliente")}<br>Coletou: 20 L × ${r.qtd_20} · 60 L × ${r.qtd_60} · 200 L × ${r.qtd_200}${(r.qtd_ent_20 || 0) + (r.qtd_ent_60 || 0) + (r.qtd_ent_200 || 0) ? `<br>Deixou: 20 L × ${r.qtd_ent_20 || 0} · 60 L × ${r.qtd_ent_60 || 0} · 200 L × ${r.qtd_ent_200 || 0}` : ""}`;
  }
  const mapsUrl = l => `https://www.google.com/maps/dir/?api=1&destination=${l.latitude},${l.longitude}`;
  const wazeUrl = l => `https://waze.com/ul?ll=${l.latitude},${l.longitude}&navigate=yes`;
  function navCliente(nome) {
    const l = S.locais && S.locais[String(nome || "").trim()];
    return l ? `<div class="linha" style="margin-top:.5rem"><a class="btn pri" href="${mapsUrl(l)}" target="_blank" rel="noopener">🧭 Como chegar</a><a class="btn" href="${wazeUrl(l)}" target="_blank" rel="noopener">Waze</a></div>` : "";
  }
  function atualizarNav() {
    const n = $("#nav_cli"), sel = $("#co_cli"); if (!n || !sel) return;
    n.innerHTML = navCliente(sel.value === OUTRO ? $("#co_cli_txt").value : sel.value);
  }
  function vClientes() {
    const nomes = ((S.listas && S.listas.clientes) || []).slice().sort((a, b) => a.localeCompare(b, "pt-BR"));
    const cartoes = nomes.map(n => {
      const l = S.locais[n];
      return `<div class="card cli" data-b="${esc(semAcento(n))}"><b>${esc(n)}</b>${l ? '<span class="chip ok">📍 localizado</span>' : '<span class="chip off">sem localização</span>'}
        ${l ? `<div class="linha" style="margin-top:.5rem"><a class="btn pri" href="${mapsUrl(l)}" target="_blank" rel="noopener">🧭 Google Maps</a><a class="btn" href="${wazeUrl(l)}" target="_blank" rel="noopener">Waze</a></div>` : ""}
        <button data-act="marcar-cli" data-n="${esc(n)}" style="margin-top:.5rem">📍 ${l ? "Atualizar" : "Marcar"} localização aqui</button><div class="mloc"></div></div>`;
    }).join("");
    return `${barra()}<button data-act="ir" data-t="home" style="width:auto;min-height:2.6rem">← Início</button><h2>🧭 Clientes</h2>
      <input id="cl_busca" type="search" placeholder="🔎 Buscar cliente" autocomplete="off">
      ${cartoes || '<p class="peq">Nenhum cliente na lista ainda. Use o campo abaixo para marcar o primeiro.</p>'}
      <h2>➕ Cliente novo</h2><p class="peq">Está no local de um cliente que ainda não está na lista? Digite o nome e marque.</p>
      <input id="cl_novo" placeholder="Nome do cliente" autocomplete="off"><button data-act="marcar-novo" style="margin-top:.5rem">📍 Marcar localização aqui</button><div id="cl_novo_msg"></div>
      <p class="peq">O escritório confere a localização antes de ela valer para todos. O GPS só é lido quando você toca no botão.</p>`;
  }
  function graf(pts, fmt, baixo) {
    if (!pts.length) return '<p class="peq">Sem dados no período.</p>';
    const mx = Math.max(...pts.map(p => p.v)) || 1;
    return `<div class="dre-graf">${pts.map(p => `<div class="dre-col${baixo && baixo(p.v) ? " baixo" : ""}"><em>${fmt(p.v)}</em><i style="height:${Math.max(3, p.v / mx * 80)}%"></i></div>`).join("")}</div><div class="dre-eixo">${pts.map(p => `<span>${esc(p.rot)}</span>`).join("")}</div>`;
  }
  function vDre() {
    const dias = S.dreDias || 30, desde = diasAtras(dias);
    const cab = `${barra()}<button data-act="ir" data-t="home" style="width:auto;min-height:2.6rem">← Início</button><h2>📊 Meu painel</h2>
      <div class="dre-per">${[7, 30].map(d => `<button data-act="dre-dias" data-d="${d}" class="${dias === d ? "on" : ""}">Últimos ${d} dias</button>`).join("")}</div>`;
    if (S.meus == null) return `${cab}<div class="info">${esc(S.meusErro || "Carregando…")}</div>`;
    const vale = r => ["pendente", "aprovado"].includes(r.status), N = x => Number(x) || 0, soma = (l, f) => l.reduce((t, r) => t + N(r[f]), 0);
    const ab = S.meus.filter(r => r._tipo === "abast" && vale(r) && String(r.data_abast) >= desde)
      .sort((a, b) => String(a.data_abast).localeCompare(String(b.data_abast)) || String(a.criado_em).localeCompare(String(b.criado_em)));
    const co = S.meus.filter(r => r._tipo === "coleta" && vale(r) && String(r.data_coleta) >= desde);
    if (!ab.length && !co.length) return `${cab}<div class="info">Nenhum registro enviado neste período.</div>`;
    const gasto = soma(ab, "valor_total"), litros = soma(ab, "litros"), peso = soma(co, "peso_liquido");
    const cKm = ab.filter(r => N(r.km_rodados) > 0), km = soma(cKm, "km_rodados"), lKm = soma(cKm, "litros");
    const cons = lKm ? km / lKm : null, custoKm = km ? soma(cKm, "valor_total") / km : null;
    const kpi = (v, t) => `<div><b>${v}</b><span>${t}</span></div>`, tr = v => v == null ? "—" : v;
    const porDia = {}; ab.forEach(r => { porDia[r.data_abast] = (porDia[r.data_abast] || 0) + N(r.valor_total); });
    const gDia = Object.keys(porDia).sort().slice(-15).map(d => ({ rot: brData(d).slice(0, 2), v: porDia[d] }));
    const gCons = ab.filter(r => N(r.consumo) > 0).slice(-15).map(r => ({ rot: brData(String(r.data_abast)).slice(0, 2), v: N(r.consumo) }));
    const pl = {}; ab.forEach(r => { const p = pl[r.placa] = pl[r.placa] || { g: 0, l: 0, km: 0, lk: 0 }; p.g += N(r.valor_total); p.l += N(r.litros); if (N(r.km_rodados) > 0) { p.km += N(r.km_rodados); p.lk += N(r.litros); } });
    const linhasPl = Object.keys(pl).map(k => `<tr><td>${esc(k)}</td><td>R$ ${num(pl[k].g)}</td><td>${num(pl[k].l, 1)} L</td><td>${pl[k].lk ? num(pl[k].km / pl[k].lk, 1) : "—"}</td></tr>`).join("");
    const ult = ab.slice().reverse().slice(0, 10).map(r => `<tr><td>${brData(String(r.data_abast)).slice(0, 5)}</td><td>${esc(r.posto || "")}</td><td>R$ ${num(r.valor_total)}</td><td>${N(r.consumo) > 0 ? num(r.consumo, 1) : "—"}</td></tr>`).join("");
    return `${cab}
      <h2>Resumo (DRE)</h2>
      <div class="dre-kpi">${kpi("R$ " + num(gasto), "Gasto combustível")}${kpi(num(litros, 1) + " L", "Litros")}${kpi(litros ? "R$ " + num(gasto / litros) : "—", "Preço médio/L")}</div>
      <div class="dre-kpi">${kpi(km ? fmtInt(km) + " km" : "—", "Km rodados")}${kpi(tr(cons == null ? null : num(cons, 1)), "Rendimento km/L")}${kpi(custoKm == null ? "—" : "R$ " + num(custoKm), "Custo por km")}</div>
      <div class="dre-kpi">${kpi(co.length, "Coletas")}${kpi(peso ? num(peso, 0) + " kg" : "—", "Peso líquido")}${kpi(peso ? "R$ " + num(gasto / peso) : "—", "Combustível por kg")}</div>
      <h2>Gasto por dia (R$)</h2>${graf(gDia, v => fmtInt(v))}
      <h2>Rendimento (km/L)</h2>${graf(gCons, v => num(v, 1), v => cons && v < cons * 0.9)}<p class="peq">Barra amarela = abaixo da sua média.</p>
      <h2>Por veículo</h2><div style="overflow-x:auto"><table class="dre-tab"><tr><th>Placa</th><th>Gasto</th><th>Litros</th><th>km/L</th></tr>${linhasPl}</table></div>
      <h2>Últimos abastecimentos</h2><div style="overflow-x:auto"><table class="dre-tab"><tr><th>Data</th><th>Posto</th><th>Valor</th><th>km/L</th></tr>${ult}</table></div>
      <p class="peq">Considera os registros já enviados (aguardando conferência ou aprovados) nos últimos ${dias} dias. Não inclui registros ainda salvos só no celular.</p>`;
  }
  function vMeus() {
    const fila = (S._fila || []).filter(i => i.motorista === S.sessao.nome);
    const locais = fila.map(i => `<div class="card">${resumo(i.tipo, Object.assign({ placa: i.placa }, i.reg))}<div class="st">📥 ${i.servidor_id ? "Evidências aguardando envio" : "Aguardando envio"}</div>${i.erro ? `<div class="erro">${esc(i.erro)}</div>` : ""}
      <div class="linha">${i.tipo === "local" || i.tipo === "manutencao" ? "" : `<button data-act="corrigir-fila" data-id="${i.id_cliente}">✏️ Corrigir</button>`}${i.tipo === "manutencao" && i.servidor_id ? "" : `<button class="perigo" data-act="excluir-fila" data-id="${i.id_cliente}">🗑️ Excluir</button>`}</div></div>`).join("");
    let servidor;
    if (S.meus == null) servidor = `<div class="info">${esc(S.meusErro || "Carregando…")}</div>`;
    else if (!S.meus.length) servidor = '<p class="peq">Nenhum registro enviado nos últimos 30 dias.</p>';
    else servidor = S.meus.map(r => `<div class="card">${resumo(r._tipo, r)}<div class="st">${STATUS[r.status] || esc(r.status)}</div>${r.status === "rejeitado" && r.motivo ? `<div class="erro">Motivo: ${esc(r.motivo)}</div>` : ""}
      ${["pendente", "rejeitado"].includes(r.status) ? `<div class="linha"><button data-act="corrigir-srv" data-id="${r.id}" data-t="${r._tipo}">✏️ Corrigir</button><button class="perigo" data-act="cancelar-srv" data-id="${r.id}" data-t="${r._tipo}">🗑️ Cancelar</button></div>` : ""}</div>`).join("");
    return `${barra()}<button data-act="ir" data-t="home" style="width:auto;min-height:2.6rem">← Início</button><h2>📋 Meus registros</h2><div id="msg"></div>
      ${locais ? `<h2>No celular (ainda não enviados)</h2>${locais}` : ""}<h2>Já enviados (últimos 30 dias)</h2>${servidor}`;
  }
  function vFrota() {
    const avisoAbast = S.ultimosAbastErro ? `<div class="aviso">${esc(S.ultimosAbastErro)}</div>` : "";
    const veiculos = ((S.listas && S.listas.veiculos) || []).slice().sort((a, b) => a.placa.localeCompare(b.placa, "pt-BR"));
    const opcoesAbast = veiculos.length
      ? `<label for="abast_veiculo">Caminhão</label><select id="abast_veiculo"><option value="">— escolha um caminhão —</option>${veiculos.map(v => `<option value="${esc(v.placa)}" ${S.abastVeiculo === v.placa ? "selected" : ""}>${esc(v.tipo ? `${v.tipo} · ` : "")}${esc(v.placa)}</option>`).join("")}</select>`
      : '<p class="peq">Não há veículos cadastrados para selecionar.</p>';
    let abast;
    if (S.ultimosAbast == null) abast = `<div class="info">${esc(S.ultimosAbastErro || (S.ultimosAbastCarregando ? "Carregando histórico…" : "Histórico indisponível."))}</div>`;
    else if (!S.abastVeiculo) abast = '<p class="peq">Selecione um veículo para consultar os abastecimentos.</p>';
    else {
      const desde = diasAtras(S.abastDias), todos = S.ultimosAbast
        .filter(r => r.placa === S.abastVeiculo)
        .sort((a, b) => String(b.data_abast).localeCompare(String(a.data_abast)) || String(b.criado_em || "").localeCompare(String(a.criado_em || "")));
      const registros = todos.filter(r => String(r.data_abast) >= desde);
      const fora = !registros.length && todos.length > 0;
      const exibidos = fora ? todos.slice(0, 1) : registros;
      abast = `${avisoAbast}<div class="dre-per abast-periodo">${[7, 30].map(d => `<button data-act="abast-dias" data-d="${d}" class="${S.abastDias === d ? "on" : ""}">Últimos ${d} dias</button>`).join("")}</div>
        ${fora ? `<div class="info">Nenhum abastecimento nos últimos ${S.abastDias} dias. Último conhecido, fora do período selecionado:</div>` : ""}
        ${exibidos.length ? `<div class="abast-historico">${exibidos.map(r => `<div class="card abast-hist-card">
            <div class="abast-hist-top"><b>${brData(String(r.data_abast))}</b><span>${STATUS[r.status] || esc(r.status)}</span></div>
            <div><b>${esc(r.motorista)}</b> abasteceu ${esc(r.combustivel)}${r.posto ? ` no ${esc(r.posto)}` : ""}.</div>
            <div class="abast-hist-dados"><span><b>${num(r.litros, 1)} L</b><small>Quantidade</small></span><span><b>${fmtInt(r.odometro)} km</b><small>Odômetro</small></span><span><b>R$ ${num(r.valor_total)}</b><small>Valor total</small></span></div>
          </div>`).join("")}</div>` : `<p class="peq">Nenhum abastecimento nos últimos ${S.abastDias} dias para este veículo.</p>`}`;
    }
    return `${barra()}<button data-act="ir" data-t="home" style="width:auto;min-height:2.6rem">← Início</button><h2>🚚 Registros da Frota</h2>
      <p class="peq">Consulte os abastecimentos feitos por qualquer motorista. Escolha um veículo e o período.</p>${opcoesAbast}
      ${abast}`;
  }

  function render() {
    const v = { login: vLogin, turnos: vTurnos, home: vHome, meus: vMeus, frota: vFrota, dre: vDre, clientes: vClientes, manutencoes: vManutencoes }[S.tela]
      || (S.tela === "abast" ? (S.fase === "form" ? vAbast : S.fase === "confirmar" ? vConfAbast : vOk)
        : S.tela === "coleta" ? (S.fase === "form" ? vColeta : S.fase === "confirmar" ? vConfColeta : vOk)
        : S.tela === "manutencao" ? (S.fase === "form" ? vManutencao : S.fase === "confirmar" ? vConfManutencao : vOk) : vHome);
    app().innerHTML = v(); aplicarMascaras(app()); ["ab", "co", "ma"].forEach(pintarFotos);
  }
  const msg = (html, tipo) => { const m = $("#msg"); if (m) m.innerHTML = html ? `<div class="${tipo || "erro"}">${html}</div>` : ""; };

  // ============================ ações ============================
  function limparFluxo() { S.rasc = null; S.fotos = []; S.anexos = []; S.edit = null; S.fase = "form"; S.okMsg = ""; }
  async function carregarTurnos() {
    S.turnos = null; S.turnoErro = ""; render();
    const data = S.turnoData || hoje(), chave = `turnos:${S.sessao.nome}:${data}`;
    const sessao = S.sessao;
    try {
      const turnos = await rpc("app_turnos", { p_token: token(), p_data: data });
      if (!Array.isArray(turnos)) throw new Error("Resposta inválida dos turnos.");
      await idb.put("cache", { k: chave, v: turnos });
      if (S.sessao !== sessao || S.turnoData !== data) return;
      S.turnos = turnos;
    } catch (e) {
      if (S.sessao !== sessao || S.turnoData !== data) return;
      if (e.message === "sessao_invalida") return sessaoExpirada();
      const cache = e.rede ? await idb.get("cache", chave) : null;
      S.turnos = cache ? cache.v : [];
      S.turnoErro = cache ? "Sem sinal: mostrando turnos salvos anteriormente, sujeitos a alteração." : msgErro(e);
    }
    if (S.tela === "turnos") render();
  }
  async function carregarManutencoes() {
    S.manutencoes = null; S.historico = null; S.manutErro = ""; render();
    try {
      const [relatos, historico] = await Promise.all([
        rpc("app_manutencoes", { p_token: token() }),
        rpc("app_historico_manutencao", { p_token: token(), p_placa: S.turno.placa })
      ]);
      if (!Array.isArray(relatos) || !Array.isArray(historico)) throw new Error("Resposta inválida do histórico.");
      S.manutencoes = relatos; S.historico = historico.slice(0, 5);
    } catch (e) {
      if (e.message === "sessao_invalida") return sessaoExpirada();
      S.manutErro = e.rede ? "Sem sinal: conecte-se para consultar relatos e histórico." : msgErro(e);
    }
    if (S.tela === "manutencoes") render();
  }
  async function carregarMeus() {
    try { S.meus = await rpc("app_meus", { p_token: token() }); S.meusErro = ""; }
    catch (e) { S.meus = null; S.meusErro = e.rede ? "Sem sinal: não consigo buscar os registros já enviados." : msgErro(e); if (!e.rede && e.message === "sessao_invalida") sessaoExpirada(); }
  }
  async function carregarUltimosAbast() {
    if (!online()) {
      S.ultimosAbastErro = S.ultimosAbast == null
        ? "Sem sinal: o histórico será carregado quando houver conexão."
        : "Sem sinal: mostrando histórico salvo localmente, que pode estar desatualizado.";
      return;
    }
    S.ultimosAbastCarregando = true;
    try {
      const dados = await rpc("app_ultimos_abastecimentos", { p_token: token() });
      S.ultimosAbast = Array.isArray(dados) ? dados : [];
      S.ultimosAbastErro = "";
      await idb.put("cache", { k: "ultimos-abastecimentos", v: S.ultimosAbast });
    } catch (e) {
      S.ultimosAbastErro = e.rede
        ? "Sem sinal: não foi possível atualizar o histórico."
        : "Não foi possível carregar o histórico. Confirme se a função SQL do histórico foi instalada.";
      if (!e.rede && e.message === "sessao_invalida") sessaoExpirada();
    } finally { S.ultimosAbastCarregando = false; }
  }
  async function irPara(t) {
    limparFluxo(); S.syncMsg = null; S.tela = t; S.tipo = (t === "abast" || t === "coleta" || t === "manutencao") ? t : S.tipo;
    S._fila = await contarFila();
    if (t === "manutencoes") { await carregarManutencoes(); return; }
    if (t === "meus" || t === "dre" || t === "frota") {
      if (t === "meus" || t === "dre") {
        S.meus = null; S.meusErro = online() ? "Carregando…" : "Sem sinal: não consigo buscar os registros já enviados.";
      }
      if (t === "frota") {
        S.ultimosAbastErro = online() ? "" : (S.ultimosAbast == null
          ? "Sem sinal: o histórico será carregado quando houver conexão."
          : "Sem sinal: mostrando histórico salvo localmente, que pode estar desatualizado.");
        S.ultimosAbastCarregando = online();
      }
      render();
      if (t === "meus" || t === "dre") await carregarMeus();
      if (t === "frota") await carregarUltimosAbast();
    }
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
    if (S.fotos.length + fotosExistentes() === 0) erros.push("Tire pelo menos 1 foto do comprovante (ou escolha da galeria).");
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
    const e = { 20: parseInt(g("co_e20").value, 10) || 0, 60: parseInt(g("co_e60").value, 10) || 0, 200: parseInt(g("co_e200").value, 10) || 0 };
    const pesoTxt = g("co_peso").value.trim(); let peso = 0;
    if (!placa) erros.push("Selecione a placa."); if (!data) erros.push("Informe a data.");
    if (q[20] + q[60] + q[200] + e[20] + e[60] + e[200] === 0) erros.push("Informe ao menos uma bombona coletada ou entregue.");
    if ([...Object.values(q), ...Object.values(e)].some(v => v < 0 || v > 500)) erros.push("Quantidade de bombonas inválida.");
    if (pesoTxt) { peso = parseNum(pesoTxt); if (!peso || peso <= 0) { erros.push("Peso inválido. Digite só números (ex.: 245,5) ou deixe em branco."); peso = 0; } }
    const tara = round2(q[20] * TARAS[20] + q[60] * TARAS[60] + q[200] * TARAS[200]);
    if (peso && peso < tara) erros.push(`O peso na balança (${fmtDec(peso)} kg) é menor que a tara das bombonas (${fmtDec(tara)} kg). Confira os números.`);
    [[20, 40], [60, 25], [200, 10]].forEach(([k, lim]) => { if (q[k] > lim) alertas.push(`${q[k]} bombonas de ${k} L coletadas é bastante. Confira a quantidade.`); if (e[k] > lim) alertas.push(`${e[k]} bombonas de ${k} L entregues é bastante. Confira a quantidade.`); });
    if (sel === OUTRO && cliente && !(S.listas.clientes || []).includes(cliente)) alertas.push("Cliente novo (não está na lista): " + cliente);
    return { erros, rasc: { placa, cliente: cliente || null, data_coleta: data, qtd_20: q[20], qtd_60: q[60], qtd_200: q[200], qtd_ent_20: e[20], qtd_ent_60: e[60], qtd_ent_200: e[200], peso_bruto: peso, tara, observacoes: g("co_obs").value.trim() || null, alertas } };
  }
  const payload = (tipo, r) => tipo === "abast"
    ? { placa: r.placa, combustivel: r.combustivel, data_abast: r.data_abast, posto: r.posto, valor_total: r.valor_total, valor_litro: r.valor_litro, odometro: r.odometro }
    : { placa: r.placa, cliente: r.cliente, data_coleta: r.data_coleta, qtd_20: r.qtd_20, qtd_60: r.qtd_60, qtd_200: r.qtd_200, qtd_ent_20: r.qtd_ent_20 || 0, qtd_ent_60: r.qtd_ent_60 || 0, qtd_ent_200: r.qtd_ent_200 || 0, peso_bruto: r.peso_bruto, observacoes: r.observacoes };

  async function salvar() {
    if (!$("#cf_ok").checked) return msg("Marque a confirmação para continuar.");
    const btn = $("#btn_salvar"); btn.disabled = true;
    const tipo = S.tipo, r = S.rasc;
    try {
      if (S.edit && S.edit.origem === "servidor") {
        await rpc("app_corrigir", { p_token: token(), p_tabela: tipo, p_id: S.edit.id, p_reg: payload(tipo, r), p_foto: null, p_fotos: S.fotos });
        S.okMsg = "✅ Correção enviada!"; S.okNum = S.edit.id; S.okReg = payload(tipo, r); S.okIdc = null; S.okErro = "";
      } else {
        const id = S.edit && S.edit.origem === "fila" ? S.edit.id : uuid();
        await idb.put("fila", { id_cliente: id, tipo, motorista: S.sessao.nome, registrado_em: (S.edit && S.edit.registrado_em) || new Date().toISOString(), reg: payload(tipo, r), fotos: S.fotos.slice(), erro: null });
        S.okIdc = id; S.okNum = null; S.okReg = payload(tipo, r);
        S._fila = await contarFila(); await sincronizar();
        const ainda = await idb.get("fila", id);
        S.okErro = ainda ? (ainda.erro || "") : ""; if (!ainda) { S.okNum = S.protocolos[id] !== undefined ? S.protocolos[id] : "dup"; S.okIdc = null; }
        S.okMsg = ainda ? "📥 Salvo no celular! Será enviado automaticamente quando houver sinal." : "✅ Enviado!";
      }
      S.fase = "ok"; S._fila = await contarFila(); render();
    } catch (e) { btn.disabled = false; msg(esc(msgErro(e)) + (e.rede ? " A correção de um registro já enviado precisa de internet." : "")); if (!e.rede && e.message === "sessao_invalida") sessaoExpirada(); }
  }
  async function salvarManutencao() {
    if (!$("#cf_ok").checked) return msg("Marque a confirmação para continuar.");
    const btn = $("#btn_salvar"); btn.disabled = true;
    const id = uuid(), r = S.rasc;
    try {
      await idb.put("fila", { id_cliente: id, tipo: "manutencao", motorista: S.sessao.nome, registrado_em: new Date().toISOString(), placa: S.turno.placa, reg: r, anexos: S.anexos.slice(), erro: null });
      S.okIdc = id; S.okNum = null; S.okReg = Object.assign({ placa: S.turno.placa }, r); S.okErro = "";
      S._fila = await contarFila(); await sincronizar();
      const ainda = await idb.get("fila", id);
      if (ainda) S.okErro = ainda.erro || (ainda.servidor_id ? "Relato enviado; evidências ainda aguardam envio." : "");
      else { S.okNum = S.protocolos[id]; S.okIdc = null; }
      if (S.sessao) { S.fase = "ok"; render(); }
    } catch (e) { btn.disabled = false; msg(esc(e.message || "Não foi possível guardar o relato no celular.")); }
  }
  function abrirEdicao(tipo, r, edit, fotos) { limparFluxo(); S.tela = tipo; S.tipo = tipo; S.rasc = r; S.edit = edit; S.fotos = fotos || []; S.fase = "form"; render(); }

  const acoes = {
    async entrar() {
      const nome = $("#lg_nome").value, pin = $("#lg_pin").value;
      if (!nome) return msg("Selecione o seu nome."); if (!/^\d{4,6}$/.test(pin)) return msg("Digite o seu PIN (4 a 6 números).");
      if (!online()) return msg("Sem sinal. Para entrar pela primeira vez é preciso estar com internet.");
      try {
        const r = await rpc("app_login", { p_nome: nome, p_pin: pin });
        if (!r.ok) return msg(esc(r.msg));
        S.sessao = { token: r.token, nome: r.nome }; gravarSessao(S.sessao, $("#lg_manter").checked); S.aviso = "";
        await atualizarListas(); if (!S.sessao) return;
        S._fila = await contarFila(); S.turno = null; S.turnoData = hoje(); S.tela = "turnos"; await carregarTurnos(); sincronizar();
      } catch (e) { msg(esc(msgErro(e))); }
    },
    async trocar() {
      if (S.sync) { alert("Aguarde o envio terminar antes de trocar de motorista."); return; }
      await contarFila();
      if (S.filaN && !confirm(`Você tem ${S.filaN} registro(s) ainda não enviados. Se trocar agora, eles ficam guardados no celular até você entrar de novo com sinal. Trocar mesmo assim?`)) return;
      limparSessao(); S.sessao = null; S.turno = null; S.turnos = null; S.tela = "login"; limparFluxo(); S.aviso = ""; render();
    },
    async "recarregar-turnos"() { await carregarTurnos(); },
    "selecionar-turno"() {
      const turno = (S.turnos || []).find(t => String(t.id) === $("#turno").value);
      if (!turno) return msg("Selecione seu turno.");
      S.turno = turno; S.abastVeiculo = turno.placa; S.tela = "home"; render();
    },
    async "trocar-turno"() { limparFluxo(); S.turno = null; S.turnoData = hoje(); S.tela = "turnos"; await carregarTurnos(); },
    async "atualizar-manutencoes"() { await carregarManutencoes(); },
    "rm-anexo"(a) { S.anexos.splice(Number(a.dataset.i), 1); $("#ma_anexos").innerHTML = listarAnexos(); },
    "validar-manutencao"() {
      if (S.anexoCarregando) return msg("Aguarde a verificação do arquivo.");
      const odometro = parseIntBR($("#ma_odo").value), horimetro = parseNum($("#ma_hora").value);
      const categoria = $("#ma_cat").value, criticidade = $('input[name="criticidade"]:checked');
      const descricao = $("#ma_desc").value.trim(), erros = [];
      if (odometro == null || !Number.isSafeInteger(odometro)) erros.push("Informe o odômetro.");
      if (horimetro == null || !Number.isFinite(horimetro)) erros.push("Informe o horímetro.");
      if (!CATEGORIAS[categoria]) erros.push("Selecione o sistema.");
      if (!criticidade || !CRITICIDADES[criticidade.value]) erros.push("Selecione a criticidade.");
      if (!descricao) erros.push("Descreva o problema.");
      if (erros.length) return msg(erros.join("<br>"));
      S.rasc = { turno_id: S.turno.id, odometro, horimetro, categoria, criticidade: criticidade.value, descricao }; S.fase = "confirmar"; render();
    },
    "salvar-manutencao"() { return salvarManutencao(); },
    ir(a) { irPara(a.dataset.t); },
    "dre-dias"(a) { S.dreDias = Number(a.dataset.d); render(); },
    "abast-dias"(a) { S.abastDias = Number(a.dataset.d); render(); },
    "marcar-cli"(a) { return acaoMarcar(a.dataset.n, a, a.closest(".card").querySelector(".mloc")); },
    "marcar-novo"(a) { return acaoMarcar($("#cl_novo").value, a, $("#cl_novo_msg")); },
    "marcar-coleta"(a) { const sel = $("#co_cli").value; return acaoMarcar(sel === OUTRO ? $("#co_cli_txt").value : sel, a, $("#msg_loc")); },
    sincronizar() { sincronizar(true); },
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
    "rm-foto"(a) { S.fotos.splice(Number(a.dataset.i), 1); pintarFotos(a.dataset.pref); msg(""); },
    salvar() { salvar(); },
    async "corrigir-fila"(a) {
      const it = (await idb.get("fila", a.dataset.id)); if (!it) return;
      abrirEdicao(it.tipo, Object.assign({}, it.reg), { origem: "fila", id: it.id_cliente, registrado_em: it.registrado_em }, it.fotos || (it.foto ? [it.foto] : []));
    },
    async "excluir-fila"(a) {
      if (S.sync) return msg("Aguarde o envio terminar para excluir.");
      if (!confirm("Excluir este registro do celular? Ele não será enviado.")) return;
      await idb.del("fila", a.dataset.id); S._fila = await contarFila(); render();
    },
    "corrigir-srv"(a) {
      const r = (S.meus || []).find(x => String(x.id) === a.dataset.id && x._tipo === a.dataset.t); if (!r) return;
      const base = a.dataset.t === "abast"
        ? { placa: r.placa, combustivel: r.combustivel, data_abast: r.data_abast, posto: r.posto, valor_total: Number(r.valor_total), valor_litro: Number(r.valor_litro), odometro: Number(r.odometro) }
        : { placa: r.placa, cliente: r.cliente, data_coleta: r.data_coleta, qtd_20: r.qtd_20, qtd_60: r.qtd_60, qtd_200: r.qtd_200, qtd_ent_20: r.qtd_ent_20 || 0, qtd_ent_60: r.qtd_ent_60 || 0, qtd_ent_200: r.qtd_ent_200 || 0, peso_bruto: Number(r.peso_bruto), observacoes: r.observacoes };
      abrirEdicao(a.dataset.t, base, { origem: "servidor", id: Number(r.id), fotosExistentes: (r.fotos && r.fotos.length) || (r.foto_path ? 1 : 0) });
    },
    async "cancelar-srv"(a) {
      if (!confirm("Cancelar este registro?")) return;
      try {
        await rpc("app_cancelar", { p_token: token(), p_tabela: a.dataset.t, p_id: Number(a.dataset.id) });
        await carregarMeus();
        if (a.dataset.t === "abast") await carregarUltimosAbast();
        render();
      }
      catch (e) { msg(esc(msgErro(e))); if (!e.rede && e.message === "sessao_invalida") sessaoExpirada(); }
    }
  };

  document.addEventListener("click", ev => {
    const a = ev.target.closest("[data-act]"); if (!a || a.tagName === "SELECT") return;
    ev.preventDefault(); const f = acoes[a.dataset.act]; if (f) f(a);
  });
  document.addEventListener("input", ev => {
    if (ev.target.id === "co_cli_txt") return atualizarNav();
    if (ev.target.id !== "cl_busca") return;
    const q = semAcento(ev.target.value.trim());
    document.querySelectorAll(".card.cli").forEach(c => { c.style.display = !q || c.dataset.b.includes(q) ? "" : "none"; });
  });
  document.addEventListener("change", async ev => {
    const el = ev.target;
    if (el.id === "turno_data") { if (el.value) { S.turnoData = el.value; await carregarTurnos(); } return; }
    if ((el.id === "ma_fotos" || el.id === "ma_video") && el.files && el.files.length) {
      if (S.anexoCarregando) { el.value = ""; return msg("Aguarde a verificação do arquivo anterior."); }
      const video = el.id === "ma_video", arquivos = Array.from(el.files); el.disabled = true;
      S.anexoCarregando = true;
      try {
        for (const f of arquivos) {
          if (video ? S.anexos.some(a => a.tipo === "video") : S.anexos.filter(a => a.tipo === "foto").length >= MAX_FOTOS) throw new Error(video ? "Remova o vídeo anterior antes de adicionar outro." : "Limite de 5 fotos por relato.");
          const permitidos = video ? ["video/mp4", "video/webm", "video/quicktime"] : ["image/jpeg", "image/png", "image/webp"];
          if (!permitidos.includes(f.type)) throw new Error("Formato de arquivo não aceito. Use JPEG, PNG, WebP, MP4, WebM ou MOV.");
          if (!f.size || f.size > (video ? 20 : 5) * 1024 * 1024) throw new Error(video ? "O vídeo deve ter até 20 MiB." : "Cada foto deve ter até 5 MiB.");
          if (video) await duracaoVideo(f);
          if (S.tela !== "manutencao" || S.fase !== "form") throw new Error("Volte ao relato para adicionar a evidência.");
          S.anexos.push({ id: uuid(), tipo: video ? "video" : "foto", mime: f.type, nome: f.name, blob: f, proximo: 0 });
        }
        msg("");
      } catch (e) { msg(esc(e.message)); }
      finally { S.anexoCarregando = false; el.value = ""; el.disabled = false; const lista = $("#ma_anexos"); if (lista) lista.innerHTML = listarAnexos(); }
      return;
    }
    if (el.id === "abast_veiculo") { S.abastVeiculo = el.value; render(); }
    if (el.tagName === "SELECT" && el.dataset.act === "outro") { const t = $("#" + el.dataset.alvo); if (t) { t.style.display = el.value === OUTRO ? "" : "none"; if (el.value === OUTRO) t.focus(); } }
    if (el.id === "co_cli") atualizarNav();
    if (el.id === "cf_ok") { const b = $("#btn_salvar"); if (b) b.disabled = !el.checked; }
    if (el.type === "file" && el.files && el.files.length) {
      const pref = el.id.split("_")[0]; let ignoradas = 0, erro = "";
      for (const f of Array.from(el.files)) {
        if (fotosExistentes() + S.fotos.length >= MAX_FOTOS) { ignoradas++; continue; }
        try { S.fotos.push(await processarFoto(f)); } catch (e) { erro = e.message; }
      }
      pintarFotos(pref);
      if (erro) msg(esc(erro)); else if (ignoradas) msg(`Limite de ${MAX_FOTOS} fotos por registro: ${ignoradas} não foram adicionadas.`, "aviso"); else msg("");
      el.value = "";
    }
  });
  window.addEventListener("online", async () => { if (S.sessao) { atualizarListas(); sincronizar(); if (S.tela === "frota") await carregarUltimosAbast(); } else if (S.tela === "login") await carregarNomes(); if (["home", "meus", "frota", "login"].includes(S.tela)) render(); });
  window.addEventListener("offline", () => { if (["home", "meus", "frota", "login"].includes(S.tela)) render(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.sessao) sincronizar(); });
  setInterval(() => { if (S.sessao && S.filaN && online()) sincronizar(); }, 30000);

  // ============================ início ============================
  const CSS_EXTRA = `#btn_salvar{background:#1f7a4d!important;border-color:#1f7a4d!important;color:#fff!important}
#btn_salvar:disabled{background:#c9ced3!important;border-color:#c9ced3!important;color:#6b7280!important;cursor:not-allowed}
.ok-grande{text-align:center;background:var(--okBg);border:2px solid var(--ok);border-radius:16px;padding:1.4rem 1rem;margin:.8rem 0;color:var(--ok)}
.ok-grande.pend{background:var(--warnBg);border-color:var(--warn);color:var(--warn)}
.ok-icone{font-size:3.4rem;line-height:1}.ok-titulo{font-size:1.5rem;font-weight:800;margin:.4rem 0}.ok-tipo{font-size:1rem}
.ok-num{font-size:2.8rem;font-weight:800;margin:.3rem 0}
.dre-per{display:flex;gap:.5rem;margin:.6rem 0}.dre-per button{flex:1;min-height:2.6rem}
.dre-per button.on{background:#1f7a4d!important;color:#fff!important;border-color:#1f7a4d!important}
.dre-kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin:.5rem 0}
.dre-kpi div{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:.6rem .3rem;text-align:center;color:var(--txt)}
.dre-kpi b{display:block;font-size:1rem}.dre-kpi span{font-size:.68rem;opacity:.75}
.dre-graf{display:flex;align-items:flex-end;gap:4px;height:140px;border-bottom:1px solid var(--bd);padding-top:.3rem}
.dre-col{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:0}
.dre-col i{display:block;width:100%;background:#1f7a4d;border-radius:4px 4px 0 0}.dre-col.baixo i{background:#d99a00}
.dre-col em{font-style:normal;font-size:.58rem;opacity:.8}
.dre-eixo{display:flex;gap:4px}.dre-eixo span{flex:1;text-align:center;font-size:.6rem;opacity:.7}
.dre-tab{width:100%;border-collapse:collapse;font-size:.88rem}.dre-tab td,.dre-tab th{padding:.35rem .3rem;border-bottom:1px solid var(--bd);text-align:right}
.dre-tab th:first-child,.dre-tab td:first-child{text-align:left}
.abast-historico{display:grid;gap:.2rem}
.abast-periodo{margin:.5rem 0}
.abast-hist-card{line-height:1.45}
.abast-hist-top{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
.abast-hist-top b{font-size:1.08rem}
.abast-hist-top span{color:var(--mut);font-size:.88rem}
.abast-hist-dados{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.45rem;margin-top:.7rem}
.abast-hist-dados span{background:var(--bg);border-radius:9px;padding:.5rem .3rem;text-align:center}
.abast-hist-dados b,.abast-hist-dados small{display:block}
.abast-hist-dados b{font-size:.95rem}
.abast-hist-dados small{color:var(--mut);font-size:.72rem}
.tema{display:block;width:auto;min-height:2.6rem;margin:calc(env(safe-area-inset-top,0px) + 8px) auto 0}`;
  async function iniciar() {
    document.head.appendChild(Object.assign(document.createElement("style"), { textContent: CSS_EXTRA }));
    const tema = $("#tema"), preferencia = window.matchMedia("(prefers-color-scheme: dark)");
    function aplicarTema() {
      const salvo = localStorage.getItem("frota_tema");
      const escuro = salvo === "escuro" || (salvo !== "claro" && preferencia.matches);
      document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
      tema.textContent = escuro ? "☀️ Tema claro" : "🌙 Tema escuro";
      tema.setAttribute("aria-label", escuro ? "Ativar tema claro" : "Ativar tema escuro");
    }
    tema.addEventListener("click", () => { localStorage.setItem("frota_tema", document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro"); aplicarTema(); });
    if (preferencia.addEventListener) preferencia.addEventListener("change", aplicarTema);
    else if (preferencia.addListener) preferencia.addListener(aplicarTema);
    aplicarTema();
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(() => { });
    const c = await idb.get("cache", "nomes"); S.nomes = c ? c.v : [];
    const lc = await idb.get("cache", "locais"); S.locais = lc ? lc.v : {};
    const la = await idb.get("cache", "ultimos-abastecimentos"); S.ultimosAbast = la ? la.v : null;
    S.sessao = lerSessao();
    if (S.sessao) { const l = await idb.get("cache", "listas"); if (l) S.listas = l.v; S._fila = await contarFila(); S.turnoData = hoje(); S.tela = "turnos"; await carregarTurnos(); if (S.sessao) { atualizarListas().then(() => { if (S.tela === "home") render(); }); sincronizar(); } }
    else render();
    await carregarNomes(); if (S.tela === "login") render();
  }
  window.__frota = { S, acoes, sincronizar, idb, iniciar };
  iniciar();
})();
