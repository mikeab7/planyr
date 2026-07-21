import { describe, it, expect } from "vitest";
import { pickMarkup, pickMarkupIndex, hitEditPath, hitMarkup, scoreMarkup, hitCalloutLeaderIndex } from "../src/shared/markup/hitTest.js";

/* B423 / B155 — the shared hit-test. Tolerances are screen px ÷ view.scale; tests use
 * scale 1 so px == world units for legibility. Markups are seeded in BOTH host forms:
 * Document Review's flat `pts` and the Site Planner's { a, b } line. */
const view = { scale: 1, tx: 0, ty: 0 };

const sq = { id: "a", kind: "area", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
const openLine = { id: "b", kind: "polyline", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
const siteLine = { id: "c", kind: "line", a: { x: 0, y: 0 }, b: { x: 50, y: 50 } };
const note = { id: "d", kind: "text", pts: [{ x: 200, y: 200 }], text: "hi" };
const counts = { id: "e", kind: "count", pts: [{ x: 10, y: 10 }, { x: 80, y: 80 }] };

describe("hitMarkup — per-kind rules", () => {
  it("a filled ring is hit on its interior", () => {
    expect(hitMarkup(sq, { x: 50, y: 50 }, 1)).toBe(true);   // dead centre
    expect(hitMarkup(sq, { x: 300, y: 300 }, 1)).toBe(false); // far outside
  });
  it("an open polyline is hit only near its edge, not in the 'inside' of its span", () => {
    expect(hitMarkup(openLine, { x: 50, y: 0.5 }, 2)).toBe(true);   // on the line
    expect(hitMarkup(openLine, { x: 50, y: 40 }, 2)).toBe(false);   // off the line
  });
  it("a Site Planner { a, b } line hits via the model's point normalization", () => {
    expect(hitMarkup(siteLine, { x: 25, y: 25 }, 2)).toBe(true);
    expect(hitMarkup(siteLine, { x: 25, y: 40 }, 2)).toBe(false);
  });
  it("a text anchor and count markers are forgiving point targets", () => {
    expect(hitMarkup(note, { x: 205, y: 203 }, 1, 10)).toBe(true);
    expect(hitMarkup(counts, { x: 81, y: 82 }, 1, 10)).toBe(true);
    expect(hitMarkup(counts, { x: 45, y: 45 }, 1, 10)).toBe(false); // between markers, not on a connecting line
  });

  // B521: a closed box stored as TWO opposite corners (the Document Review form) must be hit on
  // its whole interior + outline, not just the diagonal between the two corners.
  it("a 2-corner rect/cloud/snapshot is hit on its interior and every rendered edge, not just the diagonal", () => {
    for (const kind of ["rect", "cloud", "snapshot"]) {
      const box = { id: "x", kind, pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
      expect(hitMarkup(box, { x: 80, y: 20 }, 1)).toBe(true);  // off-diagonal interior (missed before)
      expect(hitMarkup(box, { x: 50, y: 0.5 }, 1)).toBe(true); // rendered top edge (missed before)
      expect(hitMarkup(box, { x: 50, y: 50 }, 1)).toBe(true);  // centre
      expect(hitMarkup(box, { x: 150, y: 50 }, 1)).toBe(false); // outside
    }
  });
  it("a 2-corner ellipse is hit inside the ellipse but NOT at the bounding-box corner", () => {
    const el = { id: "y", kind: "ellipse", pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
    expect(hitMarkup(el, { x: 50, y: 50 }, 1)).toBe(true);   // centre
    expect(hitMarkup(el, { x: 50, y: 6 }, 1)).toBe(true);    // near the top of the ellipse
    expect(hitMarkup(el, { x: 2, y: 2 }, 1)).toBe(false);    // bbox corner — outside the ellipse
  });
});

describe("scoreMarkup — distance + interior flag (the reference feel)", () => {
  it("reports an interior grab as distance 0", () => {
    expect(scoreMarkup(sq, { x: 50, y: 50 }, 6, 10)).toMatchObject({ d: 0, interior: true });
  });
  it("reports an outline hit with its real distance and returns null beyond tolerance", () => {
    const s = scoreMarkup(openLine, { x: 50, y: 4 }, 6, 10);
    expect(s.interior).toBe(false);
    expect(s.d).toBeCloseTo(4, 6);
    expect(scoreMarkup(openLine, { x: 50, y: 40 }, 6, 10)).toBe(null);
  });
  it("hits the full text BOX (needs scale), not just the anchor point", () => {
    // "hello world" is 11 chars → box ≈ (11*6.5+6)=77.5 wide from x-2; far end is selectable.
    const longNote = { id: "t", kind: "text", pts: [{ x: 200, y: 200 }], text: "hello world" };
    expect(scoreMarkup(longNote, { x: 260, y: 200 }, 6, 10, 1)).toMatchObject({ d: 0, interior: true });
    // with no scale it degrades to the anchor + markerTol (far end then misses)
    expect(scoreMarkup(longNote, { x: 260, y: 200 }, 6, 10, 0)).toBe(null);
  });
  it("hits a callout on its text-box body AND its leader line", () => {
    const call = { id: "co", kind: "callout", pts: [{ x: 300, y: 300 }, { x: 400, y: 350 }], text: "hi" };
    expect(scoreMarkup(call, { x: 430, y: 360 }, 6, 10, 1)).toMatchObject({ d: 0, interior: true }); // body box
    const leader = scoreMarkup(call, { x: 350, y: 325 }, 6, 10, 1); // midpoint of the leader
    expect(leader).not.toBe(null);
    expect(leader.interior).toBe(false);
    expect(scoreMarkup(call, { x: 300, y: 250 }, 6, 10, 1)).toBe(null); // nowhere near either
  });
  it("gives a closed perimeter loop an interior grab (a closed shape selects from inside)", () => {
    const perim = { id: "pm", kind: "perimeter", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    expect(scoreMarkup(perim, { x: 50, y: 50 }, 6, 10)).toMatchObject({ d: 0, interior: true });
  });
});

describe("pickMarkup — nearest, then smallest-area, then top-most", () => {
  it("returns the smaller shape when two overlap (top-most is smaller here)", () => {
    const under = { id: "under", kind: "area", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const over = { id: "over", kind: "area", pts: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] };
    expect(pickMarkup([under, over], { x: 50, y: 50 }, view).id).toBe("over");
  });
  it("SMALLEST-area wins even when the small shape is UNDERNEATH the big one (B374)", () => {
    // small drawn FIRST (bottom), big unfilled-style area drawn OVER it. A click in the overlap
    // must still grab the small one, not be swallowed by the big shape painted on top.
    const small = { id: "small", kind: "area", pts: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] };
    const big = { id: "big", kind: "area", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    expect(pickMarkup([small, big], { x: 50, y: 50 }, view).id).toBe("small");
  });
  it("an exact tie (same distance + same area) goes to the top-most / last-drawn", () => {
    const a1 = { id: "a1", kind: "area", pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] };
    const a2 = { id: "a2", kind: "area", pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] };
    expect(pickMarkup([a1, a2], { x: 10, y: 10 }, view).id).toBe("a2");
  });
  it("honours a tolerance override (Document Review selects within 10 px, not the 6 px default)", () => {
    expect(pickMarkup([openLine], { x: 50, y: 8 }, view)).toBe(null);                    // 8 px off, default 6 px → miss
    expect(pickMarkup([openLine], { x: 50, y: 8 }, view, { tolPx: 10 }).id).toBe("b");    // within 10 px → hit
  });
  it("returns null when nothing is under the point; index variant returns -1", () => {
    expect(pickMarkup([sq, openLine], { x: 999, y: 999 }, view)).toBe(null);
    expect(pickMarkupIndex([sq, openLine], { x: 999, y: 999 }, view)).toBe(-1);
  });
  it("respects a filter (e.g. skip locked markups)", () => {
    const locked = { ...sq, id: "locked", locked: true };
    const got = pickMarkup([locked], { x: 50, y: 50 }, view, { filter: (m) => !m.locked });
    expect(got).toBe(null);
  });
});

describe("hitEditPath — vertex beats edge", () => {
  it("grabs a vertex when near one", () => {
    const h = hitEditPath(sq, { x: 2, y: 2 }, view);
    expect(h).toMatchObject({ type: "vertex", index: 0 });
  });
  it("grabs an edge (to insert a vertex) when between vertices", () => {
    const h = hitEditPath(sq, { x: 50, y: 1 }, view);
    expect(h.type).toBe("edge");
    expect(h.index).toBe(0);               // segment 0 → 1 (top edge)
    expect(h.point.x).toBeCloseTo(50, 6);  // projected onto the edge
  });
  it("returns null when the click is far from any vertex or edge", () => {
    expect(hitEditPath(sq, { x: 50, y: 50 }, view)).toBe(null); // interior, not on the path
  });
  it("closes the loop for a ring so the last→first edge is editable", () => {
    const h = hitEditPath(sq, { x: 0.5, y: 50 }, view); // on the left (closing) edge
    expect(h.type).toBe("edge");
    expect(h.index).toBe(3);
  });
});

describe("multi-leader callout hit-test (B909/NEW-2)", () => {
  // Box at (400,350), 3 leaders fanning out in different directions.
  const co3 = { id: "co3", kind: "callout", text: "hi",
    pts: [{ x: 200, y: 350 }, { x: 460, y: 200 }, { x: 460, y: 500 }, { x: 400, y: 350 }] };

  it("still hits the box interior with a scale (WYSIWYG box test)", () => {
    expect(scoreMarkup(co3, { x: 415, y: 358 }, 6, 10, 1)).toMatchObject({ d: 0, interior: true });
  });
  // The box is ~60×14 (short text), so each leader's nearest-edge origin lands at a box corner:
  // leader 0 (tip left of the box, y level with the top edge) → top-left corner, running along y=350;
  // leader 1 (tip above-right) → top-right corner (460,350), running up the vertical x=460;
  // leader 2 (tip below-right) → bottom-right corner (460,364), running down the vertical x=460.
  it("hits each of the 3 leader lines independently", () => {
    expect(scoreMarkup(co3, { x: 300, y: 350 }, 6, 10, 1)).toMatchObject({ interior: false }); // leader 0
    expect(scoreMarkup(co3, { x: 460, y: 275 }, 6, 10, 1)).toMatchObject({ interior: false }); // leader 1
    expect(scoreMarkup(co3, { x: 460, y: 430 }, 6, 10, 1)).toMatchObject({ interior: false }); // leader 2
  });
  it("misses far from every leader and the box", () => {
    expect(scoreMarkup(co3, { x: 0, y: 0 }, 6, 10, 1)).toBe(null);
  });

  it("hitCalloutLeaderIndex picks out the specific leader under the point", () => {
    expect(hitCalloutLeaderIndex(co3, { x: 300, y: 350 }, view, { tolPx: 10 })).toBe(0);
    expect(hitCalloutLeaderIndex(co3, { x: 460, y: 275 }, view, { tolPx: 10 })).toBe(1);
    expect(hitCalloutLeaderIndex(co3, { x: 460, y: 430 }, view, { tolPx: 10 })).toBe(2);
  });
  it("hitCalloutLeaderIndex returns -1 off any leader, on a non-callout, or with no leaders", () => {
    expect(hitCalloutLeaderIndex(co3, { x: 0, y: 0 }, view, { tolPx: 10 })).toBe(-1);
    expect(hitCalloutLeaderIndex(sq, { x: 50, y: 50 }, view, { tolPx: 10 })).toBe(-1);
    const boxOnly = { id: "bo", kind: "callout", text: "hi", pts: [{ x: 5, y: 5 }] };
    expect(hitCalloutLeaderIndex(boxOnly, { x: 5, y: 5 }, view, { tolPx: 10 })).toBe(-1);
  });

  it("a box-only callout (0 leaders, post-removal) hits only its box, not a phantom leader", () => {
    const boxOnly = { id: "bo2", kind: "callout", text: "note", pts: [{ x: 100, y: 100 }] };
    expect(scoreMarkup(boxOnly, { x: 110, y: 105 }, 6, 10, 1)).toMatchObject({ d: 0, interior: true });
    expect(scoreMarkup(boxOnly, { x: 100, y: 100 }, 6, 10, 0)).toMatchObject({ interior: false }); // geometry-only fallback (no scale)
  });
});
