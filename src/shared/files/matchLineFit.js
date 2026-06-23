/* Pixel-accurate match-line fitting for the raster Stitcher (B413).
 *
 * WHY THIS EXISTS. The label-driven auto-stitch (autoStitch.js, B337) places a neighbor by
 * butting the two sheets' DRAWING-AREA RECTANGLE EDGES together (detectedEndpointsFor). That is
 * exact for clean vector sets, but on a real-world *scanned* set the actual match line is:
 *   • inset from the sheet edge (it sits inside the drawing, not on the border),
 *   • slightly skewed (each plot/scan is rotated ~0.5–1.5° from the next), and
 *   • dashed (so simple line detectors miss it).
 * Aligning rectangle edges then leaves a visibly broken seam. This module finds the REAL match
 * line on each sheet from its rendered pixels and returns the two endpoints to feed the existing
 * similarity solve (solveM, stitchGeom.js) — so two adjacent sheets join along their true match
 * lines, seamlessly, instead of along their paper edges.
 *
 * HOW (proven on real compressed survey scans before coding):
 *   1. Seed a horizontal band on the "MATCH LINE … SHEET N" label position (OCR/text reader).
 *   2. Isolate the line: 1-D horizontal CLOSE bridges the dash gaps, then 1-D horizontal OPEN
 *      drops vertical text strokes and crossing linework — leaving the dashes of the line itself.
 *   3. RANSAC-fit a near-horizontal line through the surviving pixels over the full width — robust
 *      to the stray marks that survive, and accurate because the baseline spans the whole sheet.
 *   4. slideRefine() finds the along-line shift that best connects the features crossing the seam.
 *
 * PURE + DI: operates on a binary Uint8Array (1 = ink), never on a canvas, so it is unit-tested
 * in Node against real-sheet fixtures (test/matchLineFit.test.js). The browser glue
 * (doc-review/lib/matchLineRefine.js) does the canvas→binary extraction and calls in here.
 *
 * Fails safe: every entry point returns null when it can't get a confident fit, so the caller
 * keeps the label-based placement (and ultimately the manual-Align safety net). A wrong snap is
 * worse than none.
 */

// Small deterministic PRNG (mulberry32) so RANSAC is reproducible — tests must be stable, and a
// flaky alignment is a support nightmare. Seeded per call.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 1-D horizontal CLOSE on one row (dilate then erode by radius r): fills ink gaps up to 2r wide
 * so a dashed line reads as continuous. `row`/out are 0/1 over [0,len). */
export function rowClose(row, len, r) {
  if (r <= 0) return row.slice(0, len);
  const dil = new Uint8Array(len);
  // dilate: any ink within r → ink. Run via last-seen-ink index for O(len).
  let last = -1e9;
  for (let x = 0; x < len; x++) { if (row[x]) last = x; if (x - last <= r) dil[x] = 1; }
  let next = 1e9;
  for (let x = len - 1; x >= 0; x--) { if (row[x]) next = x; if (next - x <= r) dil[x] = 1; }
  // erode: ink only if all within r are ink → equivalently, gap-free run. Use distance-to-gap.
  const out = new Uint8Array(len);
  let lastGap = -1e9;
  const isGap = (x) => !dil[x];
  for (let x = 0; x < len; x++) if (isGap(x)) lastGap = x;
  // need both-sided; compute nearest gap on each side
  const leftGap = new Int32Array(len); let lg = -1e9;
  for (let x = 0; x < len; x++) { if (isGap(x)) lg = x; leftGap[x] = lg; }
  let rg = 1e9;
  for (let x = len - 1; x >= 0; x--) { if (isGap(x)) rg = x; const dist = Math.min(x - leftGap[x], rg - x); if (dil[x] && dist > r) out[x] = 1; }
  return out;
}

/* 1-D horizontal OPEN on one row (erode then dilate by radius r): removes ink runs shorter than
 * ~2r (vertical text strokes, crossing lines) while keeping long horizontal dashes. */
export function rowOpen(row, len, r) {
  if (r <= 0) return row.slice(0, len);
  // erode: ink only where a full 2r+1 window is ink → keep centers of long runs.
  const er = new Uint8Array(len);
  let run = 0;
  const runEnd = new Int32Array(len); // length of ink run ending at x
  for (let x = 0; x < len; x++) { run = row[x] ? run + 1 : 0; runEnd[x] = run; }
  // a pixel survives erosion if it's at least r from both ends of its run
  let nextGap = len;
  for (let x = len - 1; x >= 0; x--) { if (!row[x]) nextGap = x; const toRight = nextGap - x - 1; const toLeft = runEnd[x] - 1; if (row[x] && toLeft >= r && toRight >= r) er[x] = 1; }
  // dilate back by r
  return rowDilate(er, len, r);
}

function rowDilate(row, len, r) {
  const out = new Uint8Array(len);
  let last = -1e9;
  for (let x = 0; x < len; x++) { if (row[x]) last = x; if (x - last <= r) out[x] = 1; }
  let next = 1e9;
  for (let x = len - 1; x >= 0; x--) { if (row[x]) next = x; if (next - x <= r) out[x] = 1; }
  return out;
}

/* Isolate candidate match-line pixels inside a band and return their coordinates.
 * bin: Uint8Array(W*H), 1 = ink. Band rows [yTop,yBot), cols [x0,x1).
 * closeR/openR are horizontal radii (px). Returns { xs:Float64Array, ys:Float64Array }. */
export function isolateLinePoints(bin, W, H, { x0, x1, yTop, yBot, closeR = 7, openR = 20 }) {
  x0 = Math.max(0, x0 | 0); x1 = Math.min(W, x1 | 0);
  yTop = Math.max(0, yTop | 0); yBot = Math.min(H, yBot | 0);
  const len = x1 - x0;
  const xs = [], ys = [];
  if (len <= 0 || yBot <= yTop) return { xs: new Float64Array(0), ys: new Float64Array(0) };
  const rowBuf = new Uint8Array(len);
  for (let y = yTop; y < yBot; y++) {
    const base = y * W + x0;
    for (let i = 0; i < len; i++) rowBuf[i] = bin[base + i];
    const closed = rowClose(rowBuf, len, closeR);
    const opened = rowOpen(closed, len, openR);
    for (let i = 0; i < len; i++) if (opened[i]) { xs.push(x0 + i); ys.push(y); }
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
}

/* RANSAC fit of a near-horizontal line y = m·x + b through point cloud {xs,ys}. Rejects steep
 * samples (|m|>maxSlope) so it can't lock onto a vertical feature. Returns { m, b, inliers } or
 * null when too few points / no consensus. */
export function ransacLine(xs, ys, { iters = 1500, thresh = 3, maxSlope = 0.12, seed = 1, minInliers = 200 } = {}) {
  const n = xs.length;
  if (n < Math.max(20, minInliers / 4)) return null;
  const rnd = mulberry32(seed);
  let best = null;
  for (let k = 0; k < iters; k++) {
    const i = (rnd() * n) | 0, j = (rnd() * n) | 0;
    const dx = xs[j] - xs[i];
    if (Math.abs(dx) < 50) continue; // need a wide baseline for a stable slope
    const m = (ys[j] - ys[i]) / dx;
    if (Math.abs(m) > maxSlope) continue;
    const b = ys[i] - m * xs[i];
    let c = 0;
    for (let p = 0; p < n; p++) if (Math.abs(ys[p] - (m * xs[p] + b)) < thresh) c++;
    if (!best || c > best.count) best = { m, b, count: c };
  }
  if (!best || best.count < minInliers) return null;
  // Least-squares refit on inliers for sub-pixel accuracy; also track how far the inliers SPAN
  // horizontally — the real match line runs the full sheet width, a stray horizontal note/label
  // does not, so the caller rejects a fit whose inliers cover only a short stretch.
  let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0, xMin = Infinity, xMax = -Infinity;
  for (let p = 0; p < n; p++) {
    if (Math.abs(ys[p] - (best.m * xs[p] + best.b)) < thresh) {
      sx += xs[p]; sy += ys[p]; sxx += xs[p] * xs[p]; sxy += xs[p] * ys[p]; c++;
      if (xs[p] < xMin) xMin = xs[p]; if (xs[p] > xMax) xMax = xs[p];
    }
  }
  const denom = c * sxx - sx * sx || 1;
  const m = (c * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / c;
  return { m, b, inliers: c, xMin, xMax };
}

/* Fit the match line in a band seeded on the label's y. Returns the two endpoints across the
 * working width plus the line, in the SAME pixel space as `bin`, or null.
 *   { m, b, x0, x1, p1:{x,y}, p2:{x,y}, inliers } */
export function fitMatchLine(bin, W, H, { yCen, x0, x1, halfBand = 40, closeR = 7, openR = 20, minSpanFrac = 0.35, ransac = {} }) {
  if (x0 == null) x0 = Math.round(W * 0.06);
  if (x1 == null) x1 = Math.round(W * 0.94);
  const pts = isolateLinePoints(bin, W, H, { x0, x1, yTop: yCen - halfBand, yBot: yCen + halfBand, closeR, openR });
  const fit = ransacLine(pts.xs, pts.ys, ransac);
  if (!fit) return null;
  // The match line must span most of the working width; a short horizontal label/note that
  // survived the morphology would otherwise masquerade as the seam. (Real match line ⇒ ~full span.)
  if ((fit.xMax - fit.xMin) < minSpanFrac * (x1 - x0)) return null;
  const yAt = (x) => fit.m * x + fit.b;
  return { m: fit.m, b: fit.b, x0, x1, p1: { x: x0, y: yAt(x0) }, p2: { x: x1, y: yAt(x1) }, inliers: fit.inliers };
}

/* Column ink profile (ink count per column) over rows [yTop,yBot). Used by slideRefine. */
export function colProfile(bin, W, H, yTop, yBot) {
  yTop = Math.max(0, yTop | 0); yBot = Math.min(H, yBot | 0);
  const p = new Float64Array(W);
  for (let y = yTop; y < yBot; y++) { const base = y * W; for (let x = 0; x < W; x++) if (bin[base + x]) p[x]++; }
  return p;
}

/* Find the horizontal shift (dx, in px) that best lines up the features crossing the seam:
 * profA = columns just ABOVE the seam on the anchor; profB = columns just BELOW on the neighbor
 * (already mapped to the anchor's frame). Cross-correlation peak over [-range,range]. */
export function slideRefine(profA, profB, range = 200) {
  const W = Math.min(profA.length, profB.length);
  let best = { score: -1, dx: 0 };
  for (let dx = -range; dx <= range; dx++) {
    let s = 0;
    const a0 = Math.max(0, dx), a1 = W + Math.min(0, dx);
    for (let x = a0; x < a1; x++) s += profA[x] * profB[x - dx];
    if (s > best.score) best = { score: s, dx };
  }
  return best.dx;
}
