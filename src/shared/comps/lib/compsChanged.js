/* B1953796 (R4) — "a comp was written" signal. Deliberately dependency-free (no comps.js, no
 * Supabase) so the Model workspace can subscribe without pulling the comps chunk (see
 * workspaces/model/lib/projectCompsFetch.js's header). Same plain synthetic `storage` event the
 * site-model change signal uses (storage.js notifySiteModelChanged / onSiteModelChanged). */
export const COMPS_CHANGED_KEY = "planyr:compsChanged:v1";
export function notifyCompsChanged() {
  try { window.dispatchEvent(new StorageEvent("storage", { key: COMPS_CHANGED_KEY })); } catch (_) { /* no window (tests/SSR) */ }
}
export function onCompsChanged(cb) {
  if (typeof window === "undefined") return () => {};
  const on = (e) => { if (e.key === COMPS_CHANGED_KEY) cb(); };
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
}
