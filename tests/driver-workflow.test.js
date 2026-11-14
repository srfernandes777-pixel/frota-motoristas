"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function app(shared) {
  shared = shared || {};
  const elements = new Map();
  const controls = [];
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", value: "", checked: false, dataset: {}, querySelectorAll: query => selector === "#app" && query === "input,select,textarea" ? controls : [], setAttribute() {}, addEventListener() {}, click() { this.clicked = true; } });
    return elements.get(selector);
  }
  const listeners = {};
  const storage = map => ({ getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) });
  shared.local = shared.local || new Map(); shared.session = shared.session || new Map();
  shared.stores = shared.stores || { fila: new Map(), cache: new Map() };
  const context = {
    console, Blob, Uint8Array, Date, Math, JSON, Number, String, Object, Array, Promise, Error, AbortController,
    setTimeout, clearTimeout, setInterval() {}, localStorage: storage(shared.local), sessionStorage: storage(shared.session),
    navigator: { onLine: true }, location: { protocol: "file:" },
    document: { querySelector: element, querySelectorAll: () => [], addEventListener: (name, fn) => { listeners[name] = fn; }, documentElement: { dataset: {} }, head: { appendChild() {} }, createElement: () => ({}) },
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(b => { this.result = "data:application/octet-stream;base64," + Buffer.from(b).toString("base64"); this.onload(); }); } },
    fetch: async () => { throw new Error("offline"); }
  };
  context.window = { CONFIG: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_KEY: "test-key" }, crypto: context.crypto, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  let source = fs.readFileSync(process.env.FROTA_APP_SOURCE || "app.js", "utf8");
  source = source.replace("window.__frota = { S, acoes, sincronizar, idb, iniciar };", "window.__frota = { S, acoes, sincronizar, idb, iniciar, render, atualizarListas, carregarManutencoes, carregarMeus, guardarContexto };");
  source = source.replace("  iniciar();", "");
  vm.runInNewContext(source, context);
  const api = context.window.__frota, stores = shared.stores;
  api.idb.put = async (s, v) => { stores[s].set(v.id_cliente || v.k, structuredClone(v)); };
  api.idb.get = async (s, k) => structuredClone(stores[s].get(k));
  api.idb.all = async s => Array.from(stores[s].values(), v => structuredClone(v));
  api.idb.del = async (s, k) => stores[s].delete(k);
  api.S.sessao = { nome: "Ana", token: "token" };
  return { api, context, element, stores, listeners, controls, shared };
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

test("painel calcula indicadores ponderados e exclui dados fora do período ou sem distância", async () => {
  const { api, context, element } = app();
  const data = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const registro = (dias, campos = {}) => ({ _tipo: "abast", status: "aprovado", data_abast: data(dias), criado_em: "2026-01-01", placa: "ABC", posto: "Posto", ...campos });
  const dados = [
    registro(0, { valor_total: 100, valor_litro: 5, litros: 999, km_rodados: 200, consumo: 999 }),
    registro(1, { valor_total: 60, valor_litro: 6, litros: null, km_rodados: 50, consumo: null }),
    registro(2, { valor_total: 50, valor_litro: 5, km_rodados: null }),
    registro(7, { valor_total: 500, valor_litro: 5, km_rodados: 100 }),
    registro(-1, { valor_total: 1000, valor_litro: 5, km_rodados: 100 }),
    registro(0, { status: "cancelado", valor_total: 1000, valor_litro: 5, km_rodados: 100 }),
    { _tipo: "coleta", status: "pendente", data_coleta: data(0), peso_liquido: 20 }
  ];
  context.fetch = async () => ({ ok: true, json: async () => dados });
  api.S.tela = "dre"; api.S.dreDias = 7; await api.carregarMeus(); api.render();
  const html = element("#app").innerHTML;
  assert.match(html, /R\$ 210,00/); assert.match(html, /40,00 L/);
  assert.match(html, /R\$ 5,25/); assert.match(html, /250 km/);
  assert.match(html, /8,33<\/b><span>Rendimento km\/L/);
  assert.match(html, /R\$ 0,64/); assert.match(html, /20 kg/);
  assert.match(html, /R\$ 10,50/); assert.match(html, /Alguns abastecimentos não têm distância calculada/);
  assert.doesNotMatch(html, /999,0/);
});

test("painel não apresenta zero ou rendimento inventado para campos indisponíveis", () => {
  const { api, element } = app();
  api.S.tela = "dre"; api.S.dreDias = 30;
  const d = new Date(), hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  api.S.meus = [{ _tipo: "abast", status: "pendente", data_abast: hoje, placa: "ABC", valor_total: null, valor_litro: null, litros: null, km_rodados: 500, consumo: 2 }];
  api.render(); const html = element("#app").innerHTML;
  assert.match(html, /—<\/b><span>Gasto combustível/);
  assert.match(html, /—<\/b><span>Litros/);
  assert.match(html, /—<\/b><span>Rendimento km\/L/);
  assert.match(html, /totais podem estar incompletos/);
});

test("resposta incompatível da RPC não aparece como painel sem registros", async () => {
  const { api, context, element } = app();
  api.S.tela = "dre";
  context.fetch = async () => ({ ok: true, json: async () => [{ tipo: "abast" }] });
  await api.carregarMeus(); api.render();
  assert.equal(api.S.meus, null);
  assert.match(element("#app").innerHTML, /Resposta inválida da lista de registros/);
  assert.doesNotMatch(element("#app").innerHTML, /Nenhum registro enviado/);
});

test("painel vazio mantém resumos e gráficos e explica o alcance da consulta", () => {
  const { api, element } = app();
  api.S.tela = "dre"; api.S.meus = [];
  api.render();
  const html = element("#app").innerHTML;
  assert.match(html, /Nenhum registro elegível/);
  assert.match(html, /Resumo \(DRE\)/);
  assert.match(html, /Gasto por dia/);
  assert.match(html, /Rendimento \(km\/L\)/);
  assert.match(html, /criados no servidor nos últimos 30 dias/);
  assert.match(html, /data do abastecimento ou coleta/);
  assert.match(html, /data-act="atualizar-painel"/);
});

test("registros aprovados aparecem na lista mas informam por que não entram no período", () => {
  const { api, element } = app();
  const data = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  api.S.meus = [
    { _tipo: "abast", status: "aprovado", data_abast: data(10), placa: "ABC", valor_total: 100, valor_litro: 5, km_rodados: 200 },
    { _tipo: "abast", status: "aprovado", data_abast: data(-1), placa: "ABC", valor_total: 100, valor_litro: 5, km_rodados: 200 }
  ];
  api.S.tela = "meus"; api.render();
  assert.match(element("#app").innerHTML, /Aprovado/);
  api.S.tela = "dre"; api.S.dreDias = 7; api.render();
  assert.match(element("#app").innerHTML, /1 registro.*antes do período/);
  assert.match(element("#app").innerHTML, /1 registro.*após o período/);
  api.S.dreDias = 30; api.render();
  assert.match(element("#app").innerHTML, /R\$ 100,00/);
  assert.match(element("#app").innerHTML, /200 km/);
  assert.match(element("#app").innerHTML, /1 registro.*após o período/);
});

test("abastecimento aprovado de quatro dias aparece em registros e painel de 30 dias", async () => {
  const { api, context, element } = app();
  const d = new Date(); d.setDate(d.getDate() - 4);
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const registro = { _tipo: "abast", status: "aprovado", data_abast: data, criado_em: new Date().toISOString(),
    placa: "ABC", combustivel: "Diesel", posto: "Posto", valor_total: 100, valor_litro: 5, litros: 20, odometro: 1000, km_rodados: null };
  context.fetch = async () => ({ ok: true, json: async () => [registro] });
  api.S.tela = "meus"; await api.carregarMeus(); api.render();
  assert.match(element("#app").innerHTML, /Aprovado/);
  api.S.tela = "dre"; api.S.dreDias = 30; await api.carregarMeus(); api.render();
  const html = element("#app").innerHTML;
  assert.match(html, /R\$ 100,00/);
  assert.match(html, /20,00 L/);
  assert.match(html, /Gasto por dia \(R\$\)<\/h2><div class="dre-graf">/);
  assert.match(html, /Rendimento \(km\/L\)<\/h2><p class="peq">Sem dados no período/);
  assert.match(html, /Alguns abastecimentos não têm distância calculada/);
  assert.doesNotMatch(html, /Nenhum registro elegível/);
});

test("datas ISO com hora no dia atual entram no painel e no gráfico diário", () => {
  const { api, element } = app();
  const d = new Date(), data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  api.S.tela = "dre"; api.S.meus = [
    { _tipo: "abast", status: "aprovado", data_abast: data + "T12:00:00", placa: "ABC", valor_total: "100.00", valor_litro: "5.00", km_rodados: "200" },
    { _tipo: "abast", status: "pendente", data_abast: data + "T18:00:00", placa: "ABC", valor_total: 50, valor_litro: 5, km_rodados: 100 }
  ];
  api.render(); const html = element("#app").innerHTML;
  assert.match(html, /R\$ 150,00/);
  assert.match(html, /300 km/);
  assert.equal((html.match(/class="dre-graf"/g) || []).length, 2);
  assert.match(html, /<em>150<\/em>/);
});

test("filtro distingue limites, data inválida e situação não elegível", () => {
  const { api, element } = app();
  const data = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const item = (dia, status = "aprovado") => ({ _tipo: "abast", status, data_abast: dia, placa: "ABC", valor_total: 100, valor_litro: 5, km_rodados: 200 });
  api.S.tela = "dre"; api.S.dreDias = 30; api.S.meus = [
    item(data(29)), item(data(30)), item(data(-1)), item("2026-02-30"), item(null), item(data(0), "rejeitado")
  ];
  api.render(); const html = element("#app").innerHTML;
  assert.match(html, /R\$ 100,00/);
  assert.match(html, /1 registro\(s\) antes do período/);
  assert.match(html, /1 registro\(s\) após o período/);
  assert.match(html, /2 registro\(s\) com data ausente ou inválida/);
  assert.match(html, /Período neste celular/);
});

test("consulta antiga não substitui resultado mais recente nem erro atual", async () => {
  const { api, context } = app(), pendentes = [];
  context.fetch = () => new Promise(resolve => pendentes.push(resolve));
  const anterior = api.carregarMeus(), atual = api.carregarMeus();
  pendentes[1]({ ok: true, json: async () => [{ _tipo: "abast", id: 2 }] });
  await atual;
  pendentes[0]({ ok: true, json: async () => [{ _tipo: "abast", id: 1 }] });
  await anterior;
  assert.equal(api.S.meus[0].id, 2);
  const antigoErro = api.carregarMeus(), novo = api.carregarMeus();
  pendentes[3]({ ok: true, json: async () => [{ _tipo: "coleta", id: 3 }] });
  await novo;
  pendentes[2]({ ok: false, json: async () => ({ message: "erro antigo" }) });
  await antigoErro;
  assert.equal(api.S.meus[0].id, 3);
  assert.equal(api.S.meusErro, "");
});

test("diagnóstico compara contagens anônimas de status e período nas duas telas", () => {
  const { api, element } = app();
  const data = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const item = (tipo, status, dia) => ({ _tipo: tipo, status, [tipo === "abast" ? "data_abast" : "data_coleta"]: dia, placa: "PLACA-PRIVADA", motorista: "NOME-PRIVADO", valor_total: 987654, valor_litro: 5, odometro: 1 });
  api.S.dreDias = 30;
  api.S.meus = [
    item("abast", "aprovado", data(4)), item("abast", "pendente", data(31)),
    item("abast", "aprovado", data(-1)), item("abast", "pendente", null),
    item("abast", "rejeitado", data(0)), item("abast", "status-privado", data(0)),
    item("coleta", "cancelado", data(0))
  ];
  const diagnostico = () => element("#app").innerHTML.match(/<details class="card diagnostico-meus">[\s\S]*?<\/details>/)[0];
  api.S.tela = "dre"; api.render();
  const painel = diagnostico();
  assert.match(painel, /Resultado desta tela: 7 registro/);
  assert.match(painel, /Abastecimentos: 6/);
  assert.match(painel, /Aprovados: 2; pendentes: 2; rejeitados: 1; cancelados: 0; outros estados: 1/);
  assert.match(painel, /no período 1; antes 1; depois 1; data inválida ou ausente 1/);
  assert.match(painel, /Coletas: 1/);
  assert.doesNotMatch(painel, /PLACA-PRIVADA|NOME-PRIVADO|987654|status-privado|token/);
  api.S.tela = "meus"; api.render();
  assert.equal(diagnostico(), painel);
  api.S.meus = null; api.S.meusErro = "Sem sinal"; api.render();
  assert.match(diagnostico(), /Dados indisponíveis/);
  assert.doesNotMatch(diagnostico(), /Resultado desta tela: 0/);
  api.S.meus = []; api.render();
  assert.match(diagnostico(), /Resultado desta tela: 0 registro/);
});

test("histórico da frota apresenta litros calculados e evita zero quando dados faltam", () => {
  const { api, element } = app();
  api.S.tela = "frota"; api.S.abastVeiculo = "ABC"; api.S.abastDias = 30;
  api.S.listas = { veiculos: [{ placa: "ABC" }] };
  api.S.ultimosAbast = [{ placa: "ABC", data_abast: "2020-01-02", motorista: "Ana", combustivel: "Diesel", valor_total: 100, valor_litro: 5, litros: 999, odometro: 200 }];
  api.render();
  assert.match(element("#app").innerHTML, /20,00 L/);
  assert.doesNotMatch(element("#app").innerHTML, /999,00 L/);
  api.S.ultimosAbast[0].valor_total = null; api.S.ultimosAbast[0].valor_litro = null; api.S.ultimosAbast[0].litros = null;
  api.render(); assert.match(element("#app").innerHTML, /<b>—<\/b><small>Quantidade/);
});

test("litros arredondam corretamente em limite de meio centésimo", () => {
  const { api, element } = app();
  api.S.tela = "frota"; api.S.abastVeiculo = "ABC"; api.S.abastDias = 30;
  api.S.listas = { veiculos: [{ placa: "ABC" }] };
  api.S.ultimosAbast = [{ placa: "ABC", data_abast: "2020-01-02", motorista: "Ana", combustivel: "Diesel", valor_total: 2.01, valor_litro: 2, litros: null, odometro: 200 }];
  api.render();
  assert.match(element("#app").innerHTML, /1,01 L/);
  api.S.tela = "dre"; api.S.meus = [{ _tipo: "abast", status: "aprovado", data_abast: new Date().toLocaleDateString("en-CA"), placa: "ABC", valor_total: 2.01, valor_litro: 2, km_rodados: 101 }];
  api.S.dreDias = 30; api.render();
  assert.match(element("#app").innerHTML, /100,00<\/b><span>Rendimento km\/L/);
});

test("envio em segundo plano atualiza o painel com dados do servidor", async () => {
  const { api, context, element } = app();
  const hoje = new Date(), data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  api.S.tela = "dre"; api.S.meus = [];
  await api.idb.put("fila", { id_cliente: "ab1", tipo: "abast", motorista: "Ana", registrado_em: "2026-01-01", reg: { placa: "ABC", odometro: 120 } });
  context.fetch = async url => ({ ok: true, json: async () => url.endsWith("app_meus") ? [{ _tipo: "abast", status: "pendente", data_abast: data, placa: "ABC", valor_total: 100, valor_litro: 5, km_rodados: 200 }] : { id: 1 } });
  await api.sincronizar();
  assert.match(element("#app").innerHTML, /R\$ 100,00/);
  assert.match(element("#app").innerHTML, /200 km/);
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

test("Relatos fica ao lado de Início e câmera e galeria aceitam fotos com os mesmos limites", async () => {
  const { api, context, element, listeners } = app();
  api.S.tela = "manutencao"; api.S.tipo = "manutencao"; api.S.veiculo = "ABC";
  api.render();
  const html = element("#app").innerHTML;
  assert.match(html, /data-t="home">← Início<\/button><button data-act="ir" data-t="manutencoes">📋 Relatos/);
  assert.match(html, /id="ma_cam"[^>]*capture="environment"/);
  assert.match(html, /id="ma_fotos"[^>]*multiple/);
  api.acoes.foto({ dataset: { alvo: "ma_cam" } }); assert.equal(element("#ma_cam").clicked, true);
  const foto = new Blob(["imagem"], { type: "image/jpeg" }); foto.name = "foto.jpg";
  for (let i = 0; i < 5; i++) await listeners.change({ target: { id: i % 2 ? "ma_fotos" : "ma_cam", type: "file", files: [foto], value: "x" } });
  assert.equal(api.S.anexos.length, 5);
  await listeners.change({ target: { id: "ma_cam", type: "file", files: [foto], value: "x" } });
  assert.equal(api.S.anexos.length, 5); assert.match(element("#msg").innerHTML, /Limite de 5 fotos/);
  await api.guardarContexto(true);
  assert.equal(context.navigator.onLine, true);
});

test("navegação para Relatos preserva formulário e evidência ao voltar e após reinício", async () => {
  const shared = {}, a = app(shared);
  shared.local.set("frota_sessao", JSON.stringify({ nome: "Ana", token: "token" }));
  await a.api.idb.put("cache", { k: "listas", v: { veiculos: [{ placa: "ABC" }], combustiveis: ["Diesel"] } });
  a.context.navigator.onLine = false;
  a.api.S.tela = "manutencao"; a.api.S.tipo = "manutencao"; a.api.S.veiculo = "ABC";
  const desc = { id: "ma_desc", type: "textarea", value: "Vazamento", dataset: {}, tagName: "TEXTAREA" };
  a.controls.push(desc);
  a.api.S.anexos = [{ id: "foto", tipo: "foto", mime: "image/jpeg", nome: "foto.jpg", blob: new Blob(["foto"]), proximo: 0 }];
  a.api.render(); await a.api.guardarContexto(true);
  await a.api.acoes.ir({ dataset: { t: "manutencoes" } });
  desc.value = "";
  await a.api.acoes.ir({ dataset: { t: "manutencao" } });
  assert.equal(desc.value, "Vazamento"); assert.equal(a.api.S.anexos[0].blob.size, 4);
  await a.api.guardarContexto(true);
  const b = app(shared), restored = { id: "ma_desc", type: "textarea", value: "", dataset: {}, tagName: "TEXTAREA" };
  b.controls.push(restored); b.context.navigator.onLine = false;
  await b.api.iniciar();
  assert.equal(b.api.S.tela, "manutencao"); assert.equal(b.api.S.veiculo, "ABC");
  assert.equal(restored.value, "Vazamento"); assert.equal(b.api.S.anexos[0].blob.size, 4);
  await b.api.guardarContexto(true);
});

test("logout não restaura sessão e outro motorista não recebe contexto ou rascunho", async () => {
  const shared = {}, a = app(shared);
  shared.local.set("frota_sessao", JSON.stringify({ nome: "Ana", token: "token" }));
  a.context.navigator.onLine = false; a.api.S.tela = "manutencao"; a.api.S.tipo = "manutencao"; a.api.S.veiculo = "ABC";
  a.controls.push({ id: "ma_desc", type: "textarea", value: "Privado", dataset: {}, tagName: "TEXTAREA" });
  a.api.render(); await a.api.guardarContexto(true); await a.api.acoes.trocar();
  assert.equal(shared.local.has("frota_sessao"), false);
  const b = app(shared); b.context.navigator.onLine = false; await b.api.iniciar();
  assert.equal(b.api.S.tela, "login"); assert.equal(b.api.S.sessao, null);
  b.context.navigator.onLine = true;
  b.context.fetch = async url => ({ ok: true, json: async () => ({ app_login: { ok: true, token: "outro", nome: "Bia" }, app_listas: { veiculos: [{ placa: "XYZ" }] }, app_locais: [] })[url.split("/").pop()] });
  b.element("#lg_nome").value = "Bia"; b.element("#lg_pin").value = "1234";
  await b.api.acoes.entrar();
  assert.equal(b.api.S.tela, "veiculos"); assert.equal(b.api.S.veiculo, "");
  assert.equal(Object.keys(b.api.S.rascunhos).length, 0);
  await b.api.guardarContexto(true);
});

test("falha ao persistir rascunho é explícita e impede registrar como salvo", async () => {
  const { api, element } = app();
  api.S.tela = "manutencao"; api.S.tipo = "manutencao"; api.S.veiculo = "ABC";
  api.S.fase = "confirmar"; api.S.rasc = { placa: "ABC", categoria: "pneus_rodas", criticidade: "leve", odometro: 1, horimetro: 1, descricao: "pneu" };
  const put = api.idb.put;
  api.idb.put = async (s, v) => { if (s === "cache" && v.k.startsWith("contexto:")) throw new Error("quota"); return put(s, v); };
  element("#cf_ok").checked = true;
  await api.acoes["salvar-manutencao"]();
  assert.equal((await api.idb.all("fila")).length, 0);
  assert.notEqual(api.S.fase, "ok");
  assert.match(element("#msg").innerHTML, /quota/);
  assert.match(api.S.erroContexto, /Não foi possível salvar/);
});

test("confirmação não sobrescreve fila anterior do mesmo rascunho", async () => {
  const { api, context, element } = app();
  context.navigator.onLine = false;
  api.S.tela = "manutencao"; api.S.tipo = "manutencao"; api.S.veiculo = "ABC"; api.S.fase = "confirmar";
  api.S.rasc = { placa: "ABC", categoria: "pneus_rodas", criticidade: "leve", odometro: 1, horimetro: 1, descricao: "pneu" };
  await api.guardarContexto(true);
  const id = api.S.rascunhoId;
  await api.idb.put("fila", { id_cliente: id, tipo: "manutencao", motorista: "Ana", registrado_em: "2026-01-01", servidor_id: 23, reg: api.S.rasc, anexos: [{ id: "midia", proximo: 2 }] });
  context.document.querySelector("#cf_ok").checked = true;
  await api.acoes["salvar-manutencao"]();
  const item = await api.idb.get("fila", id);
  assert.equal(item.servidor_id, 23); assert.equal(item.anexos[0].proximo, 2);
  assert.equal((await api.idb.all("fila")).length, 1);
  assert.notEqual(api.S.fase, "ok");
  assert.match(element("#msg").innerHTML, /já está na fila/);
});

test("resposta idempotente não apresenta alterações posteriores como enviadas", async () => {
  const { api, context, element } = app();
  api.S.tela = "manutencao"; api.S.tipo = "manutencao"; api.S.veiculo = "ABC"; api.S.fase = "confirmar";
  api.S.rasc = { placa: "ABC", categoria: "pneus_rodas", criticidade: "leve", odometro: 1, horimetro: 1, descricao: "alteração posterior" };
  context.fetch = async () => ({ ok: true, json: async () => ({ ok: true, id: 23, duplicado: true }) });
  element("#cf_ok").checked = true;
  await api.acoes["salvar-manutencao"]();
  assert.equal(api.S.okNum, "dup");
  assert.equal(api.S.okReg, null);
  assert.match(element("#app").innerHTML, /alterações neste rascunho não foram enviadas/);
});

test("rascunhos permanecem separados por caminhão", async () => {
  const { api, controls } = app();
  api.S.tela = "manutencao"; api.S.tipo = "manutencao"; api.S.veiculo = "ABC"; api.S.listas = { veiculos: [{ placa: "ABC" }, { placa: "XYZ" }] };
  const desc = { id: "ma_desc", type: "textarea", value: "Falha ABC", dataset: {}, tagName: "TEXTAREA" };
  controls.push(desc); api.render(); await api.guardarContexto(true);
  await api.acoes.ir({ dataset: { t: "home" } });
  api.acoes["trocar-veiculo"]();
  api.S.veiculo = "XYZ"; desc.value = "";
  await api.acoes.ir({ dataset: { t: "manutencao" } });
  assert.notEqual(desc.value, "Falha ABC");
  await api.acoes.ir({ dataset: { t: "home" } });
  api.acoes["trocar-veiculo"]();
  api.S.veiculo = "ABC"; desc.value = "";
  await api.acoes.ir({ dataset: { t: "manutencao" } });
  assert.equal(desc.value, "Falha ABC");
  await api.guardarContexto(true);
});
