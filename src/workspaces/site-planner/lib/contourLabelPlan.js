/* contourLabelPlan — ROUND 10 (NEW-2, owner 2026-10-30 7:11 PM): at working zoom EVERY contour in view carries an elevation.
 *
 * The owner's 50-ft view of Concept A had not one label on any existing (dashed) contour and none on the five or six
 * proposed lines: the labels were the sparse every-fifth INDEX lines only (one per index piece at its middle for the proposed
 * set, one per ~500 lattice cells for the existing layer), so a view that happens to hold no index line's middle read as a map
 * with no elevations at all — "I can't see any topo information from this view".
 *
 * THE RULE (a picture rule, not a data rule): from `CONTOUR_LABEL_ALL.minPpf` (~the 100-ft scale bar) in, every line — index
 * and intermediate — is offered stations along its own length and carries at least one label, upright, set ON a straight-ish
 * stretch of the line, never on top of another label; a long run repeats the label about every `repeatPx` of screen run.
 * Farther out the callers keep their index-only labels. Pure and translation-free: positions are `feet × rppf`, so a pan never
 * moves an answer (VIEW-INDEPENDENT-ONCE) — `rect` (optional, feet) only trims which stations are offered, for a caller whose
 * lines run far past the view (the existing layer's whole tile cover).
 *
 * WHY A GREEDY SWEEP WITH STAGGERED STATIONS. Steep ground draws contours a few pixels apart, and a label is taller than that,
 * so "one label per line" cannot mean "at each line's middle". Each line therefore tries its stations in order of
 * straightness and then of nearness to a per-line staggered target, and takes the first that clears everything already
 * placed — neighbouring lines end up labelled at different places along their run, the way a printed topo sheet does it.
 * `opts.keepOut(x, y)` (px, the same space as `feet × rppf`) vetoes a station: the existing lines' planner is told to stay clear of the daylight
 * line, where the PROPOSED family's labels (planned apart, in the planner's SVG) run up against it. */
export const CONTOUR_LABEL_ALL = Object.freeze({ minPpf: 0.75, charW: 6.6, h: 12, pad: 3, pitchPx: 14, repeatPx: 300, straightDeg: 28, maxTurnDeg: 75, maxLabels: 3000, stagger: 30 });

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/* lines: [{ key, level, isIndex?, text?, pts: [{x,y}] }] in FEET. Returns [{ key, level, text, pt (feet), deg, s (arc px) }]. */
export function planAllContourLabels(lines, rppf, { rect = null, opts = null } = {}) {
  const O = { ...CONTOUR_LABEL_ALL, ...(opts || {}) };
  if (!lines || !lines.length || !(rppf >= O.minPpf)) return [];
  const R = rect ? { x0: rect.minX * rppf, y0: rect.minY * rppf, x1: rect.maxX * rppf, y1: rect.maxY * rppf } : null;
  const prepared = [];
  for (const ln of lines) {
    const pts = ln.pts;
    if (!pts || pts.length < 2) continue;
    const text = ln.text != null ? String(ln.text) : String(Math.round(ln.level));
    const w = text.length * O.charW + O.pad * 2, hh = O.h + O.pad * 2;
    const X = new Float64Array(pts.length), Y = new Float64Array(pts.length), S = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      X[i] = pts[i].x * rppf; Y[i] = pts[i].y * rppf;
      if (i) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
    }
    const total = S[pts.length - 1];
    if (total < w + 2) continue;
    if (R) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i++) { if (X[i] < x0) x0 = X[i]; if (X[i] > x1) x1 = X[i]; if (Y[i] < y0) y0 = Y[i]; if (Y[i] > y1) y1 = Y[i]; }
      if (x1 < R.x0 || x0 > R.x1 || y1 < R.y0 || y0 > R.y1) continue;
    }
    const at = (s) => {                                   // the point and the segment direction at arc length s
      let lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
      const seg = S[hi] - S[lo] || 1, t = Math.max(0, Math.min(1, (s - S[lo]) / seg));
      return { x: X[lo] + (X[hi] - X[lo]) * t, y: Y[lo] + (Y[hi] - Y[lo]) * t };
    };
    const h0 = hash(String(ln.key));
    const cands = [];
    const first = w / 2 + (h0 % Math.max(1, Math.round(O.pitchPx)));
    for (let s = first; s <= total - w / 2; s += O.pitchPx) {
      const a = at(s - w / 2), m = at(s), b = at(s + w / 2);
      if (R && (m.x < R.x0 || m.x > R.x1 || m.y < R.y0 || m.y > R.y1)) continue;
      if (O.keepOut && O.keepOut(m.x, m.y)) continue;
      const a1 = Math.atan2(m.y - a.y, m.x - a.x), a2 = Math.atan2(b.y - m.y, b.x - m.x);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
      const turn = (d * 180) / Math.PI;
      if (turn > O.maxTurnDeg) continue;
      let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
      cands.push({ s, x: m.x, y: m.y, deg, turn });
    }
    if (!cands.length) continue;
    prepared.push({ ln, text, w, hh, total, cands, h0 });
  }
  // deterministic order: index lines first (they pick the best spots), then by level and key
  prepared.sort((p, q) => ((q.ln.isIndex ? 1 : 0) - (p.ln.isIndex ? 1 : 0)) || (p.ln.level - q.ln.level) || (String(p.ln.key) < String(q.ln.key) ? -1 : 1));

  const CELL = 48, grid = new Map();
  const boxOf = (c, w, hh) => {
    const r = (c.deg * Math.PI) / 180, co = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
    const bw = w * co + hh * sn, bh = w * sn + hh * co;
    return [c.x - bw / 2, c.y - bh / 2, c.x + bw / 2, c.y + bh / 2];
  };
  const keysOf = (b) => { const ks = []; for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) ks.push(i + "," + j); return ks; };
  const clear = (b) => { for (const k of keysOf(b)) { const l = grid.get(k); if (l) for (const q of l) if (b[0] < q[2] && q[0] < b[2] && b[1] < q[3] && q[1] < b[3]) return false; } return true; };
  const put = (b) => { for (const k of keysOf(b)) { let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(b); } };
  const placed = [];
  const take = (p, c) => {
    const b = boxOf(c, p.w, p.hh);
    if (!clear(b)) return false;
    put(b);
    const lab = { key: p.ln.key, level: p.ln.level, text: p.text, pt: { x: c.x / rppf, y: c.y / rppf }, deg: Math.round(c.deg * 10) / 10, s: c.s };
    placed.push(lab); (p.mine || (p.mine = [])).push(c.s);
    return true;
  };
  // round 1 — every line gets its first label: straightest stations first, then nearest a per-line staggered target
  prepared.forEach((p, idx) => {
    const target = p.total / 2 + (((idx * 5) % 9) - 4) * O.stagger;
    // straight-ish stations first (turn buckets of 10°); a wiggling line that has none still gets its straightest stretch rather than none
    const order = p.cands.slice().sort((a, b) => ((a.turn > O.straightDeg) - (b.turn > O.straightDeg)) || (Math.floor(a.turn / 10) - Math.floor(b.turn / 10)) || (Math.abs(a.s - target) - Math.abs(b.s - target)));
    for (const c of order) { if (placed.length >= O.maxLabels) return; if (take(p, c)) break; }
  });
  // round 2 — a long run repeats about every `repeatPx`
  for (const p of prepared) {
    if (!p.mine) continue;
    for (const c of p.cands) {
      if (placed.length >= O.maxLabels) break;
      if (c.turn > O.straightDeg) continue;                // a repeat is only ever worth a straight stretch
      if (p.mine.some((s) => Math.abs(s - c.s) < O.repeatPx)) continue;
      take(p, c);
    }
  }
  return placed;
}

/* A feet-space path string ("M x y L x y …M …") → arrays of {x,y}, one per sub-path. */
export function pathToPieces(d) {
  if (!d) return [];
  const out = [];
  for (const seg of String(d).split("M")) {
    if (!seg) continue;
    const pts = [];
    for (const m of seg.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)) pts.push(+m[0]);
    const piece = [];
    for (let i = 0; i + 1 < pts.length; i += 2) piece.push({ x: pts[i], y: pts[i + 1] });
    if (piece.length >= 2) out.push(piece);
  }
  return out;
}
