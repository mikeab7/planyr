/* Parcels rework (NEW-2) — where a parcel came from, in the words the list row and the page use.
 * A real Combine result has no county attrs and no `source`, so the old rule read it as "Drawn by hand". (Goose Creek Phase II "Parcel 1" is NOT a known combine result — no combine record — and must keep reading "Drawn".) */
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
    expect(parcelOrigin({ points: [] }).line).toBe("Drawn");
    expect(parcelOrigin({ source: "deed" }).chip).toBe("From deed");
  });
  it("a typed source wins over inference", () => { expect(originKind({ source: "drawn", attrs: {} })).toBe("drawn"); });
  it("cadNameOf reads the registry label", () => {
    expect(cadNameOf("Harris County · HCAD")).toBe("Harris CAD");
    expect(cadNameOf("Fort Bend · FBCAD")).toBe("Fort Bend CAD");
    expect(cadNameOf(null)).toBeNull();
  });
});
