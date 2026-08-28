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
  CONTROL_CONSUMES,
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
    expect(focusScope({ tag: "DIV", isContentEditable: true, lastTouchedCanvas: true })).toBe(SCOPE.FIELD);
  });

  /* NEW-1 — a `<select>` is a PICKER, not a text box. It used to answer FIELD, which is what refused
   * the owner's Delete on a selected measurement after he touched the Line style dropdown — and told
   * him it had gone to "the box you're typing in". */
  it("a dropdown is its own scope, and it is NOT a text field", () => {
    expect(focusScope({ tag: "SELECT", lastTouchedCanvas: true })).toBe(SCOPE.PICKER);
    expect(focusScope({ tag: "SELECT", lastTouchedCanvas: false })).toBe(SCOPE.PICKER);
    expect(focusScope({ tag: "SELECT" })).not.toBe(SCOPE.FIELD);
  });

  /* ⛔ NEW-1 — A CHECKBOX (OR RADIO) IS `<INPUT>` LIKE A REAL TEXT BOX AND WAS SCOPED IDENTICALLY,
   * WHICH IS WHAT SWALLOWED ESCAPE (a B1125 recurrence). Reproduced live: the Parcels panel's
   * per-row "Active" checkbox takes focus on an ordinary click; from there `keyScopeVerdict`'s FIELD
   * branch refused EVERY key unconditionally, `escape` included, leaving a user stuck mid-Split or
   * mid-Merge with no way out. A checkbox picks a boolean, exactly like a `<select>` picks from a
   * list — it must not claim the whole keyboard the way a genuine text box does. */
  it("a checkbox/radio/button-type input is NOT a text field — it falls through to the ordinary latch, like a <button>", () => {
    for (const type of ["checkbox", "radio", "button", "submit", "reset", "color", "file", "hidden"]) {
      expect(focusScope({ tag: "INPUT", type, lastTouchedCanvas: false }), type).toBe(SCOPE.CHROME);
      expect(focusScope({ tag: "INPUT", type, lastTouchedCanvas: true }), type).toBe(SCOPE.CANVAS);
    }
  });

  it("…while a genuine text-like input type still owns the keyboard, exactly as before", () => {
    for (const type of ["text", "number", "email", "search", "tel", "url", "password", "date", undefined]) {
      expect(focusScope({ tag: "INPUT", type, lastTouchedCanvas: true }), String(type)).toBe(SCOPE.FIELD);
    }
  });

  it("the touch latch agrees — clicking a checkbox is a CHROME press, not a typing one", () => {
    const stub = (tag, type) => ({ nodeType: 1, tagName: tag, type, isContentEditable: false, closest: () => null });
    expect(touchFactsOf(stub("INPUT", "checkbox"), null).isTextEntry).toBe(false);
    expect(touchFactsOf(stub("INPUT", "radio"), null).isTextEntry).toBe(false);
    expect(touchFactsOf(stub("INPUT", "text"), null).isTextEntry).toBe(true);
  });

  it("a value row whose only control is a checkbox is not a typing row either", () => {
    const group = (hasText) => ({ tagName: "DIV", querySelector: () => (hasText ? {} : null) });
    const stub = (tag, g, type) => ({ nodeType: 1, tagName: tag, type, isContentEditable: false,
      closest: (sel) => (sel === `[${FIELD_GROUP_ATTR}]` ? g : null) });
    expect(touchFactsOf(stub("INPUT", group(false), "checkbox"), null).inFieldGroup).toBe(false);
  });

  it("Escape — and every app-scope key — reaches the sweep once the checkbox no longer claims FIELD (B1125)", () => {
    const scope = focusScope({ tag: "INPUT", type: "checkbox", lastTouchedCanvas: false });
    expect(scope).toBe(SCOPE.CHROME);
    for (const id of ["escape", "undo", "redo", "shortcuts"]) {
      expect(keyScopeVerdict({ entry: KEY_CONTRACT.find((k) => k.id === id), scope }).allow, id).toBe(true);
    }
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
    /* A row is a TYPING row only if it holds something you can type in — the group stub answers
     * `querySelector` the way a real Depth row would (an input beside its ▲▼ steppers). */
    const group = (hasText) => ({ tagName: "DIV", querySelector: () => (hasText ? {} : null) });
    const stub = (tag, g, type) => ({ nodeType: 1, tagName: tag, type, isContentEditable: false,
      closest: (sel) => (sel === `[${FIELD_GROUP_ATTR}]` ? g : null) });
    expect(touchFactsOf(stub("BUTTON", group(true)), null).inFieldGroup).toBe(true);
    expect(touchFactsOf(stub("BUTTON", null), null).inFieldGroup).toBe(false);
    expect(touchFactsOf(stub("INPUT", null, "text"), null).isTextEntry).toBe(true);
  });

  /* ⛔ NEW-1 — THE LATCH OUTLIVES FOCUS, SO A NON-TYPING ROW LATCHING `FIELD` REFUSED DELETE LONG
   * AFTER THE CONTROL WAS RELEASED. A fill-opacity slider row and a line-style dropdown row are both
   * `[data-field-group]`, and neither has a digit in it. */
  it("a value row holding only a SLIDER or a DROPDOWN is not a typing row", () => {
    const group = (hasText) => ({ tagName: "DIV", querySelector: () => (hasText ? {} : null) });
    const stub = (tag, g, type) => ({ nodeType: 1, tagName: tag, type, isContentEditable: false,
      closest: (sel) => (sel === `[${FIELD_GROUP_ATTR}]` ? g : null) });
    expect(touchFactsOf(stub("INPUT", group(false), "range"), null).inFieldGroup).toBe(false);
    expect(touchFactsOf(stub("INPUT", group(false), "range"), null).isTextEntry).toBe(false);
    expect(touchFactsOf(stub("SELECT", group(false)), null).isTextEntry).toBe(false);
    // …and the row the guard was BUILT for is unchanged.
    expect(touchFactsOf(stub("BUTTON", group(true)), null).inFieldGroup).toBe(true);
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

  it("a focused text field still swallows EVERYTHING — except the one GUARANTEED key", () => {
    for (const k of KEY_CONTRACT) {
      expect(keyScopeVerdict({ entry: k, scope: SCOPE.FIELD }).allow, k.id).toBe(k.id === "escape");
    }
  });

  /* ⛔ NEW-1 — B1125's OWN WORDS, MADE LITERAL. The owner: "escape doesnt work on getting out of
   * this parcel editing tool, and theres no clear way out." Reproduced live: the Parcels panel's
   * checkbox/text controls latch `TOUCH.FIELD`, and that latch OUTLIVES the control's focus by
   * design (B1188) — so a later Escape, with focus long since moved elsewhere, still judged
   * against FIELD and was refused. Escape types no character, so FIELD swallowing it protects
   * nothing. This is deliberately NARROW: undo/redo/shortcuts are also scope:"app" and are NOT
   * exempted — a text box's own native Ctrl+Z must still win while it is genuinely focused. */
  it("⛔ Escape survives FIELD scope — the guaranteed escape hatch, even with the field latch held", () => {
    const escape = KEY_CONTRACT.find((k) => k.id === "escape");
    expect(escape.guaranteed).toBe(true);
    expect(keyScopeVerdict({ entry: escape, scope: SCOPE.FIELD }).allow).toBe(true);
    expect(keyScopeVerdict({ entry: escape, scope: SCOPE.FIELD, fieldEdit: true }).allow).toBe(true);
    for (const id of ["undo", "redo", "shortcuts"]) {
      expect(keyScopeVerdict({ entry: KEY_CONTRACT.find((k) => k.id === id), scope: SCOPE.FIELD }).allow, id).toBe(false);
    }
  });

  it("…and a dropdown's OWN Escape-closes-the-popup consumption is untouched — that case self-resolves, it is not 'stuck'", () => {
    const escape = KEY_CONTRACT.find((k) => k.id === "escape");
    expect(keyScopeVerdict({ entry: escape, scope: SCOPE.PICKER }).allow).toBe(false);
  });

  /* ⛔ NEW-1 — A CONTROL REFUSES ONLY WHAT IT CONSUMES, and B746/V258's undo/redo carve-out is no
   * longer a carve-out: it falls out of the rule, because a range input does not consume ⌘Z either. */
  it("a range slider takes the arrows and NOTHING else", () => {
    for (const k of KEY_CONTRACT) {
      const allowed = keyScopeVerdict({ entry: k, scope: SCOPE.SLIDER }).allow;
      expect(allowed, k.id).toBe(k.id !== "nudge");
    }
    expect(CONTROL_CONSUMES[SCOPE.SLIDER]).toEqual(["nudge"]);
  });

  it("B746/V258 still holds — undo and redo are live on a slider", () => {
    for (const id of ["undo", "redo"]) {
      expect(keyScopeVerdict({ entry: KEY_CONTRACT.find((k) => k.id === id), scope: SCOPE.SLIDER }).allow, id).toBe(true);
    }
  });

  /* THE REPORTED DEFECT, as a property: neither control can use a destructive key, so neither may
   * eat one. This is the assertion that goes red on the build the owner was using. */
  it("⛔ neither a slider nor a dropdown may swallow Delete", () => {
    const del = KEY_CONTRACT.find((k) => k.id === "delete");
    expect(keyScopeVerdict({ entry: del, scope: SCOPE.SLIDER }).allow).toBe(true);
    expect(keyScopeVerdict({ entry: del, scope: SCOPE.PICKER }).allow).toBe(true);
    // …while a real text box still does, which is the whole point of the guard.
    expect(keyScopeVerdict({ entry: del, scope: SCOPE.FIELD }).allow).toBe(false);
  });

  it("a dropdown takes arrows, Enter, Space, Escape and the type-ahead letters", () => {
    const takes = CONTROL_CONSUMES[SCOPE.PICKER];
    for (const id of ["nudge", "commit", "hand-pan", "escape", "tool-select", "tool-pan"]) {
      expect(takes, id).toContain(id);
      expect(keyScopeVerdict({ entry: KEY_CONTRACT.find((k) => k.id === id), scope: SCOPE.PICKER }).allow, id).toBe(false);
    }
    for (const id of ["delete", "copy", "cut", "paste", "duplicate", "undo", "redo"]) {
      expect(keyScopeVerdict({ entry: KEY_CONTRACT.find((k) => k.id === id), scope: SCOPE.PICKER }).allow, id).toBe(true);
    }
  });

  it("every refusal reason has words to say", () => {
    for (const r of Object.values(REFUSAL)) expect(SCOPE_GUARD_HINT[r], r).toBeTruthy();
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
  /* ⛔ NEW-1 — A DESTRUCTIVE KEY IS THE EXCEPTION, and the reason is the owner's own words:
   * "I was pressing delete on it" — plural. The second press was silent, which is the experience of
   * a key that does nothing at all. */
  it("a refused DELETE explains itself on every press, not once per episode", () =>
    expect(shouldHintRefusal({ ...base, lastHintedEpisode: 3 })).toBe(true));
  it("…while a non-destructive mutating key keeps the once-per-episode rule", () =>
    expect(shouldHintRefusal({ ...base, entry: KEY_CONTRACT.find((k) => k.id === "nudge"), lastHintedEpisode: 3 })).toBe(false));
  it("…and again on the NEXT episode", () => expect(shouldHintRefusal({ ...base, episode: 4, lastHintedEpisode: 3 })).toBe(true));
  it("nothing selected → nothing was lost → stay quiet", () => expect(shouldHintRefusal({ ...base, hasSelection: false })).toBe(false));
  it("a refused TOOL letter stays quiet — it changes nothing", () => {
    expect(shouldHintRefusal({ ...base, entry: KEY_CONTRACT.find((k) => k.id === "tool-select") })).toBe(false);
  });
  it("every refusal reason has words", () => {
    for (const r of Object.values(REFUSAL)) expect(String(SCOPE_GUARD_HINT[r] || "").length).toBeGreaterThan(10);
  });
  /* ⛔ NEW-1/B754752 — every hint is a REFUSAL and must render as one. B742371 fixed the toast's
   * color rule (a leading/embedded "⚠" is the only thing that turns it error-red instead of
   * success-green) and audited ~24 call sites, but this table's own messages still had none —
   * so a refused Delete/Backspace flashed the SAME green as a completed action. */
  it("every hint reads as a refusal, not a success", () => {
    for (const r of Object.values(REFUSAL)) expect(SCOPE_GUARD_HINT[r], r).toMatch(/⚠/);
  });
});

describe("⛔ NEW-1/B754752 — a FIELD refusal is never hinted, at any selection/episode", () => {
  /* Reproduced live: select a building, open Properties, click into a dimension field, press
   * Ctrl+A then Delete (or Backspace) to clear it before typing a new number. The field correctly
   * swallows the key (verdict.allow === false, reason FIELD) — that part was always right — but
   * `entry.destructive` used to force a hint on EVERY press, because "delete" is destructive and
   * a building was selected. That fires on essentially every keystroke anyone uses to clear a
   * number field, and the hint's own remedy ("click the plan, then press Delete") is a recipe for
   * deleting the very object being edited. */
  const deleteEntry = KEY_CONTRACT.find((k) => k.id === "delete");
  const nudgeEntry = KEY_CONTRACT.find((k) => k.id === "nudge");
  it("never hints on the destructive Delete entry, however the episode/selection line up", () => {
    expect(shouldHintRefusal({ entry: deleteEntry, reason: REFUSAL.FIELD, hasSelection: true, episode: 1, lastHintedEpisode: null })).toBe(false);
    expect(shouldHintRefusal({ entry: deleteEntry, reason: REFUSAL.FIELD, hasSelection: true, episode: 5, lastHintedEpisode: 4 })).toBe(false);
    expect(shouldHintRefusal({ entry: deleteEntry, reason: REFUSAL.FIELD, hasSelection: true, episode: 5, lastHintedEpisode: null })).toBe(false);
  });
  it("never hints on Backspace (same entry, same field) either", () => {
    expect(shouldHintRefusal({ entry: deleteEntry, reason: REFUSAL.FIELD, hasSelection: true, episode: 2, lastHintedEpisode: null })).toBe(false);
  });
  it("never hints on a non-destructive mutating entry while typing", () => {
    expect(shouldHintRefusal({ entry: nudgeEntry, reason: REFUSAL.FIELD, hasSelection: true, episode: 1, lastHintedEpisode: null })).toBe(false);
  });
  it("CHROME (the panel, not a text box) is unaffected and still hints", () => {
    expect(shouldHintRefusal({ entry: deleteEntry, reason: REFUSAL.CHROME, hasSelection: true, episode: 1, lastHintedEpisode: null })).toBe(true);
  });
});

describe("⛔ NEW-1 — the Cloud tool ('c') bypassed the field guard; every OTHER bare letter did not", () => {
  /* Michael's report, reproduced live on the deployed build: a callout textarea focused, typing
   * "abc" left the field holding "ab" and armed the Cloud tool in the Draw rail. The discriminating
   * test he ran FIRST — typing l r e t q v m h n p x y z into the same focused field — landed as
   * plain text with no tool changes, which is why the fix belongs in the declaration table rather
   * than in a bespoke "is this an input" check bolted beside the Cloud branch: nine siblings with
   * the identical `!ctrlKey && !metaKey && !shiftKey` guard shape already worked, because each one
   * has a KEY_CONTRACT entry `resolveKeyEntry` can find. "c" had none, so `resolveKeyEntry` returned
   * null and `keyScopeVerdict`'s "an undeclared key is always allowed through" rule (by design, for
   * genuinely unbound keys) let it slip past the guard even in FIELD scope — where every declared
   * entry, mutating or not, is refused outright. */
  it("resolveKeyEntry finds a declared entry for a bare 'c' — it used to return null", () => {
    const entry = resolveKeyEntry(ev({ key: "c" }));
    expect(entry, "the Cloud tool shortcut has no KEY_CONTRACT entry — this is the B-report defect").not.toBeNull();
    expect(entry.id).toBe("tool-mcloud");
    expect(entry.mod).toBe("none");
  });

  it("bare 'c' and 'C' are refused out of a focused field, exactly like every sibling tool letter", () => {
    for (const key of ["c", "C"]) {
      const v = keyScopeVerdict({ entry: resolveKeyEntry(ev({ key })), scope: SCOPE.FIELD });
      expect(v.allow, `${key} must not reach the canvas out of a text field`).toBe(false);
      expect(v.reason).toBe(REFUSAL.FIELD);
    }
  });

  it("the nine siblings from the owner's own discriminating test still resolve and still refuse", () => {
    for (const key of ["l", "r", "e", "t", "q", "v", "m", "h", "s"]) {
      const entry = resolveKeyEntry(ev({ key }));
      expect(entry, key).not.toBeNull();
      expect(keyScopeVerdict({ entry, scope: SCOPE.FIELD }).allow, key).toBe(false);
    }
  });

  it("bare 'c' still arms the Cloud tool normally when the drawing owns the keyboard", () => {
    const entry = resolveKeyEntry(ev({ key: "c" }));
    expect(keyScopeVerdict({ entry, scope: SCOPE.CANVAS }).allow).toBe(true);
  });

  it("⌘/Ctrl+C is still Copy, never Cloud — the modified and bare forms must not collide", () => {
    expect(resolveKeyEntry(ev({ key: "c", metaKey: true })).id).toBe("copy");
    expect(resolveKeyEntry(ev({ key: "c" })).id).toBe("tool-mcloud");
  });

  /* Every bare-letter tool shortcut the handler declares, asserted as a GROUP: this is the
   * "regression test required" the report asked for — a focused field must swallow every one of
   * them, "c" included, and none may reach the canvas. Written as a sweep over KEY_CONTRACT rather
   * than a hand-picked list so a FUTURE bare-letter tool with the same gap fails here too. */
  it("every declared bare-letter (mod:none, single-char) shortcut is refused out of a field", () => {
    const bareLetters = KEY_CONTRACT.filter((k) => k.mod === "none" && (k.keys || []).some((c) => c.length === 1 && /[a-zA-Z]/.test(c)));
    expect(bareLetters.length).toBeGreaterThanOrEqual(10); // v h m s q t l r e c, at minimum
    for (const k of bareLetters) {
      expect(keyScopeVerdict({ entry: k, scope: SCOPE.FIELD }).allow, k.id).toBe(false);
    }
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

/* B548821 — A SECOND KEYBOARD ROUTER LIVING OUTSIDE THIS FILE, and the reason it matters: a
 * component that calls `e.stopPropagation()` unconditionally on `onKeyDown` never lets the event
 * reach the planner's window listener AT ALL, for ANY key — so `keyScope`/`keyContract` never get
 * asked, and the once-per-episode LOUD-FAILURE hint above can never fire for it either. That is a
 * silent, undocumented, per-component keyboard-routing decision, and this repo has exactly one
 * router: shared/keyboard/keyScope.js.
 *
 * Found live in the site-planner workspace: the Parcel Record fields, the "Add by address" and
 * "Set location" search boxes, and — the one that matters most, because it is the single most-used
 * free-text control on the canvas — the callout/text-box editor. Each called stopPropagation() as
 * the FIRST statement in its handler, before checking which key was pressed, so Ctrl+Z/Ctrl+Y (and
 * anything else the component doesn't itself use) could never reach the app's undo while any of
 * them merely HELD focus — including a stretch after the user believed they had moved on. The fix
 * in every case is the same shape: stop only the key(s) the component actually answers itself
 * (Enter to commit, Escape to cancel, Alt+Z to autosize), and let everything else bubble — which is
 * safe precisely because keyScope's FIELD scope already refuses every plan-mutating shortcut while
 * a text control is genuinely focused; nothing here needs a second copy of that rule.
 *
 * This sweep is proven RED against the exact banned shape (a mutation check, not a hope): running it
 * against the pre-fix source (stopPropagation unconditional, before the `if`) must fail. */
describe("no component keydown handler routes around keyScope", () => {
  const BANNED = /onKeyDown=\{[^}]*?=>\s*\{\s*e\.stopPropagation\(\);/;
  const filesToSweep = [
    "../src/workspaces/site-planner/SitePlanner.jsx",
    "../src/workspaces/site-planner/components/ParcelRecordPanel.jsx",
    "../src/workspaces/site-planner/components/SetLocationDialog.jsx",
  ];

  it("no onKeyDown handler stops propagation before looking at the key", () => {
    for (const f of filesToSweep) {
      const s = src(f);
      expect(s, `${f} has an unconditional stopPropagation() ahead of its key check — scope it to the key(s) the handler actually answers, per keyScope's FIELD-scope rule`).not.toMatch(BANNED);
    }
  });

  it("the banned shape is real — the sweep goes red on the pre-fix source it was written against", () => {
    const preFix = 'onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}';
    expect(preFix).toMatch(BANNED);
  });

  it("the callout editor still answers Escape and Alt+Z, just scoped to those keys", () => {
    const s = src("../src/workspaces/site-planner/SitePlanner.jsx");
    const editorStart = s.indexOf("<textarea autoFocus");
    expect(editorStart).toBeGreaterThan(0);
    const body = s.slice(editorStart, editorStart + 2600);
    expect(body).toMatch(/if \(e\.key === "Escape"\) \{ e\.stopPropagation\(\); e\.preventDefault\(\); commitEditCallout\(\); \}/);
    expect(body).toMatch(/e\.altKey && e\.code === "KeyZ"/);
  });
});
