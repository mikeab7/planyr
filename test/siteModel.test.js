import { describe, it, expect } from "vitest";
import {
  createSiteModel, migrate, SITE_MODEL_VERSION, STATUSES,
  statusOf, parcelsOf, activeParcelsOf, utilitiesOf, annotationsOf,
  constraintsOf, setbacksOf, developableArea, parcelDrawingsOf,
  buildingNumbers, isBuilding, roadTravelWidth,
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

  it("accepts the legacy `elements` field as `els` (lossless back-compat)", () => {
    expect(createSiteModel({ elements: [{ id: "a" }] }).els).toEqual([{ id: "a" }]);
  });

  // B67 parcel-attached drawings: additive field, coerced + filterable by parcel.
  it("parcelDrawings: defaults to [], is coerced from non-arrays, and parcelDrawingsOf filters by parcel", () => {
    expect(createSiteModel().parcelDrawings).toEqual([]);
    expect(createSiteModel({ parcelDrawings: "bad" }).parcelDrawings).toEqual([]); // type-confusion guard
    const m = createSiteModel({ parcelDrawings: [{ id: "d1", parcelId: "p1" }, { id: "d2", parcelId: "p2" }] });
    expect(parcelDrawingsOf(m).length).toBe(2);
    expect(parcelDrawingsOf(m, "p1").map((d) => d.id)).toEqual(["d1"]);
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
