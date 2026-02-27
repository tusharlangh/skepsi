import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "../app/dist");
const indexPath = join(distDir, "index.html");
const swPath = join(distDir, "sw.js");

const html = readFileSync(indexPath, "utf-8");
const precache = ["/", "/index.html", "/manifest.json"];

const scriptMatch = html.match(/<script[^>]+src="([^"]+)"/);
if (scriptMatch) precache.push(scriptMatch[1]);
const linkMatches = html.matchAll(/<link[^>]+href="([^"]+\.css)"/g);
for (const m of linkMatches) precache.push(m[1]);

const swContent = `const CACHE_NAME = "skepsi-v2";

const PRECACHE_URLS = ${JSON.stringify(precache)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("/ws") || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && event.request.url.startsWith(new URL(self.registration.scope).origin)) {
          caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((c) => c || caches.match("/index.html"))
      )
  );
});
`;

writeFileSync(swPath, swContent);
console.log("Injected precache URLs into sw.js:", precache);
