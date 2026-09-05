/* Project model — pure helpers shared by the header breadcrumb / project switcher.
 *
 * A "project" in Planyr is a Site Planner *site group* (one location, possibly many
 * plans). The breadcrumb lists one entry per group, newest-edited first. These
 * functions are intentionally dependency-free (no storage, no DOM, no React) so the
 * grouping/labeling logic can be unit-tested in the Node test runner and reused by
 * any workspace without dragging in the localStorage/Supabase chain.
 */

// How long a deleted project stays in the "Recently deleted" bin before it's purged for good.
// Canonical here (a pure, dependency-free constant) rather than in storage.js, so a caller that
// only needs the NUMBER — the breadcrumb's confirmation copy — never has to import the engine
// that owns the delete itself (B927105). storage.js imports it from here.
export const DELETED_RETENTION_DAYS = 30;

// B1202176 — Shell.jsx's route-level deletion gate (B848833) asks one honest question — does
// this project id's cloud row exist, and if so is it soft-deleted? — and that question cannot
// tell "nobody has ever created this row" apart from "this row was just created LOCALLY and
// hasn't reached the cloud yet." Both answer the identical `{exists:false}`. Project creation is
// deliberately LAZY (see SitePlannerApp.jsx's `newBlankSite`): a blank site that's never edited
// is never saved, and even a located blank's cloud write is a fire-and-forget push racing the
// very check that would block it. So the gate's caller (Shell.jsx) tracks which ids it minted
// locally this session — `freshlyCreated` — and this function is the ONE place that decides what
// the DB's answer means once that context is folded in. Pure so the decision is unit-tested
// directly, without rendering Shell.jsx's very large component tree.
export function projectGateStatus({ res, freshlyCreated = false } = {}) {
  if (!res || res.ok === false) return { status: "live", name: null, deletedAt: null }; // fail OPEN — an inconclusive answer never blocks
  if (!res.exists) return { status: freshlyCreated ? "live" : "missing", name: null, deletedAt: null };
  if (res.deleted) return { status: "deleted", name: res.name, deletedAt: res.deletedAt };
  return { status: "live", name: null, deletedAt: null };
}

/* B1202176 (extended) — `freshProjectIdsRef` above (Shell.jsx's copy) only survives THIS TAB'S
 * mount: it is a plain in-memory Set, so it resets to empty on a bare-domain reload — the exact
 * moment `lastRoute.js`'s restore-where-I-left-off pointer fires. A brand-new, never-edited
 * project (see SitePlannerApp.jsx's `newBlankSite` — a fully blank "New project" click saves
 * NOTHING, locally or to the cloud, until the first draw) writes its id into `lastRoute` the
 * instant the route changes (Shell.jsx's own `writeLastRoute(route)` effect), well before that
 * first draw. Close the tab (or just reload) before drawing anything, and the next bare-domain
 * boot restores a pointer to an id this device minted but the in-memory ref has already
 * forgotten — the identical `{exists:false}` answer, now with `freshlyCreated` back to false, so
 * it reads "missing" again: the owner's live repro (`smtouazufbss`, no row anywhere, restored
 * straight off `lastRoute`).
 *
 * This is a small, capped, localStorage-backed twin of that in-memory Set — the part of
 * "freshly minted" that must outlive a reload. It is a HINT, never load-bearing user data (a
 * real project's existence is always decided by the cloud row / `res.exists` first — see
 * `projectGateStatus` above, which checks `!res.exists` before `freshlyCreated` is ever
 * consulted), so it is fine for the oldest entries to fall off a cap; nothing here needs an
 * explicit "clear on success" — once a project's row exists, `res.exists` is true and this list
 * is never even asked. */
const FRESH_PROJECT_KEY = "planyr:freshProjects:v1";
const FRESH_PROJECT_CAP = 25;

export function markProjectFreshlyMinted(id) {
  if (!id || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(FRESH_PROJECT_KEY);
    const prev = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(prev) ? prev.filter((x) => x !== id) : [];
    ids.push(id);
    localStorage.setItem(FRESH_PROJECT_KEY, JSON.stringify(ids.slice(-FRESH_PROJECT_CAP)));
  } catch (_) { /* storage unavailable/quota — a hint, never blocks project creation */ }
}

export function wasProjectFreshlyMinted(id) {
  if (!id || typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(FRESH_PROJECT_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) && ids.includes(id);
  } catch (_) { return false; }
}

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
    // B843792 (NEW-1) — role (pursuit vs tracked), carried the same way status is: the newest
    // record in the group wins. Not filtered here — callers that need "pursuit only" (the Sites
    // list) filter on it explicitly; this function still reports every group.
    const role = s.role || null;
    // Cross-module schedule link hint (schema v9): surface it on the project entry so the
    // breadcrumb's connectedness chip can show "has a schedule" without a second lookup. The
    // hint is mirrored identically across a group's plans, so any plan carrying it is enough.
    const scheduleProjectId = s.scheduleProjectId != null ? s.scheduleProjectId : null;
    const prev = byGroup.get(id);
    if (!prev) {
      byGroup.set(id, { id, name, updatedAt, status, role, scheduleProjectId });
    } else if (updatedAt >= prev.updatedAt) {
      // newer record wins the label + status/role; always keep the max timestamp and any link
      // hint found on any plan (a hint on an older plan shouldn't vanish behind a newer unlinked one).
      byGroup.set(id, { id, name, updatedAt, status: status || prev.status, role: role || prev.role, scheduleProjectId: scheduleProjectId ?? prev.scheduleProjectId });
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

// B853266/NEW-1 — ensure the routed/currently-open project is present in the switcher's list
// even when the on-device cache hasn't caught up with the cloud yet (a stale/diverged pull can
// leave an actively-worked project missing from `listProjects()` while the user is standing in
// it). A union, never a swap: every entry the caller already has passes through untouched, and a
// synthetic entry is added ONLY when the current project isn't already present.
export function withCurrentProject(projects = [], currentProject = null) {
  if (!currentProject || !currentProject.id) return projects;
  if ((projects || []).some((p) => p && p.id === currentProject.id)) return projects;
  return [
    { id: currentProject.id, name: currentProject.name || "Untitled site", updatedAt: Date.now(), status: null, scheduleProjectId: null },
    ...(projects || []),
  ];
}

// B854xxx/NEW-2 — Scheduler is the only controlled caller of the breadcrumb (its embedded Gantt
// app bridges its OWN project list — schedule-only pseudo-projects like Pursuits/Operations that
// carry no site id at all), and that bridged list was the WHOLE switcher on that route: no
// timestamps, no current-project guarantee, no recently-deleted bin, because those all come from
// the real site registry `internalProjects` builds and controlled mode skipped it entirely. This
// is the union that makes a controlled switcher show the same real projects every other route
// shows, while keeping the schedule-only entries a site lookup can never produce. Registry entries
// win on a shared id (richer: name/timestamp/status); a controlled entry with no matching registry
// id is appended after, so real projects still sort first.
//
// ⛔ B881666 — A CONTROLLED ENTRY'S OWN `id` IS NEVER THE SAME NAMESPACE AS A REGISTRY id, SO
// "a shared id" NEVER ACTUALLY HAPPENED — a linked schedule and its site share a project through
// `linkedSiteId`, not through `id === id`. Every linked schedule (not just the routed one)
// therefore fell straight into `extra` beside its own registry row: two rows, same name, one
// with a real timestamp (the registry copy) and one without (the bridged copy has none). A
// controlled entry whose `linkedSiteId` names a project already covered by a registry row
// describes the SAME real project and is dropped — the registry copy (richer data) is the one
// shown; the caller resolves a click on it back to the right schedule id (see Scheduler.jsx's
// `selectSchedule`). Only a controlled entry with no site at all (Operations, Pursuits) — or one
// whose linked site genuinely isn't in the registry yet — still appears via `extra`.
//
// ⛔ B1112449/NEW-2 — THAT "DROP THE BRIDGED COPY, THE REGISTRY ROW COVERS IT" RULE ASSUMED AT
// MOST ONE SCHEDULE PER SITE. B1080547 (same day, same PR) removed that constraint elsewhere
// (`findAllBySiteId`/`isGridMismatched`/`needsScheduleCarryIn` all test the FULL linked set now)
// but this function was never revisited, so a site with TWO linked schedules had BOTH of their
// bridged copies dropped — `byId.has(p.linkedSiteId)` is true for either one — leaving exactly
// ONE selectable row (the site's own registry row) no matter how many schedules it actually
// carries. Clicking that lone row passes the SITE's id to `selectSchedule`, which could only
// resolve it back to the first-created schedule (`.find()`), so every schedule after the first
// was a permanent orphan: created successfully, named correctly, completely unreachable from the
// UI. Measured live: a site with two linked schedules (pids 16/17) showed one switcher row.
//
// Fix: the "prefer the richer registry row, drop the bridge" rule now applies ONLY when exactly
// ONE schedule links to that site (unchanged prior behavior, still covered by every existing test
// above). Once two or more do, the single registry row can no longer stand in for all of them —
// it's DROPPED instead, and each of that site's schedules gets its OWN row (carrying the site's
// timestamp/status for sensible sort order), so every one is independently clickable and
// `selectSchedule`'s `p.id === id` branch resolves it directly — no ambiguity left to fall back on.
export function unionProjectLists(controlledList = [], registryList = []) {
  const byId = new Map();
  for (const p of registryList || []) if (p && p.id != null) byId.set(p.id, p);
  const linkedCounts = new Map();
  for (const p of controlledList || []) {
    if (p && p.linkedSiteId != null) linkedCounts.set(p.linkedSiteId, (linkedCounts.get(p.linkedSiteId) || 0) + 1);
  }
  const multiLinkedSiteIds = new Set([...linkedCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  const extra = [];
  for (const p of controlledList || []) {
    if (!p || p.id == null) continue;
    if (byId.has(p.id)) continue;
    if (p.linkedSiteId != null && multiLinkedSiteIds.has(p.linkedSiteId)) {
      const site = byId.get(p.linkedSiteId);
      extra.push(site ? { ...p, updatedAt: site.updatedAt, status: site.status } : p);
      continue;
    }
    if (p.linkedSiteId != null && byId.has(p.linkedSiteId)) continue;
    extra.push(p);
  }
  const registryOut = (registryList || []).filter((p) => p && p.id != null && !multiLinkedSiteIds.has(p.id));
  return [...registryOut, ...extra];
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
