#!/usr/bin/env node
/* NEW-1 (state lines, B2550272 third review, 2026-10-30) — build the two polygons `siteRegion.TUNED_REACHES` overrules Natural Earth with.
 *
 * WHY: Natural Earth 1:10m is good to about a kilometre, and two river/barrier-island stretches of the Alabama line are measurably worse.
 * The first cut of those reaches used a hand-drawn Florida / Georgia OUTLINE inside a box + band, and the third review measured what that
 * costs: Georgia's west edge was three straight vertices (1.0–2.9 km west of the real river between 31.95°N and 32.95°N, so Phenix City / Valley
 * AL read GA), and the coarse Florida outline's west edge ran straight from (-87.6, 31.0) to (-87.5, 30.15), so Ono Island, Bear Point and the
 * Perdido Bay north shore — all Alabama — read Florida (1,241 Alabama land points on a 0.001° grid).
 * So a reach is now a POLYGON of the tuned state's own LAND, taken from the county boundaries (a county line along a river IS the state line):
 *   · chattahoochee — the Georgia counties along the river (Seminole … Troup) cut to the stretch box: a point NE calls Alabama that lies in
 *     Georgia county land is Georgia; Alabama land stays Alabama (Phenix City, Valley, Eufaula…);
 *   · perdido-key   — Escambia County FL's land in the Perdido window, grown 0.0005° (~55 m: the beach edge), less Baldwin
 *     County AL's land — so only the western end of Perdido Key (which NE hands to Alabama) is pulled back to Florida, and Ono Island is not.
 * Source: Esri Living Atlas "USA Census Counties" (FeatureServer layer name dtl_cnty, Census-derived detailed county polygons), probed 2026-10-30.
 * Cached as scripts/data/reach_*.json (gitignored; re-fetched by --fetch). Output: src/workspaces/site-planner/lib/stateReachData.js — GENERATED,
 * never hand-edit; the reach definitions (boxes, reasons, landmarks) stay in siteRegion.js and the numbers are policed by
 * test/stateLineReaches.test.js.
 *
 *   node scripts/build-state-reaches.mjs            # reads scripts/data
 *   node scripts/build-state-reaches.mjs --fetch    # re-download the sources first
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ClipperLib from "clipper-lib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "data");
const OUT = join(ROOT, "src", "workspaces", "site-planner", "lib", "stateReachData.js");
const BASE = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Counties/FeatureServer/0/query";
const K = 1e7;

/* [box S,W,N,E (the same as the reach's), where, simplify tolerance °] */
const SOURCES = {
  "reach_ga.json": { env: [-85.4, 30.9, -84.8, 33.05], where: "STATE_ABBR='GA'" },
  "reach_fl.json": { env: [-87.6, 30.2, -87.3, 30.4], where: "FIPS='12033'" },
  "reach_al.json": { env: [-87.6, 30.2, -87.3, 30.4], where: "FIPS='01003'" },
};
const CHATTAHOOCHEE = { box: [31.0, -85.3, 32.95, -84.85], tol: 0.0008 };
const PERDIDO = { box: [30.2, -87.53, 30.36, -87.40], grow: 0.0005, tol: 0.0002 };

async function fetchAll() {
  mkdirSync(SRC, { recursive: true });
  for (const [f, s] of Object.entries(SOURCES)) {
    const q = new URLSearchParams({
      where: s.where, outFields: "NAME,STATE_ABBR,FIPS", geometry: s.env.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326",
      maxAllowableOffset: "0.00002", f: "geojson",
    });
    const r = await fetch(`${BASE}?${q}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`${f} → HTTP ${r.status}`);
    writeFileSync(join(SRC, f), await r.text());
    console.log("fetched", f);
  }
}

const rings = (geom) => (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates);
function loadPolys(f) {
  const j = JSON.parse(readFileSync(join(SRC, f), "utf8"));
  if (!j.features?.length) throw new Error(`${f}: no features`);
  const out = [];
  for (const ft of j.features) for (const poly of rings(ft.geometry)) out.push(poly);
  return out;
}
const toPaths = (polys) => polys.flatMap((p) => p.map((r) => r.map(([x, y]) => ({ X: Math.round(x * K), Y: Math.round(y * K) }))));
function run(type, subj, clip, fill = ClipperLib.PolyFillType.pftNonZero) {
  const c = new ClipperLib.Clipper(); c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true); c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const sol = new ClipperLib.Paths(); c.Execute(type, sol, fill, fill); return sol;
}
const unionAll = (paths) => run(ClipperLib.ClipType.ctUnion, paths, [], ClipperLib.PolyFillType.pftEvenOdd);
const boxPath = ([s, w, n, e]) => [[{ X: Math.round(w * K), Y: Math.round(s * K) }, { X: Math.round(e * K), Y: Math.round(s * K) }, { X: Math.round(e * K), Y: Math.round(n * K) }, { X: Math.round(w * K), Y: Math.round(n * K) }]];
function grow(paths, deg) {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * K * 0.0001); co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const sol = new ClipperLib.Paths(); co.Execute(sol, deg * K); return sol;
}
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]]; let dmax = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = len2 ? Math.max(0, Math.min(1, ((pts[i][0] - a[0]) * dx + (pts[i][1] - a[1]) * dy) / len2)) : 0;
    const d = Math.hypot(pts[i][0] - (a[0] + t * dx), pts[i][1] - (a[1] + t * dy));
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [a, b];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
}
function ringOut(path, tol) {
  let pts = path.map((p) => [p.X / K, p.Y / K]);
  /* split the closed ring at its two extreme vertices so Douglas–Peucker has a stable base */
  let i0 = 0, i1 = 0; pts.forEach((p, i) => { if (p[0] < pts[i0][0]) i0 = i; if (p[0] > pts[i1][0]) i1 = i; });
  pts = [...pts.slice(i0), ...pts.slice(0, i0)]; const mid = (i1 - i0 + pts.length) % pts.length;
  const a = dp(pts.slice(0, mid + 1), tol), b = dp([...pts.slice(mid), pts[0]], tol);
  const r = [...a.slice(0, -1), ...b.slice(0, -1)].map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
  return r.filter((p, i) => i === 0 || p[0] !== r[i - 1][0] || p[1] !== r[i - 1][1]);
}
const area = (r) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2;

async function main() {
  if (process.argv.includes("--fetch") || !existsSync(join(SRC, "reach_ga.json"))) await fetchAll();

  const ga = unionAll(toPaths(loadPolys("reach_ga.json")));
  const gaReach = run(ClipperLib.ClipType.ctIntersection, ga, boxPath(CHATTAHOOCHEE.box));

  const fl = unionAll(toPaths(loadPolys("reach_fl.json"))), al = unionAll(toPaths(loadPolys("reach_al.json")));
  const flGrown = run(ClipperLib.ClipType.ctIntersection, grow(fl, PERDIDO.grow), boxPath(PERDIDO.box));
  const pdKey = run(ClipperLib.ClipType.ctDifference, flGrown, al);

  const res = { chattahoochee: gaReach, "perdido-key": pdKey };
  const tol = { chattahoochee: CHATTAHOOCHEE.tol, "perdido-key": PERDIDO.tol };
  let body = "";
  for (const [id, paths] of Object.entries(res)) {
    const rs = paths.map((p) => ringOut(p, tol[id])).filter((r) => r.length >= 3 && Math.abs(area(r)) > 1e-7);
    if (!rs.length) throw new Error(`${id}: empty reach`);
    body += `  ${JSON.stringify(id)}: ${JSON.stringify(rs)},\n`;
    console.log(id, "rings", rs.length, "vertices", rs.reduce((n, r) => n + r.length, 0));
  }
  writeFileSync(OUT, `/* GENERATED by scripts/build-state-reaches.mjs — never hand-edit. The polygons \`siteRegion.TUNED_REACHES\` overrule Natural Earth with: county LAND of
 * the tuned state (a county line along a river is the state line), from Esri's USA Census Counties (detailed), probed 2026-10-30. Each value is a list of
 * rings of [lng, lat]; a point in ANY ring is "in the reach". See the script's header for how each was cut. */
export const REACH_RINGS = {
${body}};
`);
  console.log("wrote", OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
