/* NEW-A5 (owner scope-note) — nearest RECEIVING WATER for a pond's outfall, from the USGS
 * NHDPlus HR flowline network. A detention pond has to discharge its release somewhere; the
 * nearest named stream / ditch is the likely receiving water, and how FAR it is tells you
 * whether an off-site conveyance easement is a risk. When nothing is within reach, that's an
 * outfall-easement flag — the release has nowhere obvious to go.
 *
 * Rides the SWR identifySource path (jurisdiction.js) against the nhdFlowline GIS registry
 * row (NetworkNHDFlowline, layer 3), buffers the outfall point, and picks the nearest reach
 * by true polyline distance. Screening only: NHD is a mapped hydrography network, NOT a
 * surveyed alignment or a legal drainage right — field-verify the outfall path + easements.
 * LOUD-FAILURE: a source outage is an honest "receiving water unverified", never a silent
 * "no water". Pure decision helpers + one async resolver; the resolver's fetch is injectable. */
import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { identifySource, normalizeFeature, polylineDistMeters } from "./jurisdiction.js";

const DAY = 24 * 3600 * 1000;
const FT_PER_M = 3.28084;

/* The identifySource descriptor (DETENTION_SOURCES shape), registry-fed. `tolMeters` is the
 * SEARCH buffer (~1500 ft) so the nearest reach is found even a few hundred feet off; the
 * ADJACENCY judgment (easement risk) is a separate, tighter threshold in receivingWaterFlag. */
export const RECEIVING_WATER_SOURCE = {
  id: "nhdFlowline",
  role: "receivingWater",
  label: "Receiving water (NHDPlus HR)",
  kind: "line",
  url: GIS_SOURCES.nhdFlowline.serviceUrl + "/" + GIS_SOURCES.nhdFlowline.layerId,
  fields: GIS_SOURCES.nhdFlowline.fields, // { name: GNIS_NAME, fcode: FCODE, lengthKm: LENGTHKM }
  tolMeters: 460, // ~1500 ft search buffer
  ttl: 30 * DAY,
  sourceName: GIS_SOURCES.nhdFlowline.provider,
};

// NHD FCODE → plain receiving-water type. Only the reaches an outfall would discharge to are
// worth distinguishing; anything else falls through to a generic "flowline". Pure lookup.
export function fcodeType(fcode) {
  const f = Number(fcode);
  if (!Number.isFinite(f)) return "flowline";
  if (f >= 46000 && f < 47000) return "stream/river";
  if (f >= 33600 && f < 33700) return "canal/ditch";
  if (f === 55800) return "artificial path";
  if (f === 33400) return "connector";
  if (f >= 42800 && f < 42900) return "pipeline";
  if (f === 56600) return "coastline";
  return "flowline";
}

/* Nearest receiving water to a point, from a raw identifySource item list ([{attrs,geometry}]).
 * Returns { name, fcode, type, distFt, distM, unnamed } for the nearest reach OVERALL, plus
 * `named` — the nearest reach that actually carries a GNIS name (an outfall usually reports to
 * a named creek, not an unnamed connector). Null when the list is empty. Pure. */
export function nearestReceivingWater(items, lng, lat) {
  if (!Array.isArray(items) || !items.length) return null;
  let best = null, bestNamed = null;
  for (const it of items) {
    if (!it || !it.geometry) continue;
    const f = normalizeFeature(RECEIVING_WATER_SOURCE, it.attrs);
    const distM = polylineDistMeters(it.geometry, lng, lat);
    if (!Number.isFinite(distM)) continue;
    const rec = {
      name: f.name || null,
      fcode: f.fcode ?? null,
      type: fcodeType(f.fcode),
      distM: Math.round(distM),
      distFt: Math.round(distM * FT_PER_M),
      unnamed: !f.name,
    };
    if (!best || distM < best.distM) best = rec;
    if (f.name && (!bestNamed || distM < bestNamed.distM)) bestNamed = rec;
  }
  if (!best) return null;
  return { ...best, named: bestNamed };
}

/* The outfall-easement screen from a nearestReceivingWater result. Within `adjacentFt` the
 * outfall likely fronts the water (low risk); beyond it, releasing off-site to the receiving
 * water probably needs a conveyance easement — surfaced, never assumed. A null nearest (nothing
 * found within the search buffer) is the loudest flag. Pure. */
export const OUTFALL_ADJACENT_FT = 300;
export function receivingWaterFlag(nearest, { adjacentFt = OUTFALL_ADJACENT_FT } = {}) {
  if (!nearest) {
    return { risk: "none-nearby", severity: "warn", nearest: null, message: "No mapped receiving water within the search radius — the pond outfall may need an off-site conveyance easement to reach one. Field-verify the drainage path." };
  }
  const ref = nearest.named && nearest.named.distFt <= nearest.distFt * 3 ? nearest.named : nearest;
  const label = ref.name ? `${ref.name} (${ref.type})` : `an unnamed ${ref.type}`;
  if (ref.distFt <= adjacentFt) {
    return { risk: "adjacent", severity: "ok", nearest: ref, message: `Nearest receiving water: ${label}, ~${ref.distFt} ft away — likely a direct outfall. Field-verify the connection + any easement.` };
  }
  return { risk: "offsite", severity: "warn", nearest: ref, message: `Nearest receiving water: ${label}, ~${ref.distFt} ft away — beyond the pond, so an off-site conveyance easement may be needed to discharge there. Field-verify the outfall path.` };
}

const shapeState = (r, error) => (error ? "failed" : r && r.items && r.items.length ? "loaded" : "empty");

/* Resolve the nearest receiving water at an outfall point (or a parcel ring's frontage).
 * Composes identifySource (SWR cache) + nearestReceivingWater + receivingWaterFlag. Returns
 * { nearest, flag, state, ageMs, msg }. A source failure yields state:"failed" + an honest
 * "unverified" flag, never a fabricated no. opts.{cache, fetchJson, signal} thread through. */
export async function resolveReceivingWater({ lng, lat, ring = null } = {}, opts = {}) {
  const geom = ring && ring.length >= 3 ? { ring } : { lng, lat };
  const res = await identifySource(RECEIVING_WATER_SOURCE, geom, opts).fresh;
  if (res.error) {
    return {
      nearest: null,
      flag: { risk: "unverified", severity: "warn", nearest: null, message: "Receiving-water lookup didn't answer — outfall receiving water unverified. Retry, or field-verify the drainage path." },
      state: "failed",
      ageMs: res.ageMs ?? null,
      msg: String(res.error.message || res.error),
    };
  }
  const nearest = nearestReceivingWater(res.items, lng, lat);
  return { nearest, flag: receivingWaterFlag(nearest), state: shapeState(res, null), ageMs: res.ageMs ?? null, msg: null };
}
