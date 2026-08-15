/* TWO ELEMENT CLASSES MAY NOT SHARE A DEFAULT COLOUR (B548816).
 *
 * The defect this exists to make impossible: the site-planner measurement's default ink and the
 * markup family's default FILL were the same value, #c2410c, so a measurement drawn over a markup
 * disappeared into it — while being painted ON TOP of it. It was reported and investigated as a
 * layering bug. It is not one, and reordering anything would have been the wrong fix.
 *
 * ⛔ WHY THE COMPARISON IS PERCEPTUAL AND NOT `!==`. A string check would pass #c2410c against
 * #c3420d, which camouflages exactly as completely. What matters is whether a person can tell the
 * two apart, so the check is CIEDE2000 — the same metric PERCEPTUAL-PARITY uses, from the same
 * module, whose implementation is already validated against Sharma/Wu/Dalal's published vectors
 * in test/perceptualParity.test.js.
 *
 * ⛔ THE TEETH PROOF IS THE PRE-FIX VALUE ITSELF, asserted below rather than described: the guard
 * is re-run against the colour the code actually shipped with, and required to REJECT it. A guard
 * nobody has seen fail is a guard that rots green (VIEW-INDEPENDENT-ONCE §6), and here the failing
 * input is free — it is what main did yesterday.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { srgbToLab, deltaE2000 } from "../ui-audit/lib/perceptualDiff.mjs";
import {
  FAMILY_DEFAULT_INK, ELEMENT_DEFAULT_PAINT, INK_DISTINCT_MIN_DE, MEASURE_INK, parseHex,
} from "../src/shared/theme/familyInk.js";
import { MEASURE_DEFAULT_COLOR, measureStyle } from "../src/workspaces/site-planner/lib/measureStyle.js";
import { ANNOT_STROKE } from "../src/shared/markup/markupStyle.js";

const de = (a, b) => deltaE2000(srgbToLab(...parseHex(a)), srgbToLab(...parseHex(b)));

/* The colour the planner shipped for a measurement BEFORE this item — PAL.accent. Hard-coded
 * here on purpose: it is the input the guard has to reject, and reading it from the palette would
 * let a palette edit quietly turn the teeth proof into a tautology. */
const PRE_FIX_MEASURE_INK = "#C2410C";

describe("the pairwise rule", () => {
  const names = Object.keys(FAMILY_DEFAULT_INK);

  it("every family's default ink is a parseable hex", () => {
    for (const [k, v] of Object.entries(FAMILY_DEFAULT_INK)) expect(parseHex(v), k).not.toBeNull();
  });

  it("no two drawn families share a default ink, perceptually", () => {
    const bad = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const d = de(FAMILY_DEFAULT_INK[names[i]], FAMILY_DEFAULT_INK[names[j]]);
        if (d < INK_DISTINCT_MIN_DE) bad.push(`${names[i]}/${names[j]} ΔE00 ${d.toFixed(1)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /* An annotation is drawn OVER the plan, so "clear of the other annotations" is only half the
   * requirement — it also has to stand off every surface it lands on. */
  it("every annotation ink stands clear of every site-element default fill and stroke", () => {
    const bad = [];
    for (const [fam, ink] of Object.entries(FAMILY_DEFAULT_INK)) {
      for (const [type, paints] of Object.entries(ELEMENT_DEFAULT_PAINT)) {
        for (const p of paints) {
          const d = de(ink, p);
          if (d < INK_DISTINCT_MIN_DE) bad.push(`${fam} over ${type} (${p}) ΔE00 ${d.toFixed(1)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("teeth — the guard rejects the colour that actually shipped", () => {
  it("the pre-fix measurement ink collides with the markup default and would FAIL the rule", () => {
    expect(de(PRE_FIX_MEASURE_INK, FAMILY_DEFAULT_INK.markup)).toBeLessThan(INK_DISTINCT_MIN_DE);
    expect(de(PRE_FIX_MEASURE_INK, ANNOT_STROKE)).toBeLessThan(INK_DISTINCT_MIN_DE);
  });
  it("…and the ink actually in use passes it by a wide margin", () => {
    expect(de(MEASURE_INK, FAMILY_DEFAULT_INK.markup)).toBeGreaterThan(INK_DISTINCT_MIN_DE * 2);
  });
  /* The rejected alternative, kept as a test so the reasoning in familyInk.js cannot rot into a
   * claim nobody re-checks: Doc Review's teal measure ink is the tidy answer and it does NOT clear
   * the pond, which is one of the most common things a measurement is drawn around here. */
  it("Doc Review's teal measure ink is correctly rejected for this canvas (it collides with the pond)", () => {
    expect(de("#0e7490", ELEMENT_DEFAULT_PAINT.pond[1])).toBeLessThan(INK_DISTINCT_MIN_DE);
  });
});

describe("the table is wired to the code, not a parallel copy", () => {
  it("measureStyle resolves an unstyled measurement to the table's measure ink", () => {
    expect(MEASURE_DEFAULT_COLOR).toBe(MEASURE_INK);
    expect(measureStyle({}).stroke).toBe(MEASURE_INK);
    expect(measureStyle({}).fill).toBe(MEASURE_INK);
  });
  it("the markup entry still matches the shared markup default it mirrors", () => {
    expect(FAMILY_DEFAULT_INK.markup.toLowerCase()).toBe(ANNOT_STROKE.toLowerCase());
  });
  /* ⛔ The mirror of planStyle's TYPES has to stay COMPLETE, or a new element type ships with a
   * colour nothing checks. Read the real registry rather than trusting the copy. */
  it("every site-element type in planStyle has a row in ELEMENT_DEFAULT_PAINT", () => {
    const src = readFileSync("src/workspaces/site-planner/lib/planStyle.js", "utf8");
    const block = src.slice(src.indexOf("export const TYPE = {"), src.indexOf("export const TYPE = {") + 2000);
    const types = [...block.matchAll(/^\s{2}(\w+):\s*\{\s*fill:\s*"(#[0-9a-fA-F]{6})",\s*stroke:\s*"(#[0-9a-fA-F]{6})"/gm)];
    expect(types.length).toBeGreaterThan(4); // the parse itself must not silently find nothing
    for (const [, type, fill, stroke] of types) {
      expect(ELEMENT_DEFAULT_PAINT[type], `planStyle type "${type}" is missing from ELEMENT_DEFAULT_PAINT`).toBeTruthy();
      expect(ELEMENT_DEFAULT_PAINT[type].map((c) => c.toLowerCase()))
        .toEqual([fill.toLowerCase(), stroke.toLowerCase()]);
    }
  });
  /* The option that caused the bug is gone, not defaulted — a caller cannot pass the app accent
   * back in. */
  it("measureStyle ignores any accent a caller tries to hand it", () => {
    expect(measureStyle({}, { accent: "#c2410c" }).stroke).toBe(MEASURE_INK);
  });
});
