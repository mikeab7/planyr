/* A BOX STARTS WIDE AND SHRINKS TO ITS WORDS ON CLICK-OUT — the pure rules and the node's own contract
 * (NEW-2, owner report 2026-10-11). The in-browser half is ui-audit/verify-notes-box-width.mjs. */
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  ANCHOR_FIT_MIN, ANCHOR_START_MAX, ANCHOR_START_MIN, anchorStartPreferred, fitWidthFor, growWidthFor,
} from "../src/workspaces/notes/lib/notesBoxResize.js";
import { placeAnchor } from "../src/workspaces/notes/lib/notesAnchorNode.js";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";

describe("a new box's start width", () => {
  it("is the column's width, capped so a Full-width page does not make a 1100px line", () => {
    expect(anchorStartPreferred(498)).toBe(498);
    expect(anchorStartPreferred(1134)).toBe(ANCHOR_START_MAX);
  });
  it("is the room to the right of the press when that is less, never below the usable floor", () => {
    const at = (x) => placeAnchor({ x, y: 0, width: 498, preferred: anchorStartPreferred(498), minWidth: ANCHOR_START_MIN }).w;
    expect(at(0)).toBe(494);                       // column − edge pad
    expect(at(200)).toBe(294);                     // room to the right
    expect(at(480)).toBe(ANCHOR_START_MIN);        // near the margin: floor, the page grows
  });
});

describe("shrinking on click-out", () => {
  it("shrinks to the content's width plus the box's padding", () => {
    expect(fitWidthFor({ current: 477, natural: 130 })).toBe(130);
    expect(fitWidthFor({ current: 477, natural: 129.2 })).toBe(130);        // rounds UP — never clips a letter
  });
  it("never goes below the small minimum", () => {
    expect(fitWidthFor({ current: 477, natural: 20 })).toBe(ANCHOR_FIT_MIN);
  });
  it("never makes a box bigger or changes one that already fits", () => {
    expect(fitWidthFor({ current: 200, natural: 900 })).toBeNull();          // a wide table / long line stays as is
    expect(fitWidthFor({ current: ANCHOR_FIT_MIN, natural: 20 })).toBeNull();
    expect(fitWidthFor({ current: 0, natural: 50 })).toBeNull();
    expect(fitWidthFor({ current: 300, natural: NaN })).toBeNull();
  });
});

describe("typing past the edge of a shrunk box", () => {
  it("grows it to the start width BEFORE the text would wrap", () => {
    expect(growWidthFor({ current: 130, natural: 160, start: 477 })).toBe(477);
  });
  it("leaves it alone while the text still fits, and when it is already start-wide", () => {
    expect(growWidthFor({ current: 130, natural: 129, start: 477 })).toBeNull();
    expect(growWidthFor({ current: 477, natural: 900, start: 477 })).toBeNull();
  });
});

describe("the `fit` attribute", () => {
  const schema = getSchema(NOTE_EXTENSIONS);
  const doc = (attrs) => PMNode.fromJSON(schema, { type: "doc", content: [
    { type: "noteAnchor", attrs: { aid: "a1", x: 0, y: 0, w: 300, h: null, ...attrs }, content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
    { type: "paragraph" },
  ] });
  it("defaults to OFF for every box written before it existed", () => {
    expect(doc({}).firstChild.attrs.fit).toBe(false);
  });
  it("renders nothing when off (a document with no self-sizing box round-trips byte-identical) and a marker when on", () => {
    const spec = (d) => schema.nodes.noteAnchor.spec.toDOM(d.firstChild);
    const off = JSON.stringify(spec(doc({})));
    const on = JSON.stringify(spec(doc({ fit: true })));
    expect(off).not.toContain("data-anchor-fit");
    expect(on).toContain('"data-anchor-fit":"1"');
  });
});

describe("print / HTML export carries the SETTLED width (PDF-PARITY)", () => {
  /* The print sheet and the HTML export serialise a box through the schema's own `toDOM` (see
   * `renderHTML` in notesAnchorNode.js, which writes left/top/width into the style string), so what is
   * asserted here is exactly what reaches paper. */
  const schema = getSchema(NOTE_EXTENSIONS);
  const style = (w) => {
    const n = PMNode.fromJSON(schema, { type: "doc", content: [
      { type: "noteAnchor", attrs: { aid: "a1", x: 10, y: 20, w, h: null, fit: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
      { type: "paragraph" },
    ] }).firstChild;
    return schema.nodes.noteAnchor.spec.toDOM(n)[1].style;
  };
  it("a shrunk box serialises at its stored width, not the width it started at", () => {
    expect(style(130)).toMatch(/width:\s*130px/);
    expect(style(477)).toMatch(/width:\s*477px/);
    expect(style(130)).not.toMatch(/477/);
  });
});
