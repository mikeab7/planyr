/* Register the GIS imagery service worker (B438).
 *
 * Best-effort + fail-safe: only on a secure context that supports service workers, only after
 * load (so it never competes with first paint), and any failure is swallowed (the app works
 * exactly as before — caching is a pure enhancement). The SW itself is host-scoped (it only
 * touches cross-origin ArcGIS imagery), so registering it can't affect app behaviour.
 *
 * Path: the SW lives at the site root (`public/gis-sw.js` → `/gis-sw.js`); scope `/` is correct
 * at the deployed root and on the localhost preview. `swUrl`/`scope` are overridable for tests.
 */
export function registerGisSw(opts = {}) {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (typeof window !== "undefined" && window.isSecureContext === false) return; // http:// (non-localhost) → skip
    const swUrl = opts.swUrl || "/gis-sw.js";
    const scope = opts.scope || "/";
    const reg = () => { navigator.serviceWorker.register(swUrl, { scope }).catch(() => {}); };
    if (typeof document !== "undefined" && document.readyState === "complete") reg();
    else if (typeof window !== "undefined") window.addEventListener("load", reg, { once: true });
  } catch (_) { /* never throw into boot */ }
}
