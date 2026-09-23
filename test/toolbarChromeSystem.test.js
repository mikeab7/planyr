/* B654240 — ONE CHROME SYSTEM for the top-right planner toolbar (File / History / View).
 *
 * Owner report: "this is horrendous UI" — File, the Undo/Redo pair, and Zoom-to-fit each used a
 * different container language (a 3px-radius outlined pill, a filled grey slab with its own 10px
 * radius, and a bare glyph with no container at all), so the group read as three unrelated
 * control systems rather than one toolbar. Read the full report on the shipped docs/archive/BACKLOG-DONE.md
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

  it("B1807200 AMENDMENT — dGhost/dIcon carry a resting bordered box, not a transparent ghost fill", () => {
    // File/Undo/Redo/Zoom-to-fit inherit this from dGhost, matching CloudSyncBadge/PresenceChip/the
    // account trigger's own resting box; a regression back to `border: "1px solid transparent"` /
    // `background: "transparent"` here is exactly the bug this amendment fixed (owner: "the cloud
    // and the other people here thing are showing... the file undo redo, none of that went through").
    const dGhostDecl = SRC.slice(SRC.indexOf("const dGhost = {"), SRC.indexOf("\n", SRC.indexOf("const dGhost = {")));
    expect(dGhostDecl).toMatch(/border:\s*"1px solid var\(--border-default\)"/);
    expect(dGhostDecl).toMatch(/background:\s*"var\(--surface-raised\)"/);
    expect(dGhostDecl).not.toMatch(/border:\s*"1px solid transparent"/);
    expect(dGhostDecl).not.toMatch(/background:\s*"transparent"/);
  });

  it("B1807200 AMENDMENT — the File button's resting (menu-closed) border/background use the shared tokens, not hardcoded chrome/transparent", () => {
    const fileBtn = TOOLBAR.slice(TOOLBAR.indexOf('title="File'), TOOLBAR.indexOf("</button>", TOOLBAR.indexOf('title="File')));
    expect(fileBtn).toMatch(/"var\(--border-default\)"/);
    expect(fileBtn).toMatch(/"var\(--surface-raised\)"/);
  });

  it("B1807200 AMENDMENT — Undo/Redo icon halves suppress their own right border so the split-button seam shows one hairline, not two", () => {
    expect(TOOLBAR).toMatch(/borderRadius:\s*`\$\{TB_R\}px 0 0 \$\{TB_R\}px`,\s*borderRight:\s*"none"/);
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

  it("disabled toolbar icon buttons keep their resting box and dim only the glyph, never a container fade", () => {
    // .tb-icon-btn is the shared Undo/Redo/Zoom-to-fit icon-button class. B1807200 AMENDMENT:
    // now that dGhost/dIcon carry a real background+border, the disabled rule must CANCEL the
    // app-wide button:disabled fade on the button itself (opacity:1) and dim only its direct-child
    // glyph — never fade the button (which would fade its box along with the glyph) and never swap
    // in a hardcoded/token background.
    const css = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
    const boxRule = css.match(/\.tb-icon-btn:disabled\s*\{[^}]*\}/);
    expect(boxRule).not.toBeNull();
    expect(boxRule[0]).toMatch(/opacity:\s*1\b/);
    expect(boxRule[0]).not.toMatch(/background/);
    const glyphRule = css.match(/\.tb-icon-btn:disabled\s*>\s*\*\s*\{[^}]*\}/);
    expect(glyphRule).not.toBeNull();
    expect(glyphRule[0]).toMatch(/opacity:\s*\.45\b/);
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
