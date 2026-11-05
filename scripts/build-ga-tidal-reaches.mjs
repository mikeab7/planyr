#!/usr/bin/env node
/* NEW-1 (B2535200 review, finding 1, 2026-10-30) — build src/workspaces/site-planner/lib/gaTidalReaches.js: WHERE Georgia's protected rivers are TIDAL.
 *
 * WHY: Rule 391-3-16-.04 / O.C.G.A. 12-2-8 define a protected river as a perennial river of 400 cfs or more EXCEPT the segments covered by the Metropolitan River
 * Protection Act or the Coastal Marshlands Protection Act. DCA's ProtectedRiver layer (257 features, live 2026-10-30) draws the Altamaha, Ogeechee, Canoochee, Savannah,
 * Satilla and St Marys right down to the sea, so the 100-ft "protected-river" band was drawn across the marsh the Marshlands Act governs. No state service publishes that Act's
 * jurisdiction, so the tidal reach is taken from the U.S. Fish & Wildlife Service National Wetlands Inventory: a river line is TIDAL where the NWI polygon under it is Riverine-Tidal
 * (`R1…`) or Estuarine (`E…`). This is a SCREENING PROXY for "the Act's estuarine area" (tidally influenced waters) — good to about a kilometre at the upstream limit, and said so on the layer.
 *
 * HOW: sample every protected-river line east of -82.8° and south of 32.95°N about every 1.3 km, ask the NWI service (60 m search distance, so a centreline on a bank still hits the
 * water polygon) whether the sample is tidal, then give EVERY vertex of those lines the answer of its nearest sample (within 0.02°) and mark the 0.01° grid cell under each tidal
 * vertex (segments are densified, so no cell is skipped). The committed output is the sorted set of cells.
 *
 *   node scripts/build-ga-tidal-reaches.mjs        # needs network (services2.arcgis.com + fwspublicservices.wim.usgs.gov)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = new URL("../src/workspaces/site-planner/lib/gaTidalReaches.js", import.meta.url);
const RIVERS = "https://services2.arcgis.com/Gqyymy5JISeLzyNM/arcgis/rest/services/EnvironmentalPlanning/FeatureServer/6/query";
const NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query";
const CELL = 0.01, SAMPLE_GAP = 0.012, NEAR = 0.02;

const rivers = await (await fetch(`${RIVERS}?${new URLSearchParams({ where: "1=1", outFields: "FENAME", outSR: "4326", f: "geojson", resultRecordCount: "2000" })}`)).json();
if (!rivers.features || rivers.features.length < 200) throw new Error(`protected rivers → ${rivers.features && rivers.features.length} features`);
const linesOf = (g) => (g.type === "MultiLineString" ? g.coordinates : [g.coordinates]);
const coastal = (p) => p[1] <= 32.95 && p[0] >= -82.8;

const samples = []; const seen = new Set();
for (const f of rivers.features) for (const l of linesOf(f.geometry)) {
  let last = null;
  for (const p of l) {
    if (!coastal(p)) continue;
    if (last && Math.hypot((p[0] - last[0]) * 0.85, p[1] - last[1]) < SAMPLE_GAP) continue;
    last = p;
    const k = `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    if (!seen.has(k)) { seen.add(k); samples.push({ p, tidal: null }); }
  }
}
console.log("samples", samples.length);
let i = 0;
async function work() {
  while (i < samples.length) {
    const s = samples[i++];
    const u = new URL(NWI);
    for (const [k, v] of Object.entries({ geometry: `${s.p[0]},${s.p[1]}`, geometryType: "esriGeometryPoint", inSR: 4326, spatialRel: "esriSpatialRelIntersects", distance: 60, units: "esriSRUnit_Meter", outFields: "ATTRIBUTE", returnGeometry: "false", f: "json" })) u.searchParams.set(k, v);
    for (let t = 0; t < 4 && s.tidal === null; t++) {
      try { const j = await (await fetch(u, { signal: AbortSignal.timeout(30000) })).json(); if (j.features) s.tidal = j.features.some((x) => /^(E|R1)/.test(x.attributes.ATTRIBUTE || "")); } catch (_e) { /* retried */ }
    }
    if (s.tidal === null) throw new Error(`NWI would not answer at ${s.p}`);
  }
}
await Promise.all(Array.from({ length: 8 }, work));

const near = (p) => { let best = null, bd = NEAR; for (const s of samples) { const d = Math.hypot((s.p[0] - p[0]) * 0.85, s.p[1] - p[1]); if (d < bd) { bd = d; best = s; } } return best; };
const cells = new Set();
const mark = (p) => cells.add(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`);
for (const f of rivers.features) for (const l of linesOf(f.geometry)) {
  for (let a = 0; a < l.length; a++) {
    const p = l[a]; if (!coastal(p)) continue;
    const s = near(p); if (!s || !s.tidal) continue;
    mark(p);
    const q = l[a + 1];
    if (q && coastal(q)) { const n = Math.ceil(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) / (CELL / 2)); for (let k = 1; k < n; k++) mark([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]); }
  }
}
const sorted = [...cells].map((c) => c.split(",").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let px = 0, py = 0; const enc = [];
for (const [x, y] of sorted) { enc.push((x - px).toString(36), (y - py).toString(36)); px = x; py = y; }
const stamp = new Date().toISOString().slice(0, 10);
writeFileSync(OUT, `/* GENERATED by scripts/build-ga-tidal-reaches.mjs on ${stamp} — do not hand-edit. The 0.01° grid cells (about 1 km) that hold a TIDAL stretch of one of DCA's protected-river lines
 * (NWI Riverine-Tidal / Estuarine under the line): the screening proxy for the segments covered by the Coastal Marshlands Protection Act, where the 100-ft protected-river rule does
 * not apply (Rule 391-3-16-.04). Format: base-36 deltas "dx,dy,…" of [floor(lng / CELL), floor(lat / CELL)], cells sorted by x then y, the first pair absolute. Read through
 * georgiaStreamBuffers.inTidalReach, never directly. */
export const GA_TIDAL_CELL_DEG = ${CELL};
export const GA_TIDAL_CELLS = ${JSON.stringify(enc.join(","))};
`);
console.log("tidal samples", samples.filter((s) => s.tidal).length, "cells", sorted.length, "bytes", enc.join(",").length);
