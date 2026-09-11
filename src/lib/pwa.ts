export function setServiceWorkerAccount(userId?: string) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((registration) => {
    const target = registration.active ?? navigator.serviceWorker.controller;
    target?.postMessage(userId ? { type: "set-account", userId } : { type: "clear-account" });
  }).catch(() => undefined);
}
