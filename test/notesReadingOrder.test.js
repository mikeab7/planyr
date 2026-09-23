/* notesReadingOrder — top-level boxes/sketches, top to bottom then left to right (NEW-1). */
import { describe, expect, it } from "vitest";
import { sortTopLevelForReading } from "../src/workspaces/notes/lib/notesReadingOrder.js";

const box = (aid, x, y) => ({ type: "noteAnchor", attrs: { aid, x, y } });
const sk = (aid, x, y) => ({ type: "noteSketch", attrs: { aid, x, y, boxes: [], links: [] } });

describe("sortTopLevelForReading", () => {
  it("passes through non-arrays and empty content unchanged", () => {
    expect(sortTopLevelForReading(null)).toBe(null);
    expect(sortTopLevelForReading(undefined)).toBe(undefined);
    const empty = [];
    expect(sortTopLevelForReading(empty)).toBe(empty);
  });

  it("a single-box document sorts to the SAME array shape — the migration byte-identity guarantee", () => {
    const content = [box("a1", 40, 400), { type: "paragraph" }];
    const out = sortTopLevelForReading(content);
    expect(out).toEqual(content);
  });

  it("orders boxes top to bottom", () => {
    const b1 = box("bottom", 0, 500);
    const b2 = box("top", 0, 10);
    const out = sortTopLevelForReading([b1, b2]);
    expect(out.map((n) => n.attrs.aid)).toEqual(["top", "bottom"]);
  });

  it("orders left to right when two boxes share a row", () => {
    const right = box("right", 400, 100);
    const left = box("left", 10, 100);
    const out = sortTopLevelForReading([right, left]);
    expect(out.map((n) => n.attrs.aid)).toEqual(["left", "right"]);
  });

  it("keeps a stable tiebreak (original order) when position is identical", () => {
    const a = box("a", 10, 10);
    const b = box("b", 10, 10);
    expect(sortTopLevelForReading([a, b]).map((n) => n.attrs.aid)).toEqual(["a", "b"]);
    expect(sortTopLevelForReading([b, a]).map((n) => n.attrs.aid)).toEqual(["b", "a"]);
  });

  it("sorts sketches alongside boxes by the same rule", () => {
    const lower = sk("s", 0, 300);
    const upper = box("b", 0, 5);
    expect(sortTopLevelForReading([lower, upper]).map((n) => n.attrs.aid)).toEqual(["b", "s"]);
  });

  it("leaves non-positioned nodes (the trailing filler paragraph) after everything positioned", () => {
    const tail = { type: "paragraph" };
    const b1 = box("later", 0, 500);
    const b2 = box("earlier", 0, 5);
    const out = sortTopLevelForReading([b1, tail, b2]);
    expect(out).toEqual([b2, b1, tail]);
  });

  it("never reorders content NESTED inside a box — only the top level is touched", () => {
    const inner = [box("nested-looking", 999, -999)];
    const wrapper = { type: "noteAnchor", attrs: { aid: "outer", x: 0, y: 0 }, content: inner };
    const out = sortTopLevelForReading([wrapper]);
    expect(out[0].content).toBe(inner);       // identity preserved — nothing recursed into
  });
});
