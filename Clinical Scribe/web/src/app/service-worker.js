// Registers the iPhone web app's service worker (see web/service-worker.js), so
// the app opens without a connection and updates itself on the next start.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol !== "https:") return;
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
    // Without it the app still works; it only needs a connection to open.
  });
}
