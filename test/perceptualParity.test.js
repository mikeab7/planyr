/* PERCEPTUAL-PARITY — the bar that replaces byte-identity for LOD-class changes (owner amendment,
 * 2026-08-06). Three things are pinned here, and each of them is load-bearing:
 *
 *   1. THE COLOUR MATHS IS RIGHT. CIEDE2000 has more special cases than anything else in this repo
 *      (the hue-average wrap, the zero-chroma branch, the blue-region rotation term) and a subtly
 *      wrong one would still return plausible small numbers — the most dangerous shape a metric can
 *      have. It is therefore checked against Sharma/Wu/Dalal's published test vectors, which exist
 *      precisely because implementations get these branches wrong.
 *   2. THE DISCRIMINATOR WORKS. The whole justification for retiring byte-identity is that this bar
 *      can tell "the same ink one sub-pixel over" (invisible, and what killed B1350 twice) from "a
 *      line of ink removed" (a real downgrade), where a raw channel diff reads both as ~23/255. If
 *      that separation ever stops holding, the bar is unsafe and must go back to byte-identity.
 *   3. THE BARS THEMSELVES ARE PINNED BY VALUE. Raising one is a product decision about drawing
 *      quality; this test makes it impossible to do quietly.
 */
import { describe, it, expect } from "vitest";
import {
  deltaE2000, srgbToLab, linearRgbToLab, arcminPerCssPx, gaussianKernel, blurLinear,
  perceptualParity, parityLine,
  DETAIL_MAX_DE, PERCEIVED_MAX_DE, PERCEIVED_MEAN_DE,
  DETAIL_ARCMIN, PERCEIVED_ARCMIN, DEFAULT_VIEW_DISTANCE_MM, DEFAULT_CSS_PX_MM,
} from "../ui-audit/lib/perceptualDiff.mjs";

/* ---- image helpers: { width, height, channels, data }, the shape decodePng returns ---- */
const solid = (w, h, [r, g, b]) => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
  return { width: w, height: h, channels: 4, data };
};
const put = (img, x, y, [r, g, b]) => {
  const p = (y * img.width + x) * img.channels;
  img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b;
};
const clone = (img) => ({ ...img, data: new Uint8Array(img.data) });

describe("CIEDE2000 — Sharma/Wu/Dalal test vectors", () => {
  /* [Lab1, Lab2, expected ΔE00] — the cases that exercise the hard branches: the hue wrap across
   * 0/360, the blue-region rotation term, near-neutral chroma, and a very dark pair. */
  const CASES = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0],
    [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, -1, 2], [50, 0, 0], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [l1, l2, want] of CASES) {
    it(`ΔE00(${l1.join(",")} | ${l2.join(",")}) ≈ ${want}`, () => {
      expect(deltaE2000(l1, l2)).toBeCloseTo(want, 3);
    });
  }
  it("is symmetric and zero on identity", () => {
    expect(deltaE2000([40, 10, -20], [40, 10, -20])).toBe(0);
    expect(deltaE2000([40, 10, -20], [45, -3, 7])).toBeCloseTo(deltaE2000([45, -3, 7], [40, 10, -20]), 9);
  });
});

describe("colour conversion", () => {
  it("puts sRGB white and black where CIE says they are", () => {
    const [Lw] = srgbToLab(255, 255, 255);
    const [Lb] = srgbToLab(0, 0, 0);
    expect(Lw).toBeCloseTo(100, 3);
    expect(Lb).toBeCloseTo(0, 6);
  });
  it("a neutral grey has no chroma", () => {
    const [, a, b] = srgbToLab(128, 128, 128);
    expect(Math.hypot(a, b)).toBeLessThan(0.01);
  });
  it("linearRgbToLab agrees with srgbToLab through the transfer function", () => {
    const viaLinear = linearRgbToLab(Math.pow((200 / 255 + 0.055) / 1.055, 2.4), Math.pow((100 / 255 + 0.055) / 1.055, 2.4), Math.pow((50 / 255 + 0.055) / 1.055, 2.4));
    const direct = srgbToLab(200, 100, 50);
    viaLinear.forEach((v, i) => expect(v).toBeCloseTo(direct[i], 6));
  });
});

describe("viewing geometry", () => {
  it("one CSS pixel subtends ~2.9 arcminutes on the documented default setup", () => {
    expect(arcminPerCssPx()).toBeCloseTo(2.865, 2);
  });
  it("sitting closer makes a pixel subtend more — i.e. the bar gets stricter", () => {
    expect(arcminPerCssPx({ viewDistanceMm: 400 })).toBeGreaterThan(arcminPerCssPx({ viewDistanceMm: 800 }));
  });
  it("the defaults are the ones documented on the rule", () => {
    expect(DEFAULT_VIEW_DISTANCE_MM).toBe(600);
    expect(DEFAULT_CSS_PX_MM).toBe(0.5);
    expect(DETAIL_ARCMIN).toBe(1);
    expect(PERCEIVED_ARCMIN).toBe(6);
  });
});

describe("gaussian kernel", () => {
  it("normalises to one", () => {
    for (const s of [0.3, 1, 2.5, 7]) {
      expect(gaussianKernel(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });
  it("collapses to identity below a twentieth of a pixel", () => {
    expect(gaussianKernel(0.01)).toEqual([1]);
  });
  it("is symmetric and peaks at the centre", () => {
    const k = gaussianKernel(1.5);
    const mid = (k.length - 1) / 2;
    expect(k[mid]).toBe(Math.max(...k));
    for (let i = 0; i < k.length; i++) expect(k[i]).toBeCloseTo(k[k.length - 1 - i], 12);
  });
  it("preserves total light on a flat field (edges clamp, so nothing leaks)", () => {
    const img = solid(24, 24, [90, 140, 200]);
    const out = blurLinear(img, 2);
    // every sample of a flat field must come back as the same flat value
    for (let i = 0; i < 24 * 24; i++) expect(out[i * 3]).toBeCloseTo(out[0], 12);
  });
});

describe("the discriminator — the reason this bar replaces byte-identity", () => {
  const W = 240, H = 240;
  const BG = [176, 176, 176];

  /* THE B1350 CASE, built to be physically honest about what it is: a <rect> edge and a
   * rectangular <path> edge cover the SAME area, so Skia lays down the SAME TOTAL INK, but it
   * distributes that ink across the two straddling columns differently. Arm A puts all 23 units of
   * darkening in one column; arm B splits it 11/12 across two. Nothing is added and nothing is
   * removed — the integral is equal — and the worst channel delta is 12/255, inside the 12–23 band
   * B1350 measured and was rejected on twice. */
  const redistributed = () => {
    const a = solid(W, H, BG), b = solid(W, H, BG);
    for (let seam = 0; seam < 24; seam++) {
      const x = 8 + seam * 9;
      for (let y = 40; y < 80; y++) {
        put(a, x, y, [153, 153, 153]);              // 23 units of ink, all in one column
        put(b, x, y, [165, 165, 165]);              // the same 23 units, split 11 / 12
        put(b, x + 1, y, [164, 164, 164]);
      }
    }
    return [a, b];
  };

  /* THE DOWNGRADE CASE, in the same faint band. The divider is simply not drawn: the integral goes
   * to zero. A raw diff sees 23/255 here and 12/255 above and would happily accept the WRONG one of
   * the two if the threshold were set anywhere between. */
  const removedInk = () => {
    const a = solid(W, H, BG), b = solid(W, H, BG);
    for (let line = 0; line < 24; line++) {
      const x = 8 + line * 9;
      for (let y = 40; y < 80; y++) put(a, x, y, [153, 153, 153]);
    }
    return [a, b];
  };

  it("PASSES ink that moved a sub-pixel (the twice-rejected dock-door class)", () => {
    const [a, b] = redistributed();
    const r = perceptualParity(a, b);
    expect(r.pass).toBe(true);
    expect(r.identical).toBe(false);          // it is NOT byte-identical — that is the whole point
    expect(r.perceived.maxDE).toBeLessThan(PERCEIVED_MAX_DE);
  });

  it("FAILS ink that was removed, at the same worst-case channel delta", () => {
    const [a, b] = removedInk();
    const r = perceptualParity(a, b);
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/perceived/);
  });

  it("separates the two by a wide margin, not by a hair", () => {
    const moved = perceptualParity(...redistributed()).perceived.maxDE;
    const gone = perceptualParity(...removedInk()).perceived.maxDE;
    expect(gone).toBeGreaterThan(moved * 3);
  });

  it("a raw channel diff RANKS THEM THE WRONG WAY ROUND — which is why the old bar refused both", () => {
    const worst = (a, b) => {
      let m = 0;
      for (let i = 0; i < a.data.length; i += a.channels) {
        for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c]));
      }
      return m;
    };
    const [ra, rb] = redistributed();
    const [da, db] = removedInk();
    // Both are far above B1345's one-unit bar, so byte-identity refuses both — including the one a
    // human cannot see. And the two are close enough in raw units that no channel threshold could
    // have been drawn between them safely.
    expect(worst(ra, rb)).toBeGreaterThan(1);
    expect(worst(da, db)).toBeGreaterThan(1);
    expect(worst(da, db) / worst(ra, rb)).toBeLessThan(3);
  });
});

describe("the bar rejects what it must", () => {
  it("passes an identical pair and says so", () => {
    const a = solid(64, 64, [200, 30, 40]);
    const r = perceptualParity(a, clone(a));
    expect(r.pass).toBe(true);
    expect(r.identical).toBe(true);
    expect(r.perceived.maxDE).toBe(0);
  });

  it("fails a whole-frame tint shift that no single pixel would flag as large", () => {
    const a = solid(64, 64, [128, 128, 128]);
    const b = solid(64, 64, [134, 134, 134]);   // 6/255 everywhere
    const r = perceptualParity(a, b);
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/frame-mean|worst/);
  });

  it("fails a large coherent block even at a modest delta", () => {
    const a = solid(200, 200, [180, 180, 180]);
    const b = clone(a);
    for (let y = 60; y < 140; y++) for (let x = 60; x < 140; x++) put(b, x, y, [172, 172, 172]);
    const r = perceptualParity(a, b);
    expect(r.pass).toBe(false);
  });

  it("fails a change that touches too much of the frame even if each pixel is faint", () => {
    const a = solid(200, 200, [180, 180, 180]);
    const b = clone(a);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x += 2) put(b, x, y, [178, 178, 178]);
    const r = perceptualParity(a, b);
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/perceived/);
  });

  it("refuses to compare different sizes rather than resampling", () => {
    expect(() => perceptualParity(solid(10, 10, [0, 0, 0]), solid(11, 10, [0, 0, 0]))).toThrow(/size mismatch/);
  });

  it("reports every number the verdict is made of, never a bare boolean", () => {
    const r = perceptualParity(solid(32, 32, [10, 20, 30]), solid(32, 32, [10, 20, 31]));
    expect(r).toHaveProperty("detail.pct");
    expect(r).toHaveProperty("perceived.meanDE");
    expect(r).toHaveProperty("geometry.arcminPerCssPx");
    expect(r.bars).toEqual({ DETAIL_MAX_DE, PERCEIVED_MAX_DE, PERCEIVED_MEAN_DE });
    expect(parityLine(r)).toMatch(/detail .* perceived .* (PASS|FAIL)/);
  });
});

describe("the bars are pinned by value — moving one is a product decision, never a quiet nudge", () => {
  it("holds the declared thresholds", () => {
    expect(DETAIL_MAX_DE).toBe(6.0);
    expect(PERCEIVED_MAX_DE).toBe(1.0);        // the classical ΔE00 just-noticeable difference
    expect(PERCEIVED_MEAN_DE).toBe(0.10);
  });
  it("is stricter than the practical-JND figure it could have taken (~2.3)", () => {
    expect(PERCEIVED_MAX_DE).toBeLessThan(2.3);
  });
});
