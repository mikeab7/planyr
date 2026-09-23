/* notesFlowMigration — an old page's top-level flow body → ONE box, on read (NEW-1, 2026-09-22). */
import { describe, expect, it } from "vitest";
import { migrateFlowBody, MIGRATED_BOX_WIDTH } from "../src/workspaces/notes/lib/notesFlowMigration.js";

const trailing = { type: "paragraph" };
const heading = { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] };
const list = { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] };
const anchor = (aid, x, y) => ({ type: "noteAnchor", attrs: { aid, x, y, w: 180, h: null }, content: [{ type: "paragraph", content: [{ type: "text", text: aid }] }] });
const sketch = () => ({ type: "noteSketch", attrs: { boxes: [], links: [] } });

describe("migrateFlowBody — a boxes-only document is a no-op", () => {
  it("returns the exact same reference for a document with no flow content", () => {
    const doc = { type: "doc", content: [anchor("a1", 10, 20), trailing] };
    expect(migrateFlowBody(doc)).toBe(doc);
  });

  it("is a no-op for a document that never had real content", () => {
    const doc = { type: "doc", content: [trailing] };
    expect(migrateFlowBody(doc)).toBe(doc);
  });

  it("is a no-op for a document with anchors and sketches only", () => {
    const doc = { type: "doc", content: [anchor("a1", 0, 0), sketch(), trailing] };
    expect(migrateFlowBody(doc)).toBe(doc);
  });

  it("passes through anything unreadable rather than throwing", () => {
    expect(migrateFlowBody(null)).toBe(null);
    expect(migrateFlowBody(undefined)).toBe(undefined);
    expect(migrateFlowBody({ type: "doc" })).toEqual({ type: "doc" });
  });
});

describe("migrateFlowBody — real flow content gets bundled into one box", () => {
  it("wraps a simple flow body into one box at the top-left, full text width", () => {
    const doc = { type: "doc", content: [heading, list, trailing] };
    const out = migrateFlowBody(doc);
    expect(out).not.toBe(doc);
    expect(out.content).toHaveLength(2);
    const [box, tail] = out.content;
    expect(box.type).toBe("noteAnchor");
    expect(box.attrs.x).toBe(0);
    expect(box.attrs.y).toBe(0);
    expect(box.attrs.w).toBe(MIGRATED_BOX_WIDTH);
    expect(box.attrs.h).toBeNull();
    expect(box.attrs.aid).toBeNull();          // ensureNoteAnchorIds backfills this on mount
    expect(box.content).toEqual([heading, list]);
    expect(tail).toEqual({ type: "paragraph" });
  });

  it("keeps existing anchors and sketches exactly where they are, untouched", () => {
    const a1 = anchor("a1", 300, 400);
    const sk = sketch();
    const doc = { type: "doc", content: [heading, a1, sk, trailing] };
    const out = migrateFlowBody(doc);
    // The box is inserted first, then the existing anchor/sketch, same objects, same order.
    expect(out.content[0].type).toBe("noteAnchor");
    expect(out.content[0].content).toEqual([heading]);
    expect(out.content[1]).toBe(a1);
    expect(out.content[2]).toBe(sk);
    expect(out.content[3]).toEqual(trailing);
  });

  it("bundles flow content interspersed BEFORE and AFTER an existing anchor into ONE box", () => {
    const a1 = anchor("a1", 5, 5);
    const doc = { type: "doc", content: [heading, a1, list, trailing] };
    const out = migrateFlowBody(doc);
    expect(out.content).toHaveLength(3);            // one bundled box + the existing anchor + trailing
    expect(out.content[0].content).toEqual([heading, list]);   // doc order preserved
    expect(out.content[1]).toBe(a1);
  });

  it("treats a non-empty paragraph that happens to be last as real content, not filler", () => {
    const real = { type: "paragraph", content: [{ type: "text", text: "hello" }] };
    const doc = { type: "doc", content: [real] };
    const out = migrateFlowBody(doc);
    expect(out.content[0].content).toEqual([real]);
    expect(out.content[1]).toEqual({ type: "paragraph" });     // a fresh trailing filler is supplied
  });

  it("treats an EMPTY paragraph that is not last as real structure, not filler", () => {
    const empty = { type: "paragraph" };
    const doc = { type: "doc", content: [empty, heading, trailing] };
    const out = migrateFlowBody(doc);
    expect(out.content[0].content).toEqual([empty, heading]);
  });

  it("never mints an id — the box's aid stays null for the existing backfill to fill", () => {
    const doc = { type: "doc", content: [heading, trailing] };
    expect(migrateFlowBody(doc).content[0].attrs.aid).toBeNull();
  });
});
