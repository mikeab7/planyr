import { describe, it, expect } from "vitest";
import { toGrayscale, adaptiveThreshold, rotateImage, estimateSkewAngle, preprocessPage, isEffectivelyBitonal } from "../src/shared/files/imagePreprocess.js";

describe("imagePreprocess — toGrayscale", () => {
  it("converts RGBA white/black pixels to 255/0 luma", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const gray = toGrayscale({ data, width: 2, height: 1 });
    expect(gray[0]).toBe(255);
    expect(gray[1]).toBe(0);
  });
});

// Build a synthetic "page" of horizontal text lines: a few rows of black pixel runs on a white
// background, spaced apart like real text baselines, so adaptive threshold + skew tests have
// something structured to work with.
function makeLinedPage(width, height, lineYs, { lineThickness = 3, inkRunFrac = 0.7 } = {}) {
  const gray = new Uint8ClampedArray(width * height).fill(255);
  for (const ly of lineYs) {
    for (let dy = 0; dy < lineThickness; dy++) {
      const y = ly + dy;
      if (y < 0 || y >= height) continue;
      const runLen = Math.round(width * inkRunFrac);
      const start = Math.round((width - runLen) / 2);
      for (let x = start; x < start + runLen; x++) {
        // a bit of texture (not a solid bar) so it reads more like glyph ink than a rule line
        if ((x + dy) % 3 !== 0) gray[y * width + x] = 20;
      }
    }
  }
  return gray;
}

describe("imagePreprocess — adaptiveThreshold", () => {
  it("separates dark text from a light background even under a gradient (uneven scan lighting)", () => {
    const width = 60, height = 40;
    const gray = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // a lighting gradient across the page (left dim, right bright) — a global threshold would
        // blow out one side or the other
        const base = 140 + Math.round((x / width) * 90);
        gray[y * width + x] = base;
      }
    }
    // stamp a dark "line" of text down the middle, relative to the LOCAL background at each x
    for (let x = 10; x < 50; x++) {
      const local = gray[20 * width + x];
      gray[20 * width + x] = Math.max(0, local - 100);
      gray[21 * width + x] = Math.max(0, local - 100);
    }
    const bin = adaptiveThreshold(gray, width, height, { radius: 8, C: 10 });
    // the text row should read mostly ink (0); a background row should read mostly white (255)
    let inkOnText = 0, inkOnBlank = 0;
    for (let x = 10; x < 50; x++) inkOnText += bin[20 * width + x] === 0 ? 1 : 0;
    for (let x = 10; x < 50; x++) inkOnBlank += bin[5 * width + x] === 0 ? 1 : 0;
    expect(inkOnText).toBeGreaterThan(30);
    expect(inkOnBlank).toBeLessThan(5);
  });
});

describe("imagePreprocess — rotateImage + estimateSkewAngle", () => {
  it("recovers an injected small rotation from a lined synthetic page", () => {
    const width = 120, height = 160;
    const gray = makeLinedPage(width, height, [30, 55, 80, 105, 130]);
    const binary = new Uint8ClampedArray(width * height);
    for (let i = 0; i < gray.length; i++) binary[i] = gray[i] < 128 ? 0 : 255;

    const injectedDeg = 3;
    const skewed = rotateImage(binary, width, height, injectedDeg, { fill: 255 });
    const estimate = estimateSkewAngle(skewed, width, height, { maxAngle: 6, step: 0.5 });
    // estimateSkewAngle returns the CORRECTIVE angle (what to pass straight back into rotateImage
    // to square the page, not the page's own tilt) — rotateImage composes rotations additively, so
    // correcting a +3° rotation takes very close to -3°.
    expect(Math.abs(estimate - -injectedDeg)).toBeLessThanOrEqual(1);
    // and applying that correction should measurably re-align the page (score against 0°).
    const corrected = rotateImage(skewed, width, height, estimate, { fill: 255 });
    const residual = estimateSkewAngle(corrected, width, height, { maxAngle: 6, step: 0.5 });
    expect(Math.abs(residual)).toBeLessThanOrEqual(1);
  });

  it("reports ~0° on an already-square page", () => {
    const width = 120, height = 160;
    const gray = makeLinedPage(width, height, [30, 55, 80, 105, 130]);
    const binary = new Uint8ClampedArray(width * height);
    for (let i = 0; i < gray.length; i++) binary[i] = gray[i] < 128 ? 0 : 255;
    const estimate = estimateSkewAngle(binary, width, height, { maxAngle: 6, step: 0.5 });
    expect(Math.abs(estimate)).toBeLessThanOrEqual(1);
  });
});

describe("imagePreprocess — preprocessPage", () => {
  it("runs the full grayscale -> threshold -> deskew pass and returns binary output at the same dimensions", () => {
    const width = 40, height = 30;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let x = 10; x < 30; x++) { data[(15 * width + x) * 4] = 0; data[(15 * width + x) * 4 + 1] = 0; data[(15 * width + x) * 4 + 2] = 0; }
    const result = preprocessPage({ data, width, height });
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    expect(result.data.length).toBe(width * height);
    expect(typeof result.skewDeg).toBe("number");
    // every output pixel is a valid binary value
    expect([...new Set(result.data)].every((v) => v === 0 || v === 255)).toBe(true);
  });
});

// Measured on a real recorded county deed (Chambers County correction SWD): each page is a 1-bit
// CCITT-G4 scan rasterised at its own native 300 dpi — pure black/white, no anti-aliasing gradient.
describe("imagePreprocess — isEffectivelyBitonal (real-deed-measured bitonal-source detection)", () => {
  it("recognizes an already-bitonal page (only 0/255 values)", () => {
    const gray = new Uint8ClampedArray(1000);
    for (let i = 0; i < gray.length; i++) gray[i] = i % 7 === 0 ? 0 : 255;
    expect(isEffectivelyBitonal(gray)).toBe(true);
  });
  it("does not call a genuinely greyscale gradient bitonal", () => {
    const gray = new Uint8ClampedArray(1000);
    for (let i = 0; i < gray.length; i++) gray[i] = (i * 255) / gray.length; // smooth 0..255 ramp
    expect(isEffectivelyBitonal(gray)).toBe(false);
  });
  it("preprocessPage skips adaptive-threshold work on a bitonal source and reports it", () => {
    const width = 20, height = 20;
    const data = new Uint8ClampedArray(width * height * 4).fill(255); // pure white
    for (let x = 5; x < 15; x++) { const o = (10 * width + x) * 4; data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; } // pure black line
    const result = preprocessPage({ data, width, height });
    expect(result.bitonalSource).toBe(true);
    // the black line should still read as ink (0) after the snap-to-binary pass
    expect(result.data[10 * width + 8]).toBe(0);
  });
  it("still runs adaptive threshold (bitonalSource: false) on a page with real greyscale midtones", () => {
    const width = 40, height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = 100 + ((x + y) % 100); // a midtone-heavy pattern, nowhere near pure 0/255
        const o = (y * width + x) * 4;
        data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
      }
    }
    const result = preprocessPage({ data, width, height });
    expect(result.bitonalSource).toBe(false);
  });
});
