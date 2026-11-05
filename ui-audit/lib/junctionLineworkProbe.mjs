/* junctionLineworkProbe — the junction-LINEWORK properties (B1783376 ×3 follow-on to junctionDecoProbe), as pure functions over `window.__plannerRoadNet()`
 * and a screenshot. Shared by e2e/road-junction-linework.spec.js (seeded, local) and ui-audit/verify-junction-linework-live.mjs (the deployed app, signed in),
 * so the two cannot disagree about what "one continuous curb line" means.
 *
 *   1. `stripesPerRoad`   — a drive's face-of-curb is ONE polyline per side (straight run + arc, joined), not a stripe + a separately offset arc stripe.
 *   2. `joinTurns`        — at the tangent the heading is continuous: the turn at the vertex where the straight run becomes the arc is under a degree.
 *   3. `maxTurn`          — and no vertex anywhere on a stripe turns more than one tessellation step (no jog, no kink).
 *   4. `padFaceCheck`     — the arc's pad end lies ON the pad face (within 0.1 ft) and no point of any stripe is inside the pad (the tick).
 *   5. `mouthDarkness`    — rendered pixels: along the pad face between the two curb-return tangents there is no run darker than BOTH the drive's fill and the pad's
 *                           fill, nor lighter than both (a stroked line across the mouth — dark ink on a light theme, light ink on a dark one). A blend of the two fills
 *                           is not a line; `excess` is how far outside the two fills' luminance range the face reads.
 * Pure: world feet / decoded-PNG in, numbers out. */
import { segDist, distToRings, inRing } from "./junctionDecoProbe.mjs";

export const turnDeg = (p, q, r) => {
  let d = (Math.atan2(r.y - q.y, r.x - q.x) - Math.atan2(q.y - p.y, q.x - p.x)) * 180 / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d);
};
export const stripeLinesOf = (net, id) => ((net.stripes || []).find((s) => s.id === id) || { lines: [] }).lines;

/** property 1 */
export const stripesPerRoad = (net, id) => stripeLinesOf(net, id).length;

/** property 2 — for each of a drive's returns, the turn at the stripe vertex a curb-width off its side tangent (the vertex where the straight run becomes the arc).
 *  `turn: null` = no such interior vertex exists (the straight stripe and the arc are separate polylines, or the join is not a vertex at all). */
export function joinTurns(net, drive, cw = 0.5) {
  const lines = stripeLinesOf(net, drive.sideId);
  return drive.sideTangents.map((st, k) => {
    for (const l of lines) for (let i = 1; i < l.length - 1; i++) {
      if (Math.abs(Math.hypot(l[i].x - st.x, l[i].y - st.y) - cw) < 1e-3) return { k, turn: turnDeg(l[i - 1], l[i], l[i + 1]) };
    }
    return { k, turn: null };
  });
}

/** property 3 */
export function maxTurn(net, id) {
  let worst = 0;
  for (const l of stripeLinesOf(net, id)) for (let i = 1; i < l.length - 1; i++) worst = Math.max(worst, turnDeg(l[i - 1], l[i], l[i + 1]));
  return worst;
}

/** property 4 — `ends` are the distances from the pad ring of every stripe end lying within 3 ft of it (a drive has two: one per return); `deepest` is how far the
 *  most-inside stripe point (sampled every 0.25 ft) sits inside the pad. */
export function padFaceCheck(net, drive) {
  const pad = (net.pads || []).find((p) => p.targetId === drive.targetId);
  if (!pad) return { ends: [], deepest: Infinity, noPad: true };
  const lines = stripeLinesOf(net, drive.sideId), ring = pad.ring, ends = [];
  let deepest = 0;
  for (const l of lines) {
    for (const e of [l[0], l[l.length - 1]]) { const d = distToRings(e, [ring]); if (d <= 3) ends.push(d); }
    for (let i = 0; i + 1 < l.length; i++) {
      const a = l[i], b = l[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25));
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
        if (inRing(p, ring)) deepest = Math.max(deepest, distToRings(p, [ring]));
      }
    }
  }
  return { ends, deepest };
}

const lum = (img, x, y) => {
  const xx = Math.max(0, Math.min(img.width - 1, Math.round(x))), yy = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const i = (yy * img.width + xx) * img.channels;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
};
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** property 5 — `img` is the decoded screenshot of the planner canvas, `view` is `__plannerView.get()` ({ppf, offX, offY}), `dpr` the device scale. The face runs between the
 *  drive's two through tangents; the profile is read ACROSS it (along the face normal, toward the drive on one side and the pad on the other) at columns spread over
 *  the middle 70% of the mouth. Returns the MEDIAN over columns of (the darkest / the lightest luminance within ±2 device px of the face), against the darker / lighter of
 *  the two fills' luminances, so a stall divider or a label on a few columns cannot move it: `dark` ≤ 0 means darker than both fills, `light` ≥ 0 lighter than both,
 *  and `excess` = max(−dark, light, 0) is the one number to bound. A stroked line reads ≈ 9–10 at 8 px/ft on a 2× display (it is 0.75 px wide whatever the zoom); a clean blend of the two fills reads 0. */
export function mouthDarkness(img, view, dpr, drive) {
  const [A, B] = drive.throughTangents;
  const L = Math.hypot(B.x - A.x, B.y - A.y), u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
  const side = drive.sideTangents[0];
  let n = { x: -u.y, y: u.x };                                                    // toward the DRIVE: the side whose tangent is on it
  if ((side.x - A.x) * n.x + (side.y - A.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  const px = (p) => ({ x: (p.x * view.ppf + view.offX) * dpr, y: (p.y * view.ppf + view.offY) * dpr });
  const mins = [], maxs = [], roads = [], pads = [];
  const cols = 41;
  for (let c = 0; c < cols; c++) {
    const t = 0.15 + (0.7 * c) / (cols - 1), P = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }, s = px(P);
    const nd = { x: n.x, y: n.y };                                                // unit in screen axes too (the mapping is a uniform scale)
    let m = Infinity, mx = -Infinity;
    for (let k = -2; k <= 2; k += 0.5) { const v = lum(img, s.x + nd.x * k, s.y + nd.y * k); m = Math.min(m, v); mx = Math.max(mx, v); }
    mins.push(m); maxs.push(mx);
    roads.push(lum(img, s.x + nd.x * 9, s.y + nd.y * 9));
    pads.push(lum(img, s.x - nd.x * 9, s.y - nd.y * 9));
  }
  const lRoad = median(roads), lPad = median(pads), lMin = median(mins), lMax = median(maxs);
  const dark = lMin - Math.min(lRoad, lPad), light = lMax - Math.max(lRoad, lPad);
  return { lRoad, lPad, lMin, lMax, dark, light, excess: Math.max(-dark, light, 0), mins: mins.map((v) => Math.round(v)) };
}

/** distance from `p` to a polyline's nearest segment */
export const distToLine = (p, l) => Math.min(...l.slice(1).map((b, i) => segDist(p, l[i], b)));
