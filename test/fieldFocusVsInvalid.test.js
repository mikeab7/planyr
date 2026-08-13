/* NEW-1 — A FOCUSED FIELD MAY NOT LOOK LIKE A REJECTED ONE, pinned so it cannot drift back.
 *
 * The owner reported the Depth box "wasn't letting" him enter a value and sent a frame of it
 * outlined in red. Nothing was rejecting his input — every drive path took the value. He was
 * looking at the FOCUS ring, which was `--accent` and sat 14.4 ΔE00 (light) / 13.4 (dark) from
 * this app's own `--danger`. That is one hue to a viewer, and red means rejected.
 *
 * ⛔ THIS SUITE MEASURES TOKENS AND SOURCE. It cannot see what the browser renders, and the
 * rendered result is what matters — the first cut of the invalid rule set every token correctly
 * and STILL painted blue, because the focus rule out-specified it. That half is
 * ui-audit/verify-field-focus-vs-invalid.mjs, which reads the computed style off the live element
 * in both themes. Both halves are required; neither substitutes for the other.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { srgbToLab, deltaE2000 } from "../ui-audit/lib/perceptualDiff.mjs";

const CSS = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
const PLANNER = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

/** Token values from a theme block, in source order (`:root` first, dark second). */
function tokens(name) {
  return [...CSS.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());
}
const hex = (h) => { const c = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)); };
const de = (a, b) => +deltaE2000(srgbToLab(...hex(a)), srgbToLab(...hex(b))).toFixed(2);

/* Light block first, dark second — the file defines `:root` then the dark override. */
const THEMES = [0, 1];
const themeName = (i) => (i === 0 ? "light" : "dark");

describe("the focus colour is not the error colour", () => {
  const focus = tokens("focus-border");
  const danger = tokens("danger").filter((v) => v.startsWith("#"));
  const accent = tokens("accent").filter((v) => v.startsWith("#"));

  it("--focus-border is defined in BOTH themes", () => {
    expect(focus).toHaveLength(2);
    for (const f of focus) expect(f).toMatch(/^#[0-9a-f]{6}$/i);
  });

  for (const i of THEMES) {
    it(`${themeName(i)}: focus and danger are unmistakably different hues`, () => {
      const d = de(focus[i], danger[i]);
      /* The pair that produced the report measured 14.39 / 13.36. 35 is comfortably clear of any
       * plausible drift back toward the accent family without being a number tuned to this result. */
      expect(d, `ΔE00 ${d} between --focus-border ${focus[i]} and --danger ${danger[i]}`).toBeGreaterThan(35);
    });

    it(`${themeName(i)}: focus is NOT the accent — that substitution IS the defect`, () => {
      expect(focus[i].toLowerCase()).not.toBe(accent[i].toLowerCase());
      expect(de(focus[i], accent[i])).toBeGreaterThan(20);
    });

    it(`${themeName(i)}: the focus colour is in the blue family, not the red one`, () => {
      const [r, , b] = hex(focus[i]);
      expect(b, `${focus[i]} — blue channel must dominate`).toBeGreaterThan(r + 20);
    });
  }

  it("REGRESSION: the accent-derived focus ring is gone from both themes", () => {
    /* The old values, verbatim. If either comes back, the reported defect is back with it. */
    expect(CSS).not.toMatch(/--focus-ring:\s*rgba\(194, 65, 12/);
    expect(CSS).not.toMatch(/--focus-ring:\s*rgba\(242, 107, 58/);
  });

  it("the focused input's border reads --focus-border, never --accent", () => {
    const rule = CSS.slice(CSS.indexOf('input:not([type="checkbox"]):not([type="range"]):not([type="color"]):focus'));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toMatch(/border-color:\s*var\(--focus-border\)/);
    expect(body).not.toMatch(/var\(--accent\)/);
  });
});

describe("a genuinely rejected value is distinguishable WITHOUT colour", () => {
  it("the control sets aria-invalid and an accessible error message", () => {
    expect(PLANNER).toMatch(/aria-invalid=\{invalidReason \? "true" : undefined\}/);
    expect(PLANNER).toMatch(/aria-errormessage=\{invalidReason \|\| undefined\}/);
  });

  it("…and renders a visible ⚠ glyph carrying the reason as its accessible name", () => {
    expect(PLANNER).toMatch(/data-testid="numinput-invalid"/);
    expect(PLANNER).toMatch(/aria-label=\{`Invalid: \$\{invalidReason\}`\}/);
  });

  it("the glyph reaches BOTH shapes of the control — with steppers and without", () => {
    /* `step == null` returns a bare <input>; the stepper form returns a wrapped span. A cue wired
     * into only one of them is invisible on half the fields in the inspector. */
    const i = PLANNER.indexOf("const warnGlyph = invalidReason");
    expect(i).toBeGreaterThan(0);
    const body = PLANNER.slice(i, i + 1400);
    expect(body).toMatch(/if \(step == null\) \{[\s\S]*?if \(!warnGlyph\) return input;/);
    expect(body).toMatch(/\{warnGlyph\}/);
  });

  it("an EMPTY field is never an error — clearing is the first half of retyping", () => {
    const i = PLANNER.indexOf("const invalidReason = (() => {");
    const body = PLANNER.slice(i, i + 420);
    expect(body).toMatch(/if \(draft\.trim\(\) === ""\) return null;/);
  });

  it("out-of-range and unparseable are BOTH refused, each with its own words", () => {
    const i = PLANNER.indexOf("const invalidReason = (() => {");
    const body = PLANNER.slice(i, i + 420);
    expect(body).toMatch(/Not a number/);
    expect(body).toMatch(/Smallest allowed is/);
    expect(body).toMatch(/Largest allowed is/);
  });
});

describe("the invalid rule can actually win", () => {
  /* ⛔ THE DEFECT THIS PINS. `!important` does not arbitrate between two `!important` declarations —
   * specificity does. The focus rule carries three `:not()` attribute arguments; a bare
   * `input[aria-invalid="true"]:focus` written later in the file LOSES to it, and the first cut of
   * this work shipped exactly that: aria-invalid set, ⚠ on screen, border still blue. */
  const invalidRule = CSS.slice(CSS.indexOf('input:not([type="checkbox"]):not([type="range"]):not([type="color"])[aria-invalid="true"]'));

  it("the invalid selector mirrors the focus rule's :not() chain", () => {
    expect(CSS).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="range"\]\):not\(\[type="color"\]\)\[aria-invalid="true"\]:focus/);
  });

  it("it paints --danger and is declared AFTER the focus rule", () => {
    const focusAt = CSS.indexOf('input:not([type="checkbox"]):not([type="range"]):not([type="color"]):focus');
    const invalidAt = CSS.indexOf('[aria-invalid="true"]:focus');
    expect(invalidAt).toBeGreaterThan(focusAt);
    expect(invalidRule.slice(0, invalidRule.indexOf("}"))).toMatch(/border-color:\s*var\(--danger\)/);
  });

  it("select and textarea are covered too, not just input", () => {
    expect(CSS).toMatch(/select\[aria-invalid="true"\]:focus/);
    expect(CSS).toMatch(/textarea\[aria-invalid="true"\]:focus/);
  });
});
