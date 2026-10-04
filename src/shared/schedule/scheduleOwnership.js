// src/shared/schedule/scheduleOwnership.js
//
// EVERY SCHEDULE HAS AN OWNER. That is the whole point of this module.
//
// Owner rule (2026-09-08, verbatim: "I thought that was the whole purpose of organization, for it
// to go under this kind of thing?"): a schedule belongs to a PROJECT or it belongs to the
// ORGANIZATION. There is deliberately NO third state — no "unassigned", no "no project" pile. The
// organization is a real container shown in the same list as the projects, not a fallback bucket.
//
// ── What was actually wrong, measured on production 2026-09-08 (rev 4232) ────────────────────────
// The schedule document (`public.planar_data`, key `hs-v1`) is ONE row for the whole account, and
// `value.projects` is an object keyed by small integer strings. Ownership was expressed by ONE
// optional field, `linkedSiteId`, and its ABSENCE meant two different things that nothing could
// tell apart:
//   (a) "this schedule belongs to the whole business"  — Pursuits (15 tasks), Operations (7), and
//   (b) "this schedule belongs to nothing at all"      — an orphan nobody meant to create.
// Because absence was not a decision anyone ever made, (b) was reachable in one click and (a) was
// indistinguishable from it. `ownerKind` makes the decision EXPLICIT and mandatory, so (b) stops
// existing: a schedule with no owner is now unrepresentable, not merely discouraged.
//
// ⛔ AUDIT-FIRST — THE DISPATCH BRIEF'S LOAD-BEARING FINDING NO LONGER DESCRIBES PRODUCTION, and
// this module is built against the data as it actually is. The brief (measured at __rev 4195)
// stated "NO SCHEDULE CARRIES siteId, groupId OR projectId. NOT ONE", and concluded the data model
// had no room for a second schedule per project. Re-measured at __rev 4232 before writing a line of
// this: TEN of the twelve schedules DO carry `linkedSiteId`, and the Goose Creek site
// (`smqfy48tlk9j`) already owns FIVE of them — the real one, the three empty duplicates, and
// "TAS Land Sale", which now has 8 tasks and is exactly the second schedule the brief said was
// impossible. The multi-schedule plumbing (B1080547 and its follow-ons) had landed in between.
// So the RISKY HALF THE BRIEF ANTICIPATED — reconstructing ownership for 12 schedules by matching
// names — IS NOT NEEDED AND IS DELIBERATELY NOT BUILT: `migrateScheduleOwnership` reads the link
// the data already carries, and only the two genuinely cross-project schedules (Pursuits,
// Operations) are assigned to the organization. Guessing an owner by name where the data already
// answers would be strictly more dangerous than reading it. See the PR for the assignment table.
//
// ── Invariants (each has a test in test/scheduleOwnership.test.js) ───────────────────────────────
// 1. Every schedule resolves to exactly one owner. `ownerOf` never returns null/undefined.
// 2. Migration is ADDITIVE and IDEMPOTENT: it never deletes a schedule, never touches `tasks`, and
//    running it twice changes nothing the first run did not.
// 3. An explicit `ownerKind` already on a schedule is never overwritten by inference.
// 4. `ownerKind:"site"` with no resolvable site falls back to the organization rather than
//    resurrecting the orphan state — the one state this model does not have.
// 5. Creating a schedule REQUIRES a non-empty name and an explicit owner (`validateNewSchedule`).
//    This is what stops the silent "Goose Creek (4)" auto-naming that produced three empty
//    duplicates on production.
// 6. Deleting a schedule prunes every reference to it (`pruneScheduleRefs`) — the per-schedule
//    next-task-id counter and any last-active pointer — because this document is the whole account
//    in one row and orphaned keys there are unbounded growth.
//
// This file is the CANONICAL copy. `public/sequence/index.html` is a standalone in-browser-Babel
// page that cannot import from src/, so it carries a VERBATIM inlined copy between the
// SCHEDULE-OWNERSHIP markers, written only by `scripts/sync-sequence-ownership.mjs` and guarded
// against drift by `test/scheduleOwnership-inline-sync.test.js`. Keep everything between the
// markers free of `import`/`export` (the export block lives after the END marker).

/* SCHEDULE-OWNERSHIP:START */

// The organization/account container's owner key. Deliberately a string that can never collide
// with a Site Planner group id (those are lowercase base-36 like "smqfy48tlk9j", never `__`-wrapped).
const ORG_OWNER_KEY = "__org__";

// The two — and only two — kinds of owner a schedule may have.
const OWNER_KIND_SITE = "site";
const OWNER_KIND_ORG = "org";

// How the organization container is labelled wherever schedules are grouped. One string, so the
// switcher, the modal's owner picker and the empty state can never drift apart.
const ORG_OWNER_LABEL = "Organization";

// Resolve a schedule's owner. Total: ALWAYS returns an owner, never null — invariant 1.
//
// Precedence, and the order matters:
//   1. An explicit `ownerKind:"site"` WITH a resolvable `linkedSiteId` — a decision someone made.
//   2. An explicit `ownerKind:"org"` — also a decision someone made, and it wins over a stale
//      `linkedSiteId` left behind by an older build (the explicit field is the newer truth).
//   3. No explicit kind, but a `linkedSiteId` — inferred site ownership (pre-migration documents,
//      and any schedule created by a build older than this one).
//   4. Anything else — the organization. Invariant 4: an `ownerKind:"site"` whose site id went
//      missing lands HERE rather than in a fourth "unowned" state, because that state is exactly
//      what this model removes.
//
// ⛔ NEW-1 (B1991040) — THE LINKED PROJECT'S NAME IS A READ-TIME LOOKUP BY ID, NEVER THE STORED COPY.
// `linkedSiteName` is a snapshot written when the link was made; renaming the project never touched
// it, so the Dashboard's Schedule health card printed "Pappadoupolos / Master Schedule" beside a
// Jump Back In row reading "Papadopoulos" (measured live 2026-09-29, `schedules` id 6). A host
// registers ONE resolver (id → the project's live name, `shared/names`) and every display below
// asks it first; the stored copy is now ONLY the fallback for a link whose project this device
// cannot resolve (not pulled yet, or deleted) — it is never preferred over a live answer.
let siteNameResolver = null;
function setSiteNameResolver(fn) { siteNameResolver = typeof fn === "function" ? fn : null; }
function liveSiteName(siteId, stored) {
  let live = null;
  if (siteNameResolver && siteId != null) { try { live = siteNameResolver(siteId); } catch (_) { live = null; } }
  if (live) return live;
  return stored != null && stored !== "" ? stored : null;
}
function ownerOf(schedule) {
  const s = schedule && typeof schedule === "object" ? schedule : {};
  const siteId = s.linkedSiteId != null && s.linkedSiteId !== "" ? s.linkedSiteId : null;
  const siteName = liveSiteName(siteId, s.linkedSiteName);
  if (s.ownerKind === OWNER_KIND_ORG) return { kind: OWNER_KIND_ORG, siteId: null, siteName: null, key: ORG_OWNER_KEY };
  if (s.ownerKind === OWNER_KIND_SITE && siteId != null) return { kind: OWNER_KIND_SITE, siteId, siteName, key: siteId };
  if (s.ownerKind == null && siteId != null) return { kind: OWNER_KIND_SITE, siteId, siteName, key: siteId };
  return { kind: OWNER_KIND_ORG, siteId: null, siteName: null, key: ORG_OWNER_KEY };
}

// The single grouping key for a schedule: a site's group id, or ORG_OWNER_KEY. Every "which
// schedules live here" question routes through this so there is one answer, never two.
function ownerKeyOf(schedule) {
  return ownerOf(schedule).key;
}

function isOrgOwned(schedule) { return ownerOf(schedule).kind === OWNER_KIND_ORG; }
function isSiteOwned(schedule) { return ownerOf(schedule).kind === OWNER_KIND_SITE; }

// Every schedule owned by `ownerKey`, in stable id order. `projects` is the document's projects
// OBJECT (or an array — both are accepted, because the shell bridges an array and the embedded
// app holds an object, and a helper that only understood one of them would need a second copy).
function scheduleList(projects) {
  if (Array.isArray(projects)) return projects.filter(Boolean);
  if (!projects || typeof projects !== "object") return [];
  return Object.values(projects).filter(Boolean);
}

function schedulesForOwner(projects, ownerKey) {
  if (ownerKey == null) return [];
  return scheduleList(projects).filter((p) => ownerKeyOf(p) === ownerKey);
}

// ── Display label ────────────────────────────────────────────────────────────────────────────────
//
// NEW-1 (owner report 2026-09-16, direct follow-on to B1696640/B1696641/PR 1741) — a notice that
// names a schedule by its OWN name is still ambiguous even with a row ID attached, because two
// different Planyr projects can each hold a schedule named "Master Schedule" (the owner's live
// account does exactly this). "<Project> / <Schedule>" is the one label that disambiguates both
// axes at once — which project, and which of that project's schedules. Never degrades to a bare
// schedule name: an org-owned schedule prints the fixed ORG_OWNER_LABEL, and a site-owned schedule
// whose cached `linkedSiteName` hasn't caught up yet still gets a left half that can't be mistaken
// for a real project's name, rather than silently falling back to the ambiguous case this exists
// to close.
//
// ⛔ MOVED HERE FROM public/sequence/index.html (B1939344, 2026-09-28). It used to live OUTSIDE the
// SCHEDULE-OWNERSHIP sync block with a comment saying it had "no reason to be duplicated" in the
// canonical module, because only the Scheduler's own in-page notices needed it. That judgement
// broke the moment a SECOND consumer needed the identical label: the Dashboard's Schedule health /
// Needs Attention / "Since you were last here" cards (scheduleHealth.js / needsAttentionList.js /
// sinceLastHereFeed.js) rendered a bare schedule name, and the owner's own account has four
// schedules all named "Master Schedule" under four different projects — indistinguishable on the
// Dashboard even though the Reports tab (public/sequence/index.html) has disambiguated them since
// PR 1849. A second hand-copy of this exact join is precisely the "one-answer function"
// duplication docs/DATA.md forbids, so it now ships to both consumers from the one place `ownerOf`/
// `ORG_OWNER_LABEL` already live.

// The two halves crossScheduleLabel joins, exposed separately for anything that needs to SORT or
// GROUP on the owner and the schedule name independently (e.g. MasterView's "Group by project"
// ordering) without re-parsing the joined "<owner> / <name>" string — a project or schedule name
// that itself contains " / " would otherwise make that parse ambiguous.
function scheduleLabelParts(schedule) {
  const name = (schedule && schedule.name) || "Untitled schedule";
  const owner = ownerOf(schedule);
  const ownerLabel = owner.kind === OWNER_KIND_ORG ? ORG_OWNER_LABEL : (owner.siteName || "an unnamed project");
  return { ownerLabel, name };
}
function crossScheduleLabel(schedule) {
  const { ownerLabel, name } = scheduleLabelParts(schedule);
  return `${ownerLabel} / ${name}`;
}

// Split every schedule into the three groups the Schedule tab's list renders, in the order it
// renders them: the routed project's own schedules first, then the organization's, then everything
// belonging to some OTHER project. `siteId` null (no routed project) leaves `here` empty and puts
// every site-owned schedule in `elsewhere` — the account-level view.
function partitionSchedules(projects, siteId) {
  const here = []; const org = []; const elsewhere = [];
  for (const p of scheduleList(projects)) {
    const owner = ownerOf(p);
    if (owner.kind === OWNER_KIND_ORG) org.push(p);
    else if (siteId != null && owner.siteId === siteId) here.push(p);
    else elsewhere.push(p);
  }
  return { here, org, elsewhere };
}

// ── Migration ────────────────────────────────────────────────────────────────────────────────────
//
// Give every schedule an explicit owner, reading the link the document already carries. Invariant
// 2: additive and idempotent — no schedule is removed, no `tasks` array is read or rewritten, and a
// second run is a no-op. Invariant 3: an `ownerKind` already present is never overwritten.
//
// Returns the SAME object when nothing changed, so this is safe to run on every load without
// invalidating a memo or marking the document dirty (the embedded app's `coreChanged` compares by
// identity — a fresh object here would bump `__rev` on every boot, on a single-row whole-account
// document, from every open tab).
function migrateScheduleOwnership(data) {
  if (!data || typeof data !== "object" || !data.projects || typeof data.projects !== "object") return data;
  let changed = false;
  const projects = {};
  for (const [pid, proj] of Object.entries(data.projects)) {
    if (!proj || typeof proj !== "object") { projects[pid] = proj; continue; }
    const owner = ownerOf(proj);
    if (proj.ownerKind === owner.kind) { projects[pid] = proj; continue; }
    changed = true;
    // Only the ownerKind field is written. `tasks`, `linkedSiteId`, columns, formulas, meeting
    // bodies — everything else rides through untouched by construction (spread, no deletes).
    projects[pid] = { ...proj, ownerKind: owner.kind };
  }
  return changed ? { ...data, projects } : data;
}

// Drop per-schedule bookkeeping for schedules that no longer exist. This is NOT user work: `nTid`
// is a map of next-task-id counters and `lastActiveBySite` is a map of "which schedule was I last
// looking at". Both are keyed by schedule id and neither was ever pruned, so on production `nTid`
// still carried counters for ids 4, 8–14, 17 and 18 — schedules deleted long ago — inside a
// document that is the entire account in one row. Never touches a counter for a schedule that
// still exists, and never touches a pointer to a live schedule.
function pruneOrphanScheduleRefs(data) {
  if (!data || typeof data !== "object") return data;
  const live = new Set(Object.keys(data.projects || {}).map(String));
  let changed = false;

  let nTid = data.nTid;
  if (nTid && typeof nTid === "object") {
    const kept = {};
    for (const [k, v] of Object.entries(nTid)) {
      if (live.has(String(k))) kept[k] = v; else changed = true;
    }
    if (changed) nTid = kept;
  }

  let lastActive = data.lastActiveBySite;
  let lastActiveChanged = false;
  if (lastActive && typeof lastActive === "object") {
    const kept = {};
    for (const [siteId, pid] of Object.entries(lastActive)) {
      if (live.has(String(pid))) kept[siteId] = pid; else lastActiveChanged = true;
    }
    if (lastActiveChanged) lastActive = kept;
  }

  if (!changed && !lastActiveChanged) return data;
  const out = { ...data };
  if (changed) out.nTid = nTid;
  if (lastActiveChanged) out.lastActiveBySite = lastActive;
  return out;
}

// Everything a delete must clean up, in one place — invariant 6. Applied to the state that ALREADY
// has the schedule removed, so it is simply "prune whatever no longer resolves"; that also means a
// delete can never leave a reference behind by forgetting a map, because this asks the live set
// rather than the id that was removed.
function pruneScheduleRefs(dataAfterDelete) {
  return pruneOrphanScheduleRefs(dataAfterDelete);
}

// The one function every load path runs: explicit owners, then no orphaned bookkeeping.
function normalizeScheduleOwnership(data) {
  return pruneOrphanScheduleRefs(migrateScheduleOwnership(data));
}

// ── Creating a schedule ──────────────────────────────────────────────────────────────────────────

function normalizeName(name) {
  return typeof name === "string" ? name.trim() : "";
}

// Does `name` already name a schedule under the SAME owner? Case- and whitespace-insensitive,
// because "Goose Creek" and "goose creek " under one project are the same schedule to a human.
// Scoped to the owner deliberately: two different projects may each have a "Master Schedule", and
// forbidding that would be a worse product than allowing it.
function nameCollision(projects, ownerKey, name, exceptPid) {
  const want = normalizeName(name).toLowerCase();
  if (!want) return false;
  return schedulesForOwner(projects, ownerKey)
    .some((p) => p && p.id !== exceptPid && normalizeName(p.name).toLowerCase() === want);
}

// Invariant 5 — the gate that makes "New schedule" a decision instead of a silent duplicate.
//
// ⛔ THIS IS THE ROOT CAUSE OF THE THREE EMPTY "Goose Creek (2)/(3)/(4)" SCHEDULES ON PRODUCTION.
// The old path (navState.js `newProjectAction`) took NO name and NO owner: standing on a project it
// auto-named the new schedule after that project, and on a collision appended "(2)", "(3)", "(4)".
// Three presses produced three empty duplicates with nothing to distinguish them and no prompt at
// any point. A name is now REQUIRED (never defaulted silently — the modal PRE-FILLS one and lets it
// be changed, which is a different thing: the name is on screen and editable before anything is
// created) and an owner is REQUIRED and explicit.
//
// Returns { ok, name, ownerKind, siteId, siteName, error, warning }. `warning` is a same-owner name
// collision: surfaced, never blocking — he is allowed to name two schedules the same thing if he
// means to; what he is not allowed to do is create one WITHOUT meaning to.
function validateNewSchedule({ name, ownerKind, siteId = null, siteName = null, projects = [] } = {}) {
  const clean = normalizeName(name);
  if (!clean) {
    return { ok: false, error: "Give the schedule a name.", name: clean, ownerKind: ownerKind ?? null, siteId, siteName };
  }
  if (ownerKind !== OWNER_KIND_SITE && ownerKind !== OWNER_KIND_ORG) {
    return { ok: false, error: "Choose where this schedule lives.", name: clean, ownerKind: ownerKind ?? null, siteId, siteName };
  }
  if (ownerKind === OWNER_KIND_SITE && (siteId == null || siteId === "")) {
    return { ok: false, error: "Choose which project this schedule belongs to.", name: clean, ownerKind, siteId: null, siteName };
  }
  const ownerKey = ownerKind === OWNER_KIND_ORG ? ORG_OWNER_KEY : siteId;
  const warning = nameCollision(projects, ownerKey, clean)
    ? `There is already a schedule called “${clean}” here.`
    : null;
  return {
    ok: true,
    error: null,
    warning,
    name: clean,
    ownerKind,
    siteId: ownerKind === OWNER_KIND_SITE ? siteId : null,
    siteName: ownerKind === OWNER_KIND_SITE ? (siteName ?? null) : null,
  };
}

// The name the "New schedule" modal PRE-FILLS. Distinct from the old auto-naming in one decisive
// way: this is a suggestion shown in an editable field before anything exists, not a name silently
// committed to a schedule that has already been created. A project with no schedule yet suggests
// the project's own name; once that is taken the suggestion is left EMPTY rather than "(2)" —
// a second schedule under a project is a different thing (a Master Schedule and a Land Sale
// schedule), so guessing a name for it is exactly the guess that produced the duplicates.
function suggestScheduleName(projects, ownerKind, siteId, siteName) {
  if (ownerKind !== OWNER_KIND_SITE) return "";
  const base = normalizeName(siteName);
  if (!base) return "";
  return nameCollision(projects, siteId, base) ? "" : base;
}

/* SCHEDULE-OWNERSHIP:END */

// ── Deleting a schedule ──────────────────────────────────────────────────────────────────────────
//
// The delete confirmation's own sentence (B1404352 — "once a schedule exists there is no way to
// rename or delete it"). Named and testable so the wording can't silently drift between what the
// item requires ("must NAME the schedule it is about to remove and say what happens to its
// tasks") and what actually renders. Not part of the inlined SCHEDULE-OWNERSHIP block above: the
// embedded app keeps its own equivalent sentence in its (suppressed, `skipConfirm`) native
// `window.confirm` — this is the SHELL side's inline confirmation, a UI concern the standalone
// page doesn't need a copy of.
function describeScheduleDelete(name, taskCount) {
  const label = normalizeName(name) || "this schedule";
  const n = Number.isFinite(taskCount) ? Math.max(0, taskCount) : 0;
  if (n <= 0) return `Delete “${label}”? This schedule has no tasks.`;
  return `Delete “${label}”? This removes ${n} task${n === 1 ? "" : "s"}.`;
}

export {
  ORG_OWNER_KEY, ORG_OWNER_LABEL, OWNER_KIND_SITE, OWNER_KIND_ORG,
  setSiteNameResolver, liveSiteName,
  ownerOf, ownerKeyOf, isOrgOwned, isSiteOwned,
  scheduleList, schedulesForOwner, partitionSchedules,
  scheduleLabelParts, crossScheduleLabel,
  migrateScheduleOwnership, pruneOrphanScheduleRefs, pruneScheduleRefs, normalizeScheduleOwnership,
  normalizeName, nameCollision, validateNewSchedule, suggestScheduleName,
  describeScheduleDelete,
};
