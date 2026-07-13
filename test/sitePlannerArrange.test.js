import { describe, it, expect } from "vitest";
import { reorderByZ, arrangeFlags, ARRANGE_MODES } from "../src/workspaces/site-planner/lib/arrange.js";
import { Z_GAP, sortByZ } from "../src/workspaces/site-planner/lib/zOrder.js";

// Peers carry an explicit gapped z (0, 1024, 2048, …) — the state after ensureZ, ids spelling the
// stack bottom→top. `apply` mimics the component: fold a { id: z } patch back onto the peer set and
// read the resulting bottom→top id order via sortByZ.
const peer = (id, z) => ({ id, z, type: "building" });
const stack = (...ids) => ids.map((id, i) => peer(id, i * Z_GAP));
const apply = (peers, patch) => sortByZ(peers.map((p) => (patch && patch[p.id] != null ? { ...p, z: patch[p.id] } : p))).map((p) => p.id);

describe("site-planner Arrange (z-order) — reorderByZ", () => {
  it("Bring to Front lifts the selected item above every peer (top of the band)", () => {
    const a = stack("A", "B", "C");
    expect(apply(a, reorderByZ(a, "A", "front"))).toEqual(["B", "C", "A"]);
  });

  it("Send to Back drops the selected item below every peer (bottom of the band)", () => {
    const a = stack("A", "B", "C");
    expect(apply(a, reorderByZ(a, "C", "back"))).toEqual(["C", "A", "B"]);
  });

  it("Bring Forward swaps z with the next peer above (one step toward the top)", () => {
    const a = stack("A", "B", "C", "D");
    expect(apply(a, reorderByZ(a, "B", "forward"))).toEqual(["A", "C", "B", "D"]);
  });

  it("Send Backward swaps z with the previous peer below (one step toward the bottom)", () => {
    const a = stack("A", "B", "C", "D");
    expect(apply(a, reorderByZ(a, "C", "backward"))).toEqual(["A", "C", "B", "D"]);
  });

  it("forward then backward returns the original stack (single-step ops are inverses)", () => {
    const a = stack("A", "B", "C", "D");
    const fwdPatch = reorderByZ(a, "B", "forward");
    const fwd = a.map((p) => (fwdPatch[p.id] != null ? { ...p, z: fwdPatch[p.id] } : p));
    expect(apply(fwd, reorderByZ(fwd, "B", "backward"))).toEqual(["A", "B", "C", "D"]);
  });

  it("forward/back touch a MINIMAL set of peers (1 for front/back, 2 for a swap)", () => {
    const a = stack("A", "B", "C", "D");
    expect(Object.keys(reorderByZ(a, "A", "front"))).toEqual(["A"]);
    expect(Object.keys(reorderByZ(a, "D", "back"))).toEqual(["D"]);
    expect(Object.keys(reorderByZ(a, "B", "forward")).sort()).toEqual(["B", "C"]);
  });

  it("returns null for end-of-stack no-ops (so callers skip history/setState)", () => {
    const a = stack("A", "B", "C");
    expect(reorderByZ(a, "C", "front")).toBeNull();    // already topmost
    expect(reorderByZ(a, "C", "forward")).toBeNull();  // already topmost
    expect(reorderByZ(a, "A", "back")).toBeNull();     // already bottom
    expect(reorderByZ(a, "A", "backward")).toBeNull(); // already bottom
  });

  it("a lone peer is a no-op for every mode", () => {
    const a = [peer("solo", 0)];
    for (const mode of ARRANGE_MODES) expect(reorderByZ(a, "solo", mode)).toBeNull();
  });

  it("unknown id, unknown mode, or non-array input is a no-op (null)", () => {
    const a = stack("A", "B");
    expect(reorderByZ(a, "ZZZ", "front")).toBeNull();
    expect(reorderByZ(a, "A", "sideways")).toBeNull();
    expect(reorderByZ(null, "A", "front")).toBeNull();
  });

  it("only patches the peers it was given — band isolation is the caller's filter, honored here", () => {
    // Caller passes ONLY the building band; a building arrange must never name a parking id.
    const buildings = stack("b1", "b2", "b3");
    const patch = reorderByZ(buildings, "b1", "front");
    expect(Object.keys(patch).every((id) => id.startsWith("b"))).toBe(true);
  });

  it("repairs ambiguous z (missing / duplicate) so a swap stays well-defined", () => {
    // B and C share z; A has none. A real move renormalizes the band, then applies the move.
    const a = [{ id: "A", type: "building" }, { id: "B", z: 5, type: "building" }, { id: "C", z: 5, type: "building" }];
    const patch = reorderByZ(a, "A", "front");
    expect(patch).not.toBeNull();
    // A ends on top; every peer now has a finite z and the order is unambiguous.
    const order = apply(a, patch);
    expect(order[order.length - 1]).toBe("A");
    expect(order.length).toBe(3);
  });

  it("does not mutate the input peers", () => {
    const a = stack("A", "B", "C");
    const before = a.map((p) => ({ ...p }));
    reorderByZ(a, "A", "front");
    expect(a).toEqual(before);
  });
});

describe("arrangeFlags — stack position + no-op gating (for greying the menu)", () => {
  it("reports index, count, and the top/bottom flags by z order", () => {
    const a = stack("A", "B", "C");
    expect(arrangeFlags(a, "A")).toMatchObject({ count: 3, index: 0, atTop: false, atBottom: true });
    expect(arrangeFlags(a, "B")).toMatchObject({ index: 1, atTop: false, atBottom: false });
    expect(arrangeFlags(a, "C")).toMatchObject({ index: 2, atTop: true, atBottom: false });
  });

  it("orders by z, not array position", () => {
    // Array order and z order disagree: C(z0) B(z1024) A(z2048).
    const a = [peer("A", 2 * Z_GAP), peer("B", Z_GAP), peer("C", 0)];
    expect(arrangeFlags(a, "C")).toMatchObject({ index: 0, atBottom: true });
    expect(arrangeFlags(a, "A")).toMatchObject({ index: 2, atTop: true });
  });

  it("a lone peer reads atTop AND atBottom (all four ops disable)", () => {
    expect(arrangeFlags([peer("solo", 0)], "solo")).toMatchObject({ count: 1, atTop: true, atBottom: true });
  });

  it("returns null for an unknown id / non-array input", () => {
    expect(arrangeFlags([peer("A", 0)], "ZZZ")).toBeNull();
    expect(arrangeFlags(null, "A")).toBeNull();
  });
});
