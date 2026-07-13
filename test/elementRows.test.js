import { describe, it, expect } from "vitest";
import {
  KIND_TO_FIELD,
  FIELD_TO_KIND,
  Z_GAP,
  explodeModel,
  rowsToModel,
  byRowOrder,
  foldNeverSyncedLocal,
} from "../src/workspaces/site-planner/lib/elementRows.js";

// B670 — the JS mirror of the SQL explode (backfill) / rebuild (down-migration) must
// round-trip a site model with NOTHING lost: element count and ids identical, array order
// preserved via z_index, deletedIds present as tombstones. This is the permanent guard on
// the row↔blob equivalence the one-time SQL fidelity check proved on live data.

const fixture = () => ({
  id: "site-a",
  name: "Concept A",
  els: [
    { id: "e1", type: "building", cx: 100, cy: 200, w: 400, h: 240, rot: 0 }, // legacy numeric-only id
    { id: "e2abcdef", type: "road", pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }], travelW: 24 },
    { id: "e3abcdef", type: "parking", cx: 300, cy: 80, w: 180, h: 60, rot: 90 },
  ],
  markups: [{ id: "m1", kind: "polyline", pts: [{ x: 1, y: 2 }] }],
  measures: [{ id: "d1", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }],
  callouts: [{ id: "c1", text: "note", x: 5, y: 5 }],
  parcels: [{ id: "psite-a_0", ring: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }],
  deletedIds: ["ghost-1", "ghost-2"],
  settings: { grid: true }, // header-side — must never explode into rows
});

describe("explodeModel — blob → rows (mirror of site_elements_backfill.sql)", () => {
  it("explodes every collection with kind, verbatim data, and z = index * Z_GAP", () => {
    const { rows, problems } = explodeModel(fixture());
    expect(problems).toEqual([]);
    const live = rows.filter((r) => !r.deleted_at);
    expect(live).toHaveLength(7); // 3 els + 1 markup + 1 measure + 1 callout + 1 parcel
    const road = live.find((r) => r.id === "e2abcdef");
    expect(road.kind).toBe("el");
    expect(road.z_index).toBe(1 * Z_GAP);
    expect(road.data).toEqual(fixture().els[1]); // verbatim, unmodified
    expect(road.rev).toBe(1);
    expect(live.find((r) => r.id === "m1").kind).toBe("markup");
    expect(live.find((r) => r.id === "psite-a_0").kind).toBe("parcel");
    for (const r of rows) expect(r.site_id).toBe("site-a");
  });

  it("converts deletedIds into tombstone rows (deletion syncs as a fact, not an absence)", () => {
    const { rows } = explodeModel(fixture());
    const tombs = rows.filter((r) => r.deleted_at);
    expect(tombs.map((r) => r.id).sort()).toEqual(["ghost-1", "ghost-2"]);
    for (const t of tombs) {
      expect(t.kind).toBe("tombstone");
      expect(t.data).toBeNull();
    }
  });

  it("tombstone-wins: an id in BOTH a collection and deletedIds becomes a tombstone, not a live row", () => {
    const m = fixture();
    m.deletedIds = ["e1", "ghost-1"];
    const { rows } = explodeModel(m);
    const e1 = rows.filter((r) => r.id === "e1");
    expect(e1).toHaveLength(1);
    expect(e1[0].deleted_at).toBeTruthy(); // matches mergeSiteContent + the SQL backfill filter
  });

  it("reports id-less items as problems instead of silently dropping them (LOUD-FAILURE feed)", () => {
    const m = fixture();
    m.els.push({ type: "building", cx: 1, cy: 1 }); // no id
    const { rows, problems } = explodeModel(m);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "el", index: 3, reason: "missing string id" });
    expect(rows.filter((r) => r.kind === "el" && !r.deleted_at)).toHaveLength(3);
  });

  it("handles empty and missing collections", () => {
    const { rows, problems } = explodeModel({ id: "s", els: [], deletedIds: [] });
    expect(rows).toEqual([]);
    expect(problems).toEqual([]);
  });
});

describe("rowsToModel — rows → model (mirror of site_elements_down.sql)", () => {
  it("round-trips: rowsToModel(header, explodeModel(m).rows) reproduces every collection in order", () => {
    const m = fixture();
    const { rows } = explodeModel(m);
    const header = { id: m.id, name: m.name, settings: m.settings, deletedIds: [] };
    const back = rowsToModel(header, rows);
    expect(back.els).toEqual(m.els); // ids, order, and content identical
    expect(back.markups).toEqual(m.markups);
    expect(back.measures).toEqual(m.measures);
    expect(back.callouts).toEqual(m.callouts);
    expect(back.parcels).toEqual(m.parcels);
    expect(back.deletedIds).toEqual([...m.deletedIds].sort()); // set semantics
    expect(back.settings).toEqual(m.settings); // header fields ride through
  });

  it("orders a collection by (z_index, id) — z gaps from reorders still rebuild deterministically", () => {
    const rows = [
      { site_id: "s", id: "b", kind: "el", data: { id: "b" }, z_index: 512, rev: 3 },
      { site_id: "s", id: "a", kind: "el", data: { id: "a" }, z_index: 0, rev: 1 },
      { site_id: "s", id: "c", kind: "el", data: { id: "c" }, z_index: 512, rev: 2 }, // z tie → id breaks it
    ];
    const back = rowsToModel({ id: "s" }, rows);
    expect(back.els.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("tombstoned rows are excluded from collections and land in deletedIds", () => {
    const rows = [
      { site_id: "s", id: "e1", kind: "el", data: { id: "e1" }, z_index: 0, rev: 1 },
      { site_id: "s", id: "e2", kind: "el", data: { id: "e2" }, z_index: Z_GAP, rev: 2, deleted_at: "2026-07-06T00:00:00Z" },
      { site_id: "s", id: "ghost", kind: "tombstone", data: null, z_index: 0, rev: 1, deleted_at: "2026-07-06T00:00:00Z" },
    ];
    const back = rowsToModel({ id: "s" }, rows);
    expect(back.els.map((e) => e.id)).toEqual(["e1"]);
    expect(back.deletedIds).toEqual(["e2", "ghost"]);
  });

  it("unions header-side deletedIds (overlay/drawing tombstones stay blob-side after B672)", () => {
    const back = rowsToModel({ id: "s", deletedIds: ["overlay-1"] }, [
      { site_id: "s", id: "e2", kind: "el", data: null, z_index: 0, rev: 2, deleted_at: "2026-07-06T00:00:00Z" },
    ]);
    expect(back.deletedIds).toEqual(["e2", "overlay-1"]);
  });

  it("a tombstoned id that is ALSO live under another kind is NOT put in deletedIds (composite-key safety)", () => {
    // legacy e6327 shared by a live el and a stray tombstone — the tombstone must not shadow the live el
    const back = rowsToModel({ id: "s" }, [
      { site_id: "s", id: "e6327", kind: "el", data: { id: "e6327", type: "building" }, z_index: 0, rev: 1 },
      { site_id: "s", id: "e6327", kind: "tombstone", data: null, z_index: 0, rev: 1, deleted_at: "2026-07-06T00:00:00Z" },
    ]);
    expect(back.els.map((e) => e.id)).toEqual(["e6327"]);
    expect(back.deletedIds).toEqual([]);
  });
});

describe("composite-key collision (the live e6327 el+markup case that chose Option A)", () => {
  it("explodes one id shared across two collections into two distinct-kind rows, and round-trips both", () => {
    const m = {
      id: "smqh3au6aeb4",
      els: [{ id: "e6327", type: "building", cx: 1, cy: 2, w: 3, h: 4 }],
      markups: [{ id: "e6327", kind: "polyline", pts: [{ x: 0, y: 0 }] }],
      deletedIds: [],
    };
    const { rows, problems } = explodeModel(m);
    expect(problems).toEqual([]);
    const e6327 = rows.filter((r) => r.id === "e6327" && !r.deleted_at);
    expect(e6327.map((r) => r.kind).sort()).toEqual(["el", "markup"]); // both survive
    const back = rowsToModel({ id: m.id, deletedIds: [] }, rows);
    expect(back.els).toEqual(m.els);
    expect(back.markups).toEqual(m.markups);
  });
});

describe("mapping tables", () => {
  it("KIND_TO_FIELD and FIELD_TO_KIND are exact inverses over the 5 vector collections", () => {
    expect(Object.keys(KIND_TO_FIELD).sort()).toEqual(["callout", "el", "markup", "measure", "parcel"]);
    for (const [kind, field] of Object.entries(KIND_TO_FIELD)) expect(FIELD_TO_KIND[field]).toBe(kind);
  });

  it("byRowOrder sorts by z_index then id without locale surprises", () => {
    const rows = [{ id: "e10", z_index: 0 }, { id: "e2", z_index: 0 }, { id: "e1", z_index: -1 }];
    expect([...rows].sort(byRowOrder).map((r) => r.id)).toEqual(["e1", "e10", "e2"]); // plain lexicographic, like SQL
  });
});

// B756 — the never-synced local-only fold that stops refetch-replace from wiping a brand-new signed-in
// site's parcels (parcels that only ever reached localStorage + the slim cloud header, never site_elements).
describe("foldNeverSyncedLocal (B756 data-loss guard)", () => {
  const parcel = (id) => ({ id, points: [[0, 0], [10, 0], [10, 10]], locked: true });
  const husk = (kind) => ({ kind }); // firstArg matches isHuskParcel(kind, el)
  const isHuskParcel = (kind, el) => kind === "parcel" && !(el && Array.isArray(el.points) && el.points.length);
  const emptyNext = () => ({ els: [], markups: [], measures: [], callouts: [], parcels: [] });

  it("folds a never-synced local parcel (no row at all) into next so it survives the wipe", () => {
    const local = { ...emptyNext(), parcels: [parcel("psX_0"), parcel("psX_1")] };
    const out = foldNeverSyncedLocal(emptyNext(), local, new Set(), isHuskParcel);
    expect(out.parcels.map((p) => p.id)).toEqual(["psX_0", "psX_1"]); // both kept — refetch fetched 0 rows
  });

  it("does NOT fold a parcel that already has a LIVE row (rows stay canonical — no V229 re-commit)", () => {
    const local = { ...emptyNext(), parcels: [parcel("psX_0")] };
    const out = foldNeverSyncedLocal(emptyNext(), local, new Set(["parcel:psX_0"]), isHuskParcel);
    expect(out.parcels).toEqual([]); // the row is authoritative; the stale local copy is dropped
  });

  it("does NOT resurrect a parcel that has a TOMBSTONE row (delete stays a delete)", () => {
    // rowKeys is built from LIVE + TOMBSTONE rows, so a remotely-deleted parcel's (kind,id) is present.
    const local = { ...emptyNext(), parcels: [parcel("psX_0")] };
    const out = foldNeverSyncedLocal(emptyNext(), local, new Set(["parcel:psX_0"]), isHuskParcel);
    expect(out.parcels).toEqual([]);
  });

  it("never folds a husk parcel (no points)", () => {
    const local = { ...emptyNext(), parcels: [husk("parcel")] };
    const out = foldNeverSyncedLocal(emptyNext(), local, new Set(), isHuskParcel);
    expect(out.parcels).toEqual([]);
  });

  it("does not duplicate an id already present in next (e.g. re-substituted via a dirty create)", () => {
    const next = { ...emptyNext(), parcels: [parcel("psX_0")] };
    const local = { ...emptyNext(), parcels: [parcel("psX_0")] };
    const out = foldNeverSyncedLocal(next, local, new Set(), isHuskParcel);
    expect(out.parcels.map((p) => p.id)).toEqual(["psX_0"]);
  });

  it("folds never-synced local-only elements across ALL five collections, not just parcels", () => {
    const local = {
      els: [{ id: "e1s" }], markups: [{ id: "m1s" }], measures: [{ id: "z1s" }],
      callouts: [{ id: "c1s" }], parcels: [parcel("p1s")],
    };
    const out = foldNeverSyncedLocal(emptyNext(), local, new Set(), isHuskParcel);
    expect(out.els.map((x) => x.id)).toEqual(["e1s"]);
    expect(out.markups.map((x) => x.id)).toEqual(["m1s"]);
    expect(out.measures.map((x) => x.id)).toEqual(["z1s"]);
    expect(out.callouts.map((x) => x.id)).toEqual(["c1s"]);
    expect(out.parcels.map((x) => x.id)).toEqual(["p1s"]);
  });

  it("keys by (kind,id): a live row under a DIFFERENT kind does not block a local element", () => {
    // legacy e6327 class — an id live as a markup must not exclude a genuinely-new parcel sharing the id.
    const local = { ...emptyNext(), parcels: [parcel("e6327")] };
    const out = foldNeverSyncedLocal(emptyNext(), local, new Set(["markup:e6327"]), isHuskParcel);
    expect(out.parcels.map((p) => p.id)).toEqual(["e6327"]); // parcel:e6327 has no row → folded
  });

  it("returns a fresh object without mutating next or local", () => {
    const next = emptyNext();
    const local = { ...emptyNext(), parcels: [parcel("psX_0")] };
    const out = foldNeverSyncedLocal(next, local, new Set(), isHuskParcel);
    expect(next.parcels).toEqual([]); // input untouched
    expect(out).not.toBe(next);
  });
});

/* NEW-F4 — foldJournal: the persisted pending-edit journal folded over a rows-canonical
 * rebuild. Protects a newer-but-uncommitted edit to an ALREADY-synced element across a reload
 * (the "commit timed out → reload → refetch reverts the canvas" silent-overwrite window).
 * Rev discipline: fold only where row.rev <= baseRev; a foreign-advanced row wins (V229 #5). */
import { foldJournal } from "../src/workspaces/site-planner/lib/elementRows.js";

describe("foldJournal (NEW-F4 pending-edit journal)", () => {
  const emptyModel = () => ({ els: [], markups: [], measures: [], callouts: [], parcels: [] });
  const isHuskParcel = (kind, el) => kind === "parcel" && !(el && (el.ring || el.points || []).length >= 3);
  const row = (kind, id, rev, extra = {}) => ({ kind, id, rev, deleted_at: null, data: { id }, ...extra });

  it("substitutes a journaled update whose row has NOT advanced (rev == baseRev)", () => {
    const next = { ...emptyModel(), els: [{ id: "e1", w: 100 }] };
    const j = [{ kind: "el", id: "e1", cls: "update", el: { id: "e1", w: 999 }, baseRev: 3 }];
    const out = foldJournal(next, j, [row("el", "e1", 3)]);
    expect(out.els).toEqual([{ id: "e1", w: 999 }]); // the newer local edit survives the rebuild
  });

  it("DISCARDS a journaled update when a foreign writer advanced the row (rev > baseRev)", () => {
    const discarded = [];
    const next = { ...emptyModel(), els: [{ id: "e1", w: 100 }] };
    const j = [{ kind: "el", id: "e1", cls: "update", el: { id: "e1", w: 999 }, baseRev: 3 }];
    const out = foldJournal(next, j, [row("el", "e1", 5)], { onDiscard: (e) => discarded.push(e.id) });
    expect(out.els).toEqual([{ id: "e1", w: 100 }]); // rows canonical — stale intent never re-commits (V229 #5)
    expect(discarded).toEqual(["e1"]);               // and the discard is LOUD, not silent
  });

  it("folds a journaled create whose row never landed (no row at all)", () => {
    const j = [{ kind: "parcel", id: "p1", cls: "create", el: { id: "p1", ring: [1, 2, 3] }, baseRev: 1 }];
    const out = foldJournal(emptyModel(), j, []);
    expect(out.parcels.map((p) => p.id)).toEqual(["p1"]);
  });

  it("applies a journaled delete only while the row hasn't advanced", () => {
    const next = { ...emptyModel(), els: [{ id: "e1" }, { id: "e2" }] };
    const j = [
      { kind: "el", id: "e1", cls: "delete", baseRev: 2 }, // row still at rev 2 → delete applies
      { kind: "el", id: "e2", cls: "delete", baseRev: 2 }, // row advanced to 4 → foreign edit wins, delete dropped
    ];
    const out = foldJournal(next, j, [row("el", "e1", 2), row("el", "e2", 4)]);
    expect(out.els.map((x) => x.id)).toEqual(["e2"]);
  });

  it("a journaled delete with NO row is a no-op (already purged / never created)", () => {
    const next = { ...emptyModel(), els: [{ id: "e1" }] };
    const out = foldJournal(next, [{ kind: "el", id: "ghost", cls: "delete", baseRev: 1 }], []);
    expect(out.els.map((x) => x.id)).toEqual(["e1"]);
  });

  it("never resurrects a remotely-deleted element: a tombstone row with an advanced rev wins", () => {
    // The commit_elements delete always bumps rev, so a foreign delete lands as rev > baseRev.
    const j = [{ kind: "el", id: "e1", cls: "update", el: { id: "e1", w: 999 }, baseRev: 3 }];
    const out = foldJournal(emptyModel(), j, [row("el", "e1", 4, { deleted_at: "2026-07-12T00:00:00Z", data: null })]);
    expect(out.els).toEqual([]); // TOMBSTONE-DELETES — the delete sticks
  });

  it("never folds a husk parcel, and tolerates malformed entries", () => {
    const j = [
      { kind: "parcel", id: "husk1", cls: "update", el: { id: "husk1", ring: [] }, baseRev: 1 },
      { kind: "nope", id: "x", cls: "update", el: { id: "x" }, baseRev: 1 },
      null,
      { kind: "el", cls: "update", el: {}, baseRev: 1 }, // no id
    ];
    const out = foldJournal(emptyModel(), j, [], { isHusk: isHuskParcel });
    expect(out.parcels).toEqual([]);
    expect(out.els).toEqual([]);
  });

  it("an empty journal returns the input untouched (same reference — zero cost steady state)", () => {
    const next = emptyModel();
    expect(foldJournal(next, [], [])).toBe(next);
    expect(foldJournal(next, null, [])).toBe(next);
  });


  it("skipKeys: a LIVE in-memory pending edit always beats the journal (never overridden by a stale snapshot)", () => {
    const next = { ...emptyModel(), els: [{ id: "e1", w: 555 }] }; // the fresher dirty edit, already substituted
    const j = [{ kind: "el", id: "e1", cls: "update", el: { id: "e1", w: 111 }, baseRev: 3 }]; // stale journal
    const out = foldJournal(next, j, [row("el", "e1", 3)], { skipKeys: new Set(["el:e1"]) });
    expect(out.els).toEqual([{ id: "e1", w: 555 }]); // the live edit survives; the stale entry is skipped
  });

  it("does not mutate its inputs", () => {
    const next = { ...emptyModel(), els: [{ id: "e1", w: 100 }] };
    const j = [{ kind: "el", id: "e1", cls: "update", el: { id: "e1", w: 999 }, baseRev: 3 }];
    const out = foldJournal(next, j, [row("el", "e1", 3)]);
    expect(next.els[0].w).toBe(100);
    expect(out).not.toBe(next);
  });
});

/* B759 (×2) — reconcileSeedRows: guard the refetch-replace re-seed against a STALE fetch that predates
 * a batch THIS tab just committed. A row our shadow holds a NEWER rev for is replaced by our committed
 * version (so a resized building's bonded sidewalk/paving can't be reverted = "separating"); everything
 * else — foreign-advanced rows, tombstones, rows we never touched — passes through (V229 #5 preserved). */
import { reconcileSeedRows } from "../src/workspaces/site-planner/lib/elementRows.js";

describe("reconcileSeedRows (B759 ×2 — stale-refetch revert guard)", () => {
  const shadowOf = (entries) => new Map(entries.map((e) => [e.kind + ":" + e.id, e]));
  const jstr = (o) => JSON.stringify({ ...o }); // shadow stores stableStringify; JSON.parse round-trips either way
  const row = (kind, id, rev, data, extra = {}) => ({ kind, id, rev, z_index: 0, deleted_at: null, data, ...extra });

  it("replaces a STALE fetched row (shadow rev > row rev) with our committed data + rev", () => {
    const shadow = shadowOf([{ kind: "el", id: "sw1", json: jstr({ id: "sw1", cx: 140 }), rev: 5, z: 7 }]);
    const out = reconcileSeedRows([row("el", "sw1", 4, { id: "sw1", cx: 100 })], shadow);
    expect(out[0].data).toEqual({ id: "sw1", cx: 140 }); // our just-committed move, not the stale cx:100
    expect(out[0].rev).toBe(5);
    expect(out[0].z_index).toBe(7);
  });

  // B812 red-team (Angle 1): a delete clears the shadow entry, so a stale fetch that still shows the
  // element ALIVE (predating the delete) would be adopted verbatim → RESURRECTION + a later false
  // "was deleted by you (another window)". reconcileSeedRows now honours the engine's delete floor.
  const tombOf = (entries) => new Map(entries.map((t) => [t.kind + ":" + t.id, { rev: t.rev, at: 0 }]));
  it("keeps a fetched-ALIVE row DELETED when this tab tombstoned it at a rev no older than the fetch (no resurrection)", () => {
    const out = reconcileSeedRows([row("el", "pv", 5, { id: "pv", w: 10 })], new Map(), tombOf([{ kind: "el", id: "pv", rev: 6 }]));
    expect(out[0].deleted_at).toBeTruthy(); // rewritten to a tombstone
    expect(out[0].data).toBeNull();
  });
  it("a GENUINE re-create ABOVE our delete's rev passes through ALIVE (delete floor doesn't over-suppress)", () => {
    const out = reconcileSeedRows([row("el", "pv", 9, { id: "pv", w: 77 })], new Map(), tombOf([{ kind: "el", id: "pv", rev: 6 }]));
    expect(out[0].deleted_at).toBeNull();          // higher rev than our delete → a real re-add
    expect(out[0].data).toEqual({ id: "pv", w: 77 });
  });
  it("no tombstone for the key → alive row untouched (back-compat when no tombstones passed)", () => {
    const out = reconcileSeedRows([row("el", "pv", 5, { id: "pv", w: 10 })], new Map());
    expect(out[0].deleted_at).toBeNull();
    expect(out[0].data).toEqual({ id: "pv", w: 10 });
  });

  it("keeps the fetched row when the shadow rev EQUALS the row rev (fetch already current)", () => {
    const shadow = shadowOf([{ kind: "el", id: "e1", json: jstr({ id: "e1", cx: 9 }), rev: 5, z: 0 }]);
    const out = reconcileSeedRows([row("el", "e1", 5, { id: "e1", cx: 100 })], shadow);
    expect(out[0].data).toEqual({ id: "e1", cx: 100 }); // rows canonical — no override
  });

  it("keeps a FOREIGN-advanced row (row rev > shadow rev) — V229 #5 stale-tab clobber guard", () => {
    const shadow = shadowOf([{ kind: "el", id: "e1", json: jstr({ id: "e1", cx: 140 }), rev: 5, z: 0 }]);
    const out = reconcileSeedRows([row("el", "e1", 9, { id: "e1", cx: 999 })], shadow);
    expect(out[0].data).toEqual({ id: "e1", cx: 999 }); // a later foreign write wins, never clobbered
    expect(out[0].rev).toBe(9);
  });

  it("never overrides a TOMBSTONE row, even if the shadow holds a live newer rev (no resurrection)", () => {
    const shadow = shadowOf([{ kind: "el", id: "e1", json: jstr({ id: "e1", cx: 140 }), rev: 9, z: 0 }]);
    const out = reconcileSeedRows([row("el", "e1", 4, null, { deleted_at: "2026-07-13T00:00:00Z" })], shadow);
    expect(out[0].deleted_at).toBe("2026-07-13T00:00:00Z"); // TOMBSTONE-DELETES — the delete stands
    expect(out[0].data).toBeNull();
  });

  it("leaves a row absent from the shadow untouched (foldNeverSyncedLocal / delete paths own it)", () => {
    const out = reconcileSeedRows([row("el", "new1", 1, { id: "new1", cx: 1 })], new Map());
    expect(out[0].data).toEqual({ id: "new1", cx: 1 });
  });

  it("tolerates a malformed shadow json (keeps the fetched row, never throws)", () => {
    const shadow = new Map([["el:e1", { kind: "el", id: "e1", json: "{not json", rev: 9, z: 0 }]]);
    const out = reconcileSeedRows([row("el", "e1", 4, { id: "e1", cx: 100 })], shadow);
    expect(out[0].data).toEqual({ id: "e1", cx: 100 });
  });

  it("empty / non-Map inputs pass through harmlessly", () => {
    expect(reconcileSeedRows([], new Map())).toEqual([]);
    expect(reconcileSeedRows(null, null)).toEqual([]);
    const r = [row("el", "e1", 4, { id: "e1" })];
    expect(reconcileSeedRows(r, undefined)).toEqual(r); // no shadow → nothing to reconcile
  });

  it("does not mutate the input rows", () => {
    const shadow = shadowOf([{ kind: "el", id: "e1", json: jstr({ id: "e1", cx: 140 }), rev: 5, z: 0 }]);
    const rows = [row("el", "e1", 4, { id: "e1", cx: 100 })];
    const out = reconcileSeedRows(rows, shadow);
    expect(rows[0].data).toEqual({ id: "e1", cx: 100 }); // original untouched
    expect(out[0]).not.toBe(rows[0]);
  });
});
