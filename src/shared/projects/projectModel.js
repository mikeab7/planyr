/* Project model — pure helpers shared by the header breadcrumb / project switcher.
 *
 * A "project" in Planyr is a Site Planner *site group* (one location, possibly many
 * plans). The breadcrumb lists one entry per group, newest-edited first. These
 * functions are intentionally dependency-free (no storage, no DOM, no React) so the
 * grouping/labeling logic can be unit-tested in the Node test runner and reused by
 * any workspace without dragging in the localStorage/Supabase chain.
 */

// Collapse a flat list of site-model records (each: { groupId|id, site|name,
// updatedAt, status }) into one project entry per group, sorted most-recently-edited
// first. The group's name/status/updatedAt come from its newest record (records are
// not assumed pre-sorted — we keep the max updatedAt and the name that goes with it).
export function groupProjects(records = []) {
  const byGroup = new Map();
  for (const s of records) {
    if (!s) continue;
    const id = s.groupId || s.id || null;
    if (!id) continue;
    const updatedAt = Number(s.updatedAt) || 0;
    const name = s.site || s.name || "Untitled site";
    const status = s.status || null;
    // Cross-module schedule link hint (schema v9): surface it on the project entry so the
    // breadcrumb's connectedness chip can show "has a schedule" without a second lookup. The
    // hint is mirrored identically across a group's plans, so any plan carrying it is enough.
    const scheduleProjectId = s.scheduleProjectId != null ? s.scheduleProjectId : null;
    const prev = byGroup.get(id);
    if (!prev) {
      byGroup.set(id, { id, name, updatedAt, status, scheduleProjectId });
    } else if (updatedAt >= prev.updatedAt) {
      // newer record wins the label + status; always keep the max timestamp and any link hint
      // found on any plan (a hint on an older plan shouldn't vanish behind a newer unlinked one).
      byGroup.set(id, { id, name, updatedAt, status: status || prev.status, scheduleProjectId: scheduleProjectId ?? prev.scheduleProjectId });
    } else if (scheduleProjectId != null && prev.scheduleProjectId == null) {
      prev.scheduleProjectId = scheduleProjectId;
    }
  }
  return [...byGroup.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

// Suggest a same-named counterpart for the "suggest-and-confirm" link flow (never auto-links).
// Normalizes punctuation/whitespace/case so "Pappadoupolos", "pappadoupolos", and
// "Pappadoupolos " all match. Returns the single unambiguous match, or null when there is no
// match OR more than one (an ambiguous set must be resolved by an explicit manual pick, not a
// guess). `exclude` skips an id that shouldn't match itself.
export function normalizeProjectName(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export function suggestNameMatch(name, list = [], { exclude = null } = {}) {
  const target = normalizeProjectName(name);
  if (!target) return null;
  const hits = (list || []).filter((p) => p && p.id !== exclude && normalizeProjectName(p.name) === target);
  return hits.length === 1 ? hits[0] : null;
}

// Resolve the header crumb's display name for the CURRENTLY-OPEN project (auto-update-name).
//
// The crumb name must track a live rename of the current project. Some workspaces (Review,
// Library) derive their `currentProject` prop from the route id and DON'T re-derive its name
// from the store when a rename happens in the switcher — so that prop goes stale while the
// dropdown's own (freshly refreshed) `projects` list already carries the new name. Prefer the
// list's name for the current project; fall back to the prop's name (cold/empty list, or a
// project not present in the list), so this is never a regression. Cross-tab renames (which
// also refresh the list) get the same live update for free.
export function resolveCurrentName(currentProject, projects = []) {
  if (!currentProject) return "";
  const hit = (projects || []).find((p) => p && p.id === currentProject.id);
  return (hit && hit.name) || currentProject.name || "";
}

// Case-insensitive name filter for the dropdown search field. Empty query → all.
export function filterProjects(projects = [], query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return projects;
  return projects.filter((p) => (p.name || "").toLowerCase().includes(q));
}

// Compact relative timestamp for the switcher rows ("just now", "5m ago", "3h ago",
// "2d ago", "3w ago", then a short calendar date for anything older than ~a month).
// `now` is injectable so the behavior is deterministic under test.
export function relTime(ts, now = Date.now()) {
  const t = Number(ts) || 0;
  if (!t) return "";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
