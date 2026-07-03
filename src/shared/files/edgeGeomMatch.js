/* Geometric edge-line match (B340 tail #2 / B337's middle fallback) — PURE + browser-free.
 *
 * WHERE IT FITS. Auto-stitch (autoStitch.js) places a neighbor from its match-line TEXT LABEL
 * ("SEE SHEET C-6"). When the label is missing/unreadable, a sheet drops to the 2-point manual
 * Align — pre-seeded with the drawing-area RECTANGLE edge (detectedEndpointsFor). Between those two
 * is the case this engine handles: the cut is DRAWN (a real match line — often a heavy dashed line
 * inset from the paper edge) even though no text names it. Matching that drawn geometry across two
 * adjacent sheets lands the seam on the true line instead of the paper edge.
 *
 * IMPROVE-ONLY, FAIL-OPEN (owner rule: a wrong stitch is worse than an unstitched one). Every entry
 * point returns null unless it gets a confident, mutually-consistent fit — so the caller keeps the
 * label placement, or ultimately the pre-seeded manual Align. It can only ever tighten a seam.
 *
 * PURE + DI. It operates on vector SEGMENTS ([{x1,y1,x2,y2}] in page units) that the browser
 * extracts from the PDF's drawn linework — never a canvas. The extraction (finding the candidate
 * match-line segments near a drawing-area edge from the PDF operator list) is the DORMANT browser
 * seam, verified live; the fit + correspondence here are unit-tested in Node. Complements the RASTER
 * fitter (matchLineFit.js, B413) which serves the scanned-image path; this is the vector path.
 */

const deg = (rad) => (rad * 180) / Math.PI;

// Break each segment into its two endpoints; a drawn match line is usually several colinear dashes.
function segPoints(segments = []) {
  const pts = [];
  for (const s of segments || []) {
    if (!s) continue;
    if ([s.x1, s.y1, s.x2, s.y2].every(Number.isFinite)) { pts.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }); }
  }
  return pts;
}

/* Total-least-squares (PCA) line fit through a point cloud — handles ANY orientation (vertical,
 * horizontal, skewed), unlike the near-horizontal RANSAC in matchLineFit. Returns
 *   { p1, p2, dir:{x,y}, span, perpSpread, straightness (0..1), n }  or null (too few points).
 * `p1,p2` are the extent endpoints along the principal axis; `straightness` → 1 as the points hug a
 * single line. */
export function fitEdgeLine(segments) {
  const pts = segPoints(segments);
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= n; syy /= n; sxy /= n;
  // Principal eigenvector of the covariance [[sxx,sxy],[sxy,syy]].
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc); // l1 ≥ l2 ≥ 0
  let vx, vy;
  if (Math.abs(sxy) > 1e-9) { vx = l1 - syy; vy = sxy; }
  else { vx = sxx >= syy ? 1 : 0; vy = sxx >= syy ? 0 : 1; }
  const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
  // Project onto the axis for the extent; perpendicular distances for straightness.
  let tmin = Infinity, tmax = -Infinity, perpMax = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    const t = dx * vx + dy * vy;
    const perp = Math.abs(-vy * dx + vx * dy);
    if (t < tmin) tmin = t; if (t > tmax) tmax = t;
    if (perp > perpMax) perpMax = perp;
  }
  const span = tmax - tmin;
  const perpSpread = Math.sqrt(l2);
  // Straightness: along-axis variance should dominate perpendicular variance for a true line.
  const straightness = l1 > 1e-9 ? Math.max(0, 1 - l2 / l1) : 0;
  const p1 = { x: mx + tmin * vx, y: my + tmin * vy };
  const p2 = { x: mx + tmax * vx, y: my + tmax * vy };
  return { p1, p2, dir: { x: vx, y: vy }, span, perpSpread, straightness, n };
}

/* Canonical endpoint order so two sheets sharing a seam correspond endpoint-for-endpoint — the SAME
 * convention as detectedEndpointsFor: a vertical-ish cut orders top→bottom, a horizontal-ish cut
 * left→right. This is what lets the two ordered pairs feed solveM without a 180° flip. */
export function orderEndpoints(p1, p2) {
  const vertical = Math.abs(p2.y - p1.y) >= Math.abs(p2.x - p1.x);
  if (vertical) return p1.y <= p2.y ? [p1, p2] : [p2, p1];
  return p1.x <= p2.x ? [p1, p2] : [p2, p1];
}

const lineAngleDeg = (fit) => deg(Math.atan2(fit.dir.y, fit.dir.x));
// Smallest absolute difference between two undirected line angles (mod 180°).
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 180;
  return d > 90 ? 180 - d : d;
}

/* Match the drawn match line across two adjacent sheets. `anchorSegs` / `neighborSegs` are the
 * candidate seam segments on each (page units). Returns the two ordered endpoint pairs to feed the
 * existing similarity solve — { a1, a2, b1, b2, confidence } — or null when the fit isn't confident
 * or the two lines don't agree (different orientation, or wildly different length ⇒ not the same
 * cut). Fail open: null ⇒ caller keeps the label/rectangle placement. */
export function matchSeamEdges(anchorSegs, neighborSegs, opts = {}) {
  const { minSpan = 40, minStraightness = 0.985, maxAngleDiffDeg = 12, maxLenRatio = 1.4 } = opts;
  const fa = fitEdgeLine(anchorSegs);
  const fb = fitEdgeLine(neighborSegs);
  if (!fa || !fb) return null;
  if (fa.span < minSpan || fb.span < minSpan) return null;
  if (fa.straightness < minStraightness || fb.straightness < minStraightness) return null;
  const angDiff = angleDiff(lineAngleDeg(fa), lineAngleDeg(fb));
  if (angDiff > maxAngleDiffDeg) return null;
  const lenRatio = fa.span >= fb.span ? fa.span / fb.span : fb.span / fa.span;
  if (lenRatio > maxLenRatio) return null;
  const [a1, a2] = orderEndpoints(fa.p1, fa.p2);
  const [b1, b2] = orderEndpoints(fb.p1, fb.p2);
  // Confidence: both lines straight, same orientation, matched length. Blend to 0..1.
  const straight = Math.min(fa.straightness, fb.straightness);
  const angScore = 1 - angDiff / maxAngleDiffDeg;
  const lenScore = 1 - (lenRatio - 1) / (maxLenRatio - 1);
  const confidence = Math.max(0, Math.min(1, 0.5 * straight + 0.25 * angScore + 0.25 * lenScore));
  return { a1, a2, b1, b2, confidence };
}
