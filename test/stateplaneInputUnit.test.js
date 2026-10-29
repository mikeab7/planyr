/* NEW-1 (B2528672) — STATE PLANE COORDINATES ENTERED OR IMPORTED IN FEET MUST NOT BE READ AS METRES (AL, MO, HI, AK).
 *
 * The four states whose zones are defined in metres (statePlaneZones.js: AL 2, MO 3, HI 5, AK 10 = 20 zones). Audit result
 * (docs/incidents/STATE-PLANE-AUDIT.md §11): no path in the app takes a person-supplied grid value today. So this suite does two jobs:
 *   1. RED-PROOF OF THE TRAP + THE DOOR: a feet value read through the zone's own unit lands hundreds of km off; the same value through
 *      `gridInputToLatLon(..., "us-ft")` lands on the ground, and a metre value through "m" does too — for EVERY metre zone.
 *   2. THE GUARD: any future call of `zoneToProject` / `gridToProject` in src/ outside the audited allow-list fails the build, so a new
 *      input path cannot quietly assume the zone's unit. The allow-list is itself checked for rot (an entry that no longer calls it fails).
 * The scan carries a KNOWN-BAD arm (a synthetic offender MUST be flagged) so a scanner that stopped seeing calls reports VOID, not green. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SP_ZONES, projectToZone, zoneToProject } from "../src/shared/coordinates/statePlaneCore.js";
import { gridInputToLatLon, detectGridUnit, gridUnitFromPrj, preselectedFootUnit, INPUT_UNITS } from "../src/shared/coordinates/statePlaneInput.js";
import { detectSurveyFrame } from "../src/shared/coordinates/scaleFactor.js";

const US_FT_PER_M = 3937 / 1200;
const METRE_STATES = ["AL", "MO", "HI", "AK"];
const metreZones = Object.values(SP_ZONES).filter((z) => z.unit === "m");
// A point inside each zone: its own origin, nudged. (Zone 10's bounds cross the antimeridian, so a bounds centre would be wrong; lat0/lon0 never is.)
const inside = (z) => ({ lat: z.lat0 + 0.3, lon: z.lon0 + 0.1 });
const km = (a, b) => {
  const R = 6371.0088, d = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * d) / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(((b.lon - a.lon) * d) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

describe("the metre zones are exactly AL, MO, HI, AK", () => {
  it("20 zones, all four states, and nothing else", () => {
    expect(new Set(metreZones.map((z) => z.state))).toEqual(new Set(METRE_STATES));
    const by = (s) => metreZones.filter((z) => z.state === s).length;
    expect([by("AL"), by("MO"), by("HI"), by("AK")]).toEqual([2, 3, 5, 10]);
  });
});

describe("1 · a US-survey-feet value on a metre zone: the trap, and the door that closes it", () => {
  it.each(metreZones.map((z) => [z.id, z]))("%s — feet tagged us-ft land on the ground; metres tagged m land on the ground; feet read as metres land far away", (_id, z) => {
    const p = inside(z);
    const gridM = projectToZone(z, p.lat, p.lon);                                  // the zone's own unit = metres
    const gridFtUS = { x: gridM.x * US_FT_PER_M, y: gridM.y * US_FT_PER_M };       // what a plat in US survey feet would say
    const fromFeet = gridInputToLatLon(z, gridFtUS, "us-ft");
    const fromMetres = gridInputToLatLon(z, gridM, "m");
    expect(km(fromFeet, p) * 1000, "feet tagged ftUS").toBeLessThan(0.01);          // < 1 cm
    expect(km(fromMetres, p) * 1000, "metres tagged m").toBeLessThan(0.01);
    // RED-PROOF: the bug this item is about — the same feet value handed straight to the zone's own (metre) unit.
    const wrong = zoneToProject(z, gridFtUS);
    expect(km(wrong, p), "feet read as metres").toBeGreaterThan(100);
  });

  it("Alabama East, Birmingham (the item's named case): ftUS and metres both resolve to Birmingham", () => {
    const z = SP_ZONES.al_east, bham = { lat: 33.5186, lon: -86.8104 };
    const m = projectToZone(z, bham.lat, bham.lon);
    const ft = { x: m.x * US_FT_PER_M, y: m.y * US_FT_PER_M };
    expect(km(gridInputToLatLon(z, ft, "us-ft"), bham) * 1000).toBeLessThan(0.01);
    expect(km(gridInputToLatLon(z, m, "m"), bham) * 1000).toBeLessThan(0.01);
    expect(km(zoneToProject(z, ft), bham)).toBeGreaterThan(300);                    // the bug: ~hundreds of km away
  });

  it("there is NO default unit: missing / unknown / feet-as-a-word all throw", () => {
    const z = SP_ZONES.al_east;
    for (const bad of [undefined, null, "", "feet", "metre", "meters", "FT", 1]) {
      expect(() => gridInputToLatLon(z, { x: 1, y: 1 }, bad), String(bad)).toThrow(/explicit unit/);
    }
    expect(INPUT_UNITS).toEqual(["us-ft", "ft", "m"]);
    expect(() => gridInputToLatLon(z, { x: NaN, y: 1 }, "m")).toThrow();
  });

  it("an international-foot zone (Arizona) keeps its own unit: ft in = ft out, and us-ft differs by the 2 ppm it should", () => {
    const z = SP_ZONES.az_central, p = inside(z);
    const g = projectToZone(z, p.lat, p.lon);                                       // international feet
    expect(km(gridInputToLatLon(z, g, "ft"), p) * 1000).toBeLessThan(0.01);
    expect(km(gridInputToLatLon(z, g, "us-ft"), p) * 1000).toBeGreaterThan(0.1);    // ~2 ppm of ~1e6 ft ≈ 0.6 m: a real, tiny, non-zero slip
  });
});

describe("2 · detectGridUnit — position decides when it can, and otherwise ASKS with US survey feet preselected", () => {
  const z = SP_ZONES.al_east, bham = { lat: 33.5186, lon: -86.8104 };
  const m = projectToZone(z, bham.lat, bham.lon);
  const ft = { x: m.x * US_FT_PER_M, y: m.y * US_FT_PER_M };

  it("a feet value is recognised as feet, a metre value as metres — both confident, neither asks", () => {
    expect(detectGridUnit(z, ft, bham)).toMatchObject({ unit: "us-ft", confident: true, ask: false });
    expect(detectGridUnit(z, m, bham)).toMatchObject({ unit: "m", confident: true, ask: false });
  });

  it("a value that lands nowhere near the site is never converted silently: ask, flagged fitsNeither", () => {
    const r = detectGridUnit(z, { x: 1234, y: 5678 }, bham);
    expect(r).toMatchObject({ ask: true, confident: false, fitsNeither: true, unit: "us-ft" });
  });

  it("with no site to test against it asks, preselecting US survey feet", () => {
    expect(detectGridUnit(z, ft, null)).toMatchObject({ ask: true, unit: "us-ft" });
  });

  it("both readings near the site (a small value, site between the two readings) asks instead of guessing", () => {
    const v = { x: 100000, y: 100000 };                                            // small enough that metres and feet decode < 100 km apart
    const asM = gridInputToLatLon(z, v, "m"), asFt = gridInputToLatLon(z, v, "us-ft");
    const between = { lat: (asM.lat + asFt.lat) / 2, lon: (asM.lon + asFt.lon) / 2 };
    expect(km(asM, asFt)).toBeLessThan(100);                                       // precondition of this arm: both genuinely fit
    expect(detectGridUnit(z, v, between)).toMatchObject({ ask: true, confident: false, fitsNeither: false, unit: "us-ft" });
  });

  it("preselect is US survey feet everywhere except a statutory international-foot zone", () => {
    expect(preselectedFootUnit(SP_ZONES.al_east)).toBe("us-ft");
    expect(preselectedFootUnit(SP_ZONES.mo_east)).toBe("us-ft");
    expect(preselectedFootUnit(SP_ZONES.az_east)).toBe("ft");
    expect(preselectedFootUnit(SP_ZONES.tx_sc)).toBe("us-ft");
  });
});

describe("3 · a .prj / WKT declares its own unit — read it, by factor not by name", () => {
  const prj = (unit, f) => `PROJCS["NAD_1983_StatePlane_Alabama_East_FIPS_0101",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],UNIT["${unit}",${f}]]`;
  it("metre, US survey foot, international foot", () => {
    expect(gridUnitFromPrj(prj("Meter", "1.0"))).toBe("m");
    expect(gridUnitFromPrj(prj("Foot_US", "0.3048006096012192"))).toBe("us-ft");
    expect(gridUnitFromPrj(prj("US survey foot", "0.304800609601219"))).toBe("us-ft");
    expect(gridUnitFromPrj(prj("Foot", "0.3048"))).toBe("ft");
  });
  it("WKT2 LENGTHUNIT", () => {
    expect(gridUnitFromPrj('PROJCRS["x",BASEGEOGCRS["y",ANGLEUNIT["degree",0.0174532925199433]],CS[Cartesian,2],LENGTHUNIT["US survey foot",0.304800609601219]]')).toBe("us-ft");
  });
  it("nothing declared / unrecognised factor / not text → null (the caller then asks), never a guess", () => {
    expect(gridUnitFromPrj("PROJCS[\"x\"]")).toBeNull();
    expect(gridUnitFromPrj(prj("Furlong", "201.168"))).toBeNull();
    expect(gridUnitFromPrj(undefined)).toBeNull();
    expect(gridUnitFromPrj(42)).toBeNull();
  });
});

describe("4 · detectSurveyFrame names a metre↔foot slip instead of calling it a scale", () => {
  const pairs = (k) => [{ surveyFt: 1000 * k, gridFt: 1000 }, { surveyFt: 2500 * k, gridFt: 2500 }];
  it("survey in feet vs grid in metres (÷ ≈ 3.2808)", () => {
    const r = detectSurveyFrame({ pairs: pairs(3937 / 1200) });
    expect(r.verdict).toBe("unit-mismatch");
    expect(r.unitHint).toMatch(/feet, the grid in metres/);
  });
  it("and the reverse (÷ ≈ 0.3048)", () => {
    expect(detectSurveyFrame({ pairs: pairs(0.3048) }).verdict).toBe("unit-mismatch");
  });
  it("unchanged: grid, ground and a genuine other-scale keep their verdicts and carry no unit hint", () => {
    expect(detectSurveyFrame({ pairs: pairs(1) })).toMatchObject({ verdict: "grid", unitHint: null });
    expect(detectSurveyFrame({ pairs: pairs(1.5) })).toMatchObject({ verdict: "other-scale", unitHint: null });
    expect(detectSurveyFrame({ pairs: pairs(1 / 0.9997500), expectedCombined: 0.99975 }).verdict).toBe("ground");
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------- */
/* THE GUARD — nothing in src/ may turn a grid VALUE into lat/lon except through the audited doors.                                  */
/* ------------------------------------------------------------------------------------------------------------------------------- */
const SRC = new URL("../src", import.meta.url).pathname;
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n), s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(n)) out.push(p);
  }
  return out;
}
// A CALL: `zoneToProject(` / `gridToProject(` not preceded by `function ` / `export function ` (a definition), not inside a comment line.
const CALL = /(?<![\w.])(zoneToProject|gridToProject)\s*\(/g;
export function findCalls(source) {
  const hits = [];
  source.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (/\bfunction\s+(zoneToProject|gridToProject)\b/.test(line)) return;
    let m; CALL.lastIndex = 0;
    while ((m = CALL.exec(line))) hits.push({ line: i + 1, name: m[1] });
  });
  return hits;
}

// Every file allowed to call them, and WHY it is safe. A new input path is NOT added here — it calls `gridInputToLatLon(zone, xy, unit)`.
const ALLOWED = {
  "shared/coordinates/statePlaneCore.js": "defines both; gridConvergenceDegIn round-trips a value it just projected, in the zone's own unit",
  "shared/coordinates/statePlaneInput.js": "THE unit-explicit door: converts the declared unit to the zone's own before calling",
  "shared/overlay/overlayPlacement.js": "app-generated grid only: toGrid output rescaled to US ft by unitInUsFt(zone) and rescaled back (/k) before zoneToProject — no typed value",
  "workspaces/site-planner/lib/coverage.js": "ArcGIS service extents wkid-gated to SR 2278/102740 (Texas South Central, ftUS); any other wkid returns null (fails open) — never a metre zone",
};

describe("5 · the guard: no other src/ file converts a grid value to lat/lon", () => {
  const files = walk(SRC);
  const callers = {};
  for (const f of files) {
    const hits = findCalls(readFileSync(f, "utf8"));
    if (hits.length) callers[relative(SRC, f)] = hits;
  }

  it("KNOWN-BAD ARM: the scanner flags a synthetic offender (else this run is VOID, not green)", () => {
    expect(findCalls("const p = zoneToProject(zone, { x, y });").length).toBe(1);
    expect(findCalls("const p = gridToProject({ x, y });").length).toBe(1);
    expect(findCalls("export function zoneToProject(zone, { x, y } = {}) {").length).toBe(0);
    expect(findCalls("// zoneToProject(zone, xy) in a comment").length).toBe(0);
    expect(findCalls("import { zoneToProject } from './x.js';").length).toBe(0);
    // and it sees the real world: the core really does call it
    expect(Object.keys(callers)).toContain("shared/coordinates/statePlaneCore.js");
  });

  it("only the audited files call zoneToProject / gridToProject — a new caller must use gridInputToLatLon(zone, xy, unit)", () => {
    const unexpected = Object.keys(callers).filter((f) => !ALLOWED[f]);
    expect(unexpected, `NEW caller(s) of zoneToProject/gridToProject: ${unexpected.join(", ")}. A coordinate a person typed, pasted or imported must go through ` +
      "shared/coordinates/statePlaneInput.js gridInputToLatLon(zone, xy, UNIT) with the unit from the file's declaration, detectGridUnit, or the user — " +
      "never assumed (AL/MO/HI/AK grids are in metres; their plats are usually US survey feet). See docs/incidents/STATE-PLANE-AUDIT.md §11.").toEqual([]);
  });

  it("the allow-list has not rotted: every entry still exists and still calls one of them", () => {
    for (const f of Object.keys(ALLOWED)) expect(callers[f], `${f} is allow-listed but no longer calls zoneToProject/gridToProject — delete its row`).toBeTruthy();
  });
});
