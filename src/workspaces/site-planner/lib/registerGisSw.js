/* Retire the old GIS imagery service worker (B439 supersedes B438).
 *
 * The browser-side imagery cache (a service worker) was replaced by a server-side, cross-device
 * cache (durable copy in Google Drive, served via /api/gis-cache/*). This actively UNREGISTERS
 * any previously-installed Planyr GIS worker so a returning visitor stops using the old
 * browser-local cache — belt-and-suspenders with the self-unregistering tombstone at
 * public/gis-sw.js (a browser only re-checks the SW file on navigation, so we also unregister
 * here on boot). Best-effort + fail-safe: never throws into app boot. `scope` is overridable
 * for tests.
 */
export function retireGisSw(opts = {}) {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const run = () => {
      try {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          for (const reg of regs || []) {
            const url = (reg && reg.active && reg.active.scriptURL) || "";
            if (url.indexOf("gis-sw.js") !== -1) reg.unregister().catch(() => {});
          }
        }).catch(() => {});
      } catch (_) { /* ignore */ }
    };
    if (typeof document !== "undefined" && document.readyState === "complete") run();
    else if (typeof window !== "undefined") window.addEventListener("load", run, { once: true });
  } catch (_) { /* never throw into boot */ }
}
