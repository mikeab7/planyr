/* NEW-2 (2026-09-29) — the pure halves of the map finder's city-name layer: the zoom gate, the
 * tier rule (big cities first, more as you zoom in), the collision pass, and the committed
 * datasets. The drawing itself is asserted on the real page by ui-audit/verify-place-names.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLACE_NAMES_MAX_ZOOM, placeNamesVisible } from "../src/workspaces/site-planner/lib/placeNamesGate.js";
import { PARCEL_MINZOOM } from "../src/workspaces/site-planner/lib/parcelDisplayZoom.js";
import { decodePlaces, placesForZoom, placeNamesOpacity, layoutLabels, TOWNS_MIN_ZOOM } from "../src/workspaces/site-planner/lib/placeNamesData.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => decodePlaces(JSON.parse(readFileSync(resolve(here, "../public/geo", f), "utf8")));
const backbone = load("place-names.json");
const towns = load("place-names-towns.json");
const all = backbone.concat(towns);
const namesAt = (z) => new Set(placesForZoom(all, z).map((p) => p.name));

describe("NEW-2 · the city-name gate", () => {
  it("is on across the map's working range and gone once parcels draw", () => {
    for (const z of [3, 5, 8, 10, 12, 13]) expect(placeNamesVisible(z)).toBe(true);
    for (const z of [2, 14, 16, 19]) expect(placeNamesVisible(z)).toBe(false);
    expect(PLACE_NAMES_MAX_ZOOM).toBe(PARCEL_MINZOOM - 1);
  });
  it("reads a not-yet-reported zoom as nothing, never zoom 0", () => {
    for (const z of [null, undefined, NaN]) expect(placeNamesVisible(z)).toBe(false);
  });
  it("recedes across the last step before parcels, and is 0 outside the band", () => {
    expect(placeNamesOpacity(12)).toBe(1);
    expect(placeNamesOpacity(13)).toBeLessThan(1);
    expect(placeNamesOpacity(13)).toBeGreaterThan(0);
    expect(placeNamesOpacity(14)).toBe(0);
    expect(placeNamesOpacity(2)).toBe(0);
  });
});

describe("NEW-2 · the city set grows as you zoom in, big cities first", () => {
  it("only ever grows with zoom (a name shown at z stays at z+1)", () => {
    let prev = new Set();
    for (let z = 3; z <= 13; z++) {
      const cur = namesAt(z);
      for (const n of prev) expect(cur.has(n)).toBe(true);
      expect(cur.size).toBeGreaterThanOrEqual(prev.size);
      prev = cur;
    }
    expect(namesAt(12).size).toBeGreaterThan(namesAt(4).size);
  });
  it("shows the big Texas cities before the small Houston-area towns", () => {
    const at = (n) => Math.min(...all.filter((p) => p.name === n && p.lat > 25 && p.lat < 37 && p.lng < -93 && p.lng > -107).map((p) => p.minZoom));
    for (const big of ["Houston", "Dallas", "San Antonio", "Austin"]) expect(at(big)).toBeLessThanOrEqual(6);
    for (const small of ["Katy", "Pearland", "Sugar Land", "Brookshire", "Baytown", "Conroe"]) {
      expect(Number.isFinite(at(small))).toBe(true);
      expect(at(small)).toBeGreaterThan(at("Houston"));
    }
    expect(namesAt(3).has("Katy")).toBe(false);
    expect(namesAt(11).has("Katy")).toBe(true);
  });
  it("keeps the small-town dataset out of the low zooms, so it is never fetched there", () => {
    expect(Math.min(...towns.map((p) => p.minZoom))).toBeGreaterThanOrEqual(TOWNS_MIN_ZOOM);
  });
});

describe("NEW-2 · collision pass", () => {
  const measure = (name) => name.length * 7;
  it("keeps the more important label and drops the one it would overlap", () => {
    const out = layoutLabels([
      { name: "Houston", x: 100, y: 100, minZoom: 3 },
      { name: "Bellaire", x: 110, y: 104, minZoom: 9 },
      { name: "Katy", x: 300, y: 100, minZoom: 9 },
    ], measure, 800, 600);
    expect(out.map((l) => l.name)).toEqual(["Houston", "Katy"]);
  });
  it("culls what is off-screen and caps a dense metro", () => {
    expect(layoutLabels([{ name: "Far", x: -500, y: 10, minZoom: 3 }], measure, 800, 600)).toEqual([]);
    const dense = Array.from({ length: 500 }, (_, i) => ({ name: "T" + i, x: (i % 25) * 30, y: Math.floor(i / 25) * 25, minZoom: 10 }));
    expect(layoutLabels(dense, measure, 800, 600, { max: 40 }).length).toBeLessThanOrEqual(40);
  });
});

describe("NEW-2 · committed datasets", () => {
  it("carry the cities the owner named, in the right place", () => {
    const find = (n) => all.find((p) => p.name === n && p.lat > 25 && p.lat < 37 && p.lng < -93 && p.lng > -107);
    for (const n of ["Houston", "Dallas", "San Antonio", "Austin", "Katy", "Baytown", "Pearland", "Sugar Land", "Conroe", "Brookshire"]) expect(find(n), n).toBeTruthy();
    expect(Math.abs(find("Houston").lat - 29.76)).toBeLessThan(0.2);
    expect(Math.abs(find("Katy").lng + 95.8)).toBeLessThan(0.3);
  });
  it("stay lazy-sized: backbone small, towns only fetched at 9+", () => {
    expect(JSON.stringify(JSON.parse(readFileSync(resolve(here, "../public/geo/place-names.json"), "utf8"))).length).toBeLessThan(300 * 1024);
  });
});
