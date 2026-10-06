import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { taxTableFor, taxTableForCombined, TAX_COVERAGE, loadTaxTable } from "../src/workspaces/site-planner/lib/taxRates.js";

// SYNTHETIC fixture (tests only, never shipped) to exercise the logic.
const data = { county: "x", year: 2025, source: "fixture", sourceUrl: "u", codeField: "TAXUNITS",
  units: { A: { unit: "Unit A", rate: 0.5 }, B: { unit: "Unit B", rate: 0.25 }, C: { unit: "Unit C", rate: 0.1 } } };
const P = (codes, label) => ({ label, attrs: { TAXUNITS: codes } });

describe("taxRates", () => {
  it("hides for an uncovered county / no data", async () => {
    expect(taxTableFor(P("A,B"), { county: "harris" })).toBeNull();
    expect(await loadTaxTable(P("A,B"), { county: "fortbend" })).toBeNull();
  });
  it("builds rows and total from a complete list", () => {
    const t = taxTableFor(P("A, B,CAD"), { county: "x", data });
    expect(t.rows).toEqual([{ unit: "Unit A", rate: 0.5 }, { unit: "Unit B", rate: 0.25 }]);
    expect(t.total).toBe(0.75);
  });
  it("hides when any code is unknown (never a partial total)", () => {
    expect(taxTableFor(P("A,Z"), { county: "x", data })).toBeNull();
    expect(taxTableFor({ attrs: {} }, { county: "x", data })).toBeNull();
  });
  it("combined: share vs differ vs hidden", () => {
    const o = { county: "x", data };
    expect(taxTableForCombined([P("A,B", "1"), P("B,A", "2")], o)).toMatchObject({ allShare: true, total: 0.75 });
    const d = taxTableForCombined([P("A", "1"), P("A,C", "2")], o);
    expect(d.allShare).toBe(false); expect(d.total).toBeNull(); expect(d.perLot).toHaveLength(2);
    expect(taxTableForCombined([P("A"), P("Z")], o)).toBeNull();
  });
  it("coverage table is honest and complete", () => {
    for (const k of ["harris", "fortbend", "montgomery", "galveston"]) expect(TAX_COVERAGE[k].reason.length).toBeGreaterThan(10);
  });
  it("every shipped data file has unit names, year, source", () => {
    const dir = path.resolve(__dirname, "../src/workspaces/site-planner/lib/data");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^taxRates-.*\.json$/.test(f)) : [];
    for (const f of files) {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      expect(d.year && d.source && d.sourceUrl && d.codeField).toBeTruthy();
      for (const u of Object.values(d.units)) { expect(u.unit).toBeTruthy(); expect(typeof u.rate).toBe("number"); }
      expect(TAX_COVERAGE[d.county].covered).toBe(true);
    }
  });
});
