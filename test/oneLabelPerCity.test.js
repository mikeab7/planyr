/* NEW-2 (2026-09-30) — a city is labelled ONCE. Owner-reported live: Lewisville, Flower Mound, Carrollton, Coppell,
 * Southlake and The Colony each read twice, stacked (the City-names canvas layer AND the city-limits overlay's own
 * labels). The behavioural proof is `ui-audit/verify-one-label-per-city.mjs` (real engine, live data, teeth-proven on
 * the un-fixed code); this pins the seam so it cannot be quietly cut. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { setPlaceNamesShown, placeNamesShown, placeNameKey } from "../src/workspaces/site-planner/lib/placeNamesGate.js";

const src = (p) => fs.readFileSync(new URL("../src/workspaces/site-planner/lib/" + p, import.meta.url), "utf8");

describe("the shown-names registry (placeNamesGate leaf)", () => {
  it("is empty for a map nothing has published to — never null, so callers need no guard", () => {
    expect(placeNamesShown({}).size).toBe(0);
    expect(placeNamesShown(null).size).toBe(0);
  });
  it("stores a map's set, normalises keys, and fires pf:placenames so the overlay can re-place", () => {
    const fired = []; const map = { fire: (e) => fired.push(e) };
    setPlaceNamesShown(map, ["Lewisville", "the colony"].map(placeNameKey));
    expect([...placeNamesShown(map)].sort()).toEqual(["lewisville", "the colony"]);
    expect(placeNameKey("  The Colony ")).toBe("the colony");
    expect(fired).toEqual(["pf:placenames"]);
    setPlaceNamesShown(map, []);                                  // layer off / destroyed → the boundary labels come back
    expect(placeNamesShown(map).size).toBe(0);
  });
  it("a torn-down map cannot throw out of a draw frame", () => {
    expect(() => setPlaceNamesShown({ fire() { throw new Error("gone"); } }, ["x"])).not.toThrow();
  });
});

describe("the seam is wired at both ends (source guards)", () => {
  it("the canvas layer PUBLISHES what it draws, and hands its names back when destroyed", () => {
    const s = src("placeNamesLayer.js");
    expect(s).toMatch(/setPlaceNamesShown\(map, shownNow\.filter/);
    expect(s).toMatch(/setPlaceNamesShown\(map, \[\]\)/);
  });
  it("the city-limits overlay FILTERS those names before placement, and re-places when the set changes", () => {
    const s = src("vectorOverlay.js");
    expect(s).toMatch(/isCityLimitsId\(source\.id\) \? placeNamesShown\(map\)/); // B1990960: the shared helper (jur_city + ga_city)
    expect(s).toMatch(/anchors\.filter\(\(a\) => !drawnElsewhere\.has\(placeNameKey\(a\.name\)\)\)/);
    expect(s).toMatch(/m\.on\("pf:placenames", refreshLabels\)/);
    expect(s).toMatch(/m\.off\("pf:placenames", refreshLabels\)/);
  });
  it("the freeze instrumentation is present: slow paint and slow load report themselves", () => {
    const s = src("vectorOverlay.js");
    expect(s).toMatch(/"boundary-paint-slow"/);
    expect(s).toMatch(/"boundary-load-slow"/);
  });
});
