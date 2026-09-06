import { describe, it, expect } from "vitest";
import { grossBuildingSqft, yieldBySite } from "../src/workspaces/dashboard/lib/buildingYield.js";

describe("grossBuildingSqft", () => {
  it("sums rectangular buildings' w*h", () => {
    const els = [{ type: "building", w: 200, h: 100 }, { type: "building", w: 50, h: 50 }];
    expect(grossBuildingSqft(els)).toBe(200 * 100 + 50 * 50);
  });

  it("sums polygon buildings via the shoelace formula", () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(grossBuildingSqft([{ type: "building", points: square }])).toBe(100);
  });

  it("ignores every non-building element", () => {
    const els = [{ type: "paving", w: 1000, h: 1000 }, { type: "parking", w: 500, h: 500 }, { type: "pond", w: 200, h: 200 }];
    expect(grossBuildingSqft(els)).toBe(0);
  });

  it("rotation does not change a rectangle's area", () => {
    expect(grossBuildingSqft([{ type: "building", w: 100, h: 40, rot: 37 }])).toBe(4000);
  });

  it("handles empty/missing input without throwing", () => {
    expect(grossBuildingSqft(null)).toBe(0);
    expect(grossBuildingSqft([])).toBe(0);
    expect(grossBuildingSqft([null, { type: "building" }])).toBe(0);
  });
});

describe("yieldBySite", () => {
  it("groups rows by site_id and sums each site's building area independently", () => {
    const rows = [
      { site_id: "s1", data: { type: "building", w: 100, h: 100 } },
      { site_id: "s1", data: { type: "paving", w: 999, h: 999 } },
      { site_id: "s2", data: { type: "building", w: 50, h: 50 } },
    ];
    expect(yieldBySite(rows)).toEqual({ s1: 10000, s2: 2500 });
  });

  it("handles empty/missing input without throwing", () => {
    expect(yieldBySite(null)).toEqual({});
    expect(yieldBySite([])).toEqual({});
  });
});
