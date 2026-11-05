/* junctionDecoProbe — the three junction-paint properties (NEW-1, B1783376 ×2), as pure functions over `window.__plannerRoadNet()` and the plan's roads.
 * Shared by e2e/road-junction-deco-seam.spec.js (seeded, local) and ui-audit/verify-junction-deco-live.mjs (the deployed app, signed in), so the two cannot
 * disagree about what "no line between the road body and its curve" means.
 *   1. `decoSeamViolations` — every edge of a road's decoration domain is ON the pavement's outline or LATERAL (across the road), never longitudinal.
 *   2. `interiorStripePoints` — every point of every face-of-curb stripe is within a curb-width of the outline.
 *   3. `arcsWithoutStripe` — a stripe follows each curb-return arc, a curb-width INSIDE the pavement. */
export const segDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};
export const ringsOf = (net) => net.regions.flatMap((r) => [r.outer, ...r.holes]);
export const distToRings = (p, rings) => Math.min(...rings.flatMap((r) => r.map((a, i) => segDist(p, a, r[(i + 1) % r.length]))));
export const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i].y > p.y) !== (r[j].y > p.y) && p.x < ((r[j].x - r[i].x) * (p.y - r[i].y)) / (r[j].y - r[i].y) + r[i].x) c = !c; } return c; };
export const inRegions = (p, net) => net.regions.some((rg) => inRing(p, rg.outer) && !rg.holes.some((h) => inRing(p, h)));
export const nearestSegDir = (p, pts) => {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) { const d = segDist(p, pts[i], pts[i + 1]); if (!best || d < best.d) best = { d, dir: { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y } }; }
  const L = Math.hypot(best.dir.x, best.dir.y) || 1; return { x: best.dir.x / L, y: best.dir.y / L };
};

/* property 1 */
export function decoSeamViolations(net, els, tol = 0.4) {
  const rings = ringsOf(net), out = [];
  for (const d of net.deco || []) {
    const rd = els.find((e) => e.id === d.id);
    for (const ring of d.rings) {
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (distToRings(a, rings) <= tol && distToRings(b, rings) <= tol && distToRings(mid, rings) <= tol) return;   // on the outline
        const e = { x: b.x - a.x, y: b.y - a.y }, L = Math.hypot(e.x, e.y);
        if (L < 1e-6) return;
        const u = nearestSegDir(mid, rd.pts);
        const along = Math.abs((e.x * u.x + e.y * u.y) / L);   // 1 = running ALONG the road
        if (along > 0.5) out.push({ road: d.id, from: a, to: b, along: +along.toFixed(2) });   // within 60° of the road's own direction = longitudinal
      });
    }
  }
  return out;
}
/* property 2 — a face-of-curb stripe is the pavement's edge, a curb-width inside it: EVERY point of it (sampled every foot) is within a curb-width of the
 * outline. A stripe running on through the interior beside a fillet (the straight stripe carried past where the return leaves the edge) fails this at
 * any point along it, not only at its ends. */
export function interiorStripePoints(net, cw = 0.5, tol = 0.75) {
  const rings = ringsOf(net), bad = [];
  for (const s of net.stripes || []) for (const l of s.lines) for (let i = 0; i + 1 < l.length; i++) {
    const a = l[i], b = l[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      if (distToRings(p, rings) > cw + tol) bad.push({ road: s.id, p: { x: +p.x.toFixed(1), y: +p.y.toFixed(1) } });
    }
  }
  return bad.slice(0, 5);
}
/* property 3: a stripe follows each return arc, a curb-width INSIDE the pavement */
export function arcsWithoutStripe(net, arcs, cw = 0.5) {
  const lines = (net.stripes || []).flatMap((s) => s.lines);
  const bad = [];
  arcs.forEach((arc, k) => {
    if (!arc) return;
    const interior = arc.slice(1, -1);
    const miss = interior.filter((p) => {
      const near = Math.min(...lines.flatMap((l) => l.slice(1).map((b, i) => segDist(p, l[i], b))));
      return !(Math.abs(near - cw) <= 0.25);
    });
    // the stripe point beside the arc must be on the pavement side: check by sampling the inward normal candidate
    const mid = interior[Math.floor(interior.length / 2)];
    const onPavement = lines.some((l) => l.some((q) => Math.abs(Math.hypot(q.x - mid.x, q.y - mid.y) - cw) < 0.3 && inRegions(q, net)));
    // a shrunk return beside a mild bend (the B2276177 fallback) legitimately loses a few points where its straight-edge model leaves the outline
    if (miss.length > interior.length * 0.35 || !onPavement) bad.push({ arc: k, missing: miss.length, of: interior.length, onPavement });
  });
  return bad;
}

