/* notesBoxClipboard — NEW-1 (2026-11-15): a BOX copy is a box, a TEXT copy never carries one. */
import { describe, it, expect } from "vitest";
import { Schema, Slice, Fragment } from "@tiptap/pm/model";
import {
  BOX_ATTR, PASTE_STEP, carriesBoxCopy, decodeBoxPayload, encodeBoxPayload, boxesForCopy, planBoxPaste, nextRepeat, mediaRefs, remapMedia, unwrapCopiedSlice,
} from "../src/workspaces/notes/lib/notesBoxClipboard.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    noteAnchor: { group: "block", content: "block+", attrs: { aid: { default: null }, x: { default: 0 }, y: { default: 0 } }, toDOM: () => ["div", 0] },
    text: { group: "inline" },
  },
});
const p = (t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null);
const A = (aid, x, y, ...kids) => schema.nodes.noteAnchor.create({ aid, x, y }, kids);
const box = (aid, x, y, w = 400, t = "hello") => ({ type: "noteAnchor", attrs: { aid, x, y, w, h: null, fit: false }, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

describe("unwrapCopiedSlice — a text copy never carries the box (the measured defect: data-pm-slice named noteAnchor + x/y)", () => {
  it("a partial copy inside a box: the box level comes off, the open depth with it", () => {
    const slice = new Slice(Fragment.from(A("a", 40, 100, p("Alpha line"))), 2, 2);
    const out = unwrapCopiedSlice(slice);
    expect(out.content.childCount).toBe(1);
    expect(out.content.firstChild.type.name).toBe("paragraph");
    expect(out.openStart).toBe(1); expect(out.openEnd).toBe(1);
    expect(out.content.textBetween(0, out.content.size)).toBe("Alpha line");
  });
  it("select-all (several whole boxes): every frame goes, every word stays, in order", () => {
    const slice = new Slice(Fragment.from([A("a", 40, 100, p("one")), A("b", 40, 300, p("two"), p("three")), p("")]), 0, 0);
    const out = unwrapCopiedSlice(slice);
    const names = []; out.content.forEach((n) => names.push(n.type.name));
    expect(names).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"]);
    expect(out.content.textBetween(0, out.content.size, "|")).toBe("one|two|three|");
  });
  it("a slice with no box is returned untouched (same object)", () => {
    const slice = new Slice(Fragment.from(p("plain")), 1, 1);
    expect(unwrapCopiedSlice(slice)).toBe(slice);
  });
  it("only the open end of a multi-block partial copy loses a level", () => {
    const slice = new Slice(Fragment.from(A("a", 1, 1, p("first"), p("second"))), 2, 2);
    const out = unwrapCopiedSlice(slice);
    expect(out.openStart).toBe(1); expect(out.openEnd).toBe(1);
    expect(out.content.childCount).toBe(2);
  });
});

describe("the box payload on the clipboard", () => {
  const boxes = [box("a", 40, 100), box("b", 40, 300, 360, "two")];
  const html = (p) => `<meta charset='utf-8'><p data-pm-slice="0 0 []" ${BOX_ATTR}="${p}">hello</p>`;
  it("round-trips every box exactly", () => {
    const enc = encodeBoxPayload({ token: "t1", pageId: "p1", boxes });
    expect(enc).not.toMatch(/["<>&]/);                       // safe inside a double-quoted attribute
    const got = decodeBoxPayload(html(enc));
    expect(got.token).toBe("t1"); expect(got.pageId).toBe("p1");
    expect(got.boxes).toEqual(boxes);
    expect(carriesBoxCopy(html(enc))).toBe(true);
  });
  it("clipboard html with no marker is not a box copy", () => {
    expect(decodeBoxPayload("<p data-pm-slice=\"1 1 []\">text</p>")).toBeNull();
    expect(carriesBoxCopy("<p>text</p>")).toBe(false);
    expect(carriesBoxCopy("")).toBe(false);
  });
  it("a payload that cannot be read is reported, never silently swallowed", () => {
    expect(decodeBoxPayload(html("%7Bnot-json"))).toEqual({ error: "unreadable" });
    expect(decodeBoxPayload(html(encodeURIComponent(JSON.stringify({ v: 9, boxes: [] }))))).toEqual({ error: "unreadable" });
    expect(decodeBoxPayload(html(encodeURIComponent(JSON.stringify({ v: 1, boxes: [] }))))).toEqual({ error: "empty" });
    expect(carriesBoxCopy(html("%7Bnot-json"))).toBe(false);
  });
  it("a box nested inside a box on the clipboard is flattened (a box is only ever top level)", () => {
    const nested = { ...box("o", 1, 1), content: [box("i", 5, 5, 100, "inner")] };
    const got = decodeBoxPayload(html(encodeURIComponent(JSON.stringify({ v: 1, token: "x", pageId: null, boxes: [nested] }))));
    expect(JSON.stringify(got.boxes)).not.toMatch(/noteAnchor.*noteAnchor/);
  });
  it("boxesForCopy takes the named boxes, in document order, frame and all", () => {
    const doc = schema.nodes.doc.create(null, [A("a", 40, 100, p("one")), A("b", 40, 300, p("two")), p("")]);
    const got = boxesForCopy(doc, new Set(["b", "a"]));
    expect(got.map((b) => b.attrs.aid)).toEqual(["a", "b"]);
    expect(got[0].attrs.x).toBe(40);
  });
});

describe("planBoxPaste — fresh ids, and where the copy lands", () => {
  const boxes = [box("a", 40, 100), box("b", 100, 220)];
  it("same page, nothing armed: offset down-right from the source, a step further each repeat", () => {
    const one = planBoxPaste({ boxes, samePage: true, repeat: 0 });
    expect(one.map((b) => [b.attrs.x, b.attrs.y])).toEqual([[40 + PASTE_STEP, 100 + PASTE_STEP], [100 + PASTE_STEP, 220 + PASTE_STEP]]);
    const two = planBoxPaste({ boxes, samePage: true, repeat: 1 });
    expect(two[0].attrs.x).toBe(40 + 2 * PASTE_STEP);
  });
  it("another page: in place the first time, then stepping", () => {
    expect(planBoxPaste({ boxes, samePage: false, repeat: 0 }).map((b) => [b.attrs.x, b.attrs.y])).toEqual([[40, 100], [100, 220]]);
    expect(planBoxPaste({ boxes, samePage: false, repeat: 1 })[0].attrs.x).toBe(40 + PASTE_STEP);
  });
  it("an armed point: the group's top-left lands on it and the arrangement is kept", () => {
    const got = planBoxPaste({ boxes, samePage: true, repeat: 0, armed: { x: 500, y: 400 } });
    expect(got.map((b) => [b.attrs.x, b.attrs.y])).toEqual([[500, 400], [560, 520]]);
  });
  it("new ids every time, width / height / fit / content untouched, source object not mutated", () => {
    const got = planBoxPaste({ boxes, samePage: true, repeat: 0 });
    expect(new Set(got.map((b) => b.attrs.aid)).size).toBe(2);
    expect(got.some((b) => ["a", "b"].includes(b.attrs.aid))).toBe(false);
    expect(got[0].attrs.w).toBe(400); expect(got[0].attrs.fit).toBe(false); expect(got[0].content).toEqual(boxes[0].content);
    expect(boxes[0].attrs.aid).toBe("a"); expect(boxes[0].attrs.x).toBe(40);
  });
  it("nextRepeat counts per copy and per page", () => {
    expect(nextRepeat("tok", "p1")).toBe(0); expect(nextRepeat("tok", "p1")).toBe(1);
    expect(nextRepeat("tok", "p2")).toBe(0); expect(nextRepeat("other", "p1")).toBe(0);
  });
});

describe("pictures and attachments follow the box to another page", () => {
  const withMedia = { type: "noteAnchor", attrs: { aid: "m", x: 1, y: 1, w: 100, h: 80 }, content: [
    { type: "noteImage", attrs: { imageId: "img1", mime: "image/png", w: 10, h: 5 } },
    { type: "noteAttachment", attrs: { fileId: "f1", name: "x.pdf", mime: "application/pdf" } }] };
  it("lists every media id with what the re-keyed copy needs", () => {
    expect(mediaRefs([withMedia])).toEqual([{ kind: "image", id: "img1", mime: "image/png", w: 10, h: 5 }, { kind: "file", id: "f1", name: "x.pdf", mime: "application/pdf" }]);
    expect(mediaRefs([box("a", 0, 0)])).toEqual([]);
  });
  it("remaps ids and leaves everything else alone", () => {
    const out = remapMedia([withMedia], new Map([["img1", "img9"], ["f1", "f9"]]));
    expect(out[0].content[0].attrs.imageId).toBe("img9"); expect(out[0].content[1].attrs.fileId).toBe("f9");
    expect(out[0].attrs).toEqual(withMedia.attrs);
    expect(withMedia.content[0].attrs.imageId).toBe("img1");
    const same = [box("a", 0, 0)]; expect(remapMedia(same, new Map())).toBe(same);
  });
});
