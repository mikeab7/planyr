import { describe, it, expect } from "vitest";
import { deedOverlayPlan, deedOverlayRecord, restoredDeedMarkups, DEED_OVERLAY_MAX_PX, DEED_OVERLAY_PAD_PX } from "../src/workspaces/site-planner/lib/deedOverlay.js";

const ring = [{ x: 100, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 600 }, { x: 100, y: 600 }];
const hole = [{ x: 300, y: 300 }, { x: 500, y: 300 }, { x: 500, y: 500 }, { x: 300, y: 500 }];
const main = { id: "a", kind: "encumbrance", pts: ring, label: "Tract 1", stroke: "#7c3aed", fill: "#7c3aed", fillOpacity: 0.14, weight: 2, dash: "solid", deedGroup: "g", except: false, locked: true };
const exc = { id: "b", kind: "encumbrance", pts: hole, label: "Except", stroke: "#b91c1c", fill: "#b91c1c", fillOpacity: 0.1, weight: 2, dash: "6 4", deedGroup: "g", except: true };

describe("deedOverlayPlan", () => {
  it("places the picture over the deed's own bounds, in feet, so the outline lands where the deed was", () => {
    const p = deedOverlayPlan([main, exc]);
    // the picture's top-left is the deed's top-left minus the padding, and the first corner draws at the padding
    expect(p.x).toBeCloseTo(100 - DEED_OVERLAY_PAD_PX * p.ftPerPx, 6);
    expect(p.y).toBeCloseTo(200 - DEED_OVERLAY_PAD_PX * p.ftPerPx, 6);
    expect(p.shapes[0].pts[0].x).toBeCloseTo(DEED_OVERLAY_PAD_PX, 6);
    // a point drawn in pixels maps back to the same feet
    const q = p.shapes[0].pts[2];
    expect(p.x + q.x * p.ftPerPx).toBeCloseTo(700, 4);
    expect(p.y + q.y * p.ftPerPx).toBeCloseTo(600, 4);
  });
  it("keeps the longest side at the budget and the aspect ratio of the deed", () => {
    const p = deedOverlayPlan([main]);
    expect(Math.max(p.imgW, p.imgH)).toBeLessThanOrEqual(DEED_OVERLAY_MAX_PX + 2);
    expect(p.imgW / p.imgH).toBeCloseTo(600 / 400, 1);
  });
  it("draws every member with its own look (exceptions stay dashed red)", () => {
    const p = deedOverlayPlan([main, exc]);
    expect(p.shapes.map((s) => s.stroke)).toEqual(["#7c3aed", "#b91c1c"]);
    expect(p.shapes.map((s) => s.dashed)).toEqual([false, true]);
    expect(p.name).toBe("Tract 1");
  });
  it("says there is nothing to convert for a deed with no shape", () => {
    expect(deedOverlayPlan([{ ...main, pts: [] }])).toBeNull();
    expect(deedOverlayPlan([])).toBeNull();
  });
});

describe("converting back", () => {
  it("rebuilds the whole tract with NEW ids and one NEW group, unlocked (old ids were tombstoned)", () => {
    const rec = deedOverlayRecord([main, exc]);
    let n = 0;
    const out = restoredDeedMarkups(rec, () => "n" + ++n, "G2");
    expect(out.map((m) => m.id)).toEqual(["n1", "n2"]);
    expect(out.every((m) => m.deedGroup === "G2")).toBe(true);
    expect(out.every((m) => !m.locked)).toBe(true);
    expect(out[0].pts).toEqual(ring);
  });
  it("the snapshot is a copy: later edits to the live markup do not change it", () => {
    const live = { ...main, pts: [...ring] };
    const rec = deedOverlayRecord([live]);
    live.pts.push({ x: 0, y: 0 });
    expect(rec.markups[0].pts).toHaveLength(4);
  });
});
