/* keyScope — WHICH SURFACE OWNS THE KEYBOARD RIGHT NOW (NEW-1).
 *
 * ⛔ THE DEFECT THIS EXISTS TO CLOSE, and it destroyed real work on the owner's own plan.
 *
 * He was editing Depth in the ELEMENT · BUILDING inspector on FM 359 / "Concept A", pressed
 * Backspace, and Building 1 was gone — with the eight elements bonded to it (two truck courts, two
 * bump-outs, two sidewalks, two side-parking rows). Verbatim: *"I think I had pressed backspace or
 * something in the text box and ended up deleting my building. That was really weird."*
 *
 * The planner's keydown listener is on `window`, and its guard asked ONE question:
 *
 *     if (document.activeElement is INPUT/SELECT/TEXTAREA/contentEditable) return;
 *
 * That is a guard on the ONE state where the field literally holds focus. It says nothing about
 * the state a user is in for the whole rest of an edit. Measured on his real plan, logged out,
 * eight arms — after each ordinary interaction, ONE keystroke:
 *
 *     after this…                            press      focus    elements  Building 1
 *     Enter commits the Depth field          Backspace  BODY      18→9     ❌ DELETED
 *     Escape leaves the Depth field          Backspace  BODY      18→9     ❌ DELETED
 *     Enter, then an arrow key               ArrowUp    BODY      18→18    ⚠ resized 613→600
 *     Enter, then Delete                     Delete     BODY      18→9     ❌ DELETED
 *     click the ▲ stepper                    Backspace  BUTTON    18→9     ❌ DELETED
 *     Tab out of the Depth field             Backspace  BUTTON    18→9     ❌ DELETED
 *     click the panel background             Backspace  BODY      18→9     ❌ DELETED
 *     nothing (control: field still focused)  Backspace  INPUT    18→18    ok
 *
 * SEVEN OF EIGHT. The control is the only arm the old guard covered. Note the two BUTTON rows in
 * particular: a focused `<button>` is not in the guard's tag list at all, so panel chrome leaked
 * even while it HELD focus — this was never only about blurring to `<body>`.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 * THE KEYBOARD FOLLOWS THE LAST SURFACE YOU TOUCHED. Not where focus happens to have landed —
 * `<body>` is where focus goes when anything is dismissed, and it is not a statement of intent.
 * A press that lands on panel chrome, or a focus that enters it, LATCHES the keyboard to the
 * panel; a press or focus on the drawing latches it back. Between those, `document.activeElement`
 * may be `<body>` a dozen times and the answer does not change.
 *
 * This is the keyboard's half of the B1188 click contract, and it is the same lesson B1366 learned
 * in Notes (*"the keyboard acting on whatever the mouse was near"*) and B291538 learned in the app
 * header (*"the instant a gesture leaves focus on <body>, the next letter he types is read as a
 * command"*). Three modules found it independently; this is the shared answer.
 *
 * ── FOUR SCOPES, NOT TWO ────────────────────────────────────────────────────────────────────────
 *   field   — a text-entry control has focus. Keys are TEXT. (The old guard's one state.)
 *   slider  — an `input[type=range]` has focus. It consumes arrows but has no native undo, so
 *             B746/V258's undo-redo exception lives here as a scope rather than as a special case
 *             threaded through the guard.
 *   chrome  — the panel, the rail, the header: anything that is not the drawing. Shortcuts that
 *             MUTATE the plan are REFUSED here (Delete/Backspace above all, and equally the arrow
 *             nudge, paste, duplicate). Harmless ones are not: arming a tool, toggling snap,
 *             copying, Escape, undo/redo. The line is mutation, not canvas-ness — see
 *             `keyScopeVerdict` in the planner's lib/keyContract.js for why.
 *   canvas  — the drawing owns the keyboard. Every shortcut is live, exactly as before.
 *
 * ⛔ THE SCOPE IS COMPUTED FROM PLAIN FACTS, NEVER FROM A DOM NODE, so the rule is unit-testable
 * without a browser and cannot quietly acquire a second implementation. The caller reads the DOM
 * once and hands over booleans.
 *
 * ⛔ AND `lastTouchedCanvas` IS A LATCH, NOT A CLOCK. There is no time budget here and there must
 * never be one: "did a keystroke arrive soon enough after a blur" is unanswerable, and a harness
 * that measures it measures its own pacing (FOREGROUND-OR-VOID). The latch is a fact about which
 * surface the user last addressed, and it is exact.
 */

export const SCOPE = Object.freeze({
  FIELD: "field",
  SLIDER: "slider",
  CHROME: "chrome",
  CANVAS: "canvas",
});

/** Tags whose focus means "the user is entering text/values into a control". */
export const TEXT_ENTRY_TAGS = Object.freeze(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Which surface owns the keyboard, from facts the caller reads off the DOM once.
 *
 * @param {object} f
 * @param {string|null} f.tag                 `document.activeElement.tagName`, or null
 * @param {string|null} f.type                its `type` attribute (only INPUT has a meaningful one)
 * @param {boolean} f.isContentEditable       its `isContentEditable`
 * @param {boolean} f.insideCanvas            is the focused node the drawing surface, or inside it
 * @param {boolean} f.lastTouchedCanvas       THE LATCH — was the last pointer press / focus move
 *                                            onto the drawing rather than onto chrome
 * @returns {"field"|"slider"|"chrome"|"canvas"}
 */
export function focusScope({ tag, type, isContentEditable, insideCanvas, lastTouchedCanvas } = {}) {
  const T = typeof tag === "string" ? tag.toUpperCase() : tag;
  if (isContentEditable) return SCOPE.FIELD;
  if (T === "INPUT" && String(type || "").toLowerCase() === "range") return SCOPE.SLIDER;
  if (TEXT_ENTRY_TAGS.includes(T)) return SCOPE.FIELD;
  /* A focused node inside the drawing IS the drawing — this is what keeps a future focusable
   * canvas (or a focusable handle inside it) from reading as chrome. */
  if (insideCanvas) return SCOPE.CANVAS;
  /* ⛔ EVERYTHING ELSE IS THE LATCH'S QUESTION, INCLUDING A FOCUSED `<button>`, AND THIS IS THE
   * CORRECTION THAT MATTERS. The first cut of this rule answered CHROME for any focused non-text
   * element outright — reasoning that two of the seven measured leaks had focus on a stepper
   * button, so a focused button must mean chrome. It does not, because FOCUS IS STICKY AND A
   * POINTER PRESS IS NOT: the planner's canvas is not focusable, so pressing the Building tool
   * and then drawing with it leaves `activeElement` on that BUTTON for the whole session. Under
   * the first rule that silently made Delete dead on the canvas — caught by eight of this repo's
   * own delete/undo e2e cases, which is exactly what they are for.
   *
   * The latch is the FRESHER fact and it wins. Both stepper leaks stay closed on it and not on
   * the tag: clicking the ▲ is a press on chrome (latch false), and TABBING to it is a focus move
   * onto chrome (latch false, which is why `focusin` is listened to as well as `pointerdown`).
   * Text entry and a live slider are the two states that outrank the latch, above — because there
   * the key is genuinely the field's, whatever the user last pressed. */
  return lastTouchedCanvas ? SCOPE.CANVAS : SCOPE.CHROME;
}

/** True when the scope means "the user is addressing the drawing". */
export const scopeOwnsCanvas = (scope) => scope === SCOPE.CANVAS;

/* ── THE LATCH HAS THREE VALUES, NOT TWO, AND THE THIRD IS THE WHOLE POINT ──────────────────────
 *
 * A two-valued latch (drawing / not-drawing) refuses too much. Measured against this repo's own
 * delete suite: with it, clicking the Properties panel's ＋ to add dock zones, pressing Escape to
 * close the inspector and then pressing Delete no longer deleted the still-selected building —
 * a legitimate workflow, and not remotely the reported bug.
 *
 * What the reported bug actually is: the user was WORKING IN A VALUE BOX. Every one of the arms
 * that destroyed his building started inside the Depth row — typing in it, committing it with
 * Enter, abandoning it with Escape, nudging it with the ▲, or tabbing off it onto that stepper.
 * `FIELD` is that state, and it OUTLIVES the field's focus, which is exactly what `activeElement`
 * could not express.
 *
 * A `[data-field-group]` ancestor is what makes the row a unit — the label, the input and the two
 * steppers are one thing to a user, and two of the seven leaks were presses on the steppers. It is
 * declared on the control rather than sniffed for, so a new value control opts in visibly.
 */
export const TOUCH = Object.freeze({ CANVAS: "canvas", CHROME: "chrome", FIELD: "field" });

/** The field-group marker. One string, so the writer and the reader cannot drift. */
export const FIELD_GROUP_ATTR = "data-field-group";

/**
 * What the last pointer press / focus move hands the keyboard to. Pure — the caller reads the DOM.
 * @param {{insideCanvas?: boolean, isTextEntry?: boolean, inFieldGroup?: boolean}} f
 */
export function touchLatch({ insideCanvas, isTextEntry, inFieldGroup } = {}) {
  if (insideCanvas) return TOUCH.CANVAS;
  if (isTextEntry || inFieldGroup) return TOUCH.FIELD;
  return TOUCH.CHROME;
}

/** Read the two DOM facts `touchLatch` needs off a real event target. */
export function touchFactsOf(node, canvasEl) {
  const el = node && node.nodeType === 1 ? node : null;
  return {
    insideCanvas: !!(canvasEl && node && (canvasEl === node || (el && canvasEl.contains(el)))),
    isTextEntry: !!(el && (TEXT_ENTRY_TAGS.includes(el.tagName) || el.isContentEditable)),
    inFieldGroup: !!(el && typeof el.closest === "function" && el.closest(`[${FIELD_GROUP_ATTR}]`)),
  };
}
