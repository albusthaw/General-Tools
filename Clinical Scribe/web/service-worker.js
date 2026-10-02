// Service worker for the iPhone web app (the app build at <site>/app/). The build
// fills in the cache name and the list of the app's own files. It keeps those
// files so the app opens without a connection, and updates them on the next start
// after a new version is published. It never handles requests to other addresses,
// so nothing from the server (and no patient data) is ever stored by it.
const CACHE = "__CACHE__";
const FILES = __FILES__;
const SCOPE = new URL(self.registration.scope);
const KNOWN = new Set(FILES.map((file) => new URL(file, SCOPE).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("cs-app-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (request.mode === "navigate") {
    // The page itself: the newest version when online, the kept one when not.
    event.respondWith(fetch(request).catch(() => caches.match(new URL("./", SCOPE).href)));
    return;
  }
  if (!KNOWN.has(url.pathname)) return;
  event.respondWith(caches.match(request).then((kept) => kept ?? fetch(request)));
});
