/* A NEW LINE CONTINUES THE ONE ABOVE IT — the decision (NEW-ENTER-INHERIT).
 *
 * ⛔ HIS REPORT: *"it doesn't seem like when I start a new line, it carries the formatting (at
 * least the text size of what's directly above it)."*
 *
 * ⛔ THIS FILE GUARDS THE HALF THAT DECIDES WHETHER TO CLAIM THE PRESS, which is where the risk
 * is. Enter is the most contested key in the editor: the list keymap owns it, the code block owns
 * it, and Enter on an EMPTY list item means *leave the list* — which the owner named explicitly
 * as a thing not to break. A rule that claimed too much would have to re-implement everything it
 * displaced, so every clause here is a DECLINE and each one is asserted separately.
 *
 * The behavioural half is `ui-audit/audit-notes-enter-inherit.mjs`, which drives real keys and
 * reads the stored document. Neither half is sufficient alone.
 */
import { describe, expect, it } from "vitest";

import { enterShouldInherit, inheritedAttrs } from "../src/workspaces/notes/lib/notesEnterInherit.js";

const AT_END = { empty: true, parentType: "paragraph", parentSize: 16, parentOffset: 16, isTextblock: true };

describe("when Enter carries formatting across", () => {
  /* ⛔ THE MEASURED CASE. Before the fix: block fontSize 22 → null, run fontSize 22px → null,
   * marks bold+textStyle → none, colour → null. */
  it("⛔ claims a collapsed caret at the END of a non-empty textblock — the reported case", () => {
    expect(enterShouldInherit(AT_END)).toBe(true);
  });

  it("…and does so for a heading too, which carries the same attributes", () => {
    expect(enterShouldInherit({ ...AT_END, parentType: "heading" })).toBe(true);
  });
});

describe("⛔ and every case it must DECLINE, one clause at a time", () => {
  /* ⛔ THE EXCEPTION HE NAMED. Enter on an empty list item leaves the list; there is also
   * nothing to inherit from an empty line, so declining costs nothing and protects it. */
  it("⛔ an EMPTY block — that is the leave-the-list case", () => {
    expect(enterShouldInherit({ ...AT_END, parentSize: 0, parentOffset: 0 })).toBe(false);
  });

  /* A split anywhere but the end already keeps the original node's attributes — ProseMirror only
   * reaches for a DEFAULT block when the caret is `atEnd`, which is why the bug looked
   * intermittent: middle and start splits were always fine. */
  it("a caret in the MIDDLE — that split already keeps the attributes", () => {
    expect(enterShouldInherit({ ...AT_END, parentOffset: 8 })).toBe(false);
  });

  it("a caret at the START — likewise", () => {
    expect(enterShouldInherit({ ...AT_END, parentOffset: 0 })).toBe(false);
  });

  it("a RANGE selection — a range split keeps the attributes already", () => {
    expect(enterShouldInherit({ ...AT_END, empty: false })).toBe(false);
  });

  it("⛔ a CODE BLOCK — its Enter is a newline and belongs to it", () => {
    expect(enterShouldInherit({ ...AT_END, parentType: "codeBlock" })).toBe(false);
  });

  it("anything that is not a textblock at all", () => {
    expect(enterShouldInherit({ ...AT_END, isTextblock: false })).toBe(false);
  });

  it("and it is safe with no argument, which is what a binding gets before mount", () => {
    expect(enterShouldInherit()).toBe(false);
    expect(enterShouldInherit({})).toBe(false);
  });
});

describe("what a new line inherits", () => {
  it("every attribute the line above carried", () => {
    const attrs = { fontSize: 22, lineHeight: 1.5, textAlign: "right", spaceBefore: 8 };
    expect(inheritedAttrs(attrs)).toEqual(attrs);
  });

  /* ⛔ A COPY, NOT THE SAME OBJECT. Handing ProseMirror the node's own attrs object invites an
   * in-place mutation later that would edit the block the split came FROM. */
  it("⛔ as a COPY — never the node's own object", () => {
    const attrs = { fontSize: 22 };
    expect(inheritedAttrs(attrs)).not.toBe(attrs);
  });

  it("and an absent set is an empty one rather than a crash", () => {
    expect(inheritedAttrs(null)).toEqual({});
    expect(inheritedAttrs(undefined)).toEqual({});
  });
});
