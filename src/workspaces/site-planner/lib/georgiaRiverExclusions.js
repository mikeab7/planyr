/* Georgia protected rivers — WHERE THE 100-FT RULE DOES NOT APPLY (NEW-1 review of B2535200, 2026-10-30). A boot-safe LEAF (no Leaflet, no geometry library): `georgiaLayers.js` (the registry, on the
 * boot path) reads it for the Protected Rivers click card, and `georgiaStreamBuffers.js` for the bands. Pure.
 *
 * Rule 391-3-16-.04 / O.C.G.A. 12-2-8: a protected river is a perennial river of 400 cfs or more, EXCEPT a segment covered by the Metropolitan River Protection Act (MRPA) or the Coastal Marshlands
 * Protection Act. DCA's ProtectedRiver layer draws both (live 2026-10-30), so neither segment may carry the 100-ft band or the Part V river rule:
 *   · MRPA — the Chattahoochee from Buford Dam to the Fulton/Douglas line. Bands are cut out with ARC's own 2,000-ft corridor polygon (VECTOR_SOURCES.ga_mrpa_corridor); the click card, which has no
 *     live polygon, uses a baked outline of that corridor (gaMrpaReach.js) AND the river's name (only the Chattahoochee runs through it).
 *   · Coastal Marshlands — the TIDAL reaches. No state service publishes the Act's jurisdiction, so the tidal stretch is the National Wetlands Inventory's Riverine-Tidal / Estuarine polygon under the
 *     line, baked into gaTidalReaches.js by scripts/build-ga-tidal-reaches.mjs: 0.01° cells (about a kilometre) — a SCREENING PROXY, said so on the layer. */
import { GA_TIDAL_CELL_DEG, GA_TIDAL_CELLS } from "./gaTidalReaches.js";
import { GA_MRPA_REACH, GA_MRPA_REACH_BBOX, GA_MRPA_REACH_SCALE } from "./gaMrpaReach.js";

/* TIDAL reach (the Coastal Marshlands Protection Act's ground): is this point in a 0.01° cell that holds a tidal stretch of a protected-river line? Pure. */
let _tidal = null;
function tidalCells() {
  if (_tidal) return _tidal;
  const set = new Set();
  const nums = GA_TIDAL_CELLS ? GA_TIDAL_CELLS.split(",") : [];
  let x = 0, y = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) { x += parseInt(nums[i], 36); y += parseInt(nums[i + 1], 36); set.add(x + "," + y); }
  return (_tidal = set);
}
export const inTidalReach = (lng, lat) => tidalCells().has(Math.floor(lng / GA_TIDAL_CELL_DEG) + "," + Math.floor(lat / GA_TIDAL_CELL_DEG));

/* The Metropolitan River Protection Act reach (O.C.G.A. 12-5-440 et seq.): Buford Dam downstream to the downstream limits of Fulton and Douglas counties. A BOUNDING BOX is not that reach — its
 * north-east corner lay over the impounded river at the dam — so the click card uses ARC's own 2,000-ft corridor outline (gaMrpaReach.js, built by scripts/build-ga-mrpa-reach.mjs, 25 m simplification).
 * `MRPA_REACH_BOX` is only that outline's bounding box, kept as the cheap PREFILTER the band code asks first. Only the Chattahoochee itself runs through the corridor. */
export const MRPA_REACH_BOX = GA_MRPA_REACH_BBOX;
export function inMrpaReachBox(lng, lat, pad = 0) {
  return lng >= MRPA_REACH_BOX.lngMin - pad && lng <= MRPA_REACH_BOX.lngMax + pad && lat >= MRPA_REACH_BOX.latMin - pad && lat <= MRPA_REACH_BOX.latMax + pad;
}

/* A ring with a latitude-strip index, so a point-in-ring test visits the ~100 edges in its strip instead of all of a 13,000-vertex corridor. Pure. */
const STRIPS = 128;
export function makeRingIndex(ring) {
  let latMin = Infinity, latMax = -Infinity;
  for (const p of ring) { if (p[1] < latMin) latMin = p[1]; if (p[1] > latMax) latMax = p[1]; }
  const h = (latMax - latMin) / STRIPS || 1;
  const strips = Array.from({ length: STRIPS }, () => []);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const lo = Math.min(ring[i][1], ring[j][1]), hi = Math.max(ring[i][1], ring[j][1]);
    const s0 = Math.max(0, Math.min(STRIPS - 1, Math.floor((lo - latMin) / h))), s1 = Math.max(0, Math.min(STRIPS - 1, Math.floor((hi - latMin) / h)));
    for (let s = s0; s <= s1; s++) strips[s].push(i, j);
  }
  return { ring, latMin, latMax, h, strips };
}
export function inRingIndex(idx, lng, lat) {
  if (lat < idx.latMin || lat > idx.latMax) return false;
  const e = idx.strips[Math.max(0, Math.min(STRIPS - 1, Math.floor((lat - idx.latMin) / idx.h)))];
  const ring = idx.ring; let inside = false;
  for (let k = 0; k < e.length; k += 2) {
    const [xi, yi] = ring[e[k]], [xj, yj] = ring[e[k + 1]];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/* DCA's centreline and ARC's corridor are two digitisations of one river (measured live 2026-10-30: 81 of 1,761 Chattahoochee vertices sit 2-120 m OUTSIDE the polygon, at the downstream end), so
 * "in the reach" means inside the outline OR within MRPA_EDGE_DEG (about 150 m) of it: the point and its eight neighbours at that distance. Pure. */
export const MRPA_EDGE_DEG = 0.0015;
export function nearRingIndexes(idxs, lng, lat, edge = MRPA_EDGE_DEG) {
  for (const dx of [0, -edge, edge]) for (const dy of [0, -edge, edge]) for (const idx of idxs) if (inRingIndex(idx, lng + dx, lat + dy)) return true;
  return false;
}
let _reach = null;
function reachIndex() {
  if (_reach) return _reach;
  const nums = GA_MRPA_REACH.split(","), ring = []; let x = 0, y = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) { x += parseInt(nums[i], 36); y += parseInt(nums[i + 1], 36); ring.push([x / GA_MRPA_REACH_SCALE, y / GA_MRPA_REACH_SCALE]); }
  return (_reach = [makeRingIndex(ring)]);
}
/* Is this point on the MRPA reach (the corridor outline, with the digitisation tolerance)? Pure. */
export const inMrpaReach = (lng, lat) => inMrpaReachBox(lng, lat, MRPA_EDGE_DEG) && nearRingIndexes(reachIndex(), lng, lat);

/* Which excluded segment (if any) a clicked protected-river point is on — for the Protected Rivers card, which has only the feature's name and the click: "mrpa" | "tidal" | null. */
export function riverExclusionAt(name, at) {
  const lat = Number(at && at.lat), lng = Number(at && (at.lng != null ? at.lng : at.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (/^chattahoochee/i.test(String(name || "")) && inMrpaReach(lng, lat)) return "mrpa";
  if (inTidalReach(lng, lat)) return "tidal";
  return null;
}
