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
    const prev = byGroup.get(id);
    if (!prev) {
      byGroup.set(id, { id, name, updatedAt, status });
    } else if (updatedAt >= prev.updatedAt) {
      // newer record wins the label + status; always keep the max timestamp
      byGroup.set(id, { id, name, updatedAt, status: status || prev.status });
    }
  }
  return [...byGroup.values()].sort((a, b) => b.updatedAt - a.updatedAt);
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
