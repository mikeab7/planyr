/* notesFlowMigration — an old page's top-level flow body → ONE box, on read (NEW-1, 2026-09-22),
 * and a retired sketch's boxes+links → real noteAnchor boxes + document arrows (NEW-2). */
import { describe, expect, it } from "vitest";
import {
  migrateFlowBody, migrateSketchesToBoxes, MIGRATED_BOX_WIDTH,
} from "../src/workspaces/notes/lib/notesFlowMigration.js";

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

describe("migrateSketchesToBoxes — a retired sketch's boxes+links → real anchors + arrows", () => {
  const sketchAttrs = (extra) => ({
    boxes: [
      { id: "s1", label: "Acquisition", x: 20, y: 20 },
      { id: "s2", label: "Title", body: "Order the commitment.", x: 260, y: 20 },
    ],
    links: [{ from: "s1", to: "s2" }],
    ...extra,
  });

  it("a document with no sketch is a no-op, same reference", () => {
    const doc = { type: "doc", content: [anchor("a1", 0, 0), trailing] };
    expect(migrateSketchesToBoxes(doc)).toBe(doc);
  });

  it("passes through anything unreadable rather than throwing", () => {
    expect(migrateSketchesToBoxes(null)).toBe(null);
    expect(migrateSketchesToBoxes(undefined)).toBe(undefined);
  });

  it("converts each sketch box into a real noteAnchor, same label/body as a paragraph", () => {
    const doc = { type: "doc", content: [{ type: "noteSketch", attrs: sketchAttrs() }, trailing] };
    const out = migrateSketchesToBoxes(doc);
    expect(out).not.toBe(doc);
    const boxes = out.content.filter((n) => n.type === "noteAnchor");
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.attrs.aid).sort()).toEqual(["mig_s1", "mig_s2"]);
    const titleBox = boxes.find((b) => b.attrs.aid === "mig_s2");
    const text = titleBox.content[0].content.map((n) => n.text).join("\n");
    expect(text).toContain("Title");
    expect(text).toContain("Order the commitment.");
  });

  it("the noteSketch node itself is gone from the output", () => {
    const doc = { type: "doc", content: [{ type: "noteSketch", attrs: sketchAttrs() }, trailing] };
    const out = migrateSketchesToBoxes(doc);
    expect(out.content.some((n) => n.type === "noteSketch")).toBe(false);
  });

  it("a sketch link becomes a document-level arrow on the SAME converted ids", () => {
    const doc = { type: "doc", content: [{ type: "noteSketch", attrs: sketchAttrs() }, trailing] };
    const out = migrateSketchesToBoxes(doc);
    expect(out.attrs.arrows).toEqual([{ from: "mig_s1", to: "mig_s2" }]);
  });

  it("existing document-level arrows are kept and the converted ones are appended", () => {
    const doc = {
      type: "doc",
      attrs: { arrows: [{ from: "existing1", to: "existing2" }] },
      content: [{ type: "noteSketch", attrs: sketchAttrs() }, trailing],
    };
    const out = migrateSketchesToBoxes(doc);
    expect(out.attrs.arrows).toContainEqual({ from: "existing1", to: "existing2" });
    expect(out.attrs.arrows).toContainEqual({ from: "mig_s1", to: "mig_s2" });
    expect(out.attrs.arrows).toHaveLength(2);
  });

  it("converted boxes are placed clear of a flow-migration box's own column", () => {
    const doc = { type: "doc", content: [{ type: "noteSketch", attrs: sketchAttrs() }, trailing] };
    const out = migrateSketchesToBoxes(doc);
    for (const b of out.content.filter((n) => n.type === "noteAnchor")) {
      expect(b.attrs.x).toBeGreaterThanOrEqual(MIGRATED_BOX_WIDTH);
    }
  });

  it("multiple sketches stack vertically, never overlapping", () => {
    const s1 = { type: "noteSketch", attrs: sketchAttrs() };
    const s2 = { type: "noteSketch", attrs: sketchAttrs({ boxes: [{ id: "t1", label: "Second sketch", x: 0, y: 0 }], links: [] }) };
    const doc = { type: "doc", content: [s1, s2, trailing] };
    const out = migrateSketchesToBoxes(doc);
    const firstGroupBottom = Math.max(...out.content.filter((n) => n.attrs?.aid?.startsWith("mig_s")).map((n) => n.attrs.y));
    const secondBox = out.content.find((n) => n.attrs?.aid === "mig_t1");
    expect(secondBox.attrs.y).toBeGreaterThan(firstGroupBottom);
  });

  it("existing non-sketch content (anchors, trailing filler) is left exactly where it is", () => {
    const a1 = anchor("a1", 5, 5);
    const doc = { type: "doc", content: [a1, { type: "noteSketch", attrs: sketchAttrs() }, trailing] };
    const out = migrateSketchesToBoxes(doc);
    expect(out.content[0]).toBe(a1);
    expect(out.content[out.content.length - 1]).toEqual(trailing);
  });

  it("composes with migrateFlowBody in the order NoteEditor.jsx uses: sketches first, then flow", () => {
    const doc = { type: "doc", content: [heading, { type: "noteSketch", attrs: sketchAttrs() }, trailing] };
    const out = migrateFlowBody(migrateSketchesToBoxes(doc));
    // The flow heading bundles into its own box; the two sketch boxes are real anchors too;
    // nothing throws, and every box is a real noteAnchor by the time the schema ever sees it.
    const anchors = out.content.filter((n) => n.type === "noteAnchor");
    expect(anchors.length).toBeGreaterThanOrEqual(3);
    expect(out.content.some((n) => n.type === "noteSketch")).toBe(false);
    expect(out.attrs.arrows).toContainEqual({ from: "mig_s1", to: "mig_s2" });
  });
});
