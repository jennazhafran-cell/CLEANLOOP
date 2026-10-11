const VERSION = 'cleanloop-v4';
const SHELL = ['./', 'index.html', 'dashboard.html', 'style.css', 'dashboard.css',
  'api.js', 'script.js', 'dashboard.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'images/logo.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const store = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API selalu ke jaringan
  if (url.pathname.startsWith('/api/')) return;

  if (url.origin !== location.origin && !FONT_HOSTS.includes(url.hostname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => store(req, res))
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
    );
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => store(req, res)).catch(() => hit);
    return hit || net;
  }));
});