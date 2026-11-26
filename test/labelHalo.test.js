import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { labelHaloStyle, AERIAL_LABEL_FILL, AERIAL_LABEL_HALO, HALO_THIN } from "../src/workspaces/site-planner/lib/labelHalo.js";

describe("labelHaloStyle — reverse (dark) halo over the aerial, thin white halo on paper", () => {
  it("over the aerial: white text with a thin dark edge, like the basemap road names", () => {
    expect(labelHaloStyle({ halo: true, onAerial: true, ink: "#0E2E36", haloW: 3 }))
      .toEqual({ fill: AERIAL_LABEL_FILL, stroke: AERIAL_LABEL_HALO, strokeWidth: 1.8 });
  });
  it("on plain paper: keeps the dark ink and a thinner white halo (white text would vanish)", () => {
    expect(labelHaloStyle({ halo: true, onAerial: false, ink: "#0E2E36", haloW: 3 }))
      .toEqual({ fill: "#0E2E36", stroke: "#FFFFFF", strokeWidth: 1.8 });
  });
  it("a label inside its own filled shape has no halo either way", () => {
    for (const onAerial of [true, false]) expect(labelHaloStyle({ halo: false, onAerial, ink: "#222", haloW: 3 })).toEqual({ fill: "#222" });
  });
  it("the halo is always thinner than the old one", () => {
    for (const w of [1, 2.75, 3, 7.5]) expect(labelHaloStyle({ halo: true, onAerial: true, ink: "#000", haloW: w }).strokeWidth).toBeCloseTo(w * HALO_THIN, 3);
    expect(HALO_THIN).toBeLessThan(1);
  });
  it("the planner's element labels paint through it (fill + halo from one answer)", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toContain("labelHaloStyle({");
    expect(src).not.toMatch(/stroke=\{halo \? "#fff" : undefined\}/);
  });
});
