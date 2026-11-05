/* sitesRawView.js — "what the old whole-library entry would hold", reconstructed from the per-plan entries (B2200384).
 *
 * THE DEVICE NO LONGER KEEPS A WHOLE-LIBRARY COPY of the plans (`planarfit:sites:v1`, `planarfit:sites:cloud:<uid>`): each plan is its own
 * entry `<store>:p:<planId>` (lib/planStore.js). About 450 ui-audit harnesses and ~160 e2e specs used to read that raw key to see "what was saved". They now
 * ask this module instead — in a page, `window.__planyrSitesRaw(key)`, installed ONLY under automation (navigator.webdriver, `window.__PLANYR_E2E`
 * or the diagnostic arm) so no production code path depends on it. It READS and never writes, and it understands a move in flight (entries first, then
 * the plans still in the legacy entry), so a harness sees the same library the app does.
 *
 * ⛔ A LEAF — no imports. Pure over a Storage-shaped object.
 */
const PFX = ":p:";

/** The library as the old blob would have held it: a JSON text, or null when the store holds nothing at all. */
export function sitesRaw(base, ls) {
  const store = ls || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return null;
  const ids = [], p = base + PFX;
  try { for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith(p)) ids.push(k.slice(p.length)); } } catch (_) { return null; }
  let legacy = null; try { legacy = store.getItem(base); } catch (_) {}
  if (!ids.length) return legacy;
  const parts = [], seen = new Set();
  for (const id of ids) { const raw = store.getItem(p + id); if (raw == null) continue; parts.push(JSON.stringify(id) + ":" + raw); seen.add(id); }
  if (legacy != null) {                                       // a move in flight (or an older tab's write): the plans only the legacy entry holds
    let obj = null; try { obj = JSON.parse(legacy); } catch (_) {}
    if (obj && typeof obj === "object") for (const [id, rec] of Object.entries(obj)) if (!seen.has(id)) parts.push(JSON.stringify(id) + ":" + JSON.stringify(rec));
  }
  return "{" + parts.join(",") + "}";
}
/** The library as an object (`{}` when empty). */
export function sitesObject(base, ls) { try { return JSON.parse(sitesRaw(base, ls) || "{}") || {}; } catch (_) { return {}; } }

export function installSitesRawView(win) {
  try {
    const on = win && ((win.navigator && win.navigator.webdriver === true) || win.__PLANYR_E2E === true || win.__E2E === true);
    if (!on) return false;
    win.__planyrSitesRaw = (key) => sitesRaw(key, win.localStorage);
    return true;
  } catch (_) { return false; }
}
