/* Georgia protected rivers — WHERE THE 100-FT RULE DOES NOT APPLY (NEW-1 review of B2535200, 2026-10-30). A boot-safe LEAF (no Leaflet, no geometry library): `georgiaLayers.js` (the registry, on the
 * boot path) reads it for the Protected Rivers click card, and `georgiaStreamBuffers.js` for the bands. Pure.
 *
 * Rule 391-3-16-.04 / O.C.G.A. 12-2-8: a protected river is a perennial river of 400 cfs or more, EXCEPT a segment covered by the Metropolitan River Protection Act (MRPA) or the Coastal Marshlands
 * Protection Act. DCA's ProtectedRiver layer draws both (live 2026-10-30), so neither segment may carry the 100-ft band or the Part V river rule:
 *   · MRPA — the Chattahoochee from Buford Dam to the Fulton/Douglas line. Bands are cut out with ARC's own 2,000-ft corridor polygon (VECTOR_SOURCES.ga_mrpa_corridor); the click card, which has no
 *     polygon, uses that corridor's bounding box AND the river's name (only the Chattahoochee runs through it).
 *   · Coastal Marshlands — the TIDAL reaches. No state service publishes the Act's jurisdiction, so the tidal stretch is the National Wetlands Inventory's Riverine-Tidal / Estuarine polygon under the
 *     line, baked into gaTidalReaches.js by scripts/build-ga-tidal-reaches.mjs: 0.01° cells (about a kilometre) — a SCREENING PROXY, said so on the layer. */
import { GA_TIDAL_CELL_DEG, GA_TIDAL_CELLS } from "./gaTidalReaches.js";

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

/* The Metropolitan River Protection Act corridor, as a bounding box, for the places that have no polygon to hand (a click card): ARC's 2,000-ft Chattahoochee corridor runs Buford
 * Dam → the downstream limit of Fulton/Douglas counties, (-84.85..-84.07, 33.51..34.17) (sources.js gaMrpaCorridor). Only the Chattahoochee itself runs through it. */
export const MRPA_REACH_BOX = Object.freeze({ lngMin: -84.85, lngMax: -84.07, latMin: 33.51, latMax: 34.17 });
export function inMrpaReachBox(lng, lat) {
  return lng >= MRPA_REACH_BOX.lngMin && lng <= MRPA_REACH_BOX.lngMax && lat >= MRPA_REACH_BOX.latMin && lat <= MRPA_REACH_BOX.latMax;
}

/* Which excluded segment (if any) a clicked protected-river point is on — for the Protected Rivers card, which has only the feature's name and the click: "mrpa" | "tidal" | null. */
export function riverExclusionAt(name, at) {
  const lat = Number(at && at.lat), lng = Number(at && (at.lng != null ? at.lng : at.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (/^chattahoochee/i.test(String(name || "")) && inMrpaReachBox(lng, lat)) return "mrpa";
  if (inTidalReach(lng, lat)) return "tidal";
  return null;
}
