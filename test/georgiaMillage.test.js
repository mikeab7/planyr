import { describe, it, expect } from "vitest";
import data from "../src/workspaces/site-planner/lib/data/gaMillage-ga_bartow-2025.json";
import { millageTableFor, districtCodeOf, districtGap, pendingDistricts, isPilotLot } from "../src/workspaces/site-planner/lib/georgiaMillage.js";
import { taxTableFor, taxTableForCombined, TAX_COVERAGE, MILLAGE_DATA } from "../src/workspaces/site-planner/lib/taxRates.js";

const lot = (code, extra = {}) => ({ label: "L", attrs: { Tax_District: code, ...extra } });
const on = { covered: true };

describe("georgiaMillage — Bartow tax district → levy list (mills on the 40% assessed value)", () => {
  it("06 Bartow County → county unincorporated + county schools = 24.05 mills", () => {
    const t = millageTableFor(lot("06"), data, on);
    expect(t.rows).toEqual([{ unit: "Bartow County (unincorporated)", rate: 6.87 }, { unit: "Bartow County Schools", rate: 17.18 }]);
    expect(t.total).toBe(24.05);
    expect(t.unit).toBe("mills");
    expect(t.caption).toBe("2025 millage · 40% assessment");
  });

  it("02 Adairsville is complete from the sourced 2025 rates (7.40 + 1.955 + 17.18)", () => {
    expect(millageTableFor(lot("02"), data, on).total).toBe(26.535);
  });

  it("01 Cartersville = county incorporated + city + city schools (+ bond) — hidden while the 2025 parks-bond rate is untranscribed", () => {
    expect(millageTableFor(lot("01"), data, on)).toBeNull();
    // with the bond rate filled in, the list is the brief's: 7.40 + 2.662 + 14.50 + bond
    const d = JSON.parse(JSON.stringify(data));
    d.levies.cartersville_bond.mills = 0.4;
    const t = millageTableFor(lot("01"), d, on);
    expect(t.rows.map((r) => r.rate)).toEqual([7.4, 2.662, 0.4, 14.5]);
    expect(t.total).toBe(24.962);
  });

  it("11 DDA adds the Cartersville BID on top of the 01 list", () => {
    const d = JSON.parse(JSON.stringify(data));
    d.levies.cartersville_bond.mills = 0.4;
    const base = millageTableFor(lot("01"), d, on).total;
    expect(millageTableFor(lot("11"), d, on).total).toBe(Math.round((base + 0.689) * 1e4) / 1e4);
  });

  it("a TAD code pays its BASE list only (no extra levy); a CID is a real levy", () => {
    const base = millageTableFor(lot("06"), data, on);
    for (const c of ["14", "18", "19"]) expect(millageTableFor(lot(c), data, on).rows).toEqual(base.rows);
    // 13 / 16 carry the Red Top CID on top of Emerson's list — hidden while those rates are missing
    expect(data.districts["13"].levies).toContain("red_top_cid");
    expect(data.districts["16"].levies).toContain("red_top_cid");
    expect(data.districts["15"].levies).not.toContain("red_top_cid");
    expect(millageTableFor(lot("13"), data, on)).toBeNull();
  });

  it("district 12 (base jurisdiction unnamed) is never guessed", () => {
    expect(millageTableFor(lot("12"), data, on)).toBeNull();
    expect(districtGap("12", data)).toMatch(/base jurisdiction/);
  });

  it("PILOT lots (Development Authority, bond-for-title) → held note, no rows, no total, no estimate", () => {
    const t = millageTableFor(lot("06", { Subdivision_Name: "PILOT - SOMETHING   " }), data, on);
    expect(t.held).toMatch(/Development Authority \(PILOT\)/);
    expect(t.rows).toBeUndefined();
    expect(t.total).toBeUndefined();
    expect(isPilotLot({ Subdivision_Name: "Pilot Park" }, data)).toBe(true);
    expect(isPilotLot({ Subdivision_Name: "COM - CASS WHITE CORRIDOR" }, data)).toBe(false);
  });

  it("unknown / null / blank / missing code → hidden (never a guess)", () => {
    for (const c of ["99", null, undefined, "", "  "]) expect(millageTableFor(lot(c), data, on)).toBeNull();
    expect(millageTableFor({ attrs: {} }, data, on)).toBeNull();
    expect(millageTableFor({}, data, on)).toBeNull();
  });

  it("a one-digit code is read as the layer's two-character code", () => {
    expect(districtCodeOf({ Tax_District: "6" }, data)).toBe("06");
    expect(districtCodeOf({ Tax_District: " 06 " }, data)).toBe("06");
  });

  it("covered:false hides every code, PILOT included", () => {
    expect(millageTableFor(lot("06"), data, { covered: false })).toBeNull();
    expect(millageTableFor(lot("06", { Subdivision_Name: "Pilot X" }), data, {})).toBeNull();
  });
});

describe("taxRates wiring — ga_bartow stays hidden until the data is complete", () => {
  it("TAX_COVERAGE.ga_bartow is hidden with a stated reason", () => {
    expect(TAX_COVERAGE.ga_bartow.covered).toBe(false);
    expect(TAX_COVERAGE.ga_bartow.reason.length).toBeGreaterThan(20);
    expect(taxTableFor(lot("06"), { county: "ga_bartow" })).toBeNull();
  });

  it("the coverage flag is honest: it may be true ONLY when no district is pending", () => {
    const pending = Object.keys(pendingDistricts(MILLAGE_DATA.ga_bartow));
    if (TAX_COVERAGE.ga_bartow.covered) expect(pending).toEqual([]);
    else expect(pending.length).toBeGreaterThan(0);
  });

  it("with the gate forced open, the real taxTableFor path serves a 06 lot and a PILOT lot", () => {
    expect(taxTableFor(lot("06"), { county: "ga_bartow", covered: true }).total).toBe(24.05);
    expect(taxTableFor(lot("06", { Subdivision_Name: "Pilot 1" }), { county: "ga_bartow", covered: true }).held).toBeTruthy();
  });

  it("a combine of lots on the same code shares one total; one with a PILOT lot hides", () => {
    const o = { county: "ga_bartow", covered: true };
    expect(taxTableForCombined([lot("06"), lot("14")], o)).toMatchObject({ allShare: true, total: 24.05 });
    expect(taxTableForCombined([lot("06"), lot("06", { Subdivision_Name: "Pilot 9" })], o)).toBeNull();
  });

  it("every levy has a name; a levy is a number or an explicit null WITH a reason; every sourced rate cites a source", () => {
    for (const [id, l] of Object.entries(data.levies)) {
      expect(l.name, id).toBeTruthy();
      if (l.mills == null) expect(l.pending, id).toBeTruthy();
      else { expect(typeof l.mills, id).toBe("number"); expect(l.src, id).toBeTruthy(); }
    }
    for (const [code, d] of Object.entries(data.districts)) {
      if (Array.isArray(d.levies)) for (const id of d.levies) expect(data.levies[id], `${code}:${id}`).toBeTruthy();
      else expect(d.pending, code).toBeTruthy();
    }
  });

  it("Georgia is mills on 40% — never the Texas per-$100 shape", () => {
    expect(data.rateUnit).toBe("mills");
    expect(data.assessmentRatio).toBe(0.4);
    expect(data.caption).toMatch(/40% assessment/);
  });

  it("every Tax_District value the live layer publishes (01-08, 11-20) has a district entry", () => {
    for (const c of ["01","02","03","04","05","06","07","08","11","12","13","14","15","16","17","18","19","20"]) expect(data.districts[c], c).toBeTruthy();
  });
});
