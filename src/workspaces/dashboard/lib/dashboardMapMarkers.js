/* dashboardMapMarkers — pure derivation for the Dashboard's Locations map card (NEW-1, owner
 * chat block 2026-09-08: "a new dashboard card that shows where everything is on a map").
 *
 * Three marker weights, per the brief: ACTIVE projects (status "active") read loudest as filled
 * pins; PURSUITS (status "pursuit" or "onhold" — still open, not yet won) read as lighter hollow
 * rings; COMPS (market comparables) are quiet unlabeled dots. Complete/dead projects and
 * role:"tracked" market records are settled or reference-only, not open pipeline — they don't
 * plot here, the same open-pipeline boundary the Pursuits/Going-quiet cards already draw
 * (dashboardPipeline.js's own OPEN_STATUSES).
 *
 * Kept pure and Leaflet-free so the marker/count logic is unit-testable without a browser — the
 * map component consumes this, never re-derives it.
 */

import { shortenDisplayName } from "../../../shared/projects/projectModel.js";

// B1407824 — a pin's own label plate has no fixed width (LocationsMapCard.jsx's divIcon markup
// carries no max-width/overflow rule), so an unshortened long name would run the plate off the
// map's edge or straight into a neighbouring pin. Shortened here, once, so the label paint AND
// its own width-collision math (labelBoxFor in LocationsMapCard.jsx) measure the same string.
const MAP_LABEL_MAX_CHARS = 22;

const ACTIVE_STATUSES = new Set(["active"]);
const OPEN_STATUSES = new Set(["active", "pursuit", "onhold"]);

function hasOrigin(o) {
  return !!o && Number.isFinite(o.lat) && Number.isFinite(o.lon);
}

/** `projects` — groupProjectsByGroupId() output. The open-pipeline subset (role !== "tracked",
 * status active/pursuit/onhold) this card cares about — both for plotting and for counting what
 * is missing a location. */
export function openPipelineProjects(projects) {
  return (projects || []).filter((p) => p.role !== "tracked" && OPEN_STATUSES.has(p.status));
}

/** The map's marker list: one entry per LOCATED open project/pursuit, plus one per located comp.
 * `kind` is "active" | "pursuit" | "comp" — the three weights. Anything without a usable lat/lon
 * is left out here (never silently counted as drawn) — see missingLocationCount for its own,
 * explicit accounting. `displayPoints` — optional { [groupId]: {lat, lon} } from
 * dashboardParcelAnchors.displayPointsByGroup. */
export function mapMarkers(projects, comps, displayPoints) {
  const out = [];
  for (const p of openPipelineProjects(projects)) {
    if (!hasOrigin(p.origin)) continue;
    // B-NEW-1 — the pin sits at the parcel's inside point (dashboardParcelAnchors.js, the Site tab
    // map's helper) when one has been derived; a site with no boundary keeps its saved origin.
    const at = displayPoints && displayPoints[p.groupId];
    const pt = hasOrigin(at) ? at : p.origin;
    out.push({
      kind: ACTIVE_STATUSES.has(p.status) ? "active" : "pursuit",
      id: p.groupId, lat: pt.lat, lon: pt.lon, name: shortenDisplayName(p.name, MAP_LABEL_MAX_CHARS), project: p,
    });
  }
  for (const c of comps || []) {
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    out.push({ kind: "comp", id: c.id, lat: c.lat, lon: c.lon });
  }
  return out;
}

/** How many open projects/pursuits have no usable location — the quiet accounting line, never
 * silently dropped. */
export function missingLocationCount(projects) {
  return openPipelineProjects(projects).filter((p) => !hasOrigin(p.origin)).length;
}
