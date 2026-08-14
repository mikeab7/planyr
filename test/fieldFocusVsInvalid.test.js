/* B464049 / B464051 — AN ERROR MUST NOT LOOK LIKE ORDINARY FOCUS, and a number the app changed
 * must say so. Pinned so neither can drift back.
 *
 * ⛔ THE CORRECTED DIAGNOSIS, because the first one was wrong and shipped. The owner reported the
 * Depth box "wasn't letting" him type and sent a frame of it outlined in orange-red. Nothing was
 * rejecting his input. The first fix concluded the FOCUS ring was impersonating an error
 * (`--accent` sits ~14 ΔE00 from `--danger`) and moved focus to blue across ~194 controls in five
 * workspaces. **Orange-red IS Planyr's accent** — the Select tool, the "Select parcels: on" pill,
 * every active control — so a field glowing in it while you type is normal and correct, and that
 * restyle was a large visible change aimed at something that was never the cause.
 *
 * The real defect is the ERROR STATE: this app had none at all, so an unusable value was reported
 * by nothing — no colour, no icon, no message. That is a **WCAG 1.4.1 (Use of Color)** failure in
 * its own right, and a bare coloured border would not have satisfied it either: the user has to be
 * able to tell WHICH field is wrong and WHAT is wrong with it.
 *
 * ⛔ THIS SUITE MEASURES TOKENS AND SOURCE, and cannot see what the browser renders. Two defects in
 * this work were invisible to it and caught only by the harness: the invalid rule losing on
 * specificity, and a conditional wrapper REMOUNTING the input so the field lost focus mid-keystroke.
 * `ui-audit/verify-field-focus-vs-invalid.mjs` is the other half (20 checks, both themes, computed
 * styles off the live element). Neither substitutes for the other.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
const PLANNER = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

const numInput = () => {
  const i = PLANNER.indexOf("function NumInput(");
  expect(i).toBeGreaterThan(0);
  const after = PLANNER.indexOf("\nfunction ", i + 10);
  return PLANNER.slice(i, after > i ? after : i + 12000);
};

describe("the focus ring stays the brand accent", () => {
  it("REGRESSION: the blue focus restyle is gone — --focus-border must not come back", () => {
    /* The accent is Planyr's brand and the focus ring is meant to be it. Re-introducing a separate
     * focus colour restyles every text box in the app to fix something that is not the cause. */
    expect(CSS).not.toMatch(/--focus-border/);
  });

  it("the accent-derived focus ring is intact in both themes", () => {
    expect(CSS).toMatch(/--focus-ring:\s*rgba\(194, 65, 12, \.45\)/);
    expect(CSS).toMatch(/--focus-ring:\s*rgba\(242, 107, 58, \.50\)/);
  });

  it("the focused input's border reads --accent", () => {
    const rule = CSS.slice(CSS.indexOf('input:not([type="checkbox"]):not([type="range"]):not([type="color"]):focus'));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toMatch(/border-color:\s*var\(--accent\)/);
  });
});

describe("a rejected value is distinguishable without relying on colour", () => {
  it("it differs from focus in WEIGHT as well as hue", () => {
    /* Both states are warm here by design, so the error must be legible as different before any
     * colour is judged — which is what a red-green colour-blind reader needs. */
    const rule = CSS.slice(CSS.indexOf('input:not([type="checkbox"]):not([type="range"]):not([type="color"])[aria-invalid="true"]'));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toMatch(/border-color:\s*var\(--danger\)/);
    expect(body).toMatch(/border-width:\s*2px/);
  });

  it("a SHORT TEXT MESSAGE names what is wrong, and is tied to the input", () => {
    const b = numInput();
    expect(b).toMatch(/aria-describedby=\{note \? msgId : undefined\}/);
    expect(b).toMatch(/id=\{msgId\}/);
    expect(b).toMatch(/data-testid="numinput-note"/);
  });

  it("…plus aria-invalid and an icon — four cues, colour last", () => {
    const b = numInput();
    expect(b).toMatch(/aria-invalid=\{invalidReason \? "true" : undefined\}/);
    expect(b).toMatch(/data-testid=\{invalidReason \? "numinput-invalid" : "numinput-altered"\}/);
  });

  it("the message is ONE short line (PANEL-BREVITY) and only exists when there is something to say", () => {
    const b = numInput();
    expect(b).toMatch(/const noteLine = note \?/);
    expect(b).toMatch(/const note = invalidReason \|\| altered;/);
  });

  it("an EMPTY field is never an error — clearing is the first half of retyping", () => {
    const i = PLANNER.indexOf("const invalidReason = (() => {");
    expect(PLANNER.slice(i, i + 420)).toMatch(/if \(draft\.trim\(\) === ""\) return null;/);
  });

  it("out-of-range and unparseable are both refused, each with its own words", () => {
    const body = PLANNER.slice(PLANNER.indexOf("const invalidReason = (() => {"), PLANNER.indexOf("const invalidReason = (() => {") + 420);
    expect(body).toMatch(/Not a number/);
    expect(body).toMatch(/Smallest allowed is/);
    expect(body).toMatch(/Largest allowed is/);
  });

  it("the invalid selector mirrors the focus rule's :not() chain so it can actually win", () => {
    /* ⛔ `!important` does not arbitrate between two `!important` declarations; SPECIFICITY does.
     * A bare `input[aria-invalid]:focus` (0,2,1) loses to the focus rule (0,4,1) wherever it sits,
     * and the first cut shipped exactly that: aria-invalid set, icon rendered, border unchanged. */
    expect(CSS).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="range"\]\):not\(\[type="color"\]\)\[aria-invalid="true"\]:focus/);
    const focusAt = CSS.indexOf('input:not([type="checkbox"]):not([type="range"]):not([type="color"]):focus');
    expect(CSS.indexOf('[aria-invalid="true"]:focus')).toBeGreaterThan(focusAt);
  });

  it("select and textarea are covered too, not just input", () => {
    expect(CSS).toMatch(/select\[aria-invalid="true"\]:focus/);
    expect(CSS).toMatch(/textarea\[aria-invalid="true"\]:focus/);
  });
});

describe("B464051 — a number the app changed says so, in the moment (LOUD-FAILURE)", () => {
  it("a CLAMPED commit reports the value actually taken", () => {
    const b = numInput();
    expect(b).toMatch(/const shown = Math\.abs\(v - typed\) > 1e-9 \? v : null;/);
    expect(b).toMatch(/`Using \$\{fmtNum\(v\)\}`/);
  });

  it("a DISPLAY that disagrees with the model reports that separately", () => {
    /* The first guess — that these fields silently round — was measured WRONG: the model stores
     * 613.7 exactly, and it is the display that rounds. Different fact, different words. */
    const b = numInput();
    expect(b).toMatch(/`Showing \$\{fmtNum\(value\)\}`/);
    expect(b).toMatch(/committedRef\.current/);
  });

  it("an adjustment is NEVER dressed as a rejection", () => {
    const b = numInput();
    // aria-invalid is keyed on invalidReason alone, never on `note` / `altered`.
    expect(b).toMatch(/aria-invalid=\{invalidReason \? "true" : undefined\}/);
    expect(b).not.toMatch(/aria-invalid=\{note/);
  });

  it("the note is cleared by the next keystroke and by a stepper — never stale", () => {
    const b = numInput();
    expect(b).toMatch(/onChange=\{\(e\) => \{ setAltered\(null\); setDraft\(e\.target\.value\); \}\}/);
    expect(b).toMatch(/setAltered\(null\); \/\/ a stepper's own clamp/);
  });
});

describe("the control's tree shape is constant", () => {
  /* ⛔ THE SECOND DEFECT THE BROWSER CAUGHT. The first cut returned a bare row when there was
   * nothing to say and a wrapped column when there was, so the moment a message appeared React
   * remounted the <input> and the field lost focus mid-keystroke — typing `-5` left `-` and dropped
   * the `5`. A control that stops accepting input the instant it has something to tell you is a
   * crueller version of the complaint this whole item started from. */
  it("stack() always wraps — the message changes CONTENT, never the tree", () => {
    const b = numInput();
    expect(b).toMatch(/const stack = \(row\) => \(\s*\n\s*<span data-field-group="1"/);
    expect(b).not.toMatch(/const stack = \(row\) => \(noteLine\s*\n?\s*\?/);
    expect(b).toMatch(/if \(step == null\) return stack\(input\);/);
  });

  it("the value row is ONE field group, not a nested pair", () => {
    expect((numInput().match(/data-field-group="1"/g) || []).length).toBe(1);
  });
});
