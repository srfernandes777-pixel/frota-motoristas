// Guarda o app no celular para abrir sem internet. Para forçar atualização em todos os celulares, mude a versão.
const VERSAO = "frota-v4";
const ARQUIVOS = ["./", "./index.html", "./app.js", "./config.js", "./manifest.webmanifest",
                  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Com sinal busca sempre a versão mais nova (assim config.js e app.js atualizados valem na hora).
// Sem sinal (ou sinal muito lento) abre o que está guardado no celular.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSAO);
    try {
      const r = await Promise.race([fetch(req, { cache: "no-store" }), new Promise((_, rej) => setTimeout(() => rej(new Error("lento")), 4000))]);
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("./index.html"));
    }
  })());
});
