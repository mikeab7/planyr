// test/modelProjectRefs.test.js — lib/projectRefs.js (Model workspace, spreadsheet-live-data-refs):
// the project's OWN data (site plan + comps), exposed read-only as Site.*/Plan.*/Comp.* formula
// names. Exercises the REAL site-planner storage module (saveSite/loadSite) against a faked
// localStorage — same integration pattern test/storage.test.js already uses — rather than a
// snapshot fixture, so a change on either side of the wire shows up here (WRONG-CASE: a fixture
// built to make the mechanism observable is usually built to make the reported failure mode
// disappear — reading the REAL site model is what keeps this from becoming exactly that fixture).
import { describe, it, expect, beforeEach } from "vitest";
import { saveSite } from "../src/workspaces/site-planner/lib/storage.js";
import { buildProjectNames, RESERVED_NAME_PREFIXES } from "../src/workspaces/model/lib/projectRefs.js";
import { validateNameText } from "../src/workspaces/model/lib/namedRanges.js";
import { createSheet } from "../src/workspaces/model/lib/sheetModel.js";
import { isErrVal, FORMULA_ERRORS, isDate } from "../src/shared/formula/formula.js";

function fakeLocalStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

const SQUARE_1000 = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]; // 1,000,000 sf
const bld = (id, w, h) => ({ id, type: "building", cx: 0, cy: 0, w, h });

describe("buildProjectNames — Site.* / Plan.<building>.*", () => {
  beforeEach(() => { globalThis.localStorage = fakeLocalStorage(); });

  it("no project open → Site.Acres/Site.County read a real, injected #REF! (never a silent zero)", () => {
    const names = buildProjectNames(null);
    expect(names["site.acres"].value).toMatchObject({ k: "error", code: FORMULA_ERRORS.REF });
    expect(names["site.county"].value).toMatchObject({ k: "error", code: FORMULA_ERRORS.REF });
  });

  it("a project with NO parcels drawn yet also reads #REF!, never the naive siteAcres() 0", () => {
    saveSite({ id: "p1", site: "Empty Co", county: "harris", els: [] });
    const names = buildProjectNames("p1");
    expect(isErrVal(names["site.acres"].value)).toBe(true);
    expect(names["site.acres"].value.code).toBe(FORMULA_ERRORS.REF);
  });

  // Caught live (e2e/model-project-refs.spec.js) before this guard existed: a parcel that still
  // sits in the array but is DEACTIVATED (a split, a delete-and-undo, …) made `siteAcres` itself
  // return a genuine 0 — read straight through, that would have been the exact silent-zero this
  // feature exists to avoid, on a project that visibly HAS a parcel record.
  it("a project whose only parcel is deactivated also reads #REF!, never siteAcres()'s own 0", () => {
    saveSite({ id: "p1b", site: "Deactivated Co", county: "harris", parcels: [{ id: "a", points: SQUARE_1000, active: false }] });
    const names = buildProjectNames("p1b");
    expect(isErrVal(names["site.acres"].value)).toBe(true);
    expect(names["site.acres"].value.code).toBe(FORMULA_ERRORS.REF);
  });

  it("Site.Acres resolves the real dissolved acreage once a parcel is drawn", () => {
    saveSite({ id: "p2", site: "Real Co", county: "harris", parcels: [{ id: "a", points: SQUARE_1000, active: true }] });
    const names = buildProjectNames("p2");
    expect(names["site.acres"].value).toBeCloseTo(1000000 / 43560, 6);
    expect(names["site.acres"].name).toBe("Site.Acres");
  });

  it("Site.County reads the site's own stored (normalized) county key", () => {
    saveSite({ id: "p3", site: "Real Co", county: "Fort Bend", parcels: [{ id: "a", points: SQUARE_1000, active: true }] });
    const names = buildProjectNames("p3");
    expect(typeof names["site.county"].value).toBe("string");
    expect(names["site.county"].value.length).toBeGreaterThan(0);
  });

  it("Plan.Building<N>.SF/.Footprint are the SAME footprint figure (no second-story concept yet)", () => {
    saveSite({
      id: "p4", site: "Two Buildings", county: "harris",
      parcels: [{ id: "a", points: SQUARE_1000, active: true }],
      els: [bld("b1", 100, 200), bld("b2", 50, 40)],
    });
    const names = buildProjectNames("p4");
    expect(names["plan.building1.sf"].value).toBe(100 * 200);
    expect(names["plan.building1.footprint"].value).toBe(100 * 200);
    expect(names["plan.building2.sf"].value).toBe(50 * 40);
  });

  it("a building index past the current count is simply NOT injected (falls to the engine's own #NAME?, never a special-cased error)", () => {
    saveSite({ id: "p5", site: "One Building", county: "harris", parcels: [{ id: "a", points: SQUARE_1000, active: true }], els: [bld("b1", 10, 10)] });
    const names = buildProjectNames("p5");
    expect(names["plan.building2.sf"]).toBeUndefined();
  });

  it("deleting/renumbering buildings changes which building a positional name addresses (the disclosed rename contract)", () => {
    saveSite({ id: "p6", site: "Two Buildings", county: "harris", parcels: [{ id: "a", points: SQUARE_1000, active: true }], els: [bld("b1", 10, 10), bld("b2", 20, 20)] });
    expect(buildProjectNames("p6")["plan.building2.sf"].value).toBe(20 * 20);
    // Deleting Building 1 renumbers what used to be Building 2 down to Building 1.
    saveSite({ id: "p6", els: [bld("b2", 20, 20)] });
    expect(buildProjectNames("p6")["plan.building2.sf"]).toBeUndefined();
    expect(buildProjectNames("p6")["plan.building1.sf"].value).toBe(20 * 20);
  });
});

describe("buildProjectNames — Comp.<title>.*", () => {
  beforeEach(() => { globalThis.localStorage = fakeLocalStorage(); });
  const lease = (over = {}) => ({ projectId: "proj1", title: "123 Main St", compType: "lease", leaseRate: 8.5, leaseSizeSf: 50000, compDate: "2026-05-01", ...over });

  it("a lease comp's RentPSF/SizeSF/Date all resolve to real values, addressed by its sanitized title", () => {
    const names = buildProjectNames("proj1", { comps: [lease()] });
    const base = "comp.123mainst";
    expect(names[`${base}.rentpsf`].value).toBe(8.5);
    expect(names[`${base}.sizesf`].value).toBe(50000);
    expect(isDate(names[`${base}.date`].value)).toBe(true);
  });

  it("RentPSF on a non-lease comp is #N/A, never a silent zero or the wrong field", () => {
    const names = buildProjectNames("proj1", { comps: [lease({ compType: "land", leaseRate: undefined })] });
    expect(names["comp.123mainst.rentpsf"].value).toMatchObject({ k: "error", code: FORMULA_ERRORS.NA });
  });

  it("a comp with no executed date yet is #N/A, not a wrong/zero date", () => {
    const names = buildProjectNames("proj1", { comps: [lease({ compDate: null })] });
    expect(names["comp.123mainst.date"].value).toMatchObject({ k: "error", code: FORMULA_ERRORS.NA });
  });

  it("a comp belonging to a DIFFERENT project is never injected here", () => {
    const names = buildProjectNames("proj1", { comps: [lease({ projectId: "other-project" })] });
    expect(names["comp.123mainst.rentpsf"]).toBeUndefined();
  });

  it("an untitled comp is not addressable by name at all", () => {
    const names = buildProjectNames("proj1", { comps: [lease({ title: "" })] });
    expect(Object.keys(names).some((k) => k.startsWith("comp."))).toBe(false);
  });

  it("two comps sharing a title (or sanitizing to the same identifier) are an ambiguity — LOUD #REF!, never a silent pick", () => {
    const names = buildProjectNames("proj1", {
      comps: [lease({ title: "123 Main St" }), lease({ title: "123-Main-St", leaseRate: 9.0 })], // sanitizes to the same segment
    });
    const entry = names["comp.123mainst.rentpsf"];
    expect(entry.value).toMatchObject({ k: "error", code: FORMULA_ERRORS.REF });
  });

  it("renaming a comp's title breaks the OLD name and starts resolving the new one", () => {
    const before = buildProjectNames("proj1", { comps: [lease({ title: "Old Name" })] });
    expect(before["comp.oldname.rentpsf"].value).toBe(8.5);
    const after = buildProjectNames("proj1", { comps: [lease({ title: "New Name" })] });
    expect(after["comp.oldname.rentpsf"]).toBeUndefined();
    expect(after["comp.newname.rentpsf"].value).toBe(8.5);
  });
});

describe("RESERVED_NAME_PREFIXES — a user can never define a name that shadows a project reference", () => {
  it.each(RESERVED_NAME_PREFIXES)("rejects a user name starting with \"%s.\"", (prefix) => {
    const r = validateNameText(`${prefix}.Foo`, createSheet());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(new RegExp(prefix, "i"));
  });
  it("is case-insensitive", () => {
    expect(validateNameText("site.Foo", createSheet()).ok).toBe(false);
    expect(validateNameText("SITE.FOO", createSheet()).ok).toBe(false);
  });
  it("does not reject a name that merely CONTAINS a reserved word, only one that STARTS with prefix + \".\"", () => {
    expect(validateNameText("MySite", createSheet()).ok).toBe(true);
    expect(validateNameText("Site", createSheet()).ok).toBe(true); // bare word, no dot — not reserved
  });
});
