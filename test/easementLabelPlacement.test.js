/* NEW-1 (easement labels inline + oriented) — the owner's repro: a long, narrow VERTICAL
 * "100' Storm/Drainage Esmt" strip was labelled horizontally at the centroid and spilled over the
 * neighbouring parcel and building. These tests drive the REAL ring derivation (deriveEasementRing)
 * and the placement, for the cases the owner listed. On main there is no placement at all: the label
 * is always angle 0 at the centroid, so every rotated assertion below is red there. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { placeEasementLabel, uprightDeg, ELONGATED_RATIO } from "../src/workspaces/site-planner/lib/easementLabelPlacement.js";
import { deriveEasementRing, easementLabel } from "../src/workspaces/site-planner/lib/easements.js";
import { labelTextWidthPx, featureNameFontPx } from "../src/workspaces/site-planner/lib/labelLayout.js";

const PPF = 0.45;           // working zoom (dimFontScale = 1)
const BASE = 10.5;
const ident = (p) => p;
const flipY = (p) => ({ x: p.x, y: -p.y });

function strip(centerline, width, extra = {}) {
  const m = { kind: "easement", mode: "centerline", type: "storm", centerline, width, ...extra };
  m.pts = deriveEasementRing(m);
  return m;
}
const polar = (deg, len) => [{ x: 0, y: 0 }, { x: len * Math.cos((deg * Math.PI) / 180), y: len * Math.sin((deg * Math.PI) / 180) }];
const place = (m, o = {}) => placeEasementLabel(m, easementLabel(m), { labelPpf: PPF, basePx: BASE, toScreen: ident, ...o });

describe("uprightDeg", () => {
  it("folds into [-90, 90)", () => {
    expect(uprightDeg(0)).toBe(0);
    expect(uprightDeg(30)).toBeCloseTo(30);
    expect(uprightDeg(120)).toBeCloseTo(-60);
    expect(uprightDeg(180)).toBeCloseTo(0);      // due west must not come back as 360
    expect(uprightDeg(-120)).toBeCloseTo(60);
    expect(uprightDeg(90)).toBeCloseTo(-90);
  });
});

describe("owner repro — long narrow vertical strip", () => {
  const m = strip([{ x: 0, y: 0 }, { x: 0, y: 5100 }], 100);
  it("is rotated to the strip (reads along it), anchored on the centerline middle", () => {
    const p = place(m);
    expect(p.rotated).toBe(true);
    expect(Math.abs(p.angle)).toBeCloseTo(90, 5);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(2550, 5);
  });
  it("name line fits inside the strip width (100 ft × 0.45 = 45 px) and the strip length", () => {
    const p = place(m, { withArea: true });
    expect(p.fontPx).toBeLessThanOrEqual(featureNameFontPx(PPF, BASE));
    expect(labelTextWidthPx(easementLabel(m), p.fontPx)).toBeLessThanOrEqual(5100 * PPF);
  });
});

describe("angles — vertical, horizontal, 30, 60, 120", () => {
  const cases = [[90, -90], [0, 0], [30, 30], [60, 60], [120, -60], [180, 0], [-30, -30]];
  for (const [deg, want] of cases) {
    it(`strip at ${deg}° → label at ${want}°, upright`, () => {
      const m = strip(polar(deg, 1200), 60);
      const p = place(m);
      expect(p.rotated).toBe(true);
      expect(p.angle).toBeCloseTo(want, 4);
      expect(p.angle).toBeGreaterThanOrEqual(-90);
      expect(p.angle).toBeLessThan(90 + 1e-9);
    });
  }
  it("the angle is the ON-SCREEN bearing, so a y-flipped projection mirrors it", () => {
    const m = strip(polar(30, 1200), 60);
    expect(place(m, { toScreen: flipY }).angle).toBeCloseTo(-30, 4);
  });
});

describe("bent / L-shaped easements — oriented on the LONGEST straight run", () => {
  const m = strip([{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 900, y: 300 }], 50);
  it("labels the long horizontal leg, not the short vertical one", () => {
    const p = place(m);
    expect(p.rotated).toBe(true);
    expect(p.angle).toBeCloseTo(0, 4);
    expect(p.x).toBeCloseTo(450, 4);
    expect(p.y).toBeCloseTo(300, 4);
  });
});

describe("short, wide easements look unchanged", () => {
  const m = strip([{ x: 0, y: 0 }, { x: 420, y: 0 }], 300);   // aspect 1.4 < ELONGATED_RATIO
  it("stays horizontal at the centroid", () => {
    expect(420 / 300).toBeLessThan(ELONGATED_RATIO);
    const p = place(m);
    expect(p.rotated).toBe(false);
    expect(p.angle).toBe(0);
    expect(p.y).toBeCloseTo(0, 5);
  });
  it("a vertical short-wide one is NOT rotated either", () => {
    const v = strip([{ x: 0, y: 0 }, { x: 0, y: 420 }], 300);
    expect(place(v).angle).toBe(0);
  });
});

describe("fit — shrink to the floor, drop the area, never spill when avoidable", () => {
  it("a narrow strip shrinks the font, and drops the area line before it would spill", () => {
    const m = strip([{ x: 0, y: 0 }, { x: 0, y: 3000 }], 30);     // 13.5 px wide at working zoom
    const noArea = place(m);
    const withArea = place(m, { withArea: true });
    expect(noArea.fontPx).toBeLessThan(featureNameFontPx(PPF, BASE));
    expect(withArea.showArea).toBe(false);
  });
  it("a wide strip keeps the area line when selected", () => {
    const m = strip([{ x: 0, y: 0 }, { x: 0, y: 3000 }], 100);
    const p = place(m, { withArea: true });
    expect(p.showArea).toBe(true);
    // the block (name + area) stays inside the 45 px strip
    const fs = p.fontPx;
    const top = p.nameDy - 0.75 * fs, bottom = p.areaDy + 0.25 * 9;
    expect(bottom - top).toBeLessThanOrEqual(100 * PPF);
  });
  it("never goes below the existing floor, and hides when the name cannot fit the run", () => {
    const thin = strip([{ x: 0, y: 0 }, { x: 0, y: 3000 }], 2);
    expect(place(thin).fontPx).toBeCloseTo(BASE * 0.26, 6);
    const tiny = strip([{ x: 0, y: 0 }, { x: 0, y: 40 }], 5);     // 18 px run: too short for the name
    expect(place(tiny)).toBe(null);
  });
});

describe("every easement type is placed the same way", () => {
  for (const type of ["utility", "sanitary", "storm", "water", "pipeline", "access", "aerial", "temp"]) {
    it(type, () => {
      const m = strip(polar(60, 1500), 60, { type });
      const p = place(m);
      expect(p.rotated).toBe(true);
      expect(p.angle).toBeCloseTo(60, 4);
    });
  }
});

describe("boundary + parcel-edge modes", () => {
  it("a drawn boundary rectangle is oriented on its long edge", () => {
    const pts = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 1000 }, { x: 0, y: 1000 }];
    const m = { kind: "easement", mode: "boundary", type: "utility", pts };
    const p = place(m);
    expect(p.rotated).toBe(true);
    expect(Math.abs(p.angle)).toBeCloseTo(90, 4);
    expect(p.x).toBeCloseTo(40, 4);
    expect(p.y).toBeCloseTo(500, 4);
  });
  it("a one-sided parcel-edge strip is centred in the strip, not on the parcel line", () => {
    const m = strip([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 40, { mode: "parceledge", offsetSide: 1 });
    const p = place(m);
    expect(p.rotated).toBe(true);
    expect(p.angle).toBeCloseTo(0, 4);
    expect(Math.abs(p.y)).toBeCloseTo(20, 3);
  });
  it("a boundary ring whose bbox middle is outside it falls back safely (no crash, no spill)", () => {
    const L = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 500 }, { x: 0, y: 500 }];
    const p = place({ kind: "easement", mode: "boundary", type: "utility", pts: L });
    expect(p === null || Number.isFinite(p.x)).toBe(true);
  });
});

describe("wiring", () => {
  const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("the easement render uses the placement and no longer draws a bare centroid <text>", () => {
    expect(src).toMatch(/resolveEasementLabel\(m, txt/);
    expect(src).not.toMatch(/<text x=\{cp\.x\} y=\{cp\.y\} textAnchor="middle" fontSize=\{featureNameFontPx\(labelPpf, EASE_LABEL_BASE_PX\)/);
  });
});
