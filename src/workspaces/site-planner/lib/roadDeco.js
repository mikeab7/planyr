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
const BEHIND_FT = 400;   // a per-tangent stripe cut runs from its tangent point right on past the junction (the stripe has no business beyond its own return)
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
 *  `side` is only the SIDE road's own stripe cuts — one half-width bar per return, each ending exactly at ITS tangent point — what its face-of-curb stripes honour (a through
 *  road's FAR curb stripe runs on across the mouth). */
export function junctionMouthCuts({ teeJunctions = [], driveJunctions = [], byId }) {
  const cuts = new Map(), side = new Map();
  const add = (id, ring) => {
    if (!byId.has(id)) return;
    if (!cuts.has(id)) cuts.set(id, []);
    cuts.get(id).push(ring);
  };
  const addSide = (id, ring) => { if (!byId.has(id)) return; if (!side.has(id)) side.set(id, []); side.get(id).push(ring); };
  /* NEW-1 (B1783376 ×3) — where each of the side road's two face-of-curb stripes ends: AT ITS OWN return's tangent point, not at the farther of the two. The single
   * full-width cut above (still right for the band fills) ends BOTH stripes at the farther tangent, which on an oblique junction leaves the near side's straight
   * stripe stopping up to a return-radius short of its own tangent — a gap the near return's arc stripe cannot bridge. One half-width bar per tangent, from that tangent's
   * along-position on past the junction, on the side of the road the tangent is on. (A tangent may lie BEHIND the junction point — an acute,
   * oblique approach: the near return meets the edge on the pad side of it — which is why the bar runs on rather than stopping at the junction.) */
  const addTangentCuts = (id, P, u, tangents, reach) => {
    const n = { x: -u.y, y: u.x };
    for (const tan of tangents) {
      const rel = { x: tan.x - P.x, y: tan.y - P.y }, a = dot(rel, u), lat = dot(rel, n) >= 0 ? reach : -reach;
      const c = (al, la) => ({ x: P.x + u.x * al + n.x * la, y: P.y + u.y * al + n.y * la });
      addSide(id, [c(-BEHIND_FT, 0), c(a, 0), c(a, lat), c(-BEHIND_FT, lat)]);
    }
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
      add(tj.sideId, bar({ x: tj.T.x - g.sideU.x * 2, y: tj.T.y - g.sideU.y * 2 }, g.sideU, cut + 2, (g.halfS || 0) + MARGIN_FT));
      addTangentCuts(tj.sideId, tj.T, g.sideU, (g.gaps || []).filter((gap) => gap.a === 2 || gap.b === 2).map((gap) => (gap.a === 2 ? gap.tanA : gap.tanB)), (g.halfS || 0) + MARGIN_FT);
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
    add(dj.sideId, bar({ x: dj.junctionPt.x - dj.sideU.x * 2, y: dj.junctionPt.y - dj.sideU.y * 2 }, dj.sideU, cut + 2, (dj.halfS || 0) + MARGIN_FT));
    addTangentCuts(dj.sideId, dj.junctionPt, dj.sideU, (dj.geom && dj.geom.sideTangents) || [], (dj.halfS || 0) + MARGIN_FT);
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
  let cur = [], allOk = true;
  const push = (p, ok) => {
    if (ok) cur.push(p);
    else { allOk = false; if (cur.length >= 2) runs.push(cur); cur = []; }
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const p = k === 0 ? a : k === n ? b : { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      push(p, distToRings(p, rings) <= lim);
    }
  }
  /* A stripe that stays near the outline the whole way comes back AS IT WAS (same vertices), not resampled: the vertices are what the caller joined to the
   * straight stripe either side, and resampling would only add points along chords. */
  if (allOk) return [line];
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/** The runs of an open polyline that lie OUTSIDE every one of `rings`, cut at the EXACT crossing points (float arithmetic — no clipper grid, so the cut point is
 *  on the ring's edge to ~1e-12 ft and the cut never tilts a short chord). A run keeps the polyline's own vertices between its cuts. Pure: world feet in / out. */
export function trimPolylineOutsideRings(line, rings) {
  if (!Array.isArray(line) || line.length < 2) return [];
  const cut = (rings || []).filter((r) => Array.isArray(r) && r.length >= 3);
  if (!cut.length) return [line];
  const inside = (p) => cut.some((r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i].y > p.y) !== (r[j].y > p.y) && p.x < ((r[j].x - r[i].x) * (p.y - r[i].y)) / (r[j].y - r[i].y) + r[i].x) c = !c; } return c; });
  const runs = [];
  let cur = null;
  const add = (p) => { if (!cur) cur = [p]; else { const q = cur[cur.length - 1]; if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) cur.push(p); } };
  const end = () => { if (cur && cur.length >= 2) runs.push(cur); cur = null; };
  for (let s = 0; s + 1 < line.length; s++) {
    const p = line[s], q = line[s + 1], dx = q.x - p.x, dy = q.y - p.y;
    const ts = [0, 1];
    for (const r of cut) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], ex = b.x - a.x, ey = b.y - a.y, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den, u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      if (inside({ x: p.x + dx * tm, y: p.y + dy * tm })) { end(); continue; }
      if (t0 === 0) add({ x: p.x, y: p.y }); else add({ x: p.x + dx * t0, y: p.y + dy * t0 });
      add(t1 === 1 ? { x: q.x, y: q.y } : { x: p.x + dx * t1, y: p.y + dy * t1 });
    }
  }
  end();
  return runs;
}

/** Bring one END of a stripe piece onto the exact point `pt` — the tangent point of a curb return — by trimming what overshoots it or lengthening what stops short
 *  of it, ALONG the piece's own last segment. `atStart` says which end. Returns a new polyline, or null when `pt` is not on that end's line (within `collTol` ft
 *  across) or the piece would have to be lengthened more than `maxExtend` ft: a stripe that does not run straight into the tangent is left exactly as it is. */
export function snapPieceEnd(piece, atStart, pt, collTol = 0.15, maxExtend = 8) {
  if (!Array.isArray(piece) || piece.length < 2) return null;
  const pts = (atStart ? piece.slice().reverse() : piece.slice()).map((p) => ({ x: p.x, y: p.y }));
  while (pts.length >= 2) {
    const a = pts[pts.length - 2], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) { pts.pop(); continue; }
    const L = Math.sqrt(L2), t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / L2, across = Math.abs((pt.x - a.x) * dy - (pt.y - a.y) * dx) / L;
    if (across > collTol) return null;
    if (t < 0) { pts.pop(); continue; }                     // `pt` is behind this segment — the piece overshoots it by more than one segment
    if (t > 1 && (t - 1) * L > maxExtend) return null;
    pts[pts.length - 1] = { x: pt.x, y: pt.y };
    if (pts.length < 2 || Math.hypot(pts[pts.length - 1].x - pts[pts.length - 2].x, pts[pts.length - 1].y - pts[pts.length - 2].y) < 1e-9) return null;
    return atStart ? pts.reverse() : pts;
  }
  return null;
}


/** Split the dissolved pavement's OUTLINE (`edge`: open polylines, a closed ring has its first point repeated) by the road that OWNS each piece, so a road's curbs can be
 *  stroked in that road's own style: a segment belongs to the road whose STRIP ring it lies on (within `tol` ft), and a curb-return arc — which lies on no strip —
 *  to the road whose junction wedge it bounds (the nearest). `ownerRings` is `Map<roadId, { strip: ring|null, extra: ring[] }>`. Returns `Map<roadId, polyline[]>`;
 *  consecutive segments of one owner stay ONE polyline (so a one-owner outline comes back as the same lines, and a closed ring is not cut open at its start). */
export function splitEdgeByOwner(edge, ownerRings, tol = 0.25) {
  const out = new Map();
  if (!Array.isArray(edge) || !ownerRings || !ownerRings.size) return out;
  const ids = [...ownerRings.keys()];
  const ownerOf = (m) => {
    let sid = null, sd = Infinity, aid = ids[0], ad = Infinity;
    for (const id of ids) {
      const o = ownerRings.get(id), ds = o.strip ? distToRings(m, [o.strip]) : Infinity;
      if (ds < sd) { sd = ds; sid = id; }
      const da = Math.min(ds, o.extra && o.extra.length ? distToRings(m, o.extra) : Infinity);
      if (da < ad) { ad = da; aid = id; }
    }
    return sd <= tol ? sid : aid;
  };
  const push = (id, run) => { if (run.length >= 2) { if (!out.has(id)) out.set(id, []); out.get(id).push(run); } };
  for (const line of edge) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const closed = line.length > 3 && Math.hypot(line[0].x - line[line.length - 1].x, line[0].y - line[line.length - 1].y) < 1e-9;
    const runs = [];   // { id, pts }
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], id = ownerOf({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), last = runs[runs.length - 1];
      if (last && last.id === id) last.pts.push(b); else runs.push({ id, pts: [a, b] });
    }
    if (closed && runs.length > 1 && runs[0].id === runs[runs.length - 1].id) { const tail = runs.pop(); runs[0].pts = [...tail.pts, ...runs[0].pts.slice(1)]; }
    for (const r of runs) push(r.id, r.pts);
  }
  return out;
}
