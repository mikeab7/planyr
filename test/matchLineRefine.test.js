import { describe, it, expect } from "vitest";
import { binarizeImageData, fitSeamLine, refineSeamPlacement, plausibleRefine } from "../src/workspaces/doc-review/lib/matchLineRefine.js";
import { fwd } from "../src/workspaces/doc-review/lib/stitchGeom.js";

// A synthetic sheet: a SOLID near-horizontal (or vertical) match line on `side`, plus vertical
// crossing strokes (roads/boundaries) that must be ignored by the fit. Returns { bin, W, H }.
function sheet({ W = 500, H = 400, side = "bottom", m = 0.01, intercept, crossAt = [120, 250, 380], crossSpan = 40 } = {}) {
  const bin = new Uint8Array(W * H);
  const put = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) bin[y * W + x] = 1; };
  const horiz = side === "top" || side === "bottom";
  if (horiz) {
    const b = intercept;
    for (let x = 30; x < W - 30; x++) { const y = Math.round(m * x + b); put(x, y - 1); put(x, y); put(x, y + 1); }
    for (const cx of crossAt) for (let dy = -crossSpan; dy <= crossSpan; dy++) { put(cx, Math.round(m * cx + b) + dy); }
  } else {
    const b = intercept;
    for (let y = 30; y < H - 30; y++) { const x = Math.round(m * y + b); put(x - 1, y); put(x, y); put(x + 1, y); }
    for (const cy of crossAt) for (let dx = -crossSpan; dx <= crossSpan; dx++) { put(Math.round(m * cy + b) + dx, cy); }
  }
  return { bin, W, H };
}

const SPAN = { lo: 0.02, hi: 0.98 };
const degOf = (l) => Math.atan2(l.p2.y - l.p1.y, l.p2.x - l.p1.x) * 180 / Math.PI;

describe("binarizeImageData", () => {
  it("marks dark pixels as ink", () => {
    const data = new Uint8ClampedArray(4 * 4);
    // px0 black, px1 white, px2 mid-dark, px3 light-gray
    const set = (i, v) => { data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; };
    set(0, 0); set(1, 255); set(2, 100); set(3, 200);
    const { bin } = binarizeImageData({ data, width: 4, height: 1 }, 140);
    expect(Array.from(bin)).toEqual([1, 0, 1, 0]);
  });
});

describe("fitSeamLine — endpoints on the real line, both orientations", () => {
  it("horizontal seam: endpoints lie on the known line", () => {
    const s = sheet({ side: "bottom", m: 0.02, intercept: 300 });
    const l = fitSeamLine(s.bin, s.W, s.H, "bottom", { x: 250, y: 300 }, { spanLo: 0.02, spanHi: 0.98 });
    expect(l).toBeTruthy();
    expect(Math.abs(degOf(l) - Math.atan(0.02) * 180 / Math.PI)).toBeLessThan(0.6);
  });
  it("vertical seam: handled via transpose", () => {
    const s = sheet({ side: "right", m: 0.02, intercept: 360 });
    const l = fitSeamLine(s.bin, s.W, s.H, "right", { x: 360, y: 200 }, { spanLo: 0.02, spanHi: 0.98 });
    expect(l).toBeTruthy();
    // endpoints should be ordered top→bottom and sit near x≈0.02·y+360
    expect(Math.abs(l.p1.x - (0.02 * l.p1.y + 360))).toBeLessThan(4);
    expect(Math.abs(l.p2.x - (0.02 * l.p2.y + 360))).toBeLessThan(4);
  });
  it("returns null when no line is present", () => {
    const bin = new Uint8Array(500 * 400); // blank
    expect(fitSeamLine(bin, 500, 400, "bottom", { x: 250, y: 300 })).toBeNull();
  });
});

describe("refineSeamPlacement — neighbor's line maps onto the anchor's", () => {
  it("makes the two match lines coincident and parallel (recovers relative rotation)", () => {
    // Anchor line tilts +0.02; neighbor tilts -0.01 → relative rotation must be corrected.
    const A = { ...sheet({ side: "bottom", m: 0.02, intercept: 300 }), pagePerRaster: 1, seed: { x: 250, y: 300 }, span: SPAN, M: { A: 1, B: 0, e: 0, f: 0 } };
    const B = { ...sheet({ side: "top", m: -0.01, intercept: 80 }), pagePerRaster: 1, seed: { x: 250, y: 80 }, span: SPAN };
    const Mb = refineSeamPlacement(A, B, "bottom");
    expect(Mb).toBeTruthy();
    // scale ~1 (same plot size)
    expect(Math.hypot(Mb.A, Mb.B)).toBeGreaterThan(0.97);
    expect(Math.hypot(Mb.A, Mb.B)).toBeLessThan(1.03);
    // neighbor's fitted line, pushed to world, lands on the anchor's line (perp distance ~0)
    const la = fitSeamLine(A.bin, A.W, A.H, "bottom", A.seed, { spanLo: 0.02, spanHi: 0.98 });
    const lb = fitSeamLine(B.bin, B.W, B.H, "top", B.seed, { spanLo: 0.02, spanHi: 0.98 });
    const bw1 = fwd(Mb, lb.p1), bw2 = fwd(Mb, lb.p2);
    // anchor line as y = mA·x + bA
    const mA = (la.p2.y - la.p1.y) / (la.p2.x - la.p1.x), bA = la.p1.y - mA * la.p1.x;
    const perp = (p) => Math.abs(p.y - (mA * p.x + bA)) / Math.hypot(mA, 1);
    expect(perp(bw1)).toBeLessThan(3);
    expect(perp(bw2)).toBeLessThan(3);
  });
  it("plausibleRefine accepts a small nudge, rejects a fling / rescale / big rotation", () => {
    const label = { A: 1, B: 0, e: 100, f: 200 };
    const baseW = 500, baseH = 400;
    // small translation nudge → accepted
    expect(plausibleRefine(label, { A: 1, B: 0, e: 120, f: 210 }, baseW, baseH)).toBe(true);
    // flung far across the canvas → rejected
    expect(plausibleRefine(label, { A: 1, B: 0, e: 5000, f: 200 }, baseW, baseH)).toBe(false);
    // rescaled well beyond plot rounding → rejected
    expect(plausibleRefine(label, { A: 1.5, B: 0, e: 100, f: 200 }, baseW, baseH)).toBe(false);
    // big rotation → rejected
    const r = 15 * Math.PI / 180;
    expect(plausibleRefine(label, { A: Math.cos(r), B: Math.sin(r), e: 100, f: 200 }, baseW, baseH)).toBe(false);
  });
  it("returns null (caller keeps label placement) when a line can't be fit", () => {
    const A = { ...sheet({ side: "bottom", m: 0, intercept: 300 }), pagePerRaster: 1, seed: { x: 250, y: 300 }, span: SPAN, M: { A: 1, B: 0, e: 0, f: 0 } };
    const B = { bin: new Uint8Array(500 * 400), W: 500, H: 400, pagePerRaster: 1, seed: { x: 250, y: 80 }, span: SPAN };
    expect(refineSeamPlacement(A, B, "bottom")).toBeNull();
  });
});
