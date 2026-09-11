const PUBLIC_CACHE = "ritm-public-v2";
const META_CACHE = "ritm-pwa-meta-v1";
const ACCOUNT_CACHE_PREFIX = "ritm-account-v2-";
const ACCOUNT_MARKER = "/__ritm_active_account__";
const PUBLIC_SHELL = ["/login", "/manifest.webmanifest", "/icon.svg"];
let activeAccountId;

function accountCacheName(userId) {
  return ACCOUNT_CACHE_PREFIX + encodeURIComponent(userId);
}

function isStaticAsset(request) {
  return request.destination === "script" || request.destination === "style" || request.destination === "font" || request.destination === "image";
}

async function loadActiveAccount() {
  const response = await caches.match(ACCOUNT_MARKER, { cacheName: META_CACHE });
  activeAccountId = response ? await response.text() : undefined;
}

async function saveActiveAccount(userId) {
  activeAccountId = userId;
  const meta = await caches.open(META_CACHE);
  await meta.put(ACCOUNT_MARKER, new Response(userId, { headers: { "Content-Type": "text/plain" } }));
}

async function clearActiveAccount() {
  const oldAccount = activeAccountId;
  activeAccountId = undefined;
  await caches.delete(META_CACHE);
  if (oldAccount) await caches.delete(accountCacheName(oldAccount));
}

async function offlineResponse() {
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><title>Ритм офлайн</title><main><h1>Нет связи</h1><p>Синхронизация недоступна. Откройте сохранённую страницу после восстановления сети.</p></main>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PUBLIC_CACHE).then((cache) => cache.addAll(PUBLIC_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await loadActiveAccount();
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== PUBLIC_CACHE && key !== META_CACHE && !key.startsWith(ACCOUNT_CACHE_PREFIX)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "set-account" && typeof event.data.userId === "string") event.waitUntil(saveActiveAccount(event.data.userId));
  if (event.data?.type === "clear-account") event.waitUntil(clearActiveAccount());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const isNavigation = event.request.mode === "navigate";
  const isAsset = isStaticAsset(event.request);
  if (!isNavigation && !isAsset) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (!response.ok) return response;
      const finalPath = new URL(response.url).pathname;
      const copy = response.clone();
      if (isAsset) {
        event.waitUntil(caches.open(PUBLIC_CACHE).then((cache) => cache.put(event.request, copy)));
      } else if (finalPath === "/login") {
        event.waitUntil(caches.open(PUBLIC_CACHE).then((cache) => cache.put("/login", copy)));
      } else if (activeAccountId) {
        event.waitUntil(caches.open(accountCacheName(activeAccountId)).then((cache) => cache.put(event.request, copy)));
      }
      return response;
    } catch {
      const accountCache = activeAccountId ? await caches.open(accountCacheName(activeAccountId)) : undefined;
      const privatePage = accountCache ? await accountCache.match(event.request) : undefined;
      if (privatePage) return privatePage;
      const publicPage = await caches.match(event.request, { cacheName: PUBLIC_CACHE });
      if (publicPage) return publicPage;
      return offlineResponse();
    }
  })());
});
