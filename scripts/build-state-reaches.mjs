#!/usr/bin/env node
/* NEW-1 (state lines, B2550272 third review, 2026-10-30) — build the polygons `siteRegion.TUNED_REACHES` overrule Natural Earth with.
 *
 * WHY: Natural Earth 1:10m is good to about a kilometre, and two river/barrier-island stretches of the Alabama line are measurably worse.
 * The first cut of those reaches used a hand-drawn Florida / Georgia OUTLINE inside a box + band, and the third review measured what that
 * costs: Georgia's west edge was three straight vertices (1.0–2.9 km west of the real river between 31.95°N and 32.95°N, so Phenix City / Valley
 * AL read GA), and the coarse Florida outline's west edge ran straight from (-87.6, 31.0) to (-87.5, 30.15), so Ono Island, Bear Point and the
 * Perdido Bay north shore — all Alabama — read Florida (1,241 Alabama land points on a 0.001° grid).
 * So a reach is now a POLYGON of the tuned state's own LAND, taken from the county boundaries (a county line along a river IS the state line):
 *   · chattahoochee    (GA over AL) — Georgia river-county land ∩ the NE polygon of ALABAMA grown 0.003°: Georgia ground NE calls Alabama (Columbus, West Point);
 *   · chattahoochee-al (AL over GA) — Alabama river-county land ∩ the NE polygon of GEORGIA grown 0.003°: Alabama ground NE calls Georgia (the Eufaula lake shore,
 *     up to 1.6 km). The grown NE polygon means the ring's NE-side edge lies inside ground that is already the right answer, so a simplified edge can never open a gap;
 *     it also keeps each ring to a sliver, which is what lets it be simplified at 0.0003° (~33 m) and still ship small;
 *   · perdido-key      (FL over AL) — Escambia County FL's land in the Perdido window, grown 0.0005° (~55 m: the beach edge), less Baldwin County AL's land, plus a Gulf LOBE:
 *     the water off the Key's Gulf shore east of the Alabama Point line (-87.52), which is Florida's — its top edge runs just south of the beach so it can never claim bay water.
 *     Ono Island, Bear Point and the Perdido Bay north shore are Baldwin County land and stay Alabama.
 *   · perdido-al       (AL over FL) — Baldwin County AL's land ∩ the NE polygon of FLORIDA grown 0.003°, in the same window: along the Perdido River NE also hands Alabama land to Florida. The window runs north to 30.56: Escambia land beside Perdido Bay that
 *     lies in NO NE polygon read Alabama once the nearest-state rule came before the tuned outlines.
 * Source: Esri Living Atlas "USA Census Counties" (FeatureServer layer name dtl_cnty, Census-derived detailed county polygons), probed 2026-10-30; the NE polygons are
 * the ones `siteRegion.js` already ships (so this script imports it — if stateReachData.js is missing, write `export const REACH_RINGS = {};` first).
 * Cached as scripts/data/reach_*.json (gitignored; re-fetched by --fetch). Output: src/workspaces/site-planner/lib/stateReachData.js — GENERATED,
 * never hand-edit; the reach definitions (boxes, reasons, landmarks) stay in siteRegion.js and the numbers are policed by test/stateLineReaches.test.js.
 * `--fixture` also rewrites test/fixtures/stateReachGroundTruth.json (county-land samples of both banks) from the same data.
 *
 *   node scripts/build-state-reaches.mjs            # reads scripts/data
 *   node scripts/build-state-reaches.mjs --fetch    # re-download the sources first
 *   node scripts/build-state-reaches.mjs --fixture  # also rewrite the test fixture
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ClipperLib from "clipper-lib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "data");
const OUT = join(ROOT, "src", "workspaces", "site-planner", "lib", "stateReachData.js");
const FIXTURE = join(ROOT, "test", "fixtures", "stateReachGroundTruth.json");
const BASE = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Counties/FeatureServer/0/query";
const K = 1e7;

/* file → county selection + the envelope [W,S,E,N] fetched */
const SOURCES = {
  "reach_ga.json": { env: [-85.4, 30.9, -84.8, 33.05], where: "STATE_ABBR='GA'" },
  "reach_alriver.json": { env: [-85.4, 30.9, -84.8, 33.05], where: "STATE_ABBR='AL'" },
  "reach_fl.json": { env: [-87.6, 30.2, -87.3, 30.62], where: "FIPS='12033'" },
  "reach_al.json": { env: [-87.6, 30.2, -87.3, 30.62], where: "FIPS='01003'" },
};
const CHATTAHOOCHEE = { box: [31.0, -85.3, 32.95, -84.85], tol: 0.0003, grow: 0.003 };
const PERDIDO = { box: [30.2, -87.53, 30.56, -87.36], grow: 0.0005, tol: 0.0002,
  /* the Gulf lobe [lng, lat…]: west edge on the Alabama Point line (-87.5186 — where the Escambia / Baldwin county line meets the Gulf; it was -87.52, 150 m into Alabama's water, per the independent USGS cross-check), top edge 0.0015° (~165 m) INTO the Key's land so it overlaps the grown Key ring instead of leaving a ~100 m sliver of Florida Gulf water between them (the fourth-review reviewer found it; the union is non-zero now, and the later `less Baldwin land` step keeps any Alabama land out) */
  lobe: [[-87.5186, 30.2], [-87.4, 30.2], [-87.4, 30.2995], [-87.5186, 30.2825]] };

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

const polysOf = (geom) => (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates);
function loadPolys(f) {
  const j = JSON.parse(readFileSync(join(SRC, f), "utf8"));
  if (!j.features?.length) throw new Error(`${f}: no features`);
  const out = [];
  for (const ft of j.features) for (const poly of polysOf(ft.geometry)) out.push(poly);
  return out;
}
const toPaths = (polys) => polys.flatMap((p) => p.map((r) => r.map(([x, y]) => ({ X: Math.round(x * K), Y: Math.round(y * K) }))));
function run(type, subj, clip, fill = ClipperLib.PolyFillType.pftNonZero) {
  const c = new ClipperLib.Clipper(); c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true); c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const sol = new ClipperLib.Paths(); c.Execute(type, sol, fill, fill); return sol;
}
const unionAll = (paths) => run(ClipperLib.ClipType.ctUnion, paths, [], ClipperLib.PolyFillType.pftEvenOdd);
const boxPath = ([s, w, n, e]) => [[{ X: Math.round(w * K), Y: Math.round(s * K) }, { X: Math.round(e * K), Y: Math.round(s * K) }, { X: Math.round(e * K), Y: Math.round(n * K) }, { X: Math.round(w * K), Y: Math.round(n * K) }]];
const ringPath = (pts) => [pts.map(([x, y]) => ({ X: Math.round(x * K), Y: Math.round(y * K) }))];
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
  if (process.argv.includes("--fetch") || !Object.keys(SOURCES).every((f) => existsSync(join(SRC, f)))) await fetchAll();
  const { realBoundaryRings } = await import("../src/workspaces/site-planner/lib/siteRegion.js");
  /* Natural Earth's own polygon(s) for a state, as clipper paths, kept to those that touch the padded box */
  const neOf = (st, [s, w, n, e]) => realBoundaryRings().filter((r) => r.st === st).flatMap((r) => {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < r.xy.length; i += 2) { minX = Math.min(minX, r.xy[i]); maxX = Math.max(maxX, r.xy[i]); minY = Math.min(minY, r.xy[i + 1]); maxY = Math.max(maxY, r.xy[i + 1]); }
    if (maxX < w - 0.1 || minX > e + 0.1 || maxY < s - 0.1 || minY > n + 0.1) return [];
    const path = []; for (let i = 0; i < r.xy.length; i += 2) path.push({ X: Math.round(r.xy[i] * K), Y: Math.round(r.xy[i + 1] * K) });
    return [path];
  });

  const cb = boxPath(CHATTAHOOCHEE.box);
  const gaLand = run(ClipperLib.ClipType.ctIntersection, unionAll(toPaths(loadPolys("reach_ga.json"))), cb);
  const alLand = run(ClipperLib.ClipType.ctIntersection, unionAll(toPaths(loadPolys("reach_alriver.json"))), cb);
  const neAL = grow(unionAll(neOf("AL", CHATTAHOOCHEE.box)), CHATTAHOOCHEE.grow), neGA = grow(unionAll(neOf("GA", CHATTAHOOCHEE.box)), CHATTAHOOCHEE.grow);
  const gaOverAl = run(ClipperLib.ClipType.ctIntersection, gaLand, neAL);
  const alOverGa = run(ClipperLib.ClipType.ctIntersection, alLand, neGA);

  const fl = unionAll(toPaths(loadPolys("reach_fl.json"))), al = unionAll(toPaths(loadPolys("reach_al.json")));
  const flGrown = run(ClipperLib.ClipType.ctIntersection, grow(fl, PERDIDO.grow), boxPath(PERDIDO.box));
  /* NON-ZERO fill, not `unionAll`'s even-odd: the lobe and the grown Key OVERLAP along the beach, and an even-odd union cancels an overlap into a HOLE — which left a ~100 m strip of Escambia
   * County FL land on Perdido Key's Gulf shore (30.281–30.285 N) outside the reach, reading Alabama (found by the independent cross-check, scripts/verify-state-reaches-independent.mjs).
   * Clipper's own outputs are orientation-consistent (outer CCW, holes CW) and the lobe is CCW, so non-zero keeps real holes and merges overlaps. */
  const keyAndLobe = run(ClipperLib.ClipType.ctUnion, flGrown, run(ClipperLib.ClipType.ctIntersection, ringPath(PERDIDO.lobe), boxPath(PERDIDO.box)), ClipperLib.PolyFillType.pftNonZero);
  const pdKey = run(ClipperLib.ClipType.ctDifference, keyAndLobe, al);

  const neFL = grow(unionAll(neOf("FL", PERDIDO.box)), CHATTAHOOCHEE.grow);
  const pdAl = run(ClipperLib.ClipType.ctIntersection, run(ClipperLib.ClipType.ctIntersection, al, boxPath(PERDIDO.box)), neFL);

  const res = { chattahoochee: gaOverAl, "chattahoochee-al": alOverGa, "perdido-key": pdKey, "perdido-al": pdAl };
  const tol = { chattahoochee: CHATTAHOOCHEE.tol, "chattahoochee-al": CHATTAHOOCHEE.tol, "perdido-key": PERDIDO.tol, "perdido-al": PERDIDO.tol };
  /* Compact on purpose (this ships in the Site route's bundle and `siteState` must stay synchronous): each ring is a delta chain in 1e-4° units — the first vertex absolute, every
   * later one the step from the one before — written in base 36, rings joined by "|". `decodeRings` below is the mirror of this encoder. */
  const enc = (ring) => { let px = 0, py = 0; return ring.map(([x, y]) => { const ix = Math.round(x * 1e4), iy = Math.round(y * 1e4); const t = (ix - px).toString(36) + "," + (iy - py).toString(36); px = ix; py = iy; return t; }).join(","); };
  let body = "";
  for (const [id, paths] of Object.entries(res)) {
    const rs = paths.map((p) => ringOut(p, tol[id])).filter((r) => r.length >= 3 && Math.abs(area(r)) > 1e-8);
    if (!rs.length) throw new Error(`${id}: empty reach`);
    body += `  ${JSON.stringify(id)}: ${JSON.stringify(rs.map(enc).join("|"))},\n`;
    console.log(id, "rings", rs.length, "vertices", rs.reduce((n, r) => n + r.length, 0));
  }
  writeFileSync(OUT, `/* GENERATED by scripts/build-state-reaches.mjs — never hand-edit. The polygons \`siteRegion.TUNED_REACHES\` overrule Natural Earth with: county LAND of
 * the tuned state (a county line along a river is the state line) cut to where Natural Earth is wrong, from Esri's USA Census Counties (detailed), probed 2026-10-30.
 * \`REACH_RINGS[id]\` is a list of rings of [lng, lat]; a point is "in the reach" when an ODD number of rings hold it (a hole is its own ring). Stored as delta chains in 1e-4° units
 * (first vertex absolute) in base 36, rings joined by "|" — see the script's header for how each was cut. */
const ENCODED = {
${body}};
const decodeRings = (str) => str.split("|").map((ring) => {
  const n = ring.split(",").map((t) => parseInt(t, 36)), out = [];
  let x = 0, y = 0;
  for (let i = 0; i < n.length; i += 2) { x += n[i]; y += n[i + 1]; out.push([x / 1e4, y / 1e4]); }
  return out;
});
export const REACH_RINGS = Object.fromEntries(Object.entries(ENCODED).map(([id, str]) => [id, decodeRings(str)]));
`);
  console.log("wrote", OUT);

  if (process.argv.includes("--fixture")) writeFixture(CHATTAHOOCHEE, PERDIDO);
}

/* County-land samples of both banks, for test/stateLineReaches.test.js. A sample sits at least `tolIn` degrees inside its own county's land (so the ring's simplification
 * cannot be what the test measures) and within `tolFar` degrees of the other state's land (so it is a point the reach has to get right). */
function writeFixture(ch, pd) {
  const inRingPt = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const inMP = (polys, x, y) => polys.some((p) => inRingPt(p[0], x, y) && !p.slice(1).some((h) => inRingPt(h, x, y)));
  const GA = loadPolys("reach_ga.json"), ALR = loadPolys("reach_alriver.json"), FL = loadPolys("reach_fl.json"), AL = loadPolys("reach_al.json");
  const sample = (A, B, [s, w, n, e], step, tolIn, tolFar) => {
    const near = (poly, la, lo, d) => [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]].some(([a, b]) => inMP(poly, lo + b, la + a));
    const all = (poly, la, lo, d) => [[d, 0], [-d, 0], [0, d], [0, -d]].every(([a, b]) => inMP(poly, lo + b, la + a));
    const oa = [], ob = [];
    for (let la = s; la <= n; la += step) for (let lo = w; lo <= e; lo += step) {
      if (inMP(A, lo, la) && all(A, la, lo, tolIn) && near(B, la, lo, tolFar)) oa.push([+la.toFixed(4), +lo.toFixed(4)]);
      if (inMP(B, lo, la) && all(B, la, lo, tolIn) && near(A, la, lo, tolFar)) ob.push([+la.toFixed(4), +lo.toFixed(4)]);
    }
    return [oa, ob];
  };
  const [pal, pfl] = sample(AL, FL, pd.box, 0.003, 0.0006, 0.012);
  const [cga, cal] = sample(GA, ALR, ch.box, 0.01, 0.0005, 0.03);
  const every = (a, k) => a.filter((_, i) => i % k === 0);
  const fx = {
    source: "Esri Living Atlas USA Census Counties (detailed, layer dtl_cnty): county LAND samples, each at least ~65 m (Perdido) / ~55 m (Chattahoochee) inside its own county's land and within ~1.3 / 3.3 km of the other state's land. Probed 2026-10-30. Regenerate: node scripts/build-state-reaches.mjs --fixture",
    perdido: { al: pal, fl: pfl }, chattahoochee: { ga: every(cga, 4), al: every(cal, 4) },
  };
  writeFileSync(FIXTURE, JSON.stringify(fx));
  console.log("wrote", FIXTURE, { perdidoAl: pal.length, perdidoFl: pfl.length, ga: fx.chattahoochee.ga.length, al: fx.chattahoochee.al.length });
}
main().catch((e) => { console.error(e); process.exit(1); });
