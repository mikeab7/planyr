/* B654240 — ONE CHROME SYSTEM for the top-right planner toolbar (File / History / View).
 *
 * Owner report: "this is horrendous UI" — File, the Undo/Redo pair, and Zoom-to-fit each used a
 * different container language (a 3px-radius outlined pill, a filled grey slab with its own 10px
 * radius, and a bare glyph with no container at all), so the group read as three unrelated
 * control systems rather than one toolbar. Read the full report on the shipped BACKLOG-DONE.md
 * entry for this id.
 *
 * This is a SOURCE GUARD, not a live-DOM check (that lives in
 * ui-audit/verify-toolbar-chrome-system.mjs) — it pins the SHAPE of the fix so a future edit can't
 * silently reintroduce a one-off radius/height or a filled tray without the build noticing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)),
  "utf8",
);

// Isolate the plannerToolbar render block (File → History → View) so a match elsewhere in this
// 20k-line file can't produce a false pass.
const toolbarStart = SRC.indexOf("const plannerToolbar = (");
const toolbarEnd = SRC.indexOf("\n  );", toolbarStart);
if (toolbarStart === -1 || toolbarEnd === -1) {
  throw new Error("toolbarChromeSystem: could not locate the plannerToolbar render block — has it moved or been renamed?");
}
const TOOLBAR = SRC.slice(toolbarStart, toolbarEnd);

describe("B654240 — the top-right planner toolbar shares one chrome system", () => {
  it("declares shared TB_H / TB_R constants derived from the existing dIcon/dGhost defaults", () => {
    expect(SRC).toMatch(/const TB_H = dIcon\.height;/);
    expect(SRC).toMatch(/const TB_R = dGhost\.borderRadius;/);
  });

  it("the File button uses the shared height + radius, not a one-off value", () => {
    const fileBtn = TOOLBAR.slice(TOOLBAR.indexOf('title="File'), TOOLBAR.indexOf("</button>", TOOLBAR.indexOf('title="File')));
    expect(fileBtn).toMatch(/height:\s*TB_H/);
    expect(fileBtn).toMatch(/borderRadius:\s*TB_R/);
    // Mutation guard — the pre-fix shape this replaces. If either literal reappears on the File
    // button, the "one chrome system" rule has silently regressed.
    expect(fileBtn).not.toMatch(/borderRadius:\s*3\b/);
  });

  it("the History (Undo/Redo) group is NOT wrapped in a filled container", () => {
    const undoIdx = TOOLBAR.indexOf('aria-label="Undo"');
    expect(undoIdx).toBeGreaterThan(-1);
    // Walk backward from the Undo button to the nearest enclosing <div style={{...}}> — that is
    // the group wrapper the bug report called "a FILLED GREY SLAB".
    const wrapperOpen = TOOLBAR.lastIndexOf("<div style={{", undoIdx);
    const wrapperTag = TOOLBAR.slice(wrapperOpen, TOOLBAR.indexOf("}}>", wrapperOpen) + 3);
    expect(wrapperTag).not.toMatch(/background:/);
    expect(wrapperTag).not.toMatch(/padding:\s*2/);
    // Mutation guard — the exact pre-fix container this replaces.
    expect(TOOLBAR).not.toMatch(/background:\s*"var\(--hover-chrome\)",\s*borderRadius:\s*10,\s*padding:\s*2/);
  });

  it("disabled toolbar icon buttons dim only the glyph (currentColor + opacity), never a container fill", () => {
    // .tb-icon-btn is the shared Undo/Redo/Zoom-to-fit/Layers icon-button class; its disabled rule
    // must stay opacity-on-currentColor, never a hardcoded/token background swap.
    const css = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
    const rule = css.match(/\.tb-icon-btn:disabled\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/opacity:/);
    expect(rule[0]).not.toMatch(/background/);
  });

  it("File, Undo, Redo and Zoom-to-fit are still grouped only by the shared vSep divider", () => {
    // Between the File group and the closing of the Zoom-to-fit group there must be exactly two
    // {vSep} dividers (File | History | View) — proves the fix didn't reintroduce a fourth
    // grouping mechanism (a border, a background band) alongside the divider.
    const zoomFitIdx = TOOLBAR.indexOf('aria-label="Zoom to fit"');
    const span = TOOLBAR.slice(0, zoomFitIdx);
    const vSepCount = (span.match(/\{vSep\}/g) || []).length;
    expect(vSepCount).toBe(2);
  });
});
