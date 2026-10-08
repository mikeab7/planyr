/* foodAddressSearch (B2051665) — typing a CITY or a full STREET ADDRESS finds places in the snapshot.
 * Fixture rows only; the production function itself was proven with read-only queries (see the item). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mergeNameAndAddressRows } from "../src/workspaces/food/lib/foodStore.js";
import { rankSearchCandidates, namesAlike } from "../src/workspaces/food/lib/searchQuality.js";
import { rankByProximity } from "../src/workspaces/food/lib/searchProximity.js";

const view = (lat, lon, half = 0.1) => ({ south: lat - half, north: lat + half, west: lon - half, east: lon + half });
const KATY = view(29.7858, -95.8245);
const addr = (id, name, address, lat, lon) => ({ id, name, address, lat, lon, sim: 0.95, confidence: 0.9 });
const SKILLMAN = "7170 Skillman St, Dallas, TX, 75231-5651";
const THREE_AT_ONE_ADDRESS = [
  addr("a1", "Fish City Grill", SKILLMAN, 32.8756, -96.7436),
  addr("a2", "Jersey Mike's", SKILLMAN, 32.8756, -96.7436),
  addr("a3", "Yogurtland Dallas", SKILLMAN, 32.8756, -96.7436),
];

describe("address search (B2051665)", () => {
  it("merges: name rows first, address-only rows after, a place found both ways listed once", () => {
    const name = [{ id: "n1", name: "Katy Cafe" }, { id: "x", name: "Both" }];
    const address = [{ id: "x", name: "Both" }, { id: "a1", name: "Only By Address" }];
    expect(mergeNameAndAddressRows(name, address).map((r) => r.id)).toEqual(["n1", "x", "a1"]);
    expect(mergeNameAndAddressRows(undefined, undefined)).toEqual([]);
    expect(mergeNameAndAddressRows(name, null).map((r) => r.id)).toEqual(["n1", "x"]);
  });

  it("several DIFFERENT restaurants at one address all survive the duplicate collapse (red before: collapsed to 1)", () => {
    const out = rankSearchCandidates("7170 Skillman St Dallas", THREE_AT_ONE_ADDRESS, new Set());
    expect(out.map((r) => r.id).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("…while a real same-storefront duplicate (alike names, metres apart) still collapses", () => {
    const a = addr("d1", "Fadis Express Binz Llc", "1801 Binz St Ste 130, Houston, TX", 29.735251, -95.379377);
    const b = addr("d2", "Fadi's Eatery", "1801 Binz St, Houston, TX", 29.735217, -95.379018);
    expect(namesAlike(a, b)).toBe(true);
    expect(namesAlike(THREE_AT_ONE_ADDRESS[0], THREE_AT_ONE_ADDRESS[1])).toBe(false);
    expect(rankSearchCandidates("fadis", [a, b], new Set())).toHaveLength(1);
  });

  it("a far full street address tops the list while viewing Katy; a city word lists its places nearest-first", () => {
    const nearNoise = addr("k1", "Skillman Tacos", "5 Katy Fwy, Katy, TX, 77450", 29.79, -95.82);
    nearNoise.sim = 0.55;
    const ranked = rankSearchCandidates("7170 Skillman St Dallas", [nearNoise, ...THREE_AT_ONE_ADDRESS], new Set());
    const top = rankByProximity("7170 Skillman St Dallas", ranked, KATY);
    expect(top.slice(0, 3).map((r) => r.id).sort()).toEqual(["a1", "a2", "a3"]);

    const katy2 = addr("k2", "Katy Diner", "1 Main St, Katy, TX, 77493", 29.70, -95.75);
    const dallas = addr("d9", "Dallas Diner", "9 Elm St, Dallas, TX, 75201", 32.78, -96.80);
    const katy1 = addr("k1c", "Katy Grill", "5 Katy Fwy, Katy, TX, 77450", 29.79, -95.82);
    const city = rankByProximity("Katy", rankSearchCandidates("Katy", [dallas, katy2, katy1], new Set()), KATY);
    expect(city.map((r) => r.id)).toEqual(["k1c", "k2"]); // Dallas row isn't a "Katy" match at all
  });

  it("the SQL: a read-only, injection-proof, granted function, plus the index that serves it", () => {
    const sql = readFileSync(new URL("../src/workspaces/food/db/food.sql", import.meta.url), "utf8");
    const i = sql.indexOf("create or replace function public.food_places_search_by_address(");
    expect(i).toBeGreaterThan(-1);
    const fn = sql.slice(i, sql.indexOf("grant execute on function public.food_places_search_by_address", i));
    expect(fn).toMatch(/language sql stable/);
    expect(fn).toContain("[^a-z0-9]+");      // words are letters/digits only: no LIKE wildcard can come from the query
    expect(fn).not.toMatch(/\bexecute\b\s+['"(]|format\(/i); // no dynamic SQL
    expect(fn).toMatch(/limit least\(greatest\(1, p_cap\), 100\)/);
    expect(sql).toMatch(/grant execute on function public\.food_places_search_by_address\(text, integer, double precision, double precision\) to anon, authenticated/);
    expect(sql).toContain("food_places_address_trgm_idx");
  });

  it("foodStore calls it in parallel with the name search and never lets its failure hide name results", () => {
    const store = readFileSync(new URL("../src/workspaces/food/lib/foodStore.js", import.meta.url), "utf8");
    expect(store).toContain('supabase.rpc("food_places_search_by_address"');
    expect(store).toMatch(/Promise\.all\(\[nameCall, addrCall\]\)/);
    expect(store).toMatch(/reportAddressSearchError\(addrRes\.error\)/);
    expect(store).toMatch(/error: nameRes\.error/);
  });
});
