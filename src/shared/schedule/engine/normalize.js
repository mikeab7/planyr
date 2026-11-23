// src/shared/schedule/engine/normalize.js
//
// The load-time migrations of the Schedule document (v6 inclusive end dates, v7 duration model, v8 meeting
// index stamp, meeting-cadence rule shape, holidays defaults, id renumbering, contacts-from-owners) and the
// pipeline that composes them. Lifted out of the page's App component (they closed over nothing) in audit
// batch J1, so the unit tests exercise the very functions the page runs instead of a hand-kept mirror.
import { calcEnd, normPreds, resolveDuration } from "./predecessors.js";
import { rollupParentDates } from "./cascade.js";
import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS } from "./calendar.js";
import { rebuildMeetingBodyIndex } from "./meetings.js";
import { renumberTasks, sortByVisualOrder } from "./tasks.js";
import { normalizeOwnerLists, ownerKey, ownerListOf } from "./owners.js";
import { normalizeScheduleOwnership } from "../scheduleOwnership.js";

// One-time migration: recompute end dates to MS Project inclusive convention
// and normalise predecessor format. Does NOT cascade (preserves manual dates).
export const normalizeToV6 = d => {
  // Defensive: this runs FIRST on whatever JSON.parse returns (a Supabase row or a
  // hand-edited <script id="planar-data"> block), so it must survive corrupt shapes
  // — a null/garbage project or non-array tasks must be skipped, not crash the whole
  // load (the catch re-runs this on the seed, so a malformed seed would hang on the
  // loader). Mirrors the guards the sibling normalizers already use.
  if (!d || typeof d !== "object") d = {};
  if (d._v6) return d;
  const projects = {};
  const srcProjects = (d.projects && typeof d.projects === "object") ? d.projects : {};
  Object.entries(srcProjects).forEach(([id, proj]) => {
    if (!proj || typeof proj !== "object") return;                     // skip a null/garbage project
    const srcTasks = Array.isArray(proj.tasks) ? proj.tasks : [];
    const tasks = srcTasks.filter(t => t && typeof t === "object").map(t => ({   // skip a null/garbage task
      ...t,
      predecessors: normPreds(t.predecessors),
      end: calcEnd(t.start, t.duration),
    }));
    projects[id] = {...proj, tasks: rollupParentDates(tasks)};
  });
  return {...d, projects, _v6: true, healthColStyle: d.healthColStyle || "stoplight",
    settings: d.settings ? {...DEFAULT_SETTINGS, ...d.settings, holidays:{...DEFAULT_HOLIDAYS,...(d.settings.holidays||{})}, customHealth: d.settings.customHealth||[], healthLabelOverrides: d.settings.healthLabelOverrides||{}} : {...DEFAULT_SETTINGS, holidays:{...DEFAULT_HOLIDAYS}}};
};

// One-time migration to the B615 duration model: stamp durUnit/durValue onto every task. Pre-B615
// durations were ALL working-day counts, so legacy tasks become unit 'd', durValue = duration —
// which re-derives to the SAME end date (resolveDuration('d') === calcEnd, already applied by v6).
// A shifted end here would be a bug to SURFACE, not to move silently (see the before/after diff in
// ui-audit/stress/verify-b615-migration.mjs). Idempotent via _v7. Does NOT touch a locked finish.
export const normalizeToV7 = d => {
  if (!d || typeof d !== "object") d = {};
  if (d._v7) return d;
  const projects = {};
  const srcProjects = (d.projects && typeof d.projects === "object") ? d.projects : {};
  Object.entries(srcProjects).forEach(([id, proj]) => {
    if (!proj || typeof proj !== "object") return;
    const srcTasks = Array.isArray(proj.tasks) ? proj.tasks : [];
    const tasks = srcTasks.filter(t => t && typeof t === "object").map(t => {
      const durUnit = t.durUnit || "d";
      const durValue = (t.durValue != null) ? t.durValue : (typeof t.duration === "number" ? t.duration : 0);
      if (t.pinnedEnd && t.end) return {...t, durUnit, durValue};                 // locked finish is authoritative
      const r = resolveDuration(t.start, durValue, durUnit);
      return {...t, durUnit, durValue, duration: r.duration, end: r.end};
    });
    projects[id] = {...proj, tasks: rollupParentDates(tasks)};
  });
  return {...d, projects, _v7: true};
};

// B816 (NEW-2) — v8: the meeting-bound fields (meetingBodyId · meetingBound · pinnedMeetingDate) are
// OPTIONAL and read with falsy defaults, so this is a NO-OP version stamp — zero date shift by
// construction. It also refreshes the global MEETING_BODY_INDEX (unconditionally, even for an already-v8
// load) so the first cascade after load can resolve bound tasks. Idempotent via _v8.
export const normalizeToV8 = d => {
  rebuildMeetingBodyIndex(d);
  if (!d || typeof d !== "object") return d;
  if (d._v8) return d;
  return {...d, _v8: true};
};

// NEW-1 (2026-09-22) — one-time migration of every meetingBodies[].recurrence[] rule from the old
// {freq,setpos,onOrAfter} shape to the new sentence-UI shape {positions,weekday,months,anchor}. A
// DISTINCT flag (_mbv2, not _v9) — the retired normalizeToV9 below already stamped `_v9:true` on
// every real schedule loaded since 2026-08-25, so reusing that flag would silently skip this
// migration on every one of them. Runs BEFORE normalizeToV8 rebuilds MEETING_BODY_INDEX, so the
// index always reflects already-migrated rules. The only anchor shape the OLD UI could ever
// produce was weekday:2 (Tue) + onOrAfter:2 (the "Tuesday after the 1st Monday" / Election Day
// primitive) — that maps exactly to the new anchor {position:1, weekday:1 (Mon)}; anything else
// (never producible from the UI) defensively drops the anchor rather than guess, loudly.
export const migrateRecurrenceRule = r => {
  if (!r || typeof r !== "object" || "positions" in r) return r;   // already new shape / not a rule
  const months = (Array.isArray(r.months) && r.months.length) ? r.months.slice() : "all";
  const passthrough = {};
  if (r.effectiveFrom) passthrough.effectiveFrom = r.effectiveFrom;
  if (r.effectiveTo) passthrough.effectiveTo = r.effectiveTo;
  if (r.interval > 1) passthrough.interval = r.interval;
  if (r.freq === "weekly") return { positions: "every", weekday: r.weekday, months, anchor: null, ...passthrough };
  const rawSetpos = Array.isArray(r.setpos) ? r.setpos : (r.setpos != null ? [r.setpos] : []);
  let positions = rawSetpos.length ? rawSetpos.slice() : [1];
  let weekday = r.weekday, anchor = null;
  if (r.onOrAfter != null) {
    if (r.weekday === 2 && r.onOrAfter === 2) {
      anchor = { position: 1, weekday: 1 };   // the 1st Monday
      weekday = 2;                            // Tuesday, counted from after it
      positions = [1];
    } else {
      console.warn("[migrateRecurrenceRule] unrecognized onOrAfter combination — the UI never produced this shape; dropping the anchor rather than guess:", r);
    }
  }
  return { positions, weekday, months, anchor, ...passthrough };
};

export const normalizeMeetingCadence = d => {
  if (!d || typeof d !== "object") return d;
  if (d._mbv2) return d;
  const projects = {};
  const srcProjects = (d.projects && typeof d.projects === "object") ? d.projects : {};
  Object.entries(srcProjects).forEach(([id, proj]) => {
    if (!proj || typeof proj !== "object") { projects[id] = proj; return; }
    if (!Array.isArray(proj.meetingBodies) || !proj.meetingBodies.length) { projects[id] = proj; return; }
    projects[id] = {...proj, meetingBodies: proj.meetingBodies.map(b => (b && Array.isArray(b.recurrence))
      ? { ...b, recurrence: b.recurrence.map(migrateRecurrenceRule) } : b)};
  });
  return { ...d, projects, _mbv2: true };
};

// Ensure any new DEFAULT_HOLIDAYS keys (added in future versions) are merged in
export const ensureHolidays = d => {
  if (!d?.settings) return d;
  const merged = {...DEFAULT_HOLIDAYS, ...(d.settings.holidays||{})};
  return {...d, settings: {...d.settings, holidays: merged}};
};

// Auto-renumber every project's tasks on load so IDs are always sequential
export const normalizeIds = d => {
  if (!d?.projects) return d;
  const projects = {};
  Object.entries(d.projects).forEach(([pid, proj]) => {
    if (!proj || typeof proj !== "object") return;   // skip a null/garbage project (defensive, like normalizeToV6)
    // Blank durations ("") become 0 on load — new tasks now start at 0d,
    // and this sweeps any legacy empty values so the grid never shows a
    // bare "d" again. Runs automatically, same as ID renumbering.
    const tasks0 = (Array.isArray(proj.tasks) ? proj.tasks : []).filter(t => t && typeof t === "object").map(t => (t.duration === "" || t.duration == null) ? {...t, duration: 0} : t);
    // B550: break any parentId cycle on load so NO downstream tree-walk (indent/outdent/delete/
    // insert/sort) can infinite-loop and hang the tab. Walk each task's ancestor chain; if it
    // loops back on itself (corrupt data / a past bug), orphan that task (parentId → null). On
    // clean data no chain loops, so this is a no-op. (The UI prevents creating a cycle live; this
    // guards the persisted-data path — see also the sortByVisualOrder guard.)
    const byId = {}; tasks0.forEach(t => { byId[t.id] = t; });
    const tasks = tasks0.map(t => {
      const seen = new Set([t.id]); let p = t.parentId;
      while (p != null && byId[p]) { if (seen.has(p)) return {...t, parentId: null}; seen.add(p); p = byId[p].parentId; }
      return t;
    });
    // NEW-1 — one-time backfill of _sid for a task that predates it (loaded with none at all).
    // DETERMINISTIC on (pid, this task's own id AS STORED in the cloud row, before this pass's
    // own renumbering runs) — never random here — so two tabs independently migrating the SAME
    // still-unmigrated cloud doc derive the IDENTICAL _sid for the same pre-existing task,
    // instead of each minting its own random one and reading the other's copy as a duplicate
    // add on the first merge. A task that already carries _sid (any load after the first) is
    // left untouched.
    const tasksWithSid = tasks.map(t => (t._sid ? t : { ...t, _sid: `legacy:${pid}:${t.id}` }));
    projects[pid] = {...proj, tasks: renumberTasks(sortByVisualOrder(tasksWithSid))};
  });
  // Resync the next-task-id counters: renumbering compacts ids to 1..n,
  // so the next safe id is always n+1. This heals counters that drifted
  // low (paste/duplicate never bumped them), which is what caused
  // "+ New task" to mint an id that already existed and scramble the
  // hierarchy. Runs automatically on every load.
  const nTid = {...(d.nTid || {})};
  Object.entries(projects).forEach(([pid, proj]) => { nTid[pid] = (proj.tasks?.length || 0) + 1; });
  return {...d, projects, nTid};
};

export const ensureContacts = d => {
  if (!d?.projects) return d;
  const existing = (d.settings?.contacts || []);
  const existingNames = new Set(existing.map(c => ownerKey(c?.name)));
  const seen = new Set();
  Object.values(d.projects).forEach(proj => {
    ((proj && Array.isArray(proj.tasks)) ? proj.tasks : []).forEach(t => {
      // NEW-1 — owner is a LIST now; derive a contact for every name in it, not just one.
      ownerListOf(t).forEach(rp => {
        if (rp && !existingNames.has(ownerKey(rp)) && !seen.has(ownerKey(rp))) {
          existing.push({ id: Date.now() + existing.length + seen.size, name: rp, email: '' });
          existingNames.add(ownerKey(rp));
          seen.add(ownerKey(rp));
        }
      });
    });
  });
  return {...d, settings: {...d.settings, contacts: existing}};
};

// The whole load pipeline, in the order the page applies it to anything it reads or imports
// (cloud row, embedded seed, imported JSON, restored version).
export const loadDocument = d =>
  normalizeScheduleOwnership(normalizeToV8(ensureContacts(normalizeOwnerLists(normalizeIds(ensureHolidays(normalizeToV7(normalizeToV6(normalizeMeetingCadence(d)))))))));
