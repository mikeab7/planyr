#!/usr/bin/env node
/* NEW-1 (state layers, fourth review follow-up, 2026-10-30) — cross-check the state-line REACHES (siteRegion.TUNED_REACHES ← stateReachData.js, and the county-land
 * fixture test/fixtures/stateReachGroundTruth.json) against a fine-scale source that is NOT the Esri "USA Census Counties" pull they were built from.
 *
 * WHY: scripts/build-state-reaches.mjs builds the reach rings from Esri's USA Census Counties (detailed), and test/stateLineReaches.test.js checks `siteState`
 * against a fixture generated from that SAME pull — so a mistake in that one layer would pass both. This script asks a second, independently published layer:
 * the USGS National Map "Governmental Unit Boundaries" service, STATE OR TERRITORY LARGE-SCALE (carto.nationalmap.gov …/govunits/MapServer/22; a USGS
 * product built from Census TIGER at a large scale — a different publisher, different generalisation, different vintage from the Esri layer).
 * (Census TIGER/Line itself and the 1:500k cartographic files sit on hosts the build sandbox's egress policy blocks — www2.census.gov, tigerweb.geo.census.gov —
 * so the USGS service is the reachable fine-scale source; it is stated here so the choice is not mistaken for a convenience.)
 *
 * WATER IS NOT GATED: the state line runs through Perdido Bay and the Gulf and the two layers legitimately draw it differently there, so water cells are only counted
 * (`waterDisagree`). The Gulf lobe (a reach component that exists for water) is therefore covered by landmarks in test/stateLineReaches.test.js, not by this gate.
 * The fixture step checks the FIXTURE against USGS (is the ground truth itself right); the grid step is what exercises `siteState`.
 * WHAT IT DOES, for the two reach windows (Perdido: 30.2–30.56 N, -87.53…-87.36; Chattahoochee: 31.0–32.95 N, -85.3…-84.85):
 *   1. every fixture sample (county land, both banks of both reaches) must be in the state the fixture says, per USGS;
 *   2. a grid over each window (0.0005° Perdido, 0.001° Chattahoochee) — for every cell USGS holds in AL / FL / GA, `siteState` must agree; every disagreement is
 *      measured against the USGS state line (metres) and only a disagreement farther from the line than the source's stated accuracy counts as a fault.
 *      Natural Earth alone (`realStateAt`, no reaches) is measured the same way as the baseline, so the reaches' improvement — and any cell they made worse — is visible.
 * STATED ACCURACY of the reference: USGS large-scale state lines follow TIGER, digitised from 1:24,000 sources (NMAS 40 ft ≈ 12 m); the tolerance used is
 * TOL_M = 50 m — four times that, a margin for the two layers' different handling of a river centreline vs a shoreline.
 *
 *   node scripts/verify-state-reaches-independent.mjs            # reads scripts/data (re-fetches when missing)
 *   node scripts/verify-state-reaches-independent.mjs --fetch    # re-download first
 *   node scripts/verify-state-reaches-independent.mjs --json     # machine-readable result
 * Exit 1 on any fault beyond tolerance, or on a vacuous run (no fixture sample / no grid cell measured). */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { siteState, realStateAt, TUNED_REACHES } from "../src/workspaces/site-planner/lib/siteRegion.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "scripts", "data");
const FIXTURE = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "stateReachGroundTruth.json"), "utf8"));
const BASE = "https://carto.nationalmap.gov/arcgis/rest/services/govunits/MapServer/22/query";
const TOL_M = 50;
/* LAND MASK ONLY — the state line is a legal line through Perdido Bay and the river; the reaches claim LAND (county land), so water cells (where the two layers legitimately
 * differ on where the line is drawn through the bay) are counted apart, never faulted. Esri's county polygons are land-clipped, so they answer only "land or water" here — never
 * "which state" — and the state answer stays entirely USGS's. */
const LAND = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Counties/FeatureServer/0/query";
const CODE = { Alabama: "AL", Florida: "FL", Georgia: "GA" };
const WINDOWS = {
  perdido: { pair: ["FL", "AL"], env: [-87.56, 30.18, -87.34, 30.58], box: [30.2, -87.53, 30.56, -87.36], step: 0.0005, file: "usgs_state_perdido.json" },
  "al-fl-line": { informational: true, env: [-87.6, 30.95, -84.85, 31.06], box: [30.97, -87.6, 31.04, -84.9], step: 0.0005, file: "usgs_state_alfl.json" },
  chattahoochee: { pair: ["AL", "GA"], env: [-85.32, 30.98, -84.82, 32.97], box: [31.0, -85.3, 32.95, -84.85], step: 0.001, file: "usgs_state_chattahoochee.json" },
};

async function fetchLand(w) {
  const q = new URLSearchParams({ where: "STATE_ABBR IN ('AL','FL','GA')", geometry: w.env.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", outFields: "STATE_ABBR", maxAllowableOffset: "0.00002", f: "geojson" });
  const r = await fetch(`${LAND}?${q}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`land mask ${r.status}`);
  const txt = await r.text();
  /* a truncated mask would silently turn land into "water" and exempt it from every fault — refuse it */
  if (/exceededTransferLimit/.test(txt)) throw new Error("land mask truncated (exceededTransferLimit) — instrument void");
  writeFileSync(join(DATA, w.file.replace("usgs_state_", "landmask_")), txt);
}
async function fetchWindow(w) {
  const q = new URLSearchParams({ where: "1=1", geometry: w.env.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", outFields: "state_name", f: "geojson" });
  const r = await fetch(`${BASE}?${q}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`USGS govunits ${r.status}`);
  mkdirSync(DATA, { recursive: true });
  const txt = await r.text();
  if (/exceededTransferLimit/.test(txt)) throw new Error("USGS state polygons truncated (exceededTransferLimit) — instrument void");
  writeFileSync(join(DATA, w.file), txt);
}

/* a polygon set with per-latitude edge buckets so a 900 k-cell grid stays cheap */
function indexPolys(geo, anyState = false) {
  const BK = 0.005, out = [];
  for (const f of geo.features) {
    const code = anyState ? f.properties.STATE_ABBR : CODE[f.properties.state_name || f.properties.STATE_NAME]; if (!code) continue;
    const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const rings = polys.flat(), edges = [], buckets = new Map();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1], e = [x1, y1, x2, y2], idx = edges.push(e) - 1;
      minX = Math.min(minX, x1); maxX = Math.max(maxX, x1); minY = Math.min(minY, y1); maxY = Math.max(maxY, y1);
      for (let b = Math.floor(Math.min(y1, y2) / BK); b <= Math.floor(Math.max(y1, y2) / BK); b++) { if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(idx); }
    }
    out.push({ code, edges, buckets, BK, minX, maxX, minY, maxY });
  }
  return out;
}
function inPoly(p, lo, la) {
  if (lo < p.minX || lo > p.maxX || la < p.minY || la > p.maxY) return false;
  let inside = false;
  for (const i of p.buckets.get(Math.floor(la / p.BK)) || []) {
    const [x1, y1, x2, y2] = p.edges[i];
    if ((y1 > la) !== (y2 > la) && lo < ((x2 - x1) * (la - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}
const usgsAt = (polys, la, lo) => { for (const p of polys) if (inPoly(p, lo, la)) return p.code; return null; };
/* metres from a point to the nearest edge of the USGS polygon of ONE state — the state `siteState` answered — so "how far was the answer from being right" is
 * the distance to the state it claimed, not to a coastline (planar, cos-lat scaled — exact enough at 50 m). Infinity when USGS holds no polygon for that code. */
function distToLineM(polys, la, lo, code) {
  const kx = 111320 * Math.cos((la * Math.PI) / 180), ky = 110574; let best = Infinity;
  for (const p of polys.filter((q) => q.code === code)) {
    const lat0 = Math.floor(la / p.BK);
    for (let b = lat0 - 1; b <= lat0 + 1; b++) for (const i of p.buckets.get(b) || []) {
      const [x1, y1, x2, y2] = p.edges[i]; const ax = (x1 - lo) * kx, ay = (y1 - la) * ky, bx = (x2 - lo) * kx, by = (y2 - la) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

async function main() {
  const wantFetch = process.argv.includes("--fetch");
  const report = { tolM: TOL_M, source: "USGS National Map govunits MapServer layer 22 (State or Territory Large-Scale)", windows: {}, fixture: {}, faults: [] };
  const polys = {}, land = {};
  for (const [k, w] of Object.entries(WINDOWS)) {
    if (wantFetch || !existsSync(join(DATA, w.file))) await fetchWindow(w);
    const lf = join(DATA, w.file.replace("usgs_state_", "landmask_")); if (wantFetch || !existsSync(lf)) await fetchLand(w);
    polys[k] = indexPolys(JSON.parse(readFileSync(join(DATA, w.file), "utf8")));
    land[k] = indexPolys(JSON.parse(readFileSync(lf, "utf8")), true);
    if (polys[k].length < 2) throw new Error(`${k}: USGS returned fewer than two states — instrument void`);
  }
  /* 1 — the fixture's county-land samples */
  const SIDE = { perdido: { al: "AL", fl: "FL" }, chattahoochee: { ga: "GA", al: "AL" } };
  for (const reach of ["perdido", "chattahoochee"]) for (const [side, want] of Object.entries(SIDE[reach])) {
    let n = 0, bad = [], nearBad = 0;
    for (const [la, lo] of FIXTURE[reach][side]) {
      n++; const got = usgsAt(polys[reach], la, lo);
      if (got !== want) { const d = distToLineM(polys[reach], la, lo, want); if (d > TOL_M) bad.push([la, lo, got, Math.round(d)]); else nearBad++; }
    }
    report.fixture[`${reach}.${side}`] = { samples: n, wantState: want, disagreeBeyondTol: bad.length, disagreeWithinTol: nearBad, cells: bad.slice(0, 8) };
    if (bad.length) report.faults.push({ kind: "fixture", reach, side, cells: bad });
  }
  /* 2 — grid over each window: siteState (with reaches) and realStateAt (Natural Earth alone, the baseline) against USGS */
  for (const [k, w] of Object.entries(WINDOWS)) {
    const [s, wst, n, e] = w.box; let landN = 0, waterN = 0, waterDis = 0, siteBad = 0, realBad = 0, flips = 0; const siteFar = [], other = {}, hist = { le12: 0, le25: 0, le50: 0, gt50: 0 }, realFar = { gt50: 0, gt200: 0, gt1000: 0 };
    for (let la = s; la <= n + 1e-9; la += w.step) for (let lo = wst; lo <= e + 1e-9; lo += w.step) {
      const ref = usgsAt(polys[k], la, lo); if (!ref) continue;
      if (!usgsAt(land[k], la, lo)) { waterN++; if (siteState({ lat: la, lng: lo }) !== ref) waterDis++; continue; }
      landN++;
      const ans = siteState({ lat: la, lng: lo }), real = realStateAt(la, lo);
      if (real !== ans) flips++;
      const sb = ans !== ref, rb = real !== ref;
      if (rb) realBad++;
      if (rb) { const d = distToLineM(polys[k], la, lo, real); if (d > TOL_M) realFar.gt50++; if (d > 200) realFar.gt200++; if (d > 1000) realFar.gt1000++; }
      if (sb) {
        siteBad++; const d = distToLineM(polys[k], la, lo, ans);
        /* A reach answers for its OWN two states only. A disagreement between any other pair (the AL|FL line at 31°N inside the Chattahoochee box, the GA|FL tripoint) is Natural Earth's own
         * ~1 km class error on a line no reach covers: counted and disclosed per pair, never faulted here. The AL|FL line east of Perdido is measured whole as its own `informational` window. */
        if (w.informational || (w.pair && !(w.pair.includes(ref) && w.pair.includes(ans)))) { const key = `${ref}>${ans}`; const o = (other[key] ||= { n: 0, maxM: 0 }); o.n++; o.maxM = Math.max(o.maxM, Math.round(d)); continue; }
        if (d <= 12) hist.le12++; else if (d <= 25) hist.le25++; else if (d <= TOL_M) hist.le50++; else { hist.gt50++; siteFar.push([+la.toFixed(5), +lo.toFixed(5), ref, ans, Math.round(d)]); }
      }
    }
    report.windows[k] = { step: w.step, usgsLandCells: landN, usgsWaterCellsNotFaulted: waterN, waterDisagree: waterDis, reachFlipsVsNaturalEarth: flips, siteStateDisagrees: siteBad, siteStateDistFromUsgsLineM: hist, otherLinesNotAReachRemit: other, naturalEarthAloneDisagrees: realBad, naturalEarthAloneBeyondTol: realFar, farthest: siteFar.sort((a, b) => b[4] - a[4]).slice(0, 12), beyondTolCells: siteFar.length };
    if (siteFar.length) report.faults.push({ kind: "grid", window: k, cells: process.argv.includes("--all") ? siteFar : siteFar.slice(0, 200) });
    if (!w.informational && (!landN || !flips)) report.faults.push({ kind: "vacuous", window: k, land: landN, flips });
  }
  report.reaches = TUNED_REACHES.map((r) => r.id);
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 1)); else console.dir(report, { depth: 5 });
  process.exit(report.faults.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
