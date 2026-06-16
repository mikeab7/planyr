import { describe, it, expect } from "vitest";
import {
  createSiteModel, migrate, SITE_MODEL_VERSION, STATUSES,
  statusOf, parcelsOf, activeParcelsOf, utilitiesOf, annotationsOf,
  constraintsOf, setbacksOf, developableArea,
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
});
