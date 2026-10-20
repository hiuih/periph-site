/* periph stats: keeps the page itself (HTML, CSS, JS, fonts, icons) on the device so it opens
   offline from the home screen. The numbers aren't cached here: the page keeps its own last
   known copy. Network first for the page, so a new version shows as soon as you're online. */
const CACHE = "periph-stats-v4";
const SHELL = ["./", "app.css?v=4", "app.js?v=4", "admin.css?v=4", "admin.js?v=4", "manifest.webmanifest",
  "../fonts/bricolage.woff2", "../fonts/plex.woff2", "../fonts/mono.woff2",
  "../icon-192.png", "../favicon-32.png", "../apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("periph-stats-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // GitHub API / raw: the page handles those
  if (/\.(woff2|png|ico|svg)$/.test(url.pathname)) {        // static assets: cache first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then((res) => {                   // page, css, js: network first
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit ||
    (req.mode === "navigate" ? caches.match("./") : caches.match(req, { ignoreSearch: true })))));
});
