import { describe, it, expect } from "vitest";
import {
  detectSheet, parseScaleNote, ftPerPointForScale, scaleForFtPerPoint, COMMON_SCALES, chooseOverlayScale,
  parseDistanceInput, feetPerInchFromPair, SCALE_PRESETS, feetPerInchForPreset, matchScalePreset,
} from "../src/workspaces/site-planner/lib/overlayScale.js";

const IN = 72; // points per inch

describe("overlay scale — sheet-size detection (B73)", () => {
  it("recognizes standard plot sheets in either orientation", () => {
    expect(detectSheet(36 * IN, 24 * IN).std).toBe(true);        // ARCH D landscape
    expect(detectSheet(24 * IN, 36 * IN).label).toMatch(/ARCH D/); // ...portrait, same sheet
    expect(detectSheet(34 * IN, 22 * IN).label).toMatch(/ANSI D/);
    expect(detectSheet(48 * IN, 36 * IN).label).toMatch(/ARCH E/);
  });
  it("tolerates a small margin off the exact size", () => {
    expect(detectSheet(36.3 * IN, 23.8 * IN).std).toBe(true);    // within ±0.6 in
  });
  it("flags a non-standard (likely shrunk) page as not std", () => {
    const r = detectSheet(11 * IN, 8.5 * IN); // letter — not a civil plot size... wait, ANSI A is 8.5x11
    expect(r.std).toBe(true); // 8.5x11 IS ANSI A
    const odd = detectSheet(9.7 * IN, 7.1 * IN);
    expect(odd.std).toBe(false);
    expect(odd.label).toContain("in");
  });
  it("does not confuse ANSI D (22×34) with ARCH D (24×36)", () => {
    expect(detectSheet(34 * IN, 22 * IN).label).toMatch(/ANSI D/);
    expect(detectSheet(36 * IN, 24 * IN).label).toMatch(/ARCH D/);
  });
});

describe("overlay scale — engineer's scale-note parsing (B73)", () => {
  it("reads the common civil forms", () => {
    expect(parseScaleNote('SCALE: 1"=100\'')).toBe(100);
    expect(parseScaleNote("1\" = 40'")).toBe(40);
    expect(parseScaleNote("1 inch = 60 ft")).toBe(60);
    expect(parseScaleNote('plan view  1"=200 FT  north')).toBe(200);
  });
  it("ignores junk and out-of-range values", () => {
    expect(parseScaleNote("no scale here")).toBe(null);
    expect(parseScaleNote("")).toBe(null);
    expect(parseScaleNote(null)).toBe(null);
    expect(parseScaleNote('1"=5\'')).toBe(null);     // below the 10 ft floor
    expect(parseScaleNote('1"=5000\'')).toBe(null);  // above the 1000 ft ceiling
  });
});

describe("overlay scale — scale↔size conversion (B73)", () => {
  it("ftPerPoint = feetPerInch / 72 and round-trips", () => {
    expect(ftPerPointForScale(72)).toBeCloseTo(1, 9);          // 1"=72' → 1 ft/pt
    expect(ftPerPointForScale(100)).toBeCloseTo(100 / 72, 9);
    expect(scaleForFtPerPoint(ftPerPointForScale(100))).toBeCloseTo(100, 9);
  });
  it("a 36-inch (ARCH D) sheet at 1\"=100' spans 3600 ft", () => {
    const widthPt = 36 * IN;
    expect(widthPt * ftPerPointForScale(100)).toBeCloseTo(3600, 6);
  });
  it("exposes the common civil scales", () => {
    expect(COMMON_SCALES).toContain(100);
    expect(COMMON_SCALES).toContain(20);
  });
});

describe("overlay scale — import sizing guard (chooseOverlayScale)", () => {
  const IMGW = 36 * IN; // 2592 pt = ARCH D width
  // The user is looking at a ~1500-ft-wide area on a 1000px canvas.
  const view = { imgW: IMGW, ppf: 1000 / 1500, screenW: 1000 };

  it("trusts a correct plan scale (1\"=30') — sheet lands ~the site, on-screen", () => {
    const r = chooseOverlayScale({ detectedScale: 30, sheetStd: true, ...view });
    expect(r.trusted).toBe(true);
    expect(r.reason).toBe("ok");
    expect(r.ftPerPx).toBeCloseTo(ftPerPointForScale(30), 9);
    // ~1080 ft wide drawing (36" * 30'), a hair under the 1500-ft view
    expect(IMGW * r.ftPerPx).toBeCloseTo(1080, 6);
  });

  it("distrusts a misread vicinity/key-map scale (1\"=600') — would blanket the map", () => {
    const r = chooseOverlayScale({ detectedScale: 600, sheetStd: true, ...view });
    expect(r.trusted).toBe(false);
    expect(r.reason).toBe("too-big"); // 600' would be ~20× the view
    // falls back to ~60% of the viewport width, NOT the giant scale
    expect(IMGW * r.ftPerPx).toBeCloseTo(0.6 * 1500, 6);
  });

  it("falls back to fit when there's no scale note or a non-standard sheet", () => {
    expect(chooseOverlayScale({ detectedScale: null, sheetStd: true, ...view }).reason).toBe("no-scale");
    expect(chooseOverlayScale({ detectedScale: 30, sheetStd: false, ...view }).reason).toBe("no-scale");
    // both still return a usable, view-fitted size
    expect(chooseOverlayScale({ detectedScale: null, sheetStd: false, ...view }).ftPerPx).toBeGreaterThan(0);
  });

  it("distrusts a scale that would render as a tiny speck (deeply zoomed out)", () => {
    const r = chooseOverlayScale({ detectedScale: 30, sheetStd: true, imgW: IMGW, ppf: 0.01, screenW: 1000 });
    expect(r.trusted).toBe(false);
    expect(r.reason).toBe("too-small");
  });

  it("the fit fallback sizes the sheet to ~60% of the viewport width on screen", () => {
    const r = chooseOverlayScale({ detectedScale: 600, sheetStd: true, ...view });
    expect(IMGW * r.ftPerPx * view.ppf).toBeCloseTo(0.6 * view.screenW, 3); // ~600px of a 1000px canvas
  });

  it("is defensive about bad inputs (no NaN/zero-divide)", () => {
    const r = chooseOverlayScale({ detectedScale: 30, sheetStd: true, imgW: 0, ppf: 0, screenW: 1000 });
    expect(Number.isFinite(r.ftPerPx)).toBe(true);
    expect(r.ftPerPx).toBeGreaterThan(0);
  });
});

describe("overlay scale — page-distance field parser (B564–B568)", () => {
  it("reads plain decimals", () => {
    expect(parseDistanceInput("0.5")).toBeCloseTo(0.5, 9);
    expect(parseDistanceInput(".5")).toBeCloseTo(0.5, 9);
    expect(parseDistanceInput("12")).toBe(12);
    expect(parseDistanceInput("  1.25 ")).toBeCloseTo(1.25, 9);
  });
  it("reads simple fractions", () => {
    expect(parseDistanceInput("1/2")).toBeCloseTo(0.5, 9);
    expect(parseDistanceInput("3/4")).toBeCloseTo(0.75, 9);
    expect(parseDistanceInput("1 / 8")).toBeCloseTo(0.125, 9);
  });
  it("reads mixed numbers (space or hyphen)", () => {
    expect(parseDistanceInput("1 1/2")).toBeCloseTo(1.5, 9);
    expect(parseDistanceInput("1-1/2")).toBeCloseTo(1.5, 9);
    expect(parseDistanceInput("2 3/4")).toBeCloseTo(2.75, 9);
  });
  it("rejects blank / malformed / non-positive / divide-by-zero", () => {
    expect(parseDistanceInput("")).toBe(null);
    expect(parseDistanceInput("   ")).toBe(null);
    expect(parseDistanceInput(null)).toBe(null);
    expect(parseDistanceInput("abc")).toBe(null);
    expect(parseDistanceInput("0")).toBe(null);
    expect(parseDistanceInput("-1")).toBe(null);
    expect(parseDistanceInput("1/0")).toBe(null);
    expect(parseDistanceInput("1/")).toBe(null);
  });
});

describe("overlay scale — page=real pair → feet-per-inch (B564–B568)", () => {
  it("0.5\" = 60' resolves to 120 ft/in (the impossible-before case)", () => {
    expect(feetPerInchFromPair({ pageVal: "0.5", pageUnit: "in", realVal: "60", realUnit: "ft" })).toBeCloseTo(120, 9);
    expect(feetPerInchFromPair({ pageVal: "1/2", pageUnit: "in", realVal: "60", realUnit: "ft" })).toBeCloseTo(120, 9);
  });
  it("1\" = 100' resolves to 100 ft/in (the classic engineer's scale)", () => {
    expect(feetPerInchFromPair({ pageVal: 1, realVal: 100 })).toBeCloseTo(100, 9);
  });
  it("architectural 1/8\" = 1' resolves to 8 ft/in", () => {
    expect(feetPerInchFromPair({ pageVal: "1/8", realVal: "1" })).toBeCloseTo(8, 9);
  });
  it("honors page units (ft) and real units (in, m)", () => {
    expect(feetPerInchFromPair({ pageVal: 1, pageUnit: "ft", realVal: 100, realUnit: "ft" })).toBeCloseTo(100 / 12, 9);
    expect(feetPerInchFromPair({ pageVal: 1, pageUnit: "in", realVal: 1, realUnit: "m" })).toBeCloseTo(3.280839895, 6);
    expect(feetPerInchFromPair({ pageVal: 1, pageUnit: "in", realVal: 12, realUnit: "in" })).toBeCloseTo(1, 9);
  });
  it("returns null when either side is blank/invalid (no garbage scale)", () => {
    expect(feetPerInchFromPair({ pageVal: "", realVal: "60" })).toBe(null);
    expect(feetPerInchFromPair({ pageVal: "1", realVal: "abc" })).toBe(null);
    expect(feetPerInchFromPair({ pageVal: "0", realVal: "60" })).toBe(null);
  });
});

describe("overlay scale — presets (B564–B568)", () => {
  it("every preset derives a positive feet-per-inch", () => {
    for (const p of SCALE_PRESETS) expect(feetPerInchForPreset(p)).toBeGreaterThan(0);
  });
  it("engineering presets equal their stated feet-per-inch", () => {
    expect(feetPerInchForPreset(SCALE_PRESETS.find((p) => p.id === "eng-30"))).toBeCloseTo(30, 9);
    expect(feetPerInchForPreset(SCALE_PRESETS.find((p) => p.id === "eng-100"))).toBeCloseTo(100, 9);
  });
  it("architectural presets derive the right ratio", () => {
    expect(feetPerInchForPreset(SCALE_PRESETS.find((p) => p.id === "arch-1-8"))).toBeCloseTo(8, 9);
    expect(feetPerInchForPreset(SCALE_PRESETS.find((p) => p.id === "arch-3-4"))).toBeCloseTo(4 / 3, 9);
  });
  it("matchScalePreset round-trips a feet-per-inch back to its preset id", () => {
    expect(matchScalePreset(30).id).toBe("eng-30");
    expect(matchScalePreset(8).id).toBe("arch-1-8");
    expect(matchScalePreset(4 / 3).id).toBe("arch-3-4");
  });
  it("matchScalePreset returns null for a value that is no preset (→ Custom)", () => {
    expect(matchScalePreset(33)).toBe(null);
    expect(matchScalePreset(120)).toBe(null);
    expect(matchScalePreset(0)).toBe(null);
  });
  it("a preset's page/real pair feeds feetPerInchFromPair to the same value (consistency)", () => {
    for (const p of SCALE_PRESETS) {
      expect(feetPerInchFromPair({ pageVal: p.pageIn, realVal: p.realFt })).toBeCloseTo(feetPerInchForPreset(p), 9);
    }
  });
});
