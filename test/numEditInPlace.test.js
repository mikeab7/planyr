/* NEW-1 — the inline numeric editor is the SIZE of the thing it edits, and only one of the two
 * ever paints.
 *
 * The owner clicked a setback chip to change 25 ft (2026-07-31) and sent one frame back: a 96 × 30
 * monospace box with a 2 px accent border and a drop shadow, floating ABOVE the 26 × 16 pill it was
 * editing — so "25" and "25′" were on screen together — landing on the building, the setback line
 * and the red setback drag handles, with the browser's own grey spinner chevrons painted on it.
 *
 * Three guards, matching the item's brief:
 *   1  the editor's rendered box is not larger than the control that spawned it (beyond a small
 *      tolerance), measured against the REAL chip metrics, not a copy of their numbers;
 *   2  the chip and its editor are never both in the DOM — the render site returns the editor
 *      INSTEAD of the pill, and the floating fallback stands down for a chip-spawned edit;
 *   3  no `input type=number` in the planner paints native spinners.
 * Plus the behaviours that had to survive the rework: Enter / Escape / blur / backdrop commit, the
 * Alt-click single-segment override inside a grouped run, and the keyboard nudge that replaces the
 * spinner buttons.
 *
 * DOM-free: the pure box module is exercised directly, the render contract by scanning source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SETBACK_CHIP, setbackChipPlateW, setbackChipSpawn, NUMEDIT_FLOAT,
  numEditBox, numEditFitsSpawn, nudgeNumEditValue,
} from "../src/workspaces/site-planner/lib/numEditBox.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const plannerSrc = read("../src/workspaces/site-planner/SitePlanner.jsx");
const fieldSrc = read("../src/workspaces/site-planner/components/NumEditField.jsx");
const cssSrc = read("../src/index.css");

/* What the editor used to be. Kept as literals ON PURPOSE: if someone reverts the sizing, these
 * are the numbers that come back, and the assertions below name them. */
const OLD = { w: 96, h: 30, fontPx: 13 };

describe("guard 1 — the editor is never bigger than the control that spawned it", () => {
  it("an in-place setback edit takes the chip's box EXACTLY", () => {
    const txt = "Front · 25′";
    const spawn = setbackChipSpawn(txt);
    const box = numEditBox({ px: 400, py: 300 }, spawn);
    expect(box.w).toBe(setbackChipPlateW(txt));
    expect(box.h).toBe(SETBACK_CHIP.h);
    expect(box.fontPx).toBe(SETBACK_CHIP.fontPx);
    expect(box.rx).toBe(SETBACK_CHIP.rx);
    expect(box.inPlace).toBe(true);
  });

  it("it sits exactly where the chip's plate sat — same centre, same top edge", () => {
    const txt = "25′";
    const spawn = setbackChipSpawn(txt);
    const anchor = { px: 512, py: 288 };
    const box = numEditBox(anchor, spawn);
    // The render site draws the plate at `anchor.x - w/2, anchor.y - CHIP_H/2 - 1`.
    expect(box.x).toBe(anchor.px - spawn.w / 2);
    expect(box.y).toBe(anchor.py - SETBACK_CHIP.h / 2 - 1);
    expect(box.x + box.w / 2).toBe(anchor.px);   // nothing moves sideways
  });

  it("numEditFitsSpawn holds for every chip text the app can produce", () => {
    for (const txt of ["—", "5′", "25′", "Front · 25′", "Street side · 100′", "Rear · 1250′"]) {
      const spawn = setbackChipSpawn(txt);
      expect(numEditFitsSpawn(numEditBox({ px: 0, py: 0 }, spawn), spawn, 1)).toBe(true);
    }
  });

  it("the OLD box fails the same invariant — the guard is not vacuous", () => {
    const spawn = setbackChipSpawn("25′");
    expect(numEditFitsSpawn({ ...OLD }, spawn, 1)).toBe(false);
    // …and each of the three dimensions is independently over, not just one of them.
    expect(OLD.w).toBeGreaterThan(spawn.w * 2);
    expect(OLD.h).toBeGreaterThan(spawn.h * 1.8);
    expect(OLD.fontPx).toBeGreaterThan(spawn.fontPx * 1.3);
  });

  it("the FLOATING fallback (road width / trace length) is brought to chip scale too", () => {
    const chip = setbackChipSpawn("25′");
    const box = numEditBox({ px: 200, py: 200 }, null);
    expect(box.inPlace).toBe(false);
    expect(box.w).toBeLessThan(OLD.w * 0.6);
    expect(box.h).toBeLessThan(OLD.h * 0.7);
    expect(box.fontPx).toBeLessThan(OLD.fontPx);
    // Within a few px / one type step of the chip — "the chip's scale", per the brief.
    expect(box.h).toBeLessThanOrEqual(chip.h + 4);
    expect(box.fontPx).toBeLessThanOrEqual(chip.fontPx + 1.5);
  });

  it("the floating fallback is OFFSET off its anchor, not centred over it", () => {
    const anchor = { px: 300, py: 400 };
    const box = numEditBox(anchor, null);
    // Pushed clear of the pointer horizontally…
    expect(box.x).toBeGreaterThan(anchor.px);
    // …and clear of the line it measures vertically, by more than its own height.
    expect(box.y + box.h).toBeLessThan(anchor.py - NUMEDIT_FLOAT.dy + 1);
    // The old placement centred it on the anchor, which is what put it over the geometry.
    expect(box.x + box.w / 2).not.toBe(anchor.px);
  });

  it("a garbage anchor degrades to the origin rather than NaN geometry", () => {
    for (const a of [null, undefined, {}, { px: NaN, py: "x" }]) {
      const box = numEditBox(a, null);
      expect(Number.isFinite(box.x)).toBe(true);
      expect(Number.isFinite(box.y)).toBe(true);
    }
  });
});

describe("guard 2 — the chip and its editor are never both in the DOM", () => {
  it("the pill returns the editor INSTEAD of the plate+text (an early return, not a sibling)", () => {
    const pill = plannerSrc.slice(plannerSrc.indexOf("const pill = (key, anchor, txt, onEdit)"));
    const body = pill.slice(0, pill.indexOf("\n    };"));
    const gate = body.indexOf('if (numEdit?.chipKey === key)');
    const plate = body.indexOf('data-testid="setback-chip"');
    expect(gate).toBeGreaterThan(-1);
    expect(plate).toBeGreaterThan(gate);                       // the plate is on the OTHER branch
    // The editing branch returns before the plate is ever reached.
    expect(body.slice(gate, plate)).toMatch(/return \([\s\S]*setback-chip-input[\s\S]*\);/);
  });

  it("the floating fallback stands down for a chip-spawned edit", () => {
    expect(plannerSrc).toContain("{numEdit && !numEdit.chipKey && (() => {");
  });

  it("the editing chip's key comes from the pill, never re-derived in the opener", () => {
    // pill passes it to onEdit; both openers take it as their third argument and store it.
    expect(plannerSrc).toContain("onEdit(fp, e.altKey, key)");
    expect(plannerSrc).toContain("onEdit: (fp, alt, chipKey) => setNumEdit({ fx: fp.x, fy: fp.y, chipKey,");
    expect(plannerSrc).toContain("onEdit: (fp, alt, chipKey) => {");
    expect(plannerSrc).toContain("setNumEdit({ fx: fp.x, fy: fp.y, chipKey, value: String(val == null");
  });

  it("the chip metrics have ONE home, so editor and plate cannot drift apart", () => {
    expect(plannerSrc).toContain("const CHIP_H = SETBACK_CHIP.h;");
    expect(plannerSrc).toContain("const chipPlateW = setbackChipPlateW;");
    // The old local literals are gone.
    expect(plannerSrc).not.toContain("const CHIP_H = 15;");
    expect(plannerSrc).not.toMatch(/chipPlateW = \(txt\) => Math\.max\(22/);
  });
});

describe("guard 3 — no input type=number paints native spinners", () => {
  it("index.css suppresses the UA spinners app-wide, both engines", () => {
    expect(cssSrc).toMatch(/input\[type="number"\]\s*\{[^}]*appearance:\s*textfield/);
    expect(cssSrc).toMatch(/input\[type="number"\]::-webkit-outer-spin-button/);
    expect(cssSrc).toMatch(/input\[type="number"\]::-webkit-inner-spin-button/);
    const rule = cssSrc.slice(cssSrc.indexOf('input[type="number"]::-webkit-outer-spin-button'));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/-webkit-appearance:\s*none/);
  });

  it("ArrowUp/ArrowDown nudge instead — and the browser's own step is suppressed", () => {
    expect(fieldSrc).toContain('e.key === "ArrowUp" || e.key === "ArrowDown"');
    const arm = fieldSrc.slice(fieldSrc.indexOf('e.key === "ArrowUp" || e.key === "ArrowDown"'));
    expect(arm.slice(0, arm.indexOf("nudgeNumEditValue"))).toContain("e.preventDefault()");
  });

  it("nudgeNumEditValue steps by one, ten with Shift, and never below zero", () => {
    expect(nudgeNumEditValue("25", 1)).toBe("26");
    expect(nudgeNumEditValue("25", -1)).toBe("24");
    expect(nudgeNumEditValue("25", 1, true)).toBe("35");
    expect(nudgeNumEditValue("25", -1, true)).toBe("15");
    expect(nudgeNumEditValue("0", -1)).toBe("0");          // a setback is never negative
    expect(nudgeNumEditValue("", 1)).toBe("1");            // an empty calibration field
    expect(nudgeNumEditValue("abc", 1)).toBe("1");
    expect(nudgeNumEditValue("12.5", 1)).toBe("13.5");
  });
});

describe("the editor's styling reads as this app's, and its behaviours survived", () => {
  it("the app's UI font with tabular figures — not a monospace face", () => {
    expect(fieldSrc).toContain("fontFamily: NUM_FONT");
    expect(fieldSrc).toContain("fontVariantNumeric: TABULAR_NUMS");
    expect(plannerSrc).not.toContain('fontFamily: "ui-monospace, Menlo, monospace"');
  });

  it("a one-pixel border and no drop shadow", () => {
    expect(fieldSrc).toContain("border: `1px solid ${border}`");
    expect(fieldSrc).not.toContain("boxShadow");
    expect(plannerSrc).not.toContain('border: `2px solid ${PAL.accent}`, borderRadius: 6');
  });

  it("Enter commits, Escape cancels, blur commits", () => {
    expect(fieldSrc).toMatch(/e\.key === "Enter"\)\s*\{[^}]*onCommit\(\)/);
    expect(fieldSrc).toMatch(/e\.key === "Escape"\)\s*\{[^}]*onCancel\(\)/);
    expect(fieldSrc).toContain("onBlur={onCommit}");
  });

  it("the full-canvas backdrop still commits on a click away", () => {
    expect(plannerSrc).toMatch(/\{numEdit && <rect x=\{-100000\}[\s\S]*commitNumEdit\(\);/);
  });

  it("typing REPLACES the value — focus + select, mount-only", () => {
    expect(fieldSrc).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]{0,120}el\.focus\(\); el\.select\(\);[\s\S]{0,20}\}, \[\]\)/);
  });

  it("the Alt-click single-segment override inside a grouped run is untouched", () => {
    const run = plannerSrc.slice(plannerSrc.indexOf("onEdit: (fp, alt, chipKey) => {"));
    const body = run.slice(0, run.indexOf("},\n"));
    expect(body).toContain("alt && run.edges.length > 1");
    expect(body).toContain("altSeg != null ? setEdgeSetback(selParcel, altSeg, v) : setRunSetback(selParcel, run, v)");
  });

  it("the field is a module-scope component (MODULE-SCOPE-COMPONENTS), imported by the planner", () => {
    expect(fieldSrc).toMatch(/^export default function NumEditField/m);
    expect(plannerSrc).toContain('import NumEditField from "./components/NumEditField.jsx";');
  });
});
