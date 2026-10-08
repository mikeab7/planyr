import { describe, it, expect } from "vitest";
import { pixelDelta, sampleLine, lineDelta, lineVariety, estimateShiftX } from "../ui-audit/lib/pixelSteady.mjs";

const img = (w, h, f, channels = 3) => {
  const data = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); const i = (y * w + x) * channels; data[i] = data[i + 1] = data[i + 2] = v; if (channels === 4) data[i + 3] = 255; }
  return { width: w, height: h, channels, data };
};
// diagonal stripes with a soft edge, positioned by `ox`
const stripes = (ox) => (x, y) => { const t = ((x - ox + y) % 8 + 8) % 8; return t < 3 ? 40 : t < 4 ? 140 : 230; };

describe("pixelSteady (NEW-1/NEW-2 pixel phase)", () => {
  it("pixelDelta: identical → 0; one changed pixel → counted with its delta; mixed channel counts compare", () => {
    const a = img(10, 6, () => 100), b = img(10, 6, () => 100, 4);
    expect(pixelDelta(a, b)).toEqual({ n: 0, max: 0 });
    b.data[(2 * 10 + 3) * 4] = 107;
    expect(pixelDelta(a, b)).toEqual({ n: 1, max: 7 });
    expect(() => pixelDelta(a, img(9, 6, () => 0))).toThrow();
  });
  it("a hatch line: a slid hatch is caught, a held one is not, and a flat line is not a hatch", () => {
    const a = img(64, 8, stripes(0)), held = img(64, 8, stripes(0)), slid = img(64, 8, stripes(3));
    const la = sampleLine(a, 4, 4, 60);
    expect(lineVariety(la)).toBeGreaterThan(2);
    expect(lineDelta(la, sampleLine(held, 4, 4, 60))).toBe(0);
    expect(lineDelta(la, sampleLine(slid, 4, 4, 60))).toBeGreaterThan(50);
    expect(lineVariety(sampleLine(img(64, 8, () => 9), 4, 4, 60))).toBe(1);
    expect(lineDelta([], [])).toBe(Infinity);
  });
  it("estimateShiftX: a true shift reads as that shift; an unmoved image reads 0", () => {
    const a = img(80, 20, stripes(0));
    expect(estimateShiftX(a, img(80, 20, stripes(0)))).toBe(0);
    expect(Math.abs(estimateShiftX(a, img(80, 20, stripes(1))) - 1)).toBeLessThan(0.11);
  });
});
