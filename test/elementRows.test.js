import { describe, it, expect } from "vitest";
import {
  KIND_TO_FIELD,
  FIELD_TO_KIND,
  Z_GAP,
  explodeModel,
  rowsToModel,
  byRowOrder,
} from "../src/workspaces/site-planner/lib/elementRows.js";

// B666 — the JS mirror of the SQL explode (backfill) / rebuild (down-migration) must
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

  it("unions header-side deletedIds (overlay/drawing tombstones stay blob-side after B668)", () => {
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
