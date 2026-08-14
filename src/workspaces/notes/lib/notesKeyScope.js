/* notesKeyScope — WHO OWNS A KEYPRESS: THE CARET, OR THE THING THAT IS SELECTED (NEW-ARROWS).
 *
 * ⛔ THE RULE, and it is the whole file: **WHILE THERE IS A LIVE CARET IN EDITABLE TEXT, EVERY
 * GLOBAL BINDING IN THIS MODULE IS INERT.** The keys belong to the writing. A binding that wants
 * a key for something else may only have it when nobody is typing.
 *
 * ⛔ WHY IT IS A SHARED PREDICATE AND NOT AN `if` IN ONE HANDLER — this is the SECOND time a
 * global binding in this module has leaked, and the owner said so: *"Regression guard, since this
 * is the second time a global key binding has leaked: a test that asserts every key the module
 * binds globally is INERT when the caret is in editable text. Not one test per key — the property,
 * so the next binding someone adds is covered by construction."* A rule spelled out once per
 * handler is a rule that the next handler will not have.
 *
 * ⛔ THE LEAK IT CLOSES. The box-nudge binding (B421494) is on the `window`, armed while a box
 * selection exists, and it declined only for `input, textarea, select`. The document is a
 * **contenteditable div**, which is none of those — it was deliberately not excluded, on the
 * argument that clicking into the document clears the box selection on the way. **Measured, and
 * the argument does not hold:** with a box selected and the caret then placed in ordinary flow
 * text, every arrow moved the BOX and left the caret where it was. Reachable in three clicks, and
 * invisible once you have looked away from the selected box — which is exactly the profile of an
 * intermittent input bug.
 *
 * ⛔ THE TWO STATES, MEASURED RATHER THAN ASSUMED, because the fix is only safe if they can be
 * told apart (build 55dcdb5, real mouse, real keys):
 *
 *     one click on a box — the nudge SHOULD work    activeElement BODY      · editable false · caret in doc false
 *     …then a click into flow text — it must NOT    activeElement DIV.tiptap · editable TRUE  · caret in doc TRUE
 *
 * The marquee case that made a window binding necessary in the first place is the FIRST row: the
 * press that starts a band is `preventDefault`ed so no caret moves, which leaves focus on `<body>`.
 * So this predicate keeps that case working — it is not a retreat from the binding, it is the
 * boundary the binding always needed.
 *
 * ⛔ AND IT NEVER CALLS `preventDefault` ON A KEY IT DID NOT HANDLE. Declining here returns the
 * key to the browser untouched, which is what makes an arrow move the caret rather than doing
 * nothing at all. A handler that swallowed the key "safely" would trade one silent failure for
 * another.
 */

/** The PURE decision, taking facts rather than a document, so it is unit-testable with no DOM.
 *
 *  `true` means the caret owns this press and a global binding must decline. */
export function caretOwnsTheKey({ activeEditable = false, caretInEditable = false } = {}) {
  return !!(activeEditable || caretInEditable);
}

/** ⛔ THE FORM-FIELD HALF, kept explicit rather than folded into the above. A plain `<input>`
 *  (the page title, the search box, a rename field) is not `isContentEditable`, so it has to be
 *  named — and it was the ONE case the leaking binding did get right. */
export const FIELD_SELECTOR = "input, textarea, select";

/** Read the facts off a real document. Separated from the decision so the decision can be tested
 *  and the reading can be replaced (a shadow root, a test double) without touching the rule. */
export function readCaretScope(doc = typeof document === "undefined" ? null : document) {
  if (!doc) return { activeEditable: false, caretInEditable: false };
  const active = doc.activeElement;
  const inField = !!(active && active.closest && active.closest(FIELD_SELECTOR));
  const activeEditable = inField || !!(active && active.isContentEditable);

  /* ⛔ A SELECTION IS NOT A CARET UNLESS ITS EDITABLE ALSO HAS FOCUS (B539653).
   *
   * The DOM selection SURVIVES a blur. So after `editor.commands.blur()` — which is exactly what
   * backing out of a box with Escape does — the anchor node is still sitting inside the
   * contenteditable while nobody is typing in it. Reading that as "the caret owns the key" made
   * this predicate answer TRUE forever after, and every global binding stayed dead: the SECOND
   * Escape, the one that deselects the box, did nothing at all.
   *
   * Caught by `verify-notes-box-selection` — six rows across three window sizes — and it is worth
   * naming the shape: the arrow fix this predicate exists for was correct, and it was correct in
   * the two states that were MEASURED. This is the third state, which nobody measured because it
   * only exists for the instant after a blur. */
  let caretInEditable = false;
  const sel = typeof doc.getSelection === "function" ? doc.getSelection() : null;
  const node = sel && sel.anchorNode;
  if (node) {
    const el = node.nodeType === 3 ? node.parentElement : node;
    const host = el && el.closest && (el.isContentEditable ? el : el.closest('[contenteditable="true"]'));
    // …and the focus has to actually be in that host, or this is a leftover range, not a caret.
    caretInEditable = !!(host && active && (host === active || (host.contains && host.contains(active))));
  }
  return { activeEditable, caretInEditable };
}

/** The one call site a global binding should use: `if (keysBelongToTheCaret()) return;`
 *
 *  ⛔ EVERY global `keydown` listener in this module is required to route through this — asserted
 *  as a SOURCE property in `test/notesKeyScope.test.js`, so a binding added tomorrow is covered
 *  without anybody remembering this file exists. */
export function keysBelongToTheCaret(doc) {
  return caretOwnsTheKey(readCaretScope(doc));
}

/* ⛔ ESCAPE IS NOT A KEY THE CARET WANTS, AND GATING IT BROKE A REAL GESTURE (B539653).
 *
 * This predicate exists so a binding cannot STEAL a key the person typing needs — arrows, Delete,
 * Backspace, a character. **Escape is not one of those.** A caret has no use for it, so "someone
 * is typing" is not a reason to withhold it, and withholding it broke the two-stage box gesture:
 * Escape #1 backs out of editing, Escape #2 deselects — but after #1 the editor still HOLDS FOCUS
 * (measured: `activeElement` is the ProseMirror div, `isContentEditable` true, at every step), so
 * the gate declined #2 and the box could never be deselected from the keyboard.
 *
 * ⛔ MEASURED, not reasoned — the first attempt at this fix assumed the blur had landed and only
 * required the focus to be inside the selection's own host. It made no difference, because focus
 * never left. Six rows across three window sizes in `verify-notes-box-selection` said so both
 * times, which is the argument for that harness running on every change here.
 *
 * ⛔ AND IT DOES NOT REOPEN B434418's "HANDLED TWICE": that defect was Escape running in the mat
 * AND the window binding, and the mat's call was deleted then. There is still exactly one
 * handler; this only stops the gate from silencing it. */
export const UNGATED_KEYS = new Set(["Escape"]);

/** The one call a global binding should make with the event in hand. */
export function bindingShouldDecline(event, doc) {
  if (event && UNGATED_KEYS.has(event.key)) return false;
  return keysBelongToTheCaret(doc);
}
