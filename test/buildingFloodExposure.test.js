import { describe, it, expect } from "vitest";
import {
  buildingFloodExposure, exposureHeadline, footprintArea, wseEnvFromElev,
  FLOOD_CLASS_ORDER, FLOOD_CLASS_LABEL, isSfhaClass, EXPOSURE_NOTE,
} from "../src/workspaces/site-planner/lib/buildingFloodExposure.js";

/* NEW-3 — the owner's real question ("is my building in the floodplain?") answered as a
 * NUMBER. The honest-unknown discipline is the point: a failed query and an unstudied site
 * are not clear, and nothing here may report a clean zero it hasn't earned. */

// A square zone in planner feet, classified the way zonesFromFeatureCollection classifies.
const zone = (cls, x0, y0, x1, y1, extra = {}) => ({
  cls, zone: extra.zone || (cls === "1pct" ? "AE" : cls === "floodway" ? "AE" : "X"),
  subtype: extra.subtype || null,
  staticBfeFt: extra.staticBfeFt ?? null, aoDepthFt: null, vdatum: null,
  unstudiedA: !!extra.unstudiedA,
  rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
  bbox: [x0, y0, x1, y1],
});
const rect = (id, x0, y0, x1, y1, label = null) => ({
  id, label, ring: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
});

describe("NEW-3 — the pure exposure engine", () => {
  it("reports the fraction of a footprint inside a zone", () => {
    // Building 0..100 in x; the AE zone covers x ≥ 50 → half the footprint.
    const res = buildingFloodExposure({
      buildings: [rect("b1", 0, 0, 100, 100, "Building A")],
      zones: [zone("1pct", 50, -50, 500, 500, { staticBfeFt: 62.4 })],
      floodState: "loaded",
      maxCells: 4000,
    });
    expect(res.state).toBe("ok");
    const b = res.buildings[0];
    expect(b.footprintSf).toBe(10000);
    expect(b.pct).toBeGreaterThan(48);
    expect(b.pct).toBeLessThan(52);
    expect(b.inSfha).toBe(true);
    expect(b.inFloodway).toBe(false);
    expect(b.governing.cls).toBe("1pct");
    expect(b.governing.zone).toBe("AE");
    expect(b.governing.bfeFt).toBe(62.4); // the published static BFE, not a guess
    expect(res.total.touched).toBe(1);
    expect(res.total.worstCls).toBe("1pct");
  });

  it("a building clear of every zone reports zero — and the total counts it as clear", () => {
    const res = buildingFloodExposure({
      buildings: [rect("b1", 0, 0, 100, 100), rect("b2", 900, 900, 1000, 1000)],
      zones: [zone("1pct", -50, -50, 200, 200)],
      floodState: "loaded",
      maxCells: 4000,
    });
    expect(res.buildings[1].areaSf).toBe(0);
    expect(res.buildings[1].governing).toBe(null);
    expect(res.total.touched).toBe(1);
    expect(res.total.clear).toBe(1);
  });

  it("the FLOODWAY outranks the 1% band when a footprint straddles both", () => {
    const res = buildingFloodExposure({
      buildings: [rect("b1", 0, 0, 100, 100)],
      zones: [zone("1pct", 50, -50, 500, 500), zone("floodway", -50, -50, 40, 500, { subtype: "FLOODWAY" })],
      floodState: "loaded",
      maxCells: 4000,
    });
    const b = res.buildings[0];
    expect(b.hits.map((h) => h.cls)).toEqual(["floodway", "1pct"]); // worst first
    expect(b.governing.cls).toBe("floodway");
    expect(b.inFloodway).toBe(true);
    // The exposed area is the SUM across classes — the zones partition the plane, so no double count.
    expect(b.areaSf).toBeCloseTo(b.hits[0].areaSf + b.hits[1].areaSf, 6);
    expect(res.total.worstCls).toBe("floodway");
  });

  it("the 0.2% band is reported but is NOT an SFHA", () => {
    const res = buildingFloodExposure({
      buildings: [rect("b1", 0, 0, 100, 100)],
      zones: [zone("02pct", -50, -50, 500, 500, { zone: "X", subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" })],
      floodState: "loaded",
      maxCells: 4000,
    });
    const b = res.buildings[0];
    expect(b.pct).toBeGreaterThan(95);
    expect(b.inSfha).toBe(false); // no federal mandate — never folded into the SFHA number
    expect(b.sfhaSf).toBe(0);
    expect(isSfhaClass("02pct")).toBe(false);
    expect(isSfhaClass("1pct")).toBe(true);
    expect(isSfhaClass("floodway")).toBe(true);
  });

  it("an unstudied Zone A says BFE UNDETERMINED — never a fabricated elevation", () => {
    const res = buildingFloodExposure({
      buildings: [rect("b1", 0, 0, 100, 100)],
      zones: [zone("1pct", -50, -50, 500, 500, { zone: "A", unstudiedA: true })],
      floodState: "loaded",
      maxCells: 4000,
    });
    expect(res.buildings[0].governing.unstudied).toBe(true);
    expect(res.buildings[0].governing.bfeFt).toBe(null);
    expect(res.total.anyUnstudied).toBe(true);
  });

  it("HONEST UNKNOWN — a failed query, an un-run query and no buildings are three distinct states, none of them 'clear'", () => {
    const bs = [rect("b1", 0, 0, 100, 100)];
    const failed = buildingFloodExposure({ buildings: bs, zones: [], floodState: "failed" });
    expect(failed.state).toBe("unavailable");
    expect(failed.note).toBe(EXPOSURE_NOTE.unavailable);
    expect(failed.total).toBe(null);
    expect(exposureHeadline(failed).tone).toBe("unknown");
    expect(exposureHeadline(failed).text).toBe("UNKNOWN"); // a NAME, not the sentence
    expect(exposureHeadline(failed).detail).toBe(EXPOSURE_NOTE.unavailable);

    const notRun = buildingFloodExposure({ buildings: bs, zones: [], floodState: null });
    expect(notRun.state).toBe("not-checked");
    expect(exposureHeadline(notRun).tone).toBe("unknown");

    const none = buildingFloodExposure({ buildings: [], zones: [], floodState: "loaded" });
    expect(none.state).toBe("no-buildings");
  });

  it("a query that ANSWERED with no zones is the only state allowed to read as clear", () => {
    const res = buildingFloodExposure({ buildings: [rect("b1", 0, 0, 100, 100)], zones: [], floodState: "loaded" });
    expect(res.state).toBe("none-mapped");
    expect(exposureHeadline(res).tone).toBe("ok");
    expect(exposureHeadline(res).text).toBe("none mapped");
    // …and it still carries the caveat that unmapped is not studied.
    expect(res.note).toMatch(/not a studied one/);
  });

  it("the headline leads with the VERDICT, then the number", () => {
    const clear = buildingFloodExposure({
      buildings: [rect("b1", 0, 0, 10, 10)], zones: [zone("1pct", 900, 900, 1000, 1000)], floodState: "loaded",
    });
    expect(exposureHeadline(clear).text).toBe("all 1 clear");
    expect(exposureHeadline(clear).detail).toBe(null);

    const hit = buildingFloodExposure({
      buildings: [rect("b1", 0, 0, 100, 100), rect("b2", 900, 900, 1000, 1000)],
      zones: [zone("1pct", -50, -50, 200, 200)], floodState: "loaded", maxCells: 4000,
    });
    const h = exposureHeadline(hit);
    expect(h.tone).toBe("warn");
    // PANEL-BREVITY: a named state + the number, with the zone class as the subordinate detail
    // — never a sentence in the value slot.
    expect(h.text).toMatch(/^1 of 2 · \d/);
    expect(h.text).toMatch(/%$/);
    expect(h.detail).toBe("1% chance (SFHA)");
  });

  it("class order and labels are worst-first and plain-English", () => {
    expect(FLOOD_CLASS_ORDER).toEqual(["floodway", "1pct", "02pct"]);
    expect(FLOOD_CLASS_LABEL.floodway).toBe("Regulatory floodway");
    expect(FLOOD_CLASS_LABEL["1pct"]).toContain("SFHA");
  });

  it("footprintArea is winding-independent and rejects a degenerate ring", () => {
    const cw = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
    const ccw = [...cw].reverse();
    expect(footprintArea(cw)).toBe(100);
    expect(footprintArea(ccw)).toBe(100);
    expect(footprintArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });

  it("the WSE env is built from the SAME fields the mitigation engine reads, sentinels cleaned", () => {
    const env = wseEnvFromElev({
      existGradeFt: 51.2, bfeFt: -9999, wse02Ft: 64, derivedBfeFt: 62.1,
      derivedWse1pctFt: 61.8, derivedWse1pctSrc: "fbcdd", bfeSrc: "manual",
    });
    expect(env.grade).toBe(51.2);
    expect(env.manualBfe).toBe(null); // NFHL's -9999 "no published value" is not an elevation
    expect(env.wse02).toBe(64);
    expect(env.derivedBfe).toBe(62.1);
    expect(env.derivedWse1pctSrc).toBe("fbcdd");
    expect(wseEnvFromElev(null)).toEqual({});
  });
});
