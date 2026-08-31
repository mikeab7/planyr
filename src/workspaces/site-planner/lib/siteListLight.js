/* siteListLight.js — the LIGHTWEIGHT project list read (B927105).
 *
 * `shared/projects/projects.js`'s `listProjects()` — read on literally every workspace's header
 * (AppHeader -> ProjectBreadcrumb) for the project switcher/breadcrumb — only ever needs six
 * scalar fields per site record: id, groupId, site/name, siteRenamedAt, updatedAt, status,
 * scheduleProjectId/Name (see `projectModel.groupProjects` and `projectName.reconcileGroupNames`,
 * both pure and dependency-free). It never touches drawn geometry (els/parcels/markups/…).
 *
 * `storage.js`'s `loadSitesList()` normalizes every record through the full Site Model
 * (`createSiteModel`), which statically pulls the whole geometry-healing engine —
 * `siteModel.js` -> `roadGeometry.js`/`dockZones.js`/`dogEar.js`/`metesAndBounds.js`, plus
 * `cloudSync.js` -> `elementApi.js`/`elementSync.js` for the content-merge path — about 165 KB
 * that has nothing to do with a project's name or status. Because the breadcrumb renders on
 * every route, that engine rode every route's bundle even though only the Site Planner itself
 * ever needs it for real editing.
 *
 * This reads the SAME raw records (the SAME localStorage key, resolved the SAME way through
 * `activeUser.js`) and applies the SAME name-authority reconciliation, but skips the geometry
 * normalization entirely — so importing it costs none of that weight. `storage.js`'s own
 * `loadSitesList()` (used by the Site Planner itself, and by anything that needs the full
 * model) is UNCHANGED and still the source of truth for actually opening/editing a plan.
 *
 * ⛔ Do not import storage.js, siteModel.js, or cloudSync.js (or anything that does) from this
 * file — that is the entire point of the split. If a future caller needs more than these six
 * fields, that is a sign it needs the real `loadSitesList()`, not an extension of this one.
 */
import { activeUid, cloudSitesKey } from "./activeUser.js";
import { reconcileGroupNames } from "./projectName.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { DEFAULT_STATUS, LEGACY_STATUS, normStatus, isLegacyRecord } from "./siteStatus.js";

const SITES_KEY = "planarfit:sites:v1"; // legacy / logged-out store — mirrors storage.js's own key

function readRawSites() {
  const uid = activeUid();
  const key = uid ? cloudSitesKey(uid) : SITES_KEY;
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (_) { return {}; }
}

// The same six-ish scalar fields createSiteModel() defaults, and the same defaulting rules —
// so a caller of this light reader sees byte-identical values to what loadSitesList() would
// have handed it for these fields.
function projectSummaryOf(p) {
  return {
    id: p.id || null,
    groupId: p.groupId || p.id || null,
    site: p.site || p.name || "Untitled site",
    name: p.name || "Concept A",
    siteRenamedAt: typeof p.siteRenamedAt === "number" && isFinite(p.siteRenamedAt) && p.siteRenamedAt > 0 ? p.siteRenamedAt : null,
    updatedAt: p.updatedAt || 0,
    status: normStatus(p.status, isLegacyRecord(p) ? LEGACY_STATUS : DEFAULT_STATUS),
    scheduleProjectId: p.scheduleProjectId != null ? p.scheduleProjectId : null,
    scheduleProjectName: p.scheduleProjectName || null,
  };
}

/* The light equivalent of storage.js's loadSitesList(): every site record's identity/name/status
 * fields, name-authority reconciled (the same split-project-name fix loadSitesList() runs), newest
 * first. Never geometry-healed — callers that need the drawn content must use the real
 * loadSitesList()/loadSite(). */
export function loadSiteSummaries() {
  const raw = Object.values(readRawSites()).map(projectSummaryOf);
  const { models, ambiguous } = reconcileGroupNames(raw);
  for (const a of ambiguous) {
    try {
      reportClientEvent("project-name-ambiguous", "a project's plans disagree on its name and there is no majority — left unchanged", {
        groupId: a.groupId, names: (a.names || []).join(" | "), plans: a.plans,
      });
    } catch (_) {}
  }
  return models.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
