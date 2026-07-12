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

// B756 — DATA-LOSS FIX (recurrence of the B473 "new signed-in site's parcels vanish" class, regressed
// by the B672 read-cutover). Fold NEVER-SYNCED local-only elements back into the rows-canonical `next`
// so the refetch-replace can't wipe geometry the server has simply never seen. `rowKeys` is the set of
// `${kind}:${id}` for EVERY fetched row — LIVE and TOMBSTONE alike (fetchElements returns both). A local
// canvas element whose (kind,id) has NO row at all was born on this device and never reached
// site_elements — exactly the site just planned from the map, whose parcels live only in the slim
// header + local state — so keep it; the caller's reconcile then enqueues it as a create.
//
// Bounding the fold to zero-row (kind,id)s is what makes it SAFE:
//   • V229 #5 stale-tab clobber: a reconnecting stale tab holds OLD geometry only for elements that
//     ALREADY have rows → those ids are in rowKeys → excluded → the row is adopted, never re-committed.
//   • TOMBSTONE-DELETES: a remotely-deleted element has a TOMBSTONE row (its (kind,id) is in rowKeys) →
//     excluded → it stays deleted, never resurrected.
//   • per-tab salted ids (B591) make a folded create's id globally unique → no cross-writer collision.
// Husk parcels (no points) are never folded. Returns a NEW next object; inputs are untouched.
export function foldNeverSyncedLocal(next, local, rowKeys, isHusk = () => false) {
  const keys = rowKeys instanceof Set ? rowKeys : new Set(arr(rowKeys));
  const out = { ...(next || {}) };
  for (const [kind, field] of Object.entries(KIND_TO_FIELD)) {
    const base = arr(out[field]);
    const present = new Set(base.map((el) => el && el.id).filter(Boolean));
    const extra = arr(local && local[field]).filter((el) =>
      el && typeof el.id === "string"
      && !keys.has(kind + ":" + el.id)   // the server has never seen this exact element
      && !present.has(el.id)             // not already placed via rows / a pending (dirty) edit
      && !isHusk(kind, el));             // never fold a points-less husk parcel (B690)
    if (extra.length) out[field] = [...base, ...extra];
  }
  return out;
}

// NEW-F4 — fold the persisted pending-edit JOURNAL (elementJournal.js) over a rows-canonical
// rebuild. Companion to foldNeverSyncedLocal: that one protects elements the server has NEVER
// seen; this one protects newer-but-uncommitted edits to elements that ALREADY have rows —
// the "commit timed out, then the user reloaded" window where refetchReplace used to silently
// revert the canvas to the older server copy.
//
// Per entry ({ kind, id, cls, el, baseRev }), against the fetched row for (kind,id):
//   • update/create/restore, NO row            → fold `el` in (a create whose row never landed —
//     covers a cleared-state device where the B756 stateRef fold has nothing local to keep).
//   • update/…, row live, row.rev <= baseRev   → the row hasn't moved since this edit targeted
//     it: substitute `el` (the caller's reconcile diffs canvas-vs-shadow and re-enqueues the
//     commit; a genuine race from here resolves through the existing LWW/conflict matrix).
//   • row.rev > baseRev                        → a FOREIGN writer advanced it after our edit:
//     rows are canonical — DISCARD the entry (report via onDiscard; the 15-deep version ring
//     stays the manual recovery). Never re-commit stale geometry over a newer foreign row
//     (the V229 #5 stale-tab rule).
//   • delete entries: apply (remove from the fold) only where row.rev <= baseRev — a journaled
//     delete must not kill an element a foreign writer has since updated. This deliberately
//     diverges from the live-conflict "delete wins" matrix: a journal replays STALE intent
//     after an absence, so the safe default is keep-the-newer-edit. The un-deleted element
//     simply reappears on canvas (loud), and deleting it again takes one click.
//   • tombstoned row (deleted_at) counts as rev-advanced for updates: TOMBSTONE-DELETES — a
//     journaled update must not resurrect a remotely-deleted element unless its delete is
//     genuinely older than our edit's base (rare rev race; the tombstone row still wins by rev).
//   • husk parcels are never folded (B690).
// Pure: returns a NEW model object; inputs untouched. `rows` = the fetched site_elements rows.
export function foldJournal(next, journal, rows, { isHusk = () => false, onDiscard = () => {} } = {}) {
  const entries = arr(journal);
  if (!entries.length) return next;
  const rowByKey = new Map(arr(rows).filter((r) => r && r.id).map((r) => [r.kind + ":" + r.id, r]));
  const out = { ...(next || {}) };
  for (const e of entries) {
    const field = KIND_TO_FIELD[e && e.kind];
    if (!field || typeof (e && e.id) !== "string") continue;
    const row = rowByKey.get(e.kind + ":" + e.id);
    const baseRev = Number(e.baseRev) || 1;
    const isDelete = e.cls === "delete";
    const advanced = !!row && (Number(row.rev) || 1) > baseRev;
    if (advanced) { onDiscard(e, row); continue; } // foreign writer won — rows canonical
    if (isDelete) {
      if (!row) continue; // nothing to delete — the row never existed / already purged
      out[field] = arr(out[field]).filter((el) => !(el && el.id === e.id));
      continue;
    }
    const el = e.el;
    if (!el || typeof el.id !== "string" || isHusk(e.kind, el)) continue;
    const base = arr(out[field]);
    const i = base.findIndex((x) => x && x.id === e.id);
    out[field] = i >= 0 ? [...base.slice(0, i), el, ...base.slice(i + 1)] : [...base, el];
    // A journaled edit over a TOMBSTONED row (rev not advanced) is a restore of our own
    // newer edit — drop the id from deletedIds so the fold's element isn't re-filtered.
    if (row && row.deleted_at && Array.isArray(out.deletedIds))
      out.deletedIds = out.deletedIds.filter((id) => id !== e.id);
  }
  return out;
}
