/* compSiteMatch.js — B1165441 (NEW-2/NEW-3, adversarial review of B1156864/PR 1424): the ONE rule
 * for "does an existing site already cover this comp's property, or does it need a new one?" Used
 * by `resolveOrCreateTrackedSiteForComp` (site-planner/lib/storage.js) whenever a comp is saved
 * with no owning site — the runtime mechanism the one-time backfill
 * (site-planner/db/site_role_unify_backfill_20260905.sql) never built: that script judged the
 * three comps that existed at migration time and stopped there, so every comp saved afterward with
 * no site picked landed with `project_id: null`, right back in the pre-migration state.
 *
 * Two independent, legible signals — never blended into one score (the review's own instruction:
 * "do not invent a fuzzy scoring system — pick something simple and legible"):
 *   1. LOCATION — the comp's pin sits within SITE_MATCH_MILES of an existing site's own origin.
 *      Same radius and the same haversine distance the one-time backfill used
 *      (site_role_unify_backfill_20260905.sql's LOCATION_MATCH_MILES), so a comp added today
 *      resolves exactly the way that migration would have judged it.
 *   2. NAME — the comp's title matches an existing site's name exactly, once both are normalized
 *      (shared/projects/projectModel.js's normalizeProjectName — the same "same name, different
 *      case/punctuation" rule the breadcrumb's link-suggestion flow already uses).
 * A location match always wins when one exists (the closest site); name match is the fallback,
 * tried only when no site is within range. That ordering is what lets Tesla - TGS DC4 and
 * Tesla - TGS 800K SF — about 2 miles apart, genuinely separate properties per the review's own
 * adjacent-case check — stay separate, while still letting an exact re-typed title (a second deal
 * on the SAME property, e.g. the owner's Airtex Building A/B case) find its site.
 *
 * `sites` passed in must include EVERY role (pursuit and tracked) and EVERY stage — a second deal
 * on a property that's currently only "tracked" (market intel from an earlier comp, nothing
 * pursued) must still attach to that same site rather than minting a duplicate.
 */
import { normalizeProjectName } from "../../projects/projectModel.js";

export const SITE_MATCH_MILES = 0.5;

const EARTH_RADIUS_MI = 3959;

export function milesBetween(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Find the best existing site (any role, any stage) for a comp being saved with no owning site.
 * `sites`: [{ id, groupId, site, name, origin: {lat, lon} | null }, …].
 * Returns { groupId, name, matchedBy: "location"|"name" } or null (no plausible match — the
 * caller mints a new tracked site). */
export function findMatchingSite({ lat, lon, title } = {}, sites = []) {
  let best = null; // { groupId, name, distanceMi }
  for (const s of sites || []) {
    if (!s) continue;
    const groupId = s.groupId || s.id;
    if (!groupId) continue;
    const origin = s.origin;
    const d = origin && typeof origin.lat === "number" && typeof origin.lon === "number"
      ? milesBetween(lat, lon, origin.lat, origin.lon)
      : null;
    if (d != null && d <= SITE_MATCH_MILES && (!best || d < best.distanceMi)) {
      best = { groupId, name: s.site || s.name || "", distanceMi: d };
    }
  }
  if (best) return { groupId: best.groupId, name: best.name, matchedBy: "location" };

  const normTitle = normalizeProjectName(title);
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
