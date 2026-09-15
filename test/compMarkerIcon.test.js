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

  // B850016 (NEW-14) — a soft blurred `filter:drop-shadow` white glow around the marker used to
  // fade outward into the aerial imagery; the owner asked for a crisp, hard-edged white border
  // instead. This must never come back, in either state.
  it("never carries a blur filter — the white border is crisp, not a glow", () => {
    for (const selected of [false, true]) {
      for (const t of ["land", "building_sale", "lease"]) {
        const svg = compMarkerSvg(t, { selected });
        expect(svg).not.toContain("filter");
        expect(svg).not.toContain("drop-shadow");
      }
    }
  });

  // B1628912 (NEW-1) — sized down from 18/22 (owner: comps read heavier than they should next to
  // everything else on the map).
  it("sizes the resting marker at 14 and the selected marker at 17", () => {
    expect(compMarkerSize(false).size).toEqual([14, 14]);
    expect(compMarkerSize(true).size).toEqual([17, 17]);
  });

  it("draws a solid opaque white rect behind the colored one, wide enough for a real border", () => {
    const svg = compMarkerSvg("lease", { selected: false });
    const whiteRect = svg.match(/<rect[^>]*fill="#fff"[^>]*\/>/)[0];
    expect(whiteRect).toContain('stroke="none"');
    const wMatch = whiteRect.match(/width="([\d.]+)"/);
    const outerW = Number(wMatch[1]);
    const colorRect = svg.match(/<rect[^>]*fill="#3f8f5f"[^>]*\/>/)[0];
    const innerW = Number(colorRect.match(/width="([\d.]+)"/)[1]);
    // The border is the gap between the two rects' half-widths — now PROPORTIONAL to the marker's
    // own size (NEW-1) rather than a fixed px pair, so it stays comfortably more than a hairline
    // at the smaller resting size without being oversized if the marker is ever resized again.
    const border = (outerW - innerW) / 2;
    expect(border).toBeGreaterThanOrEqual(1.2);
    expect(innerW).toBeGreaterThan(0);
  });

  it("gives the selected marker at least as thick a border as the resting one", () => {
    const rest = compMarkerSvg("lease", { selected: false });
    const sel = compMarkerSvg("lease", { selected: true });
    const borderOf = (svg) => {
      const outerW = Number(svg.match(/<rect[^>]*fill="#fff"[^>]*\/>/)[0].match(/width="([\d.]+)"/)[1]);
      const innerW = Number(svg.match(/<rect[^>]*fill="#3f8f5f"[^>]*\/>/)[0].match(/width="([\d.]+)"/)[1]);
      return (outerW - innerW) / 2;
    };
    expect(borderOf(sel)).toBeGreaterThanOrEqual(borderOf(rest));
  });
});
