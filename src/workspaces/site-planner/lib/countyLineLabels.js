/* COUNTY NAMES ALONG THE LINE, ON EACH SIDE (B2507065 / NEW-10, owner constraint #47). Pure — no Leaflet, no DOM; the caller supplies the projection.
 *
 * A county name printed at the middle of a county tells you nothing at a boundary. Here each county's name is set just INSIDE that county, alongside its longest
 * visible stretch of boundary, turned to run parallel to the line and kept upright — so where two counties meet, each one's name sits on its own side of the line
 * ("DeSoto Co." / "Shelby Co., TN"). Labels that would collide are dropped (bigger counties win), so they never pile up.
 *
 * `countyLabelText` is the owner's wording: "<Name> Co.", with ", <ST>" added only for a county in a DIFFERENT state than the one the view is centred in. */

/* "DeSoto" + "TN" (home "MS") → "DeSoto Co., TN"; same state → "DeSoto Co.". A name that already ends in "County" / "Parish" / "Co." is normalised. */
export function countyLabelText(name, stateAbbr, homeState) {
  let n = String(name == null ? "" : name).trim().replace(/\s+(county|co\.?)$/i, "");
  if (!n) return "";
  n = n.replace(/\b([A-Z])([A-Z]+)\b/g, (_m, a, b) => a + b.toLowerCase()); // "HARRIS" → "Harris" (publishers shout)
  if (String(stateAbbr).toUpperCase() === "OK") n = n.replace(/\bMc([a-z])(?=[a-z]{2})/g, (_m, c) => "Mc" + c.toUpperCase()); // "MCCLAIN" → "McClain" — Oklahoma only: every other state's output is exactly as before
  const suffix = stateAbbr && homeState && String(stateAbbr).toUpperCase() !== String(homeState).toUpperCase() ? `, ${String(stateAbbr).toUpperCase()}` : "";
  return `${n} Co.${suffix}`;
}

const rings = (g) => {
  if (!g) return [];
  if (g.type === "Polygon") return g.coordinates || [];
  if (g.type === "MultiPolygon") return (g.coordinates || []).flat();
  return [];
};
const inPoly = (ring, x, y) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};

/* Liang–Barsky: the part of segment a→b inside [x0,x1]×[y0,y1], or null. */
function clipSeg(a, b, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  if (t1 <= t0) return null;
  return { ax: a.x + t0 * dx, ay: a.y + t0 * dy, bx: a.x + t1 * dx, by: a.y + t1 * dy };
}

/* The point `frac` (0..1) of the way along a chain of clipped segments, and the direction there. */
function pointAlong(pieces, len, frac) {
  const want = len * frac;
  let acc = 0;
  for (const p of pieces) {
    const L = Math.hypot(p.bx - p.ax, p.by - p.ay);
    if (acc + L >= want || p === pieces[pieces.length - 1]) {
      const t = L ? Math.max(0, Math.min(1, (want - acc) / L)) : 0;
      return { mx: p.ax + t * (p.bx - p.ax), my: p.ay + t * (p.by - p.ay), dx: (p.bx - p.ax) / (L || 1), dy: (p.by - p.ay) / (L || 1) };
    }
    acc += L;
  }
  return { mx: 0, my: 0, dx: 1, dy: 0 };
}

/* The best run of boundary for one feature: consecutive segments clipped to the view (plus `margin`) and chained while the line stays nearly straight (≤ 18° turn).
 * The longest chain wins. Returns { mx, my, dx, dy, len } (the point half-way along the visible chain and the direction there) or null. */
function bestRun(featureRings, project, viewW, viewH, margin) {
  let best = null;
  const x0 = -margin, y0 = -margin, x1 = viewW + margin, y1 = viewH + margin;
  const finish = (pieces, len) => {
    if (!pieces.length || (best && len <= best.len)) return;
    best = { len, pieces: pieces.slice(), ...pointAlong(pieces, len, 0.5) };
  };
  for (const ring of featureRings) {
    const pts = [];
    for (const [lng, lat] of ring) { const p = project(lng, lat); pts.push(p && isFinite(p.x) && isFinite(p.y) ? p : null); }
    let pieces = [], len = 0, ang = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const c = a && b ? clipSeg(a, b, x0, y0, x1, y1) : null;
      if (!c) { finish(pieces, len); pieces = []; len = 0; ang = null; continue; }
      const a2 = Math.atan2(c.by - c.ay, c.bx - c.ax);
      if (ang != null) { let d = Math.abs(a2 - ang); if (d > Math.PI) d = 2 * Math.PI - d; if (d > (18 * Math.PI) / 180) { finish(pieces, len); pieces = []; len = 0; } }
      pieces.push(c); len += Math.hypot(c.bx - c.ax, c.by - c.ay); ang = a2;
    }
    finish(pieces, len);
  }
  return best;
}

/* The labels for a FeatureCollection of counties in the current view:
 *   features        GeoJSON features (Polygon / MultiPolygon, lng/lat)
 *   textOf(feature) → the label text ("" to skip)
 *   project(lng,lat)→ {x,y} container pixels
 *   unproject(x,y)  → {lat,lng} (optional — the PDF only needs pixels)
 * Returns [{ text, lat, lng, angle, x, y }] — angle in degrees, upright (−90…90). */
export function countyLineLabels(features, { textOf, project, unproject, viewW, viewH, offsetPx = 13, minRunPx = 70, charW: charWIn, boxH: boxHIn, fontPx = 11, gap = 6 } = {}) {
  /* NEW-1 (owner 2026-11-05: "the county line is identifiable only by a clipped 'Fort Bend Co…' label"): the name's WHOLE (rotated) box must lie inside the view — it slides along
   * the visible line until it does, and a line with no such stretch carries no name (the county then names itself near the bottom of the view instead — vectorOverlay). */
  const charW = charWIn || fontPx * 0.6, boxH = boxHIn || fontPx + 4;
  const cands = [];
  for (const f of features || []) {
    const text = textOf ? textOf(f) : "";
    if (!text) continue;
    const rs = rings(f && f.geometry);
    if (!rs.length) continue;
    const textW = Math.max(30, text.length * charW);
    const run = bestRun(rs, project, viewW, viewH, 0);
    if (!run || run.len < Math.max(minRunPx, textW * 0.8)) continue;
    const pxRings = rs.map((r) => r.map(([lng, lat]) => project(lng, lat)).filter(Boolean));
    const inside = (x, y) => pxRings.reduce((c, ring) => (ring.length > 2 && inPoly(ring, x, y) ? !c : c), false);
    // slide the name along the visible line until its WHOLE (rotated) box is inside the view — a name beside a line at the edge is never cut off; none fits → no name on the line
    let pick = null;
    for (const frac of [0.5, 0.38, 0.62, 0.26, 0.74, 0.14, 0.86]) {
      const at = pointAlong(run.pieces, run.len, frac);
      const nx = -at.dy, ny = at.dx;
      const sgn = inside(at.mx + nx * 6, at.my + ny * 6) ? 1 : inside(at.mx - nx * 6, at.my - ny * 6) ? -1 : 0;
      if (!sgn) continue; // the run is not on this county's own edge (degenerate) — say nothing rather than guess
      const x = at.mx + sgn * nx * offsetPx, y = at.my + sgn * ny * offsetPx;
      let angle = (Math.atan2(at.dy, at.dx) * 180) / Math.PI;
      if (angle > 90) angle -= 180; else if (angle < -90) angle += 180;
      const r = (angle * Math.PI) / 180, co = Math.abs(Math.cos(r)), si = Math.abs(Math.sin(r));
      const hw = (textW * co + boxH * si) / 2 + 2, hh = (textW * si + boxH * co) / 2 + 2;
      if (x - hw < 0 || x + hw > viewW || y - hh < 0 || y + hh > viewH) continue;
      pick = { x, y, angle };
      break;
    }
    if (!pick) continue;
    const ll = unproject ? unproject(pick.x, pick.y) : { lat: null, lng: null };
    if (!ll) continue;
    cands.push({ text, lat: ll.lat, lng: ll.lng, angle: pick.angle, x: pick.x, y: pick.y, w: textW, h: boxH, len: run.len });
  }
  // longest runs first; drop anything whose (rotated) box would overlap one already placed
  cands.sort((a, b) => b.len - a.len);
  const box = (c) => { const r = (c.angle * Math.PI) / 180, co = Math.abs(Math.cos(r)), si = Math.abs(Math.sin(r)); return { w: c.w * co + c.h * si, h: c.w * si + c.h * co }; };
  const placed = [];
  for (const c of cands) {
    const bc = box(c);
    if (placed.some((p) => { const bp = box(p); return Math.abs(p.x - c.x) < (bp.w + bc.w) / 2 + gap && Math.abs(p.y - c.y) < (bp.h + bc.h) / 2 + gap; })) continue;
    placed.push(c);
  }
  return placed.map(({ text, lat, lng, angle, x, y }) => ({ text, lat, lng, angle, x, y }));
}
