import { describe, it, expect } from "vitest";
import { resampleBinary, compareBinaries } from "../src/shared/files/rasterCompare.js";

/* B464 — the end-to-end PURE compare pipeline (register → resample → diff). The headline guarantee:
 * a revision that merely SHIFTED shows ~no changes (registration cancels it), while a real ADDED
 * feature still surfaces as a change region. */

function blank(W, H) { return new Uint8Array(W * H); }
function fill(bin, W, x, y, w, h) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) bin[(y + j) * W + (x + i)] = 1; return bin; }
function shiftBin(bin, W, H, sx, sy) { const out = blank(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bin[y * W + x]) { const nx = x + sx, ny = y + sy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1; } return out; }

describe("resampleBinary", () => {
  it("identity map copies the source", () => {
    const W = 6, H = 6, src = fill(blank(W, H), W, 1, 1, 2, 2);
    const out = resampleBinary(src, W, H, W, H, (p) => p);
    expect([...out]).toEqual([...src]);
  });
  it("a translation map moves ink", () => {
    const W = 8, H = 8, src = fill(blank(W, H), W, 0, 0, 2, 2);
    // target (x,y) samples source at (x-2, y-1) → ink moves +2,+1 in the output
    const out = resampleBinary(src, W, H, W, H, (p) => ({ x: p.x - 2, y: p.y - 1 }));
    expect(out[1 * W + 2]).toBe(1);
    expect(out[0]).toBe(0);
  });
});

describe("compareBinaries — register then diff", () => {
  it("a purely SHIFTED revision yields ~no change regions (registration cancels the shift)", () => {
    const W = 50, H = 50;
    // a distinctive asymmetric figure
    let A = fill(blank(W, H), W, 10, 10, 18, 4);
    A = fill(A, W, 10, 10, 4, 22);
    const B = shiftBin(A, W, H, 5, 3); // shift the SAME figure by (5,3)
    const res = compareBinaries(A, W, H, B, W, H, { tol: 1, minArea: 6 });
    expect(res.error).toBeUndefined();
    expect(res.transform.confidence).toBe("high");
    expect(res.regions.length).toBe(0); // the shift was registered away → nothing flagged
  });

  it("a real ADDED feature surfaces as a change region even when the sheet also shifted", () => {
    const W = 60, H = 60;
    let A = fill(blank(W, H), W, 12, 12, 20, 4);
    A = fill(A, W, 12, 12, 4, 24);
    // B = same figure shifted (5,3) PLUS a new block the engineer added
    let B = shiftBin(A, W, H, 5, 3);
    B = fill(B, W, 40, 40, 8, 8); // the addition (in B's own frame)
    const res = compareBinaries(A, W, H, B, W, H, { tol: 1, minArea: 6 });
    expect(res.error).toBeUndefined();
    expect(res.transform.confidence).toBe("high");
    // exactly the added block shows up, classified as 'added'
    expect(res.counts.added).toBeGreaterThanOrEqual(1);
    expect(res.counts.removed).toBe(0);
    const added = res.regions.find((r) => r.kind === "added");
    expect(added).toBeTruthy();
    expect(added.area).toBeGreaterThan(30); // ~the 8×8 block (registered)
  });

  it("manualPairs forces the 2-point transform", () => {
    const W = 40, H = 40;
    const A = fill(blank(W, H), W, 8, 8, 10, 10);
    const B = shiftBin(A, W, H, 4, 2);
    const res = compareBinaries(A, W, H, B, W, H, {
      tol: 1, minArea: 6,
      manualPairs: { a: [{ x: 8, y: 8 }, { x: 18, y: 18 }], b: [{ x: 12, y: 10 }, { x: 22, y: 20 }] },
    });
    expect(res.transform.confidence).toBe("manual");
    expect(res.regions.length).toBe(0); // the manual pairs describe the same (4,2) shift
  });

  it("no ink on a side → error (caller drops to manual)", () => {
    const W = 20, H = 20;
    const A = fill(blank(W, H), W, 4, 4, 4, 4);
    const res = compareBinaries(A, W, H, blank(W, H), W, H, {});
    expect(res.error).toBe("no-fit");
  });
});
