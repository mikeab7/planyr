/* roadDeco — where a road's DECORATION (cross-section band fills, lane seams, texture) is allowed to paint, as a pure function of the junctions.
 *
 * NEW-1 (2026-10-15). The pavement is ONE dissolved shape per cluster, but each road's decoration used to be bounded by that road's OWN strip ring. At a
 * junction the strip's straight edge is exactly where the (untinted) curb-return wedge begins, so every tinted band stopped on a straight line running
 * along the pavement — a visible line between the road's body and the curve beside it (B1958144 had buried it under the fill; moving the deco above the
 * fill exposed it). The rule here: a road's decoration ENDS AT THE THROAT — a lateral cut across the road where the curb returns begin — and never runs
 * on along the strip past it. Side road: cut where its two returns leave its edges. Through road: cut across the throat span between the two tangent
 * points the side road's returns left on it (a median opens there). Whatever remains is `strip ∖ cuts ∖ pads`: its only edges are the pavement's own
 * outline, lateral end cuts, and the road's own end caps.
 *
 * Pure: world feet in / out. */
const MARGIN_FT = 4;     // lateral overshoot of a cut past the strip (the clipper difference only needs it to cover the strip's width)
const unit = (v) => { const L = Math.hypot(v.x, v.y) || 1; return { x: v.x / L, y: v.y / L }; };
const dot = (a, b) => a.x * b.x + a.y * b.y;

/** A rectangle: `from`→`from + u·len`, ±`half` either side of that axis. */
function bar(from, u, len, half) {
  const n = { x: -u.y, y: u.x };
  const c = (a, b) => ({ x: from.x + u.x * a + n.x * b, y: from.y + u.y * a + n.y * b });
  return [c(0, half), c(len, half), c(len, -half), c(0, -half)];
}

/** The regions each road's decoration must NOT paint, from the tee and drive junctions: `{ all, side }`, each a Map<roadId, ring[]>.
 *  `all` is every cut (side-road end cuts + the through road's full-width throat cut) — what band fills and texture honour.
 *  `side` is only the SIDE road's own end cut — what its face-of-curb stripes honour (a through road's FAR curb stripe runs on across the mouth). */
export function junctionMouthCuts({ teeJunctions = [], driveJunctions = [], byId }) {
  const cuts = new Map(), side = new Map();
  const add = (id, ring, isSide = false) => {
    if (!byId.has(id)) return;
    if (!cuts.has(id)) cuts.set(id, []);
    cuts.get(id).push(ring);
    if (isSide) { if (!side.has(id)) side.set(id, []); side.get(id).push(ring); }
  };
  for (const tj of teeJunctions) {
    const g = tj.geom || {};
    if (!byId.has(tj.sideId) || !byId.has(tj.throughId)) continue;
    // SIDE road: from just behind the node out to where the farther of its two returns leaves its edge
    if (g.sideU) {
      let cut = 0;
      for (const gap of g.gaps || []) {
        if (!(gap.a === 2 || gap.b === 2)) continue;
        const tan = gap.a === 2 ? gap.tanA : gap.tanB;
        cut = Math.max(cut, dot({ x: tan.x - tj.T.x, y: tan.y - tj.T.y }, g.sideU));
      }
      cut = Math.max(cut, g.halfG || 0);
      add(tj.sideId, bar({ x: tj.T.x - g.sideU.x * 2, y: tj.T.y - g.sideU.y * 2 }, g.sideU, cut + 2, (g.halfS || 0) + MARGIN_FT), true);
    }
    // THROUGH road: the whole width across the throat span
    const [t1, t2] = g.throughTangents || [];
    if (t1 && t2 && g.nTee) {
      const span = Math.hypot(t2.x - t1.x, t2.y - t1.y);
      if (span > 1e-6) {
        const u = unit({ x: t2.x - t1.x, y: t2.y - t1.y });
        const n = g.nTee;                                   // unit, toward the side road
        const depth = 2 * (g.halfG || 0) + 2 * MARGIN_FT;
        // axis along `-n` from the near edge's outside, `bar` lateral = along u: build explicitly
        const o = { x: t1.x + n.x * MARGIN_FT, y: t1.y + n.y * MARGIN_FT };
        add(tj.throughId, [o, { x: o.x + u.x * span, y: o.y + u.y * span }, { x: o.x + u.x * span - n.x * depth, y: o.y + u.y * span - n.y * depth }, { x: o.x - n.x * depth, y: o.y - n.y * depth }]);
      }
    }
  }
  for (const dj of driveJunctions) {
    if (!byId.has(dj.sideId) || !dj.sideU || !dj.junctionPt) continue;
    let cut = 0;
    for (const tan of (dj.geom && dj.geom.sideTangents) || []) cut = Math.max(cut, dot({ x: tan.x - dj.junctionPt.x, y: tan.y - dj.junctionPt.y }, dj.sideU));
    add(dj.sideId, bar({ x: dj.junctionPt.x - dj.sideU.x * 2, y: dj.junctionPt.y - dj.sideU.y * 2 }, dj.sideU, cut + 2, (dj.halfS || 0) + MARGIN_FT), true);
  }
  return { all: cuts, side };
}

/** The distance from `p` to the nearest edge of any of `rings`. */
export function distToRings(p, rings) {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
      if (d < best) best = d;
    }
  }
  return best;
}

/** A curb-return stripe belongs a curb-width inside the pavement's OUTLINE. Where it does not — a return that another junction's pavement overlaps leaves its arc in
 *  the interior of the merged surface, and the straight lengthening at each end (it overlaps the stripe the clip left) leaves a CURVING road's pavement altogether
 *  (measured on a real plan: 1.5–3.5 ft off the outline) — it is a line through the interior, the very thing this pass removes. Keep only the runs of `line` that
 *  stay within `cw + tol` of `rings`, sampled every `step` ft. Returns an array of polylines (possibly none). */
export function stripeRunsNearOutline(line, rings, cw, tol = 0.6, step = 0.5) {
  if (!Array.isArray(line) || line.length < 2 || !rings || !rings.length) return Array.isArray(line) && line.length >= 2 ? [line] : [];
  const lim = cw + tol, runs = [];
  let cur = [];
  const push = (p, ok) => {
    if (ok) cur.push(p);
    else { if (cur.length >= 2) runs.push(cur); cur = []; }
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const p = k === 0 ? a : k === n ? b : { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      push(p, distToRings(p, rings) <= lim);
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}
