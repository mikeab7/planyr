import { describe, it, expect } from "vitest";
import { classify, scanRuns, pairOffsets, readFrame } from "../ui-audit/lib/lineLockScan.mjs";

/* B2426464 ×2 — the frame reader behind ui-audit/measure-parcel-zoom-slide.mjs. A known picture in, a known offset out: the instrument
 * must read a locked outline as ~0, a slid one as its slide, and must NOT turn a scan line grazing along a band or a lot corner into a
 * false reading (both happened while the instrument was being built). */
const W = 200, H = 200;
const RED = [255, 0, 0], INK = [167, 27, 166], WHITE = [255, 255, 255];
function canvas() { const data = Buffer.alloc(W * H * 3, 255); return { width: W, height: H, channels: 3, data, set(x, y, c) { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; } }; }
/* a lot: a square ring of red band (thickness `band`) centred on its true edge, and the outline drawn `slide` px off it */
function lot(img, { x0 = 50, y0 = 50, size = 100, band = 16, slide = 0 } = {}) {
  const h = band / 2;
  for (let y = y0 - h; y < y0 + size + h; y++) for (let x = x0 - h; x < x0 + size + h; x++) {
    const nearV = Math.abs(x + 0.5 - x0) <= h || Math.abs(x + 0.5 - (x0 + size)) <= h, nearH = Math.abs(y + 0.5 - y0) <= h || Math.abs(y + 0.5 - (y0 + size)) <= h;
    if (nearV || nearH) img.set(x, y, RED);
  }
  const ox = x0 + slide, oy = y0 + slide;
  for (let t = 0; t <= size; t++) { img.set(Math.round(ox), oy + t, INK); img.set(Math.round(ox + size), oy + t, INK); img.set(ox + t, Math.round(oy), INK); img.set(ox + t, Math.round(oy + size), INK); }
  return img;
}

describe("classify", () => {
  it("band, outline over white, outline over red", () => {
    expect(classify(...RED)).toBe("red");
    expect(classify(164, 37, 177)).toBe("ink");
    expect(classify(...INK)).toBe("ink");
    expect(classify(...WHITE)).toBe(null);
  });
});

describe("pairOffsets / readFrame", () => {
  it("a locked outline reads ~0", () => {
    const r = readFrame(lot(canvas()), { rows: [100], cols: [100], bandPx: 16 });
    expect(r.crossings).toBe(4);
    expect(r.worst).toBeLessThan(1);
  });
  it("a slid outline reads its slide", () => {
    const r = readFrame(lot(canvas(), { slide: 5 }), { rows: [100], cols: [100], bandPx: 16 });
    expect(r.worst).toBeGreaterThan(4);
    expect(r.worst).toBeLessThan(6.5);
  });
  it("an outline slid clear off its band is paired with the nearest band, not dropped", () => {
    const r = readFrame(lot(canvas(), { slide: 14 }), { rows: [100], cols: [100], bandPx: 16 });
    expect(r.worst).toBeGreaterThan(12);
  });
  it("a scan line running ALONG a lot's top band is not read as a crossing (the instrument's own false 4–5 px)", () => {
    const r = readFrame(lot(canvas(), { slide: 0 }), { rows: [52], cols: [], bandPx: 16, debug: true });
    expect(r.crossings).toBe(0);
  });
  it("one darkened pixel inside a band does not split it into two half-bands", () => {
    const runs = scanRuns((i) => (i === 5 ? [159, 23, 16] : i < 12 ? RED : WHITE), 20);
    expect(runs.length).toBe(1);
  });
  it("ink with no band within reach is counted as unpaired, never as a small offset", () => {
    const p = pairOffsets([{ start: 10, end: 11, red: [], ink: [10, 11], w: [150, 150] }], { bandPx: 16, maxPx: 40 });
    expect(p.pairs.length).toBe(0);
    expect(p.unpairedInk).toBe(1);
  });
});
