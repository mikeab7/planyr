/* NEW-1 — THE KEY CONTRACT, and the sweep that keeps it from becoming a comment.
 *
 * The owner's report was that a Backspace typed while editing Depth deleted his building. The
 * measurement (ui-audit/diagnose-key-scope-paths.mjs, run on his real FM 359 plan) found that
 * SEVEN of eight ordinary ways out of a number field armed the next keystroke to do it — so the
 * defect was never one branch, it was that no one had enumerated the branches at all. Hence a
 * declared table plus a build-failing sweep, the same shape as e2e/elementCapabilities.table.js.
 *
 * Three things are asserted here:
 *   1  the SCOPE RULE, over the exact eight states that were measured in the browser
 *   2  the VERDICT table — what each scope may fire — including the two behaviours the old guard
 *      had and that must survive (typing works; B746/V258's slider undo/redo exception)
 *   3  the SOURCE SWEEP — every key literal the real planner handler branches on is declared
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCOPE, focusScope, touchLatch, touchFactsOf, scopeOwnsCanvas, TOUCH, FIELD_GROUP_ATTR } from "../src/shared/keyboard/keyScope.js";
import {
  KEY_CONTRACT, resolveKeyEntry, keyScopeVerdict, shouldHintRefusal, REFUSAL, SCOPE_GUARD_HINT,
} from "../src/workspaces/site-planner/lib/keyContract.js";

const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/* The planner's window keydown handler, sliced out of the component by its own comment banner and
 * its listener registration — so the sweep reads the REAL dispatch and not a copy of it. */
function plannerKeyHandlerSource() {
  const s = src("../src/workspaces/site-planner/SitePlanner.jsx");
  const start = s.indexOf("/* ------------ keyboard ------------ */");
  expect(start, "the planner keyboard effect banner moved — re-point this sweep").toBeGreaterThan(0);
  const end = s.indexOf('window.addEventListener("keydown", onKey);', start);
  expect(end, "the planner keydown registration moved — re-point this sweep").toBeGreaterThan(start);
  return s.slice(start, end);
}

const ev = (o) => ({ key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });

describe("focusScope — who owns the keyboard", () => {
  /* THE EIGHT STATES MEASURED IN THE BROWSER on the owner's real plan. The `expect` column is what
   * each one must resolve to; before this work every row but the last resolved to "the drawing
   * owns the keyboard" and deleted Building 1 with its eight bonded elements. */
  const MEASURED = [
    ["field still focused (the control — the ONLY case the old guard covered)", { tag: "INPUT", type: "text", lastTouchedCanvas: false }, SCOPE.FIELD],
    ["Enter committed the field, focus fell to <body>", { tag: "BODY", lastTouchedCanvas: false }, SCOPE.CHROME],
    ["Escape left the field, focus fell to <body>", { tag: "BODY", lastTouchedCanvas: false }, SCOPE.CHROME],
    ["clicked the ▲ stepper — a focused BUTTON, never in the old tag list", { tag: "BUTTON", lastTouchedCanvas: false }, SCOPE.CHROME],
    ["Tab out of the field onto the stepper (a focus move, no pointer event)", { tag: "BUTTON", lastTouchedCanvas: false }, SCOPE.CHROME],
    ["clicked the panel background", { tag: "BODY", lastTouchedCanvas: false }, SCOPE.CHROME],
    ["clicked the drawing — nothing focusable there, so <body> again", { tag: "BODY", lastTouchedCanvas: true }, SCOPE.CANVAS],
    ["a range slider has focus", { tag: "INPUT", type: "range", lastTouchedCanvas: false }, SCOPE.SLIDER],
  ];
  for (const [name, facts, want] of MEASURED) {
    it(name, () => expect(focusScope(facts)).toBe(want));
  }

  it("<body> ALONE is never an answer — the same focus resolves both ways off the latch", () => {
    expect(focusScope({ tag: "BODY", lastTouchedCanvas: true })).toBe(SCOPE.CANVAS);
    expect(focusScope({ tag: "BODY", lastTouchedCanvas: false })).toBe(SCOPE.CHROME);
  });

  it("a focused node INSIDE the drawing is the drawing, whatever its tag", () => {
    expect(focusScope({ tag: "BUTTON", insideCanvas: true, lastTouchedCanvas: false })).toBe(SCOPE.CANVAS);
  });

  /* ⛔ THE REGRESSION THE FIRST CUT OF THIS RULE SHIPPED, and the reason it is pinned here. Answering
   * CHROME for any focused non-text element made Delete DEAD ON THE CANVAS: the planner's canvas is
   * not focusable, so pressing the Building tool and drawing with it leaves `activeElement` on that
   * BUTTON for the whole session, and the drawn building could then never be deleted with a key.
   * Eight of this repo's own delete/undo e2e cases caught it. Focus is sticky; the latch is fresher. */
  it("REGRESSION: a STALE focused button loses to a canvas press — Delete must stay alive", () => {
    expect(focusScope({ tag: "BUTTON", lastTouchedCanvas: true })).toBe(SCOPE.CANVAS);
    expect(focusScope({ tag: "A", lastTouchedCanvas: true })).toBe(SCOPE.CANVAS);
  });

  it("…but a FRESH press or Tab onto that same button still refuses", () => {
    expect(focusScope({ tag: "BUTTON", lastTouchedCanvas: false })).toBe(SCOPE.CHROME);
  });

  it("a live text field outranks the latch in BOTH directions", () => {
    expect(focusScope({ tag: "INPUT", type: "text", lastTouchedCanvas: true })).toBe(SCOPE.FIELD);
    expect(focusScope({ tag: "INPUT", type: "range", lastTouchedCanvas: true })).toBe(SCOPE.SLIDER);
  });

  it("a text field wins over the latch — typing must never be hijacked", () => {
    expect(focusScope({ tag: "TEXTAREA", lastTouchedCanvas: true })).toBe(SCOPE.FIELD);
    expect(focusScope({ tag: "SELECT", lastTouchedCanvas: true })).toBe(SCOPE.FIELD);
    expect(focusScope({ tag: "DIV", isContentEditable: true, lastTouchedCanvas: true })).toBe(SCOPE.FIELD);
  });

  it("no focus at all, nothing touched yet → chrome (refuse rather than guess)", () => {
    expect(focusScope({})).toBe(SCOPE.CHROME);
    expect(scopeOwnsCanvas(focusScope({}))).toBe(false);
  });

  it("the latch is a fact about the last surface touched, not a clock", () => {
    expect(touchLatch({ insideCanvas: true })).toBe(TOUCH.CANVAS);
    expect(touchLatch({})).toBe(TOUCH.CHROME);
    expect(String(src("../src/shared/keyboard/keyScope.js"))).not.toMatch(/Date\.now|performance\.now|setTimeout/);
  });

  it("the latch has THREE values — a value row is its own state, and it outlives the field's focus", () => {
    expect(touchLatch({ isTextEntry: true })).toBe(TOUCH.FIELD);
    expect(touchLatch({ inFieldGroup: true })).toBe(TOUCH.FIELD);   // the ▲ stepper beside the input
    expect(touchLatch({ insideCanvas: true, inFieldGroup: true })).toBe(TOUCH.CANVAS); // the drawing always wins
  });

  it("touchFactsOf reads the marker the value rows actually carry", () => {
    const stub = (tag, closestHit) => ({ nodeType: 1, tagName: tag, isContentEditable: false, closest: (sel) => (sel === `[${FIELD_GROUP_ATTR}]` && closestHit ? {} : null) });
    expect(touchFactsOf(stub("BUTTON", true), null).inFieldGroup).toBe(true);
    expect(touchFactsOf(stub("BUTTON", false), null).inFieldGroup).toBe(false);
    expect(touchFactsOf(stub("INPUT", false), null).isTextEntry).toBe(true);
  });
});

describe("keyScopeVerdict — what each scope may fire", () => {
  const entry = (id) => KEY_CONTRACT.find((k) => k.id === id);

  it("THE REPORTED BUG: Delete/Backspace is refused while the user is working in a value row", () => {
    for (const key of ["Delete", "Backspace"]) {
      const v = keyScopeVerdict({ entry: resolveKeyEntry(ev({ key })), scope: SCOPE.CHROME, fieldEdit: true });
      expect(v.allow, `${key} must not reach the canvas out of a value row`).toBe(false);
      expect(v.reason).toBe(REFUSAL.CHROME);
      expect(v.entry.destructive).toBe(true);
    }
  });

  /* ⛔ THE MIRROR-IMAGE OVER-REACH, pinned so it cannot come back either. Refusing every mutating
   * key from ALL chrome also broke a legitimate flow this repo tests: click the Properties ＋ to
   * add dock zones, Escape to close the inspector, Delete to remove the still-selected building.
   * Nothing was being typed there. The line is the VALUE ROW, not chrome-ness. */
  it("REGRESSION: chrome that is NOT a value row still deletes — the ＋ / Escape / Delete flow", () => {
    const v = keyScopeVerdict({ entry: resolveKeyEntry(ev({ key: "Delete" })), scope: SCOPE.CHROME, fieldEdit: false });
    expect(v.allow).toBe(true);
  });

  it("…and still fires normally when the drawing owns the keyboard", () => {
    for (const key of ["Delete", "Backspace"]) {
      expect(keyScopeVerdict({ entry: resolveKeyEntry(ev({ key })), scope: SCOPE.CANVAS }).allow).toBe(true);
    }
  });

  it("Backspace stays a delete key — on a MacBook it is the ONLY one", () => {
    expect(entry("delete").keys).toContain("Backspace");
    expect(entry("delete").keys).toContain("Delete");
  });

  it("every mutating canvas shortcut is refused out of a value row", () => {
    const mutating = KEY_CONTRACT.filter((k) => k.scope === "canvas" && k.mutates);
    expect(mutating.length).toBeGreaterThan(4);
    for (const k of mutating) expect(keyScopeVerdict({ entry: k, scope: SCOPE.CHROME, fieldEdit: true }).allow, k.id).toBe(false);
  });

  it("app-scope keys still work from chrome — Escape must never become unreachable (B1125)", () => {
    for (const id of ["escape", "undo", "redo", "shortcuts"]) {
      expect(keyScopeVerdict({ entry: entry(id), scope: SCOPE.CHROME }).allow, id).toBe(true);
    }
  });

  /* THE LINE IS MUTATION, NOT CANVAS-NESS. The first cut refused every canvas-scope entry from
   * chrome, which killed the tool letters for anyone who had just clicked a toolbar button — no
   * safety gain, real friction. Caught by this repo's own ctrl-z spec, which arms its polygon tool
   * with Shift+P straight after clicking "Start blank". */
  it("a NON-mutating shortcut still fires from chrome — arming a tool loses nothing", () => {
    for (const id of ["tool-select", "tool-mpolygon", "toggle-snap", "copy", "hand-pan"]) {
      expect(keyScopeVerdict({ entry: entry(id), scope: SCOPE.CHROME }).allow, id).toBe(true);
    }
  });

  it("…and the nudge does NOT — it resized the owner's building by a foot from <body>", () => {
    expect(keyScopeVerdict({ entry: resolveKeyEntry(ev({ key: "ArrowUp" })), scope: SCOPE.CHROME, fieldEdit: true }).allow).toBe(false);
  });

  it("a focused text field still swallows EVERYTHING — including the app-scope keys", () => {
    for (const k of KEY_CONTRACT) {
      expect(keyScopeVerdict({ entry: k, scope: SCOPE.FIELD }).allow, k.id).toBe(false);
    }
  });

  it("B746/V258 survives: only undo/redo pass while a range slider has focus", () => {
    for (const k of KEY_CONTRACT) {
      const allowed = keyScopeVerdict({ entry: k, scope: SCOPE.SLIDER }).allow;
      expect(allowed, k.id).toBe(k.id === "undo" || k.id === "redo");
    }
  });

  it("an UNDECLARED key falls through untouched — the table guards, it does not gate", () => {
    expect(keyScopeVerdict({ entry: resolveKeyEntry(ev({ key: "F5" })), scope: SCOPE.CHROME }).allow).toBe(true);
  });
});

describe("resolveKeyEntry — the modified form of a letter beats the bare one", () => {
  it("⌘V is paste, a bare V is the Select tool", () => {
    expect(resolveKeyEntry(ev({ key: "v", metaKey: true })).id).toBe("paste");
    expect(resolveKeyEntry(ev({ key: "v" })).id).toBe("tool-select");
  });
  it("Shift falls back to the unmodified table — Shift+Arrow is still a nudge", () => {
    expect(resolveKeyEntry(ev({ key: "ArrowUp", shiftKey: true })).id).toBe("nudge");
    expect(resolveKeyEntry(ev({ key: "p", shiftKey: true })).id).toBe("tool-mpolygon");
  });
  it("code-matched entries resolve (Shift rewrites ] and some layouts kill Alt+Z)", () => {
    expect(resolveKeyEntry(ev({ key: "]", code: "BracketRight", ctrlKey: true })).id).toBe("arrange");
    expect(resolveKeyEntry(ev({ key: "†", code: "KeyZ", altKey: true })).id).toBe("autosize-text");
    expect(resolveKeyEntry(ev({ key: " ", code: "Space" })).id).toBe("hand-pan");
  });
});

describe("the refusal is LOUD, and once per episode", () => {
  const base = { entry: KEY_CONTRACT.find((k) => k.id === "delete"), reason: REFUSAL.CHROME, hasSelection: true, episode: 3, lastHintedEpisode: null };
  it("a refused Delete with a live selection explains itself", () => expect(shouldHintRefusal(base)).toBe(true));
  it("…once per episode, not once per keystroke", () => expect(shouldHintRefusal({ ...base, lastHintedEpisode: 3 })).toBe(false));
  it("…and again on the NEXT episode", () => expect(shouldHintRefusal({ ...base, episode: 4, lastHintedEpisode: 3 })).toBe(true));
  it("nothing selected → nothing was lost → stay quiet", () => expect(shouldHintRefusal({ ...base, hasSelection: false })).toBe(false));
  it("a refused TOOL letter stays quiet — it changes nothing", () => {
    expect(shouldHintRefusal({ ...base, entry: KEY_CONTRACT.find((k) => k.id === "tool-select") })).toBe(false);
  });
  it("every refusal reason has words", () => {
    for (const r of Object.values(REFUSAL)) expect(String(SCOPE_GUARD_HINT[r] || "").length).toBeGreaterThan(10);
  });
});

describe("SOURCE SWEEP — the real handler may not branch on an undeclared key", () => {
  const declaredKeys = new Set(KEY_CONTRACT.flatMap((k) => k.keys || []));
  const declaredCodes = new Set(KEY_CONTRACT.flatMap((k) => k.codes || []));

  it("every `e.key === \"…\"` in the planner handler is declared", () => {
    const body = plannerKeyHandlerSource();
    const keys = [...body.matchAll(/e\.key\s*===\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length, "the sweep found no key branches — it is reading the wrong slice").toBeGreaterThan(20);
    const undeclared = [...new Set(keys)].filter((k) => !declaredKeys.has(k));
    expect(undeclared, `undeclared key branches — add them to KEY_CONTRACT with a scope: ${undeclared.join(", ")}`).toEqual([]);
  });

  it("every `e.code === \"…\"` in the planner handler is declared", () => {
    const body = plannerKeyHandlerSource();
    const codes = [...body.matchAll(/e\.code\s*===\s*"([^"]+)"/g)].map((m) => m[1]);
    const undeclared = [...new Set(codes)].filter((c) => !declaredCodes.has(c));
    expect(undeclared, `undeclared code branches: ${undeclared.join(", ")}`).toEqual([]);
  });

  it("the `startsWith(\"Arrow\")` idiom is covered by the nudge entry", () => {
    const body = plannerKeyHandlerSource();
    if (/e\.key\.startsWith\("Arrow"\)/.test(body)) {
      for (const a of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) expect(declaredKeys.has(a)).toBe(true);
    }
  });

  it("the handler consults the contract BEFORE any branch runs", () => {
    const body = plannerKeyHandlerSource();
    const gate = body.indexOf("keyScopeVerdict");
    const firstBranch = body.search(/if \(\(e\.ctrlKey \|\| e\.metaKey\)/);
    expect(gate, "the scope gate is gone from the handler").toBeGreaterThan(0);
    expect(gate, "the scope gate must run before the first shortcut branch").toBeLessThan(firstBranch);
  });

  it("every canvas-scope entry declares whether it mutates — a silent refusal is the old bug", () => {
    for (const k of KEY_CONTRACT) expect(typeof k.mutates, k.id).toBe("boolean");
  });

  it("Doc Review scopes its destructive keys too — the same defect lived there", () => {
    const dr = src("../src/workspaces/doc-review/DocReview.jsx");
    expect(dr).toMatch(/touchLatch\(touchFactsOf/);
    expect(dr, "Review must refuse Delete/Backspace out of a value row").toMatch(/e\.key === "Delete" \|\| e\.key === "Backspace"\) && canvasTouchRef\.current === TOUCH\.FIELD/);
  });

  it("the value-row marker in the components matches the one the latch reads", () => {
    const sp = src("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(FIELD_GROUP_ATTR).toBe("data-field-group");
    // The <Field> row (label + input + steppers) and NumInput's own stepper wrapper.
    expect((sp.match(/data-field-group="1"/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("NumInput's Enter commits IN PLACE — the blur() that started this is gone", () => {
    const s = src("../src/workspaces/site-planner/SitePlanner.jsx");
    const i = s.indexOf("function NumInput(");
    expect(i).toBeGreaterThan(0);
    /* Slice to the NEXT top-level declaration rather than a fixed byte count — a character budget
     * silently stops covering the thing it guards the moment the function grows, which is exactly
     * what happened when the invalid-value state landed below this handler. */
    const after = s.indexOf("\nfunction ", i + 10);
    const body = s.slice(i, after > i ? after : i + 12000);
    expect(body, "Enter must not blur the field — that is what put focus on <body>")
      .not.toMatch(/e\.key === "Enter"\)\s*e\.currentTarget\.blur\(\)/);
    expect(body).toMatch(/e\.key === "Enter" \|\| e\.key === "Escape"/);
  });
});
