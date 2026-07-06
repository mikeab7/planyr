// Element-level sync (B670) — the pure JS mirror of the SQL explode/rebuild in
// db/site_elements_backfill.sql / db/site_elements_down.sql. One element = one row in
// `site_elements`; the 5 vector collections below ride rows, everything else in the site
// model (settings, underlay, sheetOverlays, parcelDrawings, meta…) stays in the slim
// `sites.data` header. Keep BOTH sides' rules identical — the fidelity check
// (db/site_elements_fidelity.sql) and test/elementRows.test.js hold them together.

// Row kind ↔ site-model collection field. 'tombstone' is the extra row kind for a
// deletion migrated from the blob's deletedIds (id only — the element data is gone).
export const KIND_TO_FIELD = {
  el: "els",
  markup: "markups",
  measure: "measures",
  callout: "callouts",
  parcel: "parcels",
};
export const FIELD_TO_KIND = Object.fromEntries(
  Object.entries(KIND_TO_FIELD).map(([k, f]) => [f, k])
);
export const ELEMENT_FIELDS = Object.values(KIND_TO_FIELD);

// Migration z step: array position * Z_GAP, so reorders can insert between neighbors
// without renumbering (same rule as the SQL backfill — change BOTH or neither).
export const Z_GAP = 1024;

const arr = (x) => (Array.isArray(x) ? x : []);

// Explode a site model's element collections into site_elements-shaped rows.
// Tombstone-wins: an id listed in deletedIds is excluded from the live rows (matching
// mergeSiteContent's filter + the SQL backfill) and lands as a tombstone row instead.
// Returns { rows, problems }: problems lists items skipped for having no string id —
// callers must surface a non-empty problems list loudly (LOUD-FAILURE), never drop it.
export function explodeModel(model) {
  const m = model || {};
  const siteId = m.id || null;
  const dead = new Set(arr(m.deletedIds).filter((x) => typeof x === "string"));
  const rows = [];
  const problems = [];
  for (const [kind, field] of Object.entries(KIND_TO_FIELD)) {
    arr(m[field]).forEach((el, i) => {
      const id = el && typeof el.id === "string" ? el.id : null;
      if (!id) {
        problems.push({ kind, index: i, reason: "missing string id", value: el });
        return;
      }
      if (dead.has(id)) return; // tombstone-wins
      rows.push({
        site_id: siteId,
        id,
        kind,
        data: el,
        z_index: i * Z_GAP,
        rev: 1,
        deleted_at: null,
        deleted_by: null,
      });
    });
  }
  for (const id of dead) {
    rows.push({
      site_id: siteId,
      id,
      kind: "tombstone",
      data: null,
      z_index: 0,
      rev: 1,
      deleted_at: new Date().toISOString(),
      deleted_by: null,
    });
  }
  return { rows, problems };
}

// Stable row order for a collection rebuild: z_index, then id (plain lexicographic —
// matches the SQL `order by t.z_index, t.id`, collation-independent for our [a-z0-9_] ids).
export const byRowOrder = (a, b) =>
  (a.z_index || 0) - (b.z_index || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Rebuild a site model object from a slim header + site_elements rows (the B672 load
// shape). Collections come from LIVE rows in (z_index, id) order; deletedIds = the header's
// surviving (non-element) tombstones ∪ the rows' tombstoned ids, deduped + sorted —
// deletedIds is a SET, its order carries no meaning. Pure merge: callers still pass the
// result through migrate()/createSiteModel() for normalization.
export function rowsToModel(header, rows) {
  const h = header || {};
  const live = arr(rows).filter((r) => r && !r.deleted_at && r.data);
  const out = { ...h };
  for (const [kind, field] of Object.entries(KIND_TO_FIELD)) {
    out[field] = live
      .filter((r) => r.kind === kind)
      .sort(byRowOrder)
      .map((r) => r.data);
  }
  // deletedIds = header tombstones ∪ tombstoned-row ids, MINUS any id that still has a live
  // row of ANY kind. Under the composite (site,kind,id) key one id can be live in one
  // collection and tombstoned in another (the legacy e6327 class) — a stray tombstone must
  // never shadow a live element that happens to share its id.
  const liveIds = new Set(live.map((r) => r.id));
  const dead = new Set(arr(h.deletedIds).filter((x) => typeof x === "string"));
  for (const r of arr(rows)) if (r && r.deleted_at) dead.add(r.id);
  out.deletedIds = [...dead].filter((id) => !liveIds.has(id)).sort();
  return out;
}
