import { describe, it, expect } from "vitest";
import { STANDARD_SCALES, scaleLabel, frameFootprintForScale, checkScaleFits } from "../src/workspaces/site-planner/lib/printScale.js";

describe("printScale — the explicit engineering scale (B765985)", () => {
  it("STANDARD_SCALES is a real, ascending civil-scale ladder", () => {
    expect(STANDARD_SCALES.length).toBeGreaterThan(8);
    for (let i = 1; i < STANDARD_SCALES.length; i++) expect(STANDARD_SCALES[i]).toBeGreaterThan(STANDARD_SCALES[i - 1]);
    expect(STANDARD_SCALES).toContain(40);
    expect(STANDARD_SCALES).toContain(100);
  });

  it("scaleLabel formats a stated ratio, and null/0 means fit-to-frame", () => {
    expect(scaleLabel(40)).toBe("1\" = 40'");
    expect(scaleLabel(200)).toBe("1\" = 200'");
    expect(scaleLabel(null)).toBe("Fit to frame");
    expect(scaleLabel(0)).toBe("Fit to frame");
    expect(scaleLabel(undefined)).toBe("Fit to frame");
  });

  it("frameFootprintForScale is a pure multiply — the ONLY way a scale sizes a frame", () => {
    // an 11x8.5 letter-landscape plan box (minus margins, but keep the math simple/obvious here)
    expect(frameFootprintForScale(40, { w: 10, h: 8 })).toEqual({ wFt: 400, hFt: 320 });
    expect(frameFootprintForScale(100, { w: 10, h: 8 })).toEqual({ wFt: 1000, hFt: 800 });
    expect(frameFootprintForScale(0, { w: 10, h: 8 })).toEqual({ wFt: 0, hFt: 0 });
  });

  it("checkScaleFits: fit-to-frame (no scale) always fits — nothing to compare", () => {
    expect(checkScaleFits(null, { wFt: 5000, hFt: 5000 }, { wFt: 10, hFt: 10 })).toEqual({ fits: true });
    expect(checkScaleFits(0, { wFt: 5000, hFt: 5000 }, null)).toEqual({ fits: true });
  });

  it("checkScaleFits: a picked frame that fits inside the scaled footprint passes silently", () => {
    const r = checkScaleFits(40, { wFt: 300, hFt: 200 }, { wFt: 400, hFt: 320 });
    expect(r.fits).toBe(true);
    expect(r.message).toBeUndefined();
  });

  it("checkScaleFits: a picked frame WIDER than the scaled footprint fails with an actionable message — never a silent rescale", () => {
    const r = checkScaleFits(40, { wFt: 500, hFt: 200 }, { wFt: 400, hFt: 320 });
    expect(r.fits).toBe(false);
    expect(r.message).toMatch(/bigger sheet/);
    expect(r.message).toMatch(/smaller scale/);
    expect(r.message).toMatch(/smaller area/);
    expect(r.message).toMatch(/500/); // names the picked size
    expect(r.message).toMatch(/400/); // names what actually fits
  });

  it("checkScaleFits: a picked frame TALLER than the scaled footprint also fails (either axis)", () => {
    const r = checkScaleFits(40, { wFt: 300, hFt: 400 }, { wFt: 400, hFt: 320 });
    expect(r.fits).toBe(false);
  });

  it("checkScaleFits: an exact match fits (no off-by-epsilon false negative)", () => {
    expect(checkScaleFits(40, { wFt: 400, hFt: 320 }, { wFt: 400, hFt: 320 }).fits).toBe(true);
  });
});
