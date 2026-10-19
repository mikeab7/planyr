import { describe, it, expect } from "vitest";
import {
  emptyFilters, applyFilters, sortComps, parseSearch, matchesSearch, activeFilterChips, removeFilter,
  countFiltered, dateBounds, compAcres, countyOptions, normalizeFilters,
} from "../src/shared/comps/lib/compsQuery.js";
import { sortCompsByRecency } from "../src/shared/comps/lib/comps.js";

const TODAY = "2026-10-19";
let n = 0;
const base = (o) => ({ id: `c${++n}`, title: "", notes: "", anchor: { kind: "pin", lat: 29.7, lon: -95.3, county: "harris", parcelApn: null }, createdAt: "2026-01-01T00:00:00Z", ...o });
const lease = (o) => base({ compType: "lease", compDate: "2026-09-01", leaseRate: 6, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 100000, ...o });
const sale = (o) => base({ compType: "building_sale", compDate: "2026-09-01", bldgPrice: 10000000, bldgSizeSf: 100000, ...o });
const land = (o) => base({ compType: "land", compDate: "2026-09-01", landPrice: 435600, landSizeValue: 1, landSizeUnit: "ac", ...o });
const ids = (r) => r.shown.map((c) => c.title || c.id);
const F = (patch) => ({ ...emptyFilters(), ...patch });
const run = (comps, filters, opts = {}) => applyFilters(comps, filters, { today: TODAY, ...opts });

describe("compsQuery — every filter alone", () => {
  it("type, multi-select, none = all", () => {
    const cs = [lease({ title: "L" }), sale({ title: "S" }), land({ title: "A" })];
    expect(ids(run(cs, F({ types: ["lease"] })))).toEqual(["L"]);
    expect(ids(run(cs, F({ types: ["lease", "land"] }))).sort()).toEqual(["A", "L"]);
    expect(run(cs, emptyFilters()).shown).toHaveLength(3);
  });
  it("building SF range, inclusive, applies to sale + lease only", () => {
    const cs = [lease({ title: "a", leaseSizeSf: 50000 }), sale({ title: "b", bldgSizeSf: 150000 }), land({ title: "c" })];
    expect(ids(run(cs, F({ sizeSf: { min: "100,000", max: "250000" } })))).toEqual(["b"]);
    expect(ids(run(cs, F({ sizeSf: { min: "50000", max: "" } }))).sort()).toEqual(["a", "b"]);
  });
  it("land acres normalise square feet (sf ÷ 43,560)", () => {
    const cs = [land({ title: "ac", landSizeValue: 10, landSizeUnit: "ac" }), land({ title: "sf", landSizeValue: 43560 * 10, landSizeUnit: "sf" }), land({ title: "small", landSizeValue: 2, landSizeUnit: "ac" })];
    expect(ids(run(cs, F({ acres: { min: "9", max: "11" } }))).sort()).toEqual(["ac", "sf"]);
    expect(compAcres(cs[1])).toBeCloseTo(10, 6);
  });
  it("clear height, year built", () => {
    const cs = [sale({ title: "tall", clearHeightFt: 36, yearBuilt: 2020 }), sale({ title: "low", clearHeightFt: 24, yearBuilt: 1990 })];
    expect(ids(run(cs, F({ clearFt: { min: "32", max: "" } })))).toEqual(["tall"]);
    expect(ids(run(cs, F({ yearBuilt: { min: "", max: "2000" } })))).toEqual(["low"]);
  });
  it("power min amps and dock doors min", () => {
    const cs = [lease({ title: "big", powerAmps: 3000, dockDoors: 30 }), lease({ title: "small", powerAmps: 800, dockDoors: 4 })];
    expect(ids(run(cs, F({ powerAmps: { min: "2000" } })))).toEqual(["big"]);
    expect(ids(run(cs, F({ dockDoors: { min: "10" } })))).toEqual(["big"]);
  });
  it("lease rate is compared ANNUALISED even when entered monthly", () => {
    const cs = [lease({ title: "mo", leaseRate: 0.5, leaseRatePeriod: "monthly" }), lease({ title: "yr", leaseRate: 9, leaseRatePeriod: "annual" })];
    expect(ids(run(cs, F({ leaseRate: { min: "5.5", max: "6.5" } })))).toEqual(["mo"]); // 0.5 × 12 = 6
    expect(ids(run(cs, F({ leaseRate: { min: "8", max: "" } })))).toEqual(["yr"]);
  });
  it("NNN / Gross, none = both", () => {
    const cs = [lease({ title: "n", leaseRateExpense: "nnn" }), lease({ title: "g", leaseRateExpense: "gross" })];
    expect(ids(run(cs, F({ bases: ["gross"] })))).toEqual(["g"]);
    expect(run(cs, F({ bases: [] })).shown).toHaveLength(2);
  });
  it("sale $/SF: building and land each use their own derivation", () => {
    const cs = [sale({ title: "b", bldgPrice: 10000000, bldgSizeSf: 100000 }), land({ title: "l", landPrice: 435600, landSizeValue: 1, landSizeUnit: "ac" })];
    expect(ids(run(cs, F({ bldgPsf: { min: "90", max: "110" } })))).toEqual(["b"]);
    expect(ids(run(cs, F({ landPsf: { min: "9", max: "11" } })))).toEqual(["l"]);
  });
  it("county chips", () => {
    const cs = [lease({ title: "h" }), lease({ title: "f", anchor: { kind: "pin", lat: 1, lon: 1, county: "fort_bend" } })];
    expect(ids(run(cs, F({ counties: ["fort_bend"] })))).toEqual(["f"]);
    expect(countyOptions(cs).map((c) => [c.label, c.count])).toEqual([["Fort Bend County", 1], ["Harris County", 1]]);
  });
});

describe("compsQuery — combined (AND) and blank-field exclusion", () => {
  it("filters AND together", () => {
    const cs = [lease({ title: "yes", leaseSizeSf: 150000, clearHeightFt: 36 }), lease({ title: "sizeOnly", leaseSizeSf: 150000, clearHeightFt: 20 }), lease({ title: "heightOnly", leaseSizeSf: 10, clearHeightFt: 36 })];
    expect(ids(run(cs, F({ sizeSf: { min: "100000", max: "" }, clearFt: { min: "32", max: "" } })))).toEqual(["yes"]);
    expect(ids(run(cs, F({ types: ["lease"], clearFt: { min: "32", max: "" }, bases: ["nnn"] }))).sort()).toEqual(["heightOnly", "yes"]);
  });
  it("a blank value in a filtered field is EXCLUDED (not 0, not a pass)", () => {
    const cs = [lease({ title: "blank", clearHeightFt: null, powerAmps: null, dockDoors: null }), lease({ title: "zero", clearHeightFt: 0 })];
    expect(ids(run(cs, F({ clearFt: { min: "", max: "40" } })))).toEqual(["zero"]);
    expect(ids(run(cs, F({ powerAmps: { min: "1" } })))).toEqual([]);
    // a lease with no stated period has no rate to compare
    const noPeriod = lease({ title: "noP", leaseRatePeriod: null });
    expect(ids(run([noPeriod], F({ leaseRate: { min: "1", max: "" } })))).toEqual([]);
    // an INACTIVE filter does not exclude blanks
    expect(run(cs, emptyFilters()).shown).toHaveLength(2);
  });
});

describe("compsQuery — date windows", () => {
  const at = (d, title) => sale({ title, compDate: d });
  it("3 mo = today back 90 days inclusive; one day past is out", () => {
    const cs = [at("2026-10-19", "today"), at("2026-07-21", "exactly90"), at("2026-07-20", "past")];
    expect(ids(run(cs, F({ date: { mode: "3m", from: "", to: "" } }))).sort()).toEqual(["exactly90", "today"]);
    expect(dateBounds({ mode: "3m" }, TODAY)).toEqual({ from: "2026-07-21", to: TODAY });
  });
  it("6 mo and 12 mo windows", () => {
    const cs = [at("2026-04-22", "d180"), at("2026-04-21", "d181"), at("2025-10-19", "d365"), at("2025-10-18", "d366")];
    expect(ids(run(cs, F({ date: { mode: "6m" } })))).toEqual(["d180"]);
    expect(ids(run(cs, F({ date: { mode: "12m" } }))).sort()).toEqual(["d180", "d181", "d365"]);
  });
  it("a future-dated comp is not 'past'", () => {
    expect(run([at("2026-11-01", "f")], F({ date: { mode: "12m" } })).shown).toHaveLength(0);
  });
  it("custom From-only, To-only, both, inclusive", () => {
    const cs = [at("2026-01-01", "a"), at("2026-02-01", "b"), at("2026-03-01", "c")];
    expect(ids(run(cs, F({ date: { mode: "custom", from: "2026-02-01", to: "" } })))).toEqual(["b", "c"]);
    expect(ids(run(cs, F({ date: { mode: "custom", from: "", to: "2026-02-01" } })))).toEqual(["a", "b"]);
    expect(ids(run(cs, F({ date: { mode: "custom", from: "2026-02-01", to: "2026-02-01" } })))).toEqual(["b"]);
    expect(run(cs, F({ date: { mode: "custom", from: "", to: "" } })).shown).toHaveLength(3); // no bound = inactive
  });
  it("undated: included under Any, excluded and COUNTED under a window", () => {
    const cs = [at("2026-10-01", "dated"), at(null, "undated")];
    expect(run(cs, emptyFilters())).toMatchObject({ undatedHidden: 0 });
    expect(run(cs, emptyFilters()).shown).toHaveLength(2);
    const r = run(cs, F({ date: { mode: "3m" } }));
    expect(ids(r)).toEqual(["dated"]);
    expect(r.undatedHidden).toBe(1);
    // an undated comp another filter already removes is not "hidden by the date"
    expect(run(cs, F({ date: { mode: "3m" }, types: ["lease"] })).undatedHidden).toBe(0);
  });
});

describe("compsQuery — search", () => {
  it("tokens are AND-ed, case-insensitive, across title/notes/parties/APN/county", () => {
    const c = lease({ title: "Katy Freeway DC", notes: "Dock-high", partyProvider: "Prologis", partyAcquirer: "Amazon", anchor: { kind: "parcel", lat: 1, lon: 1, county: "harris", parcelApn: "1234567" } });
    for (const s of ["katy", "PROLOGIS amazon", "dock", "1234567", "harris county", "katy  freeway"]) expect(matchesSearch(c, parseSearch(s))).toBe(true);
    expect(matchesSearch(c, parseSearch("katy houston"))).toBe(false);
    expect(matchesSearch(c, parseSearch(""))).toBe(true);
  });
  it("location text counts only when the callback supplies a CACHED address; search never calls anything else", () => {
    const c = lease({ title: "x" });
    expect(matchesSearch(c, parseSearch("main st"))).toBe(false);
    expect(matchesSearch(c, parseSearch("main st"), () => "100 Main St, Katy")).toBe(true);
    let calls = 0;
    const r = applyFilters([c], emptyFilters(), { search: "main", locationText: () => { calls += 1; return null; } });
    expect(r.shown).toHaveLength(0);
    expect(calls).toBe(1); // a pure read per comp — no network exists in this module to call
  });
  it("search combines with filters", () => {
    const cs = [lease({ title: "alpha" }), sale({ title: "alpha two" })];
    expect(ids(run(cs, F({ types: ["lease"] }), { search: "alpha" }))).toEqual(["alpha"]);
  });
});

describe("compsQuery — sort (missing values go last)", () => {
  const cs = [
    lease({ title: "r6", leaseRate: 6, leaseSizeSf: 200000 }), lease({ title: "r9", leaseRate: 9, leaseSizeSf: 50000 }),
    lease({ title: "norate", leaseRate: null, leaseRatePeriod: null, leaseSizeSf: null }),
    sale({ title: "p100", bldgPrice: 10000000, bldgSizeSf: 100000 }), sale({ title: "p50", bldgPrice: 5000000, bldgSizeSf: 100000, compDate: "2025-01-01" }),
    base({ title: "undated", compType: "lease", compDate: null, createdAt: "2026-10-10T00:00:00Z" }),
  ];
  const order = (k) => sortComps(cs, k).map((c) => c.title);
  it("largest / smallest", () => {
    expect(order("largest").slice(0, 3)).toEqual(["r6", "p100", "p50"]);
    expect(order("smallest").slice(0, 2)).toEqual(["r9", "p100"]);
    expect(order("largest").slice(-2).sort()).toEqual(["norate", "undated"]);
  });
  it("rate high/low, no-rate and non-leases last", () => {
    expect(order("rateHigh").slice(0, 2)).toEqual(["r9", "r6"]);
    expect(order("rateLow").slice(0, 2)).toEqual(["r6", "r9"]);
    expect(order("rateHigh").slice(-4)).not.toContain("r9");
  });
  it("price/SF high/low", () => {
    expect(order("psfHigh").slice(0, 2)).toEqual(["p100", "p50"]);
    expect(order("psfLow").slice(0, 2)).toEqual(["p50", "p100"]);
  });
  it("newest is exactly today's sortCompsByRecency; oldest is its reverse key order with no-date-at-all last", () => {
    expect(sortComps(cs, "newest")).toEqual(sortCompsByRecency(cs));
    expect(order("oldest")[0]).toBe("p50");
    const nodate = base({ title: "none", compDate: null, createdAt: null });
    expect(sortComps([nodate, ...cs], "oldest").at(-1).title).toBe("none");
  });
  it("a bad sort key falls back to newest", () => {
    expect(sortComps(cs, "bogus")).toEqual(sortCompsByRecency(cs));
  });
});

describe("compsQuery — chips, remove, results", () => {
  it("chips name each active filter and remove clears just that one", () => {
    const f = F({ types: ["lease"], date: { mode: "12m", from: "", to: "" }, sizeSf: { min: "100000", max: "250000" }, powerAmps: { min: "2000" }, counties: ["harris"], bases: ["nnn"] });
    const labels = activeFilterChips(f).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["Lease", "12 mo", "100,000–250,000 SF", "≥ 2,000 A", "Harris County", "NNN"]));
    const g = removeFilter(f, "date");
    expect(g.date.mode).toBe("any");
    expect(g.sizeSf.min).toBe("100000");
    expect(removeFilter(f, "type:lease").types).toEqual([]);
    expect(removeFilter(f, "county:harris").counties).toEqual([]);
    expect(activeFilterChips(emptyFilters())).toEqual([]);
  });
  it("countFiltered reports shown / total / undated hidden", () => {
    const cs = [lease({ title: "a" }), sale({ title: "b", compDate: null })];
    const r = countFiltered(cs, F({ date: { mode: "3m" } }), { today: TODAY });
    expect(r).toMatchObject({ shownCount: 1, total: 2, undatedHidden: 1 });
  });
  it("normalizeFilters survives garbage", () => {
    expect(normalizeFilters("nope")).toEqual(emptyFilters());
    expect(normalizeFilters({ types: ["lease", "zzz"], date: { mode: "wat" } }).types).toEqual(["lease"]);
  });
  it("is fast: 600 comps filter+sort well under a frame budget", () => {
    const many = Array.from({ length: 600 }, (_, i) => lease({ title: `deal ${i}`, leaseSizeSf: 1000 * i, clearHeightFt: 20 + (i % 20) }));
    const t = performance.now();
    for (let k = 0; k < 20; k++) countFiltered(many, F({ sizeSf: { min: "100000", max: "" }, clearFt: { min: "30", max: "" } }), { today: TODAY, search: "deal 4", sort: "largest" });
    expect((performance.now() - t) / 20).toBeLessThan(25);
  });
});
