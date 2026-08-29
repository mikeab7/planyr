// B849344 — turn a flat `site_elements` parcel-row list (site_id, data) into a per-site
// canonical boundary summary: how many LIVE parcels a site has, and their true dissolved
// acreage — the SAME derivation the open planner canvas uses (dissolvedParcelSqft), never the
// dead `sites.data->'parcels'` mirror the site list/map pin used to read (see /CLAUDE.md and
// cloudSync.js's slimForCloud, which empties that field on every cloud push since B672).
// Pure — the network fetch lives in elementApi.js/cloudSync.js.
import { dissolvedParcelSqft } from "./polyClip.js";

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
