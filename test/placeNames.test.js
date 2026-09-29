/* NEW-2 (2026-09-29) — the pure halves of the map finder's city-name layer: the zoom gate, the
 * tier rule (big cities first, more as you zoom in), the collision pass, and the committed
 * datasets. The drawing itself is asserted on the real page by ui-audit/verify-place-names.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLACE_NAMES_MAX_ZOOM, placeNamesVisible } from "../src/workspaces/site-planner/lib/placeNamesGate.js";
import { PARCEL_MINZOOM } from "../src/workspaces/site-planner/lib/parcelDisplayZoom.js";
import { decodePlaces, placesForZoom, placeNamesOpacity, layoutLabels, TOWNS_MIN_ZOOM, placeKey, zoomEase, lerpPoint, stepScalar, stepFade, FADE_MS } from "../src/workspaces/site-planner/lib/placeNamesData.js";

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

describe("NEW-1 (amend) · stable priority — a collision is decided by importance, never by input order", () => {
  const measure = (name) => name.length * 7;
  const big = { name: "Houston", x: 100, y: 100, minZoom: 3 };
  const small = { name: "Bellaire", x: 108, y: 102, minZoom: 9 };
  it("higher tier wins whichever order the candidates arrive in", () => {
    for (const order of [[big, small], [small, big]]) {
      expect(layoutLabels(order, measure, 800, 600).map((l) => l.name)).toEqual(["Houston"]);
    }
  });
  it("same-tier ties break deterministically (name, then position), in every permutation", () => {
    const a = { name: "Alvin", x: 100, y: 100, minZoom: 9, lat: 29.4, lng: -95.2 };
    const b = { name: "Brazoria", x: 104, y: 101, minZoom: 9, lat: 29.0, lng: -95.5 };
    const c = { name: "Clute", x: 102, y: 99, minZoom: 9, lat: 29.0, lng: -95.4 };
    const perms = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
    const outs = perms.map((p) => layoutLabels(p, measure, 800, 600).map((l) => l.name).join());
    expect(new Set(outs).size).toBe(1);
    expect(outs[0]).toBe("Alvin");
  });
  it("the drawn set never depends on the array's order", () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({ name: "P" + i, x: (i * 37) % 500, y: (i * 53) % 300, minZoom: 3 + (i % 4) * 2, lat: i, lng: -i }));
    const ref = layoutLabels(pts, measure, 800, 600).map((l) => l.name).sort();
    const rev = layoutLabels(pts.slice().reverse(), measure, 800, 600).map((l) => l.name).sort();
    expect(rev).toEqual(ref);
  });
});

describe("NEW-1 (amend) · hysteresis — a label already showing survives the edge of a collision", () => {
  const measure = (name) => name.length * 7;
  // Two same-tier labels a hair apart: from scratch the alphabetically-first wins and the other
  // is rejected; once both are HELD they keep their places through the same near-touch.
  const gap = (dx) => [
    { name: "Aaa", x: 100, y: 100, minZoom: 9, lat: 1, lng: 1 },
    { name: "Bbb", x: 100 + 21 + 2 * 3 + dx, y: 100, minZoom: 9, lat: 1, lng: 2 },
  ];
  it("from scratch, two labels closer than the full pad cannot both show", () => {
    expect(layoutLabels(gap(-2), measure, 800, 600).length).toBe(1);
  });
  it("a held label is kept where a newcomer would have been dropped", () => {
    const cands = gap(-2).map((c) => ({ ...c, key: placeKey(c) }));
    const out = layoutLabels(cands, measure, 800, 600, { held: new Set([cands[0].key, cands[1].key]) });
    expect(out.length).toBe(2);
  });
  it("a held lower-priority label still yields to a higher tier (importance is never overridden)", () => {
    const big = { name: "Houston", x: 100, y: 100, minZoom: 3, lat: 1, lng: 1 };
    const held = { name: "Bellaire", x: 108, y: 102, minZoom: 9, lat: 1, lng: 2 };
    const out = layoutLabels([held, big], measure, 800, 600, { held: new Set([placeKey(held)]) });
    expect(out.map((l) => l.name)).toEqual(["Houston"]);
  });
  it("among equals, the held one is preferred over a newcomer", () => {
    const a = { name: "Aaa", x: 100, y: 100, minZoom: 9, lat: 1, lng: 1 };
    const b = { name: "Bbb", x: 104, y: 100, minZoom: 9, lat: 1, lng: 2 };
    expect(layoutLabels([a, b], measure, 800, 600, { held: new Set([placeKey(b)]) }).map((l) => l.name)).toEqual(["Bbb"]);
  });
});

describe("NEW-1 (amend) · zoom-animation maths (mirrors Leaflet's 0.25s cubic-bezier(0,0,.25,1))", () => {
  it("eases from 0 to 1, monotonic, front-loaded like the tiles", () => {
    expect(zoomEase(0)).toBe(0); expect(zoomEase(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 20; i++) { const v = zoomEase(i / 20); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(zoomEase(0.5)).toBeGreaterThan(0.5);
    expect(zoomEase(-1)).toBe(0); expect(zoomEase(2)).toBe(1);
  });
  it("lerps a screen point between the start-view and end-view projections", () => {
    expect(lerpPoint({ x: 0, y: 10 }, { x: 100, y: 30 }, 0.25)).toEqual({ x: 25, y: 15 });
  });
  it("fades a label toward its target at a fixed rate and drops it once gone", () => {
    expect(stepScalar(0, 1, FADE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(stepScalar(1, 0, FADE_MS * 3)).toBe(0);
    const tracked = new Map([["a", { a: 1 }], ["b", { a: 0.05 }]]);
    const busy = stepFade(tracked, new Set(["a"]), FADE_MS);
    expect(tracked.has("b")).toBe(false);
    expect(tracked.get("a").a).toBe(1);
    expect(busy).toBe(false);
    tracked.set("c", { a: 0 });
    expect(stepFade(tracked, new Set(["a", "c"]), FADE_MS / 4)).toBe(true);
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
