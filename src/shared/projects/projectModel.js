/* Project model — pure helpers shared by the header breadcrumb / project switcher.
 *
 * A "project" in Planyr is a Site Planner *site group* (one location, possibly many
 * plans). The breadcrumb lists one entry per group, newest-edited first. These
 * functions are intentionally dependency-free (no storage, no DOM, no React) so the
 * grouping/labeling logic can be unit-tested in the Node test runner and reused by
 * any workspace without dragging in the localStorage/Supabase chain.
 */

/* B1407824 — a name shortened for a tight display spot (a map pin label, a table cell, a tile
 * caption) must never just cut to a length and stop: a plain `name.slice(0, n)` can land the cut
 * immediately after a comma, period, hyphen or space, and the result reads as broken text
 * ("ALUMAX RD, NASH,") rather than as a shortened name — no ellipsis, no sign anything was cut.
 * Five Dashboard surfaces (the Locations map pin, the Pursuits table, the Recent plans tile
 * caption, and the Since-you-were-last-here feed's plan rows) each show a project/plan name in a
 * space too tight for the full string; this is the ONE place that decides how a name shortens, so
 * none of the five has to reimplement the rule.
 *
 * ⛔ THE OWNER-REPORTED NAME IS NOT ACTUALLY LONG — it's exactly "ALUMAX RD, NASH," and nothing
 * more (confirmed against production evidence surfaced by the sibling B1399568 fix, which read the
 * same stored value straight off two real `sites` rows). Nothing shortens it for SPACE, because
 * 16 characters fits comfortably in every one of this repo's name-display slots; the dangling
 * comma is the stored value's own trailing character, in full. A length-only truncate can never
 * fix that — there is nothing left to cut. So this function does two DIFFERENT things and only one
 * of them is "shortening": (1) a name over `maxLen` is cut, trimmed back past any trailing run of
 * comma/period/hyphen/whitespace, then marked with a single trailing "…" — a shortened name is
 * always both clean AND visibly identifiable as shortened, and a cut landing MID-WORD (nothing
 * separator-like to trim) is left exactly as cut, which reads as an ordinary shortened name, not
 * as broken text; (2) a name AT OR UNDER `maxLen` — nothing to cut — still has any trailing
 * comma/period/hyphen stripped (never a mark, because nothing was hidden — this is cleanup, not
 * shortening), because a name that just stops on a bare comma with nothing ever following it reads
 * as broken regardless of how it got that way, and there is no more text this function could ever
 * append to make it whole. A trailing SPACE alone is left alone in this branch — plain whitespace
 * at the end of a fitting name is not "broken text" the way a dangling punctuation mark is. */
const TRAILING_SEPARATOR_RE = /[,.\-\s]+$/;
const TRAILING_PUNCTUATION_RE = /[,.\-]+$/;

export function shortenDisplayName(name, maxLen) {
  const s = name == null ? "" : String(name);
  if (s.length <= maxLen) return s.replace(TRAILING_PUNCTUATION_RE, "") || s;
  const cut = s.slice(0, maxLen);
  const trimmed = cut.replace(TRAILING_SEPARATOR_RE, "");
  // A pathological name that is nothing but separators for the first `maxLen` characters would
  // otherwise trim to "" — fall back to the raw cut rather than hand back an empty label.
  return `${trimmed || cut}…`;
}

// How long a deleted project stays in the "Recently deleted" bin before it's purged for good.
// Canonical here (a pure, dependency-free constant) rather than in storage.js, so a caller that
// only needs the NUMBER — the breadcrumb's confirmation copy — never has to import the engine
// that owns the delete itself (B927105). storage.js imports it from here.
export const DELETED_RETENTION_DAYS = 30;

/* B1399568 — ADOPT, DON'T MINT: planning a site on ground that already carries a project must
 * open that project instead of minting a second `group_id = id` row. Production showed two
 * projects born 51 seconds apart at byte-identical origin coordinates — too far apart for any
 * debounce/submit-disable/StrictMode guard to close (those all land within milliseconds), and it
 * is unknown (and irrelevant) whether the second create came from a second press or the app
 * re-entering the path on its own. So the guard is keyed on the GROUND, checked fresh at the
 * moment of creation, not on suppressing a second click.
 *
 * `findProjectAtOrigin` is the ONE place that decides "does this origin already have a project."
 * `SAME_GROUND_FT` is deliberately tight — the real duplicate matched to the last digit — with
 * just enough slack to absorb float jitter from re-deriving an origin (e.g. a slightly different
 * parcel-average) for what is unmistakably the same click, while staying far short of the
 * distance between two genuinely different adjacent parcels. */
export const SAME_GROUND_FT = 30;

// Haversine distance in feet between two {lat, lon} points. Dependency-free (no projection
// module) since this only needs to answer "is this the same spot," never a precise survey figure.
export function distanceFeetBetween(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) {
    return Infinity;
  }
  const EARTH_RADIUS_FT = 20925646.325;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Find the existing project (group id) already anchored at `origin`, among a flat list of
// site-model records (the same shape `groupProjects` consumes). Every plan in a group carries its
// project's origin (copied verbatim by `newPlanSameParcel`/`duplicatePlan`), so matching any
// record's origin is enough to identify the group — never re-derived from just the anchor row,
// which the B1164192 family already showed can go missing while the group stays alive. Ties
// (pre-existing duplicates at the same spot) resolve to the most recently updated group, never a
// coin flip. Returns null when nothing at this ground exists yet, or `origin` is unusable.
export function findProjectAtOrigin(records = [], origin, { excludeGroupId = null } = {}) {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) return null;
  let best = null;
  for (const s of records || []) {
    if (!s || !s.origin) continue;
    const groupId = s.groupId || s.id;
    if (!groupId || groupId === excludeGroupId) continue;
    if (distanceFeetBetween(origin, s.origin) > SAME_GROUND_FT) continue;
    const updatedAt = Number(s.updatedAt) || 0;
    if (!best || updatedAt > best.updatedAt) best = { groupId, updatedAt };
  }
  return best ? best.groupId : null;
}

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
  // `scope` (B1482000, follow-on to B1469872): "project" (default) when the whole project is gone,
  // "plan" when `id` named one still-soft-deleted PLAN inside an otherwise-live project —
  // `checkProjectDeletionStatus` (storage.js) is the one place that tells the two apart. The
  // notice screen uses it to name the right thing and offer the right words.
  if (res.deleted) return { status: "deleted", name: res.name, deletedAt: res.deletedAt, scope: res.scope || "project" };
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

/* B1442592 ("An empty new project is never written to the server") — a project born through the Site
 * Planner's LAZY "New project" flow (`newBlankSite`/`newSiteFromMap` in SitePlannerApp.jsx) gets
 * no `public.sites` row, and no local plan record either, until its first real edit — that's the
 * root CLAUDE.md's "Project creation is deliberately LAZY" owner constraint (2026-09-05), not a
 * bug. Until that first edit, such a project can appear in the switcher ONLY via
 * `withCurrentProject`'s synthetic "the project you're standing in" placeholder — it never shows
 * up in `registryProjects` (the REAL list `listProjects()` reads off the on-device/cloud registry),
 * because there is nothing saved anywhere for `listProjects()` to find.
 *
 * This is the ONE place that answers "does this project id actually have a saved record behind
 * it" — pure, so the delete confirmation (ProjectBreadcrumb.jsx) can stop promising a "moves to
 * Recently deleted" trip for a project that has nothing anywhere to move. `registryProjects` must
 * be the REAL registry list (e.g. `listProjects()`), never a union that already includes the
 * synthetic placeholder — unioning first would make this always answer true for the one case it
 * exists to catch. */
export function hasSavedProjectRecord(id, registryProjects = []) {
  if (!id) return false;
  return (registryProjects || []).some((p) => p && p.id === id);
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

// ⛔ B1358128 — the resolution unionProjectLists' own comments above promise ("the caller
// resolves a click on it back to the right schedule id") was built exactly ONCE, inside
// Scheduler.jsx's selectSchedule, for PICKING a project. Rename/Delete/Duplicate never got it —
// each passed a unioned row's raw id straight through to the controlled bridge (Scheduler's
// onRenameProject/onDeleteProject/onDuplicateProject), which only understands its OWN ids — so a
// click on a single-linked-schedule (or zero-linked) registry row resolved to nothing and the
// bridge silently no-op'd (measured live: the Schedule module's Delete closing the confirm
// dialog with no project actually removed). This is the one place that resolution now lives;
// every caller (select, rename, delete, duplicate) uses it instead of reimplementing it ad hoc.
//
// `id` may be: (a) already one of `controlledList`'s own ids — returned as-is; (b) a registry
// standin id (the SITE id unionProjectLists used in place of its one linked schedule) — resolved
// to that schedule's own id, preferring `preferId` (e.g. the currently-active schedule) on the
// rare ambiguous case; or (c) a registry row with NO controlled entry behind it at all (a
// project with no linked schedule at all) — returns null, so callers can fall back to a plain
// site-store action, or refuse and say so, rather than silently doing nothing.
export function resolveControlledId(controlledList, id, preferId) {
  const list = controlledList || [];
  const direct = list.find((p) => p && p.id === id);
  if (direct) return direct.id;
  const linked = list.filter((p) => p && p.linkedSiteId != null && p.linkedSiteId === id);
  if (!linked.length) return null;
  return (linked.find((p) => p.id === preferId) || linked[0]).id;
}

// Case-insensitive name filter for the dropdown search field. Empty query → all.
export function filterProjects(projects = [], query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return projects;
  return projects.filter((p) => (p.name || "").toLowerCase().includes(q));
}

/* NEW-2 — freeze the switcher's row order across an in-progress rename. `groupProjects`
 * sorts most-recently-edited first, and a rename bumps `updatedAt`, so the row being renamed
 * jumps to the top the instant it commits and every row above it slides down one — while a
 * keyboard user's focus (and a mouse user's pointer) is still resolved against the PRE-sort
 * layout. `applyFrozenOrder` re-orders `list` to match `orderIds` (a snapshot of ids taken
 * before the edit started) for every id the snapshot knows about, and appends anything the
 * snapshot doesn't (a project created since the snapshot was taken) at the end in its own
 * relative order — so nothing can go missing, it just can't jump the queue mid-edit. Pass
 * `null`/empty `orderIds` to fall through to `list` unchanged (no snapshot taken yet, or the
 * dropdown just opened). */
export function applyFrozenOrder(list = [], orderIds = null) {
  if (!orderIds || !orderIds.length) return list;
  const rank = new Map(orderIds.map((id, i) => [id, i]));
  const known = [];
  const rest = [];
  for (const p of list) (p && rank.has(p.id) ? known : rest).push(p);
  known.sort((a, b) => rank.get(a.id) - rank.get(b.id));
  return [...known, ...rest];
}

// NEW-3/NEW-4 — the switcher's real display order: the project you are CURRENTLY INSIDE always
// leads, then any PINNED projects (in the order the user arranged them — most-recently-pinned
// first is `userPrefs.js`'s own convention; this function doesn't re-order that list, only
// places it), then everything else in whatever order the caller already sorted it (recency, by
// default). A project appears exactly once: being current or pinned LIFTS it out of the rest of
// the list rather than duplicating it — current always wins over pinned when a project is both,
// so it is never listed twice ("current" tops "pinned to top" — see the owner's own phrasing,
// "should be the top one"). This runs BEFORE `applyFrozenOrder`, which then holds row POSITIONS
// steady during an in-progress rename exactly as it already does — the two compose because this
// function is a pure re-sort of the same list shape `applyFrozenOrder` already accepts.
export function reorderWithCurrentAndPinned(list = [], currentId = null, pinnedIds = []) {
  const arr = (list || []).filter(Boolean);
  let current = null;
  const remaining = new Map();
  for (const p of arr) {
    if (!p || p.id == null) continue;
    if (!current && currentId != null && p.id === currentId) { current = p; continue; }
    if (!remaining.has(p.id)) remaining.set(p.id, p);
  }
  const pinned = [];
  for (const id of pinnedIds || []) {
    if (id === currentId) continue; // already leading as `current` — never duplicated below it
    const p = remaining.get(id);
    if (p) { pinned.push(p); remaining.delete(id); }
  }
  const rest = arr.filter((p) => p && p.id != null && remaining.has(p.id));
  return [...(current ? [current] : []), ...pinned, ...rest];
}

// Compact relative timestamp for the switcher rows ("just now", "5m ago", "3h ago",
// "2d ago", "3w ago", then a short calendar date for anything older than ~a month).
// `now` is injectable so the behavior is deterministic under test.
// ⛔ IT ACCEPTS AN ISO STRING AS WELL AS EPOCH MS, AND THAT IS A BUG FIX, NOT A CONVENIENCE.
// `Number("2026-09-01T12:34:56Z")` is NaN, so the old `Number(ts) || 0` silently answered "" for
// every ISO timestamp — and `cloudCheckDeleted` hands `deletedAt` straight through from Postgres,
// where `deleted_at` IS an ISO string. The visible symptom was the deleted-project screen reading
// "was moved to Recently deleted ." — a stray space before the period, which is the empty relative
// time that should have been there. So the reported typo was the tail of a silently-swallowed
// parse (LOUD-FAILURE: it degraded quietly instead of failing), and deleting the space would have
// hidden it for good. The bin LIST was never affected — `listDeletedProjects` converts with
// `toMs()` first — which is exactly why this survived: one of the two callers was already correct.
export function relTime(ts, now = Date.now()) {
  const t = typeof ts === "string" ? (Date.parse(ts) || Number(ts) || 0) : (Number(ts) || 0);
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
