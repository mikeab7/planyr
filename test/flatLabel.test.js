/* NEW-1 (2026-10-30) — a map LABEL is never its own compositor layer. Measured live (Olive Branch, Water & Sewer on): 511 permanent tooltips written with Leaflet's
 * `translate3d` = 511 compositor layers and a pan that stalled 100–137 ms against 33–65 ms with the layers off. This guards the mechanism, DOM-free. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flattenTooltip, flatTransform } from "../src/workspaces/site-planner/lib/flatLabel.js";

/* A fake tooltip with Leaflet's contract: `_setPosition(pos)` writes a 3D transform and records `_leaflet_pos` on the container. */
const fakeTip = () => {
  const style = {};
  const tip = { _container: { style, _leaflet_pos: null }, positions: 0,
    _setPosition(pos) { this.positions++; this._container._leaflet_pos = pos; style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0px)`; } };
  return { tip, style };
};

describe("flattenTooltip", () => {
  it("a position written after flattening is a 2D translate — never translate3d", () => {
    const { tip, style } = fakeTip();
    flattenTooltip(tip);
    tip._setPosition({ x: 12.5, y: -3 });
    expect(style.transform).toBe("translate(12.5px, -3px)");
    expect(style.transform).not.toMatch(/translate3d/);
    tip._setPosition({ x: 40, y: 8 });                       // every later zoom step / move too
    expect(style.transform).toBe("translate(40px, 8px)");
    expect(tip.positions).toBe(2);                           // Leaflet's own positioning still runs (anchor, direction, offset)
  });
  it("rewrites the transform a tooltip ALREADY has when it is flattened after it opened", () => {
    const { tip, style } = fakeTip();
    tip._setPosition({ x: 5, y: 6 });
    expect(style.transform).toMatch(/translate3d/);
    flattenTooltip(tip);
    expect(style.transform).toBe("translate(5px, 6px)");
  });
  it("is idempotent, and a tooltip that is not yet on the map (no container) positions flat when it is added", () => {
    const { tip, style } = fakeTip();
    const container = tip._container; tip._container = null;
    flattenTooltip(tip); flattenTooltip(tip);
    tip._container = container;
    tip._setPosition({ x: 1, y: 2 });
    expect(style.transform).toBe("translate(1px, 2px)");
    expect(tip.positions).toBe(1);                           // wrapped once, not twice
  });
  it("tolerates a missing / foreign tooltip", () => {
    expect(flattenTooltip(null)).toBe(null);
    expect(() => flattenTooltip({})).not.toThrow();
    expect(flatTransform({ x: 0, y: 0 })).toBe("translate(0px, 0px)");
  });
});

describe("layers.js binds every line label through the flattening helper", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/lib/layers.js", import.meta.url), "utf8");
  it("the only bindTooltip call with the label options is inside bindLabel", () => {
    const calls = src.match(/\.bindTooltip\([^)]*labelOpts\(\)\)/g) || [];
    expect(calls.length).toBe(1);
    expect(src).toMatch(/const bindLabel = [^\n]*bindTooltip\(text, labelOpts\(\)\)[^\n]*flattenTooltip\(/);
    expect(src).toMatch(/import \{ flattenTooltip \} from "\.\/flatLabel\.js"/);
  });
});
