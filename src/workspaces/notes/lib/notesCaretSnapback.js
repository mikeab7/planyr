/* notesCaretSnapback — DID A CLICK IN THE TEXT LEAVE THE CARET SOMEWHERE ELSE? (NEW-3, owner report 2026-11-12 1:43 PM: after pasting an Outlook list, "I click
 * the line above the caret and the caret jumps right back to where it was".)
 *
 * ⛔ WHY THIS EXISTS INSTEAD OF A FIX. The symptom was NOT reproduced: not in a sandbox editor, not on the signed-in test account on planyr.io with a real
 * clipboard and a real Ctrl+V, with the paste-options tab showing, its menu open, opened-then-Escaped, before and after the save + cloud-sync settle, on blank
 * paper and inside a box, on the pasted lines and on blank `1.` lines, and after ArrowUp (ui-audit/verify-notes-click-after-paste-live.mjs — 33 checks green on
 * the pre-fix deploy). The two inferences in the report are ruled out by reading the code and by those runs: the paste-options menu never restores a selection
 * (its only editor hand-back is `closePasteMenu(true)`, and only when focus is INSIDE the menu — it is a no-op for a press in the document), and the pasted
 * blank items are ordinary paragraphs a caret lands in. STANDING RULE #2: an owner-reported symptom is never closed on a null, so it is INSTRUMENTED to capture
 * itself. When a plain click in the page's text ends with the caret in a different block than the one clicked, one `notes-snapback` event is sent with the
 * STRUCTURE around it (node types, list depth, whether a paste offer / menu was up, where focus was) — never a character of the note.
 *
 * PURE: the verdict and the shape of the report. The wiring (mousedown → mouseup → look again) is NoteEditor.jsx's `useCaretSnapbackRecorder`. */

/** The textblock a position sits in: `{ start, end, type, empty }` or null. `doc` is a ProseMirror document. */
export function blockAt(doc, pos) {
  if (!doc || !Number.isFinite(pos) || pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  if (!$pos.parent || !$pos.parent.isTextblock) return null;
  return { start: $pos.start(), end: $pos.end(), type: $pos.parent.type.name, empty: $pos.parent.content.size === 0, depth: $pos.depth };
}

/** Did the caret end up outside the block that was clicked? `clicked` is `blockAt(...)` of the click, `head` the selection head afterwards.
 *  False when the click did not land in a textblock at all (nothing to compare), or the caret is anywhere inside it. */
export function snapbackVerdict(clicked, head) {
  if (!clicked || !Number.isFinite(head)) return false;
  return head < clicked.start || head > clicked.end;
}

/** How many list levels deep a position is (bullet / ordered / task lists), for the report. */
export function listDepthAt(doc, pos) {
  if (!doc || !Number.isFinite(pos) || pos < 0 || pos > doc.content.size) return 0;
  const $pos = doc.resolve(pos);
  let n = 0;
  for (let d = 1; d <= $pos.depth; d += 1) if (/List$/.test($pos.node(d).type.name)) n += 1;
  return n;
}

/** The report: structure only. `ctx` carries the app-side facts (paste offer up? menu expanded? focus where? ms since the paste). Every field is a
 *  number, a boolean or a node-type name — never note text. */
export function snapbackReport({ doc, clicked, clickPos, head, ctx = {} }) {
  const landed = blockAt(doc, head);
  return {
    clicked: clicked ? { type: clicked.type, empty: clicked.empty, listDepth: listDepthAt(doc, clickPos) } : null,
    landed: landed ? { type: landed.type, empty: landed.empty, listDepth: listDepthAt(doc, head) } : null,
    blocksApart: clicked && landed ? Math.round((landed.start - clicked.start) / 1) : null,
    direction: clicked && head < clicked.start ? "above" : "below",
    ...ctx,
  };
}
