/* siteListLight.js — the LIGHTWEIGHT project list read (B927105).
 *
 * `shared/projects/projects.js`'s `listProjects()` — read on literally every workspace's header
 * (AppHeader -> ProjectBreadcrumb) for the project switcher/breadcrumb — only ever needs a
 * handful of scalar fields per site record: id, groupId, site/name, siteRenamedAt, updatedAt,
 * status, role, scheduleProjectId/Name (see `projectModel.groupProjects` and
 * `projectName.reconcileGroupNames`, both pure and dependency-free). It never touches drawn
 * geometry (els/parcels/markups/…).
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
import { snapshotIfCurrent } from "./sitesSnapshot.js";
import { reconcileGroupNames, renameStamp } from "./projectName.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { DEFAULT_STATUS, LEGACY_STATUS, normStatus, isLegacyRecord, normRole } from "./siteStatus.js";

const SITES_KEY = "planarfit:sites:v1"; // legacy / logged-out store — mirrors storage.js's own key

function sitesKeyNow() {
  const uid = activeUid();
  return uid ? cloudSitesKey(uid) : SITES_KEY;
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
    siteRenamedAt: renameStamp(p.siteRenamedAt),
    updatedAt: p.updatedAt || 0,
    status: normStatus(p.status, isLegacyRecord(p) ? LEGACY_STATUS : DEFAULT_STATUS),
    // B843792 (NEW-1) — role passthrough (pursuit vs tracked); see siteStatus.js.
    role: normRole(p.role),
    scheduleProjectId: p.scheduleProjectId != null ? p.scheduleProjectId : null,
    // ⛔ A write-once snapshot, not a live name (see siteModel.js's own field comment and
    // B1768080) — passed through here only for byte-identical parity with loadSitesList(). Its
    // ONE current consumer (`groupProjects` in projectModel.js) already drops it before anything
    // renders; a future caller that wants a display name should go through
    // `storage.scheduleLinkOf()`, which derives it from the group's own current name instead.
    scheduleProjectName: p.scheduleProjectName || null,
  };
}

/* The light equivalent of storage.js's loadSitesList(): every site record's identity/name/status
 * fields, name-authority reconciled (the same split-project-name fix loadSitesList() runs), newest
 * first. Never geometry-healed — callers that need the drawn content must use the real
 * loadSitesList()/loadSite(). */
/* ⛔ NEW-1 (B217540 ×3 / B1317824 ×3) — THIS READ IS MEMOISED ON THE STORE'S EXACT BYTES, NOT ON A CLOCK.
 * `usePlanName` / `useProjectName` (shared/names) and the header's project switcher reach this on every render, and the
 * names index in front of it only holds for 2 s — so an editing session re-parsed the ENTIRE device store (every plan, a
 * 3.9 MB store is ~40 MB of fresh objects) about every other second, plus the name-authority pass over all of it. That is
 * the recurring parse in the owner's 2026-10-07 capture, and the garbage behind its heap climbing 157 → 399 MB in 8 s.
 * Nothing it reads can change unless the string in `localStorage` changes, so the string IS the cache key: while it is
 * byte-for-byte what it was, the answer is too (a pure function of it and of the active account, which is in the key). Any
 * other writer — a rename, a cloud pull, another tab — changes the bytes and the real read runs. Callers get FLAT COPIES of
 * the summaries, as they always got fresh objects, so none can corrupt the memo. */
let summariesMemo = null;   // { key, raw, models }
export function loadSiteSummaries() {
  const key = sitesKeyNow();
  let rawStr = null;
  try { rawStr = localStorage.getItem(key); } catch (_) { rawStr = null; }
  if (summariesMemo && summariesMemo.key === key && summariesMemo.raw === rawStr) return summariesMemo.models.map((m) => ({ ...m }));
  /* …and when the bytes DID change, it is usually because this very tab just saved a plan, and storage.js is holding the
   * object it wrote: take that (byte-exact proof, read-only) instead of parsing the whole store again. */
  const held = snapshotIfCurrent(key, rawStr);
  let parsed = {};
  if (held) parsed = held.obj;
  else { try { parsed = JSON.parse(rawStr) || {}; } catch (_) { parsed = {}; } }
  const raw = Object.values(parsed).map(projectSummaryOf);
  const { models, ambiguous } = reconcileGroupNames(raw);
  for (const a of ambiguous) {
    try {
      reportClientEvent("project-name-ambiguous", "a project's plans disagree on its name and there is no majority — left unchanged", {
        groupId: a.groupId, names: (a.names || []).join(" | "), plans: a.plans,
      });
    } catch (_) {}
  }
  const sorted = models.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  summariesMemo = { key, raw: rawStr, models: sorted };
  return sorted.map((m) => ({ ...m }));
}
