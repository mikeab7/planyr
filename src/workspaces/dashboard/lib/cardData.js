/* cardData.js — the Dashboard's own per-card async data loaders (B1196305, NEW-2).
 *
 * Every function here is called from its card's own effect (never at module scope, never from
 * render) and returns a plain data object the card renders — no card ever hardcodes a number.
 *
 * BUNDLE NOTE (measured, kept on record so the next session doesn't re-litigate it): every
 * cross-workspace module this file needs — the comps store, the doc-review review list, the
 * Supabase client itself — is reached ONLY via a dynamic `import()`, the same seam
 * `resolveOrCreateTrackedSiteForComp` uses (see src/shared/CLAUDE.md's comps/ section). Dashboard
 * is the Site route's SECOND consumer of the comps module in particular; a static import here
 * would re-key ~40KB out of the Site-route-only bundle into a shared chunk. `loadSiteSummaries`
 * (siteListLight.js) is the one exception — it's already a small, dependency-free leaf shared by
 * every workspace's breadcrumb, so a static import costs nothing new.
 */
import { loadSiteSummaries } from "../../site-planner/lib/siteListLight.js";
import { readLastRoute } from "../../../app/lastRoute.js";
import { pipelineCounts } from "./pipelineCounts.js";
import { pursuitsByCounty } from "./pursuitsByCounty.js";
import { goingQuietPursuits } from "./goingQuiet.js";
import { summarizeScheduleHealth, unassignedOverdueTasks } from "./scheduleHealthPure.js";

const PLANAR_DATA_KEY = "hs-v1";

/* `userId` comes straight from Shell's own auth state (the same prop every other workspace
 * already receives, e.g. Notes.jsx) — a null userId skips the network round trip entirely
 * rather than duplicating an auth check this file has no business owning. */
async function loadScheduleProjects(userId) {
  if (!userId) return { projects: {}, signedOut: true };
  const { supabase } = await import("../../site-planner/lib/supabase.js");
  if (!supabase) return { projects: {}, signedOut: true };
  const { data, error } = await supabase.from("planar_data").select("value").eq("key", PLANAR_DATA_KEY).maybeSingle();
  if (error || !data) return { projects: {}, signedOut: false };
  const value = data.value || {};
  return { projects: (value && value.projects) || {}, signedOut: false };
}

/** Pipeline counts by status (incl. tracked market records) — live siteListLight data. */
export function loadPipelineCounts() {
  return pipelineCounts(loadSiteSummaries());
}

/** Pursuits by activity, grouped by county with project + plan counts. */
export function loadPursuitsByCounty() {
  return pursuitsByCounty(loadSiteSummaries());
}

/** Live pursuits untouched for 30+ days (Complete/Dead excluded). */
export function loadGoingQuiet() {
  return goingQuietPursuits(loadSiteSummaries());
}

/** Per-schedule complete/overdue/at-risk tallies, from the Schedule's own saved document. */
export async function loadScheduleHealth(userId) {
  const { projects, signedOut } = await loadScheduleProjects(userId);
  return { rows: summarizeScheduleHealth(projects), signedOut };
}

/** Unassigned, overdue tasks across every schedule. */
export async function loadNeedsAnOwner(userId) {
  const { projects, signedOut } = await loadScheduleProjects(userId);
  return { rows: unassignedOverdueTasks(projects), signedOut };
}

/** "Jump back in" — the last-route pointer, resolved to a readable project name where possible,
 * plus the newest Document Review file. */
export async function loadJumpBackIn() {
  const last = readLastRoute();
  let projectName = null;
  if (last && last.projectId) {
    const match = loadSiteSummaries().find((s) => s.groupId === last.projectId || s.id === last.projectId);
    projectName = match ? (match.name || match.site) : null;
  }
  let newestReview = null;
  try {
    const { listReviews } = await import("../../doc-review/lib/reviewStore.js");
    const rows = await listReviews();
    newestReview = rows && rows.length ? rows[0] : null;
  } catch (_) { /* doc-review chunk unreachable — the card just omits this half */ }
  return { lastRoute: last, projectName, newestReview };
}

/** Comps summary lines (land/building-sale $/SF averages) — the existing pure summarizer over a
 * live Supabase read. */
export async function loadCompsSummary() {
  try {
    const [{ fetchAllComps }, { compsSummaryBits }] = await Promise.all([
      import("../../../shared/comps/lib/compsStore.js"),
      import("../../../shared/comps/lib/comps.js"),
    ]);
    const { data, error } = await fetchAllComps();
    if (error) return { lines: [], count: 0, error: error.message || String(error) };
    return { lines: compsSummaryBits(data || []), count: (data || []).length };
  } catch (e) {
    return { lines: [], count: 0, error: (e && e.message) || "Comps unavailable" };
  }
}
