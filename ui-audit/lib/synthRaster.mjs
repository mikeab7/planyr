/* synthRaster — real, decodable MEGAPIXEL rasters for the plan-raster hypothesis (NEW-1).
 *
 * ⛔ WHY THIS EXISTS, AND WHAT IT IS AND IS NOT ALLOWED TO INVENT.
 *
 * The owner reports his Bain plan is slow. Its single largest structural difference from Goose
 * Creek — the plan every perf instrument in this repo has measured all program — is that Bain
 * composites TWO LARGE RASTERS over the drawing: a 1728 × 2592 sheet overlay at opacity 0.55 and
 * a 1800 × 1167 aerial underlay at opacity 1.0. Goose Creek has none. 4.5 megapixels of
 * SEMI-TRANSPARENT backdrop is a cost class no number in this program has ever exercised: an
 * opaque layer can be blitted, a 0.55-alpha layer must be BLENDED with everything beneath it on
 * every frame, and it defeats the compositor's opaque-layer optimisations outright.
 *
 * THE MEASURED FACTS ARE PARAMETERS; ONLY THE PICTURE IS SYNTHETIC. Dimensions, opacity,
 * `ftPerPx`, and the fact that the bytes live in IndexedDB as a base64 STRING are all measured
 * from the owner's real plan and are reproduced exactly — they are what the cost depends on. What
 * this file fabricates is only the CONTENT of the pixels, because the content is his survey and
 * this repo has no business carrying it. The distinction matters: decode cost, bitmap allocation,
 * texture upload and blend cost are functions of the dimensions and the alpha, not of what the
 * drawing depicts.
 *
 * ⛔ EVERY SYNTHESISED RASTER MUST HAVE DISTINCT BYTES — the same rule, and the same reason, as
 * lib/fakeTile.mjs. Chromium caches decoded images keyed by content, so serving one image twice
 * would allocate ONE bitmap and share it, and the arm that is supposed to cost two bitmaps would
 * silently cost one. `seed` is folded into every pixel, so no two rasters in a run can collide.
 *
 * ⚠ AND THE ENCODED SIZE IS TARGETED, NOT ACCEPTED. The IndexedDB half of the hypothesis — "are
 * those 10 MB strings re-read and re-decoded on a view change, or held once?" — is about the
 * STRING LENGTH, which is a function of how compressible the picture is, not of its dimensions. A
 * flat gradient at 1728 × 2592 deflates to a few hundred KB and would understate that half by a
 * factor of thirty. So `synthRaster` searches a noise fraction until the encoded PNG lands near a
 * requested byte target, and REPORTS what it achieved next to what was asked for — an approximate
 * match that says so beats an exact-looking number that was never checked.
 */
import { encodeRgbPng } from "./fakeTile.mjs";

/** Deterministic 32-bit hash. Pure and total; no RNG anywhere in this file, so a fixture's bytes
 *  are identical on every machine and a cached raster is safe to reuse across runs. */
export function hash32(a, b, c) {
  let h = Math.imul(a + 0x9e37, 2654435761) ^ Math.imul(b + 0x85eb, 2246822519) ^ Math.imul(c + 0xc2b2, 3266489917);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return h >>> 0;
}

/* A pixel generator with a tunable entropy knob.
 *
 * `q` in [0,1] is the fraction of pixels that receive a full-range noise byte; the rest get a
 * smooth two-axis gradient tinted by `seed`. q = 0 compresses to almost nothing, q = 1 is
 * effectively incompressible. Everything in between is monotonic in q, which is what makes the
 * search below well-behaved. The gradient is not decoration: a real scanned survey is mostly
 * near-white paper with sparse dark ink, so "mostly smooth with scattered high-entropy detail" is
 * the right shape as well as the convenient one. */
export function rasterFill(seed, q) {
  const thresh = Math.max(0, Math.min(1, q)) * 0xffffffff;
  return (row, col, p, raw) => {
    const h = hash32(row, col, seed);
    if (h <= thresh) {
      raw[p] = h & 0xff;
      raw[p + 1] = (h >>> 8) & 0xff;
      raw[p + 2] = (h >>> 16) & 0xff;
    } else {
      const g = 210 + ((row >> 3) & 0x1f) - ((col >> 4) & 0x0f);
      raw[p] = (g + seed) & 0xff;
      raw[p + 1] = (g + (row >> 6)) & 0xff;
      raw[p + 2] = (g + (col >> 6)) & 0xff;
    }
  };
}

/** Bytes a decoded bitmap of these dimensions costs the renderer — 4 per pixel (RGBA), whatever
 *  the file's own colour type. This is the number the JS heap cannot see and the one the whole
 *  raster hypothesis turns on. */
export const decodedBytes = (w, h) => Math.max(0, Math.floor(w)) * Math.max(0, Math.floor(h)) * 4;

/** Megapixels, for the report. */
export const megapixels = (w, h) => +((Math.max(0, w) * Math.max(0, h)) / 1e6).toFixed(2);

/** Length of the base64 payload a Buffer of `n` bytes becomes — what actually sits in IndexedDB,
 *  since the app stores rasters as `data:` URL STRINGS, not blobs. 4 characters per 3 bytes,
 *  rounded up to a 4-character group. */
export const base64Len = (n) => 4 * Math.ceil(Math.max(0, n) / 3);

/* Search `q` until the encoded PNG is within `tolerance` of `targetBytes`.
 *
 * Bisection rather than a formula, because deflate's ratio on this pixel generator is not
 * analytically knowable and pretending otherwise would be the kind of unchecked number this file's
 * header argues against. `maxIters` bounds the cost: each iteration deflates the full raw image
 * (13 MB at Bain's overlay size), so the default of 9 is a deliberate ceiling — the result always
 * reports its achieved size and its error, and a caller is free to accept a near miss.
 *
 * With no target, q defaults to a fixed 0.55 and no search runs at all. */
export function synthRasterPng(width, height, { seed = 1, targetBytes = null, tolerance = 0.06, maxIters = 9 } = {}) {
  if (!targetBytes) {
    const png = encodeRgbPng(width, height, rasterFill(seed, 0.55));
    return { png, q: 0.55, bytes: png.length, targetBytes: null, iters: 0, errorPct: null };
  }
  let lo = 0, hi = 1, best = null, iters = 0;
  for (; iters < maxIters; iters++) {
    const q = (lo + hi) / 2;
    const png = encodeRgbPng(width, height, rasterFill(seed, q));
    const err = (png.length - targetBytes) / targetBytes;
    if (!best || Math.abs(err) < Math.abs(best.errorPct)) best = { png, q, bytes: png.length, errorPct: err };
    if (Math.abs(err) <= tolerance) break;
    if (png.length < targetBytes) lo = q; else hi = q;
  }
  return { ...best, targetBytes, iters: iters + 1, errorPct: +(best.errorPct * 100).toFixed(1) };
}

/** The `data:` URL the app itself stores and renders — the exact representation the measured
 *  IndexedDB entries hold, so the read/decode path under test is the product's own. */
export const pngDataUrl = (png) => `data:image/png;base64,${png.toString("base64")}`;
