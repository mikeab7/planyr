import { describe, it, expect } from "vitest";
import { pickMarkup, pickMarkupIndex, hitEditPath, hitMarkup } from "../src/shared/markup/hitTest.js";

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

describe("pickMarkup — top-most wins", () => {
  it("returns the LAST drawn markup when two overlap", () => {
    const under = { id: "under", kind: "area", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const over = { id: "over", kind: "area", pts: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] };
    expect(pickMarkup([under, over], { x: 50, y: 50 }, view).id).toBe("over");
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
