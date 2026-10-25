// Guarda o app no celular para abrir sem internet. Para forçar atualização em todos os celulares, mude a versão.
const VERSAO = "frota-v1";
const ARQUIVOS = ["./", "./index.html", "./app.js", "./config.js", "./manifest.webmanifest",
                  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Abre do cache na hora e atualiza em segundo plano (a versão nova aparece na abertura seguinte).
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSAO).then(async cache => {
    const guardado = await cache.match(req, { ignoreSearch: true });
    const rede = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    return guardado || (await rede) || (await cache.match("./index.html"));
  }));
});
