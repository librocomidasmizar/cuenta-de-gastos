/* Mis Cuentas — service worker: la app abre al instante y funciona sin cobertura
   (con los últimos datos descargados). Las llamadas a Google nunca se guardan aquí. */
const VERSION = 'mis-cuentas-v2';
const ARCHIVOS = ['./', 'index.html', 'css/app.css', 'js/core.js', 'js/charts.js', 'js/xlsx.js', 'js/pdf.js', 'js/acceso.js', 'js/app.js',
  'vendor/pdf-lib.min.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
// acceso.json no va en la lista: puede no existir todavía. Se guarda solo cuando se descarga.

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // la API de Google va siempre por red
  // red primero (para recibir mejoras), caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
