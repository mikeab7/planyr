/* Boundary SECTIONS — the few, named stretches a parcel outline is edited in (NEW-1).
 *
 * The Setbacks UI shows the outline as a handful of MAIN SECTIONS instead of one row per edge
 * (dozens on a digitised curve) or an ordinance role vocabulary. A section is a contiguous run
 * of edges; it breaks where the boundary turns sharply, where what it borders changes, where the
 * stored per-edge value changes, or where the owner says so ("Split or join sections").
 *
 * ── invariants ───────────────────────────────────────────────────────────────────────────────
 *  · The canonical store stays the PER-EDGE `setbacks` array. Nothing here computes a different
 *    value for an edge: a section is uniform (`value`) or `mixed`, and `setSectionSetback` writes
 *    only that section's own edges. Reading sections never changes the ring the yield engine
 *    offsets.
 *  · Sections TILE the closed ring exactly once (no gap, no overlap) and wrap vertex 0 correctly.
 *  · No front/side/rear/street-side role vocabulary anywhere in this module.
 *
 * ── frame ────────────────────────────────────────────────────────────────────────────────────
 * Planar feet, open ring, edge i = points[i] → points[(i+1)%n]; vertex i sits between edge i-1
 * and edge i. The planner's feet frame is SCREEN-DOWN (`featureToParcel` flips y "so north
 * points up on screen"), so NORTH IS −y and EAST IS +x. Compass bearing: 0 = N, clockwise.
 * Winding is never assumed (signed area), so "outward" is right for CW and CCW rings alike.
 *
 * ── thresholds (all exported so tests and tuning share one number) ───────────────────────────
 *  CORNER_TURN_DEG = 35      A vertex turning this much or more is a real corner. Below ~25° a
 *                            surveyed side only jogs; above ~45° nobody calls it a bend. 35 sits
 *                            between and matches the chips' own 50° break with margin for the
 *                            coarser, section-level grouping.
 *  LONG_EDGE_CORNER_DEG = 22 Between two LONG edges (each ≥ LONG_EDGE_FT) a smaller turn is
 *                            still a corner: a 12-sided outline with 100 ft edges turning 30°
 *                            at each vertex is twelve sides, not a curve. Jogs under this
 *                            (the ~12° wobble between two long straight edges) never break.
 *  CURVE: a chain of ≥3 consecutive edges whose vertex turns are all the same sign, each
 *         ≥ 0.5° and ≤ CURVE_MAX_TURN_DEG (60), and whose edges are SHORT — each ≤ 34% of the
 *         chain's length AND ≤ CURVE_EDGE_MAX_FT (60 ft). A longer edge splits the chain there
 *         (a straight tangent beside an arc is trimmed off, so it is not swallowed). Vertices
 *         inside a curve never break by the corner rule, so a 60-segment cul-de-sac stays ONE
 *         section even when coarse digitising puts 40°+ at a vertex. The 60 ft cap is the
 *         dodecagon decision: long edges turning that much are corners, short ones are an arc.
 *  MIN_SECTION_FT = 15       A section shorter than max(this, 3% of the perimeter) merges into
 *  MIN_SECTION_PERIM_FRAC    its longer neighbour when the break between them is automatic and
 *                            both share value+border. The relative floor is what folds the small
 *                            notches/jogs of a big surveyed parcel (the real Weld lot has a 148 ft
 *                            notch on an 8,400 ft outline) into their sides, while a compact lot
 *                            whose every side is short keeps all of them (3% of a 1,200 ft cross
 *                            is 36 ft, under its 100 ft sides).
 */

import { STREET_ABUT_FT } from "./setbackRoles.js";

export const CORNER_TURN_DEG = 35;
export const LONG_EDGE_CORNER_DEG = 22;
export const LONG_EDGE_FT = 60;
export const CURVE_MAX_TURN_DEG = 60;
export const CURVE_MIN_TURN_DEG = 0.5;
export const CURVE_MAX_EDGE_FRAC = 0.34;
export const CURVE_EDGE_MAX_FT = 60;
export const MIN_SECTION_FT = 15;
export const MIN_SECTION_PERIM_FRAC = 0.03;
export const NEIGHBOUR_COINCIDENT_FT = 3;
const ABUT_FRACTION = 0.5;
const NEIGHBOUR_FRACTION = 0.6;
const STRIDE_FT = 25;

const hyp = Math.hypot;
const SIDES = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/* Compass bearing of a vector in the screen-down frame (north = −y). */
const compass = (dx, dy) => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
const sideOf = (dx, dy) => SIDES[Math.round(compass(dx, dy) / 45) % 8];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* Canonical sorted, de-duplicated integer list. */
const canon = (list) => [...new Set((Array.isArray(list) ? list : []).filter((v) => Number.isInteger(v) && v >= 0))].sort((a, b) => a - b);

/* Distance from p to the nearest point of any polyline; returns {point, dist}. Mirrors the
 * helper in setbackRoles.js (which does not export it). */
function nearestOnLines(p, lines) {
  let best = null, bd = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = hyp(p.x - q.x, p.y - q.y);
      if (d < bd) { bd = d; best = q; }
    }
  }
  return { point: best, dist: bd };
}

const normaliseLines = (list) =>
  (Array.isArray(list) ? list : [])
    .map((s) => (Array.isArray(s) ? { name: null, pts: s } : { name: s && s.name ? s.name : null, pts: (s && s.pts) || [] }))
    .filter((s) => s.pts.length >= 2);

/* Length-weighted fraction of `edges` that FACES one polyline (within tol, on the outward side —
 * the same two-part test as setbackRoles.abutFraction), plus the mean distance of those samples
 * (to rank "nearest wins"). Exported as the small shared helper. */
export function abutStats(points, edges, line, tolFt = STREET_ABUT_FT) {
  const n = points.length;
  const ccw = signedArea(points) > 0;
  let near = 0, total = 0, dsum = 0;
  for (const e of edges) {
    const a = points[e], b = points[(e + 1) % n];
    const l = hyp(b.x - a.x, b.y - a.y);
    if (!(l > 0)) continue;
    total += l;
    const nrm = ccw ? { x: (b.y - a.y) / l, y: -(b.x - a.x) / l } : { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    const steps = Math.max(3, Math.min(20, Math.ceil(l / STRIDE_FT)));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const { point, dist } = nearestOnLines(m, [line]);
      if (!point || dist > tolFt) continue;
      const vx = point.x - m.x, vy = point.y - m.y, vl = hyp(vx, vy);
      if (vl === 0 || (vx / vl) * nrm.x + (vy / vl) * nrm.y >= 0.5) { near += l / steps; dsum += (dist * l) / steps; }
    }
  }
  return { fraction: total > 0 ? near / total : 0, meanDist: near > 0 ? dsum / near : Infinity };
}

/* Fraction of `edges` lying on top of a neighbour ring's boundary (shared lot line). */
function coincidentFraction(points, edges, ring) {
  const n = points.length;
  const closed = [...ring, ring[0]];
  let near = 0, total = 0;
  for (const e of edges) {
    const a = points[e], b = points[(e + 1) % n];
    const l = hyp(b.x - a.x, b.y - a.y);
    if (!(l > 0)) continue;
    total += l;
    const steps = Math.max(3, Math.min(20, Math.ceil(l / STRIDE_FT)));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (nearestOnLines(m, [closed]).dist <= NEIGHBOUR_COINCIDENT_FT) near += l / steps;
    }
  }
  return total > 0 ? near / total : 0;
}

/* What a group of edges borders. Road beats water beats neighbour beats open; within a kind the
 * best-covered (then nearest) candidate wins. `key` is internal (change detection). */
function borderOf(points, edges, ctx) {
  const pick = (lines, kind) => {
    let best = null;
    lines.forEach((s, idx) => {
      const { fraction, meanDist } = abutStats(points, edges, s.pts);
      if (fraction < ABUT_FRACTION) return;
      if (!best || fraction > best.f + 1e-9 || (Math.abs(fraction - best.f) <= 1e-9 && meanDist < best.d)) {
        best = { f: fraction, d: meanDist, kind, name: s.name, id: null, key: `${kind}|${s.name ?? `#${idx}`}` };
      }
    });
    return best;
  };
  const road = pick(ctx.streets, "road");
  if (road) return road;
  const water = pick(ctx.waters, "water");
  if (water) return water;
  let nb = null;
  ctx.neighbours.forEach((p, idx) => {
    const f = coincidentFraction(points, edges, p.points);
    if (f >= NEIGHBOUR_FRACTION && (!nb || f > nb.f)) {
      nb = { f, d: 0, kind: "neighbour", name: p.name ?? null, id: p.id ?? null, key: `neighbour|${p.id ?? p.name ?? `#${idx}`}` };
    }
  });
  return nb || { f: 0, d: 0, kind: "open", name: null, id: null, key: "open" };
}

/* Resolve one candidate chain of consecutive edges into curve sub-chains: any edge that is too
 * long (absolute or relative) splits the chain there, the pieces recurse. `E` edge lengths,
 * `ids` the edge indices; returns arrays of edge indices that are curves. */
function resolveCurves(ids, lens, out) {
  if (ids.length < 3) return;
  const total = lens.reduce((s, v) => s + v, 0);
  let longAt = -1;
  for (let i = 0; i < lens.length; i++) {
    if (lens[i] > CURVE_EDGE_MAX_FT || lens[i] > CURVE_MAX_EDGE_FRAC * total) { longAt = i; break; }
  }
  if (longAt < 0) { out.push(ids); return; }
  resolveCurves(ids.slice(0, longAt), lens.slice(0, longAt), out);
  resolveCurves(ids.slice(longAt + 1), lens.slice(longAt + 1), out);
}

/* Geometry facts: per-edge length, per-vertex signed turn, curve chains and curve vertices. */
function geometry(points) {
  const n = points.length;
  const len = points.map((p, i) => { const q = points[(i + 1) % n]; return hyp(q.x - p.x, q.y - p.y); });
  const brg = points.map((p, i) => { const q = points[(i + 1) % n]; return (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI; });
  // turns[v]: vertex v between edge v-1 and edge v, in (-180,180]; 0 when an edge is degenerate.
  const turns = points.map((_, v) => {
    const pe = (v - 1 + n) % n;
    if (!(len[pe] > 0) || !(len[v] > 0)) return 0;
    let d = brg[v] - brg[pe];
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
  });
  const cand = turns.map((t) => Math.abs(t) >= CURVE_MIN_TURN_DEG && Math.abs(t) <= CURVE_MAX_TURN_DEG);
  const sgn = turns.map((t) => (t > 0 ? 1 : -1));
  // maximal cyclic runs of candidate vertices with one sign
  const startOK = (v) => cand[v] && !(cand[(v - 1 + n) % n] && sgn[(v - 1 + n) % n] === sgn[v]);
  const chains = [];
  let anyStart = false;
  for (let v = 0; v < n; v++) {
    if (!startOK(v)) continue;
    anyStart = true;
    const verts = [v];
    let w = (v + 1) % n;
    while (w !== v && cand[w] && sgn[w] === sgn[v]) { verts.push(w); w = (w + 1) % n; }
    chains.push(verts);
  }
  if (!anyStart && cand.every(Boolean) && sgn.every((s) => s === sgn[0])) chains.push(points.map((_, v) => v)); // full loop
  const curveGroups = [];
  for (const verts of chains) {
    const first = verts[0];
    const ids = [(first - 1 + n) % n];
    for (const v of verts) ids.push(v);          // edge v follows vertex v
    const uniq = [...new Set(ids)];
    resolveCurves(uniq, uniq.map((e) => len[e]), curveGroups);
  }
  const curveVertex = new Array(n).fill(false);
  for (const g of curveGroups) for (let i = 1; i < g.length; i++) curveVertex[g[i]] = true; // vertex g[i] = start of edge g[i]
  return { n, len, turns, curveGroups, curveVertex };
}

function isCorner(v, g) {
  if (g.curveVertex[v]) return false;
  const t = Math.abs(g.turns[v]);
  if (t >= CORNER_TURN_DEG) return true;
  const pe = (v - 1 + g.n) % g.n;
  return t >= LONG_EDGE_CORNER_DEG && g.len[pe] >= LONG_EDGE_FT && g.len[v] >= LONG_EDGE_FT;
}

/* Section tiling: edges from break b[k] up to (not including) b[k+1], cyclic. */
function edgesBetween(a, b, n) {
  const out = [];
  let e = a;
  do { out.push(e); e = (e + 1) % n; } while (e !== b && out.length < n);
  return out;
}

function analyse(points, opts) {
  const n = points.length;
  const g = geometry(points);
  const ctx = {
    streets: normaliseLines(opts.streets),
    waters: normaliseLines(opts.waters),
    neighbours: (Array.isArray(opts.neighbours) ? opts.neighbours : []).filter((p) => p && Array.isArray(p.points) && p.points.length >= 3),
  };
  const dflt = Number.isFinite(opts.defaultSetback) ? opts.defaultSetback : 0;
  const sb = Array.isArray(opts.setbacks) ? opts.setbacks : null;
  const val = points.map((_, i) => (sb && Number.isFinite(sb[i]) ? sb[i] : dflt));
  // border per edge; a curve is judged as ONE group so digitising noise cannot flicker it
  const border = new Array(n);
  const grouped = new Array(n).fill(false);
  for (const grp of g.curveGroups) {
    const b = borderOf(points, grp, ctx);
    for (const e of grp) { border[e] = b; grouped[e] = true; }
  }
  for (let e = 0; e < n; e++) if (!grouped[e]) border[e] = borderOf(points, [e], ctx);
  return { n, g, val, border };
}

function breakVertices(points, opts, A) {
  const { n, g, val, border } = A;
  const forced = new Set(canon(opts.breaks).filter((v) => v < n));
  const joined = new Set(canon(opts.joins).filter((v) => v < n));
  const isBrk = new Array(n).fill(false);
  for (let v = 0; v < n; v++) {
    if (forced.has(v)) { isBrk[v] = true; continue; }
    if (joined.has(v)) continue;
    const pe = (v - 1 + n) % n;
    isBrk[v] = isCorner(v, g) || val[pe] !== val[v] || border[pe].key !== border[v].key;
  }
  return { isBrk, forced };
}

const sum = (arr, f) => arr.reduce((s, e) => s + f(e), 0);

function buildSections(points, opts) {
  const n = points.length;
  if (n < 3) return [];
  const A = analyse(points, opts);
  const { isBrk, forced } = breakVertices(points, opts, A);
  const { g, val, border } = A;
  let brk = [];
  for (let v = 0; v < n; v++) if (isBrk[v]) brk.push(v);
  if (!brk.length) brk = [0];

  const edgesOf = (k, list) => edgesBetween(list[k], list[(k + 1) % list.length], n);
  const stats = (edges) => {
    const uniform = edges.every((e) => val[e] === val[edges[0]]);
    const byKey = new Map();
    for (const e of edges) byKey.set(border[e].key, (byKey.get(border[e].key) || 0) + g.len[e]);
    let key = null, best = -1;
    for (const [k, l] of byKey) if (l > best) { best = l; key = k; }
    return { len: sum(edges, (e) => g.len[e]), uniform, v: val[edges[0]], key };
  };

  // merge tiny sections into the longer compatible neighbour (never across a user break)
  const floorFt = Math.max(MIN_SECTION_FT, MIN_SECTION_PERIM_FRAC * sum(g.len, (l) => l));
  for (;;) {
    if (brk.length < 2) break;
    const secs = brk.map((_, k) => ({ k, ...stats(edgesOf(k, brk)) }));
    const tiny = secs.filter((s) => s.len < floorFt).sort((a, b) => a.len - b.len);
    let merged = false;
    for (const t of tiny) {
      const m = brk.length;
      const prev = secs[(t.k - 1 + m) % m], next = secs[(t.k + 1) % m];
      const ok = (nb, sepVertex) =>
        nb.k !== t.k && !forced.has(sepVertex) && nb.uniform && t.uniform && nb.v === t.v && nb.key === t.key;
      const cands = [];
      if (ok(prev, brk[t.k])) cands.push({ nb: prev, drop: brk[t.k] });
      if (ok(next, brk[(t.k + 1) % m])) cands.push({ nb: next, drop: brk[(t.k + 1) % m] });
      if (!cands.length) continue;
      cands.sort((a, b) => b.nb.len - a.nb.len);
      brk = brk.filter((v) => v !== cands[0].drop);
      merged = true;
      break;
    }
    if (!merged) break;
  }

  const ccw = signedArea(points) > 0;
  const curveEdge = new Set();
  const curveOf = new Map();
  g.curveGroups.forEach((grp, gi) => grp.forEach((e) => { curveEdge.add(e); curveOf.set(e, gi); }));

  const sections = brk.map((start, k) => {
    const end = brk[(k + 1) % brk.length];
    const edges = edgesOf(k, brk);
    let nx = 0, ny = 0, lengthFt = 0;
    for (const e of edges) {
      const a = points[e], b = points[(e + 1) % n];
      const l = g.len[e];
      lengthFt += l;
      if (l > 0) {
        const dx = b.x - a.x, dy = b.y - a.y;
        // outward normal for either winding
        nx += (ccw ? dy : -dy); ny += (ccw ? -dx : dx);
      }
    }
    const first = points[start], last = points[end];
    let cx = last.x - first.x, cy = last.y - first.y;
    if (hyp(cx, cy) < 1e-9) { const b = points[(edges[0] + 1) % n]; cx = b.x - first.x; cy = b.y - first.y; }
    const st = stats(edges);
    const perGroup = new Map();
    for (const e of edges) if (curveOf.has(e)) perGroup.set(curveOf.get(e), (perGroup.get(curveOf.get(e)) || 0) + 1);
    const curved = [...perGroup.values()].some((c) => c >= 2);
    const dom = border[edges.find((e) => border[e].key === st.key)];
    return {
      key: `s${start}`,
      index: k,
      startVertex: start,
      endVertex: end,
      edges,
      lengthFt,
      bearingDeg: compass(cx, cy),
      side: sideOf(nx, ny),
      border: { kind: dom.kind, name: dom.name, id: dom.id },
      curved,
      value: st.uniform ? st.v : null,
      mixed: !st.uniform,
      label: "",
    };
  });
  sections.forEach((s) => { s.label = baseLabel(s); });
  // never two identical rows: number repeats in ring order
  const total = new Map(), seen = new Map();
  sections.forEach((s) => total.set(s.label, (total.get(s.label) || 0) + 1));
  sections.forEach((s) => {
    if (total.get(s.label) > 1) {
      const c = (seen.get(s.label) || 0) + 1;
      seen.set(s.label, c);
      s.label = `${s.label} (${c})`;
    }
  });
  return sections;
}

function baseLabel(s) {
  const dir = cap(s.side);
  const b = s.border || { kind: "open" };
  if (b.kind === "road") return b.name ? `Along ${b.name}` : "Along the road";
  if (b.kind === "water") return b.name ? `Along ${b.name}` : "Along the water";
  if (b.kind === "neighbour") return `${dir} line · next to ${b.name || "neighbour"}`;
  return `${dir} line`;
}

export function sectionLabel(section) {
  return section ? section.label || baseLabel(section) : "";
}

export function boundarySections(points, opts = {}) {
  if (!Array.isArray(points) || points.length < 3) return [];
  return buildSections(points, opts || {});
}

export function sectionOfEdge(sections, edgeIndex) {
  return (sections || []).find((s) => s.edges.includes(edgeIndex)) || null;
}

/* New per-edge array with ONLY this section's edges set to n (clamped ≥ 0); other edges keep
 * their value, and a short array is padded with 0 (an unset edge is the caller's default). */
export function setSectionSetback(setbacks, section, n, edgeCount) {
  const out = [];
  const count = Math.max(edgeCount || 0, Array.isArray(setbacks) ? setbacks.length : 0);
  for (let i = 0; i < count; i++) out.push(Array.isArray(setbacks) && Number.isFinite(setbacks[i]) ? setbacks[i] : 0);
  if (!section || !Number.isFinite(n)) return out;
  const v = Math.max(0, n);
  for (const e of section.edges) if (e >= 0 && e < out.length) out[e] = v;
  return out;
}

/* "Split here" / "Join here" on one vertex. `opts` is the same bag boundarySections takes PLUS
 * `points` (needed to know whether the vertex is currently an automatic break). Returns the new
 * sparse, canonical { breaks, joins }: a vertex is never in both. */
export function toggleBreak(opts, vertex) {
  const o = opts || {};
  const breaks = canon(o.breaks), joins = canon(o.joins);
  const isBreakWith = (B, J) => {
    if (!Array.isArray(o.points)) return B.includes(vertex);
    return boundarySections(o.points, { ...o, breaks: B, joins: J }).some((s) => s.startVertex === vertex);
  };
  const without = (l) => l.filter((v) => v !== vertex);
  if (isBreakWith(breaks, joins)) {
    const B = without(breaks), J = without(joins);
    return isBreakWith(B, J) ? { breaks: B, joins: canon([...J, vertex]) } : { breaks: B, joins: J };
  }
  const J = without(joins);
  return isBreakWith(breaks, J) ? { breaks, joins: J } : { breaks: canon([...breaks, vertex]), joins: J };
}

/* Keep stored vertex indices right when the boundary is edited (mirrors
 * shiftOverridesOnInsert/Delete). INSERT takes the EDGE index that was split — the new vertex
 * lands at edgeIndex+1, so every stored vertex ≥ that shifts up one; the new corner is not a
 * break. DELETE takes the removed vertex: it is dropped, later vertices shift down one. */
export function shiftBreaksOnInsert(list, edgeIndex) {
  if (!Array.isArray(list)) return list;
  return canon(list.map((v) => (v >= edgeIndex + 1 ? v + 1 : v)));
}

export function shiftBreaksOnDelete(list, vertexIndex) {
  if (!Array.isArray(list)) return list;
  return canon(list.filter((v) => v !== vertexIndex).map((v) => (v > vertexIndex ? v - 1 : v)));
}

export function sectionsSummary(sections) {
  const s = sections || [];
  return { count: s.length, curvedCount: s.filter((x) => x.curved).length };
}
