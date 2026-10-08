/* Parcels rework (NEW-2) — where a parcel came from, in the words the list row and the page use.
 * A real Combine result has no county attrs and no `source`, so the old rule read it as "Drawn by hand". (Goose Creek Phase II "Parcel 1" WAS a combine result made before PR #2082; db/combined_madefrom_backfill_20261008.sql gave it the record. "Drawn" now needs positive evidence — otherwise no source line, B2191xxx.) */
import { describe, it, expect } from "vitest";
import { parcelOrigin, originKind, combinedCount, cadNameOf, ORIGIN_CHIP } from "../src/workspaces/site-planner/lib/parcelOrigin.js";
import { parcelProvenance, provenanceLabel } from "../src/workspaces/site-planner/lib/parcelRecord.js";
import { planCombine, buildParcelRows } from "../src/workspaces/site-planner/lib/parcelOps.js";
import { mergeParcelRings } from "../src/workspaces/site-planner/lib/polyClip.js";

const sq = (x, id, extra = {}) => ({ id, points: [{ x, y: 0 }, { x: x + 100, y: 0 }, { x: x + 100, y: 100 }, { x, y: 100 }], ...extra });

describe("a combine result is 'Combined' — derived from its snapshot, never 'Drawn'", () => {
  const a = sq(0, "a", { acct: "045-1", attrs: { OWNER: "Smith" }, gisKey: "k1" }), b = sq(100, "b", { acct: "045-2", attrs: {}, gisKey: "k2" });
  const r = planCombine([a, b], ["a", "b"], { unionRings: mergeParcelRings, newId: () => "t1" });
  const tract = r.tract;
  it("the tract carries no county attrs and no source — exactly the shape the old rule read as drawn", () => {
    expect(tract.attrs).toBeUndefined(); expect(tract.source).toBeUndefined();
  });
  it("origin, provenance and the row line all say Combined", () => {
    expect(originKind(tract)).toBe("combined");
    expect(parcelProvenance(tract)).toBe("combined");
    expect(provenanceLabel(tract).short).toBe("Combined");
    expect(parcelOrigin(tract).chip).toBe("Combined");
    expect(parcelOrigin(tract).line).toBe("Combined from 2 lots");
    expect(combinedCount(tract)).toBe(2);
    const row = buildParcelRows(r.parcels).find((x) => x.id === "t1");
    expect(row.origin.line).toBe("Combined from 2 lots");
  });
  it("an existing combined parcel with NO flag at all (only the snapshot) reads right without a migration", () => {
    expect(originKind({ id: "x", points: tract.points, combined: { from: [{}, {}, {}] } })).toBe("combined");
  });
});

describe("the other provenances, and the row's second line", () => {
  it("county lot: '<CAD> · <account>'", () => {
    const o = parcelOrigin({ acct: "045-123-000-0012", attrs: {} }, { cadName: "Harris CAD" });
    expect(o.kind).toBe("county"); expect(o.chip).toBe(ORIGIN_CHIP.county); expect(o.line).toBe("Harris CAD · 045-123-000-0012");
  });
  it("county lot with no CAD name still says where it came from", () => {
    expect(parcelOrigin({ attrs: {} }).line).toBe("From the county");
  });
  it("drawn and deed", () => {
    expect(parcelOrigin({ source: "drawn", points: [] }).line).toBe("Drawn");
    expect(parcelOrigin({ source: "deed" }).chip).toBe("From deed");
  });
  it("a typed source wins over inference", () => { expect(originKind({ source: "drawn", attrs: {} })).toBe("drawn"); });
  it("cadNameOf reads the registry label", () => {
    expect(cadNameOf("Harris County · HCAD")).toBe("Harris CAD");
    expect(cadNameOf("Fort Bend · FBCAD")).toBe("Fort Bend CAD");
    expect(cadNameOf(null)).toBeNull();
  });

  it("NEW-3: with no evidence at all there is NO source line and no chip — never a guess", () => {
    const o = parcelOrigin({ points: [] });
    expect(o.kind).toBe("unknown");
    expect(o.line).toBe("");
    expect(o.chip).toBeNull();
  });
  it("NEW-3: a combined parcel says 'lots' only when every source is a county lot, otherwise 'parcels'", () => {
    const county = (n) => ({ gisKey: `oid:${n}`, attrs: { HCAD_NUM: String(n) } });
    expect(parcelOrigin({ combined: { from: [county(1), county(2)] } }).line).toBe("Combined from 2 lots");
    // Goose Creek Phase II Parcel 1: one drawn lot + two county lots -> 3 parcels
    expect(parcelOrigin({ combined: { from: [{ snapName: "Parcel A" }, county(1), county(2)] } }).line).toBe("Combined from 3 parcels");
  });
  it("NEW-3: a piece cut from a county lot is a county lot; one cut from an unknown lot stays unknown", () => {
    expect(originKind({ splitFrom: { from: { attrs: { A: 1 } } } })).toBe("county");
    expect(originKind({ splitFrom: { from: { points: [] } } })).toBe("unknown");
  });
  it("NEW-2: the row's account is the county's HCAD account, not the OBJECTID the identify stamped", () => {
    const pc = { acct: "634440", attrs: { OBJECTID: 634440, HCAD_NUM: "0421030000123" } };
    expect(parcelOrigin(pc, { cadName: "Harris CAD" }).line).toBe("Harris CAD · 0421030000123");
  });
});
