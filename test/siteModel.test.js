import { describe, it, expect } from "vitest";
import {
  createSiteModel, migrate, SITE_MODEL_VERSION, STATUSES,
  statusOf, parcelsOf, activeParcelsOf, utilitiesOf, annotationsOf,
  constraintsOf, setbacksOf, developableArea, parcelDrawingsOf,
  buildingNumbers, isBuilding, roadTravelWidth,
  parcelChildrenMap, parcelDescendants, parcelAncestors, lineageConflicts,
  parcelDisplayInfo, parcelOutline,
} from "../src/workspaces/site-planner/lib/siteModel.js";

describe("Site Model — schema, lifecycle status, selectors", () => {
  it("createSiteModel stamps the current version and safe empty defaults", () => {
    const m = createSiteModel();
    expect(m.schemaVersion).toBe(SITE_MODEL_VERSION);
    expect(m.parcels).toEqual([]);
    expect(m.els).toEqual([]);
    expect(m.markups).toEqual([]);
    expect(m.elevation).toEqual({ crossSections: [] });
    expect(m.constraints).toEqual({ liveLayers: [] });
  });

  it("accepts the legacy `elements` field as `els` (lossless back-compat + additive v12 z)", () => {
    // The element is carried over verbatim; createSiteModel additively assigns the v12 `z` (B671).
    expect(createSiteModel({ elements: [{ id: "a" }] }).els).toEqual([{ id: "a", z: 0 }]);
  });

  // B67 parcel-attached drawings: additive field, coerced + filterable by parcel.
  it("parcelDrawings: defaults to [], is coerced from non-arrays, and parcelDrawingsOf filters by parcel", () => {
    expect(createSiteModel().parcelDrawings).toEqual([]);
    expect(createSiteModel({ parcelDrawings: "bad" }).parcelDrawings).toEqual([]); // type-confusion guard
    const m = createSiteModel({ parcelDrawings: [{ id: "d1", parcelId: "p1" }, { id: "d2", parcelId: "p2" }] });
    expect(parcelDrawingsOf(m).length).toBe(2);
    expect(parcelDrawingsOf(m, "p1").map((d) => d.id)).toEqual(["d1"]);
  });

  // schema v9 — cross-module schedule link hint (additive, mirror of the schedule record).
  it("scheduleProjectId/Name: defaults to null and survives a create→migrate round-trip", () => {
    const fresh = createSiteModel();
    expect(fresh.scheduleProjectId).toBeNull();
    expect(fresh.scheduleProjectName).toBeNull();
    const linked = createSiteModel({ id: "p1", scheduleProjectId: 7, scheduleProjectName: "Pappadoupolos" });
    expect(linked.scheduleProjectId).toBe(7);
    expect(linked.scheduleProjectName).toBe("Pappadoupolos");
    // migrate is idempotent + lossless: the hint isn't dropped on re-normalize
    const round = migrate(linked);
    expect(round.scheduleProjectId).toBe(7);
    expect(round.scheduleProjectName).toBe("Pappadoupolos");
  });

  // B7/B8 lifecycle status defaulting — single source of truth, easy to regress.
  it("status: a brand-new record => pursuit; a pre-feature (older version) record => active", () => {
    expect(createSiteModel().status).toBe("pursuit");
    expect(createSiteModel({ schemaVersion: 1 }).status).toBe("active");
  });

  it("status: an explicit valid status is honored; a bogus value falls back", () => {
    expect(STATUSES).toContain("complete");
    expect(createSiteModel({ status: "complete" }).status).toBe("complete");
    expect(createSiteModel({ status: "nonsense" }).status).toBe("pursuit");
  });

  it("migrate is idempotent (normalize twice == once, ignoring the timestamp)", () => {
    const once = migrate({ id: "s1", parcels: [{ id: "p" }], status: "onhold" });
    const twice = migrate(once);
    const strip = (o) => ({ ...o, updatedAt: 0 });
    expect(strip(twice)).toEqual(strip(once));
  });

  it("selectors classify the flat markups array by meaning", () => {
    const m = createSiteModel({
      parcels: [{ id: "p1", setbacks: { front: 25 } }],
      markups: [
        { kind: "encumbrance", id: "e1" }, // title easement => constraint
        { kind: "utilRoute", id: "u1" },   // service route => utility
        { kind: "rect", id: "a1" },        // neutral annotation
      ],
      measures: [{ id: "m1" }],
      callouts: [{ id: "c1" }],
    });
    expect(statusOf(m)).toBe("pursuit");
    expect(parcelsOf(m)).toHaveLength(1);
    expect(utilitiesOf(m).map((x) => x.id)).toEqual(["u1"]);
    expect(constraintsOf(m).easements.map((x) => x.id)).toEqual(["e1"]);
    expect(annotationsOf(m).markups.map((x) => x.id)).toEqual(["a1"]);
    expect(annotationsOf(m).measures).toHaveLength(1);
    expect(annotationsOf(m).callouts).toHaveLength(1);
    expect(setbacksOf(m)).toEqual([{ id: "p1", setbacks: { front: 25 } }]);
  });

  it("developableArea is still the reserved stub (returns null, not a fabricated number)", () => {
    expect(developableArea(createSiteModel()).available).toBeNull();
  });

  // B100: only ACTIVE parcels drive the calcs; a missing `active` means active (back-compat),
  // so existing sites count every parcel until one is explicitly toggled off.
  it("activeParcelsOf excludes only explicitly-inactive parcels", () => {
    const m = createSiteModel({ parcels: [{ id: "a" }, { id: "b", active: true }, { id: "c", active: false }] });
    expect(parcelsOf(m).map((p) => p.id)).toEqual(["a", "b", "c"]); // all retained on the model
    expect(activeParcelsOf(m).map((p) => p.id)).toEqual(["a", "b"]); // c (active:false) excluded
  });

  // Type-confusion guard: a tampered/legacy/bad-sync record with a non-array collection must NOT
  // survive into the model (it would throw on .reduce/.map downstream and blank the whole app).
  it("coerces non-array collection fields to [] instead of keeping garbage", () => {
    const m = createSiteModel({ parcels: "oops", els: 42, markups: { bad: 1 }, measures: null, callouts: undefined, settings: "x" });
    expect(m.parcels).toEqual([]);
    expect(m.els).toEqual([]);
    expect(m.markups).toEqual([]);
    expect(m.measures).toEqual([]);
    expect(m.callouts).toEqual([]);
    expect(m.settings).toEqual({});
    // and the downstream that crashed (siteSqft = parcels.reduce(...)) is now safe:
    expect(() => m.parcels.reduce((s) => s, 0)).not.toThrow();
  });

  // B122 — buildings carry a sequential display number by placement order, derived from
  // list position (never stored). Deleting one renumbers the rest 1…N while every stable
  // id is untouched; dog-ear / bump-out pieces (type "building" + `dogEar`) are excluded.
  it("buildingNumbers: contiguous 1…N by placement order, excludes dog-ears, renumbers on delete", () => {
    const els = [
      { id: "e1", type: "building" },
      { id: "e2", type: "parking" },
      { id: "e3", type: "building" },
      { id: "e9", type: "building", dogEar: { side: "n", sign: 1 }, attachedTo: "e1" }, // bump-out, not a building
      { id: "e4", type: "building" },
    ];
    expect(isBuilding(els[0])).toBe(true);
    expect(isBuilding(els[3])).toBe(false); // dog-ear / bump-out is not a standalone building
    const n = buildingNumbers(els);
    expect(n.get("e1")).toBe(1);
    expect(n.get("e3")).toBe(2);
    expect(n.get("e4")).toBe(3);
    expect(n.has("e2")).toBe(false); // non-building element
    expect(n.has("e9")).toBe(false); // dog-ear excluded from numbering
    // delete the FIRST building (e1) → the rest renumber contiguously; ids never change
    const after = buildingNumbers(els.filter((e) => e.id !== "e1"));
    expect(after.get("e3")).toBe(1);
    expect(after.get("e4")).toBe(2);
    // a single building is still "Building 1"; bad input yields an empty map
    expect(buildingNumbers([{ id: "x", type: "building" }]).get("x")).toBe(1);
    expect(buildingNumbers(null).size).toBe(0);
  });

  // A road's dimension is derived from live geometry (cross − 2 curbs), so it tracks a resize
  // instead of showing a frozen value. Orientation-independent and never negative.
  it("roadTravelWidth derives travel width from current geometry", () => {
    expect(roadTravelWidth(60, 25, 0.5)).toBe(24); // cross 25 − 2×0.5 curb
    expect(roadTravelWidth(25, 60, 0.5)).toBe(24); // min(w,h), orientation-independent
    expect(roadTravelWidth(60, 40, 0.5)).toBe(39); // a wider road reads wider (tracks the resize)
    expect(roadTravelWidth(10, 1, 0.5)).toBe(0);   // clamped ≥ 0
  });
});

import { rectRoadEndpoints, roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";

describe("Centerline road migration (B596 / NEW-1)", () => {
  // A legacy axis-aligned road: 200′ long (w), 25′ cross (h) = 24′ travel + 0.5′ curb each side.
  const legacy = { id: "r1", type: "road", cx: 100, cy: 50, w: 200, h: 25, rot: 0, travelW: 24, curb: 0.5 };

  it("converts a legacy rect road to a 2-point centerline, preserving travel/curb", () => {
    const m = createSiteModel({ els: [legacy] });
    const r = m.els[0];
    expect(r.pts).toHaveLength(2);
    expect(r.vtx).toEqual([]);
    expect(r.travelW).toBe(24);
    expect(r.curb).toBe(0.5);
    expect(r.roadClass).toBe("aisle"); // DEFAULT_ROAD_CLASS
    // endpoints lie on the centerline (cy), 200′ apart, centred on cx
    expect(r.pts[0]).toEqual({ x: 0, y: 50 });
    expect(r.pts[1]).toEqual({ x: 200, y: 50 });
  });

  it("derives endpoints along the LONG axis for a rotated road", () => {
    const rot90 = { id: "r2", type: "road", cx: 0, cy: 0, w: 300, h: 25, rot: 90, travelW: 24, curb: 0.5 };
    const [a, b] = rectRoadEndpoints(rot90);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(300, 6); // length = w (the long axis)
  });

  it("is idempotent — a road that already has pts is left untouched", () => {
    const cl = { id: "r3", type: "road", pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
      vtx: [{}, { treatment: "arc" }, {}], travelW: 26, curb: 0.5, roadClass: "truck" };
    const once = createSiteModel({ els: [cl] }).els[0];
    expect(once.pts).toEqual(cl.pts);
    expect(once.roadClass).toBe("truck");
    const twice = createSiteModel({ els: [once] }).els[0];
    expect(twice.pts).toEqual(cl.pts);
  });

  it("leaves a BONDED dock-layer road (attachedTo) as a rect — relayout still owns it", () => {
    const bonded = { id: "r4", type: "road", attachedTo: "b1", cx: 10, cy: 10, w: 100, h: 25, rot: 0, travelW: 24, curb: 0.5 };
    const r = createSiteModel({ els: [bonded] }).els[0];
    expect(r.pts).toBeUndefined();
  });

  it("roadStripBBox returns a containing AABB (rot:0) around the strip", () => {
    const bb = roadStripBBox([{ x: 0, y: 0 }, { x: 100, y: 0 }], [], 24, 0.5);
    expect(bb.rot).toBe(0);
    expect(bb.w).toBeCloseTo(100, 6);     // length
    expect(bb.h).toBeCloseTo(25, 6);      // travel + 2 curbs
    expect(bb.cx).toBeCloseTo(50, 6);
  });
});

import { mergeSiteContent, toMs } from "../src/workspaces/site-planner/lib/siteModel.js";

describe("toMs + mergeSiteContent newer-wins is timestamp-type-safe (B559)", () => {
  it("toMs coerces an ISO string and a ms number to comparable ms", () => {
    expect(toMs(1718447000000)).toBe(1718447000000);
    expect(toMs("2025-06-15T10:30:00.000Z")).toBe(Date.parse("2025-06-15T10:30:00.000Z"));
    expect(toMs(null)).toBe(0);
    expect(toMs(undefined)).toBe(0);
    expect(toMs("not-a-date")).toBe(0);
  });

  it("picks the genuinely-newer copy even when one updatedAt is an ISO string and the other a number", () => {
    // Newer copy carries an ISO string; older carries a smaller ms number. Naive `string >= number`
    // is always false → would WRONGLY pick the older (number) copy and drop the newer's building.
    const older = { id: "s1", updatedAt: 1000, els: [{ id: "a", type: "building" }] };
    const newerIso = { id: "s1", updatedAt: "2025-06-15T10:30:00.000Z",
      els: [{ id: "a", type: "building" }, { id: "b", type: "building" }] };
    const merged = mergeSiteContent(older, newerIso);
    // Union keeps both buildings regardless; the point is `newer` resolves to the ISO copy for
    // scalar/meta — assert the merge ran without the type bug and kept all drawn work.
    expect(merged.els.map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(toMs(newerIso.updatedAt)).toBeGreaterThan(toMs(older.updatedAt));
  });
});

// B651 — parcel split lineage: `parentId` on children, derived superseded/naming, and the
// ancestor/descendant conflict set that the Active-toggle mutual-exclusion guard consumes.
describe("Parcel split lineage (B651)", () => {
  // Parcel 3 (id p3) split into 3A/3B; 3A split again into 3A1/3A2.
  const parcels = [
    { id: "p1", points: [] },
    { id: "p2", points: [] },
    { id: "p3", active: false, points: [] },     // superseded parent, kept inactive
    { id: "a", parentId: "p3", points: [] },     // 3A (also superseded — split again)
    { id: "a1", parentId: "a", points: [] },     // 3A1
    { id: "a2", parentId: "a", points: [] },     // 3A2
    { id: "b", parentId: "p3", points: [] },     // 3B
  ];

  it("parcelChildrenMap maps a present parent to its children in array order", () => {
    const kids = parcelChildrenMap(parcels);
    expect(kids.get("p3")).toEqual(["a", "b"]);
    expect(kids.get("a")).toEqual(["a1", "a2"]);
    expect(kids.has("b")).toBe(false);
    // an orphaned parentId (parent not present) is ignored
    expect(parcelChildrenMap([{ id: "x", parentId: "missing" }]).size).toBe(0);
  });

  it("descendants and ancestors walk the full lineage tree", () => {
    expect(parcelDescendants(parcels, "p3")).toEqual(new Set(["a", "a1", "a2", "b"]));
    expect(parcelDescendants(parcels, "a")).toEqual(new Set(["a1", "a2"]));
    expect(parcelAncestors(parcels, "a1")).toEqual(new Set(["a", "p3"]));
    expect(parcelAncestors(parcels, "p1")).toEqual(new Set());
  });

  it("lineageConflicts = ancestors ∪ descendants, excluding self and siblings", () => {
    // Activating 3A must deactivate its ancestor (p3) and its descendants (3A1, 3A2) — NOT sibling 3B.
    expect(lineageConflicts(parcels, "a")).toEqual(new Set(["p3", "a1", "a2"]));
    // Activating 3A1 conflicts with its whole ancestor chain, not its sibling 3A2.
    expect(lineageConflicts(parcels, "a1")).toEqual(new Set(["a", "p3"]));
    // Siblings never conflict.
    expect(lineageConflicts(parcels, "b")).toEqual(new Set(["p3"]));
  });

  it("cycle-guarded: a corrupt parentId cycle can't hang ancestor/descendant walks", () => {
    const bad = [{ id: "x", parentId: "y" }, { id: "y", parentId: "x" }];
    expect(() => parcelAncestors(bad, "x")).not.toThrow();
    expect(() => parcelDescendants(bad, "x")).not.toThrow();
    expect(parcelAncestors(bad, "x").has("y")).toBe(true);
  });

  it("parcelDisplayInfo derives lineage names (3 → 3A/3B → 3A1/3A2) and the superseded flag", () => {
    const info = parcelDisplayInfo(parcels);
    expect(info.get("p1").name).toBe("Parcel 1");
    expect(info.get("p3").name).toBe("Parcel 3");
    expect(info.get("p3").superseded).toBe(true);
    expect(info.get("a").name).toBe("Parcel 3A");   // depth 1 → letter
    expect(info.get("b").name).toBe("Parcel 3B");
    expect(info.get("a").superseded).toBe(true);
    expect(info.get("a1").name).toBe("Parcel 3A1"); // depth 2 → digit
    expect(info.get("a2").name).toBe("Parcel 3A2");
    expect(info.get("b").superseded).toBe(false);
  });

  it("a street address overrides the derived Parcel-N name", () => {
    const info = parcelDisplayInfo([{ id: "p1", addr: "123 Main St", points: [] }]);
    expect(info.get("p1").name).toBe("123 Main St");
  });

  it("parcelOutline nests each parcel's descendants right after it, with depth for indentation", () => {
    const order = parcelOutline(parcels);
    expect(order.map((o) => o.pc.id)).toEqual(["p1", "p2", "p3", "a", "a1", "a2", "b"]);
    const depth = Object.fromEntries(order.map((o) => [o.pc.id, o.depth]));
    expect(depth).toEqual({ p1: 0, p2: 0, p3: 0, a: 1, a1: 2, a2: 2, b: 1 });
  });
});

// B682 — id-less parcels (map-finder hand-off / legacy saves) get a stable, geometry-derived id at
// the createSiteModel funnel, so a dragged acreage-label offset can no longer spawn phantom copies
// through the cross-copy union merge.
describe("Stable parcel ids heal the acreage-label duplication (B682)", () => {
  const RING = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

  it("createSiteModel backfills a stable id for an id-less parcel, deterministically", () => {
    const a = createSiteModel({ parcels: [{ points: RING, locked: true }] }).parcels[0];
    const b = createSiteModel({ parcels: [{ points: RING, locked: true }] }).parcels[0];
    expect(a.id).toBeTruthy();
    expect(a.id).toBe(b.id); // same geometry → same id, run to run
    expect(a.locked).toBe(true); // other fields preserved
  });

  it("the id is derived from GEOMETRY only — a labelOffset edit does NOT change it", () => {
    const before = createSiteModel({ parcels: [{ points: RING }] }).parcels[0];
    const after = createSiteModel({ parcels: [{ points: RING, labelOffset: { x: 9, y: 9 } }] }).parcels[0];
    expect(after.id).toBe(before.id); // label-drag can't fork the identity anymore
  });

  it("genuinely-distinct parcels get distinct ids", () => {
    const shifted = RING.map((p) => ({ x: p.x + 500, y: p.y }));
    const m = createSiteModel({ parcels: [{ points: RING }, { points: shifted }] });
    expect(m.parcels[0].id).not.toBe(m.parcels[1].id);
  });

  it("an existing id is never rewritten (in-planner parcels carry a uid())", () => {
    const m = createSiteModel({ parcels: [{ id: "p_keepme", points: RING }] });
    expect(m.parcels[0].id).toBe("p_keepme");
  });

  it("REPRO: dragging an id-less parcel's label no longer duplicates it on merge", () => {
    const stored = { id: "s1", updatedAt: 1000, parcels: [{ points: RING, locked: true }] };
    const live = { id: "s1", updatedAt: 2000, parcels: [{ points: RING, locked: true, labelOffset: { x: 5, y: 5 } }] };
    const merged = mergeSiteContent(live, stored);
    expect(merged.parcels).toHaveLength(1);            // was 2 before the fix (the phantom copy)
    expect(merged.parcels[0].labelOffset).toEqual({ x: 5, y: 5 }); // the dragged position wins
  });

  it("exact-geometry id-less duplicates already persisted are collapsed to one (self-heal)", () => {
    // What the bug wrote to a record: the same parcel twice, one with the dragged offset.
    const m = createSiteModel({ parcels: [
      { points: RING, labelOffset: { x: 5, y: 5 } },
      { points: RING },
    ] });
    expect(m.parcels).toHaveLength(1);
    expect(m.parcels[0].labelOffset).toEqual({ x: 5, y: 5 }); // keeps the first (the edited one)
  });
});
