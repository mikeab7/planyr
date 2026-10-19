/* compSavePrep — the ONE pre-insert step every comp save path runs (NEW-2, owner report 2026-10-16).
 *
 * WHY THIS EXISTS: hand entry (CompsPanel's single-comp `save()` and the paste grid's
 * `saveGridRows`) linked a comp to a tracked market site, and a hand-dropped pin carried a county
 * resolved at pin-drop time — but the KML/KMZ import's promote path (CompDraftsPanel →
 * compDraftsStore.promoteDraft → insertComp) did neither, so all 34 comps imported from the owner's
 * "N Houston Lease Comps.xlsx" landed with `county = null` and no site. Three call sites each
 * carrying their own copy of "resolve the site" is how one of them came to be missing it, so the
 * rule now lives here and every path calls it.
 *
 * WHAT IT DOES, in order, and only ever ADDS:
 *   1. COUNTY — if the anchor has a lat/lon and no county, resolve it with the SAME lookup a
 *      hand-dropped pin uses (`resolveCountyForPoint`: the jurisdiction boundary answer, resolved
 *      WITH its state, on a 3 s race). A county already on the anchor is never overwritten; a miss
 *      leaves it null (the existing honest "no county" state) — never a guess.
 *   2. SITE — if the comp has no `projectId`, run `resolveOrCreateTrackedSiteForComp` (the same
 *      attach-to-a-nearby-site-else-mint-a-tracked-one rule, `compSiteMatch.js`). A failure never
 *      blocks the save; it is reported back so the caller can say so (LOUD-FAILURE).
 *
 * Both resolvers are injectable so the rule is unit-tested without a network or a site store.
 */

async function defaultResolveCounty(lat, lon) {
  const { resolveCountyForPoint } = await import("../../sitePlans/lib/overlayCompCounty.js");
  return resolveCountyForPoint(lat, lon);
}

async function defaultResolveSite(args) {
  // Dynamic import — keeps storage.js's whole site-model/cloud-sync graph off the comps chunk.
  const { resolveOrCreateTrackedSiteForComp } = await import("../../../workspaces/site-planner/lib/storage.js");
  return resolveOrCreateTrackedSiteForComp(args);
}

function hasPoint(anchor) {
  return !!anchor && typeof anchor.lat === "number" && typeof anchor.lon === "number" &&
    Number.isFinite(anchor.lat) && Number.isFinite(anchor.lon);
}

/** Returns `{ comp, site }` — `comp` is a NEW object (the input is never mutated) with
 * `anchor.county` and `projectId` filled where they were missing; `site` is
 * `null` (nothing to do) | `{ groupId, created, matched, matchedName?, matchedBy? }` |
 * `{ failed: true, message }`. Never throws. */
export async function prepareCompForSave(comp, { resolveCounty = defaultResolveCounty, resolveSite = defaultResolveSite } = {}) {
  if (!comp) return { comp, site: null };
  let next = { ...comp };
  const anchor = next.anchor;

  if (hasPoint(anchor) && !anchor.county) {
    let county = null;
    try { county = await resolveCounty(anchor.lat, anchor.lon); } catch (_) { county = null; }
    const { countyPending: _drop, ...rest } = anchor;
    next.anchor = county ? { ...rest, county } : { ...rest, county: null };
  } else if (anchor && "countyPending" in anchor) {
    const { countyPending: _drop, ...rest } = anchor;
    next.anchor = rest;
  }

  let site = null;
  if (!next.projectId && hasPoint(next.anchor)) {
    try {
      const resolved = await resolveSite({ title: next.title, lat: next.anchor.lat, lon: next.anchor.lon, county: next.anchor.county || null });
      if (resolved?.groupId) {
        next.projectId = resolved.groupId;
        site = resolved;
      } else if (resolved?.error) {
        site = { failed: true, message: resolved.error };
      }
    } catch (e) {
      site = { failed: true, message: "Couldn't link this comp to a site — saved without one. Pick a site from the dropdown." };
    }
  }
  return { comp: next, site };
}
