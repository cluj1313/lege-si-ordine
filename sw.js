// Service worker LEGE ȘI ORDINE – cache propriu, separat de Notis.
const CACHE = 'lso-cache-v1.0.6';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/app.js', 'js/boot.js', 'js/ui/datetime.js', 'js/ui/daygroups.js', 'js/ui/dnd.js', 'js/ui/editor.js', 'js/ui/folderpick.js', 'js/ui/list.js', 'js/ui/modal.js', 'js/ui/pickers.js', 'js/ui/pillrow.js', 'js/ui/registry.js', 'js/ui/tabsbar.js', 'js/tabs/cats.js', 'js/tabs/kinds.js', 'js/tabs/recordings.js', 'js/tabs/views.js', 'js/core/crypto.js', 'js/core/db.js', 'js/core/i18n.js', 'js/core/seed.js', 'js/core/store.js', 'js/core/util.js', 'js/features/alarms.js', 'js/features/backup.js', 'js/features/media.js', 'js/features/notify.js', 'js/features/search.js', 'js/features/settings.js', 'js/features/share.js', 'js/features/trash.js', 'js/features/voice.js', 'js/secret/news.js', 'js/secret/server.js', 'js/secret/settings-parts.js', 'js/secret/stats.js', 'js/secret/zone.js', 'js/voice/native-cap.js', 'js/voice/native-stt.js', 'js/voice/native-tts.js', 'i18n/ro.js', 'icons/folder.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-96.png', 'icons/maskable-512.png', 'fonts/oswald-300-latin-ext.woff2', 'fonts/oswald-300-latin.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lso-cache-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Cereri Range (fonte woff2): le lăsăm pe rețea, ca să nu primim 416 din cache.
  if (req.headers.has('range')) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
