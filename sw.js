// Service worker: guarda la app en el dispositivo para que abra rápido y sin señal.
// Solo maneja archivos propios; los pedidos al Apps Script y a Google pasan directo.
// Al cambiar cualquier archivo de la app, subí VERSION para que los teléfonos tomen la nueva.
const VERSION = 'horas-v2';
const ARCHIVOS = [
  './', 'index.html', 'admin.html', 'manifest.webmanifest',
  'assets/estilos.css', 'assets/config.js', 'assets/api.js', 'assets/carga.js', 'assets/admin.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(claves => Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Primero la red (siempre la última versión); si no hay señal, lo guardado.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(VERSION).then(c => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
