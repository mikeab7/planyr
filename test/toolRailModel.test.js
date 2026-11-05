/* NEW-1 (right tool rail) — the pure model behind the ▾ value pills and the heading spacing.
 * The pill, its hover tooltip and its screen-reader label are three renderings of ONE fact, so the
 * tests pin that they agree; the spacing test pins the owner's stated heading rule as numbers
 * (above ≈ 2× below; below a little LESS than the gap between two tools). */
import { describe, it, expect } from "vitest";
import { fmtFeet, fmtStall, roadPill, parkingPill, buildingPill, dockGlyphKind, headingInkGaps, RAIL } from "../src/workspaces/site-planner/lib/toolRailModel.js";

describe("toolRailModel — values", () => {
  it("formats feet with the foot mark, no trailing .0, never 0", () => {
    expect(fmtFeet(36)).toBe("36′");
    expect(fmtFeet("30")).toBe("30′");
    expect(fmtFeet(28.5)).toBe("28.5′");
    expect(fmtFeet(28.04)).toBe("28′");
    expect(fmtFeet(0)).toBeNull();
    expect(fmtFeet("")).toBeNull();
    expect(fmtFeet(NaN)).toBeNull();
  });
  it("stall is W×D with foot marks on both", () => {
    expect(fmtStall(9, 18)).toBe("9′×18′");
    expect(fmtStall(9, null)).toBeNull();
  });
  it("road pill: preset, custom (its actual number) and cross-section (which wins)", () => {
    expect(roadPill({ roadWidth: "36" }).text).toBe("36′");
    expect(roadPill({ roadWidth: "28" }).text).toBe("28′");
    expect(roadPill({ roadWidth: "36", xsectionWidth: 52 }).text).toBe("52′");
    expect(roadPill({ roadWidth: "" })).toBeNull();
  });
  it("tooltip names what the value is; aria says it in words", () => {
    const r = roadPill({ roadWidth: "36" });
    expect(r.title).toBe("Road width: 36′ · click to change");
    expect(r.aria).toBe("Road presets, current width 36 feet");
    const p = parkingPill({ kind: "car", stallW: 9, stallDepth: 18 });
    expect(p.text).toBe("9′×18′");
    expect(p.title).toBe("Parking stall: 9′ × 18′ · click to change");
    expect(p.aria).toBe("Parking type, stall 9 by 18 feet");
  });
  it("trailer kind shows the trailer stall, not the car stall", () => {
    const p = parkingPill({ kind: "trailer", stallW: 9, stallDepth: 18, trailerW: 12, trailerL: 53 });
    expect(p.text).toBe("12′×53′");
    expect(p.title).toMatch(/^Trailer stall/);
  });
  it("a missing stall falls back to null (plain ▾), never a made-up number", () => {
    expect(parkingPill({ kind: "car" })).toBeNull();
  });
  it("building: dock layout → glyph kind, unknown → plain rectangle", () => {
    expect(dockGlyphKind("cross")).toBe("cross");
    expect(dockGlyphKind("single")).toBe("single");
    expect(dockGlyphKind("none")).toBe("none");
    expect(dockGlyphKind(undefined)).toBe("none");
    expect(buildingPill("cross").aria).toBe("Dock layout, current cross-dock, two sides");
  });
});

describe("toolRailModel — heading spacing", () => {
  const g = headingInkGaps();
  it("above a heading is about twice the space below it", () => {
    const ratio = g.above / g.below;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });
  it("below a heading is slightly LESS than the space between two tools (attached, not cramped)", () => {
    expect(g.below).toBeLessThan(g.toolToTool);
    expect(g.below / g.toolToTool).toBeGreaterThan(0.75);
  });
  it("the first heading's top gap is smaller than any later heading's", () => {
    expect(RAIL.hdrFirstMarginTop).toBeLessThan(RAIL.hdrMarginTop);
  });
});

describe("toolRailModel — index.css mirrors the model (they cannot drift)", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const rule = css.match(/\.rail-hdr \{([^}]*)\}/)[1];
  it("heading height + margins equal RAIL", () => {
    expect(rule).toContain(`height: ${RAIL.hdrH}px`);
    expect(rule).toContain(`margin: ${RAIL.hdrMarginTop}px 0 ${RAIL.hdrMarginBottom}px`);
    expect(css).toMatch(new RegExp(`\\.rail-scroll > \\.rail-hdr:first-child \\{ margin-top: ${RAIL.hdrFirstMarginTop}px; \\}`));
  });
  it("heading ink is the existing secondary chrome token and its rule is the rail border token", () => {
    expect(rule).toContain("color: var(--chrome-muted)");
    expect(css).toMatch(/\.rail-hdr::after \{[^}]*background: var\(--chrome-divider\)/);
  });
});

describe("toolRailModel — left inset: headings sit on the icon column; a thin scrollbar is declared", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  it("heading inset = 1px row border + the row's left padding (text starts where the icons do)", () => {
    expect(css).toMatch(/\.rail-hdr \{[^}]*padding: 0 0 0 var\(--rail-hdr-inset, 7px\)/);
    expect(RAIL.rowPadL + 1).toBe(7);
  });
  it("margins moved in from 12px/22px and the right gap is small and even", () => {
    expect(RAIL.padL + 1).toBeLessThanOrEqual(7);
    expect(RAIL.padL + 1 + RAIL.rowPadL + 1).toBeLessThanOrEqual(15);
    expect(RAIL.padR).toBeGreaterThan(0); expect(RAIL.padR).toBeLessThanOrEqual(8);
  });
  it("rail declares a thin, token-coloured scrollbar (not hidden)", () => {
    const r = css.match(/\.rail-scroll \{([^}]*)\}/)[1];
    expect(r).toContain("scrollbar-width: thin");
    expect(r).toContain("var(--rail-scroll-thumb)");
    expect(css).not.toMatch(/\.rail-scroll \{[^}]*scrollbar-width: none/);
    expect(css.match(/--rail-scroll-thumb:/g).length).toBe(2); // light + dark
  });
});
