import { describe, it, expect } from "vitest";
import { detectedEndpointsFor, oppositeSide, buildAdjacency, autoPlaceGroup } from "../src/workspaces/doc-review/lib/autoStitch.js";
import { fwd } from "../src/workspaces/doc-review/lib/stitchGeom.js";

const DA = { x: 0, y: 0, w: 1900, h: 1584 }; // drawing area (page minus right-edge title block)

const sheet = (id, sheetNumber, matchLines, drawingArea = DA) => ({ id, sheetNumber, matchLines, drawingArea });

describe("detectedEndpointsFor — seam endpoints in a consistent order (B327)", () => {
  it("returns the drawing-area edge endpoints per side", () => {
    expect(detectedEndpointsFor(DA, "right")).toEqual([{ x: 1900, y: 0 }, { x: 1900, y: 1584 }]);
    expect(detectedEndpointsFor(DA, "left")).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1584 }]);
    expect(detectedEndpointsFor(DA, "top")).toEqual([{ x: 0, y: 0 }, { x: 1900, y: 0 }]);
    expect(oppositeSide("right")).toBe("left");
  });
});

describe("buildAdjacency — seam graph from match-line targets", () => {
  it("links two sheets that name each other and infers opposite sides", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }]);
    const adj = buildAdjacency([a, b]);
    expect(adj.get("a")).toMatchObject([{ side: "right", otherSide: "left" }]);
    expect(adj.get("b")).toMatchObject([{ side: "left", otherSide: "right" }]);
  });
});

describe("autoPlaceGroup — place sheets from their seams via solveM (B327)", () => {
  it("places C-6 immediately right of C-5, seam coincident", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }]);
    const { placements, ok, unplaced } = autoPlaceGroup([a, b]);
    expect(ok).toBe(true);
    expect(unplaced).toEqual([]);
    const Mb = placements.get("b");
    // b's LEFT edge lands exactly on a's RIGHT edge (a is the identity-placed anchor).
    expect(fwd(Mb, { x: 0, y: 0 })).toMatchObject({ x: 1900, y: 0 });
    expect(fwd(Mb, { x: 0, y: 1584 })).toMatchObject({ x: 1900, y: 1584 });
    // and b sits to the right (its own right edge is further out)
    expect(fwd(Mb, { x: 1900, y: 0 }).x).toBeGreaterThan(1900);
  });
  it("walks a 3-sheet chain C-5 → C-6 → C-7 with coincident seams, left-to-right", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }, { target: "C-7", side: "right" }]);
    const c = sheet("c", "C-7", [{ target: "C-6", side: "left" }]);
    const { placements, ok } = autoPlaceGroup([a, b, c]);
    expect(ok).toBe(true);
    const leftX = (id) => fwd(placements.get(id), { x: 0, y: 0 }).x;
    const rightX = (id) => fwd(placements.get(id), { x: 1900, y: 0 }).x;
    // seams coincide: C-5's right edge == C-6's left edge; C-6's right == C-7's left
    expect(rightX("a")).toBeCloseTo(leftX("b"), 3);
    expect(rightX("b")).toBeCloseTo(leftX("c"), 3);
    // and they read left-to-right C-5 < C-6 < C-7
    expect(leftX("a")).toBeLessThan(leftX("b"));
    expect(leftX("b")).toBeLessThan(leftX("c"));
  });
  it("leaves a label-less sheet UNPLACED so the caller can fall back to manual align", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }]);
    const orphan = sheet("c", "C-9", []); // no seam → can't auto-place
    const { ok, placed, unplaced } = autoPlaceGroup([a, b, orphan]);
    expect(ok).toBe(false);
    expect(placed).toEqual(expect.arrayContaining(["a", "b"]));
    expect(unplaced).toEqual(["c"]);
  });
});
