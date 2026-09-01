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
  PICKER: "picker",
  CHROME: "chrome",
  CANVAS: "canvas",
});

/* ⛔ NEW-1 — `<select>` LEFT `TEXT_ENTRY_TAGS`, AND THAT IS A CORRECTION, NOT A LOOSENING.
 *
 * The owner could not delete a selected area measurement. Measured on his own plan: touching the
 * inspector's **Line style dropdown** left focus on a `<select>`, which this list called text entry,
 * so Delete was refused — and TOLD HIM "Delete went to the box you're typing in", about a dropdown
 * he was not typing in. Touching the **Fill opacity slider** refused it too. Neither control does
 * ANYTHING with Delete or Backspace; the keys went nowhere and the object stayed on the drawing.
 *
 * A `<select>` is a PICKER: it consumes arrows, Enter, Space and letters (type-ahead), and nothing
 * else. A range input is a SLIDER: arrows, and nothing else. Only a text box owns the whole
 * keyboard — and that is the one this guard was built for, which is why it is untouched. What each
 * control actually consumes is declared in the planner's `lib/keyContract.js` (`CONTROL_CONSUMES`);
 * a guard may only refuse a key the focused control can really use.
 *
 * ⚠ NOT A REGRESSION FROM B464048, and the record matters because it was the leading suspect:
 * measured against the build BEFORE that work, the slider refused Delete identically. The old guard
 * asked `tagName === "INPUT" || "SELECT" || "TEXTAREA"`, and a range input and a dropdown are both
 * in that list — so this defect is as old as the guard (B746/V258's comment states it outright:
 * "Every OTHER shortcut … still respects the guard while a slider has focus"). The scope model
 * inherited it; it did not introduce it.
 */
export const TEXT_ENTRY_TAGS = Object.freeze(["INPUT", "TEXTAREA"]);

/** Tags that pick from a fixed set rather than accept text. */
export const PICKER_TAGS = Object.freeze(["SELECT"]);

/** Input types that are a CONTROL rather than a text box. */
export const SLIDER_TYPES = Object.freeze(["range"]);

/* ⛔ NEW-1 — AN `<input>` IS NOT TEXT ENTRY MERELY BY TAG NAME. A checkbox or radio (or a bare
 * button/submit/reset/image/file/color/hidden input) is tag `INPUT` exactly like a real text box,
 * so `TEXT_ENTRY_TAGS.includes("INPUT")` answered FIELD for all of them — and `keyScopeVerdict`'s
 * FIELD branch refuses EVERY key unconditionally, `escape` (B1125's declared scope:"app") included.
 *
 * Reproduced live: the Parcels panel's per-row "Active" checkbox takes focus on an ordinary click
 * (native browser behaviour), so a user who ticks it — or any other checkbox in the app — mid-Split
 * or mid-Merge and then presses Escape gets FIELD scope and Escape is silently swallowed. The panel
 * has genuine text fields too (the "Add by address" search box, the Parcel Record fields), and
 * those are untouched: this excludes only the input types that consume no typed character at all.
 *
 * Same shape as the SLIDER/PICKER split above (a `<select>` or a range input is not a text box
 * either) — a checkbox is the third control that "picks" rather than "types," and it gets the same
 * treatment: fall through to the ordinary latch (CHROME/CANVAS), exactly like a focused `<button>`
 * already does. */
export const NON_TEXT_INPUT_TYPES = Object.freeze([
  "checkbox", "radio", "button", "submit", "reset", "image", "file", "color", "hidden",
]);

const isTextInputType = (type) => {
  const t = String(type || "").toLowerCase();
  return !SLIDER_TYPES.includes(t) && !NON_TEXT_INPUT_TYPES.includes(t);
};

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
  if (T === "INPUT" && SLIDER_TYPES.includes(String(type || "").toLowerCase())) return SCOPE.SLIDER;
  if (PICKER_TAGS.includes(T)) return SCOPE.PICKER;
  if (T === "TEXTAREA") return SCOPE.FIELD;
  if (T === "INPUT" && isTextInputType(type)) return SCOPE.FIELD;
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

/* ⛔ NEW-1 (B1012832) — THE ONE PREDICATE ANSWERING "IS THE USER TYPING RIGHT NOW", EXPORTED SO A
 * HANDLER OUTSIDE THE PLANNER CAN ASK IT TOO. Before this it was `isTextControl` — correct, but
 * module-private, so a second window/document keydown handler elsewhere in the app (MapFinder's
 * comp-placement Enter shortcut, for one) had no way to ask this module's own answer and grew its
 * own hand-rolled tag list instead (`INPUT`/`TEXTAREA`/`SELECT`/`BUTTON`/`isContentEditable`) —
 * a second implementation of exactly the question this file exists to answer once. Exported under
 * `isTextControl` (unchanged name, so every existing internal call site is untouched) — the fix is
 * making it PUBLIC, not renaming it. */
export const isTextControl = (el) => !!el && (
  el.isContentEditable
  || (el.tagName === "TEXTAREA")
  || (el.tagName === "INPUT" && isTextInputType(el.type))
);

/* NEW-1 — the same NON_TEXT_INPUT_TYPES exclusion, as a CSS selector, for the field-group scan
 * below (`group.querySelector`) — a checkbox/radio inside a value row must not make the row read
 * as a typing row either. Built once from the one array so the JS check and the selector cannot
 * drift apart. */
const TEXT_INPUT_QUERY = `input:not([type=range])${NON_TEXT_INPUT_TYPES.map((t) => `:not([type=${t}])`).join("")}, textarea, [contenteditable=true]`;

/**
 * Read the DOM facts `touchLatch` needs off a real event target.
 *
 * ⛔ NEW-1 — A FIELD GROUP LATCHES `FIELD` ONLY IF IT CONTAINS SOMETHING YOU CAN TYPE IN.
 *
 * The latch exists because the owner's building died to a Backspace pressed just AFTER working in
 * the Depth box — the state outlives the field's focus, which is the whole insight. But it was keyed
 * on the ROW, and `data-field-group` marks every value row, including rows whose only control is a
 * fill-opacity SLIDER or a line-style DROPDOWN. Touching one of those latched "the user is typing a
 * number" about a control with no digits in it, so Delete stayed refused after focus had moved on.
 *
 * A row is a typing row when it holds a text-entry control. The Depth row does (an `<input>` plus its
 * ▲▼ steppers, which is exactly the case the latch was built for, and it is unchanged). A row holding
 * only a range or only a `<select>` does not.
 */
export function touchFactsOf(node, canvasEl) {
  const el = node && node.nodeType === 1 ? node : null;
  const group = el && typeof el.closest === "function" ? el.closest(`[${FIELD_GROUP_ATTR}]`) : null;
  return {
    insideCanvas: !!(canvasEl && node && (canvasEl === node || (el && canvasEl.contains(el)))),
    isTextEntry: isTextControl(el),
    inFieldGroup: !!(group && (isTextControl(group) || group.querySelector(TEXT_INPUT_QUERY))),
  };
}
