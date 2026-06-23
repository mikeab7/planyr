import { describe, it, expect } from "vitest";
import { reorderWithinPage, arrangeFlags, ARRANGE_MODES } from "../src/workspaces/doc-review/lib/arrange.js";

// Build a markups array; ids spell the draw order so assertions read as a stack bottom→top.
const mk = (id, page = 1) => ({ id, page, kind: "rect", pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
const ids = (arr) => arr.map((m) => m.id);

describe("doc-review markup Arrange (z-order) — reorderWithinPage", () => {
  it("Bring to Front moves the selected markup to the END of its page group (drawn on top)", () => {
    const a = [mk("A"), mk("B"), mk("C")];
    expect(ids(reorderWithinPage(a, "A", "front"))).toEqual(["B", "C", "A"]);
  });

  it("Send to Back moves it to the START of its page group (drawn at the bottom)", () => {
    const a = [mk("A"), mk("B"), mk("C")];
    expect(ids(reorderWithinPage(a, "C", "back"))).toEqual(["C", "A", "B"]);
  });

  it("Bring Forward swaps with the next peer above (one step toward the top)", () => {
    const a = [mk("A"), mk("B"), mk("C"), mk("D")];
    expect(ids(reorderWithinPage(a, "B", "forward"))).toEqual(["A", "C", "B", "D"]);
  });

  it("Send Backward swaps with the previous peer below (one step toward the bottom)", () => {
    const a = [mk("A"), mk("B"), mk("C"), mk("D")];
    expect(ids(reorderWithinPage(a, "C", "backward"))).toEqual(["A", "C", "B", "D"]);
  });

  it("forward then backward is the identity (single-step ops are inverses)", () => {
    const a = [mk("A"), mk("B"), mk("C"), mk("D")];
    const fwd = reorderWithinPage(a, "B", "forward");
    expect(ids(reorderWithinPage(fwd, "B", "backward"))).toEqual(["A", "B", "C", "D"]);
  });

  it("returns the SAME array reference for end-of-stack no-ops (so callers skip history/setState)", () => {
    const a = [mk("A"), mk("B"), mk("C")];
    expect(reorderWithinPage(a, "C", "front")).toBe(a);    // already topmost
    expect(reorderWithinPage(a, "C", "forward")).toBe(a);  // already topmost
    expect(reorderWithinPage(a, "A", "back")).toBe(a);     // already bottom
    expect(reorderWithinPage(a, "A", "backward")).toBe(a); // already bottom
  });

  it("a lone markup on its sheet is a no-op for every mode", () => {
    const a = [mk("solo")];
    for (const mode of ARRANGE_MODES) expect(reorderWithinPage(a, "solo", mode)).toBe(a);
  });

  it("unknown id or unknown mode is a no-op (same reference)", () => {
    const a = [mk("A"), mk("B")];
    expect(reorderWithinPage(a, "ZZZ", "front")).toBe(a);
    expect(reorderWithinPage(a, "A", "sideways")).toBe(a);
  });

  it("only reorders WITHIN the selected markup's page — other sheets keep their absolute slots", () => {
    // Interleaved pages: A(p1) X(p2) B(p1) Y(p2) C(p1). Bringing A to front of page 1 must leave
    // X and Y exactly where they are (positions 1 and 3 of the global array).
    const a = [mk("A", 1), mk("X", 2), mk("B", 1), mk("Y", 2), mk("C", 1)];
    const out = reorderWithinPage(a, "A", "front");
    expect(ids(out)).toEqual(["B", "X", "C", "Y", "A"]); // page-1 group B,C,A; page-2 X,Y untouched in place
    expect(out[1].id).toBe("X");
    expect(out[3].id).toBe("Y");
  });

  it("does not mutate the input array", () => {
    const a = [mk("A"), mk("B"), mk("C")];
    const before = ids(a);
    reorderWithinPage(a, "A", "front");
    expect(ids(a)).toEqual(before);
  });
});

describe("arrangeFlags — stack position + no-op gating", () => {
  it("reports index, count, and the top/bottom flags within the page group", () => {
    const a = [mk("A"), mk("B"), mk("C")];
    expect(arrangeFlags(a, "A")).toMatchObject({ page: 1, count: 3, index: 0, atTop: false, atBottom: true });
    expect(arrangeFlags(a, "B")).toMatchObject({ index: 1, atTop: false, atBottom: false });
    expect(arrangeFlags(a, "C")).toMatchObject({ index: 2, atTop: true, atBottom: false });
  });

  it("a lone markup reads atTop AND atBottom (all four ops disable)", () => {
    expect(arrangeFlags([mk("solo")], "solo")).toMatchObject({ count: 1, atTop: true, atBottom: true });
  });

  it("counts peers per page, not globally", () => {
    const a = [mk("A", 1), mk("X", 2), mk("B", 1)];
    expect(arrangeFlags(a, "A")).toMatchObject({ page: 1, count: 2, index: 0 });
    expect(arrangeFlags(a, "X")).toMatchObject({ page: 2, count: 1, atTop: true, atBottom: true });
  });

  it("returns null for an unknown id / non-array input", () => {
    expect(arrangeFlags([mk("A")], "ZZZ")).toBeNull();
    expect(arrangeFlags(null, "A")).toBeNull();
  });
});
