import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { hatchPatternTransform, hatchAnchorFor } from "../src/workspaces/site-planner/lib/hatchAnchor.js";

describe("hatchAnchor (NEW-1) — every canvas hatch is pinned to the ground", () => {
  it("translate → rotate → scale; identity collapses to undefined (the old default)", () => {
    expect(hatchPatternTransform()).toBeUndefined();
    expect(hatchPatternTransform({ rotate: 45 })).toBe("rotate(45)");
    expect(hatchPatternTransform({ rotate: 45, scale: 2, anchor: { x: 12.5, y: -3 } })).toBe("translate(12.5 -3) rotate(45) scale(2)");
    expect(hatchPatternTransform({ anchor: { x: NaN, y: 1 } })).toBe("translate(0 1)");
  });
  it("the anchor is the render view's feet origin, so a panel drag (offX −= Δ, canvas corner += Δ) keeps it on the same ground", () => {
    const before = hatchAnchorFor({ ppf: 0.5, offX: 229.2, offY: 317.5 });
    const after = hatchAnchorFor({ ppf: 0.5, offX: 229.2 - 20, offY: 317.5 });
    const cornerMove = 20;
    expect(after.x + cornerMove).toBeCloseTo(before.x, 9);     // screen x of the lattice origin is unchanged
    expect(hatchAnchorFor(null)).toBeNull();
    // on a scaled display the anchor sits on a whole device pixel, within half a device pixel of the ground point
    const a = hatchAnchorFor({ ppf: 1, offX: 226.6205, offY: 10.1 }, 1.25);
    expect(Number.isInteger(Math.round(a.x * 1.25 * 1e6) / 1e6)).toBe(true);
    expect(Math.abs(a.x - 226.6205) * 1.25).toBeLessThanOrEqual(0.5);
  });
  it("wiring: every planner <pattern> goes through the anchored transform", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/const hatchAnchor = hatchAnchorFor\(renderView, /);
    const defs = src.match(/<HatchPatternDef [^>]*\/>/gs) || [];
    expect(defs.length).toBeGreaterThan(3);
    for (const d of defs) expect(d).toMatch(/anchor=\{hatchAnchor\}/);
    // the hand-written map patterns use patHatchTf, which carries the anchor
    for (const id of ["pat-landscape", "pat-berm", "pat-trailer", "pat-sidewalk"]) expect(src).toMatch(new RegExp(`id="${id}"[^>]*patternTransform=\\{patHatchTf\\(`));
  });
});
