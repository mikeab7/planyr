/* Cursor convention — NOTES slice (B2426784, owner convention 2026-10-20, docs/DESIGN.md "Cursor convention").
 * Source/structure half. Red-proof on the pre-fix tree: the box body was `grab` over every box, the arrow mode's
 * crosshair lived on the mat alone (every box/sheet child set its own cursor), page-edge and pan drags wrote
 * `document.body.style.cursor` (shadowed by every element that sets its own), Space-held pan had no CSS reader,
 * the find bar's disabled buttons carried an inline pointer, the redline's <summary> said default, and the table
 * column-resize class had no rule. The runtime half (computed cursor at named points, signed in on the deployed
 * build) is ui-audit/verify-cursors-notes.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(p, "utf8");
const editor = read("src/workspaces/notes/components/NoteEditor.jsx");
const anchor = read("src/workspaces/notes/lib/notesAnchorNode.js");
const redline = read("src/workspaces/notes/components/NoteRedline.jsx");
const tree = read("src/workspaces/notes/components/NotesTree.jsx");
const slash = read("src/workspaces/notes/components/NoteSlashMenu.jsx");
const history = read("src/workspaces/notes/components/NoteHistory.jsx");

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(jsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}
const files = walk("src/workspaces/notes");
/** The EDITOR_CSS template literal, so a rule is asserted where it actually ships. */
const css = editor.slice(editor.indexOf("const EDITOR_CSS"), editor.indexOf("function EditorStyles"));
const rule = (selectorRe) => {
  const m = css.match(new RegExp(`${selectorRe}[^{}]*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};

describe("a box shows the cursor of what a press on it will do", () => {
  it("a box whose body REALLY drags (a member of a multi-selection → data-movable) shows move; a single box's body never promises one", () => {
    expect(css).toMatch(/\.planyr-anchor\[data-movable="1"\][^{}]*\{[^}]*cursor:\s*move/);
    expect(css).not.toMatch(/\.planyr-anchor\[data-selected="1"\][^{}]*\{[^}]*cursor:\s*move/);
    expect(editor).toMatch(/selRef\.current\.size >= 2[^;]*data-movable/);
  });
  it("an UNSELECTED box keeps the open hand, because a drag that starts on its content PANS the page (B2156912) — the cursor must not promise a move", () => {
    expect(css).toMatch(/\.planyr-note \.ProseMirror \.planyr-anchor \{ cursor: grab; \}/);
  });
  it("a SELECTED single box with words shows text (its next press enters it), never the open hand", () => {
    expect(css).toMatch(/\.planyr-anchor\[data-selected="1"\]:not\(\[data-movable="1"\]\):has\(\.planyr-anchor-content p\) \{ cursor: text; \}/);
  });
  it("an EDITING box still shows text over its typed text", () => {
    expect(css).toMatch(/\.planyr-anchor\[data-editing="1"\] \.planyr-anchor-content \{ cursor: text; \}/);
  });
  it("the BORDER band is the move handle and shows move (four arrows) at rest — the striped grip is retired (B2426788)", () => {
    expect(css).toMatch(/\.planyr-anchor-edge \{[^}]*cursor: move;/);
    expect(css).not.toMatch(/\.planyr-anchor-grip/);
  });
});

describe("armed click-to-connect shows crosshair over EVERYTHING it can be clicked on", () => {
  it("the rule reaches the mat's descendants (boxes, sheet), not only the mat", () => {
    expect(css).toMatch(/data-arrow-mode="1"\]\s*\*[^{}]*\{[^}]*cursor:\s*crosshair\s*!important/);
  });
});

describe("Space-held pan reads as a hand before the drag starts", () => {
  it("the data-space-pan attribute has a CSS reader (grab) that reaches descendants", () => {
    expect(css).toMatch(/data-space-pan="1"\][^{}]*\*[^{}]*\{[^}]*cursor:\s*grab/);
  });
});

describe("drags pin their cursor for the whole gesture (pinDragCursor, never a body-style write)", () => {
  it("NoteEditor and the box node view import the ONE shared pin", () => {
    expect(editor).toMatch(/import\s*\{[^}]*pinDragCursor[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/shared\/ui\/controls\.jsx"/);
    expect(anchor).toMatch(/import\s*\{[^}]*pinDragCursor[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/shared\/ui\/controls\.jsx"/);
  });
  it("no drag writes document.body.style.cursor any more (an element's own cursor out-ranks the inherited body one)", () => {
    expect(editor).not.toMatch(/document\.body\.style\.cursor\s*=/);
  });
  it("the page edge grips pin col-resize / row-resize, a pan pins grabbing", () => {
    expect(editor).toMatch(/pinDragCursor\("col-resize"\)/);
    expect(editor).toMatch(/pinDragCursor\("row-resize"\)/);
    expect(editor).toMatch(/pinDragCursor\("grabbing"\)/);
  });
  it("a box body / border / group drag pins move (the striped grip and its grabbing are retired, B2426788); a connect drag pins crosshair; a resize pins its handle's cursor", () => {
    expect(anchor).toMatch(/pinDragCursor\("move"\)/);
    expect(anchor).not.toMatch(/pinDragCursor\("grabbing"\)/);
    expect(anchor).toMatch(/pinDragCursor\("crosshair"\)/);
    expect(anchor).toMatch(/pinDragCursor\(HANDLE_CURSOR\[/);
  });
});

describe("table column resize shows col-resize over the whole zone", () => {
  it("ProseMirror's own resize-cursor class has a rule that out-ranks the box's cursor", () => {
    expect(css).toMatch(/\.ProseMirror\.resize-cursor[^{}]*\{[^}]*cursor:\s*col-resize\s*!important/);
  });
});

describe("disabled controls never carry a pointer (the stylesheet owns disabled; callers must not fight it)", () => {
  it("no file in the module sets not-allowed", () => {
    const bad = files.filter((f) => /cursor:\s*["']?not-allowed/.test(read(f)));
    expect(bad).toEqual([]);
  });
  it("Find & Replace's prev / next / Replace / Replace all give pointer only while enabled", () => {
    const start = editor.indexOf("function FindReplaceBar");
    const end = editor.indexOf("\nfunction ", start + 10);
    const block = editor.slice(start, end < 0 ? undefined : end);
    expect(block).not.toMatch(/fontWeight: 700, cursor: "pointer" \};/);   // the unconditional shared btnStyle
    expect(block).toMatch(/btnFor\(/);
  });
  it("the slim find bar's disabled prev / next derive the cursor from the same `count`", () => {
    expect(editor).toMatch(/note-find-prev"[^>]*disabled=\{!count\}/);
  });
  it("no disabled button in the module hard-codes an unconditional inline pointer on the same element", () => {
    const offenders = [];
    for (const f of files.filter((n) => n.endsWith(".jsx"))) {
      const src = read(f);
      const tags = src.match(/<button\b[\s\S]*?(?:\/>|<\/button>)/g) || [];
      for (const t of tags) {
        const head = t.slice(0, t.indexOf(">", t.indexOf("style=") > 0 ? t.indexOf("style=") : 0) + 1);
        if (!/\bdisabled=\{/.test(head)) continue;
        if (/cursor:\s*"pointer"/.test(head) && !/\?\s*"(?:default|pointer)"|"(?:default|pointer)"\s*:/.test(head)) offenders.push(`${f}: ${head.slice(0, 80).replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("chrome and clickable rows that used to take the wrong cursor", () => {
  it("the redline's collapsible section summary is clickable → pointer", () => {
    expect(redline).toMatch(/<summary style=\{\{[^}]*cursor: "pointer"/);
    expect(redline).not.toMatch(/<summary style=\{\{[^}]*cursor: "default"/);
  });
  it("the slash menu container shows the arrow (it floats inside the mat, which would otherwise hand it the open hand)", () => {
    expect(slash).toMatch(/data-testid="note-slash-menu"[\s\S]{0,800}cursor: "default"/);
  });
  it("the paste-options chip and the mini-toolbar select are pointer / default as appropriate", () => {
    const pStart = editor.indexOf("function PasteOptions");
    expect(editor.slice(pStart, pStart + 900)).toMatch(/cursor: "default"/);
    expect(editor).toMatch(/data-testid="note-menu-size"[\s\S]{0,900}cursor: "pointer"/);
    expect(editor).toMatch(/data-testid="note-doc-menu"[\s\S]{0,2400}cursor: "default"/);
  });
  it("a note-tree drag accepts a drop with an explicit dropEffect (and says none where it refuses)", () => {
    expect(tree).toMatch(/dropEffect\s*=\s*"move"/);
    expect(tree).toMatch(/dropEffect\s*=\s*"none"/);
  });
  it("history's Restore buttons are busy (progress) while the version is being read", () => {
    expect(history).toMatch(/aria-busy=\{busy \? "true" : undefined\}/);
  });
});
