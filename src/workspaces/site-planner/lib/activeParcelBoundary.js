// B1923744 — pure geometry for the Map view's "draw the record's own active parcel boundary
// alongside the pin at close zoom" feature (see MapFinder.jsx). Split out so the zoom gate,
// the parcel filter, and the reprojection outcome are unit-testable without Leaflet or a DOM —
// the same split every other pure geometry module in this folder keeps (siteBoundary.js,
// layerZoomGate.js, parcelDisplayZoom.js).
import { isLiveActive } from "./splitIntegrity.js";

// A much lighter reveal than MapFinder's PLAN_ZOOM (the full-plan swap): the record's own
// active parcel boundary reads as more than a dot well before the whole plan (every element,
// true colors) is legible, so it joins the pin here instead of waiting for that swap.
export const PARCEL_ZOOM = 13;

// Whether the active-parcel boundary should join the pin at this zoom. Never true once the
// full-plan view (`showPlans`) has already taken over — at that point the parcel boundary is
// already part of the fuller detail, so drawing it twice would be redundant.
export function showActiveParcelAt(zoom, showPlans) {
  return !showPlans && (zoom ?? 0) >= PARCEL_ZOOM;
}

// The record's own parcel(s) that count as "selected" for this feature: live (active, not
// soft-deleted) with a real ring — the same predicate the KMZ export / thumbnail / rotate call
// sites use, so this can never disagree with them about which parcel on a record is "the
// selected one". Returns [] (never null) so callers can iterate unconditionally.
export function activeDrawParcels(drawParcels) {
  return (drawParcels || []).filter(
    (p) => isLiveActive(p) && Array.isArray(p.points) && p.points.length >= 3
  );
}

// Reproject one parcel's feet ring to an array of [lat, lng] pairs via the caller's own project
// function (MapFinder passes the shared `feetToLatLng`). `{ ok: true, latlngs }` on success;
// `{ ok: false, latlngs: null }` if any point comes back non-finite — a real defect (a selected,
// georeferenced parcel that still can't be placed), never a silent drop, so the caller can
// surface it (LOUD-FAILURE) rather than swallow it. A missing site origin is a DIFFERENT, non-
// error case ("not applicable") and is the caller's responsibility to gate before ever calling in.
export function reprojectParcelRing(points, lat0, lon0, project) {
  const latlngs = points.map((pt) => project(pt, lat0, lon0));
  const ok = latlngs.every(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln));
  return ok ? { ok: true, latlngs } : { ok: false, latlngs: null };
}
