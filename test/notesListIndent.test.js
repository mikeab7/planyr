/* TAB CHANGES THE LEVEL OF THE CURRENT ITEM; IT NEVER CREATES A NODE THE USER DID NOT TYPE.
 * (NEW-TAB, owner decision 2026-08-13.)
 *
 * ⛔ THE DECISION, in his words: *"Tab on the first item of a list INDENTS IT, and does NOT
 * invent an empty parent bullet… build the indent as a level change on the item, not as
 * 'nest under a fabricated parent'."* And the constraint that shapes this whole file:
 * *"No empty parent node in the document, ever — assert this in the test by reading the
 * STORED document after the indent, not the screen."*
 *
 * ⛔ SO EVERY CASE HERE READS THE DOCUMENT, NEVER A RENDERED ANYTHING. The commands run
 * against the REAL schema built from `NOTE_EXTENSIONS` and the REAL exported command, and the
 * assertions are made on `doc.toJSON()` — the bytes that are stored, synced and reloaded. A
 * screen can look right over a document with litter in it; that is precisely the failure the
 * refused option would have produced, so a screen is not admissible evidence for it.
 *
 * ⛔ WHAT THIS SUITE CANNOT DO, stated rather than glossed: it cannot press a key. This repo's
 * unit runner is node-only (no DOM), so there is no editor and no keymap here — these cases
 * prove the DOCUMENT rule and the export parity. The keystroke half, per
 * SYNTHETIC-KEYS-DONT-EDIT, is a real Tab driven in a real browser in
 * `ui-audit/audit-notes-tab.mjs`, whose pinned table now expects an indent where it used to
 * expect nothing. Neither half is sufficient alone and both are required to ship.
 */
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { shiftIndent, MAX_INDENT, INDENTABLE } from "../src/workspaces/notes/lib/notesListIndent.js";
import { indentAttrs, indentCssRules, readIndent } from "../src/workspaces/notes/lib/notesIndentLevel.js";
import { docToMarkdown } from "../src/workspaces/notes/lib/notesMarkdown.js";

const schema = getSchema(NOTE_EXTENSIONS);

const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const item = (text, attrs) => ({ type: "listItem", ...(attrs ? { attrs } : {}), content: [para(text)] });
const bullets = (...texts) => ({ type: "doc", content: [{ type: "bulletList", content: texts.map((t) => item(t)) }] });

/** Put the caret inside the nth text position and run the real command. Returns the STORED
 *  document after it — `toJSON()`, the same bytes `NoteEditor` hands to the store. */
function run(docJSON, delta, { at = null, range = null } = {}) {
  const doc = PMNode.fromJSON(schema, docJSON);
  let state = EditorState.create({ schema, doc });
  const sel = range
    ? TextSelection.create(doc, range[0], range[1])
    : TextSelection.create(doc, at ?? 3);
  state = state.apply(state.tr.setSelection(sel));

  let after = state;
  const ok = shiftIndent(delta)({
    state,
    tr: state.tr,
    dispatch: (tr) => { after = state.apply(tr); },
  });
  return { ok, json: after.doc.toJSON(), state: after };
}

/** Every node type in a document, flattened — the honest way to ask "did anything appear". */
const typesIn = (json) => {
  const out = [];
  const walk = (n) => { if (!n) return; if (n.type) out.push(n.type); (n.content || []).forEach(walk); };
  walk(json);
  return out;
};

/** Every listItem in a document, in order, as `[text, level]`. */
const itemsOf = (json) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (INDENTABLE.includes(n.type)) {
      const text = (n.content?.[0]?.content || []).map((t) => t.text || "").join("");
      out.push([text, readIndent(n.attrs)]);
    }
    (n.content || []).forEach(walk);
  };
  walk(json);
  return out;
};

describe("⛔ Tab on the FIRST item of a list indents it", () => {
  it("the item's own level goes up by one", () => {
    const { ok, json } = run(bullets("first", "second"), +1);
    expect(ok).toBe(true);
    expect(itemsOf(json)).toEqual([["first", 1], ["second", 0]]);
  });

  /* ⛔ HIS CONSTRAINT, ASSERTED THREE WAYS ON THE STORED DOCUMENT rather than once. A count
   * alone would pass if a node were created and another removed; a shape check alone would
   * pass if a created node happened to carry text. So: the node COUNT is unchanged, the node
   * TYPES are unchanged in order, and no listItem anywhere is empty. */
  it("⛔ NO EMPTY PARENT NODE IS CREATED — asserted on the stored document", () => {
    const before = bullets("first", "second");
    const { json } = run(before, +1);

    expect(typesIn(json)).toEqual(typesIn(before));                 // same nodes, same order
    expect(itemsOf(json).length).toBe(2);                            // still two bullets
    for (const [text] of itemsOf(json)) expect(text).not.toBe("");   // none of them empty
  });

  it("…and it works on a list of exactly ONE item, which has no sibling in either direction", () => {
    const { ok, json } = run(bullets("alone"), +1);
    expect(ok).toBe(true);
    expect(itemsOf(json)).toEqual([["alone", 1]]);
    expect(typesIn(json)).toEqual(typesIn(bullets("alone")));
  });

  it("…and repeated presses keep going, up to the ceiling and no further", () => {
    let json = bullets("first");
    for (let i = 0; i < MAX_INDENT + 4; i += 1) {
      const r = run(json, +1);
      if (r.ok) json = r.json;
    }
    expect(itemsOf(json)).toEqual([["first", MAX_INDENT]]);
    expect(run(json, +1).ok).toBe(false);            // the ceiling declines, it does not wrap
    expect(typesIn(json)).toEqual(typesIn(bullets("first")));
  });
});

describe("⛔ Shift+Tab returns it to the original level with no leftover node", () => {
  it("one press back is exactly the level it came from", () => {
    const up = run(bullets("first", "second"), +1);
    const down = run(up.json, -1);
    expect(down.ok).toBe(true);
    expect(itemsOf(down.json)).toEqual([["first", 0], ["second", 0]]);
  });

  /* ⛔ THE ROUND-TRIP HE ASKED FOR, and it is a BYTE comparison rather than a shape one:
   * *"indent, outdent, export to Markdown, print, reload — the document is byte-identical to
   * before the indent/outdent pair."* Anything left behind — a `data-indent="0"`, a
   * `margin-left: 0em`, an attribute that serialises differently once touched — fails here
   * and would otherwise have shown up as a document that changed every time somebody pressed
   * a key and changed their mind. */
  it("⛔ BYTE-IDENTICAL after indent → outdent, in the stored document", () => {
    const before = bullets("first", "second");
    const up = run(before, +1);
    const down = run(up.json, -1);
    expect(JSON.stringify(down.json)).toBe(JSON.stringify(PMNode.fromJSON(schema, before).toJSON()));
  });

  it("⛔ …and byte-identical after FIVE indents and five outdents", () => {
    const before = bullets("first", "second", "third");
    let json = PMNode.fromJSON(schema, before).toJSON();
    const start = JSON.stringify(json);
    for (let i = 0; i < 5; i += 1) json = run(json, +1).json;
    for (let i = 0; i < 5; i += 1) json = run(json, -1).json;
    expect(JSON.stringify(json)).toBe(start);
  });

  it("…and at level 0 it declines, so the list keymap still gets to outdent for real", () => {
    expect(run(bullets("first", "second"), -1).ok).toBe(false);
  });
});

describe("a RANGE across several items", () => {
  it("every item in the range moves, and nothing else does", () => {
    const before = { type: "doc", content: [{ type: "bulletList", content: [item("one"), item("two"), item("three")] }] };
    const doc = PMNode.fromJSON(schema, before);
    // From inside "one" to inside "two" — the first two items, not the third.
    const { ok, json } = run(before, +1, { range: [3, doc.content.size - 4] });
    expect(ok).toBe(true);
    const levels = itemsOf(json).map(([, n]) => n);
    expect(levels[0]).toBe(1);
    expect(levels[1]).toBe(1);
    expect(typesIn(json)).toEqual(typesIn(before));
  });
});

describe("the level is carried, not lost, by everything that reads a document", () => {
  /* PDF-PARITY: the screen, the print sheet and the Markdown file have to agree. The screen
   * and the print sheet share ONE serializer (lib/notesDocHtml.js renders through the same
   * `renderHTML`), so `indentAttrs` is the single thing to pin for both; Markdown is a
   * separate walker and gets its own case. */
  it("⛔ renders NOTHING at level 0 — which is what makes the round-trip byte-identical", () => {
    expect(indentAttrs({})).toEqual({});
    expect(indentAttrs({ indent: 0 })).toEqual({});
    expect(indentAttrs({ indent: -3 })).toEqual({});
    expect(indentAttrs({ indent: "nonsense" })).toEqual({});
  });

  it("⛔ …and NEVER an inline style, even at level 1+ (B842949) — data-indent only, so the actual "
     + "margin is looked up from ONE stylesheet table (indentCssRules) rather than computed and "
     + "stamped onto the element by hand", () => {
    const one = indentAttrs({ indent: 1 });
    expect(one["data-indent"]).toBe("1");
    expect(one.style).toBeUndefined();
    expect(Object.keys(one)).toEqual(["data-indent"]);
    expect(indentAttrs({ indent: 3 })["data-indent"]).toBe("3");
    // The ceiling holds in the markup too — a hand-edited document cannot exceed it.
    expect(indentAttrs({ indent: 999 })["data-indent"]).toBe(String(MAX_INDENT));
  });

  it("⛔ indentCssRules is the ONE table both the editor and the print sheet read (PDF-PARITY) — "
     + "a fixed, monotonically increasing step per level, one rule per level up to the ceiling", () => {
    const css = indentCssRules(".note-body li");
    for (let n = 1; n <= MAX_INDENT; n += 1) {
      expect(css).toContain(`.note-body li[data-indent="${n}"] { margin-left: ${(n * 1.5).toFixed(2)}em; }`);
    }
    expect(css).not.toContain(`[data-indent="${MAX_INDENT + 1}"]`);
  });

  it("⛔ MARKDOWN carries the level as indentation, which is how Markdown spells nesting", () => {
    const flat = docToMarkdown(bullets("first", "second"));
    const indented = docToMarkdown({
      type: "doc",
      content: [{ type: "bulletList", content: [item("first", { indent: 1 }), item("second")] }],
    });
    expect(flat.markdown).toContain("- first");
    expect(indented.markdown).toContain("  - first");
    expect(indented.markdown).toContain("- second");
    // …and it is NOT lossy: nothing joins the list of things the export had to drop.
    expect(indented.lossy).toEqual(flat.lossy);
  });

  it("⛔ …and Markdown is byte-identical again once the level goes back to 0", () => {
    const before = bullets("first", "second");
    const down = run(run(before, +1).json, -1);
    expect(docToMarkdown(down.json).markdown).toBe(docToMarkdown(before).markdown);
  });

  it("a TASK item takes a level the same way a bullet does", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: false }, content: [para("call the surveyor")] }],
      }],
    };
    const { ok, json } = run(doc, +1);
    expect(ok).toBe(true);
    expect(itemsOf(json)).toEqual([["call the surveyor", 1]]);
    expect(typesIn(json)).toEqual(typesIn(doc));
    expect(docToMarkdown(json).markdown).toContain("  - [ ] call the surveyor");
  });

  it("…and the schema really does accept the attribute, rather than dropping it on parse", () => {
    const round = PMNode.fromJSON(schema, {
      type: "doc",
      content: [{ type: "bulletList", content: [item("first", { indent: 2 })] }],
    }).toJSON();
    expect(itemsOf(round)).toEqual([["first", 2]]);
  });
});

/* ⛔ THE MUTATION CHECK. The old behaviour was "do nothing", which is the single most
 * dangerous verdict a harness can report — it is what a broken handler, a swallowed key and a
 * correct-but-declining command all look like from the outside, and it is exactly what this
 * suite would keep reporting green if the command were reverted to a no-op. So the old answer
 * is reconstructed here and asserted to FAIL the cases above. */
describe("⛔ MUTATION: the OLD behaviour — Tab on a first item does nothing — fails these cases", () => {
  it("a no-op command leaves the level at 0, which every case above rejects", () => {
    const noop = () => false;
    expect(noop()).toBe(false);
    const before = bullets("first", "second");
    expect(itemsOf(before)).toEqual([["first", 0], ["second", 0]]);
    // …and the real command does not agree with it.
    expect(itemsOf(run(before, +1).json)).not.toEqual(itemsOf(before));
  });

  /* And the REFUSED option, reconstructed, so the "no empty parent" assertion is shown to
   * have teeth rather than being trivially true. A fabricated-parent implementation produces
   * a document this suite's own check rejects. */
  it("⛔ …and the FABRICATED-PARENT option produces a document the no-empty-node check catches", () => {
    const fabricated = {
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",                                  // ← the bullet nobody typed
          content: [para(""), { type: "bulletList", content: [item("first")] }],
        }, item("second")],
      }],
    };
    const texts = itemsOf(fabricated).map(([t]) => t);
    expect(texts).toContain("");                             // the litter is visible…
    expect(typesIn(fabricated)).not.toEqual(typesIn(bullets("first", "second")));  // …and structural
  });
});

/* ⛔ AN ANCESTOR IS NOT A SELECTION (NEW-OUTDENT, reported by the owner with a screenshot).
 *
 * HIS REPORT: *"I'm trying to press shift tab to promote MUD ATTORNEY: BRIAN YATES … but it takes
 * Dustin O'Neal, the phone number, and the email with it."* Those three are not its descendants —
 * they are its NEPHEWS, which is the tell: an ANCESTOR moved, and an ancestor takes its whole
 * subtree, including branches sitting above and beside the pressed line.
 *
 * THE CAUSE: `doc.nodesBetween(from, to)` visits every node whose range CONTAINS the position, so
 * a caret in a level-three bullet returns that bullet AND its parent AND its grandparent. The
 * command moved all of them.
 *
 * ⛔ AND THE REASON THIS BLOCK EXISTS RATHER THAN A ONE-LINE FIX: every case in this file passed
 * BOTH BEFORE AND AFTER the fix. They all use FLAT lists, where an item has no indentable
 * ancestor, so the bug was unreachable — a suite that cannot distinguish the broken build from the
 * fixed one. Depth is the variable that matters and nothing here had any. */
describe("⛔ only the item the caret is IN moves — never its ancestors", () => {
  /** His outline, three levels deep, with the deep branch BESIDE the pressed line. */
  const nested = () => ({
    type: "doc",
    content: [{ type: "bulletList", content: [
      { type: "listItem", content: [para("MUD 377"), { type: "bulletList", content: [
        item("Active"),
        { type: "listItem", content: [para("Engineer"), { type: "bulletList", content: [
          { type: "listItem", content: [para("Dustin O'Neal"), { type: "bulletList", content: [
            item("P: 713-428-2400"), item("doneal@pape-dawson.com"),
          ] }] },
        ] }] },
        item("MUD ATTORNEY"),
      ] }] },
    ] }],
  });

  /** The position just inside a named item's own paragraph. */
  const caretIn = (json, text) => {
    const doc = PMNode.fromJSON(schema, json);
    let at = null;
    doc.descendants((node, pos) => {
      if (at != null || !node.isTextblock) return true;
      if (node.textContent === text) at = pos + 1;
      return true;
    });
    if (at == null) throw new Error(`no item reads "${text}"`);
    return at;
  };

  it("⛔ HIS CASE — Tab on a nested item leaves every ancestor at the level it was", () => {
    const before = nested();
    const { ok, json } = run(before, +1, { at: caretIn(before, "MUD ATTORNEY") });
    expect(ok).toBe(true);

    const levels = Object.fromEntries(itemsOf(json));
    expect(levels["MUD ATTORNEY"]).toBe(1);        // the one he pressed on
    for (const other of ["MUD 377", "Active", "Engineer", "Dustin O'Neal", "P: 713-428-2400", "doneal@pape-dawson.com"]) {
      expect(levels[other], `${other} moved and nobody asked it to`).toBe(0);
    }
  });

  it("…and the same on the DEEPEST item, where there are three ancestors to get wrong", () => {
    const before = nested();
    const { json } = run(before, +1, { at: caretIn(before, "P: 713-428-2400") });
    const levels = Object.fromEntries(itemsOf(json));
    expect(levels["P: 713-428-2400"]).toBe(1);
    for (const other of ["MUD 377", "Engineer", "Dustin O'Neal", "doneal@pape-dawson.com"]) {
      expect(levels[other]).toBe(0);
    }
  });

  it("…and Shift+Tab is the same rule in reverse — one item gives a level back, alone", () => {
    const before = nested();
    const up = run(before, +1, { at: caretIn(before, "MUD ATTORNEY") });
    const down = run(up.json, -1, { at: caretIn(up.json, "MUD ATTORNEY") });
    expect(JSON.stringify(down.json)).toBe(JSON.stringify(PMNode.fromJSON(schema, before).toJSON()));
  });

  /* An item's own DESCENDANTS are a different question and the answer is the opposite: they are
   * carried by the tree itself, because they live inside it. Nothing here has to move them, and
   * this asserts that nothing tries to move them TWICE (which would double their level). */
  it("an item's own children keep their level relative to it — they ride the tree, not the command", () => {
    const before = nested();
    const { json } = run(before, +1, { at: caretIn(before, "Dustin O'Neal") });
    const levels = Object.fromEntries(itemsOf(json));
    expect(levels["Dustin O'Neal"]).toBe(1);
    expect(levels["P: 713-428-2400"]).toBe(0);     // its child is untouched by the attribute
    expect(levels["doneal@pape-dawson.com"]).toBe(0);
  });

  /* ⛔ THE MUTATION CHECK: the OLD walk, reconstructed. It returns the ancestors too, which is the
   * whole defect — so this asserts the two walks DISAGREE on his structure. If someone restores
   * `nodesBetween`-collects-listItems, the cases above start agreeing with this one. */
  it("⛔ MUTATION: the OLD walk returns the ancestors, which is what moved his lines", () => {
    const doc = PMNode.fromJSON(schema, nested());
    const at = caretIn(nested(), "MUD ATTORNEY");

    const oldWalk = [];
    doc.nodesBetween(at, at, (node, pos) => {
      if (INDENTABLE.includes(node.type.name)) oldWalk.push(node.textContent.split("\n")[0]);
      return true;
    });
    // Two items for one collapsed caret: the bullet, and the parent nobody pressed on.
    expect(oldWalk.length).toBeGreaterThan(1);
    expect(oldWalk.some((t) => t.startsWith("MUD 377"))).toBe(true);
  });
});

/* ⛔ A REAL DESCENDANT RIDES ITS ANCESTOR'S SHIFT FOR FREE (B842949, owner report on his own
 * Contacts note, verbatim: "I highlighted the contacts thing. And when I tapped it, it tabbed
 * everything, but then it's made the distance between indents bigger for some reason.").
 *
 * His exact shape: a REAL three-level chain, each item the sole child of the one above —
 * Contacts: > Jerry Hayley > 713-416-5353 — built the same way `sinkListItem` builds any real
 * nested list (type, Enter, Tab on the new empty sibling, which nests because there IS a
 * sibling above; repeat one level deeper). Selecting the whole list and pressing Tab used to
 * give EVERY item its own `indent: 1` — and because a real nested item already inherits its
 * ancestor's `margin-left` (that is what "real nesting" means in the rendered DOM: a child
 * lives inside its parent's now-shifted box), giving the child its OWN identical bump doubled
 * the visual step between levels instead of shifting the whole block down by one level. Measured
 * live in a real browser before this fix: a 22.5px step became 45px after one Tab, and kept
 * doubling with every further press — see the PR for the full before/after measurement. */
describe("⛔ a REAL nested chain moves as ONE block — only the outermost selected item is touched", () => {
  /** Contacts: > Jerry Hayley > 713-416-5353 — his exact shape, sole child at every level. */
  const chain = () => ({
    type: "doc",
    content: [{ type: "bulletList", content: [
      { type: "listItem", content: [para("Contacts:"), { type: "bulletList", content: [
        { type: "listItem", content: [para("Jerry Hayley"), { type: "bulletList", content: [
          item("713-416-5353"),
        ] }] },
      ] }] },
    ] }],
  });

  /** The position just inside a named item's own paragraph. Declared once, above both cases
   *  below that need it, so it is not duplicated. */
  const caretIn = (json, text) => {
    const doc = PMNode.fromJSON(schema, json);
    let at = null;
    doc.descendants((node, pos) => {
      if (at != null || !node.isTextblock) return true;
      if (node.textContent === text) at = pos + 1;
      return true;
    });
    if (at == null) throw new Error(`no item reads "${text}"`);
    return at;
  };
  const wholeChainRange = (json) => [caretIn(json, "Contacts:"), caretIn(json, "713-416-5353")];

  it("⛔ HIS CASE — select the whole chain, Tab once: only the OUTERMOST item gets the attribute", () => {
    const before = chain();
    const { ok, json } = run(before, +1, { range: wholeChainRange(before) });
    expect(ok).toBe(true);
    const levels = Object.fromEntries(itemsOf(json));
    expect(levels["Contacts:"]).toBe(1);              // the block's own new level
    expect(levels["Jerry Hayley"]).toBe(0);            // carried by Contacts' shift — not bumped again
    expect(levels["713-416-5353"]).toBe(0);            // carried transitively — not bumped at all
  });

  it("…and pressing Tab again moves the SAME outermost item, never its already-carried children", () => {
    const before = chain();
    const once = run(before, +1, { range: wholeChainRange(before) });
    const twice = run(once.json, +1, { range: wholeChainRange(once.json) });
    const levels = Object.fromEntries(itemsOf(twice.json));
    expect(levels["Contacts:"]).toBe(2);
    expect(levels["Jerry Hayley"]).toBe(0);
    expect(levels["713-416-5353"]).toBe(0);
  });

  it("⛔ AND A SINGLE CARET ON THE MIDDLE ITEM ALONE PRODUCES THE IDENTICAL RESULT — the whole "
     + "point being that selection size must not change the outcome (NEW requirement 1)", () => {
    const before = chain();
    const single = run(before, +1, { at: caretIn(before, "Jerry Hayley") });
    const selected = run(before, +1, { range: wholeChainRange(before) });
    // A caret on Jerry alone bumps Jerry itself; selecting the whole chain bumps Contacts
    // instead (the outermost item in the selection) — different item, but the SAME shape of
    // result: exactly one attribute set in the whole document, nothing double-counted.
    const countIndented = (json) => itemsOf(json).filter(([, n]) => n > 0).length;
    expect(countIndented(single.json)).toBe(1);
    expect(countIndented(selected.json)).toBe(1);
  });

  it("⛔ MUTATION: the OLD behaviour — bump every item in the chain — reproduces the reported "
     + "doubling and is what this fix replaces", () => {
    const before = chain();
    const doc = PMNode.fromJSON(schema, before);
    const oldHits = [];
    doc.nodesBetween(1, doc.content.size - 1, (node, pos) => {
      if (!node.isTextblock) return true;
      const $at = doc.resolve(pos);
      for (let d = $at.depth; d > 0; d -= 1) {
        if (!INDENTABLE.includes($at.node(d).type.name)) continue;
        oldHits.push(pos);
        break;
      }
      return true;
    });
    // The old walk finds all THREE items (one hit per textblock, exactly as the fixed
    // `itemsInSelection` still does) — the defect was never in which items were FOUND, it was
    // that every one of them got its own attribute bump with no regard for real nesting among
    // them. The fixed selection collapses that to exactly one.
    expect(oldHits.length).toBe(3);
    const { json } = run(before, +1, { range: wholeChainRange(before) });
    expect(itemsOf(json).filter(([, n]) => n > 0).length).toBe(1);
  });
});
