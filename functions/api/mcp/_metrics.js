/* Planyr MCP — pure site-model summarizer (B671).
 *
 * Turns one `sites.data` jsonb blob (siteModel v11 shape) into a compact, LLM-readable
 * summary: parcel acreage, building inventory + footprint SF, element tallies, coverage.
 *
 * SCOPE RULE: this module may import ONLY `polyArea` from src/shared/markup/geometry.js
 * (verified pure — no React/DOM/deps). Never import siteModel.js / projectModel.js /
 * pondGeom.js here: their chains pull clipper-lib and planner-coupled code into the
 * Pages Function bundle.
 *
 * HONESTY RULE: numbers the app derives from planner settings (car/trailer stall counts,
 * detention volumes, curb/impervious math, auto clear-height tiers) are NOT recomputed
 * here — the payload says so explicitly instead of approximating them silently.
 */
import { polyArea } from "../../../src/shared/markup/geometry.js";

const SQFT_PER_ACRE = 43560;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/* Footprint area of one element in SF: polygon if it has ring points, else w×h.
 * Centerline roads (pts polyline, no ring) have no cheap area — callers flag those. */
function elementArea(e) {
  if (Array.isArray(e?.points) && e.points.length >= 3) return polyArea(e.points);
  const w = num(e?.w), h = num(e?.h);
  return w > 0 && h > 0 ? w * h : 0;
}

const isCenterlineRoad = (e) => !!e && e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2 && !(Array.isArray(e.points) && e.points.length >= 3);

/** Summarize one site model (the `sites.data` jsonb). Never throws on malformed input. */
export function summarizeSite(data) {
  const d = data && typeof data === "object" ? data : {};
  const parcels = Array.isArray(d.parcels) ? d.parcels : [];
  const els = Array.isArray(d.els) ? d.els : [];

  // Only ACTIVE parcels drive the area math — mirrors the app (default active; B100).
  const activeParcels = parcels.filter((p) => p && p.active !== false);
  const siteSqft = activeParcels.reduce((s, p) => s + (Array.isArray(p.points) ? polyArea(p.points) : 0), 0);

  const buildings = [];
  const tally = {}; // element type → count
  let bldgSqft = 0, parkingArea = 0, trailerArea = 0, pondArea = 0, pavingArea = 0;
  let parkingCount = 0, trailerCount = 0, pondCount = 0, pavingCount = 0;
  let roadsCounted = 0, roadsAreaExcluded = 0;
  const ponds = [];

  for (const e of els) {
    if (!e || typeof e !== "object") continue;
    const type = typeof e.type === "string" ? e.type : "unknown";
    tally[type] = (tally[type] || 0) + 1;
    if (type === "building") {
      const sf = elementArea(e);
      bldgSqft += sf;
      buildings.push({
        name: (typeof e.name === "string" && e.name.trim()) || null,
        widthFt: num(e.w) || null,
        depthFt: num(e.h) || null,
        footprintSqft: Math.round(sf),
        clearHeightFt: Number.isFinite(Number(e.clearHeightOverride)) ? Number(e.clearHeightOverride) : null,
        isBumpOut: !!e.dogEar,
      });
    } else if (type === "parking") { parkingCount++; parkingArea += elementArea(e); }
    else if (type === "trailer") { trailerCount++; trailerArea += elementArea(e); }
    else if (type === "pond") {
      pondCount++;
      const sf = elementArea(e);
      pondArea += sf;
      ponds.push({ areaSqft: Math.round(sf), depthFt: num(e?.det?.depth) || null });
    } else if (type === "paving" || type === "sidewalk") { pavingCount++; pavingArea += elementArea(e); }
    else if (type === "road") {
      if (isCenterlineRoad(e)) { roadsCounted++; roadsAreaExcluded++; }
      else { pavingCount++; pavingArea += elementArea(e); }
    }
  }

  return {
    name: typeof d.name === "string" ? d.name : null,
    siteLabel: typeof d.site === "string" ? d.site : null,
    status: typeof d.status === "string" ? d.status : null,
    county: typeof d.county === "string" ? d.county : null,
    origin: d.origin && Number.isFinite(Number(d.origin.lat)) ? { lat: Number(d.origin.lat), lon: Number(d.origin.lon) } : null,
    schedule: d.scheduleProjectId != null ? { id: d.scheduleProjectId, name: d.scheduleProjectName ?? null } : null,
    parcels: {
      activeCount: activeParcels.length,
      inactiveCount: parcels.length - activeParcels.length,
      siteAcres: round2(siteSqft / SQFT_PER_ACRE),
      siteSqft: Math.round(siteSqft),
    },
    buildings: {
      count: buildings.length,
      totalSqft: Math.round(bldgSqft),
      lotCoveragePct: siteSqft > 0 ? round1((bldgSqft / siteSqft) * 100) : null,
      list: buildings,
    },
    parking: { areas: parkingCount, totalSqft: Math.round(parkingArea), stallCounts: "not computed — open the site in Planyr for stall yield" },
    trailerParking: { areas: trailerCount, totalSqft: Math.round(trailerArea), stallCounts: "not computed — open the site in Planyr for stall yield" },
    ponds: { count: pondCount, totalSqft: Math.round(pondArea), totalAcres: round2(pondArea / SQFT_PER_ACRE), list: ponds },
    paving: {
      areas: pavingCount,
      totalSqft: Math.round(pavingArea),
      centerlineRoadsCounted: roadsCounted,
      centerlineRoadAreaExcluded: roadsAreaExcluded > 0,
    },
    elementTally: tally,
    note: "Computed from saved geometry (footprints/areas only). Stall counts, detention volumes, curb/impervious math, and auto clear-height tiers are left to the Planyr app — do not estimate them from these numbers.",
  };
}
