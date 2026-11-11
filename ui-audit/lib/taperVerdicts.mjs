/* taperVerdicts — the PURE judging rules for "roads of different widths join with a smooth TAPER" (B2671212, root constraint #55).
 *
 * Shared by the signed-in live harness (ui-audit/verify-road-taper-live.mjs) and the Node test that proves these rules can see the defect
 * (test/roadTaperVerdicts.test.js, which runs the SAME predicates on the real pre-fix and post-fix geometry). No DOM, no browser, no app imports:
 * a ring is an array of { x, y } and every number is in whatever unit the caller's ring is in (feet for the model, pixels for a painted path,
 * PDF points for an annotation) — so every comparison here is SCALE-FREE (fractions and ratios) unless the caller passes feet.
 *
 * ⛔ A VERDICT IS ONLY EVIDENCE IF IT CAN GO RED. Each `*Failures` function returns a list of plain sentences (empty = pass) so a caller can print
 * WHY. The pre-fix shape — one step of the whole width difference at the joint, two overlapping strips at a bend — must fail the straight and the
 * angled verdicts, and an equal-width pair must fail the straight verdict's "narrows" test: the live harness asserts all three before it believes a
 * pass. */

/* ---- parsing -------------------------------------------------------------------------------------------------------------------------- */
/** The first subpath of an SVG path "M x y L x y …" (or "x,y" pairs) as a ring. */
export function parseSvgRing(d) {
  const first = String(d || "").split(/(?=[Mm])/).find((s) => /\d/.test(s)) || "";
  const nums = (first.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) || []).map(Number);
  const ring = [];
  for (let i = 0; i + 1 < nums.length; i += 2) ring.push({ x: nums[i], y: nums[i + 1] });
  if (ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y) ring.pop();
  return ring;
}

/* ---- ring maths ----------------------------------------------------------------------------------------------------------------------- */
export const areaOf = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
export const distToPolyline = (p, line) => { let m = Infinity; for (let i = 0; i + 1 < line.length; i++) m = Math.min(m, distToSegment(p, line[i], line[i + 1])); return m; };
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
/** True when two non-adjacent edges of the ring properly cross (a bow-tie / folded outline). */
export function selfIntersects(ring) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

/* ---- width profile of a left-to-right strip ------------------------------------------------------------------------------------------- */
/** Half the vertical extent of the ring on the line x = X (null when the line misses it). */
export function halfWidthAt(ring, X) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a.x - X) * (b.x - X) > 0 || a.x === b.x) continue;
    const y = a.y + ((b.y - a.y) * (X - a.x)) / (b.x - a.x);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return Number.isFinite(lo) ? (hi - lo) / 2 : null;
}
/** The width at `n` evenly spaced stations: { first, last, maxStep (fraction of first), mono, startFrac, endFrac (where the narrowing begins / ends, as a fraction of the length), x0, x1 }. */
export function profile(ring, n = 400) {
  const xs = ring.map((p) => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const hs = [];
  for (let i = 1; i < n; i++) { const h = halfWidthAt(ring, x0 + ((x1 - x0) * i) / n); if (h != null) hs.push({ i, h }); }
  if (hs.length < 10) return { first: null, last: null, maxStep: Infinity, maxSlope: Infinity, mono: false, startFrac: null, endFrac: null, x0, x1, n: hs.length };
  const first = hs[0].h, last = hs[hs.length - 1].h;
  let maxStep = 0, mono = true;
  for (let k = 1; k < hs.length; k++) { maxStep = Math.max(maxStep, Math.abs(hs[k].h - hs[k - 1].h)); if (hs[k].h > hs[k - 1].h + first * 0.003) mono = false; }
  let s = 0; while (s < hs.length && hs[s].h >= first * 0.99) s++;
  let e = hs.length - 1; while (e > 0 && hs[e].h <= last * 1.01) e--;
  const win = Math.max(1, Math.round(hs.length / 40)), dx = (x1 - x0) / n;   // slope over a window: robust to a pixel's quantisation, blind to nothing a step or chamfer does
  let maxSlope = 0;
  for (let k = 0; k + win < hs.length; k++) maxSlope = Math.max(maxSlope, Math.abs(hs[k + win].h - hs[k].h) / ((hs[k + win].i - hs[k].i) * dx));
  return { first, last, maxStep: maxStep / first, maxSlope, mono, startFrac: hs[Math.max(0, s - 1)].i / n, endFrac: hs[Math.min(hs.length - 1, e + 1)].i / n, x0, x1, n: hs.length };
}

/* ---- the verdicts --------------------------------------------------------------------------------------------------------------------- */
export const STEP_MAX = 0.03;      // a single-station change above this fraction of the width is a step
/** A wide road narrowing into a narrow one end to end. `ratio` = narrow ÷ wide half width; `slopeMax` = the steepest the edge may run (width change per unit of length, dimensionless —
 *  the automatic taper is 1:10 = 0.1; the pre-fix junction left a ~1:1.5 chamfer and a vertical notch before that). */
export function straightFailures(p, { ratio, ratioTol = 0.04, slopeMax } = {}) {
  const f = [];
  if (!p || p.first == null) return ["the outline could not be read"];
  if (!(Math.abs(p.last / p.first - ratio) <= ratioTol)) f.push(`it does not narrow by the expected ratio (last ÷ first = ${(p.last / p.first).toFixed(3)}, want ${ratio.toFixed(3)} ± ${ratioTol})`);
  if (!p.mono) f.push("the width is not monotone (it widens somewhere)");
  if (!(p.maxStep < STEP_MAX)) f.push(`there is a step in the outline (largest single-station change = ${(p.maxStep * 100).toFixed(1)}% of the width; a taper is under ${STEP_MAX * 100}%)`);
  if (slopeMax != null && !(p.maxSlope <= slopeMax)) f.push(`the edge is too steep to be a taper (${p.maxSlope.toFixed(2)} of width per unit of length; the expected taper is ${slopeMax.toFixed(2)} at most)`);
  return f;
}
/** Two views of the SAME pair agree on the shape (ratio, where the narrowing starts and ends). Scale-free. */
export function profilesDisagree(a, b, { ratioTol = 0.04, fracTol = 0.03 } = {}) {
  const f = [];
  if (!a || !b || a.first == null || b.first == null) return ["a profile could not be read"];
  if (Math.abs(a.last / a.first - b.last / b.first) > ratioTol) f.push(`narrowing ratio ${(b.last / b.first).toFixed(3)} vs ${(a.last / a.first).toFixed(3)}`);
  if (Math.abs(a.startFrac - b.startFrac) > fracTol) f.push(`taper starts at ${b.startFrac.toFixed(3)} of the length vs ${a.startFrac.toFixed(3)}`);
  if (Math.abs(a.endFrac - b.endFrac) > fracTol) f.push(`taper ends at ${b.endFrac.toFixed(3)} of the length vs ${a.endFrac.toFixed(3)}`);
  return f;
}
/** An equal-width pair must be an unchanged plain strip: constant width, no step. */
export function equalWidthFailures(p, ring) {
  const f = [];
  if (!p || p.first == null) return ["the outline could not be read"];
  if (Math.abs(p.first - p.last) / p.first > 0.01) f.push(`the width changes along an equal-width pair (${p.first.toFixed(2)} → ${p.last.toFixed(2)})`);
  if (p.maxStep > 0.01) f.push("there is a step in an equal-width pair");
  if (ring && ring.length > 6) f.push(`an equal-width strip should be a plain rectangle, got ${ring.length} vertices`);
  return f;
}
/** A wide road (half width `halfWide`) turning at J into a narrow one (`halfNarrow`): one simple outline, no spike, no hole in the coverage, the outside-corner wedge filled. */
export function angledFailures(ring, { c1, c2, halfWide, halfNarrow, miterLimit = 2, lenFt = null }) {
  const f = [];
  const J = c1[c1.length - 1];
  if (selfIntersects(ring)) f.push("the outline crosses itself");
  for (const v of ring) {
    const d = Math.min(distToPolyline(v, c1), distToPolyline(v, c2));
    const nearJoint = Math.hypot(v.x - J.x, v.y - J.y) <= halfWide * miterLimit + 1;
    const allowed = (nearJoint ? halfWide * miterLimit : halfWide) + 0.3;
    if (d > allowed) { f.push(`a spike: a vertex sits ${d.toFixed(1)} from the centrelines (the most any point of the pavement can be is ${allowed.toFixed(1)})`); break; }
  }
  const h = halfNarrow - 0.5, W = halfWide - 0.5;
  const along = (line, from, to, off) => {
    const a = line[0], b = line[line.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    for (let t = Math.max(from, 2); t <= Math.min(to, L - 2); t += 4) for (const s of [-1, 1]) {
      const p = { x: a.x + ux * t + -uy * off * s, y: a.y + uy * t + ux * off * s };
      if (!pointInRing(p, ring)) return `ground that is pavement is missing ${t.toFixed(0)} along the centreline, ${off.toFixed(1)} to its ${s < 0 ? "left" : "right"}`;
    }
    return null;
  };
  if (lenFt != null) {   // the wide road really narrows along its last stretch (c1 must run along +x): its half width a little before the joint, against the taper's own line
    const jx = J.x;
    for (const back of [40, 100]) {
      const want = Math.max(halfNarrow, Math.min(halfWide, halfNarrow + (back * (halfWide - halfNarrow)) / lenFt)), got = halfWidthAt(ring, jx - back);
      if (got == null || Math.abs(got - want) > 0.8) { f.push(`the wide road is not tapering into the bend (${back} before the joint its half width is ${got == null ? "unreadable" : got.toFixed(1)}, a ${lenFt}-long taper gives ${want.toFixed(1)})`); break; }
    }
  }
  const gap = along(c1, 0, 1e9, h) || along(c2, 0, 1e9, h) || along(c1, 0, 60, W);
  if (gap) f.push("a gap: " + gap);
  // the outside-corner wedge: between the end of the wide road and the start of the narrow one, on the OUTSIDE of the bend
  const A = c1[0], B = c2[c2.length - 1];
  const d1 = { x: J.x - A.x, y: J.y - A.y }, d2 = { x: B.x - J.x, y: B.y - J.y };
  const n1 = { x: d1.y, y: -d1.x }, n2 = { x: d2.y, y: -d2.x };
  const l1 = Math.hypot(n1.x, n1.y), l2 = Math.hypot(n2.x, n2.y);
  n1.x /= l1; n1.y /= l1; n2.x /= l2; n2.y /= l2;
  const out1 = (n1.x * d2.x + n1.y * d2.y) > 0 ? { x: -n1.x, y: -n1.y } : n1;
  const out2 = (n2.x * -d1.x + n2.y * -d1.y) > 0 ? { x: -n2.x, y: -n2.y } : n2;
  const P1 = { x: J.x + out1.x * h, y: J.y + out1.y * h }, P2 = { x: J.x + out2.x * h, y: J.y + out2.y * h };
  for (const [a, b, c] of [[1 / 3, 1 / 3, 1 / 3], [0.2, 0.4, 0.4], [0.1, 0.7, 0.2], [0.1, 0.2, 0.7]]) {
    const p = { x: a * J.x + b * P1.x + c * P2.x, y: a * J.y + b * P1.y + c * P2.y };
    if (!pointInRing(p, ring)) { f.push("a wedge gap at the outside of the bend (the corner between the two roads is not paved)"); break; }
  }
  return f;
}

/* ---- comparing two renderings of one pair (canvas model ↔ painted path ↔ printed sheet ↔ PDF) ------------------------------------------- */
/** Map `pts` (any space) onto `target` (world) by a uniform scale + translation (+ optional y flip) fitted to the BOUNDING BOXES of a reference pair
 *  seen in both spaces — the equal-width control, whose 4 corners are known exactly. */
export function fitBox(refPts, refTarget, { flipY = false } = {}) {
  const bb = (r) => ({ x0: Math.min(...r.map((p) => p.x)), x1: Math.max(...r.map((p) => p.x)), y0: Math.min(...r.map((p) => p.y)), y1: Math.max(...r.map((p) => p.y)) });
  const a = bb(refPts), b = bb(refTarget), s = (b.x1 - b.x0) / (a.x1 - a.x0);
  return (p) => ({ x: b.x0 + (p.x - a.x0) * s, y: flipY ? b.y1 - (p.y - a.y0) * s : b.y0 + (p.y - a.y0) * s });
}
/** Largest distance from any vertex of either ring to the nearest vertex of the other (after both are in one space). */
export function ringMismatch(a, b) {
  const near = (p, r) => Math.min(...r.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
  return Math.max(...a.map((p) => near(p, b)), ...b.map((p) => near(p, a)));
}

/* ---- a pixel strip (rendered PDF) ----------------------------------------------------------------------------------------------------- */
/** Width profile of the non-paper pixels of an RGB(A) raster inside [x0,x1)×[y0,y1): for each column the vertical extent of ink. Returns a ring-free profile in the same shape as `profile`. */
export function rasterProfile(img, box, { paper = 245, minInk = 40, isInk = null } = {}) {
  const { width, channels, data } = img;
  const cols = [];
  for (let x = box.x0; x < box.x1; x++) {
    let lo = Infinity, hi = -Infinity;
    for (let y = box.y0; y < box.y1; y++) {
      const o = (y * width + x) * channels;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      if (isInk ? !isInk(r, g, b) : (r > g + 60 && r > b + 60)) continue;   // the RED dimension marker (and its tick caps) is drawn across the strip and pokes past its edge — it is not the pavement
      if (r < paper || g < paper || b < paper) { if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    cols.push(Number.isFinite(lo) && hi - lo >= 0 ? (hi - lo + 1) / 2 : 0);
  }
  const inked = cols.map((h, i) => ({ i, h })).filter((c) => c.h >= minInk / 2 / 4);
  if (inked.length < 10) return null;
  const run = inked.slice(2, inked.length - 2);          // drop the antialiased end columns
  const first = run[0].h, last = run[run.length - 1].h, L = run[run.length - 1].i - run[0].i;
  let maxStep = 0, mono = true;
  for (let k = 1; k < run.length; k++) { maxStep = Math.max(maxStep, Math.abs(run[k].h - run[k - 1].h)); if (run[k].h > run[k - 1].h + first * 0.06) mono = false; }
  const win = Math.max(2, Math.round(run.length / 40));
  let maxSlope = 0;
  for (let k = 0; k + win < run.length; k++) maxSlope = Math.max(maxSlope, Math.abs(run[k + win].h - run[k].h) / (run[k + win].i - run[k].i));
  let s = 0; while (s < run.length && run[s].h >= first * 0.96) s++;
  let e = run.length - 1; while (e > 0 && run[e].h <= last * 1.06) e--;
  return { first, last, maxStep: maxStep / first, maxSlope, mono, startFrac: (run[Math.max(0, s - 1)].i - run[0].i) / L, endFrac: (run[Math.min(run.length - 1, e + 1)].i - run[0].i) / L, n: run.length };
}
