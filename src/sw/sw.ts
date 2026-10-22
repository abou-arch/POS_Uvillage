/// <reference lib="webworker" />
// Service worker de la caisse : met l'application en cache pour qu'elle se recharge sans réseau.
// Écrit à la main plutôt que généré par workbox : le générateur casse sur l'apostrophe du chemin du projet
// (« d'Uvillage »). vite-plugin-pwa y injecte seulement la liste des fichiers de la version (__WB_MANIFEST).
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

const PREFIX = 'caisse-app-';
const entries = self.__WB_MANIFEST.map((e) => (typeof e === 'string' ? { url: e, revision: null } : e));

/** Empreinte courte de la liste des fichiers : un cache par version, renouvelé dès qu'un fichier change. */
function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const CACHE = PREFIX + fingerprint(entries.map((e) => `${e.url}#${e.revision ?? ''}`).join('|'));
const absolute = (url: string) => new URL(url, self.registration.scope).href;
const INDEX = absolute('index.html');
const URLS = [...new Set(entries.map((e) => absolute(e.url)))]; // cache.addAll refuse les doublons

// Installation : toute la version est téléchargée (sans le cache HTTP), puis elle remplace l'ancienne
// sans attendre. Elle sert au prochain chargement de page : jamais de rechargement en pleine vente.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(URLS.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Fichiers de l'application : depuis le cache, sinon le réseau. L'API (autre origine) n'est jamais
// mise en cache ici : catalogue et ventes vivent dans IndexedDB.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // ignoreVary : les fichiers arrivent avec « Vary: Origin », et les scripts (crossorigin) envoient un Origin
  // que la mise en cache n'avait pas : sans lui, rien ne correspondrait hors ligne. Même origine, fichiers fixes.
  const options = { cacheName: CACHE, ignoreVary: true };
  const cached = request.mode === 'navigate'
    ? caches.match(INDEX, options) // toute page de l'application = index.html
    : caches.match(request, options);
  event.respondWith(cached.then((response) => response ?? fetch(request)));
});
