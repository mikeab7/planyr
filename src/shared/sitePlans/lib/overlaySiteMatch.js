/* overlaySiteMatch.js — B1167712 (NEW-1, owner correction 2026-09-07, after the owner pushed back
 * on this item's first draft). The first draft reused `shared/comps/lib/compSiteMatch.js`'s
 * SITE_MATCH_MILES (0.5 mi) centroid-to-centroid radius verbatim for a site plan. That radius is
 * calibrated for a COMP — a single point — and does not transfer to a site plan, which is a
 * DRAWING THAT COVERS AREA: the owner's own Airtex plan measures 3,000 x 3,882 ft on the ground
 * (0.568 mi x 0.735 mi), so its own corner sits 0.465 mi from its own centroid — essentially AT
 * the comp radius already. Two neighbouring properties each carrying a plan that size fall inside
 * each other's 0.5 mi centroid-to-centroid circle trivially; a fixed, point-calibrated radius
 * only gets WORSE the bigger the plan, which is the opposite of what a bigger plan should do to
 * its own match confidence.
 *
 * THE RULE, chosen and justified (not silently re-derived from the comp radius): does an existing
 * site's own recorded point fall ON THE GROUND THIS PLAN ACTUALLY DRAWS — inside the plan's own
 * placed rectangle (center/ft_per_px/rotation_deg — the exact same direct placement the map
 * renders it at, reusing `latLonToImagePoint` from overlayPlacement.js rather than a second
 * projection), padded by a small FIXED buffer in FEET (SITE_MATCH_BUFFER_FT), never a fraction of
 * the plan's own size. A fixed buffer is the point: a bigger plan's footprint reaches further
 * because it genuinely covers more ground, not because of a size-scaled fudge factor that would
 * reintroduce the exact "bigger plan, bigger blast radius" problem this module exists to close.
 * Falls back to the SAME exact normalized-title match `compSiteMatch.js` uses
 * (`normalizeProjectName`) when no site's point falls inside the drawing at all — a title match
 * carries no size assumption, so it needed no rework.
 *
 * ⛔ A MATCH FROM THIS MODULE NEVER STICKS SILENTLY. It is a SUGGESTION the caller writes as
 * `site_plan_overlays.project_id` and shows, live and editable, on the plan itself (the "Site"
 * control in SitePlansSection.jsx) — never a fact the owner can't see or undo. Once he has
 * explicitly detached a plan from a site, `site_link_declined`
 * (site_plan_overlays_site_link.sql) stops this module from being asked again for that overlay
 * until he re-attaches by hand; that gate lives in the caller (SitePlansSection.jsx's reload
 * sweep), not here — this module only ever answers "what does the geometry suggest," never
 * "should I act on it."
 */
import { normalizeProjectName } from "../../projects/projectModel.js";
import { latLonToImagePoint } from "../../overlay/overlayPlacement.js";

export const SITE_MATCH_BUFFER_FT = 300;

/** Does (lat, lon) land inside `overlay`'s own drawn rectangle, padded by SITE_MATCH_BUFFER_FT? */
function pointInsideOverlayFootprint(overlay, lat, lon) {
  if (!(overlay.ftPerPx > 0) || !(overlay.imgW > 0) || !(overlay.imgH > 0)) return false;
  const p = latLonToImagePoint(overlay, overlay.imgW, overlay.imgH, lat, lon);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  const bufferPx = SITE_MATCH_BUFFER_FT / overlay.ftPerPx;
  return p.x >= -bufferPx && p.x <= overlay.imgW + bufferPx && p.y >= -bufferPx && p.y <= overlay.imgH + bufferPx;
}

/** Find the best existing site for a PLACED overlay with no site of its own. `sites`: every role,
 * every stage (the same scope compSiteMatch.js's findMatchingSite uses) — `[{ id, groupId, site,
 * name, origin: {lat, lon} | null }, …]`. Returns { groupId, name, matchedBy: "footprint"|"name" }
 * or null (no plausible match — the caller mints a new tracked site, exactly as an unmatched comp
 * does). Footprint containment wins outright when more than one site's point falls inside the
 * drawing (closest to the plan's own center); the title fallback only runs when nothing does. */
export function findMatchingSiteForOverlay(overlay, sites = []) {
  let best = null; // { groupId, name, distanceDeg }
  for (const s of sites || []) {
    if (!s) continue;
    const groupId = s.groupId || s.id;
    if (!groupId) continue;
    const origin = s.origin;
    if (!origin || typeof origin.lat !== "number" || typeof origin.lon !== "number") continue;
    if (!pointInsideOverlayFootprint(overlay, origin.lat, origin.lon)) continue;
    // A same-units tie-breaker only (degrees, not feet/miles) — picking among several candidate
    // sites that are ALL already inside the same drawing, never a pass/fail threshold on its own.
    const d = Math.hypot(origin.lat - overlay.centerLat, origin.lon - overlay.centerLon);
    if (!best || d < best.distanceDeg) best = { groupId, name: s.site || s.name || "", distanceDeg: d };
  }
  if (best) return { groupId: best.groupId, name: best.name, matchedBy: "footprint" };

  const normTitle = normalizeProjectName(overlay.docTitle);
  if (!normTitle) return null;
  for (const s of sites || []) {
    if (!s) continue;
    const groupId = s.groupId || s.id;
    if (!groupId) continue;
    const name = s.site || s.name || "";
    if (normalizeProjectName(name) === normTitle) return { groupId, name, matchedBy: "name" };
  }
  return null;
}
