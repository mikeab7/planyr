/* Shared SELECTION primitives (B569 / B570) — the box-test, modifier rules, and chrome math
 * that BOTH workspaces consume so multi-select + marquee can't drift into two implementations. */
import { describe, it, expect } from "vitest";
import {
  normBox, boxesIntersect, boxContains, marqueeHits, pickInMarquee,
  selMods, hasSelMod, nextSelection, cornerGrips, SEL,
} from "../src/shared/markup/selection.js";

describe("normBox — reconciles the three box forms", () => {
  it("normalises a corner pair, sorting min/max", () => {
    expect(normBox({ x0: 10, y0: 8, x1: 2, y1: 4 })).toEqual({ x0: 2, y0: 4, x1: 10, y1: 8 });
  });
  it("normalises an {a,b} rubber-band", () => {
    expect(normBox({ a: { x: 5, y: 9 }, b: { x: 1, y: 2 } })).toEqual({ x0: 1, y0: 2, x1: 5, y1: 9 });
  });
  it("normalises an {x,y,w,h} bbox", () => {
    expect(normBox({ x: 3, y: 4, w: 6, h: 2 })).toEqual({ x0: 3, y0: 4, x1: 9, y1: 6 });
  });
  it("returns null for junk", () => {
    expect(normBox(null)).toBe(null);
    expect(normBox({})).toBe(null);
  });
});

describe("boxesIntersect (crossing) + boxContains (window)", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  it("crossing: overlap (incl. touching edges) is a hit", () => {
    expect(boxesIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);   // partial overlap
    expect(boxesIntersect(a, { x: 10, y: 0, w: 4, h: 4 })).toBe(true);    // edge touch
    expect(boxesIntersect(a, { x: 20, y: 20, w: 2, h: 2 })).toBe(false);  // disjoint
  });
  it("window: only a fully-enclosed inner box is a hit", () => {
    expect(boxContains(a, { x: 2, y: 2, w: 4, h: 4 })).toBe(true);        // inside
    expect(boxContains(a, { x: 8, y: 8, w: 5, h: 5 })).toBe(false);       // pokes out
  });
  it("marqueeHits routes by mode", () => {
    const partial = { x: 8, y: 8, w: 5, h: 5 };
    expect(marqueeHits(partial, a, "crossing")).toBe(true);
    expect(marqueeHits(partial, a, "window")).toBe(false);
    expect(marqueeHits(partial, a)).toBe(true); // default = crossing
  });
});

describe("pickInMarquee", () => {
  const items = [
    { id: "a", pts: [{ x: 1, y: 1 }, { x: 3, y: 3 }] },   // inside
    { id: "b", pts: [{ x: 50, y: 50 }, { x: 60, y: 60 }] }, // far away
    { id: "c", pts: [{ x: 8, y: 8 }, { x: 20, y: 20 }] },  // straddles the edge
  ];
  const bboxOf = (m) => {
    const xs = m.pts.map((p) => p.x), ys = m.pts.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
  it("crossing picks anything touched, by ref", () => {
    const got = pickInMarquee(items, box, { bboxOf, refOf: (m) => m.id });
    expect(got.sort()).toEqual(["a", "c"]);
  });
  it("window picks only the fully-enclosed", () => {
    const got = pickInMarquee(items, box, { bboxOf, refOf: (m) => m.id, mode: "window" });
    expect(got).toEqual(["a"]);
  });
  it("honours a filter", () => {
    const got = pickInMarquee(items, box, { bboxOf, refOf: (m) => m.id, filter: (m) => m.id !== "a" });
    expect(got).toEqual(["c"]);
  });
});

describe("selMods / hasSelMod — modifier intent off an event", () => {
  it("Ctrl or Cmd = toggle", () => {
    expect(selMods({ ctrlKey: true })).toEqual({ toggle: true, add: false });
    expect(selMods({ metaKey: true })).toEqual({ toggle: true, add: false });
  });
  it("Shift = add", () => {
    expect(selMods({ shiftKey: true })).toEqual({ toggle: false, add: true });
  });
  it("no modifier", () => {
    expect(selMods({})).toEqual({ toggle: false, add: false });
    expect(hasSelMod({})).toBe(false);
    expect(hasSelMod({ metaKey: true })).toBe(true);
  });
});

describe("nextSelection — Ctrl=toggle, Shift=add, plain=replace", () => {
  it("plain click replaces the whole set", () => {
    expect(nextSelection(["a", "b"], "c", {})).toEqual(["c"]);
  });
  it("toggle adds an absent ref, removes a present one", () => {
    expect(nextSelection(["a"], "b", { toggle: true })).toEqual(["a", "b"]);
    expect(nextSelection(["a", "b"], "b", { toggle: true })).toEqual(["a"]);
  });
  it("add appends an absent ref but never removes (idempotent)", () => {
    expect(nextSelection(["a"], "b", { add: true })).toEqual(["a", "b"]);
    expect(nextSelection(["a", "b"], "b", { add: true })).toEqual(["a", "b"]);
  });
  it("uses a custom eq for {kind,id} refs", () => {
    const eq = (x, y) => x.kind === y.kind && x.id === y.id;
    const cur = [{ kind: "el", id: 1 }];
    const got = nextSelection(cur, { kind: "el", id: 1 }, { toggle: true }, eq);
    expect(got).toEqual([]); // toggled the matching ref off
    const added = nextSelection(cur, { kind: "markup", id: 1 }, { toggle: true }, eq);
    expect(added).toHaveLength(2); // different kind, same id → distinct
  });
  it("tolerates a non-array current", () => {
    expect(nextSelection(null, "a", { add: true })).toEqual(["a"]);
  });
});

describe("cornerGrips — four square grips centered on the bbox corners", () => {
  it("places a grip at each corner", () => {
    const grips = cornerGrips({ x: 0, y: 0, w: 100, h: 50 }, 8);
    expect(grips).toHaveLength(4);
    // top-left grip is centered on (0,0): offset by half the grip size
    expect(grips[0]).toEqual({ x: -4, y: -4, w: 8, h: 8 });
    // bottom-right grip centered on (100,50)
    expect(grips[2]).toEqual({ x: 96, y: 46, w: 8, h: 8 });
  });
  it("defaults to the shared grip size", () => {
    expect(cornerGrips({ x: 0, y: 0, w: 10, h: 10 })[0].w).toBe(SEL.gripPx);
  });
});
