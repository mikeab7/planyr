/* Scanned-deed image preprocessing — pure pixel-array math, no canvas/DOM required, so it's
 * Node-testable against a plain { data, width, height } object shaped like ImageData. The browser
 * caller (`deedOcr.js`) reads real ImageData off a rendered PDF page and passes it straight through;
 * a unit test builds the same shape by hand.
 *
 * A county deed scan is typically a low-contrast, slightly rotated, greyscale-or-worse photocopy of
 * a photocopy. Recognizing it well needs three things done BEFORE the OCR engine ever sees a pixel
 * (CLAUDE.md item (c)): greyscale, adaptive threshold (a plain global threshold blows out one side of
 * an unevenly-lit scan), and deskew (a page scanned a degree or two off square measurably hurts line
 * segmentation). None of this needs to be exact — it needs to be BETTER than feeding Tesseract the
 * raw screen-resolution render, which is the bar `deedOcr.js`'s fixture measures against.
 */

/** RGBA ImageData-shaped input → 8-bit greyscale (standard luma weights). Returns a Uint8ClampedArray
 *  of length width*height. */
export function toGrayscale({ data, width, height }) {
  const n = width * height;
  const out = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return out;
}

// Summed-area table (integral image) so a local-window mean is O(1) per pixel regardless of
// radius — row-cumulative sums, then accumulated down columns.
function buildIntegral(gray, width, height) {
  const w1 = width + 1;
  const sum = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowAcc = 0;
    const rowOff = (y + 1) * w1, prevOff = y * w1;
    for (let x = 0; x < width; x++) {
      rowAcc += gray[y * width + x];
      sum[rowOff + x + 1] = sum[prevOff + x + 1] + rowAcc;
    }
  }
  return sum;
}

/** Local-mean adaptive threshold ("is this pixel darker than its own neighbourhood") — robust to an
 *  unevenly lit scan, unlike one global cutoff. `radius` in px, `C` a bias subtracted from the local
 *  mean (a bigger C keeps more borderline pixels white). Returns a Uint8Array of 0 (ink) / 255
 *  (background), same shape convention OCR engines expect. */
export function adaptiveThreshold(gray, width, height, opts = {}) {
  const radius = Math.max(1, opts.radius ?? 15);
  const C = opts.C ?? 8;
  const integral = buildIntegral(gray, width, height);
  const w1 = width + 1;
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = integral[(y1 + 1) * w1 + (x1 + 1)] - integral[(y0) * w1 + (x1 + 1)] - integral[(y1 + 1) * w1 + (x0)] + integral[(y0) * w1 + (x0)];
      const mean = s / area;
      out[y * width + x] = gray[y * width + x] < mean - C ? 0 : 255;
    }
  }
  return out;
}

/** Is this greyscale page ALREADY effectively bitonal — almost every pixel near pure black or pure
 *  white, no real midtone range? Measured on a real recorded county deed (a 1-bit CCITT-G4 scan
 *  rasterised at its own native 300 dpi, so there's no resampling to soften the edges either): there
 *  is no anti-aliasing gradient to threshold, and running the local-mean adaptive threshold on a page
 *  that's already black-or-white is both wasted work (a full integral-image pass over a multi-
 *  megapixel page) and a real risk — a boundary between a mostly-black and a mostly-white region can
 *  shift the local mean enough to fray a clean edge that needed no help. `frac` is the minimum share
 *  of pixels that must already sit within `epsilon` of 0 or 255 to call the page bitonal. */
export function isEffectivelyBitonal(gray, opts = {}) {
  const epsilon = opts.epsilon ?? 16;
  const frac = opts.frac ?? 0.99;
  let near = 0;
  for (let i = 0; i < gray.length; i++) { if (gray[i] <= epsilon || gray[i] >= 255 - epsilon) near++; }
  return gray.length > 0 && near / gray.length >= frac;
}

/** Rotate a single-channel image (grayscale or binary) about its centre by `angleDeg` (positive =
 *  clockwise, image y-down convention), nearest-neighbour sampled, same output dimensions, filling
 *  any corner exposed by the rotation with `fill` (default white/255 — a scanned page's margin).
 *  Small-angle use only (deskew), so nearest-neighbour is accurate enough and cheap. */
export function rotateImage(src, width, height, angleDeg, opts = {}) {
  const fill = opts.fill ?? 255;
  if (!angleDeg) return Uint8ClampedArray.from(src);
  const theta = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const out = new Uint8ClampedArray(width * height);
  for (let yd = 0; yd < height; yd++) {
    const dy = yd - cy;
    for (let xd = 0; xd < width; xd++) {
      const dx = xd - cx;
      // inverse-map the destination pixel back into the (unrotated) source
      const sx = Math.round(dx * cos + dy * sin + cx);
      const sy = Math.round(-dx * sin + dy * cos + cy);
      out[yd * width + xd] = (sx >= 0 && sx < width && sy >= 0 && sy < height) ? src[sy * width + sx] : fill;
    }
  }
  return out;
}

/** Estimate a small skew angle (degrees, positive = clockwise) on a BINARY image (0 = ink, 255 =
 *  background — `adaptiveThreshold`'s output) via projection-profile variance: the horizontal
 *  row-sum profile of correctly-deskewed text has sharp peaks at baselines (high variance); a
 *  skewed page smears ink across rows (low variance). Tries every angle in
 *  [-maxAngle, maxAngle] at `step` degrees and returns the one with the highest-variance profile.
 *  Deliberately bounded to a few degrees either way — a county scan is a degree or two off square,
 *  not badly rotated, and a wide search both costs more and risks locking onto a false peak. */
export function estimateSkewAngle(binary, width, height, opts = {}) {
  const maxAngle = opts.maxAngle ?? 5;
  const step = opts.step ?? 0.25;
  const scoreFor = (angleDeg) => {
    const theta = (angleDeg * Math.PI) / 180;
    const sin = Math.sin(theta), cos = Math.cos(theta);
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    const rows = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        if (binary[y * width + x] !== 0) continue; // count ink pixels only
        const dx = x - cx;
        const ry = Math.round(dx * sin + dy * cos + cy);
        if (ry >= 0 && ry < height) rows[ry]++;
      }
    }
    let mean = 0;
    for (let i = 0; i < rows.length; i++) mean += rows[i];
    mean /= rows.length || 1;
    let variance = 0;
    for (let i = 0; i < rows.length; i++) { const d = rows[i] - mean; variance += d * d; }
    return variance;
  };
  let best = { angle: 0, score: -Infinity };
  for (let a = -maxAngle; a <= maxAngle + 1e-9; a += step) {
    const score = scoreFor(Math.round(a * 100) / 100);
    if (score > best.score) best = { angle: Math.round(a * 100) / 100, score };
  }
  return best.angle;
}

/** Full preprocessing pass for one page render: grayscale → adaptive threshold → deskew. Returns
 *  { data: Uint8ClampedArray (binary 0/255), width, height, skewDeg (the corrective rotation
 *  `rotateImage` was called with — NOT the page's own tilt; `estimateSkewAngle` already returns the
 *  angle that, applied via `rotateImage`, squares the page — composing two `rotateImage` calls is
 *  additive, so `rotateImage(rotateImage(X, a), b) ≈ rotateImage(X, a+b)`, which is what makes
 *  passing its result straight back into `rotateImage` correct) } — the shape `deedOcr.js` hands to
 *  Tesseract (which accepts a plain single-channel buffer via an ImageData-like object just as
 *  readily as RGBA). */
export function preprocessPage(imageDataLike, opts = {}) {
  const { width, height } = imageDataLike;
  const gray = toGrayscale(imageDataLike);
  const bitonalSource = isEffectivelyBitonal(gray, opts.bitonal);
  const binary = bitonalSource
    ? Uint8ClampedArray.from(gray, (v) => (v < 128 ? 0 : 255)) // already black/white — just snap to it
    : adaptiveThreshold(gray, width, height, opts.threshold);
  const skewDeg = estimateSkewAngle(binary, width, height, opts.skew);
  const deskewed = skewDeg ? rotateImage(binary, width, height, skewDeg, { fill: 255 }) : binary;
  return { data: deskewed, width, height, skewDeg, bitonalSource };
}
