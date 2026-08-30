/* Admin "County criteria requests" section (B877442) — the read + cross-reference half of
 * B877440/B877441's request queue. Pure logic only; the component (CriteriaRequestsSection.jsx)
 * owns the RPC call and the render.
 *
 * "Wired" (criteria have since landed for this county) can't be answered by the database — the
 * criteria_requests table has no way to know what DETENTION_CRITERIA / DEFAULT_EASEMENT_RULES /
 * DEFAULT_POND_CRITERIA / COUNTY_AUTHORITY carry in THIS deploy. So the admin app cross-references
 * the raw request rows against a copy of the same modeled-county lists the app itself routes
 * against (detentionRules.COUNTY_AUTHORITY's keys; easementRules.MODELED_COUNTIES).
 *
 * ⛔ DELIBERATELY DUPLICATED, not imported — the shared/CLAUDE.md `releaseCanvas.js` precedent:
 * "a module reachable from both routes gets hoisted into its own chunk and breaches the Site
 * route's chunk budget; keep the two identical." Importing detentionRules.js/easementRules.js
 * here (the admin route, a separate lazy chunk) pulled both modules out of SitePlannerApp's own
 * chunk into a new ~120 KB shared chunk the PLAIN SITE ROUTE then had to load too — measured via
 * `node ui-audit/perf-bundle-audit.mjs`, which failed `bundle.siteRouteAllowlist` on exactly this.
 * Keep this list in sync BY HAND when either source list changes — cheap and rare, versus a
 * standing bundle cost on every Site load for a page only the owner ever opens. */
const DETENTION_MODELED_COUNTIES = ["harris", "fortbend", "montgomery", "chambers", "waller"];
const EASEMENT_MODELED_COUNTIES = ["harris", "fortbend"];
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");
const MODELED_BY_FAMILY = {
  detention: DETENTION_MODELED_COUNTIES,
  pond: DETENTION_MODELED_COUNTIES,
  floodplain: DETENTION_MODELED_COUNTIES,
  easement: EASEMENT_MODELED_COUNTIES,
};

/* Is this (county, family) pair modeled in the current deploy? Pure. */
export function isWired(countyKey, family) {
  const list = MODELED_BY_FAMILY[family];
  if (!list) return false;
  return list.includes(norm(countyKey));
}

/* Shape the RPC's raw rows for the page: adds `wired`, sorts outstanding (not yet wired) first
 * so a fixed county drops toward the bottom instead of cluttering the top of the queue, then by
 * request count (most-requested first) within each group. Pure — `rows` is admin_list_criteria_
 * requests()'s result as-is. */
export function prepareCriteriaRequestRows(rows) {
  return (rows || [])
    .map((r) => ({ ...r, wired: isWired(r.county_key, r.family) }))
    .sort((a, b) => (a.wired === b.wired ? b.request_count - a.request_count : a.wired ? 1 : -1));
}
