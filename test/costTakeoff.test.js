import { describe, it, expect } from "vitest";
import {
  SF_PER_SY, DEFAULT_PAN_WIDTH, CURB_TYPES,
  roadCurbType, roadCurbedSides, roadPanWidth, roadQuantities, costRollup,
} from "../src/workspaces/site-planner/lib/costTakeoff.js";

describe("road cost attribute readers", () => {
  it("defaults: barrier curb, both sides, no pan", () => {
    expect(roadCurbType({})).toBe("barrier");
    expect(roadCurbedSides({})).toBe(2);
    expect(roadPanWidth({})).toBe(0);
  });
  it("no-curb type forces zero curbed sides and no pan", () => {
    const el = { curbType: "none", curbedSides: 2 };
    expect(roadCurbedSides(el)).toBe(0);
    expect(roadPanWidth(el)).toBe(0);
  });
  it("curb-and-gutter carries a pan; defaults to 24\" when unset", () => {
    expect(roadPanWidth({ curbType: "curb-gutter" })).toBe(DEFAULT_PAN_WIDTH);
    expect(roadPanWidth({ curbType: "curb-gutter", panWidth: 1.5 })).toBe(1.5);
    expect(roadPanWidth({ curbType: "barrier", panWidth: 1.5 })).toBe(0); // barrier has no pan
  });
  it("curbed sides clamps to 0/1/2", () => {
    expect(roadCurbedSides({ curbedSides: 1 })).toBe(1);
    expect(roadCurbedSides({ curbedSides: 5 })).toBe(2); // bad value → default
  });
  it("CURB_TYPES is the canonical list", () => {
    expect(CURB_TYPES).toEqual(["none", "barrier", "curb-gutter"]);
  });
});

describe("roadQuantities — B180: paving excludes curb", () => {
  it("barrier curb: paving is the full FC-FC width (no pan trim)", () => {
    // 30' FC-FC × 1000' = 30,000 SF = 3,333.33 SY of paving; curb 2 sides = 2,000 LF
    const q = roadQuantities({ curbType: "barrier" }, 30, 1000);
    expect(q.pavingWidth).toBe(30);                 // NOT 31 — curb is outside FC-FC
    expect(q.pavingSf).toBe(30000);
    expect(q.pavingSy).toBeCloseTo(30000 / SF_PER_SY, 6);
    expect(q.curbLf).toBe(2000);                    // both sides counted
  });

  it("curb-and-gutter: paving trims by the gutter pan on each curbed side", () => {
    // 30' FC-FC, 2' pan each side → 26' asphalt; curb still 2 sides
    const q = roadQuantities({ curbType: "curb-gutter", panWidth: 2 }, 30, 1000);
    expect(q.pavingWidth).toBe(26);                 // 30 − 2×2
    expect(q.pavingSf).toBe(26000);
    expect(q.curbLf).toBe(2000);
  });

  it("one curbed side only halves the curb LF and trims one pan", () => {
    const q = roadQuantities({ curbType: "curb-gutter", panWidth: 2, curbedSides: 1 }, 30, 1000);
    expect(q.curbLf).toBe(1000);
    expect(q.pavingWidth).toBe(28);                 // 30 − 2×1
  });

  it("no curb: full width is paving, zero curb", () => {
    const q = roadQuantities({ curbType: "none" }, 30, 1000);
    expect(q.pavingWidth).toBe(30);
    expect(q.curbLf).toBe(0);
  });

  it("pan wider than the road can't drive paving negative", () => {
    const q = roadQuantities({ curbType: "curb-gutter", panWidth: 20 }, 30, 100);
    expect(q.pavingWidth).toBe(0);
    expect(q.pavingSf).toBe(0);
  });
});

describe("costRollup", () => {
  const fcfcOf = (el) => el.fcfc;
  const lengthOf = (el) => el.len;
  const els = [
    { type: "road", curbType: "barrier", fcfc: 30, len: 1000 },         // 3333.33 SY, 2000 LF barrier
    { type: "road", curbType: "curb-gutter", panWidth: 2, fcfc: 24, len: 500 }, // (24-4)=20×500=10000sf, 1000 LF gutter
    { type: "building", fcfc: 99, len: 99 },                            // ignored
    { type: "road", points: [{ x: 0, y: 0 }], fcfc: 1, len: 1 },        // poly road ignored
  ];

  it("aggregates quantities, splitting curb LF by type", () => {
    const r = costRollup(els, fcfcOf, lengthOf);
    expect(r.segments).toBe(2);
    expect(r.pavingSy).toBeCloseTo((30000 + 10000) / 9, 6);
    expect(r.curbBarrierLf).toBe(2000);
    expect(r.curbGutterLf).toBe(1000);
  });

  it("no prices supplied → quantities only, no extended cost", () => {
    const r = costRollup(els, fcfcOf, lengthOf);
    expect(r.pavingCost).toBeNull();
    expect(r.curbBarrierCost).toBeNull();
    expect(r.total).toBeNull();
  });

  it("user prices drive extended cost and a total", () => {
    const r = costRollup(els, fcfcOf, lengthOf, { pavingSy: 60, curbBarrierLf: 18, curbGutterLf: 25 });
    expect(r.pavingCost).toBeCloseTo((40000 / 9) * 60, 4);
    expect(r.curbBarrierCost).toBe(2000 * 18);
    expect(r.curbGutterCost).toBe(1000 * 25);
    expect(r.total).toBeCloseTo((40000 / 9) * 60 + 36000 + 25000, 4);
  });

  it("a partial price set still totals only the priced lines", () => {
    const r = costRollup(els, fcfcOf, lengthOf, { curbBarrierLf: 18 });
    expect(r.pavingCost).toBeNull();
    expect(r.curbBarrierCost).toBe(36000);
    expect(r.total).toBe(36000);
  });

  it("blank/garbage prices are treated as unset, not zero", () => {
    const r = costRollup(els, fcfcOf, lengthOf, { pavingSy: "", curbBarrierLf: "abc" });
    expect(r.pavingCost).toBeNull();
    expect(r.curbBarrierCost).toBeNull();
  });
});
