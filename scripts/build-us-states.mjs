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
 *   · BORDERS touching one of the eight states a rule keys off (TX CO GA CA FL TN NJ NY): 0.003° (~300 m) — the line that decides
 *     whether Shreveport is Texas;
 *   · BORDERS between two other states: 0.03° — no rule keys off them, an answer that is 3 km off on OH/KY changes nothing.
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
const SCALE = 1000; // 0.001° ≈ 110 m
const T_COAST = 0.04, T_FINE = 0.003, T_COARSE = 0.03, T_FAR = 0.3;
const PRECISE = new Set(["TX", "CO", "GA", "CA", "FL", "TN", "NJ", "NY"]);
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
/* edge → set of states that carry it */
const edgeStates = new Map();
const ringsOf = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0]);
for (const f of feats) for (const ring of ringsOf(f)) for (let i = 1; i < ring.length; i++) {
  const k = edgeKey(ring[i - 1], ring[i]);
  if (!edgeStates.has(k)) edgeStates.set(k, new Set());
  edgeStates.get(k).add(f.properties.postal);
}

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
