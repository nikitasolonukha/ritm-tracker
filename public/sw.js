const PUBLIC_CACHE = "ritm-public-v3";
const META_CACHE = "ritm-pwa-meta-v1";
const ACCOUNT_CACHE_PREFIX = "ritm-account-v3-";
const ACCOUNT_MARKER = "/__ritm_active_account__";
const PUBLIC_SHELL = ["/login", "/manifest.webmanifest", "/icon.svg"];
let activeAccountId;

function accountCacheName(userId) {
  return ACCOUNT_CACHE_PREFIX + encodeURIComponent(userId);
}

function isStaticAsset(request) {
  return request.destination === "script" || request.destination === "style" || request.destination === "font" || request.destination === "image";
}

function isPrivatePage(path) {
  return ["/today", "/workouts", "/settings", "/progress", "/journal", "/journal/import", "/exercises"].includes(path)
    || ["/workout/", "/workouts/templates/", "/journal/workouts/", "/exercises/"].some((prefix) => path.startsWith(prefix));
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
  if (event.data?.type === "set-account" && typeof event.data.userId === "string") event.waitUntil((async () => {
    const id = event.data.userId;
    await saveActiveAccount(id);
    // Capture the first authenticated shell even when login redirected there before the worker learned the account.
    if (!event.data.url) return;
    const url = new URL(event.data.url);
    if (url.origin !== self.location.origin || !isPrivatePage(url.pathname)) return;
    try {
      const response = await fetch(url.href, { cache: "no-store", headers: { Accept: "text/html" } });
      if (response.ok && !response.redirected && response.headers.get("x-ritm-account-id") === id && activeAccountId === id) await (await caches.open(accountCacheName(id))).put(url.href, response);
    } catch { /* Keep the previous offline shell and all local records. */ }
  })());
  if (event.data?.type === "clear-account") event.waitUntil(clearActiveAccount());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const isNavigation = event.request.mode === "navigate";
  const isAsset = isStaticAsset(event.request);
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) return;
  const isPublicAsset = isAsset && (requestUrl.pathname.startsWith("/_next/static/") || ["/icon.svg", "/favicon.ico"].includes(requestUrl.pathname));
  if (!isNavigation && !isAsset) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (!response.ok) return response;
      const finalPath = new URL(response.url).pathname;
      const copy = response.clone();
      if (isPublicAsset && !response.redirected) {
        event.waitUntil(caches.open(PUBLIC_CACHE).then((cache) => cache.put(event.request, copy)));
      } else if (isNavigation && finalPath === "/login") {
        event.waitUntil(caches.open(PUBLIC_CACHE).then((cache) => cache.put("/login", copy)));
      } else if (isNavigation && activeAccountId && response.headers.get("x-ritm-account-id") === activeAccountId && !response.redirected && finalPath === requestUrl.pathname && !["/login", "/register", "/update-password"].includes(finalPath)) {
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
