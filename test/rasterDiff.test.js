import { describe, it, expect } from "vitest";
import { dilate2D, classifyDiff, clusterChanges, diffRasters, DIFF_BG, DIFF_SAME, DIFF_REMOVED, DIFF_ADDED } from "../src/shared/files/rasterDiff.js";

/* B471 — the pure pixel-diff engine behind "compare versions". Built on tiny hand-drawn binaries so
 * the hard rules are pinned: tolerance absorbs 1px jitter (no false halo), real adds/removes are
 * caught, and changed pixels cluster into navigable regions. */

// Build a W×H binary (1=ink) from rows of strings: '#'/'1' = ink, anything else = background.
function grid(rows) {
  const H = rows.length, W = rows[0].length;
  const bin = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bin[y * W + x] = (rows[y][x] === "#" || rows[y][x] === "1") ? 1 : 0;
  return { bin, W, H };
}

describe("dilate2D — separable binary dilation", () => {
  it("grows a single pixel into a (2r+1)² block", () => {
    const { bin, W, H } = grid([
      ".....",
      ".....",
      "..#..",
      ".....",
      ".....",
    ]);
    const d = dilate2D(bin, W, H, 1);
    // a 3×3 block centered at (2,2)
    let on = 0;
    for (let i = 0; i < d.length; i++) on += d[i];
    expect(on).toBe(9);
    expect(d[2 * W + 2]).toBe(1);
    expect(d[1 * W + 1]).toBe(1);
    expect(d[3 * W + 3]).toBe(1);
    expect(d[0]).toBe(0);
  });
  it("r=0 is a no-op (copy)", () => {
    const { bin, W, H } = grid(["#.", ".#"]);
    const d = dilate2D(bin, W, H, 0);
    expect([...d]).toEqual([...bin]);
  });
});

describe("classifyDiff — removed / added / unchanged", () => {
  it("catches an added line and a removed line", () => {
    // A has a horizontal line on row 1; B has a horizontal line on row 3 (line moved far).
    const A = grid([".....", "#####", ".....", ".....", "....."]);
    const B = grid([".....", ".....", ".....", "#####", "....."]);
    const codes = classifyDiff(A.bin, B.bin, A.W, A.H, { tol: 1 });
    // row 1 ink only in A → removed
    expect(codes[1 * A.W + 2]).toBe(DIFF_REMOVED);
    // row 3 ink only in B → added
    expect(codes[3 * A.W + 2]).toBe(DIFF_ADDED);
    // empty corner → bg
    expect(codes[0]).toBe(DIFF_BG);
  });
  it("a 1px jitter is NOT flagged (tolerance) — the key false-positive guard", () => {
    // identical vertical line, shifted right by exactly 1px between revs.
    const A = grid(["..#..", "..#..", "..#..", "..#..", "..#.."]);
    const B = grid(["...#.", "...#.", "...#.", "...#.", "...#."]);
    const { regions } = diffRasters(A.bin, B.bin, A.W, A.H, { tol: 1, minArea: 1 });
    // with tol=1, the 1px shift is absorbed → zero change regions
    expect(regions.length).toBe(0);
    const codes = classifyDiff(A.bin, B.bin, A.W, A.H, { tol: 1 });
    // no pixel classified removed/added
    expect([...codes].some((c) => c === DIFF_REMOVED || c === DIFF_ADDED)).toBe(false);
  });
  it("WITHOUT tolerance the same 1px jitter DOES flag (proves tol is what saves us)", () => {
    const A = grid(["..#..", "..#..", "..#.."]);
    const B = grid(["...#.", "...#.", "...#."]);
    const codes = classifyDiff(A.bin, B.bin, A.W, A.H, { tol: 0 });
    expect([...codes].some((c) => c === DIFF_REMOVED)).toBe(true);
    expect([...codes].some((c) => c === DIFF_ADDED)).toBe(true);
  });
  it("ink present in both (within tol) is unchanged", () => {
    const A = grid(["##", "##"]);
    const B = grid(["##", "##"]);
    const codes = classifyDiff(A.bin, B.bin, A.W, A.H, { tol: 1 });
    expect([...codes].every((c) => c === DIFF_SAME)).toBe(true);
  });
});

describe("clusterChanges + diffRasters — navigable change regions", () => {
  it("clusters added + removed blocks into separate regions with bbox/kind/centroid", () => {
    // A: a 2×2 block top-left (removed). B: a 2×2 block bottom-right (added). Far apart.
    const A = grid(["##.....", "##.....", ".......", ".......", ".......", ".......", "......."]);
    const B = grid([".......", ".......", ".......", ".......", ".......", ".....##", ".....##"]);
    const { regions, counts } = diffRasters(A.bin, B.bin, A.W, A.H, { tol: 0, minArea: 2 });
    expect(regions.length).toBe(2);
    expect(counts.removed).toBe(1);
    expect(counts.added).toBe(1);
    const removed = regions.find((r) => r.kind === "removed");
    const added = regions.find((r) => r.kind === "added");
    expect(removed.bbox).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(added.bbox).toEqual({ x: 5, y: 5, w: 2, h: 2 });
    expect(removed.area).toBe(4);
  });
  it("drops sub-minArea speckle", () => {
    // one stray added pixel only
    const A = grid(["....", "....", "...."]);
    const B = grid(["....", "..#.", "...."]);
    const big = diffRasters(A.bin, B.bin, A.W, A.H, { tol: 0, minArea: 1 });
    expect(big.regions.length).toBe(1);
    const filtered = diffRasters(A.bin, B.bin, A.W, A.H, { tol: 0, minArea: 4 });
    expect(filtered.regions.length).toBe(0);
  });
  it("a touching removed+added cluster is 'mixed'", () => {
    // A row of removed ink directly above a row of added ink (8-connected) → one mixed region.
    const A = grid(["###", "...", "..."]);
    const B = grid(["...", "###", "..."]);
    const codes = classifyDiff(A.bin, B.bin, A.W, A.H, { tol: 0 });
    const regions = clusterChanges(codes, A.W, A.H, { minArea: 1, connectivity: 8 });
    expect(regions.length).toBe(1);
    expect(regions[0].kind).toBe("mixed");
  });
  it("does not wrap horizontally across row edges", () => {
    // ink at right edge of row 0 and left edge of row 1 must NOT join via wrap.
    const A = grid(["..#", "...", "..."]);
    const B = grid(["...", "#..", "..."]);
    const codes = classifyDiff(A.bin, B.bin, A.W, A.H, { tol: 0 });
    const regions = clusterChanges(codes, A.W, A.H, { minArea: 1, connectivity: 8 });
    expect(regions.length).toBe(2); // separate, not wrapped into one
  });
});
