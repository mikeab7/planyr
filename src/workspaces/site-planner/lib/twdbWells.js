/* NEW-B6 (owner scope-note) — TWDB Groundwater Database observation wells: a SECOND depth-to-
 * water signal beside SSURGO's seasonal-high water table (combined in groundwater.js, both
 * shown with provenance). A nearby monitoring well's measured water level is a real point
 * reading (vs SSURGO's soil-map estimate).
 *
 * ENDPOINT STATUS (2026-07-18): the TWDB ArcGIS root returned HTML (not clean JSON) from this
 * sandbox and the exact queryable observation-well service + its water-level field aren't pinned,
 * so — per the owner's scope-note rule ("if an endpoint is unreachable or licensing unclear,
 * build the interface plus registry entry and mark live-verify instead of dropping it") — this
 * ships as a BOUNDED-FETCH INTERFACE + a registry note + a VERIFICATION.md live-verify. The pure
 * parser is field-map-driven so it adapts once the real service/field is confirmed live.
 * Screening only. LOUD-FAILURE: no data / an unconfirmed endpoint → honest null, never a
 * fabricated water level. Pure parser + injectable-fetch client; no DOM/network in the parser. */

// Best-guess registry entry — CONFIRM the service URL + water-level field name against the live
// TWDB Groundwater Data Viewer before relying on it (the live-verify gate). The field map lists
// the candidate attribute names a TWDB wells layer commonly uses for the measured water-level
// depth below land surface; the parser tries them in order.
export const TWDB_WELLS_SOURCE = {
  id: "twdbWells",
  label: "TWDB Groundwater Database observation wells",
  provider: "Texas Water Development Board (TWDB) Groundwater Database",
  // PENDING live confirmation — the TWDB Water Data Interactive / GWDB REST service.
  serviceUrl: null,
  viewer: "https://www3.twdb.texas.gov/apps/waterdatainteractive/groundwaterdataviewer",
  waterLevelFields: ["WaterLevelDepthBelowLSD", "DepthFromLSD", "WaterLevel", "wl_depth", "depth_to_water_ft"],
  wellIdFields: ["StateWellNumber", "WellNumber", "well_id", "StateWellNo"],
  tier: "live-verify-pending",
  note: "Second depth-to-water signal beside SSURGO; endpoint + field pending a live TWDB confirmation.",
};

const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/* Pick the first present field from a candidate list on an attributes bag. Pure. */
function firstField(attrs, names) {
  for (const n of names) {
    if (attrs && attrs[n] != null && attrs[n] !== "") return attrs[n];
    // case-insensitive fallback
    const hit = attrs && Object.keys(attrs).find((k) => k.toLowerCase() === String(n).toLowerCase());
    if (hit && attrs[hit] != null && attrs[hit] !== "") return attrs[hit];
  }
  return null;
}

/* Parse an ArcGIS wells /query response into the nearest well's depth-to-water. `distMetersOf`
 * (injected) computes distance from a feature to the point (the caller has the geometry math).
 * Returns { wellId, depthToWaterFt, distFt } for the nearest well WITH a water level, or null.
 * Field-map-driven so it works once the real service is confirmed. Pure. */
export function parseNearestWell(features, distMetersOf, source = TWDB_WELLS_SOURCE) {
  if (!Array.isArray(features) || !features.length || typeof distMetersOf !== "function") return null;
  let best = null;
  for (const f of features) {
    const attrs = f.attributes || f.attrs || {};
    const depthFt = num(firstField(attrs, source.waterLevelFields));
    if (depthFt == null) continue;
    const distM = distMetersOf(f);
    if (distM == null || !Number.isFinite(distM)) continue;
    if (!best || distM < best.distM) {
      best = { wellId: firstField(attrs, source.wellIdFields), depthToWaterFt: Math.round(depthFt * 100) / 100, distM, distFt: Math.round(distM * 3.28084) };
    }
  }
  if (!best) return null;
  return { wellId: best.wellId, depthToWaterFt: best.depthToWaterFt, distFt: best.distFt };
}

/* Bounded-fetch resolver. Until the service URL is confirmed live (serviceUrl === null), this
 * returns an honest "endpoint pending" — never a fabricated reading. Once wired, it queries the
 * wells layer near the point and returns the nearest reading. `fetchImpl` injectable. */
export async function resolveNearestWell({ lng, lat } = {}, { fetchImpl, timeoutMs = 10000, signal, source = TWDB_WELLS_SOURCE, distMetersOf } = {}) {
  if (!source.serviceUrl) return { ok: false, reason: "TWDB wells endpoint not confirmed yet (live-verify pending)", pending: true };
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { ok: false, reason: "no point" };
  const url = `${source.serviceUrl}/query?geometry=${encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }))}` +
    `&geometryType=esriGeometryPoint&inSR=4326&outSR=4326&distance=1600&units=esriSRUnit_Meter&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&f=json`;
  const ctrl = !signal && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let r;
  try {
    r = await (fetchImpl || fetch)(url, { signal: signal || (ctrl && ctrl.signal) || undefined });
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { ok: false, reason: `TWDB wells fetch failed: ${e && e.message ? e.message : e}` };
  }
  if (timer) clearTimeout(timer);
  if (!r.ok) return { ok: false, reason: `TWDB wells HTTP ${r.status}` };
  let json;
  try { json = await r.json(); } catch (_) { return { ok: false, reason: "TWDB wells response not JSON" }; }
  const nearest = parseNearestWell(json.features || [], distMetersOf || (() => null), source);
  if (!nearest) return { ok: false, reason: "no TWDB well with a water level near this point" };
  return { ok: true, well: nearest, source: source.provider };
}
