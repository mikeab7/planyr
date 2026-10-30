/* The Univer header verdict (NEW-1 B2574352, NEW-2 B2574353): ONE flat, left-aligned strip and curved undo / redo. The rules live in
 * ui-audit/lib/univerHeader.mjs; the browser run (ui-audit/verify-univer-header.mjs) feeds them real measurements. Here each rule is
 * proved to go GREEN on the intended shape and RED on the old one — a verdict nobody has seen fail is not a guard. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { judgeHeader, MAX_STRIP_HEIGHT } from "../ui-audit/lib/univerHeader.mjs";

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const icon = (over = {}) => ({ marker: "", paths: [], hasPolyline: 0, stroke: "currentColor", fill: "none", filledPath: false, width: 16, height: 16, color: "rgb(168, 176, 189)", disabled: true, ...over });
const GOOD = () => ({
  found: true, host: rect(0, 0, 1440, 700), header: rect(0, 0, 1440, 40), formulaBar: rect(0, 40, 1440, 28),
  tabBandHeight: 0, rows: 1, interactiveCount: 28,
  dropdown: { ...rect(12, 8, 72, 24), text: "Start" }, leftmost: { ...rect(12, 8, 72, 24), label: "Start" }, firstTool: { ...rect(100, 8, 24, 24), label: "Undo" },
  radiusOffenders: [], shadowOffenders: [], toolSig: "Undo|Redo", toolCount: 24, overflow: true,
  undo: icon({ marker: "undo-curved", paths: ["M4 9h9a6 6 0 0 1 0 12h-4"], hasPolyline: 1 }),
  redo: icon({ marker: "redo-curved", paths: ["M20 9h-9a6 6 0 0 0 0 12h4"], hasPolyline: 1 }),
  registered: [{ cmd: "inc", shown: true, inHeader: true, cy: 20, hasIcon: true }, { cmd: "dec", shown: true, inHeader: true, cy: 20, hasIcon: true }], mainRow: 20,
  neighbour: icon(), bold: icon({ disabled: false, color: "rgb(27, 30, 38)" }),
});
const failing = (m) => judgeHeader(m).filter((r) => !r.ok).map((r) => r.id);

describe("univerHeader verdict", () => {
  it("is green on the intended single, left-aligned, flat strip with curved arrows", () => {
    expect(failing(GOOD())).toEqual([]);
    expect(judgeHeader(GOOD()).map((r) => r.id)).toEqual(expect.arrayContaining(["one-row", "dropdown-left", "tools-left", "flat", "undo-curved", "redo-curved", "icon-size-colour"]));
  });
  it("is red on Univer's default two-strip header (a centred tab row above the tool row, no dropdown)", () => {
    const m = GOOD();
    Object.assign(m, { rows: 2, tabBandHeight: 36, header: rect(0, 0, 1440, 76), formulaBar: rect(0, 76, 1440, 28), dropdown: null, leftmost: { ...rect(604, 4, 49, 28), label: "Start" }, firstTool: { ...rect(31, 44, 24, 24), label: "Undo" } });
    expect(failing(m)).toEqual(expect.arrayContaining(["one-row", "dropdown-left", "tools-left"]));
  });
  it("is red when the header is a single row but taller than one tool row", () => {
    const m = GOOD(); m.header = rect(0, 0, 1440, MAX_STRIP_HEIGHT + 20); m.formulaBar = rect(0, m.header.bottom, 1440, 28);
    expect(failing(m)).toContain("one-row");
  });
  it("is red when the formula bar is missing, detached from the strip or not left-aligned", () => {
    for (const fb of [null, rect(0, 90, 1440, 28), rect(40, 40, 1400, 28)]) { const m = GOOD(); m.formulaBar = fb; expect(failing(m)).toContain("one-row"); }
  });
  it("is red when the dropdown is not the leftmost control, or sits away from the left edge", () => {
    const a = GOOD(); a.leftmost = { ...rect(2, 8, 24, 24), label: "stray" }; expect(failing(a)).toContain("dropdown-left");
    const b = GOOD(); b.dropdown = { ...rect(300, 8, 72, 24), text: "Start" }; b.leftmost = { ...rect(300, 8, 72, 24), label: "Start" }; expect(failing(b)).toContain("dropdown-left");
    const c = GOOD(); c.dropdown = { ...rect(12, 8, 72, 24), text: "Menu" }; expect(failing(c)).toContain("dropdown-left");
  });
  it("is red when the tools are centred (first tool past the midpoint or far from the dropdown)", () => {
    const a = GOOD(); a.firstTool = { ...rect(800, 8, 24, 24), label: "Undo" }; expect(failing(a)).toContain("tools-left");
    const b = GOOD(); b.firstTool = { ...rect(400, 8, 24, 24), label: "Undo" }; expect(failing(b)).toContain("tools-left");
  });
  it("is red when a registered tool (indent) is drawn on a second row or outside the strip, and green when folded into the overflow", () => {
    const a = GOOD(); a.registered = [{ cmd: "inc", shown: true, inHeader: true, cy: 60, hasIcon: true }]; expect(failing(a)).toContain("registered-tools");
    const b = GOOD(); b.registered = [{ cmd: "inc", shown: true, inHeader: false, cy: 20, hasIcon: true }]; expect(failing(b)).toContain("registered-tools");
    const c = GOOD(); c.registered = [{ cmd: "inc", shown: true, inHeader: true, cy: 20, hasIcon: false }]; expect(failing(c)).toContain("registered-tools");
    const d = GOOD(); d.registered = [{ cmd: "inc", shown: false }, { cmd: "dec", shown: false }]; expect(failing(d)).toEqual([]);
  });
  it("is red on any border radius or box shadow in the strip", () => {
    const a = GOOD(); a.radiusOffenders = ["a.univer-mr-2:9999px"]; expect(failing(a)).toContain("flat");
    const b = GOOD(); b.shadowOffenders = ["div.menu"]; expect(failing(b)).toContain("flat");
  });
  it("is red on Univer's default undo / redo glyphs (filled path, no arc, not ours)", () => {
    const m = GOOD();
    m.undo = icon({ paths: ["M4.72365 2.72206C4.975 2.9 4 3 4 4Z"], filledPath: true, stroke: "" });
    m.redo = icon({ paths: ["M11.273 2.72206C11.021 2.9 12 3 12 4Z"], filledPath: true, stroke: "" });
    expect(failing(m)).toEqual(expect.arrayContaining(["undo-curved", "redo-curved"]));
  });
  it("is red on an elbow (right-angle) glyph that has no arc command", () => {
    const m = GOOD(); m.undo = icon({ marker: "undo-curved", paths: ["M20 20v-7h-4H4"], hasPolyline: 1 });
    expect(failing(m)).toContain("undo-curved");
  });
  it("is red when undo / redo differ from the neighbouring icons in size or colour", () => {
    const a = GOOD(); a.undo = { ...a.undo, width: 24, height: 24 }; expect(failing(a)).toContain("icon-size-colour");
    const b = GOOD(); b.redo = { ...b.redo, color: "rgb(0, 0, 0)" }; expect(failing(b)).toContain("icon-size-colour");
  });
  it("checks the ENABLED colour only when an enabled measurement is supplied, and is red on a mismatch", () => {
    const ok = { ...GOOD(), enabledUndo: icon({ disabled: false, color: "rgb(27, 30, 38)" }) };
    expect(judgeHeader(ok).find((r) => r.id === "icon-enabled-colour").ok).toBe(true);
    const bad = { ...GOOD(), enabledUndo: icon({ disabled: false, color: "rgb(1, 2, 3)" }) };
    expect(judgeHeader(bad).find((r) => r.id === "icon-enabled-colour").ok).toBe(false);
    expect(judgeHeader(GOOD()).some((r) => r.id === "icon-enabled-colour")).toBe(false);
  });
  it("is red when no header was found at all", () => { expect(failing({ found: false })).toEqual(["found"]); });
});

describe("the component is wired to the rules", () => {
  const src = readFileSync(new URL("../src/workspaces/model/components/UniverSheet.jsx", import.meta.url), "utf8");
  it("runs Univer's collapsed ribbon (one strip) and replaces the undo / redo glyphs through its icon registry", () => {
    expect(src).toMatch(/RIBBON_TYPE = "collapsed"/);
    expect(src).toMatch(/ribbonType: RIBBON_TYPE/);
    expect(src).toMatch(/IconManager/);
    expect(src).toMatch(/CURVED_ICONS/);
  });
  it("never hides or forks the package: the strip is flattened by CSS only", () => {
    const css = readFileSync(new URL("../src/workspaces/model/components/univerSheet.css", import.meta.url), "utf8");
    expect(css).toMatch(/\[data-u-comp="headerbar"\] \* \{ border-radius: 0 !important; box-shadow: none !important; \}/);
    expect(css).not.toMatch(/ribbon-header-menu"\][^{]*\{[^}]*display:\s*none/);
  });
});
