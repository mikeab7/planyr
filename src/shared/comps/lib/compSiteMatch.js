/* compSiteMatch.js — NEW-3 (adversarial review of B1156864, this branch): the matching rule that
 * decides whether a comp with no owning site should attach to an EXISTING site or needs a brand
 * new "tracked" one created for it.
 *
 * THE GAP THIS CLOSES: db/site_role_unify_backfill_20260905.sql (the one-time migration) created
 * one tracked site per unattached comp with NO dedupe at all — three comps produced three sites,
 * one each. That defeats the whole point of the site-role model: one property can carry several
 * deals (the owner's own example — his "Core 5 - West Hardy" comp is Building A on his Airtex
 * flyer; Building B on that same flyer has no comp yet, and when he adds one tomorrow it must
 * attach to the SAME site, not create a second "Core 5 - West Hardy").
 *
 * THE RULE IS DELIBERATELY SIMPLE AND LEGIBLE, not a fuzzy scoring system (the review's own
 * instruction): an EXACT title match wins outright (case/whitespace-insensitive); failing that,
 * the NEAREST existing site (any role — a comp can attach to a real pursuit project too, e.g. one
 * of his 60 named sites) within MATCH_RADIUS_MILES wins; failing that, there is no match and the
 * caller creates a new tracked site. MATCH_RADIUS_MILES reuses the exact constant the migration
 * used (0.5 mi — "same property, a slightly different pin"), so a comp saved today and the
 * historical backfill agree on what counts as "the same property."
 *
 * THE ADJACENT CASE THE REVIEW NAMED, so this isn't "fixed" by widening the radius later without
 * reading it again: the owner's two Tesla comps ("Tesla - TGS 800K SF" and "Tesla - TGS DC4") sit
 * about 2 km (~1.24 mi) apart — comfortably outside MATCH_RADIUS_MILES, so they correctly stay two
 * separate sites. Do not raise the radius to "fix" a false negative without re-checking that pair.
 *
 * Pure, dependency-free, Node-testable — no Supabase, no browser API.
 */

// Matches db/site_role_unify_backfill_20260905.sql's own LOCATION_MATCH_MILES exactly.
export const MATCH_RADIUS_MILES = 0.5;

// Great-circle distance in miles. Returns Infinity for any non-finite input so a malformed
// candidate can never win a "nearest" comparison by accident.
export function haversineMiles(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((v) => typeof v === "number" && isFinite(v))) return Infinity;
  const R = 3959; // Earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const normTitle = (s) => (s || "").trim().toLowerCase();

/* findMatchingSite(comp, sites) — comp: {title, lat, lon}; sites: site summaries carrying at
 * least {groupId, site, name, origin:{lat,lon}|null, updatedAt}. Any role — a comp may legitimately
 * attach to a real pursuit project, not only another tracked one.
 *
 * Returns { groupId, confidence: "exact-title" | "near", distanceMiles? } or null (no match — the
 * caller should create a new tracked site).
 *
 * "exact-title" is treated as high-confidence (the words match) and needs no owner-facing flag.
 * "near" is the one case the review calls out as UNCERTAIN — attach, but the caller should say so
 * (never silently guess), because it's picked by proximity alone. */
export function findMatchingSite(comp, sites) {
  const list = (sites || []).filter((s) => s && s.groupId);
  const title = normTitle(comp && comp.title);
  const hasLoc = comp && typeof comp.lat === "number" && typeof comp.lon === "number" && isFinite(comp.lat) && isFinite(comp.lon);

  if (title) {
    const titleMatches = list.filter((s) => normTitle(s.site) === title || normTitle(s.name) === title);
    if (titleMatches.length) {
      if (hasLoc) {
        const nearest = [...titleMatches].sort((a, b) => {
          const da = a.origin ? haversineMiles(comp.lat, comp.lon, a.origin.lat, a.origin.lon) : Infinity;
          const db = b.origin ? haversineMiles(comp.lat, comp.lon, b.origin.lat, b.origin.lon) : Infinity;
          return da - db;
        })[0];
        return { groupId: nearest.groupId, confidence: "exact-title" };
      }
      const newest = [...titleMatches].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      return { groupId: newest.groupId, confidence: "exact-title" };
    }
  }

  if (hasLoc) {
    let best = null;
    let bestD = Infinity;
    for (const s of list) {
      if (!s.origin) continue;
      const d = haversineMiles(comp.lat, comp.lon, s.origin.lat, s.origin.lon);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best && bestD <= MATCH_RADIUS_MILES) return { groupId: best.groupId, confidence: "near", distanceMiles: bestD };
  }

  return null;
}
