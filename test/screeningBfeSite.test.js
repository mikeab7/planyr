// NEW-1 / NEW-3 (B1057 completion) — the LIVE WIRING layer: real site → the engine's four inputs
// → BOTH the 1% and the 0.2% elevations the Waller ordinance requires. Pure; no network.
import { describe, it, expect } from "vitest";
import {
  terrainInputsForScreeningBfe, atlas14Depths, screeningBfeForSite, screeningBfeHeadline,
  SCREENING_STORMS,
} from "../src/workspaces/site-planner/lib/screeningBfeSite.js";
import { bfeDataLikelyRequired, BFE_DATA_REQUIREMENT } from "../src/workspaces/site-planner/lib/screeningBfe.js";
import {
  DEFAULT_FLOODPLAIN_RULES, bfeDataRequirementFor, atlas14Mandated,
} from "../src/workspaces/site-planner/lib/floodplainRules.js";
import { gridRequest, pixelToLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { channelCell, flowBearing, gridCellFt, siteMaskFromLatLngRings } from "../src/workspaces/site-planner/lib/channelSection.js";
import { flowAccumulation } from "../src/workspaces/site-planner/lib/upstreamArea.js";

/* Does the fine grid genuinely have NO D8 direction at the crossing it would pick INSIDE THE SITE?
 * Used to prove the pit fixture below actually reproduces the real-data defect rather than passing
 * vacuously. Must use the same site mask the real call does, or it inspects a different cell. */
function flowBearingIsNullAt(grid) {
  const cellFt = gridCellFt(REQ, 29.91);
  const g = { values: grid.values, mask: grid.mask, width: grid.width, height: grid.height, cellFt };
  const siteMask = siteMaskFromLatLngRings(REQ, SITE_RINGS, g.width, g.height);
  const i = channelCell({ acc: flowAccumulation(g), mask: g.mask, width: g.width, height: g.height }, siteMask);
  return flowBearing(g, i) === null;
}

const W = 61, H = 61, CENTER = 30;
const REQ = { ...gridRequest({ west: -96.0, south: 29.9, east: -95.97, north: 29.93 }, 15), width: W, height: H };
// A site footprint over the middle of the grid, expressed the way the caller passes it (lat/lng).
const SITE_RINGS = [[[24, 24], [24, 36], [36, 36], [36, 24]].map(([x, y]) => pixelToLatLng(REQ, x, y))];

/* FIXTURE A — a CONTAINED basin. A channel runs down the centre column, but the divides are INSIDE
 * the grid: side ridges at ±12 columns (beyond them the ground falls away off-grid), and a headwall
 * ridge at row 6 (north of it the ground drains off the north edge). So no border cell drains
 * through the channel crossing, and the delineated watershed is the whole watershed. */
function containedBasin() {
  const values = new Float32Array(W * H);
  const mask = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - CENTER);
      const f = d <= 12 ? d * 2 : 24 - (d - 12) * 2;   // banks rise to a ridge at d=12, then fall away
      const g = y < 6 ? 3 * y : 18 - (y - 6) * 1;      // headwall ridge at row 6, valley falls south
      values[y * W + x] = 200 + f + g;
    }
  }
  return { values, mask, width: W, height: H };
}
/* FIXTURE B — an OPEN plane sloping to the south-east corner. Every border cell drains inward, so
 * the contributing area at any crossing runs straight off the grid: the truncation case. */
function openPlane() {
  const values = new Float32Array(W * H);
  const mask = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values[y * W + x] = 200 - y * 1.0 + Math.abs(x - CENTER) * 2.0;
  return { values, mask, width: W, height: H };
}
const GRID = containedBasin();
const OPEN = openPlane();
const HALF = 300; // section half-width kept inside the fixture's ridges

const PFDS = {
  periods: [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000],
  rows: { "24-hr": [4.0, 5.1, 6.6, 7.9, 9.9, 11.6, 13.4, 15.4, 18.3, 20.7] },
};

describe("terrainInputsForScreeningBfe — the three terrain-derived inputs", () => {
  const t = terrainInputsForScreeningBfe({ sectionGrid: GRID, sectionReq: REQ, siteRingsLatLng: SITE_RINGS, lat: 29.91, halfWidthFt: HALF });

  it("delineates a watershed, cuts a section and measures a slope", () => {
    expect(t.ok).toBe(true);
    expect(t.areaAcres).toBeGreaterThan(0);
    expect(t.slopeFtPerFt).toBeGreaterThan(0);
    expect(t.station.length).toBeGreaterThan(20);
    expect(t.section.reliefFt).toBeGreaterThan(1);
  });
  it("puts the channel crossing inside the site footprint", () => {
    const x = t.channel.cell % W, y = (t.channel.cell / W) | 0;
    expect(x).toBeGreaterThanOrEqual(24);
    expect(x).toBeLessThanOrEqual(36);
    expect(y).toBeGreaterThanOrEqual(24);
    expect(y).toBeLessThanOrEqual(36);
  });

  it("LOUD-FAILURE: no grid → a named missing input, not a silent empty result", () => {
    const r = terrainInputsForScreeningBfe({ sectionGrid: null, sectionReq: REQ });
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toMatch(/terrain grid/i);
  });
  /* The honesty guard that matters most: a watershed that runs off the edge of the terrain window
   * makes the delineated area a LOWER BOUND, which would produce a confidently UNDERSTATED flood
   * elevation. That must read as unknown, never as a number. */
  it("LOUD-FAILURE: a watershed truncated by the grid edge refuses to produce an elevation", () => {
    const r = terrainInputsForScreeningBfe({ sectionGrid: OPEN, sectionReq: REQ, siteRingsLatLng: SITE_RINGS, lat: 29.91, halfWidthFt: HALF });
    expect(r.ok).toBe(false);
    expect(r.watershedTruncated).toBe(true);
    expect(r.missing.join(" ")).toMatch(/runs past the edge.*LOWER BOUND/);
  });
  it("a contained basin is NOT flagged truncated — the guard is not blanket-on", () => {
    expect(t.ok).toBe(true);
    expect(t.watershed.truncated).toBe(false);
  });
  it("the truncated case propagates to the composed result as an unknown, not an elevation", () => {
    const bad = terrainInputsForScreeningBfe({ sectionGrid: OPEN, sectionReq: REQ, siteRingsLatLng: SITE_RINGS, lat: 29.91, halfWidthFt: HALF });
    const r = screeningBfeForSite({ terrain: bad, rainfall: atlas14Depths(PFDS), hsg: "C" });
    expect(r.ok).toBe(false);
    expect(r.wse1pctFt).toBeUndefined();
    expect(r.missing.join(" ")).toMatch(/LOWER BOUND/);
  });
  it("a WIDE watershed grid is used for the area/slope while the FINE grid cuts the section", () => {
    const r = terrainInputsForScreeningBfe({
      sectionGrid: GRID, sectionReq: REQ,
      watershedGrid: GRID, watershedReq: REQ,
      siteRingsLatLng: SITE_RINGS, lat: 29.91, halfWidthFt: HALF,
    });
    expect(r.ok).toBe(true);
    expect(r.watershed.wideGrid).toBe(true);
  });

  /* REGRESSION — caught by the REAL-DATA run (`ui-audit/verify-screening-bfe-live.mjs`), not by any
   * synthetic fixture. Taking the flow bearing from the FINE grid returned null outright at a real
   * Waller point, because on flat Gulf-Coast ground an ~8-ft LiDAR cell is very often a D8 pit with
   * no downhill neighbour. The bearing is a REACH-scale property and now comes from the wide grid.
   * Modelled here by pitting the fine grid's channel column while the wide grid stays clean. */
  it("a D8 pit at the fine-grid crossing does NOT kill the section — the bearing comes from the reach", () => {
    const pitted = { values: Float32Array.from(GRID.values), mask: Uint8Array.from(GRID.mask), width: W, height: H };
    // Sink the channel column into a FLAT trench well below its banks: every centre cell has no
    // strictly-lower neighbour (the trench is level, the banks are higher), which is exactly the
    // no-downhill-neighbour condition d8Direction reports as null.
    for (let y = 8; y < H - 8; y++) pitted.values[y * W + CENTER] = 120;
    expect(flowBearingIsNullAt(pitted)).toBe(true); // the fixture really does reproduce the defect

    const r = terrainInputsForScreeningBfe({
      sectionGrid: pitted, sectionReq: REQ,
      watershedGrid: GRID, watershedReq: REQ,   // the reach-scale grid is clean
      siteRingsLatLng: SITE_RINGS, lat: 29.91, halfWidthFt: HALF,
    });
    expect(r.ok).toBe(true);
    expect(r.station.length).toBeGreaterThan(20);
  });

  it("LOUD-FAILURE: a flat grid names the slope AND the section as missing", () => {
    const flat = { values: new Float32Array(W * H), mask: new Uint8Array(W * H).fill(1), width: W, height: H };
    const r = terrainInputsForScreeningBfe({ sectionGrid: flat, sectionReq: REQ, lat: 29.91 });
    expect(r.ok).toBe(false);
    expect(r.missing.join(" ")).toMatch(/slope|flat|direction/i);
  });
});

describe("atlas14Depths — the ordinance-mandated rainfall pair", () => {
  it("reads BOTH the 100-yr and the 500-yr depths", () => {
    const d = atlas14Depths(PFDS);
    expect(d.in1pct).toBe(13.4);
    expect(d.in02pct).toBe(18.3);
    expect(d.missing).toEqual([]);
  });
  it("names the 500-yr as an ORDINANCE requirement when the table lacks it", () => {
    const noneFive = { periods: [10, 100], rows: { "24-hr": [7.9, 13.4] } };
    const d = atlas14Depths(noneFive);
    expect(d.in1pct).toBe(13.4);
    expect(d.in02pct).toBe(null);
    expect(d.missing.join(" ")).toMatch(/500-year.*5\.C\(3\)/);
  });
  it("no table at all → both missing, never a substituted depth", () => {
    const d = atlas14Depths(null);
    expect(d.in1pct).toBe(null);
    expect(d.in02pct).toBe(null);
    expect(d.missing.length).toBe(2);
  });
});

describe("screeningBfeForSite — both storms from ONE derivation", () => {
  const terrain = terrainInputsForScreeningBfe({ sectionGrid: GRID, sectionReq: REQ, siteRingsLatLng: SITE_RINGS, lat: 29.91, halfWidthFt: HALF });
  const rainfall = atlas14Depths(PFDS);
  const r = screeningBfeForSite({ terrain, rainfall, hsg: "C", impPct: 0 });

  it("produces BOTH elevations, as §5.C(3) requires", () => {
    expect(r.ok).toBe(true);
    expect(Number.isFinite(r.wse1pctFt)).toBe(true);
    expect(Number.isFinite(r.wse02pctFt)).toBe(true);
    expect(Object.keys(r.storms).sort()).toEqual(SCREENING_STORMS.map((s) => s.key).sort());
  });
  it("the 0.2% surface sits ABOVE the 1% — the rarer storm is the deeper one", () => {
    expect(r.wse02pctFt).toBeGreaterThan(r.wse1pctFt);
  });
  it("the two storms share one watershed, one section and one slope — they cannot disagree", () => {
    expect(r.storms.wse1pct.hydrology.inputs.areaAcres).toBe(r.storms.wse02pct.hydrology.inputs.areaAcres);
    expect(r.storms.wse1pct.hydraulics.slopeFtPerFt).toBe(r.storms.wse02pct.hydraulics.slopeFtPerFt);
    expect(r.storms.wse1pct.bedFt).toBe(r.storms.wse02pct.bedFt);
  });
  it("carries the honesty payload with the answer, not as a footnote", () => {
    expect(r.screening).toBe(true);
    expect(r.atlas14).toBe(true);
    expect(r.notModeled.length).toBeGreaterThan(4);
    expect(r.notModeled.join(" ")).toMatch(/bridges or culverts/);
    expect(r.clomrNote).toMatch(/CLOMR/);
  });
  it("carries an uncertainty RANGE, not a single false-precise figure", () => {
    const b = r.band1pctFt;
    expect(b).not.toBe(null);
    if (b.loFt != null && b.hiFt != null) expect(b.hiFt).toBeGreaterThanOrEqual(b.loFt);
  });
  it("names its rainfall + soil inputs so the panel can show provenance", () => {
    expect(r.inputs.rainfall1pctIn).toBe(13.4);
    expect(r.inputs.rainfall02pctIn).toBe(18.3);
    expect(r.inputs.hsg).toBe("C");
    expect(r.inputs.tcMin).toBeGreaterThan(0);
  });

  it("LOUD-FAILURE: no soil group → an explicit unknown NAMING it, never a guessed curve number", () => {
    const f = screeningBfeForSite({ terrain, rainfall });
    expect(f.ok).toBe(false);
    expect(f.missing.join(" ")).toMatch(/soil hydrologic group/i);
    expect(f.wse1pctFt).toBeUndefined();
  });
  it("LOUD-FAILURE: no rainfall → an explicit unknown naming Atlas 14", () => {
    const f = screeningBfeForSite({ terrain, rainfall: atlas14Depths(null), hsg: "C" });
    expect(f.ok).toBe(false);
    expect(f.missing.join(" ")).toMatch(/Atlas 14/);
  });
  it("LOUD-FAILURE: no terrain → an explicit unknown, still carrying NOT_MODELED", () => {
    const f = screeningBfeForSite({ terrain: terrainInputsForScreeningBfe({}), rainfall, hsg: "C" });
    expect(f.ok).toBe(false);
    expect(f.notModeled.length).toBeGreaterThan(0);
  });
  it("an accepted CN overrides the soil group without changing the path", () => {
    const byCn = screeningBfeForSite({ terrain, rainfall, cn: 80 });
    expect(byCn.ok).toBe(true);
    expect(byCn.inputs.cn).toBe(80);
  });
});

describe("screeningBfeHeadline — VERDICT + NUMBER first (PANEL-BREVITY)", () => {
  const terrain = terrainInputsForScreeningBfe({ sectionGrid: GRID, sectionReq: REQ, siteRingsLatLng: SITE_RINGS, lat: 29.91, halfWidthFt: HALF });
  const r = screeningBfeForSite({ terrain, rainfall: atlas14Depths(PFDS), hsg: "C" });

  it("calls out the DELTA against the value the app is otherwise governing by", () => {
    const h = screeningBfeHeadline(r, r.wse1pctFt - 2.0);
    expect(h.known).toBe(true);
    expect(h.deltaFt).toBeCloseTo(2.0, 1);
    expect(h.text).toMatch(/\+2\.0′ vs/);
  });
  it("with nothing to compare against it states the number alone", () => {
    const h = screeningBfeHeadline(r, null);
    expect(h.text).toMatch(/^Screening 1% ≈ /);
    expect(h.text).not.toMatch(/vs/);
  });
  it("an unknown reads as unavailable WITH the reason — never a blank or a zero", () => {
    const h = screeningBfeHeadline({ ok: false, missing: ["soil hydrologic group (SSURGO)"] });
    expect(h.known).toBe(false);
    expect(h.text).toMatch(/unavailable — soil hydrologic group/);
  });
  it("null result → null (the caller renders nothing, not an empty row)", () => {
    expect(screeningBfeHeadline(null)).toBe(null);
  });
});

describe("NEW-3 — the Waller §5.C(3) BFE-data requirement FIRES on the site", () => {
  const waller = DEFAULT_FLOODPLAIN_RULES.waller;
  const req = bfeDataRequirementFor(waller);

  it("is recorded VERIFIED against the county's own adopted ordinance", () => {
    expect(req).not.toBe(null);
    expect(req.verified).toBe(true);
    expect(req.citation).toMatch(/Waller County Flood Damage Prevention Ordinance §5\.C\(3\)/);
    expect(req.sourceDate).toBe("2013-02-28");
    expect(req.url).toMatch(/^https:\/\/www\.co\.waller\.tx\.us\//);
  });
  it("quotes the ordinance verbatim, including “whichever is lesser”", () => {
    expect(req.quote).toMatch(/greater than 50 lots or 5 acres, whichever is lesser/);
    expect(req.quote).toMatch(/utilizing Atlas 14/);
    expect(req.quote).toMatch(/500-year floodplain elevation data/);
  });
  it("mandates Atlas 14 and the 500-year elevation as data, not as options", () => {
    expect(atlas14Mandated(waller)).toBe(true);
    expect(req.requires02pct).toBe(true);
  });

  it("fires on a 64-acre unmapped-Zone-A tract (the Tsakiris case)", () => {
    const hit = bfeDataLikelyRequired({ acres: 64.3, inApproximateAZone: true, requirement: req });
    expect(hit.likely).toBe(true);
    expect(hit.by).toBe("acres");
    expect(hit.jurisdictional).toBe(true);
    expect(hit.verified).toBe(true);
    expect(hit.acres).toBe(64.3);
  });
  it("does NOT fire in a studied zone — a published elevation already exists there", () => {
    expect(bfeDataLikelyRequired({ acres: 64.3, inApproximateAZone: false, requirement: req })).toBe(null);
  });
  it("does NOT fire below both thresholds", () => {
    expect(bfeDataLikelyRequired({ acres: 4.2, lots: 3, inApproximateAZone: true, requirement: req })).toBe(null);
  });
  it("fires on the LOT count alone (>50 lots), whichever is lesser", () => {
    const hit = bfeDataLikelyRequired({ acres: 4.2, lots: 60, inApproximateAZone: true, requirement: req });
    expect(hit.by).toBe("lots");
  });

  it("without a jurisdiction record it falls back to the CFR minimum and says so — one engine, two provenances", () => {
    const generic = bfeDataLikelyRequired({ acres: 64.3, inApproximateAZone: true });
    expect(generic.likely).toBe(true);
    expect(generic.jurisdictional).toBe(false);
    expect(generic.verified).toBe(false); // unconfirmed research, never dressed as settled law
    expect(generic.citation).toBe(BFE_DATA_REQUIREMENT.citation);
  });
  it("other counties carry no requirement record until their ordinance is actually read", () => {
    expect(bfeDataRequirementFor(DEFAULT_FLOODPLAIN_RULES.harris)).toBe(null);
    expect(bfeDataRequirementFor(DEFAULT_FLOODPLAIN_RULES.montgomery)).toBe(null);
    expect(atlas14Mandated(DEFAULT_FLOODPLAIN_RULES.fortbend)).toBe(false);
  });
});
