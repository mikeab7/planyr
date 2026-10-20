// NEW-1 — Records search + filters. Red on main: src/shared/comps/lib/compsQuery.js does not exist there.
import { describe, it, expect } from "vitest";
import {
  defaultFilters, parseSearch, matchesSearch, applyFilters, countFiltered, sortComps, queryComps,
  activeFilterChips, removeFilter, hasActiveQuery, countyOptions, dateBounds, isoMinusDays, normalizeFilters, toNum,
} from "../src/shared/comps/lib/compsQuery.js";
import { sortCompsByRecency } from "../src/shared/comps/lib/comps.js";
import { loadQueryPrefs, saveQueryPrefs, clearQueryPrefs, COMPS_QUERY_KEY } from "../src/shared/comps/lib/compsQueryPrefs.js";

const NOW = new Date(2026, 9, 19, 15, 0, 0); // 2026-10-19 local
const A = (county = "harris") => ({ kind: "pin", lat: 29.7, lon: -95.3, county });
let n = 0;
const comp = (o) => ({ id: `c${++n}`, title: "", notes: "", partyProvider: null, partyAcquirer: null, compDate: "2026-09-01", createdAt: "2026-01-01T00:00:00Z", anchor: A(), ...o });
const land = (o = {}) => comp({ compType: "land", landSizeValue: 10, landSizeUnit: "ac", landPrice: 1_000_000, ...o });
const sale = (o = {}) => comp({ compType: "building_sale", bldgSizeSf: 150000, bldgPrice: 15_000_000, clearHeightFt: 32, yearBuilt: 2015, powerAmps: 2000, dockDoors: 20, ...o });
const lease = (o = {}) => comp({ compType: "lease", leaseSizeSf: 120000, leaseRate: 0.5, leaseRatePeriod: "monthly", leaseRateExpense: "nnn", clearHeightFt: 28, yearBuilt: 2005, powerAmps: 1200, dockDoors: 10, ...o });
const F = (patch) => ({ ...defaultFilters(), ...patch });
const ids = (list) => list.map((c) => c.id);
const run = (comps, patch) => ids(applyFilters(comps, F(patch), { now: NOW }));

describe("every filter alone", () => {
  const L1 = lease({ leaseSizeSf: 80000 }), L2 = lease({ leaseSizeSf: 300000 }), S1 = sale(), G = land();
  const all = [L1, L2, S1, G];
  it("type (multi-select; none = all)", () => {
    expect(run(all, {})).toEqual(ids(all));
    expect(run(all, { types: ["lease"] })).toEqual(ids([L1, L2]));
    expect(run(all, { types: ["land", "building_sale"] })).toEqual(ids([S1, G]));
  });
  it("size SF applies to building SF / leased SF and never to land", () => {
    expect(run(all, { sf: { min: "100,000", max: "" } })).toEqual(ids([L2, S1]));
    expect(run(all, { sf: { min: "", max: "100000" } })).toEqual(ids([L1]));
    expect(run(all, { sf: { min: "100000", max: "200000" } })).toEqual(ids([S1]));
  });
  it("land acres: sf-quoted land is normalised ÷ 43,560; non-land excluded", () => {
    const sfLand = land({ landSizeValue: 87120, landSizeUnit: "sf" }); // exactly 2 ac
    const big = land({ landSizeValue: 30 });
    const set = [sfLand, big, S1];
    expect(run(set, { acres: { min: "2", max: "2" } })).toEqual(ids([sfLand]));
    expect(run(set, { acres: { min: "5", max: "" } })).toEqual(ids([big]));
  });
  it("clear height, year built, power min, docks min", () => {
    expect(run(all, { clearHt: { min: "30", max: "" } })).toEqual(ids([S1]));
    expect(run(all, { yearBuilt: { min: "", max: "2010" } })).toEqual(ids([L1, L2]));
    expect(run(all, { powerMin: "2,000" })).toEqual(ids([S1]));
    expect(run(all, { docksMin: "15" })).toEqual(ids([S1]));
  });
  it("lease rate compares ANNUALISED rates whatever period was entered", () => {
    const monthly = lease({ leaseRate: 0.5, leaseRatePeriod: "monthly" }); // $6.00/yr
    const annual = lease({ leaseRate: 7, leaseRatePeriod: "annual" });
    const set = [monthly, annual];
    expect(run(set, { rate: { min: "5.5", max: "6.5" } })).toEqual(ids([monthly]));
    expect(run(set, { rate: { min: "6.5", max: "" } })).toEqual(ids([annual]));
    expect(annualOf(monthly)).toBe(6);
  });
  it("NNN / Gross", () => {
    const g = lease({ leaseRateExpense: "gross" });
    expect(run([L1, g, S1], { basis: ["gross"] })).toEqual(ids([g]));
    expect(run([L1, g, S1], { basis: ["gross", "nnn"] })).toEqual(ids([L1, g]));
  });
  it("building and land $/SF through the model helpers", () => {
    const cheap = sale({ bldgPrice: 7_500_000, bldgSizeSf: 100000 }); // $75
    const dear = sale({ bldgPrice: 20_000_000, bldgSizeSf: 100000 }); // $200
    expect(run([cheap, dear, G], { bldgPsf: { min: "100", max: "" } })).toEqual(ids([dear]));
    const lp = land({ landPrice: 435_600, landSizeValue: 1, landSizeUnit: "ac" }); // $10/SF
    expect(run([lp, G, dear], { landPsf: { min: "5", max: "20" } })).toEqual(ids([lp]));
  });
  it("county", () => {
    const f = lease({ anchor: A("fort_bend") });
    expect(run([L1, f], { counties: ["fort_bend"] })).toEqual(ids([f]));
  });
});
function annualOf(c) { return c.leaseRate * 12; }

describe("combined (AND) and blank-field exclusion", () => {
  it("pairs AND together", () => {
    const a = lease({ clearHeightFt: 32, leaseSizeSf: 200000 }), b = lease({ clearHeightFt: 24, leaseSizeSf: 200000 }), c = lease({ clearHeightFt: 32, leaseSizeSf: 50000 });
    expect(run([a, b, c], { sf: { min: "100000", max: "" }, clearHt: { min: "30", max: "" } })).toEqual(ids([a]));
    expect(run([a, b, c], { types: ["lease"], clearHt: { min: "30", max: "" }, powerMin: "1000" })).toEqual(ids([a, c]));
  });
  it("a blank value in a filtered field is EXCLUDED", () => {
    const blank = sale({ clearHeightFt: null, powerAmps: null, dockDoors: null, yearBuilt: null, bldgSizeSf: null });
    for (const patch of [{ clearHt: { min: "0", max: "" } }, { powerMin: "0" }, { docksMin: "0" }, { yearBuilt: { min: "1800", max: "" } }, { sf: { min: "0", max: "" } }]) {
      expect(run([blank], patch)).toEqual([]);
    }
    expect(run([blank], {})).toEqual(ids([blank])); // no filter: it stays
  });
  it("a lease with no rate period has no annual rate and is excluded by a rate range", () => {
    const noPeriod = lease({ leaseRatePeriod: null });
    expect(run([noPeriod], { rate: { min: "0", max: "" } })).toEqual([]);
  });
  it("a zero is a value, not blank", () => {
    const z = sale({ dockDoors: 0 });
    expect(run([z], { docksMin: "0" })).toEqual(ids([z]));
  });
});

describe("date windows (by compDate), relative to today and inclusive", () => {
  const at = (iso) => comp({ compType: "lease", compDate: iso });
  const today = at("2026-10-19"), d90 = at(isoMinusDays("2026-10-19", 90)), d91 = at(isoMinusDays("2026-10-19", 91));
  const undated = comp({ compType: "lease", compDate: null });
  it("3 mo: today in, exactly 90 days ago in, one day past out", () => {
    expect(isoMinusDays("2026-10-19", 90)).toBe("2026-07-21");
    expect(run([today, d90, d91, undated], { date: { mode: "3mo", from: "", to: "" } })).toEqual(ids([today, d90]));
  });
  it("6 mo and 12 mo use 180 / 365 days", () => {
    const e180 = at(isoMinusDays("2026-10-19", 180)), e181 = at(isoMinusDays("2026-10-19", 181));
    expect(run([e180, e181], { date: { mode: "6mo", from: "", to: "" } })).toEqual(ids([e180]));
    const e365 = at(isoMinusDays("2026-10-19", 365)), e366 = at(isoMinusDays("2026-10-19", 366));
    expect(run([e365, e366], { date: { mode: "12mo", from: "", to: "" } })).toEqual(ids([e365]));
  });
  it("custom: From-only, To-only, both — inclusive", () => {
    const a = at("2026-01-01"), b = at("2026-03-15"), c = at("2026-06-30");
    expect(run([a, b, c], { date: { mode: "custom", from: "2026-03-15", to: "" } })).toEqual(ids([b, c]));
    expect(run([a, b, c], { date: { mode: "custom", from: "", to: "2026-03-15" } })).toEqual(ids([a, b]));
    expect(run([a, b, c], { date: { mode: "custom", from: "2026-01-01", to: "2026-03-15" } })).toEqual(ids([a, b]));
  });
  it("custom with both blank is not a filter at all (undated kept)", () => {
    expect(dateBounds({ mode: "custom", from: "", to: "" }, NOW)).toBeNull();
    expect(run([undated], { date: { mode: "custom", from: "", to: "" } })).toEqual(ids([undated]));
  });
  it("Any includes undated; a window excludes them and counts them", () => {
    expect(run([undated, today], { date: { mode: "any", from: "", to: "" } })).toEqual(ids([undated, today]));
    const r = countFiltered([undated, today, d91], F({ date: { mode: "3mo", from: "", to: "" } }), { now: NOW });
    expect(r).toEqual({ shown: 1, total: 3, undatedHidden: 1 });
  });
  it("undatedHidden only counts undated comps that the date filter ALONE hid", () => {
    const wrongType = comp({ compType: "land", compDate: null });
    const r = countFiltered([undated, wrongType], F({ types: ["lease"], date: { mode: "3mo", from: "", to: "" } }), { now: NOW });
    expect(r.undatedHidden).toBe(1);
  });
  it("a comp dated after today is not hidden by a rolling window", () => {
    expect(run([at("2026-12-01")], { date: { mode: "3mo", from: "", to: "" } })).toHaveLength(1);
  });
});

describe("search", () => {
  const a = comp({ compType: "lease", title: "Beltway Distribution Center", notes: "cross-dock", partyProvider: "Prologis", partyAcquirer: "Acme Freight", anchor: { ...A("harris"), parcelApn: "0123-456" } });
  const b = comp({ compType: "land", title: "Katy tract", anchor: A("fort_bend") });
  it("tokenises on whitespace, case-insensitively", () => {
    expect(parseSearch("  Beltway   CENTER ")).toEqual(["beltway", "center"]);
    expect(parseSearch("")).toEqual([]);
  });
  it("every token must match, across title / notes / parties / APN / county", () => {
    for (const q of ["beltway", "cross-dock", "prologis", "acme", "0123-456", "harris", "beltway prologis harris"]) expect(matchesSearch(a, parseSearch(q)), q).toBe(true);
    expect(matchesSearch(a, parseSearch("beltway katy"))).toBe(false);
    expect(ids(applyFilters([a, b], F({ q: "fort bend" }), { now: NOW }))).toEqual([b.id]);
  });
  it("location text is searched only through the supplied cache-read callback", () => {
    let calls = 0;
    const cachedLocation = () => { calls++; return "1200 Main St, Houston"; };
    expect(matchesSearch(a, parseSearch("main"), { cachedLocation })).toBe(true);
    expect(matchesSearch(a, parseSearch("main"))).toBe(false);
    expect(calls).toBe(1);
  });
  it("search never triggers a geocode (no network API is touched)", () => {
    const g = globalThis;
    const realFetch = g.fetch; let fetched = 0;
    g.fetch = () => { fetched++; return Promise.reject(new Error("no network in search")); };
    try { applyFilters([a, b], F({ q: "nowhere in particular" }), { now: NOW }); } finally { g.fetch = realFetch; }
    expect(fetched).toBe(0);
  });
});

describe("sort — missing values at the end", () => {
  const big = lease({ leaseSizeSf: 500000, leaseRate: 8, leaseRatePeriod: "annual", compDate: "2026-01-01" });
  const small = lease({ leaseSizeSf: 50000, leaseRate: 0.9, leaseRatePeriod: "monthly", compDate: "2026-06-01" }); // $10.80/yr
  const noSize = lease({ leaseSizeSf: null, leaseRate: null, leaseRatePeriod: null, compDate: "2026-09-01" });
  const dated = (iso) => comp({ compType: "land", compDate: iso });
  it("newest is exactly sortCompsByRecency (default, unchanged)", () => {
    const set = [big, small, noSize];
    expect(ids(sortComps(set, "newest"))).toEqual(ids(sortCompsByRecency(set)));
    expect(ids(sortComps(set, "bogus"))).toEqual(ids(sortCompsByRecency(set)));
  });
  it("newest puts undated last too; dated keep recency order, undated keep Date-entered order", () => {
    const u1 = comp({ compType: "land", compDate: null, createdAt: "2026-10-01T00:00:00Z" });
    const u2 = comp({ compType: "land", compDate: null, createdAt: "2026-10-18T00:00:00Z" });
    const a = dated("2026-02-01"), b = dated("2026-08-01");
    expect(ids(sortComps([u1, a, u2, b], "newest"))).toEqual(ids([b, a, u2, u1]));
  });
  it("oldest puts undated last", () => {
    const u = comp({ compType: "land", compDate: null }), a = dated("2026-02-01"), b = dated("2026-08-01");
    expect(ids(sortComps([b, u, a], "oldest"))).toEqual(ids([a, b, u]));
  });
  it("largest / smallest by size, size-less last", () => {
    expect(ids(sortComps([small, noSize, big], "largest"))).toEqual(ids([big, small, noSize]));
    expect(ids(sortComps([noSize, big, small], "smallest"))).toEqual(ids([small, big, noSize]));
  });
  it("rate high/low by annualised rate, rate-less last (and non-leases last)", () => {
    const s = sale();
    const hi = sortComps([noSize, big, small, s], "rateHigh");
    expect(ids(hi.slice(0, 2))).toEqual(ids([small, big]));
    const lo = sortComps([noSize, big, small, s], "rateLow");
    expect(ids(lo.slice(0, 2))).toEqual(ids([big, small]));
    expect(new Set(ids(lo.slice(2)))).toEqual(new Set(ids([noSize, s])));
  });
  it("price/SF high/low, comps without one last", () => {
    const cheap = sale({ bldgPrice: 5_000_000, bldgSizeSf: 100000 }), dear = sale({ bldgPrice: 20_000_000, bldgSizeSf: 100000 }), none = sale({ bldgPrice: null });
    expect(ids(sortComps([none, cheap, dear], "psfHigh"))).toEqual(ids([dear, cheap, none]));
    expect(ids(sortComps([none, dear, cheap], "psfLow"))).toEqual(ids([cheap, dear, none]));
  });
  it("never mutates the input", () => {
    const set = [small, big]; const copy = [...set];
    sortComps(set, "largest");
    expect(set).toEqual(copy);
  });
});

describe("chips, removal, counts", () => {
  it("one removable chip per active filter, labelled", () => {
    const f = F({
      types: ["lease"], date: { mode: "12mo", from: "", to: "" }, sf: { min: "100000", max: "250000" },
      acres: { min: "2000", max: "" }, powerMin: "2000", counties: ["harris"],
    });
    const labels = activeFilterChips(f, { now: NOW }).map((c) => c.label);
    expect(labels).toEqual(["Lease", "12 mo", "100,000–250,000 SF", "≥ 2,000 A", "Power ≥ 2,000 A", "Harris County, TX"]);
  });
  it("removeFilter clears exactly that filter", () => {
    const f = F({ types: ["lease", "land"], sf: { min: "1", max: "" }, counties: ["harris", "waller"] });
    expect(removeFilter(f, "type:lease").types).toEqual(["land"]);
    expect(removeFilter(f, "sf").sf).toEqual({ min: "", max: "" });
    expect(removeFilter(f, "county:harris").counties).toEqual(["waller"]);
    expect(removeFilter(f, "nope")).toEqual(normalizeFilters(f));
    expect(activeFilterChips(removeFilter(removeFilter(f, "type:lease"), "type:land")).map((c) => c.key)).toEqual(["sf", "county:harris", "county:waller"]);
  });
  it("hasActiveQuery sees search text or any chip; the default is inactive", () => {
    expect(hasActiveQuery(defaultFilters())).toBe(false);
    expect(hasActiveQuery(F({ q: "  " }))).toBe(false);
    expect(hasActiveQuery(F({ q: "x" }))).toBe(true);
    expect(hasActiveQuery(F({ docksMin: "4" }))).toBe(true);
  });
  it("countyOptions: distinct counties with counts", () => {
    const opts = countyOptions([comp({}), comp({}), comp({ anchor: A("waller") }), comp({ anchor: { kind: "pin", lat: 1, lon: 1 } })]);
    expect(opts.map((o) => [o.key, o.count])).toEqual([["harris", 2], ["waller", 1]]);
  });
  it("toNum: separators, blanks, junk", () => {
    expect([toNum("1,200"), toNum(" 5 "), toNum(""), toNum("abc"), toNum(null), toNum(0)]).toEqual([1200, 5, null, null, null, 0]);
  });
  it("normalizeFilters survives garbage", () => {
    expect(normalizeFilters({ types: ["land", "alien"], date: { mode: "weird" }, sf: 5 }).types).toEqual(["land"]);
    expect(normalizeFilters(null)).toEqual(defaultFilters());
  });
});

describe("persistence (per device, try/catch)", () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  it("round-trips, clears, and survives a throwing / garbled store", () => {
    globalThis.localStorage = store;
    saveQueryPrefs(F({ q: "dock", types: ["lease"] }), "largest");
    expect(loadQueryPrefs()).toMatchObject({ sort: "largest", filters: { q: "dock", types: ["lease"] } });
    clearQueryPrefs();
    expect(mem.has(COMPS_QUERY_KEY)).toBe(false);
    expect(loadQueryPrefs().sort).toBe("newest");
    mem.set(COMPS_QUERY_KEY, "{not json");
    expect(loadQueryPrefs().filters).toEqual(defaultFilters());
    globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    expect(() => { saveQueryPrefs(defaultFilters(), "newest"); clearQueryPrefs(); }).not.toThrow();
    expect(loadQueryPrefs().sort).toBe("newest");
    delete globalThis.localStorage;
  });
});

describe("speed: a few hundred comps filter without lag", () => {
  it("1,000 comps × a heavy filter set in well under a frame budget", () => {
    const many = Array.from({ length: 1000 }, (_, i) => (i % 3 === 0 ? lease({ leaseSizeSf: 1000 * i }) : i % 3 === 1 ? sale({ bldgSizeSf: 1000 * i }) : land()));
    const t = performance.now();
    for (let i = 0; i < 20; i++) queryComps(many, F({ q: "a", sf: { min: "50000", max: "" }, clearHt: { min: "20", max: "" }, date: { mode: "12mo", from: "", to: "" } }), "largest", { now: NOW });
    expect((performance.now() - t) / 20).toBeLessThan(50);
  });
});
