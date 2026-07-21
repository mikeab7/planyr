// FINAL UI SPEC A5 — the schematic pond cross-section's two elevation labels ("flood
// level" at the right end of the dashed WSE line, "pond rim" at the left rim edge) must not
// overlap, even when the flood WSE and the rim land at nearly the same height. This guards
// the anchor split + the belt-and-suspenders collision nudge with a pure bbox intersection
// check (no DOM — the width estimate is a heuristic in lib/pondChangeSummary.js).
import { describe, it, expect } from "vitest";
import { pondCrossSectionMarks, pondLabelBBox, boxesIntersect } from "../src/workspaces/site-planner/lib/pondChangeSummary.js";

const labelMark = (marks, role) => marks.find((m) => m.t === "text" && m.role === role);

describe("A5 — cross-section flood/rim label non-intersection", () => {
  it("boxesIntersect / pondLabelBBox behave", () => {
    // Non-overlapping in x
    const a = pondLabelBBox({ x: 0, y: 20, s: "flood level", anchor: "start" });
    const b = pondLabelBBox({ x: 200, y: 20, s: "pond rim", anchor: "start" });
    expect(boxesIntersect(a, b)).toBe(false);
    // Overlapping (same spot) → intersect
    const c = pondLabelBBox({ x: 10, y: 20, s: "pond rim", anchor: "start" });
    const d = pondLabelBBox({ x: 12, y: 21, s: "flood level", anchor: "start" });
    expect(boxesIntersect(c, d)).toBe(true);
    // "end" anchor extends the box to the LEFT of x
    const e = pondLabelBBox({ x: 280, y: 20, s: "flood level", anchor: "end" });
    expect(e.x1).toBe(280);
    expect(e.x0).toBeLessThan(280);
  });

  it("flood level anchors right, pond rim anchors left", () => {
    const { marks, w } = pondCrossSectionMarks({
      gradeFt: 100, wseFt: 104,
      before: { tobElevFt: 103, depthFt: 8 },
      after: { tobElevFt: 106, depthFt: 8 },
    });
    const flood = labelMark(marks, "wseLabel");
    const rim = labelMark(marks, "rimLabel");
    expect(flood).toBeTruthy();
    expect(rim).toBeTruthy();
    expect(flood.anchor).toBe("end");
    expect(flood.x).toBe(w - 4);
    expect(rim.anchor).toBe("start");
  });

  it("their estimated bounding boxes never intersect — even when WSE ≈ rim height", () => {
    // Force the flood WSE and the new rim to nearly the same elevation (the old overlap case).
    for (const [wse, rim] of [[104, 104.2], [100, 100], [153.1, 153.0], [98, 120]]) {
      const { marks } = pondCrossSectionMarks({
        gradeFt: 96, wseFt: wse,
        before: { tobElevFt: rim - 1, depthFt: 6 },
        after: { tobElevFt: rim, depthFt: 6 },
        w: 280, h: 130,
      });
      const flood = labelMark(marks, "wseLabel");
      const rimL = labelMark(marks, "rimLabel");
      if (!flood || !rimL) continue;
      expect(boxesIntersect(pondLabelBBox(flood), pondLabelBBox(rimL))).toBe(false);
    }
  });
});
