import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchTaxUnits, tableFromUnits, accountOf, _resetTaxUnitsCache } from "../src/workspaces/site-planner/lib/taxUnitsClient.js";
import { taxTableForCombined } from "../src/workspaces/site-planner/lib/taxRates.js";
import { normalizeCounty } from "../functions/api/taxrates.js";

// B2158065 — HCAD account 0591420000105 (8203 John Martin Rd), 2025 rates per $100, as read by Cowork
// off the CAD's own Jurisdictions table. The shaped table must reproduce it to the digit.
const HARRIS_0591420000105 = {
  county: "harris", acct: "0591420000105", year: 2025, complete: true,
  source: "Harris Central Appraisal District — jurisdictions & rates", sourceUrl: "https://hcad.org/",
  units: [
    { code: "016", name: "GOOSE CREEK CISD", rate: 1.07 }, { code: "040", name: "HARRIS COUNTY", rate: 0.38096 },
    { code: "041", name: "HARRIS CO FLOOD CNTRL", rate: 0.04966 }, { code: "042", name: "PORT OF HOUSTON AUTHY", rate: 0.0059 },
    { code: "043", name: "HARRIS CO HOSP DIST", rate: 0.18761 }, { code: "044", name: "HARRIS CO EDUC DEPT", rate: 0.004798 },
    { code: "046", name: "LEE JR COLLEGE DIST", rate: 0.18706 }, { code: "640", name: "HC EMERG SRV DIST 14", rate: 0.085 },
  ],
};

describe("tableFromUnits", () => {
  it("reproduces the eight HCAD rows and the 1.970988 total exactly", () => {
    const t = tableFromUnits(HARRIS_0591420000105);
    expect(t.rows.length).toBe(8);
    expect(t.total).toBe(1.970988);
    expect(t.year).toBe(2025);
  });
  it("hides (null) anything incomplete, unnamed or non-numeric — never a partial total", () => {
    expect(tableFromUnits(null)).toBeNull();
    expect(tableFromUnits({ ...HARRIS_0591420000105, complete: false })).toBeNull();
    expect(tableFromUnits({ ...HARRIS_0591420000105, units: [] })).toBeNull();
    expect(tableFromUnits({ ...HARRIS_0591420000105, units: [{ code: "1", name: "", rate: 1 }] })).toBeNull();
    expect(tableFromUnits({ ...HARRIS_0591420000105, units: [{ code: "1", name: "X", rate: null }] })).toBeNull();
    expect(tableFromUnits({ ...HARRIS_0591420000105, year: undefined })).toBeNull();
  });
});

describe("accountOf", () => {
  it("reads the county id field, digits only; falls back to the stored acct", () => {
    expect(accountOf({ attrs: { HCAD_NUM: "0591420000105" } }, "HCAD_NUM")).toBe("0591420000105");
    expect(accountOf({ attrs: {}, acct: "059-142-000-0105" }, "HCAD_NUM")).toBe("0591420000105");
    expect(accountOf({ attrs: {} }, "HCAD_NUM")).toBeNull();
  });
});

describe("fetchTaxUnits", () => {
  beforeEach(() => _resetTaxUnitsCache());
  it("fetches once per account and shares the result", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => HARRIS_0591420000105 }));
    const [a, b] = await Promise.all([fetchTaxUnits("harris", "0591420000105", f), fetchTaxUnits("harris", "0591420000105", f)]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(f.mock.calls[0][0]).toBe("/api/taxunits?county=harris&acct=0591420000105");
  });
  it("never fetches for a county that is not wired, and does not cache a failure", async () => {
    const f = vi.fn(async () => ({ ok: false }));
    expect(await fetchTaxUnits("fortbend", "1", f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(await fetchTaxUnits("harris", "9", f)).toBeNull();
    expect(await fetchTaxUnits("harris", "9", f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("combined parcel", () => {
  it("shows the total and whether every source lot shares it", () => {
    const t = tableFromUnits(HARRIS_0591420000105);
    const lots = [{ label: "A" }, { label: "B" }];
    expect(taxTableForCombined(lots, { tableOf: () => t })).toMatchObject({ allShare: true, total: 1.970988 });
    const other = { ...t, total: 1.5 };
    expect(taxTableForCombined(lots, { tableOf: (p) => (p.label === "A" ? t : other) })).toMatchObject({ allShare: false, total: null });
    expect(taxTableForCombined(lots, { tableOf: (p) => (p.label === "A" ? t : null) })).toBeNull(); // one lot unknown → hide
  });
});

describe("/api/taxrates county normalisation (B2158064)", () => {
  it("one county is one cache key however it is spelled", () => {
    for (const s of ["Harris", "harris", " HARRIS  ", "Harris County", "harris county"]) expect(normalizeCounty(s)).toBe("harris");
    expect(normalizeCounty("Fort  Bend County")).toBe("fort bend");
  });
});

describe("transient answers are never cached", () => {
  it("a 'try again' answer is retried on the next open", async () => {
    _resetTaxUnitsCache();
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ complete: false, transient: true }) }));
    await fetchTaxUnits("harris", "0591420000105", f);
    await fetchTaxUnits("harris", "0591420000105", f);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("B2194744 — a Harris lot with NO stored acct still resolves its account from the county record", () => {
  it("the owner's 158.20 AC lot (acct null, HCAD_NUM 0421030000129) fetches", () => {
    const lot = { acct: null, attrs: { OBJECTID: 504281, HCAD_NUM: "0421030000129", acct_num: "0421030000129" } };
    expect(accountOf(lot, undefined)).toBe("0421030000129"); // the planner used to pass an undefined idField
    expect(accountOf(lot, "HCAD_NUM")).toBe("0421030000129");
  });
  it("never answers with the OBJECTID", () => {
    expect(accountOf({ attrs: { OBJECTID: 634440, HCAD_NUM: "0421030000123" }, acct: "634440" }, undefined)).toBe("0421030000123");
  });
});
