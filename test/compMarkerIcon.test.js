import { describe, it, expect } from "vitest";
import { compMarkerColor, compMarkerSvg, compMarkerSize } from "../src/shared/comps/lib/compMarkerIcon.js";

describe("compMarkerIcon", () => {
  it("gives each comp type a distinct color", () => {
    const colors = new Set(["land", "building_sale", "lease"].map(compMarkerColor));
    expect(colors.size).toBe(3);
  });

  it("falls back to a neutral color for an unknown type", () => {
    expect(compMarkerColor("nonsense")).toBe("#6b6b6b");
  });

  it("renders valid, non-empty SVG markup for every type", () => {
    for (const t of ["land", "building_sale", "lease"]) {
      const svg = compMarkerSvg(t);
      expect(svg).toContain("<svg");
      expect(svg).toContain(compMarkerColor(t));
    }
  });

  it("grows the marker when selected, and the anchor stays centered", () => {
    const rest = compMarkerSize(false);
    const sel = compMarkerSize(true);
    expect(sel.size[0]).toBeGreaterThan(rest.size[0]);
    expect(sel.anchor).toEqual([sel.size[0] / 2, sel.size[1] / 2]);
    expect(rest.anchor).toEqual([rest.size[0] / 2, rest.size[1] / 2]);
  });
});
