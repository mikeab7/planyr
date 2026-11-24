// src/shared/schedule/engine/merge.js
//
// Cloud merge and row-level diffing: three-way document merge, task fingerprints, the dual-write decomposition, merge-toast wording.
//
// Pure functions only (no React, no DOM). The Schedule page (public/sequence/index.html) gets this code
// through the generated script public/sequence/page.js (npm run build:sequence-page), and the unit
// tests import it directly — ONE copy, no paste-in. Moved here verbatim from the page (audit batch J1);
// behaviour is unchanged.
import { crossScheduleLabel } from "../scheduleOwnership.js";
import { omitKeys } from "./omit.js";

// NEW-1 — which schedules (pids) a merge actually touched, so the "Merged in changes saved
// elsewhere" toast can say WHERE instead of nothing: the merge is detected from the whole
// account's cloud document, which holds every schedule under every project, so "something changed"
// used to read the same whether the edit landed in the schedule on screen or a different project's
// entirely. Same per-pid add/removed/changed comparison countChangedTaskRows already does, kept as
// a separate function (rather than changing that one's return shape) so its own existing callers
// and tests are untouched.
export const changedProjectIds = (before, after) => {
  try {
    const bp = (before && before.projects) || {};
    const ap = (after && after.projects) || {};
    const out = [];
    new Set([...Object.keys(bp), ...Object.keys(ap)]).forEach(pid => {
      const bTasks = bp[pid]?.tasks || [], aTasks = ap[pid]?.tasks || [];
      const bSid = _taskSidMap(bTasks), aSid = _taskSidMap(aTasks);
      const bt = {}; bTasks.forEach(t => { if (t) bt[_taskKey(t)] = t; });
      const at = {}; aTasks.forEach(t => { if (t) at[_taskKey(t)] = t; });
      let changed = false;
      new Set([...Object.keys(bt), ...Object.keys(at)]).forEach(key => {
        if (!_mEq(_taskFingerprint(bt[key], bSid), _taskFingerprint(at[key], aSid))) changed = true;
      });
      if (changed) out.push(pid);
    });
    return out;
  } catch { return []; }
};

// NEW-1 — the short "where" phrase for the merge toast: "in this schedule" when the ONLY schedule
// touched is the one already on screen (still says something, but doesn't restate its full name —
// same PANEL-BREVITY reasoning as scheduleRowPrefix above), otherwise "in <label>[, <label>…]" built
// from crossScheduleLabel so a merge landing in a different — possibly same-named — project's
// schedule is never mistaken for one that touched what's on screen. Empty string when nothing changed.
export function mergeLocationPhrase(projects, changedPids, currentPid) {
  if (!changedPids || !changedPids.length) return "";
  if (changedPids.length === 1 && String(changedPids[0]) === String(currentPid)) return "in this schedule";
  const shown = changedPids.slice(0, 2).map(pid => crossScheduleLabel((projects && projects[pid]) || {}));
  const extra = changedPids.length - shown.length;
  return "in " + shown.join(", ") + (extra > 0 ? `, +${extra} more` : "");
}

// B864(b) — pure 3-way merge for the cloud whole-document save (unit-tested in 
// test/schedulerEngine.test.js). The Scheduler cloud-saves the WHOLE document last-write-wins; the
// rev-gate only BLOCKS a stale tab, so a sibling tab's independent addition (e.g. a just-created meeting
// calendar) is lost when the other tab wins — the multi-writer clobber that orphaned hs-v1's election
// binding (B864). Instead of blocking, we REBASE our edits onto the newer cloud:
//   base = the ancestor doc (last loaded/saved) · ours = this tab's doc · theirs = the newer cloud.
// A side unchanged vs base yields to the changed side; id-keyed arrays (tasks/meetingBodies/contacts/…)
// merge per element by id (adds survive, a delete is honored only if the other side left the key alone);
// a genuine same-leaf conflict prefers OURS (the losing copy stays in Version History). Module scope so the
// storage layer AND the App's reconcile listener share one implementation.
export const _mIsObj = v => !!v && typeof v === "object" && !Array.isArray(v);

export const _mEq = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; } };

export const _mStripRev = o => { if (_mIsObj(o)) { return omitKeys(o, ["__rev"]); } return o; };

export const _deepClone = o => { try { return JSON.parse(JSON.stringify(o)); } catch { return o; } };

export const _mIdArr = a => Array.isArray(a) && a.length > 0 && a.every(e => _mIsObj(e) && "id" in e);

// NEW-1 — match an id-keyed array element by its permanent `_sid` when it carries one (a task,
// once migrated — see renumberTasks/normalizeIds), falling back to the plain `id` for every other
// id-keyed array (meetingBodies/contacts/notes/…, which never carry `_sid` and are matched exactly
// as before). Without this, two snapshots taken across a renumber (an insert/delete/indent
// elsewhere in the SAME schedule) match tasks by their now-shifted positional id — pairing up the
// WRONG rows, or reading a merely-renumbered task as "deleted here, added there".
export const _mKeyOf = e => (_mIsObj(e) && e._sid != null) ? ("sid:" + e._sid) : (e && e.id);

export const mergeCloudDoc = (base, ours, theirs) => {
  if (_mEq(ours, theirs)) return theirs;
  if (_mEq(ours, base)) return theirs;
  if (_mEq(theirs, base)) return ours;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    if (!_mIdArr(ours) || !_mIdArr(theirs)) return ours;
    const bArr = Array.isArray(base) ? base : [];
    const byKey = arr => { const m = new Map(); arr.forEach(e => { const k = _mKeyOf(e); if (!m.has(k)) m.set(k, e); }); return m; };
    const bM = byKey(bArr), tM = byKey(theirs), oSeen = new Set();
    const out = [];
    for (const e of ours) {
      const k = _mKeyOf(e);
      if (oSeen.has(k)) continue; oSeen.add(k);
      const inT = tM.has(k), inB = bM.has(k);
      if (inT) out.push(mergeCloudDoc(inB ? bM.get(k) : undefined, e, tM.get(k)));
      else if (!(inB && _mEq(e, bM.get(k)))) out.push(e);
    }
    for (const e of theirs) {
      const k = _mKeyOf(e);
      if (oSeen.has(k)) continue;
      const inB = bM.has(k);
      if (!(inB && _mEq(e, bM.get(k)))) out.push(e);
    }
    return out;
  }
  if (!_mIsObj(ours) || !_mIsObj(theirs)) return ours;
  const b = _mIsObj(base) ? base : {};
  const out = {};
  for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const inO = has(ours, k), inT = has(theirs, k), inB = has(b, k);
    if (inO && inT) { out[k] = mergeCloudDoc(b[k], ours[k], theirs[k]); continue; }
    if (inO && !inT) { if (!(inB && _mEq(ours[k], b[k]))) out[k] = ours[k]; continue; }
    if (!inO && inT) { if (!(inB && _mEq(theirs[k], b[k]))) out[k] = theirs[k]; continue; }
  }
  return out;
};

// NEW-1 — for TASK content comparison only (countChangedTaskRows/changedProjectIds below): map this
// array's own positional `id` → its permanent `_sid`, then rewrite a task's cross-reference fields
// (parentId/predecessors[].id/deadlineForTaskId/minMeetingsAfter.taskId) from the renumbered id they
// point at to that SAME stable sid before comparing two snapshots for equality. Without this, an
// insert/delete/indent/outdent ANYWHERE in a schedule shifts the positional id of every task after
// it, and every OTHER task that merely references one of those (as a parent or predecessor) reads
// as "changed" too — a single insert can inflate the count to "every row below it". A lookup miss
// (a dangling reference, or data with no `_sid` at all) falls back to the raw id unchanged, so a
// genuine mismatch can never be turned into a false match.
export const _taskSidMap = tasks => { const m = new Map(); (tasks || []).forEach(t => { if (t && t._sid != null) m.set(t.id, t._sid); }); return m; };

export const _taskKey = t => (t && t._sid != null) ? ("sid:" + t._sid) : (t ? t.id : t);

export const _taskFingerprint = (t, sidOf) => {
  if (!t || typeof t !== "object") return t;
  const rest = omitKeys(t, ["id", "_sid", "focused"]);   // id/_sid: identity, compared separately; focused: view-only (B1107680-class), never content
  if (rest.parentId != null) rest.parentId = sidOf.get(rest.parentId) ?? rest.parentId;
  if (Array.isArray(rest.predecessors)) rest.predecessors = rest.predecessors.map(p => (p && p.id != null) ? { ...p, id: sidOf.get(p.id) ?? p.id } : p);
  if (rest.deadlineForTaskId != null) rest.deadlineForTaskId = sidOf.get(rest.deadlineForTaskId) ?? rest.deadlineForTaskId;
  if (rest.minMeetingsAfter && rest.minMeetingsAfter.taskId != null) {
    rest.minMeetingsAfter = { ...rest.minMeetingsAfter, taskId: sidOf.get(rest.minMeetingsAfter.taskId) ?? rest.minMeetingsAfter.taskId };
  }
  return rest;
};

// NEW-3 (B1696642) — how many task rows a merge actually brought in from elsewhere, so the toast
// can say WHAT changed instead of guessing WHERE it came from (the cloud row this merge reads carries
// no tab/window/device identity — see the `planar:merged` listener). Compares this tab's own doc as
// of save-start (`before`, i.e. `preOurs`) against the merged result (`after`): a task row added,
// removed, or changed between the two is exactly what the foreign save contributed, since `after` is
// the 3-way merge of the true ancestor, `before`, and the newer cloud copy. Pure — unit-tested in 
// test/schedulerEngine.test.js.
export const countChangedTaskRows = (before, after) => {
  try {
    const bp = (before && before.projects) || {};
    const ap = (after && after.projects) || {};
    let n = 0;
    new Set([...Object.keys(bp), ...Object.keys(ap)]).forEach(pid => {
      const bTasks = bp[pid]?.tasks || [], aTasks = ap[pid]?.tasks || [];
      const bSid = _taskSidMap(bTasks), aSid = _taskSidMap(aTasks);
      const bt = {}; bTasks.forEach(t => { if (t) bt[_taskKey(t)] = t; });
      const at = {}; aTasks.forEach(t => { if (t) at[_taskKey(t)] = t; });
      new Set([...Object.keys(bt), ...Object.keys(at)]).forEach(key => {
        if (!_mEq(_taskFingerprint(bt[key], bSid), _taskFingerprint(at[key], aSid))) n++;
      });
    });
    return n;
  } catch { return 0; }
};

// B1777120 — pure decomposition of the whole-account cloud document into the shape the
// dual-write path upserts into public.schedules / public.schedule_account_index. Mirrors
// schedules_decompose_from_planar_data() in
// src/workspaces/scheduler/db/schedules_decompose_recompose.sql field-for-field; `data` per
// schedule stays the COMPLETE untouched project object, matching that SQL function's own
// documented shape decision. Pure — no Supabase calls — so dualWriteScheduleRows (defined in
// the storage IIFE below, where `sb` is in scope) stays trivially thin. unit-tested in 
// test/schedulerEngine.test.js.
export const decomposeForDualWrite = doc => {
  if (!doc || typeof doc !== "object") return null;
  const projects = (doc.projects && typeof doc.projects === "object") ? doc.projects : {};
  const schedules = Object.keys(projects).map(pid => {
    const proj = projects[pid];
    const id = Number(pid);
    if (!Number.isFinite(id)) return null;
    return {
      id,
      name: (proj && typeof proj.name === "string") ? proj.name : "",
      linkedSiteId: (proj && proj.linkedSiteId != null) ? proj.linkedSiteId : null,
      linkedSiteName: (proj && proj.linkedSiteName != null) ? proj.linkedSiteName : null,
      data: proj,
    };
  }).filter(Boolean);
  const { nPid, nTid, lastActiveBySite, settings } = doc;
  const migrationFlags = omitKeys(doc, ["projects", "nPid", "nTid", "lastActiveBySite", "settings", "__rev"]);
  return {
    index: {
      nPid: typeof nPid === "number" ? nPid : 1,
      nTid: (nTid && typeof nTid === "object") ? nTid : {},
      lastActiveBySite: (lastActiveBySite && typeof lastActiveBySite === "object") ? lastActiveBySite : {},
      settings: (settings && typeof settings === "object") ? settings : {},
      migrationFlags,
    },
    schedules,
  };
};

// B1777120 — pure reverse of decomposeForDualWrite: rebuilds the "hs-v1" document shape from
// one account index row + its schedule rows. Mirrors schedules_recompose_to_planar_data()
// field-for-field (see that SQL function's header for why __rev is never reconstructed here
// either — a caller that needs one, e.g. the dual-read scaffold below, attaches it itself from
// a separate cheap read). Returns null when there's no index row to build from (the caller's
// signal to fall back to the blob). Pure — no Supabase calls. unit-tested in 
// test/schedulerEngine.test.js.
export const recomposeFromRows = (indexRow, scheduleRows) => {
  if (!indexRow || typeof indexRow !== "object") return null;
  const projects = {};
  (Array.isArray(scheduleRows) ? scheduleRows : []).forEach(row => {
    if (!row || row.id == null) return;
    projects[String(row.id)] = row.data;
  });
  return {
    ...(indexRow.migration_flags && typeof indexRow.migration_flags === "object" ? indexRow.migration_flags : {}),
    nPid: typeof indexRow.n_pid === "number" ? indexRow.n_pid : 1,
    nTid: (indexRow.n_tid && typeof indexRow.n_tid === "object") ? indexRow.n_tid : {},
    lastActiveBySite: (indexRow.last_active_by_site && typeof indexRow.last_active_by_site === "object") ? indexRow.last_active_by_site : {},
    settings: (indexRow.settings && typeof indexRow.settings === "object") ? indexRow.settings : {},
    projects,
  };
};
