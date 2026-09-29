#!/usr/bin/env node
/* NEW-1 (2026-09-29) — build the CLOSE-ZOOM state-line asset: US state borders at the
 * detail the map needs between zoom 8 and 12.
 *
 * WHY A SECOND ASSET. `public/geo/admin-boundaries.json` is Natural Earth 1:110m, simplified
 * for zoom <= 7 (one pixel there is >1 km). At zoom 12 one pixel is ~30 m, so that asset would
 * draw a state line that visibly wanders off the river/road the true border follows. This
 * asset is Natural Earth 1:10m admin-1 (public domain), US states only, and is fetched ONLY
 * when the map is at zoom >= ADMIN1_DETAIL_MIN_ZOOM — a user at site scale downloads neither.
 *
 * TWO THINGS DONE HERE THAT A NAIVE CONVERSION WOULD GET WRONG:
 *  1. COAST EDGES ARE DROPPED. A state polygon's outline runs along the coast too, and at zoom
 *     10-12 a 1:10m coastline sits hundreds of metres off the real shore (Galveston Bay would
 *     get a "state line" through the water). Any segment whose both ends coincide with a
 *     vertex of ne_10m_coastline is a coast edge, not a border, and is not emitted. Real
 *     borders (state/state, US/Canada, US/Mexico) are kept.
 *  2. SHARED BORDERS ARE DRAWN ONCE. Two states each carry their common border; drawing both
 *     stacks two translucent lines (a visibly darker line) and, after independent
 *     simplification, could double it. Each undirected edge is emitted once.
 * Output uses the same delta encoding as admin-boundaries.json (scale 10000 = ~11 m), so the
 * one decoder in adminBoundaryData.js reads both.
 *
 *   node scripts/build-admin-detail.mjs            # from vendored scripts/data (gitignored)
 *   node scripts/build-admin-detail.mjs --fetch    # re-download the sources first
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "data");
const OUT = join(ROOT, "public", "geo", "admin1-detail.json");
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const FILES = ["ne_10m_admin_1_states_provinces.geojson", "ne_10m_coastline.geojson"];
const SCALE = 10000;
const TOL = 0.00008; // ~9 m: below a pixel at zoom 12 (~30 m/px)

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

const q = (p) => `${Math.round(p[0] * SCALE)},${Math.round(p[1] * SCALE)}`;
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
const encode = (ring) => {
  const r = ring.map((p) => [Math.round(p[0] * SCALE), Math.round(p[1] * SCALE)]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (r.length < 2) return null;
  const out = [r[0][0], r[0][1]];
  for (let i = 1; i < r.length; i++) out.push(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
  return out;
};

const [admin1, coast] = [await load(FILES[0]), await load(FILES[1])];
const coastPts = new Set();
for (const f of coast.features) for (const l of lines(f.geometry)) for (const p of l) coastPts.add(q(p));

const seen = new Set();
const runs = [];
let segTotal = 0, segCoast = 0, segShared = 0;
for (const f of admin1.features) {
  if (f.properties.adm0_a3 !== "USA") continue;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly.slice(0, 1)) {
    let cur = [];
    const flush = () => { if (cur.length > 1) runs.push(cur); cur = []; };
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      segTotal++;
      const ka = q(a), kb = q(b);
      const edge = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (coastPts.has(ka) && coastPts.has(kb)) { segCoast++; flush(); continue; }
      if (seen.has(edge)) { segShared++; flush(); continue; }
      seen.add(edge);
      if (!cur.length) cur.push(a);
      cur.push(b);
    }
    flush();
  }
}
let inPts = 0, outPts = 0;
const enc = [];
for (const r of runs) { inPts += r.length; const s = simplify(r, TOL); outPts += s.length; const e = encode(s); if (e) enc.push(e); }
const doc = { format: "planyr-admin-boundaries-v1", source: "Natural Earth 1:10m admin-1 (US), coast edges removed via ne_10m_coastline; public domain; NE v5.1", scale: SCALE, levels: { admin1: enc } };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(doc));
console.log(`segments ${segTotal}: ${segCoast} coast dropped, ${segShared} shared-duplicate dropped`);
console.log(`${enc.length} runs · ${inPts} → ${outPts} points · ${(readFileSync(OUT).length / 1024).toFixed(1)} KB`);
