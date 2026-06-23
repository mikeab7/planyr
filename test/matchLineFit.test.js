import { describe, it, expect } from "vitest";
import {
  rowClose, rowOpen, isolateLinePoints, ransacLine, fitMatchLine, colProfile, slideRefine,
} from "../src/shared/files/matchLineFit.js";

// Build a synthetic sheet (Uint8Array, 1=ink) with a known tilted DASHED match line, plus the
// two things that defeated naive detectors on real scans: vertical crossing strokes and text
// blobs. The fit must recover the line's slope and ignore the rest.
function synth({ W = 800, H = 200, m = 0.02, b0 = 90, dashLen = 20, dashGap = 15, vlines = [200, 400, 600], text = true } = {}) {
  const bin = new Uint8Array(W * H);
  const put = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) bin[y * W + x] = 1; };
  // dashed line with 3px thickness
  for (let x = 50; x < 750; x++) {
    const inDash = (x % (dashLen + dashGap)) < dashLen;
    if (!inDash) continue;
    const y = Math.round(m * x + b0);
    put(x, y - 1); put(x, y); put(x, y + 1);
  }
  // vertical crossing strokes (roads/boundaries crossing the seam) — must be removed by OPEN
  for (const vx of vlines) for (let y = 70; y < 130; y++) { put(vx, y); put(vx + 1, y); }
  // text blobs near the top of the band (the "MATCH LINE" label etc.) — narrow chars spaced far
  // enough apart that the horizontal CLOSE can't merge them into a fake horizontal run
  if (text) for (let i = 0; i < 8; i++) for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 3; dx++) put(300 + i * 30 + dx, 72 + dy);
  return { bin, W, H };
}

describe("rowClose / rowOpen — 1-D horizontal morphology", () => {
  it("close bridges a gap up to 2·r wide", () => {
    const row = new Uint8Array([1, 1, 0, 0, 0, 1, 1]); // gap of 3
    const closed = rowClose(row, 7, 2); // 2r = 4 ≥ 3 → bridged
    expect(Array.from(closed)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
  it("close leaves a gap wider than 2·r open", () => {
    const row = new Uint8Array([1, 1, 0, 0, 0, 0, 0, 1, 1]); // gap of 5
    const closed = rowClose(row, 9, 2); // 2r = 4 < 5 → stays split
    expect(closed[4]).toBe(0);
  });
  it("open removes a short run, keeps a long one", () => {
    const row = new Uint8Array(40);
    for (let x = 2; x < 5; x++) row[x] = 1;       // short run (len 3)
    for (let x = 10; x < 35; x++) row[x] = 1;     // long run (len 25)
    const opened = rowOpen(row, 40, 6);            // removes runs shorter than ~2·6
    expect(opened[3]).toBe(0);
    expect(opened[20]).toBe(1);
  });
});

describe("isolateLinePoints — keep the dashed line, drop verticals & text", () => {
  it("surviving pixels lie on the line, not on the vertical strokes or text", () => {
    const { bin, W, H } = synth();
    const { xs, ys } = isolateLinePoints(bin, W, H, { x0: 40, x1: 760, yTop: 60, yBot: 140, closeR: 9, openR: 8 });
    expect(xs.length).toBeGreaterThan(300);
    // every surviving point should be near the true line y = 0.02x + 90 (±3), i.e. not the text at y≈72
    let onLine = 0;
    for (let i = 0; i < xs.length; i++) if (Math.abs(ys[i] - (0.02 * xs[i] + 90)) <= 3) onLine++;
    expect(onLine / xs.length).toBeGreaterThan(0.9);
  });
});

describe("ransacLine / fitMatchLine — recover the true slope", () => {
  it("recovers the synthetic line's slope within 0.004", () => {
    const { bin, W, H } = synth({ m: 0.02 });
    const fit = fitMatchLine(bin, W, H, { yCen: 100, x0: 40, x1: 760, halfBand: 40, closeR: 9, openR: 8, ransac: { minInliers: 150 } });
    expect(fit).toBeTruthy();
    expect(Math.abs(fit.m - 0.02)).toBeLessThan(0.004);
    // endpoints span the requested width
    expect(fit.p1.x).toBe(40);
    expect(fit.p2.x).toBe(760);
    expect(Math.abs(fit.p2.y - (0.02 * 760 + 90))).toBeLessThan(4);
  });
  it("recovers a steeper (but still near-horizontal) tilt", () => {
    const { bin, W, H } = synth({ m: -0.05, b0: 130 });
    const fit = fitMatchLine(bin, W, H, { yCen: 110, x0: 40, x1: 760, halfBand: 50, closeR: 9, openR: 8, ransac: { minInliers: 150 } });
    expect(fit).toBeTruthy();
    expect(Math.abs(fit.m - (-0.05))).toBeLessThan(0.004);
  });
  it("returns null when there is no line (only noise)", () => {
    const { bin, W, H } = synth({ vlines: [100, 200, 300, 400, 500, 600, 700], dashLen: 0, dashGap: 1 });
    const fit = fitMatchLine(bin, W, H, { yCen: 100, x0: 40, x1: 760, halfBand: 40, ransac: { minInliers: 300 } });
    expect(fit).toBeNull();
  });
  it("is deterministic across runs (seeded RANSAC)", () => {
    const { bin, W, H } = synth();
    const opt = { yCen: 100, x0: 40, x1: 760, closeR: 9, openR: 8, ransac: { minInliers: 150 } };
    const a = fitMatchLine(bin, W, H, opt);
    const b = fitMatchLine(bin, W, H, opt);
    expect(a).toBeTruthy();
    expect(a.m).toBe(b.m);
    expect(a.b).toBe(b.b);
  });
});

describe("slideRefine — connect features crossing the seam", () => {
  it("finds the known horizontal shift between two crossing-feature profiles", () => {
    const W = 600;
    const a = new Float64Array(W), b = new Float64Array(W);
    for (const x of [120, 300, 470]) { a[x] = 10; a[x + 1] = 6; }
    const shift = 17;
    for (const x of [120, 300, 470]) { b[x + shift] = 10; b[x + 1 + shift] = 6; }
    // profB's features sit +17 px to the right of profA's. slideRefine returns the shift to APPLY
    // to the neighbor (profB) to bring them back under the anchor — i.e. −17.
    expect(slideRefine(a, b, 50)).toBe(-shift);
  });
  it("returns 0 when already aligned", () => {
    const W = 400;
    const a = new Float64Array(W), b = new Float64Array(W);
    for (const x of [100, 250]) { a[x] = 5; b[x] = 5; }
    expect(slideRefine(a, b, 30)).toBe(0);
  });
});

describe("colProfile", () => {
  it("counts ink per column in the row window", () => {
    const W = 10, H = 6;
    const bin = new Uint8Array(W * H);
    bin[2 * W + 3] = 1; bin[3 * W + 3] = 1; bin[4 * W + 3] = 1; // col 3, rows 2..4
    bin[1 * W + 7] = 1; // col 7 row 1 (outside window)
    const p = colProfile(bin, W, H, 2, 5);
    expect(p[3]).toBe(3);
    expect(p[7]).toBe(0);
  });
});
