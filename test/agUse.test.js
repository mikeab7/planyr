/* NEW-1 (sweep 2026-11-12) — the ag-use (1-d-1) rollback-tax line on a Texas county parcel page.
 * Fixtures are the two live HCAD rows the sweep measured (re-measured 2026-11-12: same figures) and a real FBCAD D1 row
 * (Land_State_Code "D1", no productivity value published). Owner constraints: #4 (no number without its rule record), #3 (Texas only). */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { agUseOf, agUseLine, agMoney, validAgUseRule, AG_USE_RULES } from "../src/workspaces/site-planner/lib/agUseRules.js";

const mueschke = { acct_num: "0432370000001", tax_year: "2026", state_class: "1D1", productivity_value: 10078, total_market_val: 1948231, land_value: 1948231, acreage_1: 88.9009 };
const fellows = { acct_num: "0420180000146", tax_year: "2026", state_class: "1D1", productivity_value: 1400, total_market_val: 1306800, land_value: 1306800, acreage_1: 10 };
const fbD1 = { PROPNUMBER: "6495-00-000-0240-901", TOTALVALUE: 276095, LANDVALUE: 276095, IMPVALUE: 0, EXEMPTIONS: "AG", Land_State_Code: "D1", Land_Type: "BK", Land_AG_Code: "A-BK" };
const harvest = JSON.parse(fs.readFileSync(new URL("./fixtures/countyRecordRows.json", import.meta.url)));
const tx = { state: "TX" };

describe("agUseOf", () => {
  it("Harris 1D1 lot (Mueschke Rd) carries class + both values", () => {
    expect(agUseOf(mueschke, tx)).toEqual({ classCode: "1D1", market: 1948231, productivity: 10078, ruleId: "txRollback" });
  });
  it("Fort Bend D1 has the class and NO dollar figures (none published)", () => {
    expect(agUseOf(fbD1, tx)).toEqual({ classCode: "D1", market: null, productivity: null, ruleId: "txRollback" });
  });
  it("an ordinary lot says nothing — the committed Harris (timber 'TMBR') and Fort Bend (A1) rows", () => {
    expect(agUseOf(harvest.rows.harris.attrs, tx)).toBeNull();
    expect(agUseOf(harvest.rows.fortbend.attrs, tx)).toBeNull();
  });
  it("a productivity value that is not below market is not shown as a break", () => {
    expect(agUseOf({ ...mueschke, productivity_value: 2000000 }, tx).market).toBeNull();
    expect(agUseOf({ ...mueschke, productivity_value: null }, tx).productivity).toBeNull();
  });
  it("TEXAS ONLY (#3): the same bag on a non-Texas or unknown state is nothing", () => {
    expect(agUseOf(mueschke, { state: "GA" })).toBeNull();
    expect(agUseOf(mueschke, {})).toBeNull();
    expect(agUseOf(null, tx)).toBeNull();
  });
  it("class codes: 1D1 / 1D / D1 match; 1D2, TMBR, A1, 11D1 do not", () => {
    for (const c of ["1D1", "1d1", "1D", "D1"]) expect(agUseOf({ state_class: c }, tx)).not.toBeNull();
    for (const c of ["1D2", "TMBR", "A1", "11D1", "", null]) expect(agUseOf({ state_class: c }, tx)).toBeNull();
  });
});

describe("countyRecord carries agUse", () => {
  it("both live HCAD lots", () => {
    expect(countyRecord(mueschke, { state: "TX" }).agUse.classCode).toBe("1D1");
    expect(countyRecord(fellows, { state: "TX" }).agUse.productivity).toBe(1400);
  });
  it("is null without a state — the generic callers are unchanged", () => {
    expect(countyRecord(mueschke).agUse).toBeNull();
  });
});

describe("agUseLine — composed from the rule record (#4)", () => {
  it("the Mueschke Rd line, in full", () => {
    expect(agUseLine(agUseOf(mueschke, tx))).toBe("Ag-use valuation (1D1) — a change of use triggers rollback taxes (3 prior years, Tax Code §23.55); market $1.95M vs productivity $10,078");
  });
  it("Fellows Rd: whole-dollar productivity, compact market", () => {
    expect(agUseLine(agUseOf(fellows, tx))).toContain("market $1.31M vs productivity $1,400");
  });
  it("Fort Bend: class + rule, no figures", () => {
    expect(agUseLine(agUseOf(fbD1, tx))).toBe("Ag-use valuation (D1) — a change of use triggers rollback taxes (3 prior years, Tax Code §23.55)");
  });
  it("the look-back years come FROM the record", () => {
    const rules = { txRollback: { ...AG_USE_RULES.txRollback, lookbackYears: 5 } };
    expect(agUseLine(agUseOf(fbD1, tx), rules)).toContain("5 prior years");
  });
  it("a malformed or missing rule record shows NOTHING, loudly — never a naked number", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(agUseLine(agUseOf(mueschke, tx), {})).toBeNull();
    expect(agUseLine(agUseOf(mueschke, tx), { txRollback: { ...AG_USE_RULES.txRollback, lookbackYears: "three" } })).toBeNull();
    expect(agUseLine(agUseOf(mueschke, tx), { txRollback: { ...AG_USE_RULES.txRollback, source: null } })).toBeNull();
    expect(err).toHaveBeenCalledTimes(3);
    err.mockRestore();
  });
  it("no ag use, no line", () => expect(agUseLine(null)).toBeNull());
  it("the shipped record is valid and published", () => {
    expect(validAgUseRule(AG_USE_RULES.txRollback)).toBe(AG_USE_RULES.txRollback);
    expect(AG_USE_RULES.txRollback.source.section).toBe("§23.55");
  });
  it("agMoney", () => { expect(agMoney(1948231)).toBe("$1.95M"); expect(agMoney(10078)).toBe("$10,078"); expect(agMoney(2000000)).toBe("$2M"); expect(agMoney(NaN)).toBeNull(); });
});

describe("wiring", () => {
  const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  it("the parcel page renders the line from agUseLine and the planner passes the county's state", () => {
    expect(src("../src/workspaces/site-planner/components/ParcelPage.jsx")).toMatch(/agUseLine\(rec\.agUse\)[\s\S]*parcel-ag-use/);
    expect(src("../src/workspaces/site-planner/SitePlanner.jsx")).toMatch(/countyState=\{\(COUNTIES\[restored\?\.county\] \|\| \{\}\)\.state \|\| null\}/);
  });
});
