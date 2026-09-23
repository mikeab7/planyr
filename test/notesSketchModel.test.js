/* notesSketchModel — what SURVIVES the sketch canvas's retirement (NEW-2, 2026-09-22).
 *
 * Sketch mode itself is gone (see that file's own header). These functions are kept for
 * exactly one caller, `migrateSketchesToBoxes` (lib/notesFlowMigration.js), which has to read
 * an OLD page's stored `noteSketch` JSON — including one saved under the even older outline
 * shape — and turn it into real `noteAnchor` boxes. So this suite tests READING a sketch, never
 * authoring one: normalizeSketch (incl. the legacy outline migration), layoutSketch, boxSize,
 * wrapText, edgePoint. The old edit functions (addBox/updateBox/moveBox/removeBox/addLink/
 * removeLink/boxAt/nextSpot/outlineFromSketch) are deleted along with the interactive canvas —
 * their own tests went with them.
 */
import { describe, it, expect } from "vitest";
import {
  boxSize, edgePoint, layoutSketch, normalizeSketch, wrapText,
} from "../src/workspaces/notes/lib/notesSketchModel.js";

describe("normalizeSketch — defensive reading of a stored sketch", () => {
  it("keeps well-formed boxes and links", () => {
    const m = normalizeSketch({
      boxes: [{ id: "a", label: "A", x: 10, y: 20 }, { id: "b", label: "B", body: "detail", x: 200, y: 20 }],
      links: [{ from: "a", to: "b" }],
    });
    expect(m.boxes).toHaveLength(2);
    expect(m.links).toEqual([{ from: "a", to: "b" }]);
  });

  it("a dangling link — to a ghost id, to itself, or to nothing — is dropped", () => {
    const m = normalizeSketch({
      boxes: [{ id: "a", label: "A", x: 1, y: 2 }],
      links: [{ from: "a", to: "ghost" }, { from: "a", to: "a" }, { from: "a", to: "" }],
    });
    expect(m.boxes).toHaveLength(1);
    expect(m.links).toEqual([]);
  });

  it("a duplicate id would give one box two places — the second copy is dropped", () => {
    const m = normalizeSketch({ boxes: [{ id: "a", label: "A" }, { id: "a", label: "A again" }] });
    expect(m.boxes).toHaveLength(1);
    expect(m.boxes[0].label).toBe("A");
  });

  it("a negative coordinate is pulled back onto the canvas", () => {
    const m = normalizeSketch({ boxes: [{ id: "a", label: "A", x: -40, y: -9 }] });
    expect([m.boxes[0].x, m.boxes[0].y]).toEqual([0, 0]);
  });

  it("junk in the attributes is dropped, never thrown on — one bad sketch cannot take a note down", () => {
    expect(normalizeSketch(null)).toEqual({ boxes: [], links: [] });
    expect(normalizeSketch({ boxes: "nope", links: 7 })).toEqual({ boxes: [], links: [] });
    expect(normalizeSketch({ boxes: [null, 3, { label: "no id" }] }).boxes).toEqual([]);
  });
});

describe("⛔ a sketch saved under the SUPERSEDED outline rule still migrates correctly", () => {
  const legacy = {
    outline: [
      { id: "a", depth: 0, label: "Acquisition", body: "" },
      { id: "b", depth: 1, label: "Title", body: "Order the commitment." },
      { id: "c", depth: 1, label: "Environmental", body: "" },
    ],
    positions: { c: { x: 400, y: 260 } },
    links: [{ from: "b", to: "c" }],
  };

  it("its lines become boxes that carry their own text", () => {
    const m = normalizeSketch(legacy);
    expect(m.boxes.map((b) => b.label)).toEqual(["Acquisition", "Title", "Environmental"]);
    expect(m.boxes[1].body).toBe("Order the commitment.");
  });

  it("the indentation's implied arrows become REAL arrows, and the extra one survives", () => {
    const m = normalizeSketch(legacy);
    expect(m.links).toContainEqual({ from: "a", to: "b" });
    expect(m.links).toContainEqual({ from: "a", to: "c" });
    expect(m.links).toContainEqual({ from: "b", to: "c" });
    expect(m.links).toHaveLength(3);
  });

  it("a box the owner had dragged stays exactly where they dragged it", () => {
    const m = normalizeSketch(legacy);
    expect(m.boxes.find((b) => b.id === "c")).toMatchObject({ x: 400, y: 260 });
  });

  it("a box that was auto-laid-out gets a real place of its own, on the canvas", () => {
    const m = normalizeSketch(legacy);
    for (const b of m.boxes) {
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      expect(b.x).toBeGreaterThanOrEqual(0);
    }
    expect(m.boxes[0].x).toBeLessThan(m.boxes[1].x);      // depth was the column
  });

  it("once it has been edited the new shape wins — the migration does not run twice", () => {
    const m = normalizeSketch({ ...legacy, boxes: [{ id: "z", label: "Only me", x: 5, y: 5 }], links: [] });
    expect(m.boxes.map((b) => b.id)).toEqual(["z"]);
    expect(m.links).toEqual([]);
  });
});

describe("wrapText / boxSize — pure text layout", () => {
  it("wrapText breaks on spaces and hard-splits a word too long to fit", () => {
    expect(wrapText("one two three", 8)).toEqual(["one two", "three"]);
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("   ", 5)).toEqual([]);
  });

  it("a body always counts toward the box's height", () => {
    const titleOnly = boxSize({ label: "Title", body: "" });
    const withBody = boxSize({ label: "Title", body: "Order the commitment, then review it." });
    expect(withBody.h).toBeGreaterThan(titleOnly.h);
    expect(withBody.bodyLines.length).toBeGreaterThan(0);
  });
});

describe("edgePoint — where an arrow crosses a box's border", () => {
  it("aims at the centre of the destination and lands on the source's own edge", () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    const p = edgePoint(box, 300, 25);           // straight out the right edge
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(25, 5);
  });

  it("a target dead-centre on the box returns the box's own centre", () => {
    const box = { x: 10, y: 10, w: 40, h: 20 };
    expect(edgePoint(box, 30, 20)).toEqual({ x: 30, y: 20 });
  });
});

describe("layoutSketch — real endpoints and a canvas roomier than its contents", () => {
  const CHART = normalizeSketch({
    boxes: [
      { id: "a", label: "Acquisition", x: 20, y: 20 },
      { id: "b", label: "Title", body: "Order the commitment.", x: 260, y: 20 },
      { id: "c", label: "Environmental", x: 260, y: 140 },
    ],
    links: [{ from: "a", to: "b" }],
  });

  it("a box is drawn exactly where it was put", () => {
    const box = layoutSketch(CHART).boxes.find((b) => b.id === "c");
    expect([box.x, box.y]).toEqual([260, 140]);
  });

  it("the layout gives every arrow real endpoints on the two boxes' borders", () => {
    const { edges, boxes } = layoutSketch(CHART);
    expect(edges).toHaveLength(1);
    const a = boxes.find((b) => b.id === "a");
    expect(edges[0].x1).toBeCloseTo(a.x + a.w, 5);      // leaves the source box's right edge
  });

  it("⛔ THE CANVAS IS ALWAYS ROOMIER THAN ITS BOXES — used to stack migrated sketch groups", () => {
    const l = layoutSketch(CHART);
    const right = Math.max(...l.boxes.map((b) => b.x + b.w));
    const bottom = Math.max(...l.boxes.map((b) => b.y + b.h));
    expect(l.width).toBeGreaterThan(right + 60);
    expect(l.height).toBeGreaterThan(bottom + 40);
  });

  it("an EMPTY sketch still reports a usable canvas size", () => {
    const l = layoutSketch({ boxes: [], links: [] });
    expect(l.boxes).toEqual([]);
    expect(l.width).toBeGreaterThan(300);
    expect(l.height).toBeGreaterThan(150);
  });
});
