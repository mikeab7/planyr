/* PURE raster DIFF engine for revision compare (B464 / Document Review "compare versions").
 *
 * Given two ALREADY-REGISTERED binary rasters of the same sheet (rev A = old, rev B = new; 1 = ink,
 * 0 = background, identical W×H), classify every pixel as unchanged / removed / added and cluster the
 * changed pixels into navigable CHANGE REGIONS (the auto change-list). No canvas, no DOM, no React —
 * operates on Uint8Array, so it is fully unit-testable on tiny hand-built fixtures.
 *
 * The color-wash the user sees is derived from the per-pixel `codes` IN THE VIEW LAYER (theme tokens),
 * never here — this stays presentation-free.
 *
 * Robustness: a `tol` dilation absorbs sub-pixel jitter + anti-aliasing + tiny misregistration, so a
 * line that merely shifted 1px is NOT flagged as both removed AND added (the classic false-positive
 * halo). `minArea` then drops residual scan speckle. These two knobs are the compare settings exposed
 * for noisy scans. Mirrors the morphology approach in `matchLineFit.js` (O(n) last-seen-ink dilation).
 */

/** Per-pixel classification codes. */
export const DIFF_BG = 0;        // background in both
export const DIFF_SAME = 1;      // ink in both (within tol) — unchanged linework
export const DIFF_REMOVED = 2;   // ink in A only (was there, now gone)
export const DIFF_ADDED = 3;     // ink in B only (newly drawn)

/* Horizontal binary dilation of one row by radius r — any ink within r px → ink. O(len). */
function rowDilate(src, off, len, r, out) {
  let last = -1e9;
  for (let x = 0; x < len; x++) { if (src[off + x]) last = x; out[off + x] = x - last <= r ? 1 : 0; }
  let next = 1e9;
  for (let x = len - 1; x >= 0; x--) { if (src[off + x]) next = x; if (!out[off + x] && next - x <= r) out[off + x] = 1; }
}

/** Separable 2-D binary dilation by radius r (square structuring element). Pure; returns a new
 *  Uint8Array. A pixel is set if any source ink lies within r px in x AND r px in y. */
export function dilate2D(bin, W, H, r) {
  if (!(r > 0)) return bin.slice();
  // Horizontal pass row-by-row.
  const horiz = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) rowDilate(bin, y * W, W, r, horiz);
  // Vertical pass column-by-column (walk each column with the same last-seen trick).
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let last = -1e9;
    for (let y = 0; y < H; y++) { const i = y * W + x; if (horiz[i]) last = y; out[i] = y - last <= r ? 1 : 0; }
    let next = 1e9;
    for (let y = H - 1; y >= 0; y--) { const i = y * W + x; if (horiz[i]) next = y; if (!out[i] && next - y <= r) out[i] = 1; }
  }
  return out;
}

/** Classify each pixel of two registered binaries into DIFF_* codes. `tol` (px) is the
 *  misregistration / anti-alias tolerance: A-ink with B-ink within `tol` counts as unchanged. */
export function classifyDiff(binA, binB, W, H, { tol = 1 } = {}) {
  const n = W * H;
  const codes = new Uint8Array(n);
  const dA = tol > 0 ? dilate2D(binA, W, H, tol) : binA;
  const dB = tol > 0 ? dilate2D(binB, W, H, tol) : binB;
  for (let i = 0; i < n; i++) {
    const a = binA[i], b = binB[i];
    if (!a && !b) { codes[i] = DIFF_BG; continue; }
    // Ink in A: removed only if B has NO ink within tol; else it persisted (unchanged).
    if (a && !dB[i]) { codes[i] = DIFF_REMOVED; continue; }
    // Ink in B: added only if A has NO ink within tol.
    if (b && !dA[i]) { codes[i] = DIFF_ADDED; continue; }
    codes[i] = DIFF_SAME; // ink present in both (within tol)
  }
  return codes;
}

/** Connected-components over the CHANGED pixels (removed ∪ added) → change regions. Each region:
 *  { bbox:{x,y,w,h}, area, kind:'added'|'removed'|'mixed', centroid:{x,y} }. Regions below `minArea`
 *  are dropped (scan speckle). `connectivity` is 4 or 8. Pure iterative flood fill (no recursion). */
export function clusterChanges(codes, W, H, { minArea = 24, connectivity = 8 } = {}) {
  const n = W * H;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n); // reused explicit stack of pixel indices
  const regions = [];
  const neigh8 = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
  const neigh4 = [-1, 1, -W, W];
  const neigh = connectivity === 4 ? neigh4 : neigh8;
  for (let start = 0; start < n; start++) {
    const c0 = codes[start];
    if ((c0 !== DIFF_REMOVED && c0 !== DIFF_ADDED) || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start; seen[start] = 1;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0, sumX = 0, sumY = 0, hasRem = false, hasAdd = false;
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % W, y = (idx / W) | 0;
      const c = codes[idx];
      area++; sumX += x; sumY += y;
      if (c === DIFF_REMOVED) hasRem = true; else hasAdd = true;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let k = 0; k < neigh.length; k++) {
        const j = idx + neigh[k];
        if (j < 0 || j >= n) continue;
        // guard horizontal wrap on the ±1 / diagonal neighbors
        const nx = j % W;
        if (Math.abs(nx - x) > 1) continue;
        if (seen[j]) continue;
        const cj = codes[j];
        if (cj !== DIFF_REMOVED && cj !== DIFF_ADDED) continue;
        seen[j] = 1; stack[sp++] = j;
      }
    }
    if (area < minArea) continue;
    regions.push({
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      area,
      kind: hasRem && hasAdd ? "mixed" : hasRem ? "removed" : "added",
      centroid: { x: sumX / area, y: sumY / area },
    });
  }
  // Largest-first so the change list leads with the most significant edits.
  regions.sort((p, q) => q.area - p.area);
  return regions;
}

/** Convenience: classify → cluster → { codes, regions, counts }. counts tallies regions by kind. */
export function diffRasters(binA, binB, W, H, opts = {}) {
  const codes = classifyDiff(binA, binB, W, H, opts);
  const regions = clusterChanges(codes, W, H, opts);
  const counts = { added: 0, removed: 0, mixed: 0, total: regions.length };
  for (const r of regions) counts[r.kind]++;
  return { codes, regions, counts };
}
