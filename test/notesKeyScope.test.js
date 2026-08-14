/* WHILE THERE IS A CARET IN EDITABLE TEXT, EVERY GLOBAL BINDING IN NOTES IS INERT (NEW-ARROWS).
 *
 * ⛔ THE OWNER ASKED FOR THIS SHAPE BY NAME, and the shape is the point: *"Regression guard, since
 * this is the second time a global key binding has leaked: a test that asserts every key the
 * module binds globally is INERT when the caret is in editable text. Not one test per key — the
 * property, so the next binding someone adds is covered by construction."*
 *
 * So this file does NOT enumerate keys. It asserts two things:
 *   1. the pure DECISION is right, including the two states measured in a real browser; and
 *   2. every global `keydown` listener in the module ROUTES THROUGH it — a source sweep, so a
 *      binding added tomorrow either uses the predicate or fails the build.
 *
 * ⛔ WHY A SOURCE SWEEP RATHER THAN A BEHAVIOURAL ONE FOR PART 2. A behavioural test can only
 * check the bindings that exist when it is written, which is exactly how the first leak (Escape,
 * handled twice) and this one (the arrows) both shipped: each was correct for every key anybody
 * had thought to drive. The failure mode is a NEW binding, and only a rule about the code can see
 * one of those. The behavioural half exists too and is `ui-audit/audit-notes-arrows.mjs`, which
 * drives real keys in every context; neither half is sufficient alone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { caretOwnsTheKey, readCaretScope, FIELD_SELECTOR } from "../src/workspaces/notes/lib/notesKeyScope.js";

const NOTES = join(process.cwd(), "src/workspaces/notes");

describe("the decision: who owns a keypress", () => {
  /* ⛔ THE TWO STATES, MEASURED IN A REAL BROWSER and pinned here as the cases that matter. If
   * either row's expectation is ever flipped, the bug it describes is back. */
  it("⛔ a caret in the document owns the key — the state that was leaking", () => {
    // measured: activeElement DIV.tiptap, isContentEditable true, caret inside the doc
    expect(caretOwnsTheKey({ activeEditable: true, caretInEditable: true })).toBe(true);
  });

  it("⛔ …and a selected box with NO caret does not — the state the binding exists for", () => {
    // measured: after a real click on a box the press is preventDefault'ed, so focus is on <body>
    expect(caretOwnsTheKey({ activeEditable: false, caretInEditable: false })).toBe(false);
  });

  it("either fact alone is enough — a caret that outlives focus still owns the key", () => {
    expect(caretOwnsTheKey({ activeEditable: true, caretInEditable: false })).toBe(true);
    expect(caretOwnsTheKey({ activeEditable: false, caretInEditable: true })).toBe(true);
  });

  it("and it is safe with no argument at all, which is what a listener gets before mount", () => {
    expect(caretOwnsTheKey()).toBe(false);
    expect(caretOwnsTheKey({})).toBe(false);
  });

  it("a plain form field is still named explicitly — it is not `isContentEditable`", () => {
    expect(FIELD_SELECTOR).toContain("input");
    expect(FIELD_SELECTOR).toContain("textarea");
    expect(FIELD_SELECTOR).toContain("select");
  });

  it("reading with no document answers 'nobody is typing' rather than throwing", () => {
    expect(readCaretScope(null)).toEqual({ activeEditable: false, caretInEditable: false });
  });

  /* A hand-rolled document double — enough of the shape to exercise the reader without jsdom. */
  const fakeDoc = ({ editable = false, field = null, caretEditable = false }) => ({
    activeElement: {
      isContentEditable: editable,
      closest: (sel) => (field && sel === FIELD_SELECTOR ? { tagName: field } : null),
    },
    getSelection: () => (caretEditable
      ? { anchorNode: { nodeType: 1, isContentEditable: true, closest: () => ({}) } }
      : { anchorNode: null }),
  });

  it("reads a contenteditable document as the caret's", () => {
    expect(readCaretScope(fakeDoc({ editable: true }))).toEqual({ activeEditable: true, caretInEditable: false });
  });

  it("reads a focused INPUT as the caret's too — the case the old binding did get right", () => {
    expect(readCaretScope(fakeDoc({ field: "INPUT" })).activeEditable).toBe(true);
  });

  it("reads a bare body with no selection as nobody's", () => {
    expect(readCaretScope(fakeDoc({}))).toEqual({ activeEditable: false, caretInEditable: false });
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * THE PROPERTY — every global keydown binding routes through the predicate.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("⛔ THE PROPERTY: every global keydown binding in Notes declines to the caret", () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { walk(join(dir, e.name)); continue; }
      if (/\.(jsx?|mjs)$/.test(e.name)) files.push(join(dir, e.name));
    }
  };
  walk(NOTES);

  /** A global binding is one attached to `window` or `document` — anything attached to an
   *  ELEMENT is scoped by the DOM already and is not this rule's business. */
  const GLOBAL_BIND = /(window|document)\.addEventListener\(\s*["']keydown["']/g;

  /* ⛔ THE EXEMPTIONS, EACH NAMED WITH ITS REASON — a blanket allowance would make the rule
   * decorative. A binding earns a place here only by being unable to steal a key from a person
   * who is typing, and the reason has to survive being read aloud. */
  const EXEMPT = new Map([
    // A menu/popover that is only MOUNTED while it is open, and answers Escape alone. Escape
    // while typing is meant to close it — that IS the caret's expectation, not a theft.
    ["components/NoteToolbar.jsx", "mounted only while a popover is open; answers Escape only"],
    ["components/NotesTree.jsx", "the row menu is mounted only while open; answers Escape only"],
    // The quick-open palette IS a text field of its own while open, and it re-implements nothing:
    // it explicitly lets Enter and the arrows through to whatever has focus.
    ["Notes.jsx", "the Ctrl+K palette is itself the thing being typed into while it is open"],
  ]);

  const rel = (f) => f.slice(NOTES.length + 1);

  it("every file that binds keydown globally either uses the predicate or is exempt WITH a reason", () => {
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const binds = [...src.matchAll(GLOBAL_BIND)];
      if (!binds.length) continue;
      const r = rel(f);
      if (EXEMPT.has(r)) continue;
      if (!/keysBelongToTheCaret\s*\(/.test(src)) {
        offenders.push(`${r} binds keydown on window/document but never asks keysBelongToTheCaret()`);
      }
    }
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("⛔ the predicate's own module is the ONLY place the rule is spelled out", () => {
    // A second hand-rolled copy of "is the user typing?" is how the rule drifts. If this fails,
    // fold the new copy into lib/notesKeyScope.js rather than adding an exemption.
    const copies = files.filter((f) => {
      const r = rel(f);
      if (r === "lib/notesKeyScope.js") return false;
      const src = readFileSync(f, "utf8");
      return /closest\(\s*["']input, textarea, select["']\s*\)/.test(src);
    });
    expect(copies.map(rel)).toEqual([]);
  });

  it("every exemption names a file that still exists and still binds globally", () => {
    for (const [r, reason] of EXEMPT) {
      const f = join(NOTES, r);
      const src = readFileSync(f, "utf8");
      expect(src.match(GLOBAL_BIND), `${r} no longer binds keydown globally — drop its exemption`).toBeTruthy();
      expect(reason.length, `${r}'s exemption has no reason`).toBeGreaterThan(20);
    }
  });

  it("the leaking binding is fixed at its own site — NoteEditor asks before nudging", () => {
    const src = readFileSync(join(NOTES, "components/NoteEditor.jsx"), "utf8");
    expect(src).toMatch(/if \(keysBelongToTheCaret\(\)\) return;/);
  });
});
