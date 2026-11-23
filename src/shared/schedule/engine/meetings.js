// src/shared/schedule/engine/meetings.js
//
// Meeting bodies (the governmental meeting calendars a task can be bound to): recurrence, agenda deadlines, bound-date resolution, pins and pin conflicts, importing bodies between schedules.
//
// Pure functions only (no React, no DOM). The Schedule page (public/sequence/index.html) gets this code
// through the generated script public/sequence/page.js (npm run build:sequence-page), and the unit
// tests import it directly — ONE copy, no paste-in. Moved here verbatim from the page (audit batch J1);
// behaviour is unchanged.
import { addD, dif, difBD, fdLocal, pd, subBD } from "./calendar.js";
import { constrainedStartFrom, normPreds } from "./predecessors.js";
import { isCompleteTask } from "../healthEngine.js";
import { crossScheduleLabel } from "../scheduleOwnership.js";

// occurrencesInMonth (NEW-1): every ISO date within month m (1-12) of year y matching `weekday`
// (0=Sun..6=Sat), ascending. The one primitive nthWeekdayOfMonth/positionMissingReport/
// meetingDatesInRange all build on — no second occurrence-walker anywhere in this file.
export const occurrencesInMonth = (y, m, weekday) => {
  const out = [];
  const d = new Date(y, m - 1, 1);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  while (d.getMonth() === m - 1) { out.push(fdLocal(d)); d.setDate(d.getDate() + 7); }
  return out;
};

// pickOrdinal: the `pos`-th date from an ascending list — pos>0 counts from the start (1..5 =
// 1st..5th), pos<0 counts from the end (-1 = last, -2 = 2nd-to-last). Null when the list is too
// short (a 5th Tuesday in a 4-Tuesday month, or -2 in a month with only one occurrence).
export const pickOrdinal = (dates, pos) => {
  if (!Array.isArray(dates) || !dates.length || pos == null) return null;
  const idx = pos > 0 ? pos - 1 : dates.length + pos;
  return (idx >= 0 && idx < dates.length) ? dates[idx] : null;
};

// nthWeekdayOfMonth: the `pos`-th occurrence of `weekday` in month m/year y as an ISO date;
// pos: 1..5 = nth from month start, -1 = last, -2 = 2nd-to-last. Null when it doesn't exist.
// Reuses nthWeekday + fdLocal (no UTC one-day slip — B584 #19) via occurrencesInMonth.
export const nthWeekdayOfMonth = (y, m, weekday, pos) => pickOrdinal(occurrencesInMonth(y, m, weekday), pos);

// meetingDatesInRange: sorted unique ISO meeting dates for `body` within [from,to] inclusive.
// NEW-1 (2026-09-22) — each recurrence rule is now { positions: 'every' | number[] (1..5, -1, -2),
// weekday, months: 'all' | number[], anchor: null | {position, weekday} }. `anchor` generalizes the
// old fixed "Tuesday after the 1st Monday" primitive to ANY weekday pair: positions are counted
// among the occurrences of `weekday` STRICTLY AFTER the anchor date within the same month — the
// anchor not existing that month (e.g. a "5th Monday" anchor) resolves to nothing for that month,
// never a crash. Applies each rule over its effective window, then removes blackoutDates and adds
// extraDates — EXPLICIT DATES ALWAYS BEAT THE RULE. `effectiveFrom`/`effectiveTo` bound a rule's
// active window (still supported — a real fixture pins a body's first-ever meeting this way).
// `interval` (bi-weekly / every-N-months) is a data-layer-only holdover from before this rewrite —
// the UI has never exposed it — kept only so a hand-edited body with it still resolves as it always
// did; the every-week week-stepped path below is its last user.
export const meetingDatesInRange = (body, from, to) => {
  if (!body || !from || !to || from > to) return [];
  const set = new Set();
  const inWin = (iso, r) => (!r.effectiveFrom || iso >= r.effectiveFrom) && (!r.effectiveTo || iso <= r.effectiveTo);
  const fromY = pd(from).getFullYear(), toY = pd(to).getFullYear();
  (Array.isArray(body.recurrence) ? body.recurrence : []).forEach(r => {
    if (!r || r.weekday == null) return;
    const isEvery = r.positions === "every";
    const hasAnchor = !!r.effectiveFrom;
    const interval = (r.interval > 1 && hasAnchor) ? Math.trunc(r.interval) : 1;
    if (isEvery && interval > 1 && !(Array.isArray(r.months) && r.months.length)) {
      const cur = pd(r.effectiveFrom);
      while (cur.getDay() !== r.weekday) cur.setDate(cur.getDate() + 1);
      const end = pd(to);
      let wk = 0;
      while (cur <= end) {
        const iso = fdLocal(cur);
        if (iso >= from && (wk % interval === 0) && inWin(iso, r)) set.add(iso);
        cur.setDate(cur.getDate() + 7); wk++;
      }
      return;
    }
    const months = (Array.isArray(r.months) && r.months.length) ? r.months : null;
    const anchor = (!isEvery && r.anchor && r.anchor.weekday != null && r.anchor.position != null) ? r.anchor : null;
    const positions = isEvery ? null : (Array.isArray(r.positions) ? r.positions : (r.positions != null ? [r.positions] : [1]));
    const anchorYM = r.effectiveFrom ? (pd(r.effectiveFrom).getFullYear() * 12 + pd(r.effectiveFrom).getMonth()) : null;
    const monthInterval = (r.interval > 1 && anchorYM != null) ? Math.trunc(r.interval) : 1;
    for (let y = fromY; y <= toY; y++) for (let m = 1; m <= 12; m++) {
      if (months && !months.includes(m)) continue;
      if (monthInterval > 1 && ((((y * 12 + (m - 1) - anchorYM) % monthInterval) + monthInterval) % monthInterval) !== 0) continue;
      let occ = occurrencesInMonth(y, m, r.weekday);
      if (anchor) {
        const anchorDate = nthWeekdayOfMonth(y, m, anchor.weekday, anchor.position);
        if (!anchorDate) continue;   // the anchor itself doesn't exist this month — nothing, no crash
        occ = occ.filter(iso => iso > anchorDate);
      }
      const picked = isEvery ? occ : positions.map(p => pickOrdinal(occ, p)).filter(Boolean);
      picked.forEach(iso => { if (iso >= from && iso <= to && inWin(iso, r)) set.add(iso); });
    }
  });
  (Array.isArray(body.blackoutDates) ? body.blackoutDates : []).forEach(d => set.delete(d));
  (Array.isArray(body.extraDates) ? body.extraDates : []).forEach(d => { if (d >= from && d <= to) set.add(d); });
  return [...set].sort();
};

// positionMissingReport: among the picked months (or all 12, if unrestricted), how many of the
// next 12 such month-instances (starting `today`'s month) produce NO date for this pattern —
// reuses meetingDatesInRange itself (never a second engine), so an anchor's own non-existence in a
// month folds in for free. Null for "every week" (always exists) or a pattern with no weekday.
export const positionMissingReport = (pattern, today) => {
  if (!pattern || pattern.positions === "every" || pattern.weekday == null || !today) return null;
  const wantedMonths = (Array.isArray(pattern.months) && pattern.months.length) ? pattern.months : [1,2,3,4,5,6,7,8,9,10,11,12];
  const start = pd(today);
  let y = start.getFullYear(), m = start.getMonth() + 1;
  let checked = 0, missing = 0;
  while (checked < 12) {
    if (wantedMonths.includes(m)) {
      const from = `${y}-${String(m).padStart(2,"0")}-01`;
      const to = fdLocal(new Date(y, m, 0));
      if (!meetingDatesInRange({ recurrence: [pattern] }, from, to).length) missing++;
      checked++;
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return { checked, missing };
};

// agendaDeadline: the ISO agenda-submittal deadline for a meeting on `meetingDate`. agendaLead
// union: {type:'offset',n,unit:'business'|'calendar'} (n days before; business = subBD) ·
// {type:'weekdayAnchor',weeksBefore,weekday} (the `weekday` of the week `weeksBefore` weeks
// before the meeting's week — how many TX cities publish it).
export const agendaDeadline = (body, meetingDate) => {
  if (!body || !meetingDate) return meetingDate || null;
  const lead = body.agendaLead;
  if (!lead) return meetingDate;
  if (lead.type === "weekdayAnchor") {
    const wb = Math.max(0, Math.trunc(Number(lead.weeksBefore) || 0));
    const wd = ((Math.trunc(Number(lead.weekday) || 0) % 7) + 7) % 7;
    const d = pd(meetingDate);
    d.setDate(d.getDate() - d.getDay() - wb * 7 + wd);   // Sunday of meeting week → back wb weeks → +weekday
    return fdLocal(d);
  }
  const n = Math.max(0, Math.trunc(Number(lead.n) || 0));
  return lead.unit === "calendar" ? addD(meetingDate, -n) : subBD(meetingDate, n);
};

// nextEligibleMeeting: earliest meeting m of `body` on/after readyDate whose agenda deadline
// >= readyDate (the first meeting this item can actually be filed for), strictly after
// `afterDate` when given. Returns {meetingDate, deadline} or null within a ~3-year horizon.
export const nextEligibleMeeting = (body, readyDate, afterDate) => {
  if (!body || !readyDate) return null;
  const dates = meetingDatesInRange(body, readyDate, addD(readyDate, 366 * 3));
  for (const m of dates) {
    if (afterDate && m <= afterDate) continue;
    const dl = agendaDeadline(body, m);
    if (dl >= readyDate) return { meetingDate: m, deadline: dl };
  }
  return null;
};

// NEW-1 (chat, 2026-09-11) — adjacentMeetingDate: the one meeting date of `body` STRICTLY after
// (dir="next") or STRICTLY before (dir="prev") `refDate`, within the same ~3-year horizon
// nextEligibleMeeting uses. Reuses meetingDatesInRange (the SAME resolver the "Snap this row to"
// flyout reads) rather than a second recurrence engine, so extraDates/blackoutDates apply exactly
// as they do to snapping. "Strictly" holds even when refDate is itself a meeting date, and also
// when it isn't (a hand-typed date the body never meets on) — the caller's context-menu row.
export const adjacentMeetingDate = (body, refDate, dir) => {
  if (!body || !refDate) return null;
  if (dir === "next") {
    return meetingDatesInRange(body, addD(refDate, 1), addD(refDate, 366 * 3))[0] || null;
  }
  const dates = meetingDatesInRange(body, addD(refDate, -366 * 3), addD(refDate, -1));
  return dates.length ? dates[dates.length - 1] : null;
};

// B817 — the two decision numbers (PURE; unit-tested). meetingFloatBD: working days from
// `todayIso` to the agenda deadline (slack before the packet MUST be filed). meetingCostDays: calendar
// days from the current meeting to the NEXT eligible one — what one missed deadline actually costs
// (routinely a month in an entitlement schedule).
export const meetingFloatBD = (task, todayIso) => (task && task.meetingBound && task.meetingDeadline) ? difBD(todayIso, task.meetingDeadline) : null;

export const meetingCostDays = (task, body) => {
  if (!body || !task || !task.start) return null;
  const next = meetingDatesInRange(body, addD(task.start, 1), addD(task.start, 366 * 2))[0];
  return next ? dif(task.start, next) : null;
};

// Global id→body index (B816). Like HOLIDAY_SET, cascadeDates reads it implicitly so callers need
// not thread proj.meetingBodies. Body ids are globally unique (mb_<time><rand>) so a task only ever
// resolves to its OWN project's body — no cross-project contamination. Rebuilt whenever bodies change.
export let MEETING_BODY_INDEX = {};

export const rebuildMeetingBodyIndex = d => {
  const idx = {};
  Object.values((d && d.projects) || {}).forEach(p => (p && Array.isArray(p.meetingBodies) ? p.meetingBodies : []).forEach(b => { if (b && b.id) idx[b.id] = b; }));
  MEETING_BODY_INDEX = idx;
  return idx;
};

// B816 — plain-English descriptors for the civic-mark explainer (never render a hearing date without why).
export const MB_WD_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export const MB_WD_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

export const MB_SETPOS_LABEL = {"1":"1st","2":"2nd","3":"3rd","4":"4th","5":"5th","-1":"last","-2":"2nd-to-last"};

export const MB_MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export const mbOrdinal = n => { const s = ["th","st","nd","rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

// joinWithAnd: ["a"] → "a" · ["a","b"] → "a and b" · ["a","b","c"] → "a, b and c" — the plain-
// English list join the sentence UI and its summaries share (NEW-1).
export const joinWithAnd = arr => {
  if (!arr || !arr.length) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr.join(" and ");
  return arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
};

export const mbPositionsPhrase = positions => joinWithAnd((Array.isArray(positions) ? positions : [positions]).map(p => MB_SETPOS_LABEL[String(p)] || String(p)));

// mbMonthsPhrase: null means "every month"/"all year" (the caller supplies the right words for
// its own sentence shape) — a restricted set becomes "Jan, Apr and Jul".
export const mbMonthsPhrase = months => (months === "all" || !Array.isArray(months) || !months.length) ? null : joinWithAnd(months.map(m => MB_MONTH_NAMES[m - 1] || "?"));

// mbRuleSummary (NEW-1, 2026-09-22 — replaces the Monthly/Weekly + Weeks/Months grid this mirrors):
// one plain-English sentence for a single pattern — "the 2nd and 4th Thursday of every month",
// "every Wednesday in Jun, Jul and Aug", "the 1st Tuesday of Nov, counting from after the 1st
// Monday" (the generalized Election-Day primitive — ANY weekday pair, not just Tue-after-Mon).
export const mbRuleSummary = r => {
  if (!r || r.weekday == null) return "(no weekday set)";
  const wd = MB_WD_FULL[r.weekday] || "?";
  const isEvery = r.positions === "every";
  const mo = mbMonthsPhrase(r.months);
  let base = isEvery
    ? (mo ? `every ${wd} in ${mo}` : `every ${wd}, all year`)
    : `the ${mbPositionsPhrase(r.positions)} ${wd} of ${mo || "every month"}`;
  if (!isEvery && r.anchor && r.anchor.weekday != null && r.anchor.position != null) {
    base += `, counting from after the ${MB_SETPOS_LABEL[String(r.anchor.position)] || r.anchor.position} ${MB_WD_FULL[r.anchor.weekday] || "?"}`;
  }
  return base;
};

// cadenceSummary: joins every rule of a body (not just [0]) so the civic-mark tooltip / rail never lie.
export const cadenceSummary = body => {
  const rules = (body && Array.isArray(body.recurrence)) ? body.recurrence.filter(r => r && r.weekday != null) : [];
  if (!rules.length) return "no cadence set";
  return rules.map(mbRuleSummary).join(", and ");
};

export const agendaLeadSummary = body => {
  const l = body && body.agendaLead; if (!l) return "no agenda lead";
  if (l.type === "weekdayAnchor") return `agenda due the ${MB_WD_NAMES[l.weekday] || "?"} ~${l.weeksBefore || 0} week(s) before`;
  return `agenda due ${l.n || 0} ${l.unit === "calendar" ? "calendar" : "business"} days before`;
};

// meetingBoundInfo — resolves the body + derived deadline + float + severity state for a bound task.
export const meetingBoundInfo = task => {
  const body = task && task.meetingBound ? MEETING_BODY_INDEX[task.meetingBodyId] : null;
  if (!body) return null;
  const deadline = task.meetingDeadline || (task.start ? agendaDeadline(body, task.start) : "");
  const floatBD = deadline ? difBD(fdLocal(new Date()), deadline) : null;   // working days from today to the agenda deadline
  const state = task.meetingInfeasible ? "danger" : (floatBD != null && floatBD <= 2) ? "warning" : "secondary";
  return { body, deadline, floatBD, state };
};

// meetingDoubleLagFlag (NEW-2, 2026-09-23) — true when a meeting-bound task's OWN predecessor lag
// looks like it is counting the SAME wait the bound body's own filing lead already counts. The two
// combine ADDITIVELY (applyMeetingBinding folds the lag into `predEarly`, then agendaDeadline
// subtracts the lead from each candidate meeting), so a link lag that duplicates the body's lead can
// silently push the task out to the meeting AFTER the one it would otherwise land on — with nothing
// on the row saying so. PURE — never reads or changes anything stored; a caller decides whether/how
// to show it. Only compares the plain day-offset lead shape (agendaLead.type==="offset"); the
// weekdayAnchor lead has no single day-count to compare against a link lag, so it never flags.
// Unit-tested in test/schedulerEngine.test.js.
export const meetingDoubleLagFlag = (task, body) => {
  if (!task || !task.meetingBound || !body || !body.agendaLead) return null;
  const lead = body.agendaLead;
  if (lead.type !== "offset" || !(Number(lead.n) > 0)) return null;
  const leadUnit = lead.unit === "calendar" ? "calendar" : "business";
  const hit = normPreds(task.predecessors).find(p => {
    const lagN = Math.abs(Number(p.lag) || 0);
    if (!lagN) return false;
    const lagUnit = p.lagUnit === "calendar" ? "calendar" : "business";
    return lagUnit === leadUnit && Math.abs(lagN - Number(lead.n)) <= 1;
  });
  return hit ? { predId: hit.id, lagN: Math.abs(Number(hit.lag) || 0), leadN: Number(lead.n), unit: leadUnit } : null;
};

// dropDuplicateLagPatch (NEW-2) — the exact patch the row's one-click fix applies: zeroes ONLY the
// flagged predecessor edge's lag, keeping the edge itself (target + type) and the meeting binding
// untouched. Pure so a fixture test can assert the resulting cascade without driving the UI; the
// caller writes it back via the normal updateTask path, so it rides the app's existing undo history
// like any other edit — never a bespoke undo mechanism.
export const dropDuplicateLagPatch = (task, flag) => {
  if (!flag || flag.predId == null) return null;
  return normPreds(task.predecessors).map(p => p.id === flag.predId ? { ...p, lag: 0 } : p);
};

// meetingBindingTrace (NEW-2) — a READ-ONLY narration of how a meeting-bound task's date was
// actually reached: which predecessor drives it (the one whose constrained start is latest — the
// same comparison cascadeDates itself makes when it computes `predEarly`), what lag that edge adds,
// the earliest date that produces, which of the body's own meetings were too early to make (their
// agenda deadline fell before that earliest date, so nextEligibleMeeting skipped them) and so were
// skipped, and the meeting the engine actually landed on. Reuses constrainedStartFrom / agendaDeadline
// / meetingDatesInRange VERBATIM — it recomputes nothing the engine doesn't already compute the same
// way, and writes nothing back: task.start/task.meetingDeadline (the engine's own stored answer) are
// read as-is for the "landed" half. NEVER changes the cascade. `findTask` is `id => Task|undefined`
// so callers can pass a cheap linear lookup (matches this file's existing predecessor-name pattern)
// or a Map in a test.
export const meetingBindingTrace = (task, findTask, body) => {
  if (!task || !task.meetingBound || !body) return null;
  const preds = normPreds(task.predecessors)
    .map(dep => ({ dep, predTask: findTask(dep.id) }))
    .filter(x => x.predTask && (x.predTask.end || x.predTask.start));
  if (!preds.length) return { driver: null, earliestDate: "", skipped: [], landed: task.start || "", deadline: task.meetingDeadline || "" };
  let driver = null, earliestDate = "";
  preds.forEach(({ dep, predTask }) => {
    const d = constrainedStartFrom(predTask, dep, Math.max(1, task.duration || 1));
    if (d && (!earliestDate || d > earliestDate)) { earliestDate = d; driver = { dep, predTask }; }
  });
  const landed = task.start || "";
  const skipped = [];
  if (earliestDate && landed && earliestDate < landed) {
    meetingDatesInRange(body, earliestDate, addD(landed, -1)).forEach(m => skipped.push({ meetingDate: m, deadline: agendaDeadline(body, m) }));
  }
  return { driver, earliestDate, skipped, landed, deadline: task.meetingDeadline || "" };
};

// ── NEW-1 (2026-11-03) — a meeting-calendar task always lands on a REAL meeting ──────────────────
// resolveMeetingForward: the first meeting of `body` ON OR AFTER `iso` — FORWARD ONLY, never to an
// earlier one, and CALENDAR ONLY (no agenda-deadline skip: this is for a date a person typed; the
// deadline rule stays with predecessor-driven dates in applyMeetingBinding). Reads the SAME resolver
// the cascade does, so blackoutDates (cancelled) are skipped and extraDates (special-called) count.
// null when nothing resolves in the ~3-year horizon (no rule and no dates ahead).
export const resolveMeetingForward = (body, iso) => {
  if (!body || !iso) return null;
  return meetingDatesInRange(body, iso, addD(iso, 366 * 3))[0] || null;
};

// resolveBoundEdit — the ONE shared gate every EDIT passes through before a date is stored on a
// meeting-bound task (typed Start/Finish, range fill-down, Delete-then-retype, suggestion approval,
// the task editor, and binding an already-dated task to a calendar). PURE; updateTask and
// previewProject both call it, so the preview can never disagree with the apply (B585-S1).
// Returns { updates, startOverride, notice, rebinding, asked }:
//  · a typed Start OR Finish on a bound row becomes a Start at the first meeting on/after it (a
//    bound row is a 0-day milestone: start == end), so a Finish can never lock the row out of its
//    calendar (pinnedEnd would drop it out of bound mode) — `updates` is the rewritten patch;
//  · BINDING a dated row (it was not already bound to this body) resolves the row's own date forward
//    through `startOverride` WITHOUT pinning it — but only when nothing else schedules it (no live
//    predecessor, or it was already pinned); a predecessor-driven row is left to the engine and its
//    agenda-deadline rule;
//  · a finished row (its actual dates), a parent row, an unbound row, and a clear ("") are untouched;
//  · no calendar / no meeting ahead → the date is left AS TYPED and `notice` says why (never silent).
//  · B2642096 ×2 — A PERSON'S DATE EDIT REPLACES AN EARLIER STEPPED PIN. Right-click Next/Previous meeting sets
//    `pinnedMeetingDate`, and applyMeetingBinding reads it BEFORE the row's own start, so a typed date on a
//    stepped row used to be undone by the cascade while the toast announced the move. Every path that lets a
//    date through on a bound row (moved · already a meeting · no meeting ahead · no calendar · a clear) therefore
//    carries `pinnedMeetingDate: undefined` (dropStep) — the pattern the app uses everywhere else. An explicit
//    step in the same patch is never stripped. `asked` = the date this edit asked the row to hold, so the caller
//    can compare it with the row AFTER the cascade (settleBoundNotice) and never announce a move that didn't happen.
// It acts on an EDIT only — stored dates are never revisited, so it cannot ratchet on load (B1701360).
export const dropStep = (t, patch) => ((t && t.pinnedMeetingDate && !('pinnedMeetingDate' in patch)) ? { ...patch, pinnedMeetingDate: undefined } : patch);

export const resolveBoundEdit = (tasks, taskId, updates, bodyOf) => {
  const none = { updates, startOverride: null, notice: null, rebinding: false, asked: "" };
  const list = Array.isArray(tasks) ? tasks : [];
  const t = list.find(x => x.id === taskId);
  if (!t || !updates) return none;
  const merged = { ...t, ...updates };
  if (!merged.meetingBound || isCompleteTask(merged) || list.some(x => x.parentId === taskId)) return none;
  const typed = (('start' in updates) && updates.start) ? updates.start : ((('end' in updates) && updates.end) ? updates.end : "");
  const rebinding = !!(('meetingBound' in updates || 'meetingBodyId' in updates) && !(t.meetingBound && t.meetingBodyId === merged.meetingBodyId));
  if (!typed && !rebinding) return (('start' in updates) || ('end' in updates)) ? { ...none, updates: dropStep(t, updates) } : none;   // a clear drops the stepped pin too
  const body = bodyOf ? bodyOf(merged.meetingBodyId) : null;
  if (typed) {
    if (!body) return { ...none, updates: dropStep(t, updates), asked: typed, notice: { kind: "nobody", typed } };
    const m = resolveMeetingForward(body, typed);
    if (!m) return { ...none, updates: dropStep(t, updates), asked: typed, notice: { kind: "none-ahead", typed, bodyName: body.name || "" } };
    const patched = dropStep(t, { ...updates, start: m });
    delete patched.end;
    if (t.pinnedEnd) patched.pinnedEnd = false;   // a stale finish-lock would take the row out of bound mode
    return { updates: patched, startOverride: null, asked: m, notice: m !== typed ? { kind: "moved", typed, date: m, bodyName: body.name || "" } : null, rebinding };
  }
  if (!body || !merged.start || merged.pinnedMeetingDate) return { ...none, rebinding };
  const liveId = new Set(list.filter(x => x.id !== taskId).map(x => x.id));
  const livePred = normPreds(merged.predecessors).some(p => liveId.has(p.id));
  if (livePred && !merged.pinnedStart) return { ...none, rebinding };   // the engine decides (deadline rule)
  const m = resolveMeetingForward(body, merged.start);
  if (!m) return { ...none, rebinding, notice: { kind: "none-ahead", typed: merged.start, bodyName: body.name || "" } };
  return { updates, startOverride: m !== merged.start ? m : null, notice: m !== merged.start ? { kind: "moved", typed: merged.start, date: m, bodyName: body.name || "" } : null, rebinding };
};

// boundEditNotice — the toast sentence, in the B624 voice ("Start moved to … — you picked a weekend").
// `fmt` is the caller's date formatter (injected so this stays pure).
export const boundEditNotice = (notice, taskName, fmt) => {
  if (!notice) return "";
  const n = taskName || "Task";
  if (notice.kind === "moved") return `${n} moved to ${fmt(notice.date)}, the next ${notice.bodyName || "meeting"} meeting — ${fmt(notice.typed)} isn't one of its meeting dates.`;
  if (notice.kind === "held") return `${n} stays on ${fmt(notice.date)} — it couldn't be placed on ${fmt(notice.typed)}${notice.bodyName ? ` (a ${notice.bodyName} meeting)` : ""}; something else on the schedule is holding that date.`;
  if (notice.kind === "none-ahead") return `${notice.bodyName || "That calendar"} has no meeting on or after ${fmt(notice.typed)} — ${n} keeps ${fmt(notice.typed)} as typed and is flagged.`;
  return `${n}'s meeting calendar no longer exists — ${fmt(notice.typed)} was kept as typed. Re-select or re-create the calendar.`;
};

// settleBoundNotice — B2642096 ×2: the toast is built from what the row HOLDS AFTER the cascade, not from what the
// edit asked for. resolveBoundEdit's notice describes the REQUEST; if the cascaded row is somewhere else (a pin, a
// predecessor, anything), the request was not honoured and announcing it is a lie — say what actually happened
// ("held"). `actualStart` is the edited row's start in the recomputed list. PURE; null when nothing needs saying.
export const settleBoundNotice = (boundEdit, actualStart) => {
  const asked = boundEdit && boundEdit.asked;
  if (asked && (actualStart || "") !== asked) {
    const prior = boundEdit.notice;
    return { kind: "held", typed: asked, date: actualStart || "", bodyName: (prior && prior.bodyName) || "" };
  }
  return (boundEdit && boundEdit.notice) || null;
};

// unpinStartPatch / startIsPinned — B2642096 ×2: the Start pin has TWO sources, `pinnedStart` (a typed/dragged date)
// and, on a bound row, `pinnedMeetingDate` (right-click Next/Previous meeting). Unpin clears BOTH, and the padlock
// shows when EITHER is set — otherwise a stepped row looked unpinned and stayed pinned after the click.
export const unpinStartPatch = task => ({ pinnedStart: false, predecessors: task.predecessors, pinnedMeetingDate: undefined });

export const startIsPinned = task => !!(task && (task.pinnedStart || (task.meetingBound && task.pinnedMeetingDate)));

// ── NEW-1 (2026-11-03, owner decision) — a typed date HOLDS, and he is TOLD when it can't be met ────────
// A typed Start (pin, B615/B621) or Finish (lock, B616) never follows its predecessor — the owner is fine
// with that, as long as he is told, and then he edits the predecessor. THE THREE CASES:
//   · typed date LATER than the predecessor allows → no conflict, no notice (effectively the later of the two);
//   · typed date EARLIER than it allows → the date holds and he is told AT THE EDIT that creates it;
//   · a predecessor LATER moves past a typed date → the date holds and he is told at THAT edit, naming both.
// ONE check, no second system: it READS the flags the cascade already computes (startConflict B443250 ·
// finishConflict B616 · meetingInfeasible B816 for a bound row's agenda deadline) and DIFFS before/after an
// edit, so it fires only on the edit that CREATES a conflict — never on load (updateTask is the only caller),
// never again for one already sitting on a schedule. On a meeting row the typed date has already jumped to a
// real meeting (resolveBoundEdit) and these rules apply to THAT date. PURE; updateTask and previewProject
// both call it, so the preview cannot disagree with the apply.
export const pinConflictsOf = tasks => {
  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(list.map(t => [t.id, t]));
  const parents = new Set(list.filter(t => t.parentId !== null && t.parentId !== undefined).map(t => t.parentId));
  const out = new Map();
  list.forEach(t => {
    if (parents.has(t.id) || isCompleteTask(t)) return;   // a summary's dates are rolled up; a finished row keeps its actuals
    const kind = t.finishConflict ? "finish" : t.startConflict ? "start" : (t.meetingBound && t.meetingInfeasible && !t.meetingDateOffCalendar ? "meeting" : "");
    if (!kind) return;
    // the DRIVING predecessor = the one whose constrained start is latest (the same comparison cascadeDates makes for predEarly)
    let driver = null, allowedFrom = "";
    normPreds(t.predecessors).forEach(dep => {
      const pt = byId.get(dep.id);
      if (!pt || !(pt.end || pt.start)) return;
      const d = constrainedStartFrom(pt, dep, Math.max(1, t.duration || 1));
      if (d && (!allowedFrom || d > allowedFrom)) { allowedFrom = d; driver = pt; }
    });
    out.set(t.id, { id: t.id, kind, name: t.name || "", date: kind === "finish" ? (t.end || "") : (t.start || ""), predId: driver ? driver.id : null, predName: driver ? (driver.name || "") : "", allowedFrom, deadline: t.meetingDeadline || "" });
  });
  return out;
};

// newPinConflicts — conflicts present AFTER an edit that were not there BEFORE it. `alwaysIds` = the row(s) whose
// own date the person just typed: still in conflict afterwards → reported (he is being told about the date he
// just entered), even if that row was already in conflict with a previous date.
export const newPinConflicts = (before, after, alwaysIds = []) => {
  const was = pinConflictsOf(before), now = pinConflictsOf(after), always = new Set(alwaysIds);
  return [...now.values()].filter(c => !was.has(c.id) || always.has(c.id));
};

// pinConflictNotice — the toast sentence; `typedId` = the row whose own date was just typed (else the cause is a
// predecessor moving). `fmt` is the caller's date formatter, injected to stay pure.
export const pinConflictNotice = (conflicts, typedId, fmt) => {
  if (!conflicts || !conflicts.length) return "";
  const c = conflicts.find(x => x.id === typedId) || conflicts[0];
  const n = c.name ? `"${c.name}"` : `Task ${c.id}`;
  const p = c.predName ? `"${c.predName}"` : (c.predId != null ? `task ${c.predId}` : "its predecessor");
  let msg;
  if (c.kind === "finish") msg = `${n}'s locked finish ${fmt(c.date)} can't be met — ${p} needs more time. The locked date holds; edit ${p}, or unlock the finish.`;
  else if (c.kind === "meeting") msg = `${n} is on ${fmt(c.date)}, but that agenda closed ${fmt(c.deadline)} and ${p} isn't ready until ${fmt(c.allowedFrom)}. The meeting date holds; edit ${p}, or move the task to a later meeting.`;
  else if (c.id === typedId) msg = `${n} is set to ${fmt(c.date)}, earlier than ${p} allows (${fmt(c.allowedFrom)}). Your date holds; edit ${p} to move it, or unpin the date.`;
  else msg = `${p} now runs past ${n}'s typed date ${fmt(c.date)} (it can't start before ${fmt(c.allowedFrom)}). The typed date holds; edit ${p}, or unpin the date.`;
  return conflicts.length > 1 ? `${msg} (+${conflicts.length - 1} more row${conflicts.length > 2 ? "s" : ""} in conflict.)` : msg;
};

// ── Meeting-calendar cross-schedule import (B1824576) ──────────────────────
// Reuse a meeting body's cadence from ANOTHER schedule instead of re-entering it — the owner's
// ask: he went to bind a task to a governmental meeting body (city council, P&Z, MUD board) and
// the body only existed in a different schedule, so his only path was re-entering the whole
// cadence from scratch. Every function below COPIES a body, never links it — see
// copyMeetingBodyWithNewId.
//
// mbRuleSignature / mbRecurrenceSignature: an order-independent, canonical fingerprint of a
// body's cadence, used ONLY to detect "this body is already here" (same name + identical
// recurrence). Deliberately ignores agendaLead / blackoutDates / extraDates / jurisdiction — two
// bodies that meet on the same days but disagree on, say, the filing deadline still read as "the
// same calendar" for this check, matching the item's spec.
export const mbRuleSignature = r => {
  if (!r) return "";
  const positions = r.positions === "every" ? "every" : (Array.isArray(r.positions) ? [...r.positions].sort((a, b) => a - b) : [r.positions]);
  const months = (r.months === "all" || !Array.isArray(r.months)) ? "all" : [...r.months].sort((a, b) => a - b);
  const anchor = (r.anchor && r.anchor.weekday != null && r.anchor.position != null) ? `${r.anchor.weekday}:${r.anchor.position}` : "";
  return JSON.stringify([r.weekday, positions, months, anchor]);
};

export const mbRecurrenceSignature = recurrence => (Array.isArray(recurrence) ? recurrence.filter(r => r && r.weekday != null).map(mbRuleSignature).sort() : []).join("|");

export const mbBodiesSameCadence = (a, b) => !!a && !!b && (a.name || "").trim() === (b.name || "").trim() && mbRecurrenceSignature(a.recurrence) === mbRecurrenceSignature(b.recurrence);

// copyMeetingBodyWithNewId — re-ids ONE meeting body for a copy into another schedule. Body ids
// are globally unique (mb_<time><rand>, B816) — two schedules must never share one, or editing
// the copy would move the original's hearings (MEETING_BODY_INDEX collapses same-id bodies).
// `salt` disambiguates several bodies copied in the same millisecond. Split out of
// buildDuplicateProject's inline per-body mapper (Duplicate schedule, below) so this import
// feature reuses the exact same re-id logic instead of growing a second copy of it.
export const copyMeetingBodyWithNewId = (mb, salt = 0) => {
  const nid = "mb_" + Date.now().toString(36) + salt + Math.random().toString(36).slice(2, 6);
  return {...mb, id: nid,
    recurrence: (mb.recurrence || []).map(r => ({...r, setpos: Array.isArray(r.setpos) ? [...r.setpos] : r.setpos, months: Array.isArray(r.months) ? [...r.months] : r.months})),
    agendaLead: mb.agendaLead ? {...mb.agendaLead} : mb.agendaLead,
    blackoutDates: [...(mb.blackoutDates || [])], extraDates: [...(mb.extraDates || [])]};
};

// importMeetingBody — copies `sourceBody` into `targetBodies` UNLESS an identical-cadence body is
// already there (mbBodiesSameCadence), in which case the EXISTING copy is reused instead of
// minting a second one — no silent duplicates. Returns the (possibly unchanged) array plus the id
// a task should bind to.
export const importMeetingBody = (targetBodies, sourceBody, salt = 0) => {
  const list = targetBodies || [];
  const existing = list.find(b => mbBodiesSameCadence(b, sourceBody));
  if (existing) return { bodies: list, id: existing.id, created: false };
  const copy = copyMeetingBodyWithNewId(sourceBody, salt);
  return { bodies: [...list, copy], id: copy.id, created: true };
};

// importMeetingBodies — the multi-select "Import from another schedule…" batch: applies
// importMeetingBody in sequence so a later pick dedupes against one already imported in the SAME
// batch, not just against what was already on the schedule before the import started.
export const importMeetingBodies = (targetBodies, sourceBodies) => {
  let bodies = targetBodies || [];
  const ids = [];
  (sourceBodies || []).forEach((sb, i) => {
    const r = importMeetingBody(bodies, sb, i);
    bodies = r.bodies;
    ids.push(r.id);
  });
  return { bodies, ids };
};

// otherScheduleMeetingBodies — every meeting body on every OTHER schedule on the account, grouped
// by schedule, for the import pickers (the modal's "Import from another schedule…" and the task
// right-click "From other schedules" group). Read-only — never mutates a source schedule.
// B1873361 — `schedName` is the full crossScheduleLabel ("<Project> / <Schedule>"), not the bare
// schedule name: two different schedules can share a name, and every caller here names a schedule
// to the person without also showing the row it belongs to, so a bare name would be exactly the
// ambiguity NEW-1 closed elsewhere. The separate `projName` field this used to also carry is gone —
// it's now folded into schedName, and its one caller (MeetingImportPicker) read it back out again.
export const otherScheduleMeetingBodies = (data, excludePid) => Object.values((data && data.projects) || {})
  .filter(p => p && p.id !== excludePid && Array.isArray(p.meetingBodies) && p.meetingBodies.length)
  .map(p => ({ pid: p.id, schedName: crossScheduleLabel(p), bodies: p.meetingBodies }))
  .sort((a, b) => a.schedName.localeCompare(b.schedName));

// findMeetingBodyElsewhere (NEW-1, 2026-09-23) — a task can be bound to a body that lives on a
// DIFFERENT schedule (the id is globally unique, B816 — cascadeDates/meetingBoundInfo already
// resolve the OBJECT for date math via MEETING_BODY_INDEX). This additionally names WHICH schedule
// owns it, which the date math never needed to know but every UI surface that NAMES a bound body
// does — without it, a foreign binding read as unbound ("set up…") or as the literal fallback
// string "Meeting body" instead of the real name. Returns null only when the id belongs to no
// schedule on the account at all (a genuinely deleted body — task.meetingBodyMissing covers that).
export const findMeetingBodyElsewhere = (data, excludePid, bodyId) => {
  if (!bodyId) return null;
  for (const p of Object.values((data && data.projects) || {})) {
    if (!p || p.id === excludePid || !Array.isArray(p.meetingBodies)) continue;
    const b = p.meetingBodies.find(b => b.id === bodyId);
    if (b) return { body: b, schedName: crossScheduleLabel(p), pid: p.id };
  }
  return null;
};

export const setMeetingBodyIndex = v => { MEETING_BODY_INDEX = v; };
