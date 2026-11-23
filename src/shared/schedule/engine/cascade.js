// src/shared/schedule/engine/cascade.js
//
// The cascade: pushing a changed start/end through predecessors, rolling parents up, the recompute passes, drift detection and repair.
//
// Pure functions only (no React, no DOM). The Schedule page (public/sequence/index.html) gets this code
// through the generated script public/sequence/engine.js (npm run build:sequence-engine), and the unit
// tests import it directly — ONE copy, no paste-in. Moved here verbatim from the page (audit batch J1);
// behaviour is unchanged.
import { MEETING_BODY_INDEX, agendaDeadline, meetingDatesInRange, nextEligibleMeeting } from "./meetings.js";
import { addD, difBD } from "./calendar.js";
import { constrainedStartFrom, normPreds, resolveTaskSpan, startForEnd, workdaysBetween } from "./predecessors.js";

// ── B816 (NEW-2) — snap a meeting-bound task to its body's cadence ──────────────
// A bound task is a MILESTONE on the chosen meeting day (duration forced 0). The chosen meeting
// is the EARLIEST whose agenda deadline the packet can still make — agendaDeadline(m) >= packetReady,
// NOT simply the next meeting after packetReady (that silently puts items on agendas they can't be
// filed for). `meetingDeadline`/`meetingInfeasible` are DERIVED-for-display: recomputed every cascade,
// never read back as input, never a task row (precedent B583). PURE — Unit-tested in test/schedulerEngine.test.js.
export const applyMeetingBinding = (t, body, predEarly, drivingMeetingDate, minAfterDate) => {
  t.duration = 0;
  const pinnedDate = t.pinnedMeetingDate || (t.pinnedStart ? t.start : "");
  const packetReady = predEarly || (pinnedDate ? "" : t.start) || "";
  if (pinnedDate) {                                   // a person fixed this hearing — pin wins, never roll
    t.start = t.end = pinnedDate;
    t.meetingDeadline = agendaDeadline(body, pinnedDate) || "";
    // NEW-1 — a pinned date can be infeasible TWO different ways, and only one of them was ever
    // checked. `pinnedDate` here is usually `pinnedStart` (updateTask sets that on ANY direct
    // date-cell edit — see its own comment); `pinnedMeetingDate` is a distinct deliberate-pin field that
    // right-click Next/Previous meeting DOES set (onStepMeeting) and that a person's date edit now clears
    // (resolveBoundEdit/dropStep, B2642096 ×2), so a plain typed/dragged date on a meeting-bound row was
    // silently accepted even when it doesn't fall on one of the body's actual meeting days at all —
    // reading as "feasible" while the row isn't parked on a real hearing. Owner repro: Goose Creek
    // task 168 sat on 2026-09-30 (not a 3rd-Tuesday P&Z date; the real September meeting was
    // 2026-09-15) with meetingInfeasible reading false. Flag BOTH conditions LOUDLY.
    t.meetingDateOffCalendar = !meetingDatesInRange(body, pinnedDate, pinnedDate).length;
    // Infeasible: the predecessor chain can't deliver the packet by the pinned meeting's agenda
    // deadline, OR the pinned date isn't a real meeting day for this body at all.
    t.meetingInfeasible = t.meetingDateOffCalendar || !!(packetReady && t.meetingDeadline && packetReady > t.meetingDeadline);
    return;
  }
  if (!packetReady) {                                 // nothing schedules it yet — stays blank (B386)
    t.start = t.end = ""; t.meetingDeadline = ""; t.meetingInfeasible = false; t.meetingDateOffCalendar = false;
    return;
  }
  // "must be the n-th subsequent meeting" — computed once, up front, so both the fixed-point
  // guard below AND the full re-derivation further down read the SAME floor.
  let minAfterFloor = "";
  if (t.minMeetingsAfter && t.minMeetingsAfter.n > 0 && minAfterDate) {
    const seq = meetingDatesInRange(body, addD(minAfterDate, 1), addD(minAfterDate, 366 * 3));
    const nth = seq[t.minMeetingsAfter.n - 1];
    if (nth) minAfterFloor = addD(nth, -1);
  }
  // Fixed-point guard: with NO real predecessor-derived date (no live predecessor edge, no driving
  // meeting), packetReady falls back to this task's OWN previously-snapped start — true whether or
  // not a minMeetingsAfter floor also applies. Re-deriving eligibility from a self-referential date
  // would RATCHET one meeting forward per cascade (the deadline always precedes its meeting, so a
  // meeting is never "eligible" from its own date). If the start is still one of the body's meetings
  // AND still clears the minMeetingsAfter floor, keep it; only a stale/cancelled/blacked-out/
  // no-longer-eligible date falls through and re-snaps forward from here.
  // NEW-1 (owner report 2026-09-16: a Master Schedule task auto-recalculated on EVERY load, moving
  // ~3 months forward each time) — this guard used to exempt itself the instant minMeetingsAfter was
  // set, on the wrong theory that minMeetingsAfter always supplies an external anchor. It doesn't:
  // minMeetingsAfter only ever tightens `afterDate` (a floor), never `readyDate` itself, so a
  // pred-less, non-driven, minMeetingsAfter-only bound task fed its own prior start right back into
  // the search — exactly the self-reference this guard exists to stop — and ratcheted forward one
  // (or more) meetings on every single load, forever, writing the drifted date back each time.
  if (!predEarly && !drivingMeetingDate) {
    if ((!minAfterFloor || packetReady > minAfterFloor) && meetingDatesInRange(body, packetReady, packetReady).length) {
      t.start = t.end = packetReady;
      t.meetingDeadline = agendaDeadline(body, packetReady) || "";
      t.meetingInfeasible = false; t.meetingDateOffCalendar = false;
      return;
    }
  }
  let readyDate = packetReady, afterDate = "";
  if (drivingMeetingDate) {                           // the driving predecessor is itself a meeting (1st→2nd reading)
    afterDate = drivingMeetingDate;
    // sameDayFilingAllowed=false: the next agenda closed before this evening's meeting → strict.
    if (!body.sameDayFilingAllowed) { const nd = addD(drivingMeetingDate, 1); if (nd > readyDate) readyDate = nd; }
  }
  if (minAfterFloor && (!afterDate || minAfterFloor > afterDate)) afterDate = minAfterFloor;
  const elig = nextEligibleMeeting(body, readyDate, afterDate);
  if (elig) { t.start = t.end = elig.meetingDate; t.meetingDeadline = elig.deadline; t.meetingInfeasible = false; t.meetingDateOffCalendar = false; }
  else { t.start = t.end = ""; t.meetingDeadline = ""; t.meetingInfeasible = false; t.meetingDateOffCalendar = false; }
};

// Topological cascade: recompute start/end for all tasks driven by predecessors.
// `bodies` (B816) = the project's meetingBodies[]; a bound task snaps to its body's cadence.
export const cascadeDates = (tasks, bodies = []) => {
  const bodyMap = {...MEETING_BODY_INDEX};
  (Array.isArray(bodies) ? bodies : []).forEach(b => { if (b && b.id) bodyMap[b.id] = b; });
  const parentIds = new Set(tasks.filter(t => t.parentId !== null && t.parentId !== undefined).map(t => t.parentId));
  const map = {};
  tasks.forEach(t => { map[t.id] = {...t, predecessors: normPreds(t.predecessors)}; });
  // NEW-1 (owner report 2026-09-16) — a predecessor edge naming one of THIS task's own ANCESTORS
  // (its parent, grandparent, …) is not resolvable: an ancestor's dates are ALWAYS rollup-derived
  // from every descendant (this task included — see rollupParentDates), so treating that ancestor
  // as a predecessor closes a cycle through the rollup that validatePredEdit's graph-cycle check
  // never sees (rollup is a completely separate dependency channel from the predecessor graph it
  // walks). Left alone, every cascade pass reads the ancestor's END — rolled up from the LAST pass,
  // which already folds in THIS task's own just-advanced end — and derives a strictly LATER date
  // from it, with no fixed point: the live symptom (Michael's real "HW Review" task, a child of
  // "Contract" naming "Contract" itself as an FS predecessor, recalculating to a new, later date on
  // EVERY load, forever, and persisting it). Cycle-guarded so a corrupted parentId chain can't loop.
  const isAncestorOf = (ancestorId, taskId) => {
    let p = map[taskId] && map[taskId].parentId, seenP = new Set([taskId]);
    while (p != null && map[p] && !seenP.has(p)) {
      if (p === ancestorId) return true;
      seenP.add(p); p = map[p].parentId;
    }
    return false;
  };
  const adj = {}; const inDeg = {};
  tasks.forEach(t => { adj[t.id] = []; inDeg[t.id] = 0; });
  tasks.forEach(t => map[t.id].predecessors.forEach(p => {
    if (map[p.id]) { adj[p.id].push(t.id); inDeg[t.id]++; }
  }));
  const queue = tasks.filter(t => inDeg[t.id] === 0).map(t => t.id);
  const seen = new Set(queue);
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    (adj[id]||[]).forEach(sid => {
      inDeg[sid]--;
      if (inDeg[sid] <= 0 && !seen.has(sid)) { seen.add(sid); queue.push(sid); }
    });
  }
  tasks.forEach(t => { if (!seen.has(t.id)) queue.push(t.id); });

  queue.forEach(id => {
    const t = map[id];
    const preds = t.predecessors.filter(p => map[p.id] && !isAncestorOf(p.id, id));
    // B443249 — predecessors that contribute NO date: an id with no row in this project (missing), or a
    // live row that has no dates of its own yet (unscheduled). Both were dropped in total silence by the
    // filters above/below, so the successor rendered a confident date derived from a SUBSET of its stated
    // inputs and nothing anywhere said so (LOUD-FAILURE). Recorded per task so the grid can mark them.
    // Topological order guarantees a live predecessor is already resolved when we read it here.
    // NEW-1 — an ancestor-referencing edge is ALSO recorded here (never silently dropped) so the
    // Predecessors cell flags it exactly like any other predecessor that drives nothing.
    t.predUnresolved = t.predecessors
      .filter(p => !map[p.id] || !(map[p.id].end || map[p.id].start) || isAncestorOf(p.id, id))
      .map(p => p.id);
    // A meeting-bound task (B816): a real body, not a summary/parent (parents come from rollup), not a
    // locked finish (bound+pinnedEnd is rejected on entry — if both are set the lock wins as a safe fallback).
    const bound = !!(t.meetingBound && bodyMap[t.meetingBodyId] && !parentIds.has(t.id) && !(t.pinnedEnd && t.end));
    // B864 — bound to a calendar that NO LONGER EXISTS (a lost meeting body — the multi-writer clobber
    // that left task 88's election date orphaned when a stale tab dropped settings.meetingBodies). Do NOT
    // silently revert it to a plain FS date (that wipes the intended meeting date); PRESERVE the stored
    // date (soft-pin, below) and flag it LOUDLY so the row surfaces the broken binding (LOUD-FAILURE).
    const bodyMissing = !!(t.meetingBound && !bodyMap[t.meetingBodyId] && !parentIds.has(t.id));
    t.meetingBodyMissing = bodyMissing;
    // ── B443248 — A SUMMARY ROW'S DATES ARE OWNED BY rollupParentDates, NEVER BY THIS LOOP ──────────
    // Deriving a parent's span here treated it as a leaf and read durValue/durUnit — fields a parent does
    // not carry (rollup writes the derived `duration` only, leaving durValue at its 0 default). So a
    // 40-working-day summary COLLAPSED to a 0-day milestone sitting on its own start, and every FS
    // successor was then scheduled off that collapsed end. That is the owner-reported "Mobilize" defect:
    // Grand Port task 228 landed on 2026-08-10 — the next working day after parent 108's START — instead
    // of 2026-10-05, the next working day after its real FINISH. rollupParentDates restored the parent's
    // end immediately afterwards, which is why the wrong successor date was a STABLE fixed point: re-running
    // the recompute reproduced it exactly, and detectCascadeDrift (stored vs engine) could never see it.
    // Parents never took a predecessor-driven start either (the rollup overwrote it in the same breath), so
    // skipping is behaviour-preserving for the parent itself and CORRECT for every row reading its finish.
    if (parentIds.has(t.id)) { t.finishConflict = false; t.startConflict = false; return; }
    // Locked FINISH (B616): the end is a FIXED POINT — successors cascade from it, the start
    // back-calcs to preserve the working-day duration, and the end never moves/exceeds the lock.
    // If the predecessor chain can't fit the duration before the locked finish, flag a LOUD
    // conflict (t.finishConflict) rather than silently overwriting or overrunning the lock.
    if (t.pinnedEnd && t.end) {
      if (t.pinnedStart && t.start) {                                   // both endpoints pinned → span is fixed
        t.duration = t.start > t.end ? t.duration : Math.max(0, workdaysBetween(t.start, t.end));
        t.finishConflict = !!(t.start && t.start > t.end);
      } else {
        const backStart = startForEnd(t.end, t.duration);
        t.start = backStart;
        let conflict = false;
        if (preds.length) {
          const earliest = preds.map(p => constrainedStartFrom(map[p.id], p, t.duration)).filter(Boolean).reduce((a,b) => a>b?a:b, "");
          if (earliest && earliest > backStart) conflict = true;       // chain forces a start too late to finish on time
        }
        t.finishConflict = conflict;
      }
      return;
    }
    t.finishConflict = false;
    t.startConflict = false;
    // The predecessor-derived earliest start ("packet ready"), computed even for pinned tasks so a
    // bound task can test feasibility against it.
    const predEarly = preds.length
      ? preds.map(p => constrainedStartFrom(map[p.id], p, Math.max(1, t.duration || 1))).filter(Boolean).reduce((a,b)=>a>b?a:b, "")
      : "";
    // Normal (unbound) derivation — also produces the packet-ready start for a bound task.
    // B864: an orphaned bound task that HAS a stored date holds it like a pin, so preds can't overwrite
    // the intended meeting date; end/duration still re-derive from that preserved start. A bound task with
    // NO stored date has nothing to lose, so it falls through to normal FS scheduling (unchanged behavior).
    if (!preds.length || t.pinnedStart || (bodyMissing && t.start)) {
      const r = resolveTaskSpan(t); t.end = r.end; t.duration = r.duration;
      // B443250 — a pinned start WINS over the chain (that is the contract, and it stays), but a pin that
      // sits BEFORE the chain allows is a real conflict that used to be resolved in total silence. Flag it
      // so the row says the logic is being overridden, exactly as a locked finish already does (B616).
      if (t.pinnedStart && t.start && predEarly && predEarly > t.start) t.startConflict = true;
    }
    else {
      const starts = preds.map(p => constrainedStartFrom(map[p.id], p, t.duration)).filter(Boolean);
      if (starts.length) t.start = starts.reduce((a,b) => a>b?a:b, starts[0]);
      const r = resolveTaskSpan(t); t.end = r.end; t.duration = r.duration;
    }
    // ── B816 (NEW-2) — meeting-bound snap (a fifth orthogonal branch after the normal derivation) ──
    if (bound) {
      const drivingMeetingDate = preds
        .filter(p => map[p.id] && map[p.id].meetingBound && map[p.id].start).map(p => map[p.id].start)
        .reduce((a,b) => a>b?a:b, "");
      const minAfterDate = (t.minMeetingsAfter && map[t.minMeetingsAfter.taskId]) ? map[t.minMeetingsAfter.taskId].start : "";
      applyMeetingBinding(t, bodyMap[t.meetingBodyId], predEarly, drivingMeetingDate, minAfterDate);
    } else if (bodyMissing) {
      // B864: the stored start/end are preserved above; feasibility can't be recomputed without the body,
      // so clear the (now-unverifiable) alert but KEEP the last-known meetingDeadline for context.
      t.meetingInfeasible = false; t.meetingDateOffCalendar = false;
    } else if (t.meetingDeadline || t.meetingInfeasible || t.meetingDateOffCalendar) {
      t.meetingDeadline = ""; t.meetingInfeasible = false; t.meetingDateOffCalendar = false;   // stale derived fields on a now-unbound task
    }
  });
  // ── Deadline rows — a task linked via deadlineForTaskId ALWAYS sits on its anchor's derived
  // call/file-by date (anchor.meetingDeadline), so the pair can never diverge and the deadline row
  // rolls with the meeting. One-way derivation (deliberately NOT a predecessor link — the anchor's
  // meeting-eligibility would then depend on a row whose date depends on the anchor: circular).
  // Post-pass: every anchor's meetingDeadline is final after the topo loop above. The natural
  // (pred-driven) date captured before the override feeds deadlineInfeasible — "your work lands
  // after the call-by date". Dangling/unbound anchor → keep the natural date, clear the flag.
  tasks.forEach(x => {
    const t = map[x.id];
    if (t.deadlineForTaskId == null || t.meetingBound || parentIds.has(t.id)) { if (t.deadlineInfeasible) t.deadlineInfeasible = false; return; }
    const anchor = map[t.deadlineForTaskId];
    if (!anchor || !anchor.meetingBound || !anchor.meetingDeadline) { t.deadlineInfeasible = false; return; }
    const hasLivePreds = t.predecessors.some(p => map[p.id]);
    const naturalStart = hasLivePreds ? t.start : "";   // a stored date without preds is stale, not a constraint
    t.start = t.end = anchor.meetingDeadline; t.duration = 0;
    t.deadlineInfeasible = !!(naturalStart && naturalStart > anchor.meetingDeadline);
  });
  return tasks.map(t => { const {_pinStart, __wasDirectEdit, ...rest} = map[t.id] || t; return rest; });
};

// Roll up parent start/end/duration from their children (bottom-up, iterates until stable)
export const rollupParentDates = tasks => {
  const map = {};
  tasks.forEach(t => { map[t.id] = {...t}; });
  const parentIds = new Set(tasks.filter(t => t.parentId !== null).map(t => t.parentId));
  if (!parentIds.size) return tasks;
  // Index children by parent ONCE. parentId never changes during rollup (only dates do),
  // so re-deriving the child list every pass with Object.values(map).filter was O(parents×n)
  // per pass — an O(n²·depth) blow-up that froze deeply-nested schedules (~11s at 1000 levels).
  // A Map keyed by the raw parentId value preserves the original strict-equality grouping.
  const childIdsByParent = new Map();
  tasks.forEach(t => {
    const p = t.parentId;
    if (p === null || p === undefined) return;
    if (!childIdsByParent.has(p)) childIdsByParent.set(p, []);
    childIdsByParent.get(p).push(t.id);
  });
  // Process parents deepest-first so a parent's children are already final when it's
  // read → the convergence loop settles in a single pass instead of O(depth) passes
  // (the while-loop stays as the correctness backstop). depthOf walks parentId upward
  // with a seen-set so a parentId cycle can't loop forever.
  const depthOf = id => {
    let d = 0, cur = id; const seen = new Set();
    while (cur !== null && cur !== undefined && map[cur] && !seen.has(cur)) { seen.add(cur); cur = map[cur].parentId; d++; }
    return d;
  };
  const ordered = [...parentIds].sort((a, b) => depthOf(b) - depthOf(a));
  let changed = true;
  while (changed) {
    changed = false;
    ordered.forEach(pid => {
      if (!map[pid]) return;   // orphaned parentId (points to a deleted/missing task) — skip, don't crash
      const children = (childIdsByParent.get(pid) || []).map(id => map[id]).filter(Boolean);
      if (!children.length) return;
      // Ignore children with empty start/end so a blank new task doesn't drag the parent dates to ""
      const validStarts = children.map(t => t.start).filter(Boolean);
      const validEnds   = children.map(t => t.end  ).filter(Boolean);
      if (!validStarts.length || !validEnds.length) return; // all children blank → leave parent as-is
      const newStart = validStarts.reduce((a,b) => a<b?a:b);
      const newEnd   = validEnds.reduce((a,b) => a>b?a:b);
      const newDur   = (newStart === newEnd && children.every(c => c.duration === 0)) ? 0 : Math.max(0, difBD(newStart, newEnd) + 1);
      if (map[pid].start !== newStart || map[pid].end !== newEnd || map[pid].duration !== newDur) {
        map[pid] = {...map[pid], start: newStart, end: newEnd, duration: newDur};
        changed = true;
      }
    });
  }
  return tasks.map(t => map[t.id]);
};

// B443248 — THE recompute. A summary row's dates come from its children (rollup) while its successors'
// dates come from the cascade, so ONE cascade→rollup pass can leave a successor a generation behind
// whenever a parent's own dates moved during that pass. Two changes make the pair correct:
//   • seed with a rollup, so the FIRST cascade reads real parent finishes rather than whatever the stored
//     (possibly stale) parent row happened to say, and
//   • iterate to a FIXED POINT, so a move propagates transitively down a chain of any depth in one call.
// PASS_CAP is a runaway guard, never the normal exit — a real schedule settles in two passes (the second
// only proves stability). Every cascade+rollup call site goes through this; none of them pairs by hand.
export const RECOMPUTE_PASS_CAP = 12;

export const recomputeSchedule = (tasks, bodies = []) => {
  let out = rollupParentDates(tasks);
  for (let i = 0; i < RECOMPUTE_PASS_CAP; i++) {
    const next = rollupParentDates(cascadeDates(out, bodies));
    const stable = next.length === out.length && next.every((t, k) => t.start === out[k].start && t.end === out[k].end);
    out = next;
    if (stable) break;
  }
  return out;
};

// Recompute leaf cascade + parent roll-ups after a STRUCTURAL move (indent / outdent /
// paste) that changes parentId. Without this the moved task's old and new parents keep
// stale summary start/end/duration until the next in-subtree date edit happens to run
// the rollup — the same recompute updateTask runs after a date edit. Pure; preserves
// array order (so a caller can still renumber afterwards).
export const recomputeAfterStructureChange = tasks => recomputeSchedule(tasks);

// B835 (recurrence ×2) — the SCHEDULING-INPUT fields. Editing ANY of these can move this task's OR a
// successor's dates, so updateTask must re-run cascadeDates + rollupParentDates before it persists. The
// gate used to be a hand-maintained OR-list that omitted `durValue`/`durUnit` (the B615 typed-duration
// commit — the grid + master-view duration cells send {durValue,durUnit}, never {duration}) and
// `pinnedStart`/`pinnedEnd` (unpin / unlock-finish send {pinnedStart:false,…} / {pinnedEnd:false,durValue,durUnit}).
// Those edits resolved the EDITED task's own end but never cascaded, so successors kept STALE dates —
// and the stale value was persisted. B835's first pass wrongly concluded "no code bug"; the live repro
// (hs-v1: task 82's duration changed 45cd→45d, its FS successor 83 never re-flowed) is exactly this gap.
// Anything NOT in this set (name, health, %-complete, notes, color,
// focused, isExpanded, responsibleParty, cost, icons) can never move a date, so it correctly skips the cascade.
// Unit-tested in test/schedulerEngine.test.js.
export const SCHEDULE_INPUT_KEYS = ['start','end','duration','durValue','durUnit','predecessors','pinnedStart','pinnedEnd','meetingBound','meetingBodyId','pinnedMeetingDate','minMeetingsAfter','deadlineForTaskId'];

export const touchesSchedule = updates => !!updates && SCHEDULE_INPUT_KEYS.some(k => k in updates);

// B836 — cascade-drift detector. A non-pinned task's SAVED start should always equal the start its
// predecessor chain implies. When it doesn't (a stale value from an older build, a hand-edited store,
// or a lag zeroed without a re-cascade — B835), the load re-cascade silently corrects it. This returns
// the corrected leaf tasks so the load path can surface the change LOUDLY (a banner) instead of swapping
// the number in silence. Pins are exempt (a pinned start is intentional); parents are excluded (their
// dates are always rollup-derived, not cascade drift). Pure — Unit-tested in test/schedulerEngine.test.js.
export const detectCascadeDrift = (storedTasks, engineTasks) => {
  const eng = {}; (engineTasks || []).forEach(t => { eng[t.id] = t; });
  const parentIds = new Set((storedTasks || []).map(t => t.parentId).filter(p => p !== null && p !== undefined));
  const out = [];
  (storedTasks || []).forEach(t => {
    if (t.pinnedStart || (t.pinnedEnd && t.end)) return;   // intentional pins are exempt
    // B864 — meeting-bound + deadline rows are date-DERIVED by their own mechanism (the calendar / the
    // anchor's deadline), not the simple FS cascade — so a stored≠engine difference is a legitimate re-snap,
    // not drift. Exempt them like pins, so a re-snap (or an orphaned binding whose date we now preserve)
    // never fires the drift banner.
    if (t.meetingBound || t.deadlineForTaskId != null) return;
    if (parentIds.has(t.id)) return;                       // parents are rollup-derived, not cascade drift
    const e = eng[t.id];
    if (!e) return;
    const was = t.start || "", now = e.start || "";
    if (was !== now) out.push({ id: t.id, name: t.name || t.title || ("Task " + t.id), from: was, to: now });
  });
  return out;
};

// NEW-1 (B1696640) — ancestor ids of `id` within `tasks`, walking the parentId chain upward
// (seen-set guards a corrupt parentId cycle — same defense as normalizeIds' own walk). A parent's
// dates are the ROLLUP of its children (rollupParentDates), so a task predecessor-linked to any of
// its own ancestors chases that rollup forever: the child's start derives from the ancestor's
// finish, and the ancestor's finish is in part derived from that same child's finish. cascadeDates
// skips computing a parent's OWN date from predecessors entirely (B443248 — `if
// (parentIds.has(t.id)) return`), so this can never be resolved by iterating harder;
// recomputeSchedule's 12-pass cap just stops mid-ratchet, the un-converged dates get saved, and the
// NEXT load ratchets further still. Shared by validatePredEdit (blocks the edge at entry) and
// stripAncestorPredecessors (repairs data that already has it). Pure — unit-tested in 
// test/schedulerEngine.test.js.
export const ancestorIdsOf = (tasks, id) => {
  const byId = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => { if (t) byId[t.id] = t; });
  const out = new Set();
  const seen = new Set([id]);
  let p = byId[id] ? byId[id].parentId : null;
  while (p != null && byId[p] && !seen.has(p)) { out.add(p); seen.add(p); p = byId[p].parentId; }
  return out;
};

// NEW-1 (B1696640) — repair data that already has the ancestor-predecessor edge above: drop only
// the offending link(s) from each affected task, leaving every other predecessor untouched. Returns
// the fixed tasks plus a `removed` list (id/name/parentId/droppedIds) so the load path can surface
// exactly which rows were touched (LOUD-FAILURE), rather than silently swapping the dates. Pure —
// Unit-tested in test/schedulerEngine.test.js.
export const stripAncestorPredecessors = tasks => {
  const list = Array.isArray(tasks) ? tasks : [];
  const removed = [];
  const fixed = list.map(t => {
    if (!t) return t;
    const preds = normPreds(t.predecessors);
    if (!preds.length) return t;
    const ancestors = ancestorIdsOf(list, t.id);
    if (!ancestors.size) return t;
    const droppedIds = preds.filter(p => ancestors.has(p.id)).map(p => p.id);
    if (!droppedIds.length) return t;
    removed.push({ id: t.id, name: t.name || t.title || ("Task " + t.id), parentId: t.parentId, droppedIds });
    return { ...t, predecessors: preds.filter(p => !ancestors.has(p.id)) };
  });
  return { tasks: fixed, removed };
};

// B836 — load-path glue: run the normal recompute (cascade → rollup) on a project's already-stripped
// tasks AND record any drift it corrected into `driftSink`. Keeps the load sites DRY and identical.
// NEW-1 (B1696640) — ALSO strips any ancestor-predecessor edge before the recompute ever runs (that
// edge can never converge — see stripAncestorPredecessors above), recording what it dropped into
// `ancestorSink`. A row whose predecessors were just repaired is reported ONLY there, not a second
// time in `driftSink` too — its date moved BECAUSE of the repair, so the ancestor notice is the
// complete explanation and a duplicate "recalculated" line would just be confusing noise.
export const recascadeWithDrift = (tasks, pid, projName, driftSink, ancestorSink) => {
  const { tasks: clean, removed } = stripAncestorPredecessors(tasks);
  if (removed.length && ancestorSink) ancestorSink.push({ project: projName, pid, tasks: removed });
  const out = recomputeSchedule(clean);                 // the recompute returns NEW objects — `clean` keeps its stored starts for the diff
  const removedIds = new Set(removed.map(r => r.id));
  const dr = detectCascadeDrift(clean, out).filter(d => !removedIds.has(d.id));
  if (dr.length) driftSink.push({ project: projName, pid, tasks: dr });
  return out;
};
