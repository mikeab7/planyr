#!/usr/bin/env node
/* NEW-1 (B2479568 amendment, 2026-10-29) — build the 50-states + DC boundary module `siteState` answers from.
 *
 * WHY: `siteRegion.siteState()` answered only eight states, three of them from BOXES (TX, CO, CA) and one (GA) with a box that
 * reached into SC / AL / TN — so a Shreveport site read "TX" and was offered the Texas Railroad Commission rows, and every state
 * the app has no region for answered null. The owner: "you need to check every state". This module is the real state boundary
 * for every US point, from Natural Earth 1:10m admin-1 (public domain, NE v5.1).
 *
 * HOW IT STAYS SMALL (this ships in the Site route's bundle, because `siteState` must be synchronous — the Colorado guard has to hold
 * with nothing loaded): each ring is cut into RUNS and every run is simplified with a tolerance that fits what it is for —
 *   · COAST runs (both ends on a ne_10m_coastline vertex): 0.04° — a site that falls out of the polygon on a bay is caught by the
 *     seaward pad in `siteRegion.js`, so coastal detail buys nothing;
 *   · BORDERS touching one of the nine states a rule keys off (TX CO GA CA FL TN MS NJ NY — MS since its due-diligence layers, B2539744: its river edge once ran 3-5 km into LA/AR): 0.003° (~300 m) — the line that decides
 *     whether Shreveport is Texas;
 *   · BORDERS between two other states: 0.03° — no rule keys off them, an answer that is 3 km off on OH/KY changes nothing.
 * ONE EDGE IS NOT NATURAL EARTH'S (NEW-1, B2539744): NE puts the Mississippi–Louisiana line ~1 km on the wrong side at Vidalia (its river is the
 * pre-channel-shift one — Vidalia's own centre reads "MS", and its river edge sits up to 3.8 km off elsewhere). The MS|LA and MS|AR run is therefore
 * spliced from Esri's USA_States_Generalized_Boundaries (Census-derived), keeping NE's end points; both ring sides get the SAME polyline, so no
 * sliver. Checked against 21 river-town landmarks (test/stateLineLandmarks.test.js) where NE fails Vidalia. Source cached as
 * scripts/data/esri_ms.geojson (re-fetched by --fetch).
 * Classification is a property of an EDGE, not of a state, and a run is simplified end-to-end, so the two states that share a border
 * simplify it IDENTICALLY (no sliver between them). Alaska / Hawaii are coarse (0.3°).
 *
 *   node scripts/build-us-states.mjs            # reads scripts/data (gitignored)
 *   node scripts/build-us-states.mjs --fetch    # re-download the sources first
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "data");
const OUT = join(ROOT, "src", "workspaces", "site-planner", "lib", "usStatesData.js");
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const FILES = ["ne_10m_admin_1_states_provinces.geojson", "ne_10m_coastline.geojson"];
const ESRI_MS = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_States_Generalized_Boundaries/FeatureServer/0/query?where=STATE_ABBR%3D%27MS%27&outFields=STATE_ABBR&f=geojson&returnGeometry=true";
const SCALE = 1000; // 0.001° ≈ 110 m
const T_COAST = 0.04, T_FINE = 0.003, T_COARSE = 0.03, T_FAR = 0.3;
const PRECISE = new Set(["TX", "CO", "GA", "CA", "FL", "TN", "MS", "NJ", "NY"]);
const FAR = new Set(["AK", "HI"]);

async function load(f) {
  const p = join(SRC, f);
  if (!existsSync(p) || process.argv.includes("--fetch")) {
    mkdirSync(SRC, { recursive: true });
    const r = await fetch(`${NE}/${f}`);
    if (!r.ok) throw new Error(`${f} → HTTP ${r.status}`);
    writeFileSync(p, await r.text());
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

const q = (p) => `${Math.round(p[0] * 10000)},${Math.round(p[1] * 10000)}`;
const lines = (g) => (g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []);
function perp(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [lo, hi] = st.pop(); let far = -1, best = tol;
    for (let i = lo + 1; i < hi; i++) { const d = perp(pts[i], pts[lo], pts[hi]); if (d > best) { best = d; far = i; } }
    if (far > 0) { keep[far] = 1; st.push([lo, far], [far, hi]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const [admin1, coast] = [await load(FILES[0]), await load(FILES[1])];
const coastPts = new Set();
for (const f of coast.features) for (const l of lines(f.geometry)) for (const p of l) coastPts.add(q(p));

const feats = admin1.features.filter((f) => f.properties.adm0_a3 === "USA");
const edgeKey = (a, b) => { const ka = q(a), kb = q(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };
const ringsOf = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0]);
/* edge → set of states that carry it */
function edgeStatesOf() {
  const m = new Map();
  for (const f of feats) for (const ring of ringsOf(f)) for (let i = 1; i < ring.length; i++) {
    const k = edgeKey(ring[i - 1], ring[i]);
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(f.properties.postal);
  }
  return m;
}

/* ── The Mississippi River edge (see the header): splice Esri's MS|LA and MS|AR run in place of Natural Earth's ───────────────────── */
async function spliceMississippiRiver() {
  const p = join(SRC, "esri_ms.geojson");
  if (!existsSync(p) || process.argv.includes("--fetch")) {
    const r = await fetch(ESRI_MS);
    if (!r.ok) throw new Error(`Esri MS → HTTP ${r.status}`);
    writeFileSync(p, await r.text());
  }
  const esriMs = JSON.parse(readFileSync(p, "utf8")).features[0];
  const esriRing = (esriMs.geometry.type === "Polygon" ? [esriMs.geometry.coordinates] : esriMs.geometry.coordinates)
    .map((c) => c[0]).sort((a, b) => b.length - a.length)[0].slice(0, -1);
  const states = edgeStatesOf();
  const featOf = (st) => feats.find((f) => f.properties.postal === st);
  const owners = (a, b) => states.get(edgeKey(a, b));
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const nearestIdx = (pts, pt) => pts.reduce((bi, c, i) => (dist2(c, pt) < dist2(pts[bi], pt) ? i : bi), 0);

  /* the MS ring's longest run of edges shared with LA or AR, as a vertex list A…B in the ring's own order */
  const msF = featOf("MS");
  const msRing = ringsOf(msF).sort((a, b) => b.length - a.length)[0];
  const open = msRing.slice(0, -1), n = open.length;
  const isRun = (i) => { const o = owners(open[i], open[(i + 1) % n]); return o.has("LA") || o.has("AR"); };
  let start = -1;
  for (let i = 0; i < n; i++) if (isRun(i) && !isRun((i - 1 + n) % n)) { let len = 0; while (isRun((i + len) % n) && len < n) len++; if (start < 0 || len > start.len) start = { i, len }; }
  if (!start || start.i === undefined) throw new Error("splice: no MS|LA|AR run found in Natural Earth");
  const run = []; for (let k = 0; k <= start.len; k++) run.push(open[(start.i + k) % n]);
  const A = run[0], B = run[run.length - 1];
  let T = null; // the MS|AR|LA tripoint: where the run's other-state changes
  for (let k = 0; k < run.length - 1 && !T; k++) { const o = owners(run[k], run[k + 1]); const o2 = k + 2 < run.length ? owners(run[k + 1], run[k + 2]) : null; if (o2 && o.has("AR") !== o2.has("AR")) T = run[k + 1]; }
  if (!T) throw new Error("splice: the MS run does not change from AR to LA");

  /* Esri's arc between the vertices nearest A and B: of the two arcs round its ring, the one lying nearer the NE run */
  const m = esriRing.length, ia = nearestIdx(esriRing, A), ib = nearestIdx(esriRing, B);
  const arc = (from, to, step) => { const out = [esriRing[from]]; for (let i = from; i !== to; ) { i = (i + step + m) % m; out.push(esriRing[i]); } return out; };
  const meanNear = (pts) => run.reduce((acc, r) => acc + Math.sqrt(Math.min(...pts.map((e) => dist2(e, r)))), 0) / run.length;
  const fwd = arc(ia, ib, +1), bwd = arc(ia, ib, -1);
  const river = meanNear(fwd) <= meanNear(bwd) ? fwd : bwd;
  const poly = [A, ...river.slice(1, -1), B];
  const kLng = Math.cos((A[1] * Math.PI) / 180);
  const segKm = (pt, u, v) => {
    const ax = (u[0] - pt[0]) * kLng, ay = u[1] - pt[1], bx = (v[0] - pt[0]) * kLng, by = v[1] - pt[1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy) * 111;
  };
  const dev = Math.max(...run.map((r) => Math.min(...poly.slice(1).map((e, i) => segKm(r, poly[i], e)))));
  console.log(`splice: MS run ${run.length} NE pts → ${poly.length} Esri pts; max NE vertex offset from the new line ${dev.toFixed(1)} km`);
  const it = nearestIdx(poly, T);
  const p1 = poly.slice(0, it + 1); p1[0] = A; p1[p1.length - 1] = T; // A … T
  const p2 = poly.slice(it); p2[0] = T;                                 // T … B
  const isAfromAR = owners(run[0], run[1]).has("AR"); // is the run's first leg (A … T) the Arkansas one?
  const ar = isAfromAR ? [A, T, p1] : [T, B, p2], la = isAfromAR ? [T, B, p2] : [A, T, p1];

  /* write the run back into a ring: replace the consecutive edges between vertex keys `ka` … `kb` (either order) with `newPts` (ordered ka→kb) */
  function replaceRun(ring, ka, kb, newPts) {
    const o = ring.slice(0, -1), L = o.length;
    const ia2 = o.findIndex((p) => q(p) === ka), ib2 = o.findIndex((p) => q(p) === kb);
    if (ia2 < 0 || ib2 < 0) throw new Error(`splice: run end points not on the ring (${ka} ${ia2} / ${kb} ${ib2})`);
    const edgeShared = (i) => owners(o[i], o[(i + 1) % L]).has("MS");
    const walk = (from, to) => { let i = from, ok = true; while (i !== to) { if (!edgeShared(i)) { ok = false; break; } i = (i + 1) % L; } return ok; };
    let from = ia2, to = ib2, pts = newPts;
    if (!walk(from, to)) { from = ib2; to = ia2; pts = [...newPts].reverse(); if (!walk(from, to)) throw new Error("splice: no shared run between the end points"); }
    const outRing = [];
    for (let i = to; i !== from; i = (i + 1) % L) outRing.push(o[i]); // the untouched part, to … from
    outRing.push(o[from]);
    outRing.push(...pts.slice(1, -1)); // the new interior, from → to
    outRing.push(outRing[0]); // close at `to`
    return outRing;
  }
  const swap = (st, ka, kb, pts) => {
    const f = featOf(st);
    const rs = ringsOf(f);
    const idx = rs.reduce((bi, r, i) => (r.length > rs[bi].length ? i : bi), 0);
    const nr = replaceRun(rs[idx], ka, kb, pts);
    if (f.geometry.type === "Polygon") f.geometry.coordinates[0] = nr; else f.geometry.coordinates[idx][0] = nr;
  };
  // MS ring (its own order): the whole run A…B
  swap("MS", q(A), q(B), poly);
  swap("AR", q(ar[0]), q(ar[1]), ar[2]);
  swap("LA", q(la[0]), q(la[1]), la[2]);
}
await spliceMississippiRiver();
const edgeStates = edgeStatesOf();

function tolFor(st, a, b, span) {
  if (FAR.has(st)) return Math.min(T_FAR, Math.max(0.004, span / 25)); // scaled to the island, or Oahu collapses to a sliver
  if (coastPts.has(q(a)) && coastPts.has(q(b))) return T_COAST;
  const owners = edgeStates.get(edgeKey(a, b));
  for (const s of owners) if (PRECISE.has(s)) return T_FINE;
  return T_COARSE;
}

const b36 = (n) => n.toString(36);
let inPts = 0, outPts = 0;
const parts = [];
for (const f of feats.sort((x, y) => x.properties.postal.localeCompare(y.properties.postal))) {
  const st = f.properties.postal;
  const encRings = [];
  for (const ring of ringsOf(f)) {
    inPts += ring.length;
    // cut the ring into runs of one tolerance
    const rx = ring.map((p) => p[0]), ry = ring.map((p) => p[1]);
    const ringSpan = Math.max(Math.max(...rx) - Math.min(...rx), Math.max(...ry) - Math.min(...ry));
    const segTol = []; for (let i = 1; i < ring.length; i++) segTol.push(tolFor(st, ring[i - 1], ring[i], ringSpan));
    const runs = []; let cur = [ring[0]], curT = segTol[0];
    for (let i = 1; i < ring.length; i++) {
      if (segTol[i - 1] !== curT) { runs.push([cur, curT]); cur = [ring[i - 1]]; curT = segTol[i - 1]; }
      cur.push(ring[i]);
    }
    runs.push([cur, curT]);
    let pts = [];
    for (const [r, t] of runs) { const s = simplify(r, t); pts = pts.length ? pts.concat(s.slice(1)) : s; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (pts.length < 4 || span < (st === "AK" ? 0.3 : st === "HI" ? 0.1 : 0.03)) continue; // islets no site sits on
    outPts += pts.length;
    const ints = pts.map((p) => [Math.round(p[0] * SCALE), Math.round(p[1] * SCALE)]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    let px = 0, py = 0; const out = [];
    for (const [x, y] of ints) { out.push(b36(x - px), b36(y - py)); px = x; py = y; }
    encRings.push(out.join(","));
  }
  if (encRings.length) parts.push(`${st}:${encRings.join("|")}`);
}
const data = parts.join(";");
const js = `/* GENERATED by scripts/build-us-states.mjs — do not hand-edit. NEW-1 (B2479568 amendment): the 50 states + DC as polygons, for
 * \`siteRegion.siteState\`. Natural Earth 1:10m admin-1 (public domain, NE v5.1), simplified per run (see the script's header).
 * Format: "ST:ring|ring;ST:…" where a ring is base-36 deltas "dx,dy,dx,dy…" of [lng, lat] × ${SCALE}, the first pair absolute. */
export const US_STATES_SCALE = ${SCALE};
export const US_STATES_ENCODED = ${JSON.stringify(data)};
`;
writeFileSync(OUT, js);
console.log(`${feats.length} features · ${inPts} → ${outPts} points · ${(js.length / 1024).toFixed(1)} KB`);
