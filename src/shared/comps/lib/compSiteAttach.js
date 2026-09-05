/* compSiteAttach.js — NEW-2/NEW-3 (adversarial review of B1156864, this branch): the runtime
 * mechanism the one-time backfill migration never built. db/site_role_unify_backfill_20260905.sql
 * gave the THREE pre-existing comps an owning site; nothing in the app gave the NEXT one — saving
 * a comp with `project_id` still null left the owner exactly back in the pre-migration state.
 *
 * `resolveOwningSite(comp, opts)` is called before every comp INSERT that has no explicit
 * `projectId` (the owner never picked one from the dropdown). It never runs for an UPDATE of an
 * already-attached comp, and never overrides an explicit choice — the existing project dropdown
 * stays the way to REASSIGN a comp, exactly as it was before this change.
 *
 * Resolution order, each one deterministic given its inputs (no fuzzy scoring, per the review's
 * own instruction):
 *   1. Explicit `projectId` already set → untouched, return null (nothing to resolve).
 *   2. Anchored to a site plan overlay → that overlay's OWN owning project. Zero ambiguity: the
 *      overlay already belongs to a site, so a comp pinned to a point on it belongs there too.
 *   3. Otherwise (a 'pin' or 'parcel' anchor, which always carries lat/lon) → compSiteMatch.js's
 *      exact-title-or-nearest-within-radius rule, over every live site (any role) this account
 *      has.
 *   4. No match → create a brand-new "tracked" site from the comp's own location + title
 *      (storage.js's createTrackedSite — the exact shape the migration itself used).
 *
 * `storage.js` is reached only through a DYNAMIC import — this module lives in `shared/comps/`,
 * which is workspace-agnostic on purpose (its own docstring: "self-contained-data-owner shape"),
 * and `storage.js` statically pulls the whole ~165 KB site-model/cloud-sync engine. `projects.js`
 * already established this exact idiom for every write path it reaches into storage.js for — this
 * mirrors it rather than inventing a second convention.
 */
import { loadSiteSummaries } from "../../../workspaces/site-planner/lib/siteListLight.js";
import { findMatchingSite } from "./compSiteMatch.js";

const storageEngine = () => import("../../../workspaces/site-planner/lib/storage.js");

/* Returns null when there is nothing to resolve (an explicit projectId is already set — never
 * overridden). Otherwise resolves to { projectId, confidence } where confidence is one of:
 *   "site-plan"   — the overlay's own owning project; no ambiguity.
 *   "exact-title" — an existing site's name matched the comp's title exactly.
 *   "near"        — the nearest existing site within MATCH_RADIUS_MILES; picked by proximity
 *                   alone, so the caller should tell the owner (NEW-3: "attach and say so").
 *   "created"     — no existing site plausibly matched; a new tracked site was created.
 * A "created" resolution additionally carries `createdSite: true` so the caller can phrase its
 * confirmation differently from an attach. */
export async function resolveOwningSite(comp, { overlaysById } = {}) {
  if (!comp || comp.projectId) return null;

  const anchor = comp.anchor || {};
  if (anchor.kind === "site_plan" && anchor.sitePlanOverlayId) {
    const ov = overlaysById && overlaysById[anchor.sitePlanOverlayId];
    if (ov && ov.projectId) return { projectId: ov.projectId, confidence: "site-plan", siteLabel: ov.docTitle || null };
  }

  const matchInput = { title: comp.title, lat: anchor.lat, lon: anchor.lon };
  const sites = loadSiteSummaries();
  const match = findMatchingSite(matchInput, sites);
  if (match) {
    const site = sites.find((s) => s.groupId === match.groupId);
    return { projectId: match.groupId, confidence: match.confidence, distanceMiles: match.distanceMiles, siteLabel: site ? (site.site || site.name) : null };
  }

  const { createTrackedSite } = await storageEngine();
  const created = await createTrackedSite({
    site: comp.title,
    county: anchor.county,
    lat: anchor.lat,
    lon: anchor.lon,
  });
  if (!created || !created.ok) return null;
  return { projectId: created.id, confidence: "created", createdSite: true, siteLabel: (comp.title && comp.title.trim()) || "Tracked property" };
}

/* A short, owner-facing sentence for the "attach and say so" cases (NEW-3) — never for
 * "site-plan" or "exact-title", which need no flag (deterministic / same words). */
export function autoAttachNote(resolution) {
  if (!resolution || !resolution.siteLabel) return null;
  if (resolution.confidence === "near") {
    const dist = typeof resolution.distanceMiles === "number" ? ` (~${resolution.distanceMiles.toFixed(2)} mi away)` : "";
    return `Attached to the nearest existing site, "${resolution.siteLabel}"${dist} — not the same property? Use the Project dropdown above to reassign.`;
  }
  if (resolution.createdSite) {
    return `No existing site matched, so a new tracked site "${resolution.siteLabel}" was created for this comp.`;
  }
  return null;
}
