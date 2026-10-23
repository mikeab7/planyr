import { describe, it, expect } from "vitest";
import { fitImagery, outlinePoints, outlineOffset } from "../ui-audit/lib/imageryRegister.mjs";

/* V1882768 / B2426464 ×4 — the real-imagery reader. A procedural "aerial" is rendered at rest and again scaled about an anchor; the outline
 * is drawn either ON the scaled imagery (locked) or a few px beside it (slid). The reader must find the imagery's scale and report the slide. */
const W = 400, H = 300, OUT = [162, 28, 175];
const tex = (x, y) => 128 + 50 * Math.sin(x * 0.21) * Math.cos(y * 0.17) + 40 * Math.sin((x + 2 * y) * 0.093) + 25 * Math.cos((3 * x - y) * 0.051);
function render(s, ax, ay, slide = 0) {
  const data = Buffer.alloc(W * H * 3);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const x = ax + (X - ax) / s, y = ay + (Y - ay) / s; const v = Math.max(0, Math.min(255, tex(x, y))); const o = (Y * W + X) * 3;
    // the outline: the world lines x = 150 and y = 120, drawn at the imagery's scale, shifted by `slide` screen px
    const lx = ax + (150 - ax) * s + slide, ly = ay + (120 - ay) * s + slide;
    const on = Math.abs(X + 0.5 - lx) <= 1 || Math.abs(Y + 0.5 - ly) <= 1;
    data[o] = on ? OUT[0] : v * 0.9; data[o + 1] = on ? OUT[1] : v; data[o + 2] = on ? OUT[2] : v * 0.8;
  }
  return { width: W, height: H, channels: 3, data };
}
const win = [20, 20, 380, 280], anchor = [200, 150];

describe("imageryRegister", () => {
  const rest = render(1, 200, 150);
  const restOutline = outlinePoints(rest, win);
  it("finds the imagery's scale about the anchor", () => {
    const xf = fitImagery(rest, render(1.3, 200, 150), { win, anchor, slack: 16 });
    expect(xf.s).toBeGreaterThan(1.29); expect(xf.s).toBeLessThan(1.31);
    expect(xf.ncc).toBeGreaterThan(0.9);
  });
  it("a locked outline lands on the outline", () => {
    const f = render(1.3, 200, 150); const r = outlineOffset(restOutline, f, fitImagery(rest, f, { win, anchor, slack: 16 }), { win });
    expect(r.median).toBeLessThan(1);
  });
  it("a slid outline reads its slide", () => {
    const f = render(1.3, 200, 150, 5); const r = outlineOffset(restOutline, f, fitImagery(rest, f, { win, anchor, slack: 16 }), { win });
    expect(r.median).toBeGreaterThan(3);
  });
});

describe("imageryRegister — lines removed by design", () => {
  it("keeps only the reference lines still drawn at the other end of the gesture", async () => {
    const { persistentOutline } = await import("../ui-audit/lib/imageryRegister.mjs");
    const rest = render(1, 200, 150);
    // the other end: same imagery, but the horizontal line is gone (a stage that no longer draws it) — only the vertical one survives
    const end = render(1, 200, 150); const d = end.data;
    for (let Y = 118; Y <= 122; Y++) for (let X = 0; X < W; X++) { const o = (Y * W + X) * 3; if (d[o] === OUT[0] && d[o + 1] === OUT[1]) { d[o] = 120; d[o + 1] = 130; d[o + 2] = 100; } }
    const pts = outlinePoints(rest, win, 4000);
    const p = persistentOutline(pts, end, { s: 1, tx: 0, ty: 0 }, { win });
    expect(p.kept.length).toBeGreaterThan(50);
    expect(p.kept.every(([x]) => Math.abs(x - 150) <= 2)).toBe(true);
  });
});
