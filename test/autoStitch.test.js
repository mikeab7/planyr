import { describe, it, expect } from "vitest";
import { detectedEndpointsFor, oppositeSide, buildAdjacency, autoPlaceGroup } from "../src/workspaces/doc-review/lib/autoStitch.js";
import { fwd } from "../src/workspaces/doc-review/lib/stitchGeom.js";

const DA = { x: 0, y: 0, w: 1900, h: 1584 }; // drawing area (page minus right-edge title block)

const sheet = (id, sheetNumber, matchLines, drawingArea = DA) => ({ id, sheetNumber, matchLines, drawingArea });

describe("detectedEndpointsFor — seam endpoints in a consistent order (B337)", () => {
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

  // B413 — a SCANNED set's OCR-recovered labels reference by SEQUENCE ("MATCH LINE ~ SHEET 2"),
  // not by sheet code. "SHEET 2" must resolve to the 2nd group member even though its code is "C-3".
  it("resolves a bare-numeric (sequence) target to the Nth group member", () => {
    // C-2 (bottom edge) → "SHEET 2" = the 2nd sheet = C-3; C-3 → "SHEET 1" = C-2.
    const a = sheet("a", "C-2", [{ target: "2", side: "bottom" }]);
    const b = sheet("b", "C-3", [{ target: "1", side: "top" }]);
    const adj = buildAdjacency([a, b]);
    expect(adj.get("a")).toMatchObject([{ other: b, side: "bottom", otherSide: "top" }]);
    expect(adj.get("b")).toMatchObject([{ other: a, side: "top", otherSide: "bottom" }]);
  });

  it("sequence fallback never fires when the target matches a real sheet code", () => {
    // Code lookup wins: "C-2" resolves to the sheet numbered C-2, NOT the 2nd member by index.
    const a = sheet("a", "C-2", [{ target: "C-3", side: "right" }]);
    const b = sheet("b", "C-3", [{ target: "C-2", side: "left" }]);
    const c = sheet("c", "C-4", []);
    const adj = buildAdjacency([a, b, c]);
    // a links to b (code C-3), the actual 2nd member — coincidentally — but via CODE, and c is untouched.
    expect(adj.get("a")).toMatchObject([{ other: b, side: "right", otherSide: "left" }]);
    expect(adj.get("c")).toEqual([]);
  });

  it("ignores a sequence target that is out of range (no phantom edge)", () => {
    const a = sheet("a", "C-2", [{ target: "9", side: "right" }]); // only 2 sheets → index 9 invalid
    const b = sheet("b", "C-3", []);
    const adj = buildAdjacency([a, b]);
    expect(adj.get("a")).toEqual([]);
    expect(adj.get("b")).toEqual([]);
  });

  it("auto-places a scanned L-pair from sequence-referenced labels", () => {
    // C-2 over C-3 (C-2's bottom seam → SHEET 2). Codes are non-sequential vs. index on purpose.
    const a = sheet("a", "C-2", [{ target: "2", side: "bottom" }]);
    const b = sheet("b", "C-3", [{ target: "1", side: "top" }]);
    const { ok, placed, unplaced } = autoPlaceGroup([a, b]);
    expect(ok).toBe(true);
    expect(placed).toEqual(expect.arrayContaining(["a", "b"]));
    expect(unplaced).toEqual([]);
  });
});

describe("autoPlaceGroup — place sheets from their seams via solveM (B337)", () => {
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
