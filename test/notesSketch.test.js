/* Sketch mode — the PURE decisions, tested away from the view.
 *
 * Everything asserted here is a rule from the top of src/workspaces/notes/lib/
 * notesSketchModel.js, and the reason they are unit tests rather than only headless checks
 * is that the headless run can prove a box MOVED but not that the outline array it was
 * given came back IDENTICAL — which is the actual guarantee.
 *
 * The one test here that is not about the model is the last describe: the Markdown exporter
 * deliberately re-reads a sketch's attributes by hand (it is on the route's static path and
 * must not import the sketch model), so it is the one place drift can happen. It is checked
 * against the model's own parser rather than against a hand-written string.
 */
import { describe, it, expect } from "vitest";
import {
  addLink, applyOutlineText, boxAt, buildTree, clearPosition, EMPTY_SKETCH, isEmptySketch,
  layoutSketch, moveNode, normalizeSketch, outlineToText, parentMap, parseOutlineText,
  reconcileOutline, removeLink, wrapText,
} from "../src/workspaces/notes/lib/notesSketchModel.js";
import { docToMarkdown, docToText } from "../src/workspaces/notes/lib/notesMarkdown.js";

/* A deterministic minter, so a test can name the ids it expects. */
const minter = () => { let n = 0; return () => `n${++n}`; };
const build = (text) => applyOutlineText(EMPTY_SKETCH, text, minter());
const labels = (m) => m.outline.map((n) => n.label);
const depths = (m) => m.outline.map((n) => n.depth);
const idOf = (m, label) => m.outline.find((n) => n.label === label)?.id;

const OUTLINE = `Acquisition
  Title
  Environmental
    Phase I
Entitlement`;

describe("the outline text is parsed the way a person types it", () => {
  it("indentation makes children — two spaces or a tab, both", () => {
    const spaces = parseOutlineText("A\n  B\n    C");
    const tabs = parseOutlineText("A\n\tB\n\t\tC");
    expect(spaces.map((n) => n.depth)).toEqual([0, 1, 2]);
    expect(tabs.map((n) => n.depth)).toEqual([0, 1, 2]);
  });

  it("a line cannot jump more than one level deeper — it is pulled back to a real parent", () => {
    expect(parseOutlineText("A\n        B").map((n) => n.depth)).toEqual([0, 1]);
  });

  it("blank lines are ignored and a pasted bullet marker is stripped", () => {
    expect(parseOutlineText("- A\n\n  * B\n  1. C").map((n) => n.label)).toEqual(["A", "B", "C"]);
  });

  it("a `>` line is the BODY of the box above it, not a box of its own", () => {
    const parsed = parseOutlineText("Title\n  > Order the commitment.\n  > 30-day cure.\nNext");
    expect(parsed.map((n) => n.label)).toEqual(["Title", "Next"]);
    expect(parsed[0].body).toBe("Order the commitment.\n30-day cure.");
  });

  it("a body before any label has nothing to attach to and is dropped, not crashed on", () => {
    expect(parseOutlineText("> orphan\nA").map((n) => n.label)).toEqual(["A"]);
  });

  it("the label/body pair round-trips through the text form", () => {
    const model = build("Title\n  > detail one\n  > detail two\n  Child");
    const back = parseOutlineText(outlineToText(model.outline));
    expect(back.map((n) => [n.label, n.body, n.depth]))
      .toEqual([["Title", "detail one\ndetail two", 0], ["Child", "", 1]]);
  });
});

describe("the outline is the single source of truth — ids survive an edit", () => {
  it("typing a new line leaves every other id alone", () => {
    const before = build(OUTLINE);
    const mint = minter();
    const after = applyOutlineText(before, `${OUTLINE}\nDue diligence`, mint);
    expect(labels(after)).toEqual(["Acquisition", "Title", "Environmental", "Phase I", "Entitlement", "Due diligence"]);
    for (const l of labels(before)) expect(idOf(after, l)).toBe(idOf(before, l));
  });

  it("RENAMING a line keeps its id — otherwise every drag would evaporate on a keystroke", () => {
    const before = build(OUTLINE);
    const after = applyOutlineText(before, OUTLINE.replace("Title", "Title review"), minter());
    expect(idOf(after, "Title review")).toBe(idOf(before, "Title"));
    expect(labels(after)).toContain("Title review");
  });

  it("RE-INDENTING a line keeps its id", () => {
    const before = build("A\nB");
    const after = applyOutlineText(before, "A\n  B", minter());
    expect(idOf(after, "B")).toBe(idOf(before, "B"));
    expect(depths(after)).toEqual([0, 1]);
  });

  it("reconcile reports exactly which nodes were removed", () => {
    const before = build(OUTLINE);
    const gone = idOf(before, "Phase I");
    const r = reconcileOutline(before, parseOutlineText(OUTLINE.replace("\n    Phase I", "")), minter());
    expect(r.removedIds).toEqual([gone]);
  });
});

describe("dragging saves a POSITION and changes nothing else (rule 2)", () => {
  it("the outline array comes back identical — object for object", () => {
    const before = build(OUTLINE);
    const id = idOf(before, "Environmental");
    const after = moveNode(before, id, 400, 120);
    expect(after.positions[id]).toEqual({ x: 400, y: 120 });
    expect(after.outline).toEqual(before.outline);
    after.outline.forEach((n, i) => expect(n).toEqual(before.outline[i]));
    expect(outlineToText(after.outline)).toBe(outlineToText(before.outline));
  });

  it("a position on a node that does not exist is refused, not stored", () => {
    const before = build("A");
    expect(moveNode(before, "nope", 10, 10).positions).toEqual({});
  });

  it("the layout uses the override for a placed box and the automatic slot for the rest", () => {
    const model = build(OUTLINE);
    const id = idOf(model, "Title");
    const moved = moveNode(model, id, 500, 300);
    const auto = layoutSketch(model);
    const after = layoutSketch(moved);
    const box = after.boxes.find((b) => b.id === id);
    expect([box.x, box.y, box.placed]).toEqual([500, 300, true]);
    for (const b of after.boxes.filter((x) => x.id !== id)) {
      const was = auto.boxes.find((x) => x.id === b.id);
      expect([b.x, b.y]).toEqual([was.x, was.y]);      // one drag moves ONE box
    }
  });

  it("clearing a position puts the box back EXACTLY where the outline put it", () => {
    const model = build(OUTLINE);
    const id = idOf(model, "Title");
    const box = (m) => layoutSketch(m).boxes.find((b) => b.id === id);
    const restored = clearPosition(moveNode(model, id, 900, 900), id);
    expect([box(restored).x, box(restored).y]).toEqual([box(model).x, box(model).y]);
    expect(box(restored).placed).toBe(false);
  });
});

describe("extra arrows are EXPLICIT (rule 3)", () => {
  it("an arrow the outline already draws is refused, with a reason", () => {
    const m = build(OUTLINE);
    const r = addLink(m, idOf(m, "Acquisition"), idOf(m, "Title"));
    expect(r.added).toBe(false);
    expect(r.reason).toMatch(/outline already/);
  });

  it("a cross-branch arrow is stored, once", () => {
    const m = build(OUTLINE);
    const a = idOf(m, "Phase I");
    const b = idOf(m, "Entitlement");
    const first = addLink(m, a, b);
    expect(first.added).toBe(true);
    expect(first.model.links).toEqual([{ from: a, to: b }]);
    expect(addLink(first.model, a, b).added).toBe(false);
    expect(removeLink(first.model, a, b).links).toEqual([]);
  });

  it("an arrow to itself, or to a box that is not there, is refused", () => {
    const m = build("A\nB");
    expect(addLink(m, idOf(m, "A"), idOf(m, "A")).added).toBe(false);
    expect(addLink(m, idOf(m, "A"), "ghost").added).toBe(false);
  });

  it("the layout draws parent arrows AND the extra ones, and says which is which", () => {
    const m = build(OUTLINE);
    const linked = addLink(m, idOf(m, "Phase I"), idOf(m, "Entitlement")).model;
    const { edges } = layoutSketch(linked);
    // Five boxes, two of them roots — so three parent→child arrows, and the one extra.
    expect(edges.filter((e) => e.kind === "tree")).toHaveLength(3);
    expect(edges.filter((e) => e.kind === "link")).toHaveLength(1);
  });
});

describe("deleting a line takes its box, its position AND its arrows (rule 4 — TOMBSTONE-DELETES)", () => {
  it("nothing is left dangling", () => {
    let m = build(OUTLINE);
    const phase = idOf(m, "Phase I");
    const ent = idOf(m, "Entitlement");
    const title = idOf(m, "Title");
    m = moveNode(m, phase, 300, 40);
    m = moveNode(m, title, 10, 200);
    m = addLink(m, phase, ent).model;
    m = addLink(m, title, phase).model;
    expect(Object.keys(m.positions)).toHaveLength(2);
    expect(m.links).toHaveLength(2);

    // The user deletes the "Phase I" line from the outline. That is the ONLY act.
    const after = applyOutlineText(m, OUTLINE.replace("\n    Phase I", ""), minter());

    expect(labels(after)).not.toContain("Phase I");
    expect(after.positions[phase], "a position with no box is a dangling position").toBeUndefined();
    expect(after.positions[title], "an unrelated box keeps its position").toEqual({ x: 10, y: 200 });
    expect(after.links, "both arrows named the deleted node — at either end").toEqual([]);
  });

  it("normalizeSketch is a second line of defence — a stored dangler is dropped on read", () => {
    const m = normalizeSketch({
      outline: [{ id: "a", depth: 0, label: "A" }],
      positions: { a: { x: 1, y: 2 }, ghost: { x: 9, y: 9 } },
      links: [{ from: "a", to: "ghost" }, { from: "a", to: "a" }],
    });
    expect(Object.keys(m.positions)).toEqual(["a"]);
    expect(m.links).toEqual([]);
  });

  it("a duplicate id would give one box two positions — the second copy is dropped", () => {
    const m = normalizeSketch({ outline: [{ id: "a", label: "A" }, { id: "a", label: "A again" }] });
    expect(m.outline).toHaveLength(1);
  });

  it("clearing the whole outline clears the positions and links with it", () => {
    let m = build("A\n  B");
    m = moveNode(m, idOf(m, "B"), 5, 5);
    const after = applyOutlineText(m, "", minter());
    expect(after).toEqual({ outline: [], positions: {}, links: [] });
    expect(isEmptySketch(after)).toBe(true);
  });
});

describe("the derived tree and the automatic layout", () => {
  it("parents come from the depth sequence", () => {
    const m = build(OUTLINE);
    const p = parentMap(m.outline);
    expect(p[idOf(m, "Title")]).toBe(idOf(m, "Acquisition"));
    expect(p[idOf(m, "Phase I")]).toBe(idOf(m, "Environmental"));
    expect(p[idOf(m, "Entitlement")]).toBeUndefined();
    expect(buildTree(m.outline)).toHaveLength(2);
  });

  it("depth is the column, and no two boxes overlap", () => {
    const { boxes } = layoutSketch(build(OUTLINE));
    const xs = new Set(boxes.map((b) => b.x));
    expect(xs.size).toBe(3);
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id === b.id) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.label} overlaps ${b.label}`).toBe(false);
      }
    }
  });

  it("a parent sits between its children", () => {
    const m = build("Root\n  One\n  Two\n  Three");
    const { boxes } = layoutSketch(m);
    const y = (l) => boxes.find((b) => b.label === l).y;
    expect(y("Root")).toBeGreaterThan(y("One"));
    expect(y("Root")).toBeLessThan(y("Three"));
  });

  it("opening a body makes only THAT box taller", () => {
    const m = build("A\n  > a long detail line that will certainly wrap onto more than one line\nB");
    const id = idOf(m, "A");
    const closed = layoutSketch(m).boxes.find((b) => b.id === id);
    const open = layoutSketch(m, { expanded: new Set([id]) }).boxes.find((b) => b.id === id);
    expect(open.h).toBeGreaterThan(closed.h);
    expect(open.bodyLines.length).toBeGreaterThan(1);
    expect(layoutSketch(m).boxes.find((b) => b.label === "B").h).toBe(closed.h);
  });

  it("wrapText breaks on spaces and hard-splits a word too long to fit", () => {
    expect(wrapText("one two three", 8)).toEqual(["one two", "three"]);
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("   ", 5)).toEqual([]);
  });

  it("boxAt finds the box under a point, and nothing in the gaps", () => {
    const layout = layoutSketch(build(OUTLINE));
    const b = layout.boxes[0];
    expect(boxAt(layout, b.x + 2, b.y + 2).id).toBe(b.id);
    expect(boxAt(layout, -50, -50)).toBeNull();
  });

  it("an empty sketch still reports a usable canvas rather than a zero-sized one", () => {
    const l = layoutSketch(EMPTY_SKETCH);
    expect(l.boxes).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
  });
});

describe("Markdown export — lossless for content, NAMED for what a list cannot say", () => {
  const sketchDoc = (attrs) => ({ type: "doc", content: [{ type: "noteSketch", attrs }] });

  it("the outline exports as a plain indented list, bodies included", () => {
    const m = build("Acquisition\n  Title\n  > Order the commitment.\nEntitlement");
    const { markdown } = docToMarkdown(sketchDoc(m));
    expect(markdown).toContain("- Acquisition");
    expect(markdown).toContain("  - Title");
    expect(markdown).toContain("    > Order the commitment.");
    expect(markdown).toContain("- Entitlement");
  });

  it("⛔ THE EXPORTER AND THE MODEL AGREE ABOUT THE OUTLINE — the drift guard", () => {
    // The exporter re-reads attributes by hand (it must not import the sketch model — that
    // would put sketch code on the Notes route's static path), so this feeds its output
    // back through the model's own parser and demands the same shape out.
    const m = build(`${OUTLINE}\n  > a detail on Entitlement`);
    const { markdown } = docToMarkdown(sketchDoc(m));
    const reparsed = parseOutlineText(markdown);
    expect(reparsed.map((n) => [n.label, n.depth, n.body]))
      .toEqual(m.outline.map((n) => [n.label, n.depth, n.body]));
  });

  it("extra arrows are WRITTEN OUT — content never vanishes into a footnote", () => {
    const m = build(OUTLINE);
    const linked = addLink(m, idOf(m, "Phase I"), idOf(m, "Entitlement")).model;
    const { markdown, lossy } = docToMarkdown(sketchDoc(linked));
    expect(markdown).toContain("Also connected:");
    expect(markdown).toContain("Phase I → Entitlement");
    expect(lossy).toEqual([]);           // nothing was lost — the arrows are all there
  });

  it("hand-placed boxes ARE lossy, and are NAMED rather than silently dropped", () => {
    const m = moveNode(build(OUTLINE), idOf(build(OUTLINE), "Title") || "x", 10, 10);
    const placed = moveNode(build(OUTLINE), build(OUTLINE).outline[0].id, 40, 40);
    const { lossy } = docToMarkdown(sketchDoc(placed));
    expect(lossy).toContain("where a sketch's boxes were dragged to");
    expect(Object.keys(m.positions).length + Object.keys(placed.positions).length).toBeGreaterThan(0);
  });

  it("an empty sketch exports as nothing rather than as an empty bullet", () => {
    expect(docToMarkdown(sketchDoc(EMPTY_SKETCH)).markdown.trim()).toBe("");
  });

  it("a sketch's words are SEARCHABLE — they are in attributes, not in text nodes", () => {
    const m = build("Acquisition\n  > closes in March");
    const text = docToText(sketchDoc(m));
    expect(text).toContain("Acquisition");
    expect(text).toContain("closes in March");
  });
});
