# Generează sw.js cu lista completă de fișiere precache (rulează după orice schimbare de fișiere).
import os, re
ver = re.search(r"APP_VERSION = '([^']+)'", open('js/core/store.js').read()).group(1)
files = ['./', 'index.html', 'manifest.webmanifest']
for d in ['css', 'js', 'i18n', 'icons', 'fonts']:
    for root, _, fs in os.walk(d):
        for f in sorted(fs):
            if f.endswith(('.js', '.css', '.png', '.woff2')): files.append(os.path.join(root, f))
open('sw.js', 'w').write(f"""// Service worker LEGE ȘI ORDINE – cache propriu, separat de Notis.
const CACHE = 'lso-cache-v{ver}';
const FILES = {files!r};
self.addEventListener('install', e => {{
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
}});
self.addEventListener('activate', e => {{
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lso-cache-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
}});
self.addEventListener('fetch', e => {{
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, {{ ignoreSearch: true }}).then(hit => hit || fetch(req).then(res => {{
    if (res.ok) {{ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }}
    return res;
  }}).catch(() => req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
}});
""")
print(ver, len(files))
