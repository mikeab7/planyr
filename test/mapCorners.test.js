import { describe, it, expect } from "vitest";
import { paneInsetFor, cornerGroupWidth, cursorChipFit, rectInside, rectOverlap, MAP_CORNER_PX, CURSOR_CHIP_MIN_W_PX } from "../src/workspaces/site-planner/lib/mapCorners.js";
import { NICE_FEET, scaleBarPlate, furnitureMetrics, labelWidthEm, SCALE_END_MARGIN_EM } from "../src/workspaces/site-planner/lib/sheetFurniture.js";
import fs from "node:fs";

describe("paneInsetFor (B2206704–B2206706 NEW-1)", () => {
  it("is the overlap only while a desktop docked column exists", () => {
    expect(paneInsetFor({ narrow: false, docked: true, overlap: 17 })).toBe(17);
    expect(paneInsetFor({ narrow: false, docked: false, overlap: 17 })).toBe(0);
    expect(paneInsetFor({ narrow: true, docked: true, overlap: 17 })).toBe(0);
    expect(paneInsetFor({ narrow: false, docked: true, overlap: NaN })).toBe(0);
  });
});
describe("corner group + chip fit (NEW-1/NEW-2)", () => {
  it("sums parts with gaps", () => { expect(cornerGroupWidth({ scaleBarW: 160, helpW: 30, zoomW: 30 })).toBe(160 + 30 + 30 + 16); });
  it("chip truncates to what is left, and yields below its minimum", () => {
    const g = 236;
    const wide = cursorChipFit({ visW: 900, groupW: g });
    expect(wide.show).toBe(true);
    expect(wide.maxWidth).toBe(900 - 2 * MAP_CORNER_PX - g - 8);
    expect(cursorChipFit({ visW: 300, groupW: g }).show).toBe(false);
    expect(cursorChipFit({ visW: 24 + g + 8 + CURSOR_CHIP_MIN_W_PX, groupW: g }).show).toBe(true);
  });
});
describe("rect predicates", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  it("inside / overlap ignore a half-pixel kiss", () => {
    expect(rectInside({ left: 1, top: 1, right: 9, bottom: 9 }, a)).toBe(true);
    expect(rectInside({ left: -3, top: 1, right: 9, bottom: 9 }, a)).toBe(false);
    expect(rectOverlap(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(0);
    expect(rectOverlap(a, { left: 5, top: 5, right: 20, bottom: 20 })).toBe(25);
  });
});
describe("scale bar plate keeps right-hand room (NEW-3)", () => {
  const m = furnitureMetrics(540);
  for (const feet of NICE_FEET) {
    it(`${feet} ft: plate carries half the end label plus the stated margin; bar length untouched`, () => {
      const fmt = (n) => Math.round(n).toLocaleString();
      const sb = scaleBarPlate({ lengthU: 130, feet, m, fmtFeet: fmt });
      expect(sb.plateW).toBeCloseTo(130 + sb.padL + sb.padR, 6);
      expect(sb.padR).toBeGreaterThanOrEqual((labelWidthEm(fmt(feet)) / 2 + SCALE_END_MARGIN_EM) * m.fs - 1e-9);
      expect(sb.padR).toBeGreaterThanOrEqual(sb.padL);
    });
  }
});
describe("source guard: left-anchored furniture is inset", () => {
  const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("north arrow frame, badge, chip and toast all read paneInset", () => {
    expect(src).toMatch(/map-furniture-frame" style=\{\{ position: "absolute", left: paneInset/);
    expect(src).toMatch(/left: calibPlace\.left \+ paneInset/);
    expect(src).toMatch(/left: paneInset \+ MAP_CORNER_PX/);
    expect(src).toMatch(/left: paneInset \+ 14/);
  });
});
