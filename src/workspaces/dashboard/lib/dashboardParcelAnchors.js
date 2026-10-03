/* dashboardParcelAnchors — the Locations map's pin point, from the SAME helper the Site tab's map
 * uses (site-planner/lib/siteAnchor.js `siteAnchorLatLon`: pole of inaccessibility, largest part,
 * never in a hole). B-NEW-1 (owner chat block 2026-10-03), amending B1988816.
 *
 * WHY THIS EXISTS: dashboard project rows carry only the saved `origin` (the frame the plan was
 * created around), which on an irregular parcel (Katz, Rankin Rd) can sit in a notch, on the
 * neighbours' lots. Parcel shapes live in `site_elements` rows (kind='parcel') and are fetched
 * separately (dashboardParcelFetch.js) for just the plotted projects' representative plans.
 *
 * Pure: no network, no Leaflet. The stored origin is never rewritten; a project with no parcel
 * rows simply gets no entry and the marker falls back to its origin (dashboardMapMarkers.js).
 * Computed ONCE per fetch (the helper also memoises per ring), never per render / per zoom.
 */
import { siteAnchorLatLon } from "../../site-planner/lib/siteAnchor.js";

/** `projects` — groupProjectsByGroupId() output; `parcelRows` — [{site_id, data}] where data is a
 * parcel object verbatim. Returns { [groupId]: {lat, lon} } for projects whose geometry yielded a
 * point; omitted otherwise (origin fallback). */
export function displayPointsByGroup(projects, parcelRows) {
  const bySite = new Map();
  for (const r of parcelRows || []) {
    if (!r || !r.site_id || !r.data) continue;
    const list = bySite.get(r.site_id);
    if (list) list.push(r.data); else bySite.set(r.site_id, [r.data]);
  }
  const out = {};
  for (const p of projects || []) {
    const parcels = bySite.get(p.siteId);
    if (!parcels || !p.origin) continue;
    const a = siteAnchorLatLon({ origin: p.origin }, parcels);
    if (a && a.source === "geometry") out[p.groupId] = { lat: a.lat, lon: a.lon };
  }
  return out;
}
