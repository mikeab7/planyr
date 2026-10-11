// B849344 — turn a flat `site_elements` parcel-row list (site_id, data) into a per-site
// canonical boundary summary: how many LIVE parcels a site has, and their true dissolved
// acreage — the SAME derivation the open planner canvas uses (dissolvedParcelSqft), never the
// dead `sites.data->'parcels'` mirror the site list/map pin used to read (see /CLAUDE.md and
// cloudSync.js's slimForCloud, which empties that field on every cloud push since B672).
// Pure — the network fetch lives in elementApi.js/cloudSync.js.
import { dissolvedParcelSqft, overlappingParcelPairsSteps } from "./polyClip.js";

// rows: [{ site_id, data }], data = the parcel object verbatim (same shape the canvas holds).
// Returns { [siteId]: { count, acres, parcels } }. A site with zero live rows is simply absent
// from the result — callers fall back to whatever else they have for such a site (a genuinely
// blank site, or one never synced to rows at all).
export function summarizeParcelRows(rows) {
  const bySite = new Map();
  for (const r of (rows || [])) {
    if (!r || !r.site_id || !r.data) continue;
    const list = bySite.get(r.site_id);
    if (list) list.push(r.data); else bySite.set(r.site_id, [r.data]);
  }
  const out = {};
  for (const [siteId, parcels] of bySite) {
    out[siteId] = { count: parcels.length, acres: dissolvedParcelSqft(parcels) / 43560, parcels };
  }
  return out;
}

// NEW-1 (B2224000) — the SAME summary, computed in time slices. The sync one runs inside the continuation of the account-wide parcel fetch
// (`Response.text.then` in the owner's perfcap: a 134 ms task), and its cost is the SUM over every site on the account of an O(parcels²) overlap
// scan — it grows with the library, not with the plan being opened. A site is the unit of work (never split: `dissolvedParcelSqft` needs the whole
// set), so each slice is bounded by `budgetMs` plus one site. Same result as `summarizeParcelRows`, key for key.
/* B2236000 (round 6) — never a bare timer between slices: a background tab clamps timers to about once a second, which would stretch a sliced summary
 * across minutes there. And the slice unit is now ONE PARCEL PAIR, not one site: a project with many lots made a single 75–150 ms task at 2× CPU in the
 * owner-sized rig (the pair scan is O(lots²) clipped triangle pairs), which is what remained of the fresh-load stall after the list read was fixed. */
/* … and it waits for an IDLE moment between slices (with a ceiling, so a busy or hidden tab still finishes): measured, a MessageChannel yield resumed
 * at once and made the summary compete with the app's own first render on a fresh load (reload worst 222 → 286 ms at 2× on the default store). The
 * summary only feeds the map list's acreage, which nothing on a fresh load waits for. */
const yieldMacrotask = () => new Promise((resolve) => {
  try { if (typeof requestIdleCallback === "function") { requestIdleCallback(() => resolve(), { timeout: 1000 }); return; } } catch (_) { /* fall through */ }
  if (typeof MessageChannel === "undefined") { setTimeout(resolve, 0); return; }
  const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); resolve(); }; ch.port2.postMessage(0);
});
export async function summarizeParcelRowsAsync(rows, { budgetMs = 12, yieldFn = yieldMacrotask, now = () => performance.now() } = {}) {
  const bySite = new Map();
  for (const r of (rows || [])) {
    if (!r || !r.site_id || !r.data) continue;
    const list = bySite.get(r.site_id);
    if (list) list.push(r.data); else bySite.set(r.site_id, [r.data]);
  }
  const out = {};
  let sliceStart = now();
  for (const [siteId, parcels] of bySite) {
    const gen = overlappingParcelPairsSteps(parcels);
    let pairs;
    for (;;) { const r = gen.next(); if (r.done) { pairs = r.value; break; } if (now() - sliceStart >= budgetMs) { await yieldFn(); sliceStart = now(); } }
    out[siteId] = { count: parcels.length, acres: dissolvedParcelSqft(parcels, pairs) / 43560, parcels };
    if (now() - sliceStart >= budgetMs) { await yieldFn(); sliceStart = now(); }
  }
  return out;
}
