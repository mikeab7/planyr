import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NEW-1 (Schedule grid) — a row's highlight runs edge to edge: the frozen ID / Task cells must paint the same
// colour as the date cells beside them. The browser half (real computed backgrounds, every row kind, selection,
// sideways scroll, Split) is `ui-audit/verify-row-highlight-continuous.mjs`; this is the CI-runnable half and
// runs the REAL `pinnedFillLayers` sliced out of public/sequence/index.html (red-proof: on the pre-fix source the
// function does not exist, so every test here fails at extraction).
const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const line = (prefix) => { const s = src.indexOf(prefix); if (s === -1) throw new Error(prefix + " missing from public/sequence/index.html"); return src.slice(s, src.indexOf("\n", s)); };
const { pinnedFillLayers } = new Function(`${line("const pinnedFillLayers =")}; return { pinnedFillLayers };`)();

// What the eye sees for a CSS multi-layer background: the FIRST layer is on top.
const topLayer = (css) => (/^linear-gradient\((.+?),\1\)/.exec(css) || [])[1] || null;
// What an UNFROZEN cell paints: its own overlay (background-color), or — transparent — the row colour beneath it.
const unfrozenPaint = (rowBg, overlay) => overlay || rowBg;
// What a FROZEN cell paints: the top layer of the stack built by the one helper.
const frozenPaint = (rowBg, overlay) => topLayer(pinnedFillLayers([rowBg, overlay]));

const ROW_COLOURS = ["#ffdfdf", "#fff7b9", "#d6fae2", "#f3f4f6", "#f8fafc", "#fde68a", "var(--bg)"];
const OVERLAYS = [null, "#dbeafe", "#fbcfe8", "#bbf7d0"];

describe("Schedule grid — a frozen cell paints what the cell beside it paints (NEW-1)", () => {
  it("for every row colour × overlay (none / range tint / per-cell fill) the frozen and unfrozen cells agree", () => {
    for (const row of ROW_COLOURS) for (const ov of OVERLAYS) {
      expect(frozenPaint(row, ov), `row ${row} overlay ${ov}`).toBe(unfrozenPaint(row, ov));
    }
  });
  it("the cell's own fill / tint is the TOP layer — the old order put the row colour on top and hid it", () => {
    expect(pinnedFillLayers(["#d6fae2", "#dbeafe"])).toBe("linear-gradient(#dbeafe,#dbeafe),linear-gradient(#d6fae2,#d6fae2)");
    expect(pinnedFillLayers(["#ffdfdf", "#fbcfe8"]).startsWith("linear-gradient(#fbcfe8")).toBe(true);
  });
  it("a row with no overlay is unchanged: one layer, the row colour (rows with no highlight look the same)", () => {
    expect(pinnedFillLayers(["#d6fae2", null])).toBe("linear-gradient(#d6fae2,#d6fae2)");
    expect(pinnedFillLayers(["var(--surf)"])).toBe("linear-gradient(var(--surf),var(--surf))");
    expect(pinnedFillLayers([])).toBe("");
  });
});

describe("Schedule grid — one source for the row highlight (NEW-1)", () => {
  it("the body cell and its frozen layer stack both read ONE overlay value, and pinStyle lists layers through the helper", () => {
    expect(src).toMatch(/const cellOverlay = tinted \? "#dbeafe" : \(cfmt\?\.fill \|\| null\);/);
    expect(src).toMatch(/backgroundColor: cellOverlay \|\| "transparent"/);
    expect(src).toMatch(/pinStyle\(c\.k, \[rowBg, cellOverlay\], 5\)/);
    expect(src).toMatch(/const layers = pinnedFillLayers\(fills\);/);
  });
  it("frozen cells stay SOLID: an opaque --bg under the layers, no opacity on the cell", () => {
    expect(src).toMatch(/backgroundColor: "var\(--bg\)", \.\.\.\(layers \? \{ backgroundImage: layers \} : \{\}\)/);
    const cell = src.slice(src.indexOf("backgroundColor: cellOverlay"), src.indexOf("backgroundColor: cellOverlay") + 600);
    expect(cell).not.toMatch(/opacity/);
  });
  it("a body cell no longer sets the `background` SHORTHAND next to the pinned longhands (a shorthand re-applied on re-render resets them)", () => {
    const i = src.indexOf("backgroundColor: cellOverlay");
    const around = src.slice(i - 400, i + 120);
    expect(around).not.toMatch(/\bbackground:\s*tinted/);
  });
});
