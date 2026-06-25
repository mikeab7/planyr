import { describe, it, expect } from "vitest";
import { coarseOffset, inkBBox, registerRasters, manualRegister } from "../src/shared/files/rasterRegister.js";

/* B464 — pure registration that lines rev B up onto rev A before diffing. Synthetic binaries pin the
 * contract: translation + uniform scale auto-align with HIGH confidence; orthogonal/garbage content
 * reports LOW confidence (honest — punts to manual); manual 2-point recovers full rotation+scale. */

function blank(W, H) { return { bin: new Uint8Array(W * H), W, H }; }
function fillRect(g, x, y, w, h) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < g.W && yy < g.H) g.bin[yy * g.W + xx] = 1; } return g; }
// shift A's ink by (sx,sy): out ink at (x,y) = A ink at (x-sx, y-sy)
function shift(g, sx, sy) { const out = blank(g.W, g.H); for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.bin[y * g.W + x]) { const nx = x + sx, ny = y + sy; if (nx >= 0 && ny >= 0 && nx < g.W && ny < g.H) out.bin[ny * g.W + nx] = 1; } return out; }
// rotate A's ink by deg about (cx,cy), nearest-neighbor inverse map
function rotate(g, deg, cx, cy) { const out = blank(g.W, g.H); const r = (-deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) { const dx = x - cx, dy = y - cy; const sx = Math.round(cx + c * dx - s * dy), sy = Math.round(cy + s * dx + c * dy); if (sx >= 0 && sy >= 0 && sx < g.W && sy < g.H && g.bin[sy * g.W + sx]) out.bin[y * g.W + x] = 1; } return out; }

describe("inkBBox", () => {
  it("finds the tight ink box", () => {
    const g = fillRect(blank(20, 20), 4, 6, 5, 3);
    expect(inkBBox(g.bin, g.W, g.H)).toEqual({ x: 4, y: 6, w: 5, h: 3 });
  });
  it("returns null when there is no ink", () => {
    const g = blank(10, 10);
    expect(inkBBox(g.bin, g.W, g.H)).toBeNull();
  });
});

describe("coarseOffset — recovers a pure translation", () => {
  it("an A-shape shifted by (sx,sy) yields a B→A offset of (−sx,−sy)", () => {
    const A = fillRect(fillRect(blank(40, 40), 6, 6, 10, 4), 6, 6, 3, 14); // an asymmetric L
    const B = shift(A, 5, 3);
    const { dx, dy } = coarseOffset(A.bin, B.bin, A.W, A.H);
    expect(dx).toBe(-5);
    expect(dy).toBe(-3);
  });
});

describe("registerRasters — auto-align", () => {
  it("a translated revision aligns with HIGH confidence and maps B→A correctly", () => {
    const A = fillRect(fillRect(blank(40, 40), 8, 8, 12, 5), 8, 8, 4, 16);
    const B = shift(A, 6, -4);
    const t = registerRasters(A.bin, B.bin, A.W, A.H);
    expect(t).not.toBeNull();
    expect(t.confidence).toBe("high");
    expect(Math.abs(t.scale - 1)).toBeLessThan(0.05);
    // a B ink corner maps back onto the A corner
    const p = t.apply({ x: 14, y: 4 }); // 8+6, 8-4 — where A's (8,8) landed in B
    expect(Math.abs(p.x - 8)).toBeLessThan(1.5);
    expect(Math.abs(p.y - 8)).toBeLessThan(1.5);
  });

  it("a uniformly SCALED revision recovers the scale (bbox path)", () => {
    const A = fillRect(blank(40, 40), 4, 4, 6, 6);   // 6×6 filled block
    const B = fillRect(blank(40, 40), 8, 8, 12, 12); // 12×12 filled block — 2× larger
    const t = registerRasters(A.bin, B.bin, A.W, A.H);
    expect(t).not.toBeNull();
    expect(t.confidence).toBe("high");
    expect(t.method).toBe("bbox");
    expect(Math.abs(t.scale - 0.5)).toBeLessThan(0.1); // B→A halves
  });

  it("non-corresponding content reports LOW confidence — honest, punts to manual", () => {
    // A is a solid block; B is a handful of scattered points with no real correspondence. No
    // translation/scale makes the bulk of A's ink overlap B's, so agreement stays low.
    const A = fillRect(blank(60, 60), 22, 22, 16, 16);
    const B = blank(60, 60);
    [[2, 2], [57, 2], [2, 57], [57, 57], [30, 30]].forEach(([x, y]) => { B.bin[y * B.W + x] = 1; });
    const t = registerRasters(A.bin, B.bin, A.W, A.H);
    expect(t).not.toBeNull();
    expect(t.confidence).toBe("low");
  });

  it("returns null when a side has no ink", () => {
    const A = fillRect(blank(20, 20), 4, 4, 4, 4);
    const B = blank(20, 20);
    expect(registerRasters(A.bin, B.bin, A.W, A.H)).toBeNull();
  });
});

describe("manualRegister — 2-point recovers full rotation + scale", () => {
  it("maps the two clicked B points onto the two A points (90° + translation)", () => {
    // B is rotated 90° relative to A: A pts (0,0),(10,0); same marks in B at (5,5),(5,15).
    const t = manualRegister({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 15 });
    expect(t).not.toBeNull();
    expect(t.confidence).toBe("manual");
    const a1 = t.apply({ x: 5, y: 5 }), a2 = t.apply({ x: 5, y: 15 });
    expect(Math.abs(a1.x - 0)).toBeLessThan(1e-6);
    expect(Math.abs(a1.y - 0)).toBeLessThan(1e-6);
    expect(Math.abs(a2.x - 10)).toBeLessThan(1e-6);
    expect(Math.abs(a2.y - 0)).toBeLessThan(1e-6);
    expect(Math.abs(t.scale - 1)).toBeLessThan(1e-6);
  });
});
