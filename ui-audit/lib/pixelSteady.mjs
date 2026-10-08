/* pixelSteady — pure pixel reductions for verify-panel-resize-steady's PIXEL phase (NEW-1 / NEW-2, 2026-10-08).
 *
 * WHY PIXELS. The rect phase of that harness read `getBoundingClientRect()` and reported 0.00 movement on every
 * build — including the one the owner could still see shaking. A rect is the LAYOUT position; the browser then
 * snaps each painted box to whole device (or CSS) pixels and re-rasterises anything whose snap changed, so a
 * box can report the same position while its pixels move, and a hatch can slide while every edge holds still.
 * Only the painted pixels answer "did anything outside the panel change". Measured on main at 2.15× scaling:
 * rects 0.00 everywhere, while ~700,000 aerial pixels and every hatch changed on every drag step.
 *
 * Screenshots come from `decodePng` (pngDiff.mjs): `{ width, height, channels, data }`. */

/** Pixels that differ between two same-sized captures, and the worst per-channel delta (RGB). */
export function pixelDelta(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) throw new Error("pixelDelta: size mismatch");
  const ca = a.channels, cb = b.channels;
  let n = 0, max = 0;
  for (let p = 0, i = 0, j = 0; p < a.width * a.height; p++, i += ca, j += cb) {
    const d = Math.max(Math.abs(a.data[i] - b.data[j]), Math.abs(a.data[i + 1] - b.data[j + 1]), Math.abs(a.data[i + 2] - b.data[j + 2]));
    if (d) { n++; if (d > max) max = d; }
  }
  return { n, max };
}

/** One row of RGB samples from `img` at row `y`, columns [x0, x1). */
export function sampleLine(img, y, x0, x1) {
  const out = [];
  const yy = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x1)); x++) {
    const i = (yy * img.width + x) * img.channels;
    out.push(img.data[i], img.data[i + 1], img.data[i + 2]);
  }
  return out;
}

/** Worst channel delta between two sample lines (Infinity when they are not comparable). */
export function lineDelta(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** How many distinct values a sample line holds — a hatch line must hold stripes (> 2), or the probe is not on one. */
export function lineVariety(line) {
  const s = new Set();
  for (let i = 0; i + 2 < line.length; i += 3) s.add(`${line[i]},${line[i + 1]},${line[i + 2]}`);
  return s.size;
}

/** Horizontal displacement (device px) of `b` against `a`, by mean absolute difference over sub-pixel shifts
 *  of a linearly-interpolated luminance image. Distinguishes a real shift from a re-shade: a re-shaded edge has its
 *  best match at 0; a moved one does not. */
export function estimateShiftX(a, b, { range = 1, step = 0.05, margin = 4 } = {}) {
  const lum = (img) => { const o = new Float64Array(img.width * img.height); for (let p = 0, i = 0; p < o.length; p++, i += img.channels) o[p] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; return o; };
  const A = lum(a), B = lum(b), W = a.width, H = a.height;
  let best = { s: 0, e: Infinity };
  for (let s = -range; s <= range + 1e-9; s += step) {
    const x0 = Math.floor(s), f = s - x0;
    let e = 0, n = 0;
    for (let y = 0; y < H; y += 2) for (let x = margin; x < W - margin - 1; x++) {
      const xs = x + x0; if (xs < 0 || xs + 1 >= W) continue;
      const v = (1 - f) * B[y * W + xs] + f * B[y * W + xs + 1];
      e += Math.abs(A[y * W + x] - v); n++;
    }
    e /= n || 1;
    if (e < best.e - 1e-9) best = { s: Math.round(s * 100) / 100, e };
  }
  return best.s;
}
