// Locally service worker: lets the app open and browse saved listings without internet.
const CACHE = 'locally-v4';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const SHELL = ['./', 'index.html', 'locally-logo.png', 'manifest.json', 'icon-192.png?v=3', 'icon-512.png?v=3', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'IMG_1146.jpeg', 'IMG_1147.webp', 'IMG_1148.jpeg', 'IMG_1149.webp', 'IMG_1151.jpeg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all([
    ...SHELL.map((u) => c.add(u).catch(() => {})),
    c.add(new Request(CDN, { mode: 'no-cors' })).catch(() => {})
  ])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isStorage = url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/');
  const isCdn = url.hostname === 'cdn.jsdelivr.net';
  // Never cache login or database calls.
  if (!sameOrigin && !isStorage && !isCdn) return;

  // Other pages (like /privacy.html) load normally and must not replace the saved app page.
  if (req.mode === 'navigate' && !/^\/(index\.html)?$/.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    // Newest page when online, saved page when offline.
    e.respondWith(fetch(req).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put('index.html', copy));
      return r;
    }).catch(() => caches.match('index.html').then((h) => h || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => {
      if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});
