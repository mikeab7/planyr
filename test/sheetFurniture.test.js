import { describe, it, expect } from "vitest";
import { pickScaleBar, furnitureLayout, buildSheetFurnitureSvg, buildScreenFurnitureSvg } from "../src/workspaces/site-planner/lib/sheetFurniture.js";

const NICE = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

// A letter-landscape framed export at a typical working zoom: ppf = 0.5 px/ft, so
// ftPerUnit = 2 ft/unit. A letter sheet (11×8.5 in) → user-unit frame of the same
// aspect; pick a width that represents a realistic site (~1800 ft wide here).
const frame = { x: 100, y: 50, w: 900, h: 695, ftPerUnit: 2 };

describe("pickScaleBar — round distance that fills a band without clipping (NEW-1)", () => {
  it("snaps to a round NICE step", () => {
    const { feet } = pickScaleBar({ frameW: frame.w, ftPerUnit: frame.ftPerUnit });
    expect(NICE).toContain(feet);
  });

  it("never exceeds the hard ceiling (so the bar can't run off the frame)", () => {
    for (const ppf of [0.05, 0.1, 0.25, 0.5, 1, 2, 4]) {
      const { lengthU } = pickScaleBar({ frameW: frame.w, ftPerUnit: 1 / ppf });
      // ceiling defaults to 0.30·frameW; allow the documented exception only when even
      // the smallest 10-ft step overflows (extreme zoom-in).
      const tenFt = 10 * ppf;
      if (tenFt <= frame.w * 0.3) expect(lengthU).toBeLessThanOrEqual(frame.w * 0.3 + 1e-6);
    }
  });

  it("lengthU is feet expressed in user units (feet / ftPerUnit)", () => {
    const { feet, lengthU } = pickScaleBar({ frameW: frame.w, ftPerUnit: frame.ftPerUnit });
    expect(lengthU).toBeCloseTo(feet / frame.ftPerUnit, 6);
  });

  it("lands inside a sensible band for a normal export (≈10–30% of the frame width)", () => {
    const { lengthU } = pickScaleBar({ frameW: frame.w, ftPerUnit: frame.ftPerUnit });
    expect(lengthU).toBeGreaterThan(frame.w * 0.1);
    expect(lengthU).toBeLessThan(frame.w * 0.3 + 1e-6);
  });

  it("zoomed way out picks a large step; zoomed way in picks a small step", () => {
    const out = pickScaleBar({ frameW: frame.w, ftPerUnit: 40 }).feet; // 1 unit = 40 ft
    const inn = pickScaleBar({ frameW: frame.w, ftPerUnit: 0.1 }).feet; // 1 unit = 0.1 ft
    expect(out).toBeGreaterThan(inn);
  });
});

describe("furnitureLayout — both plates sit wholly inside the safe area (no clip)", () => {
  const L = furnitureLayout(frame);
  const left = frame.x, right = frame.x + frame.w, top = frame.y, bot = frame.y + frame.h;

  it("north arrow is anchored top-left at the inset and fits inside the frame", () => {
    expect(L.north.tx).toBeCloseTo(frame.x + L.inset, 6);
    expect(L.north.ty).toBeCloseTo(frame.y + L.inset, 6);
    expect(L.north.tx + L.north.plateW).toBeLessThan(right - L.inset + 1e-6);
    expect(L.north.ty + L.north.plateH).toBeLessThan(bot - L.inset + 1e-6);
  });

  it("scale bar is anchored bottom-right at the inset and fits inside the frame", () => {
    expect(L.scaleBar.tx + L.scaleBar.plateW).toBeCloseTo(right - L.inset, 6);
    expect(L.scaleBar.ty + L.scaleBar.plateH).toBeCloseTo(bot - L.inset, 6);
    expect(L.scaleBar.tx).toBeGreaterThan(left + 1e-6);
    expect(L.scaleBar.ty).toBeGreaterThan(top + 1e-6);
  });

  it("the two plates don't overlap (arrow top-left, bar bottom-right)", () => {
    const a = { x: L.north.tx, y: L.north.ty, w: L.north.plateW, h: L.north.plateH };
    const b = { x: L.scaleBar.tx, y: L.scaleBar.ty, w: L.scaleBar.plateW, h: L.scaleBar.plateH };
    const disjoint = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    expect(disjoint).toBe(true);
  });

  it("the arrow is a modest ~0.5 in tall on a letter sheet (≈0.06 of the short side)", () => {
    expect(L.north.arrowH).toBeCloseTo(L.refS * 0.06, 6);
  });

  it("the scale bar encodes a real round distance as user units (feet / ftPerUnit)", () => {
    expect(NICE).toContain(L.feet);
    expect(L.lengthU).toBeCloseTo(L.feet / frame.ftPerUnit, 6);
  });
});

describe("buildSheetFurnitureSvg — renders the expected sheet furniture", () => {
  const svg = buildSheetFurnitureSvg({ ...frame, fmtFeet: (n) => String(n), pal: { ink: "#111", muted: "#888", panelLine: "#ccc" } });

  it("emits two anchored groups (scale bar + north arrow)", () => {
    expect(svg.match(/<g transform="translate\(/g)?.length).toBe(2);
  });

  it("includes the FEET unit label and the N marker", () => {
    expect(svg).toContain(">FEET<");
    expect(svg).toContain(">N<");
  });

  it("draws four alternating bar segments and three tick labels (0 / mid / max)", () => {
    const { feet } = pickScaleBar({ frameW: frame.w, ftPerUnit: frame.ftPerUnit });
    // 4 bar segments + 1 scale plate + 1 north plate = 6 rects
    expect((svg.match(/<rect /g) || []).length).toBe(6);
    expect(svg).toContain(`>${feet}<`);   // max label
    expect(svg).toContain(`>${feet / 2}<`); // midpoint label
    expect(svg).toContain(">0<");          // start label
  });

  it("does not draw a circular compass rose (simple arrow only)", () => {
    expect(svg).not.toContain("<circle");
  });

  it("north-up by default leaves the arrow unrotated; a bearing rotates it", () => {
    expect(svg).not.toContain("rotate(");
    const turned = buildSheetFurnitureSvg({ ...frame, bearingDeg: 30 });
    expect(turned).toContain("rotate(-30");
  });
});

describe("buildScreenFurnitureSvg — on-screen furniture anchored to the viewport", () => {
  const vw = 1280, vh = 720, ftPerUnit = 2; // 1 px = 2 ft (ppf 0.5)
  const svg = buildScreenFurnitureSvg({ vw, vh, ftPerUnit, fmtFeet: (n) => String(n), pal: {} });

  it("renders the same furniture (two groups, FEET + N, no rose)", () => {
    expect(svg.match(/<g transform="translate\(/g)?.length).toBe(2);
    expect(svg).toContain(">FEET<");
    expect(svg).toContain(">N<");
    expect(svg).not.toContain("<circle");
  });

  it("snaps the bar to a round distance for a ~130 px target", () => {
    const { feet, lengthU } = pickScaleBar({ ftPerUnit, targetU: 130, maxU: Math.min(240, vw * 0.4) });
    expect(NICE).toContain(feet);
    expect(lengthU).toBeLessThanOrEqual(240 + 1e-6);
    expect(svg).toContain(`>${feet}<`);
  });

  it("anchors both plates above the status bar, inside the viewport", () => {
    const ys = [...svg.matchAll(/translate\([\d.]+,([\d.]+)\)/g)].map((m) => Number(m[1]));
    // both group origins sit above the bottom gap (40 px) and on-screen
    for (const y of ys) { expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(vh - 40 + 1e-6); }
  });
});
