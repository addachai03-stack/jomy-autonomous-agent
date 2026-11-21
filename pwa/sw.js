// Keep HTML, JS and CSS from the same release. Previous cache-first fetches
// could serve older app.js/styles.css alongside freshly deployed Dashboard HTML.
const CACHE = "jomy-agent-shell-v68";
const ASSETS = [
  "/", "/index.html", "/styles.css?v=68", "/app.js?v=68", "/unified-console.js?v=68", "/approval-utils.js", "/voice-language.js", "/mic-check-ui.js?v=68", "/mic-permission.js", "/voice-qa-panel.js?v=68", "/voice-qa.js",
  "/manifest.json", "/icon.svg", "/voice-utils.js", "/task-engine.js",
  "/task-planner.js", "/memory-utils.js", "/speech-text.js", "/speech-voice.js"
];
const SHELL_PATHS = new Set(ASSETS.map(asset => new URL(asset, self.location.origin).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key =>
        key.startsWith("jomy-agent-shell-") && key !== CACHE
      ).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode !== "navigate" && !SHELL_PATHS.has(url.pathname)) return;

  // Network-first on live pages: always prefer the current deployed shell.
  // When offline, fall back to previously precached files without touching
  // user data in localStorage (tasks, checklist or Personal Memory).
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache =>
          cache.put(request, copy)
        ).catch(() => {}));
      }
      return response;
    } catch (_) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === "navigate") {
        const fallback = await caches.match("/index.html");
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});
