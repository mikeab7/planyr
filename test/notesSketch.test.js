/* Sketch mode — the PURE decisions, tested away from the view.
 *
 * Everything asserted here is a rule from the top of src/workspaces/notes/lib/
 * notesSketchModel.js — THE CANVAS OWNS EVERYTHING: a box carries its own text and its own
 * position, arrows are an explicit list, and deleting a box takes every arrow that named it.
 * They are unit tests rather than only headless checks because the browser can prove a box
 * MOVED but not that every OTHER box came back untouched — same words, same place — which is
 * the actual guarantee.
 *
 * Two describes here are not about the model. The MIGRATION block covers a sketch saved
 * under the superseded outline rule (B1400) — it has to keep opening, unchanged, forever.
 * The MARKDOWN block covers the exporter, which deliberately re-reads a sketch's attributes
 * by hand (it is on the route's static path and must not import the sketch model), so it is
 * the one place drift can happen; it is checked against the model's own derivation rather
 * than against a hand-written string.
 */
import { describe, it, expect } from "vitest";
import {
  addBox, addLink, boxAt, EMPTY_SKETCH, isEmptySketch, layoutSketch, moveBox, nextSpot,
  normalizeSketch, outlineFromSketch, removeBox, removeLink, updateBox, wrapText,
} from "../src/workspaces/notes/lib/notesSketchModel.js";
import { docToMarkdown, docToText } from "../src/workspaces/notes/lib/notesMarkdown.js";

/* A deterministic minter, so a test can name the ids it expects. */
const minter = () => { let n = 0; return () => `n${++n}`; };

/** Build a sketch the way a person does: a box at a time, where they double-clicked. */
function sketch(boxes, links = []) {
  const mint = minter();
  let model = EMPTY_SKETCH;
  const ids = {};
  for (const b of boxes) {
    const r = addBox(model, b, mint);
    model = r.model;
    ids[b.label] = r.id;
  }
  for (const [from, to] of links) model = addLink(model, ids[from], ids[to]).model;
  return { model, ids };
}

const CHART = [
  { label: "Acquisition", x: 20, y: 20 },
  { label: "Title", body: "Order the commitment.", x: 260, y: 20 },
  { label: "Environmental", x: 260, y: 140 },
  { label: "Phase I", x: 500, y: 140 },
  { label: "Entitlement", x: 20, y: 300 },
];
const CHART_LINKS = [["Acquisition", "Title"], ["Acquisition", "Environmental"], ["Environmental", "Phase I"]];
const chart = () => sketch(CHART, CHART_LINKS);

describe("a box is made where it was made, and carries its own words", () => {
  it("addBox puts the box at the point it was given and hands back its id", () => {
    const { model, id } = addBox(EMPTY_SKETCH, { x: 140, y: 62, label: "Deal" });
    expect(model.boxes).toHaveLength(1);
    expect(model.boxes[0]).toMatchObject({ id, label: "Deal", body: "", x: 140, y: 62 });
    expect(isEmptySketch(model)).toBe(false);
  });

  it("a box arrives with NO text — the caret goes in it, nothing is typed for the user", () => {
    const { model } = addBox(EMPTY_SKETCH, { x: 0, y: 0 });
    expect(model.boxes[0].label).toBe("");
    expect(model.boxes[0].body).toBe("");
  });

  it("a negative coordinate is pulled back onto the canvas rather than stored", () => {
    const { model } = addBox(EMPTY_SKETCH, { x: -40, y: -9, label: "A" });
    expect([model.boxes[0].x, model.boxes[0].y]).toEqual([0, 0]);
  });

  it("editing a box's words changes THAT box and nothing else", () => {
    const { model, ids } = chart();
    const after = updateBox(model, ids.Title, { label: "Title review", body: "30-day cure." });
    const box = after.boxes.find((b) => b.id === ids.Title);
    expect([box.label, box.body]).toEqual(["Title review", "30-day cure."]);
    expect([box.x, box.y]).toEqual([260, 20]);                  // words are not position
    for (const b of after.boxes.filter((x) => x.id !== ids.Title)) {
      expect(b).toEqual(model.boxes.find((x) => x.id === b.id));
    }
    expect(after.links).toEqual(model.links);
  });

  it("a LABEL and a longer BODY are one box, as designed from the start", () => {
    const { model, ids } = chart();
    const box = model.boxes.find((b) => b.id === ids.Title);
    expect(box.label).toBe("Title");
    expect(box.body).toBe("Order the commitment.");
    const laid = layoutSketch(model).boxes.find((b) => b.id === ids.Title);
    expect(laid.bodyLines.length).toBeGreaterThan(0);            // the body always DRAWS
    expect(laid.h).toBeGreaterThan(layoutSketch(model).boxes.find((b) => b.id === ids["Phase I"]).h);
  });

  it("editing a box that is not there is a no-op, not a crash", () => {
    const { model } = chart();
    expect(updateBox(model, "ghost", { label: "x" }).boxes).toHaveLength(5);
  });
});

describe("dragging moves ONE box and touches nothing else", () => {
  it("every other box comes back untouched — same words, same place", () => {
    const { model, ids } = chart();
    const after = moveBox(model, ids.Environmental, 400, 120);
    const moved = after.boxes.find((b) => b.id === ids.Environmental);
    expect([moved.x, moved.y]).toEqual([400, 120]);
    expect([moved.label, moved.body]).toEqual(["Environmental", ""]);   // a drag is not an edit
    for (const b of after.boxes.filter((x) => x.id !== ids.Environmental)) {
      expect(b).toEqual(model.boxes.find((x) => x.id === b.id));
    }
    expect(after.links).toEqual(model.links);
  });

  it("moving a box that does not exist is refused, not stored", () => {
    const { model } = chart();
    expect(moveBox(model, "nope", 10, 10).boxes).toHaveLength(5);
  });

  it("a box dragged off the top-left edge stops at it", () => {
    const { model, ids } = chart();
    const after = moveBox(model, ids.Title, -80, -30);
    const box = after.boxes.find((b) => b.id === ids.Title);
    expect([box.x, box.y]).toEqual([0, 0]);
  });

  it("a box added from the keyboard lands under what is already there, not on top of it", () => {
    const { model } = chart();
    const spot = nextSpot(model);
    const lowest = Math.max(...layoutSketch(model).boxes.map((b) => b.y + b.h));
    expect(spot.y).toBeGreaterThanOrEqual(lowest);
    expect(nextSpot(EMPTY_SKETCH)).toEqual({ x: 10, y: 10 });
  });
});

describe("arrows are EXPLICIT, and drawn by dragging one box onto another", () => {
  it("an arrow is stored as {from,to}, once", () => {
    const { model, ids } = chart();
    const again = addLink(model, ids.Acquisition, ids.Title);
    expect(again.added).toBe(false);
    expect(again.reason).toMatch(/already there/);
    expect(model.links).toContainEqual({ from: ids.Acquisition, to: ids.Title });
  });

  it("an arrow to itself, or to a box that is not there, is refused WITH A REASON", () => {
    const { model, ids } = chart();
    expect(addLink(model, ids.Title, ids.Title)).toMatchObject({ added: false, reason: /itself/ });
    expect(addLink(model, ids.Title, "ghost")).toMatchObject({ added: false, reason: /two boxes/ });
  });

  it("an arrow BACK the other way is a different arrow, and is allowed", () => {
    const { model, ids } = chart();
    const back = addLink(model, ids.Title, ids.Acquisition);
    expect(back.added).toBe(true);
    expect(back.model.links).toHaveLength(4);
  });

  it("the layout gives every arrow real endpoints on the two boxes' borders", () => {
    const { model, ids } = chart();
    const { edges, boxes } = layoutSketch(model);
    expect(edges).toHaveLength(3);
    const e = edges.find((x) => x.from === ids.Acquisition && x.to === ids.Title);
    const a = boxes.find((b) => b.id === ids.Acquisition);
    expect(e.x1).toBeCloseTo(a.x + a.w, 5);            // leaves the source box's right edge
    expect(removeLink(model, ids.Acquisition, ids.Title).links).toHaveLength(2);
  });
});

describe("deleting a box takes every arrow that named it (TOMBSTONE-DELETES)", () => {
  it("nothing is left dangling, at either end, and it says how many it took", () => {
    const { model, ids } = chart();
    const linked = addLink(model, ids["Phase I"], ids.Entitlement).model;
    expect(linked.links).toHaveLength(4);

    const { model: after, removedLinks } = removeBox(linked, ids["Phase I"]);
    expect(after.boxes.map((b) => b.id)).not.toContain(ids["Phase I"]);
    expect(after.boxes).toHaveLength(4);
    expect(removedLinks).toHaveLength(2);              // one INTO it, one OUT of it
    const live = new Set(after.boxes.map((b) => b.id));
    for (const l of after.links) {
      expect(live.has(l.from) && live.has(l.to), "a dangling arrow survived the delete").toBe(true);
    }
    expect(after.links).toHaveLength(2);                // the two untouched ones remain
  });

  it("an unrelated box keeps its own place — the cascade is exact, not a wipe", () => {
    const { model, ids } = chart();
    const { model: after } = removeBox(model, ids["Phase I"]);
    const ent = after.boxes.find((b) => b.id === ids.Entitlement);
    expect([ent.x, ent.y]).toEqual([20, 300]);
  });

  it("deleting a box that is not there changes nothing", () => {
    const { model } = chart();
    const { model: after, removedLinks } = removeBox(model, "ghost");
    expect(after.boxes).toHaveLength(5);
    expect(removedLinks).toEqual([]);
  });

  it("normalizeSketch is a second line of defence — a stored dangler is dropped on read", () => {
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

  it("junk in the attributes is dropped, never thrown on — one bad sketch cannot take a note down", () => {
    expect(normalizeSketch(null)).toEqual({ boxes: [], links: [] });
    expect(normalizeSketch({ boxes: "nope", links: 7 })).toEqual({ boxes: [], links: [] });
    expect(normalizeSketch({ boxes: [null, 3, { label: "no id" }] }).boxes).toEqual([]);
  });
});

describe("the layout, and the room to double-click in", () => {
  it("a box is drawn exactly where it was put", () => {
    const { model, ids } = chart();
    const box = layoutSketch(model).boxes.find((b) => b.id === ids["Phase I"]);
    expect([box.x, box.y]).toEqual([500, 140]);
  });

  it("⛔ THE CANVAS IS ALWAYS ROOMIER THAN ITS BOXES — otherwise there is nowhere to double-click", () => {
    const { model } = chart();
    const l = layoutSketch(model);
    const right = Math.max(...l.boxes.map((b) => b.x + b.w));
    const bottom = Math.max(...l.boxes.map((b) => b.y + b.h));
    expect(l.width).toBeGreaterThan(right + 60);
    expect(l.height).toBeGreaterThan(bottom + 40);
  });

  it("an EMPTY sketch still reports a usable canvas — the empty canvas IS the authoring surface", () => {
    const l = layoutSketch(EMPTY_SKETCH);
    expect(l.boxes).toEqual([]);
    expect(l.width).toBeGreaterThan(300);
    expect(l.height).toBeGreaterThan(150);
  });

  it("wrapText breaks on spaces and hard-splits a word too long to fit", () => {
    expect(wrapText("one two three", 8)).toEqual(["one two", "three"]);
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("   ", 5)).toEqual([]);
  });

  it("boxAt finds the box under a point, and nothing in the gaps", () => {
    const { model, ids } = chart();
    const layout = layoutSketch(model);
    const b = layout.boxes.find((x) => x.id === ids.Title);
    expect(boxAt(layout, b.x + 2, b.y + 2).id).toBe(ids.Title);
    expect(boxAt(layout, b.x - 30, b.y - 30)).toBeNull();
  });
});

describe("the DERIVED ordering — for the export and the accessible name, owned by nobody", () => {
  it("a box hangs under the arrow that points at it", () => {
    const { model, ids } = chart();
    const { lines, extra } = outlineFromSketch(model);
    expect(lines.map((n) => [n.label, n.depth])).toEqual([
      ["Acquisition", 0], ["Title", 1], ["Environmental", 1], ["Phase I", 2], ["Entitlement", 0],
    ]);
    expect(extra).toEqual([]);
    expect(lines.map((n) => n.id)).toContain(ids["Phase I"]);
  });

  it("an arrow into a box that ALREADY has a parent cannot be nesting, so it is reported as extra", () => {
    const { model, ids } = chart();
    // Title already hangs under Acquisition, so this second arrow into it has to be extra.
    const linked = addLink(model, ids.Entitlement, ids.Title).model;
    const { lines, extra } = outlineFromSketch(linked);
    expect(lines).toHaveLength(5);
    expect(extra).toEqual([{ from: ids.Entitlement, to: ids.Title }]);
  });

  it("an arrow into a box that has NO parent yet is expressed by the nesting itself", () => {
    const { model, ids } = chart();
    const linked = addLink(model, ids["Phase I"], ids.Entitlement).model;
    const { lines, extra } = outlineFromSketch(linked);
    expect(extra).toEqual([]);
    expect(lines.find((n) => n.id === ids.Entitlement).depth).toBe(3);
  });

  it("a loop cannot make a box vanish from the list", () => {
    const { model, ids } = sketch([{ label: "A" }, { label: "B" }], [["A", "B"], ["B", "A"]]);
    const { lines } = outlineFromSketch(model);
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((n) => n.id))).toEqual(new Set([ids.A, ids.B]));
  });

  it("boxes with no arrows at all are every one of them a root", () => {
    const { model } = sketch([{ label: "A" }, { label: "B" }, { label: "C" }]);
    expect(outlineFromSketch(model).lines.map((n) => n.depth)).toEqual([0, 0, 0]);
  });
});

describe("⛔ a sketch saved under the SUPERSEDED outline rule still opens, unchanged", () => {
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

describe("Markdown export — every word survives, and what a list cannot say is NAMED", () => {
  const sketchDoc = (attrs) => ({ type: "doc", content: [{ type: "noteSketch", attrs }] });

  it("boxes export as a readable nested list, bodies included", () => {
    const { model } = chart();
    const { markdown } = docToMarkdown(sketchDoc(model));
    expect(markdown).toContain("- Acquisition");
    expect(markdown).toContain("  - Title");
    expect(markdown).toContain("    > Order the commitment.");
    expect(markdown).toContain("    - Phase I");
    expect(markdown).toContain("- Entitlement");
  });

  it("⛔ THE EXPORTER AND THE MODEL AGREE — the drift guard", () => {
    // The exporter re-reads attributes by hand (it must not import the sketch model — that
    // would put sketch code on the Notes route's static path), so its nesting is checked
    // against the model's own derivation rather than against a hand-written string.
    const { model, ids } = chart();
    const linked = addLink(model, ids.Entitlement, ids.Title).model;
    const { markdown } = docToMarkdown(sketchDoc(linked));
    const { lines, extra } = outlineFromSketch(linked);
    const rendered = lines.map((n) => `${"  ".repeat(n.depth)}- ${n.label}`);
    for (const line of rendered) expect(markdown).toContain(line);
    expect(extra).toHaveLength(1);
    expect(markdown).toContain("Entitlement → Title");
  });

  it("an arrow the nesting cannot express is WRITTEN OUT — content never vanishes", () => {
    const { model, ids } = chart();
    const linked = addLink(model, ids.Entitlement, ids.Title).model;
    const { markdown } = docToMarkdown(sketchDoc(linked));
    expect(markdown).toContain("Also connected:");
    expect(markdown).toContain("Entitlement → Title");
  });

  it("where the boxes SIT is lossy, and is NAMED rather than silently dropped", () => {
    const { model } = chart();
    const { lossy } = docToMarkdown(sketchDoc(model));
    expect(lossy).toContain("where a sketch's boxes sit on the canvas");
  });

  it("one box on its own has no arrangement to lose, so nothing is reported", () => {
    const { model } = addBox(EMPTY_SKETCH, { x: 30, y: 30, label: "Just the one" });
    const { markdown, lossy } = docToMarkdown(sketchDoc(model));
    expect(markdown).toContain("- Just the one");
    expect(lossy).toEqual([]);
  });

  it("a sketch saved under the superseded shape still exports its list", () => {
    const legacyDoc = sketchDoc({
      outline: [{ id: "a", depth: 0, label: "Acquisition" }, { id: "b", depth: 1, label: "Title", body: "detail" }],
      positions: { b: { x: 1, y: 2 } },
      links: [],
    });
    const { markdown } = docToMarkdown(legacyDoc);
    expect(markdown).toContain("- Acquisition");
    expect(markdown).toContain("  - Title");
    expect(markdown).toContain("    > detail");
  });

  it("an empty sketch exports as nothing rather than as an empty bullet", () => {
    expect(docToMarkdown(sketchDoc(EMPTY_SKETCH)).markdown.trim()).toBe("");
  });

  it("a sketch's words are SEARCHABLE — they are in attributes, not in text nodes", () => {
    const { model } = chart();
    const text = docToText(sketchDoc(model));
    expect(text).toContain("Acquisition");
    expect(text).toContain("Order the commitment.");
    // …and so are the words of a sketch still in the superseded shape.
    const old = docToText(sketchDoc({ outline: [{ id: "a", label: "Old box", body: "old detail" }] }));
    expect(old).toContain("Old box");
    expect(old).toContain("old detail");
  });
});
