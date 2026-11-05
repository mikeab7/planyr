// NEW-1 — Records search + filters. Red on main: src/shared/comps/lib/compsQuery.js does not exist there.
import { describe, it, expect } from "vitest";
import {
  defaultFilters, parseSearch, matchesSearch, applyFilters, countFiltered, sortComps, queryComps,
  activeFilterChips, removeFilter, hasActiveQuery, countyOptions, dateBounds, isoMinusDays, normalizeFilters, toNum,
  withTypes, typeScope, sectionSummaries, resultsLine, showButtonLabel, partyLabels, capRatePct,
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
  it("clear height, year built, power, dock doors (min and max)", () => {
    expect(run(all, { clearHt: { min: "30", max: "" } })).toEqual(ids([S1]));
    expect(run(all, { yearBuilt: { min: "", max: "2010" } })).toEqual(ids([L1, L2]));
    expect(run(all, { power: { min: "2,000", max: "" } })).toEqual(ids([S1]));
    expect(run(all, { power: { min: "", max: "1500" } })).toEqual(ids([L1, L2]));
    expect(run(all, { docks: { min: "15", max: "" } })).toEqual(ids([S1]));
    expect(run(all, { docks: { min: "", max: "12" } })).toEqual(ids([L1, L2]));
    expect(run(all, { docks: { min: "10", max: "10" } })).toEqual(ids([L1, L2]));
  });
  it("lease rate compares ANNUALISED rates whatever period was entered", () => {
    const monthly = lease({ leaseRate: 0.5, leaseRatePeriod: "monthly" }); // $6.00/yr
    const annual = lease({ leaseRate: 7, leaseRatePeriod: "annual" });
    const set = [monthly, annual];
    expect(run(set, { rate: { min: "5.5", max: "6.5" } })).toEqual(ids([monthly]));
    expect(run(set, { rate: { min: "6.5", max: "" } })).toEqual(ids([annual]));
    expect(run(set, { rate: { min: "", max: "6.5" } })).toEqual(ids([monthly]));
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
    expect(run([a, b, c], { types: ["lease"], clearHt: { min: "30", max: "" }, power: { min: "1000", max: "" } })).toEqual(ids([a, c]));
  });
  it("a blank value in a filtered field is EXCLUDED", () => {
    const blank = sale({ clearHeightFt: null, powerAmps: null, dockDoors: null, yearBuilt: null, bldgSizeSf: null });
    for (const patch of [{ clearHt: { min: "0", max: "" } }, { power: { min: "0", max: "" } }, { docks: { min: "0", max: "" } }, { yearBuilt: { min: "1800", max: "" } }, { sf: { min: "0", max: "" } }]) {
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
    expect(run([z], { docks: { min: "0", max: "" } })).toEqual(ids([z]));
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
  it("Any includes undated; a window simply excludes them (never counted or called out)", () => {
    expect(run([undated, today], { date: { mode: "any", from: "", to: "" } })).toEqual(ids([undated, today]));
    const r = countFiltered([undated, today, d91], F({ date: { mode: "3mo", from: "", to: "" } }), { now: NOW });
    expect(r).toEqual({ shown: 1, total: 3 });
    expect(Object.keys(r)).not.toContain("undatedHidden");
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
      acres: { min: "2000", max: "" }, power: { min: "2000", max: "" }, counties: ["harris"],
    });
    const labels = activeFilterChips(f, { now: NOW }).map((c) => c.label);
    // acres is pruned: Lease alone cannot show a Land field, so it is neither applied nor chipped
    expect(labels).toEqual(["Lease", "Past 12 mo", "Harris", "100k – 250k SF", "Power ≥ 2k A"]);
  });
  it("removeFilter clears exactly that filter", () => {
    const f = F({ types: ["lease", "land"], sf: { min: "1", max: "" }, counties: ["harris", "waller"] });
    expect(removeFilter(f, "type:lease").types).toEqual(["land"]);
    expect(removeFilter(f, "sf").sf).toEqual({ min: "", max: "" });
    expect(removeFilter(f, "county:harris").counties).toEqual(["waller"]);
    expect(removeFilter(f, "nope")).toEqual(normalizeFilters(f));
    expect(activeFilterChips(removeFilter(removeFilter(f, "type:lease"), "type:land")).map((c) => c.key)).toEqual(["county:harris", "county:waller"]); // Land alone hides Building, so sf was pruned with it
  });
  it("hasActiveQuery sees search text or any chip; the default is inactive", () => {
    expect(hasActiveQuery(defaultFilters())).toBe(false);
    expect(hasActiveQuery(F({ q: "  " }))).toBe(false);
    expect(hasActiveQuery(F({ q: "x" }))).toBe(true);
    expect(hasActiveQuery(F({ docks: { min: "4", max: "" } }))).toBe(true);
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

/* ---- NEW-1 amendment (2026-10-23): section-matching filters ------------------------------------- */

describe("new filters — each alone", () => {
  const L = (o = {}) => lease({ leaseTerm: "60 mo", leaseEscalationPct: 3, leaseFreeRentMonths: 2, leaseTi: 10, ...o });
  const short = L({ leaseTerm: "36 mo" }), long = L({ leaseTerm: "10 yrs" }), noTerm = L({ leaseTerm: null }), unreadable = L({ leaseTerm: "negotiable" });
  const S = (o = {}) => sale({ bldgNoi: 900_000, bldgCapRate: 0.06, ...o });
  it("term (years): 'mo' and 'yrs' both read; min, max, both; blank / unreadable excluded", () => {
    const set = [short, long, noTerm, unreadable];
    expect(run(set, { term: { min: "5", max: "" } })).toEqual(ids([long]));
    expect(run(set, { term: { min: "", max: "4" } })).toEqual(ids([short]));
    expect(run(set, { term: { min: "3", max: "3" } })).toEqual(ids([short]));
    expect(run(set, { term: { min: "0", max: "" } })).toEqual(ids([short, long]));
  });
  it("escalations %", () => {
    const lo = L({ leaseEscalationPct: 2 }), hi = L({ leaseEscalationPct: 4 }), none = L({ leaseEscalationPct: null });
    expect(run([lo, hi, none], { escal: { min: "3", max: "" } })).toEqual(ids([hi]));
    expect(run([lo, hi, none], { escal: { min: "", max: "3" } })).toEqual(ids([lo]));
  });
  it("free rent months (zero is a value)", () => {
    const zero = L({ leaseFreeRentMonths: 0 }), six = L({ leaseFreeRentMonths: 6 }), none = L({ leaseFreeRentMonths: null });
    expect(run([zero, six, none], { freeRent: { min: "3", max: "" } })).toEqual(ids([six]));
    expect(run([zero, six, none], { freeRent: { min: "", max: "0" } })).toEqual(ids([zero]));
  });
  it("TI $/SF", () => {
    const a = L({ leaseTi: 5 }), b = L({ leaseTi: 25 }), none = L({ leaseTi: null });
    expect(run([a, b, none], { ti: { min: "10", max: "30" } })).toEqual(ids([b]));
    expect(run([a, b, none], { ti: { min: "", max: "10" } })).toEqual(ids([a]));
  });
  it("lease-only fields never match a sale or land", () => {
    const set = [sale({ leaseTerm: "60 mo", leaseTi: 10 }), land(), L()];
    for (const patch of [{ term: { min: "1", max: "" } }, { escal: { min: "1", max: "" } }, { freeRent: { min: "0", max: "" } }, { ti: { min: "1", max: "" } }]) {
      expect(run(set, patch).length, JSON.stringify(patch)).toBe(1);
    }
  });
  it("cap rate is typed as a percent and stored as a fraction", () => {
    const five = S({ bldgCapRate: 0.05 }), six = S({ bldgCapRate: 0.0575 }), none = S({ bldgCapRate: null });
    expect(capRatePct(six)).toBe(5.75);
    expect(run([five, six, none], { capRate: { min: "5.5", max: "" } })).toEqual(ids([six]));
    expect(run([five, six, none], { capRate: { min: "5.75", max: "5.75" } })).toEqual(ids([six]));
    expect(run([five, six, none], { capRate: { min: "", max: "5" } })).toEqual(ids([five]));
  });
  it("NOI", () => {
    const a = S({ bldgNoi: 500_000 }), b = S({ bldgNoi: 1_500_000 }), none = S({ bldgNoi: null });
    expect(run([a, b, none], { noi: { min: "1,000,000", max: "" } })).toEqual(ids([b]));
    expect(run([a, b, none], { noi: { min: "", max: "1000000" } })).toEqual(ids([a]));
  });
  it("sale-only fields never match a lease or land", () => {
    const set = [lease({ bldgNoi: 1, bldgCapRate: 0.05 }), land(), S()];
    expect(run(set, { capRate: { min: "1", max: "" } }).length).toBe(1);
    expect(run(set, { noi: { min: "1", max: "" } }).length).toBe(1);
  });
  it("dock doors / power now take a max as well", () => {
    const few = sale({ dockDoors: 4, powerAmps: 800 }), many = sale({ dockDoors: 40, powerAmps: 4000 });
    expect(run([few, many], { docks: { min: "", max: "10" } })).toEqual(ids([few]));
    expect(run([few, many], { power: { min: "", max: "1000" } })).toEqual(ids([few]));
  });
  it("landlord / tenant 'name contains': case-insensitive, trimmed, a blank party is excluded", () => {
    const a = lease({ partyProvider: "Prologis Inc", partyAcquirer: "Acme Freight" });
    const b = sale({ partyProvider: "Smith Family Trust", partyAcquirer: null });
    const c = land({ partyProvider: null, partyAcquirer: "ACME holdings" });
    expect(run([a, b, c], { landlord: "PROLOGIS" })).toEqual(ids([a]));
    expect(run([a, b, c], { landlord: "  trust " })).toEqual(ids([b]));
    expect(run([a, b, c], { tenant: "acme" })).toEqual(ids([a, c]));
    expect(run([a, b, c], { landlord: "smith", tenant: "acme" })).toEqual([]);
    expect(run([a, b, c], { landlord: "   " })).toEqual(ids([a, b, c])); // whitespace alone is not a filter
  });
  it("a stored power / docks 'at least' box (powerMin / docksMin) is carried over", () => {
    const f = normalizeFilters({ powerMin: "2000", docksMin: "8" });
    expect(f.power).toEqual({ min: "2000", max: "" });
    expect(f.docks).toEqual({ min: "8", max: "" });
    expect("powerMin" in f).toBe(false);
  });
});

describe("new filters — combined (AND)", () => {
  it("lease term + escalations + free rent + TI + landlord all must hold", () => {
    const mk = (o) => lease({ leaseTerm: "5 yrs", leaseEscalationPct: 3, leaseFreeRentMonths: 3, leaseTi: 15, partyProvider: "Prologis", ...o });
    const hit = mk({}), badTerm = mk({ leaseTerm: "2 yrs" }), badTi = mk({ leaseTi: 1 }), badLandlord = mk({ partyProvider: "Other" });
    const patch = { types: ["lease"], term: { min: "4", max: "" }, escal: { min: "2", max: "4" }, freeRent: { min: "1", max: "" }, ti: { min: "10", max: "" }, landlord: "prolo" };
    expect(run([hit, badTerm, badTi, badLandlord], patch)).toEqual(ids([hit]));
  });
  it("sale cap + NOI + price/SF + tenant/buyer", () => {
    const mk = (o) => sale({ bldgPrice: 15_000_000, bldgSizeSf: 100000, bldgNoi: 900_000, bldgCapRate: 0.06, partyAcquirer: "Acme", ...o });
    const hit = mk({}), badCap = mk({ bldgCapRate: 0.04 }), badBuyer = mk({ partyAcquirer: "Zed" });
    expect(run([hit, badCap, badBuyer], { types: ["building_sale"], capRate: { min: "5", max: "7" }, noi: { min: "800000", max: "" }, bldgPsf: { min: "100", max: "200" }, tenant: "acm" })).toEqual(ids([hit]));
  });
  it("new filters AND with the old ones (type, date, county, size)", () => {
    const hit = lease({ leaseTerm: "5 yrs", compDate: "2026-09-01", anchor: A("fort_bend"), leaseSizeSf: 200000 });
    const wrongCounty = lease({ leaseTerm: "5 yrs", compDate: "2026-09-01", leaseSizeSf: 200000 });
    const old = lease({ leaseTerm: "5 yrs", compDate: "2025-01-01", anchor: A("fort_bend"), leaseSizeSf: 200000 });
    expect(run([hit, wrongCounty, old], { types: ["lease"], term: { min: "4", max: "" }, date: { mode: "3mo", from: "", to: "" }, counties: ["fort_bend"], sf: { min: "100000", max: "" } })).toEqual(ids([hit]));
  });
});

describe("a type change prunes the filters it no longer shows", () => {
  const lots = F({
    rate: { min: "5", max: "9" }, basis: ["nnn"], term: { min: "3", max: "" }, escal: { min: "2", max: "" }, freeRent: { min: "1", max: "" }, ti: { min: "5", max: "" },
    bldgPsf: { min: "100", max: "" }, capRate: { min: "5", max: "" }, noi: { min: "1", max: "" }, landPsf: { min: "2", max: "" },
    sf: { min: "50000", max: "" }, clearHt: { min: "28", max: "" }, docks: { min: "4", max: "" }, power: { min: "1000", max: "" }, yearBuilt: { min: "2000", max: "" },
    acres: { min: "2", max: "" }, landlord: "pro", tenant: "acme", counties: ["harris"], date: { mode: "12mo", from: "", to: "" },
  });
  const keys = (f) => activeFilterChips(f, { now: NOW }).map((c) => c.key);
  it("typeScope: none = everything; Land alone has no Building", () => {
    expect(typeScope([])).toEqual({ lease: true, sale: true, land: true, building: true });
    expect(typeScope(["land"])).toEqual({ lease: false, sale: false, land: true, building: false });
    expect(typeScope(["lease", "land"]).building).toBe(true);
  });
  it("with no type selected nothing is pruned", () => {
    expect(keys(lots)).toEqual(expect.arrayContaining(["rate", "basis:nnn", "term", "bldgPsf", "capRate", "landPsf", "acres", "sf", "docks"]));
  });
  it("deselecting Lease drops NNN/Gross, rate and every other lease field", () => {
    const f = withTypes(lots, ["building_sale", "land"]);
    for (const k of ["rate", "basis", "term", "escal", "freeRent", "ti"]) expect(f[k]).toEqual(defaultFilters()[k]);
    expect(keys(f)).not.toEqual(expect.arrayContaining(["rate"]));
    expect(keys(f).some((k) => k.startsWith("basis:"))).toBe(false);
    expect(keys(f)).toEqual(expect.arrayContaining(["bldgPsf", "capRate", "noi", "landPsf", "sf", "acres"]));
  });
  it("Lease only drops the sale and land fields and acres", () => {
    const f = withTypes(lots, ["lease"]);
    for (const k of ["bldgPsf", "capRate", "noi", "landPsf", "acres"]) expect(f[k]).toEqual(defaultFilters()[k]);
    expect(f.sf).toEqual({ min: "50000", max: "" });
  });
  it("Land only drops every Building field and the lease/sale ones", () => {
    const f = withTypes(lots, ["land"]);
    for (const k of ["sf", "clearHt", "yearBuilt", "docks", "power", "rate", "term", "capRate", "noi"]) expect(f[k]).toEqual(defaultFilters()[k]);
    expect(f.landPsf).toEqual({ min: "2", max: "" });
    expect(f.acres).toEqual({ min: "2", max: "" });
    expect(f.landlord).toBe("pro"); // parties / date / county apply to every type
    expect(f.counties).toEqual(["harris"]);
    expect(f.date.mode).toBe("12mo");
  });
  it("a hidden filter can never keep filtering: stale state is dead even if it reaches the engine", () => {
    const rich = lease({ leaseRate: 0.5, leaseRatePeriod: "monthly" }); // $6/yr
    const stale = { ...lots, types: ["building_sale"] }; // rate 5–9 + NNN still in the object
    const s1 = sale();
    expect(ids(applyFilters([rich, s1], { ...stale, rate: { min: "100", max: "" }, sf: { min: "", max: "" }, bldgPsf: { min: "", max: "" }, capRate: { min: "", max: "" }, noi: { min: "", max: "" }, landPsf: { min: "", max: "" }, acres: { min: "", max: "" }, clearHt: { min: "", max: "" }, docks: { min: "", max: "" }, power: { min: "", max: "" }, yearBuilt: { min: "", max: "" }, landlord: "", tenant: "", counties: [], date: { mode: "any", from: "", to: "" } }, { now: NOW }))).toEqual(ids([s1]));
  });
  it("active chips list exactly the applied filters (chip count === filters that changed the query)", () => {
    const f = withTypes(F({ types: ["lease", "land"], rate: { min: "5", max: "" }, capRate: { min: "5", max: "" }, acres: { min: "2", max: "" } }), ["lease"]);
    expect(keys(f)).toEqual(["type:lease", "rate"]);
    const all3 = { ...lots, types: ["lease", "building_sale", "land"] };
    expect(keys(removeFilter(all3, "type:lease"))).toEqual(keys(all3).filter((k) => !["type:lease", "rate", "basis:nnn", "term", "escal", "freeRent", "ti"].includes(k)));
  });
  it("stored garbage with a stale hidden filter is pruned on load", () => {
    const loaded = normalizeFilters({ types: ["land"], rate: { min: "5", max: "9" }, basis: ["gross"] });
    expect(loaded.rate).toEqual({ min: "", max: "" });
    expect(loaded.basis).toEqual([]);
  });
});

describe("chips, header summaries and the results line", () => {
  it("every new filter has a removable chip; removal clears exactly it", () => {
    const f = F({ term: { min: "3", max: "5" }, escal: { min: "2", max: "" }, freeRent: { min: "", max: "6" }, ti: { min: "10", max: "" }, capRate: { min: "5", max: "7" }, noi: { min: "1,000,000", max: "" }, landlord: "pro", tenant: "acme" });
    const chips = activeFilterChips(f, { now: NOW });
    expect(chips.map((c) => c.key)).toEqual(["term", "escal", "freeRent", "ti", "capRate", "noi", "landlord", "tenant"]);
    expect(chips.map((c) => c.label)).toEqual([
      "Term 3 – 5 yrs", "Escalations ≥ 2 %", "Free rent ≤ 6 mo", "TI ≥ $10 /SF", "Cap rate 5 – 7 %", "NOI ≥ $1,000,000", "Landlord / seller: pro", "Tenant / buyer: acme",
    ]);
    for (const c of chips) {
      const after = removeFilter(f, c.key);
      expect(activeFilterChips(after, { now: NOW }).map((x) => x.key)).toEqual(chips.map((x) => x.key).filter((k) => k !== c.key));
    }
  });
  it("chip examples from the design: Lease, Past 12 mo, 100k – 300k SF", () => {
    const f = F({ types: ["lease"], date: { mode: "12mo", from: "", to: "" }, sf: { min: "100000", max: "300000" } });
    expect(activeFilterChips(f, { now: NOW }).map((c) => c.label)).toEqual(["Lease", "Past 12 mo", "100k – 300k SF"]);
  });
  it("section header values: full figures, Any (null) when unset", () => {
    expect(sectionSummaries(defaultFilters(), { now: NOW })).toEqual({ type: null, date: null, location: null, deal: null, building: null, land: null, parties: null });
    const s = sectionSummaries(F({ types: ["lease"], date: { mode: "12mo", from: "", to: "" }, sf: { min: "100000", max: "300000" }, counties: ["harris"], rate: { min: "5", max: "" }, term: { min: "3", max: "" }, landlord: "pro" }), { now: NOW });
    expect(s.type).toBe("Lease");
    expect(s.date).toBe("Past 12 months");
    expect(s.building).toBe("100,000 – 300,000 SF");
    expect(s.location).toBe("Harris");
    expect(s.deal).toBe("2 set");
    expect(s.parties).toBe("Landlord: pro");
  });
  it("party labels switch to Seller / Buyer when only sales and land are selected", () => {
    expect(partyLabels([])).toEqual({ landlord: "Landlord / seller", tenant: "Tenant / buyer" });
    expect(partyLabels(["lease", "land"])).toEqual({ landlord: "Landlord / seller", tenant: "Tenant / buyer" });
    expect(partyLabels(["lease"])).toEqual({ landlord: "Landlord", tenant: "Tenant" });
    expect(partyLabels(["building_sale"])).toEqual({ landlord: "Seller", tenant: "Buyer" });
    expect(partyLabels(["land", "building_sale"])).toEqual({ landlord: "Seller", tenant: "Buyer" });
  });
  it("the results line is just '12 of 41 comps' — never a hidden / undated / blank note", () => {
    const undated = lease({ compDate: null }), dated = lease({ compDate: "2026-10-01" });
    const counts = countFiltered([undated, dated], F({ date: { mode: "3mo", from: "", to: "" }, sf: { min: "1", max: "" } }), { now: NOW });
    const line = resultsLine(counts);
    expect(line).toBe("1 of 2 comps");
    expect(line).not.toMatch(/hidden|undated|blank|no size|include/i);
    expect(resultsLine({ shown: 12, total: 41 })).toBe("12 of 41 comps");
    expect(resultsLine({ shown: 1, total: 1 })).toBe("1 of 1 comp");
    expect(JSON.stringify(counts)).not.toMatch(/undated|hidden/i);
  });
  it("the footer button reads 'Show 12 comps'", () => {
    expect(showButtonLabel({ shown: 12 })).toBe("Show 12 comps");
    expect(showButtonLabel({ shown: 1 })).toBe("Show 1 comp");
    expect(showButtonLabel({ shown: 0 })).toBe("Show 0 comps");
  });
  it("county options carry a short label for the chips", () => {
    expect(countyOptions([comp({}), comp({})])[0]).toMatchObject({ key: "harris", count: 2, short: "Harris" });
  });
});
