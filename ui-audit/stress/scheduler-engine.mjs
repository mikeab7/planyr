// Faithful extraction of the Scheduler date/cascade engine from
// public/sequence/index.html (lines ~389-697, 935-944).
// Copied VERBATIM so the stress harness exercises the real code paths.
// Keep in sync if the source changes.

export const fd = d => d.toISOString().slice(0,10);
export const fdLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const pd = s => new Date(s + "T12:00:00");
export const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return fd(d); };
export const dif  = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);

// NEW-1 — Owner is an ORDERED LIST of contact names now; ownerListOf coerces a legacy string (or
// any other stray shape) into a clean, de-duped array. Mirrored verbatim from index.html.
export const ownerListOf = t => {
  const rp = t && t.responsibleParty;
  const raw = Array.isArray(rp) ? rp : (rp ? [rp] : []);
  const seen = new Set(); const out = [];
  raw.forEach(name => {
    const s = String(name == null ? "" : name).trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k); out.push(s);
  });
  return out;
};
export const OWNER_JOIN = "; ";
export const ownerJoin = list => (Array.isArray(list) ? list : []).join(OWNER_JOIN);
export const ownerDisplayParts = list => {
  const l = Array.isArray(list) ? list : [];
  if (!l.length) return { label: "", title: "" };
  const extra = l.length - 1;
  return { label: extra > 0 ? `${l[0]} +${extra}` : l[0], title: l.join(", ") };
};

export let HOLIDAY_SET = new Set();
const nthWeekday = (y, mo, n, dow) => {
  if (n > 0) { const d = new Date(y, mo-1, 1); while(d.getDay()!==dow) d.setDate(d.getDate()+1); d.setDate(d.getDate()+(n-1)*7); return d; }
  const d = new Date(y, mo, 0); while(d.getDay()!==dow) d.setDate(d.getDate()-1); return d;
};
const HOLIDAY_DEFS = [
  {k:"newYearsDay",          fn: y => `${y}-01-01`},
  {k:"mlkDay",               fn: y => fdLocal(nthWeekday(y,1,3,1))},
  {k:"presidentsDay",        fn: y => fdLocal(nthWeekday(y,2,3,1))},
  {k:"memorialDay",          fn: y => fdLocal(nthWeekday(y,5,-1,1))},
  {k:"juneteenth",           fn: y => `${y}-06-19`},
  {k:"independence",         fn: y => `${y}-07-04`},
  {k:"laborDay",             fn: y => fdLocal(nthWeekday(y,9,1,1))},
  {k:"columbusDay",          fn: y => fdLocal(nthWeekday(y,10,2,1))},
  {k:"veteransDay",          fn: y => `${y}-11-11`},
  {k:"thanksgiving",         fn: y => fdLocal(nthWeekday(y,11,4,4))},
  {k:"dayAfterThanksgiving", fn: y => { const d=pd(fdLocal(nthWeekday(y,11,4,4))); d.setDate(d.getDate()+1); return fdLocal(d); }},
  {k:"christmasEve",         fn: y => `${y}-12-24`},
  {k:"christmas",            fn: y => `${y}-12-25`},
  {k:"newYearsEve",          fn: y => `${y}-12-31`},
];
const DEFAULT_HOLIDAYS = {newYearsDay:true,mlkDay:false,presidentsDay:false,memorialDay:true,juneteenth:false,independence:true,laborDay:true,columbusDay:false,veteransDay:false,thanksgiving:true,dayAfterThanksgiving:false,christmasEve:true,christmas:true,newYearsEve:false};
export const buildHolidaySet = holidays => {
  const s = new Set(); const y0 = new Date().getFullYear();
  for (let y = y0-5; y <= y0+15; y++) HOLIDAY_DEFS.forEach(h => { if(holidays[h.k]) s.add(h.fn(y)); });
  return s;
};
HOLIDAY_SET = buildHolidaySet(DEFAULT_HOLIDAYS);

const MAX_BD_STEPS = 1_000_000;
export const addBD = (s, n) => {
  if (!s) return s;
  n = Math.trunc(Number(n));
  if (!Number.isFinite(n) || n === 0) return s;
  const d = pd(s);
  if (isNaN(d)) return s;
  let rem = Math.min(Math.abs(n), MAX_BD_STEPS);
  const dir = n > 0 ? 1 : -1;
  while (rem > 0) { d.setDate(d.getDate() + dir); if (d.getDay() !== 0 && d.getDay() !== 6 && !HOLIDAY_SET.has(fd(d))) rem--; }
  return fd(d);
};
export const difBD = (a, b) => {
  const s = pd(a), e = pd(b);
  if (isNaN(s) || isNaN(e)) return 0;
  if (+s === +e) return 0;
  const dir = e > s ? 1 : -1;
  let count = 0, steps = MAX_BD_STEPS;
  const cur = new Date(s);
  while ((dir === 1 ? cur < e : cur > e) && steps-- > 0) { cur.setDate(cur.getDate() + dir); if (cur.getDay() !== 0 && cur.getDay() !== 6 && !HOLIDAY_SET.has(fd(cur))) count++; }
  return count * dir;
};
// ── B815 (NEW-1) — Meeting-body cadence engine (VERBATIM copy of public/sequence/index.html) ──
export const subBD = (s, n) => addBD(s, -n);
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
// B816 — plain-English descriptors for the civic-mark explainer (never render a hearing date without why).
export const MB_WD_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const MB_WD_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const MB_SETPOS_LABEL = {"1":"1st","2":"2nd","3":"3rd","4":"4th","5":"5th","-1":"last","-2":"2nd-to-last"};
export const MB_MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
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
export const agendaDeadline = (body, meetingDate) => {
  if (!body || !meetingDate) return meetingDate || null;
  const lead = body.agendaLead;
  if (!lead) return meetingDate;
  if (lead.type === "weekdayAnchor") {
    const wb = Math.max(0, Math.trunc(Number(lead.weeksBefore) || 0));
    const wd = ((Math.trunc(Number(lead.weekday) || 0) % 7) + 7) % 7;
    const d = pd(meetingDate);
    d.setDate(d.getDate() - d.getDay() - wb * 7 + wd);
    return fdLocal(d);
  }
  const n = Math.max(0, Math.trunc(Number(lead.n) || 0));
  return lead.unit === "calendar" ? addD(meetingDate, -n) : subBD(meetingDate, n);
};
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
// NEW-1 (VERBATIM copy of public/sequence/index.html).
export const adjacentMeetingDate = (body, refDate, dir) => {
  if (!body || !refDate) return null;
  if (dir === "next") {
    return meetingDatesInRange(body, addD(refDate, 1), addD(refDate, 366 * 3))[0] || null;
  }
  const dates = meetingDatesInRange(body, addD(refDate, -366 * 3), addD(refDate, -1));
  return dates.length ? dates[dates.length - 1] : null;
};
// B817 — the two decision numbers (VERBATIM copy of public/sequence/index.html).
export const meetingFloatBD = (task, todayIso) => (task && task.meetingBound && task.meetingDeadline) ? difBD(todayIso, task.meetingDeadline) : null;
export const meetingCostDays = (task, body) => {
  if (!body || !task || !task.start) return null;
  const next = meetingDatesInRange(body, addD(task.start, 1), addD(task.start, 366 * 2))[0];
  return next ? dif(task.start, next) : null;
};
// NEW-2 (VERBATIM copy of public/sequence/index.html).
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
export const dropDuplicateLagPatch = (task, flag) => {
  if (!flag || flag.predId == null) return null;
  return normPreds(task.predecessors).map(p => p.id === flag.predId ? { ...p, lag: 0 } : p);
};
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
// ── Meeting-calendar cross-schedule import (B1824576, VERBATIM copy of public/sequence/index.html) ──
export const mbRuleSignature = r => {
  if (!r) return "";
  const positions = r.positions === "every" ? "every" : (Array.isArray(r.positions) ? [...r.positions].sort((a, b) => a - b) : [r.positions]);
  const months = (r.months === "all" || !Array.isArray(r.months)) ? "all" : [...r.months].sort((a, b) => a - b);
  const anchor = (r.anchor && r.anchor.weekday != null && r.anchor.position != null) ? `${r.anchor.weekday}:${r.anchor.position}` : "";
  return JSON.stringify([r.weekday, positions, months, anchor]);
};
export const mbRecurrenceSignature = recurrence => (Array.isArray(recurrence) ? recurrence.filter(r => r && r.weekday != null).map(mbRuleSignature).sort() : []).join("|");
export const mbBodiesSameCadence = (a, b) => !!a && !!b && (a.name || "").trim() === (b.name || "").trim() && mbRecurrenceSignature(a.recurrence) === mbRecurrenceSignature(b.recurrence);
export const copyMeetingBodyWithNewId = (mb, salt = 0) => {
  const nid = "mb_" + Date.now().toString(36) + salt + Math.random().toString(36).slice(2, 6);
  return {...mb, id: nid,
    recurrence: (mb.recurrence || []).map(r => ({...r, setpos: Array.isArray(r.setpos) ? [...r.setpos] : r.setpos, months: Array.isArray(r.months) ? [...r.months] : r.months})),
    agendaLead: mb.agendaLead ? {...mb.agendaLead} : mb.agendaLead,
    blackoutDates: [...(mb.blackoutDates || [])], extraDates: [...(mb.extraDates || [])]};
};
export const importMeetingBody = (targetBodies, sourceBody, salt = 0) => {
  const list = targetBodies || [];
  const existing = list.find(b => mbBodiesSameCadence(b, sourceBody));
  if (existing) return { bodies: list, id: existing.id, created: false };
  const copy = copyMeetingBodyWithNewId(sourceBody, salt);
  return { bodies: [...list, copy], id: copy.id, created: true };
};
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
export const otherScheduleMeetingBodies = (data, excludePid) => Object.values((data && data.projects) || {})
  .filter(p => p && p.id !== excludePid && Array.isArray(p.meetingBodies) && p.meetingBodies.length)
  .map(p => ({ pid: p.id, schedName: p.name || `Project ${p.id}`, projName: p.linkedSiteName || null, bodies: p.meetingBodies }))
  .sort((a, b) => a.schedName.localeCompare(b.schedName));
// NEW-1 (VERBATIM copy of public/sequence/index.html).
export const findMeetingBodyElsewhere = (data, excludePid, bodyId) => {
  if (!bodyId) return null;
  for (const p of Object.values((data && data.projects) || {})) {
    if (!p || p.id === excludePid || !Array.isArray(p.meetingBodies)) continue;
    const b = p.meetingBodies.find(b => b.id === bodyId);
    if (b) return { body: b, schedName: p.name || `Project ${p.id}`, pid: p.id };
  }
  return null;
};
export const normPreds = arr => {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => {
    if (x === null || x === undefined) return null;
    if (typeof x === "object") return {id: x.id, type: (x.type||"FS").toUpperCase(), lag: x.lag||0, ...(x.lagUnit === "calendar" ? {lagUnit: "calendar"} : {})};
    if (typeof x === "number" && !isNaN(x)) return {id: x, type: "FS", lag: 0};
    return null;
  }).filter(Boolean);
};
export const parsePreds = raw => {
  const str = String(raw||"").trim();
  if (!str) return [];
  return str.split(/[,;]/).map(p => {
    p = p.trim(); if (!p) return null;
    // unit suffix: "cd" = calendar days, "d"/none = working days (default). Only meaningful when lag ≠ 0.
    const m = p.match(/^(\d+)\s*(FS|FF|SS|SF)?\s*([+-]\s*\d+)?\s*(cd|d)?$/i);
    if (!m) return null;
    const lag = m[3] ? parseInt(m[3].replace(/\s/g,"")) : 0;
    const cal = lag !== 0 && /^cd$/i.test(m[4] || "");
    return {id: parseInt(m[1]), type: (m[2]||"FS").toUpperCase(), lag, ...(cal ? {lagUnit: "calendar"} : {})};
  }).filter(Boolean);
};
// Validate a proposed predecessor list for task `id` (faithful copy from index.html):
// drops self-refs, refs to nonexistent ids, and refs that would create a circular dependency.
export const validatePredEdit = (tasks, id, parsed) => {
  const list = Array.isArray(parsed) ? parsed : [];
  const selfRemoved = list.some(p => p && p.id === id);
  let preds = list.filter(p => p && p.id !== id);
  const byId = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => { byId[t.id] = t; });
  const known = new Set(Object.keys(byId).map(Number));
  const unknownIds = [...new Set(preds.filter(p => !known.has(p.id)).map(p => p.id))];
  preds = preds.filter(p => known.has(p.id));
  const isAncestorOfId = startId => {
    let p = byId[id] && byId[id].parentId, seenP = new Set([id]);
    while (p != null && byId[p] && !seenP.has(p)) {
      if (p === startId) return true;
      seenP.add(p); p = byId[p].parentId;
    }
    return false;
  };
  const ancestor = [...new Set(preds.filter(p => isAncestorOfId(p.id)).map(p => p.id))];
  preds = preds.filter(p => !isAncestorOfId(p.id));
  const predMap = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => { predMap[t.id] = normPreds(t.predecessors).map(p => p.id); });
  const childrenOf = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => {
    if (!t || t.parentId === null || t.parentId === undefined) return;
    (childrenOf[t.parentId] = childrenOf[t.parentId] || []).push(t.id);
  });
  const reachesId = startId => {
    const stack = [startId], seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === id) return true;
      if (seen.has(cur)) continue; seen.add(cur);
      (predMap[cur] || []).forEach(x => stack.push(x));
      (childrenOf[cur] || []).forEach(x => stack.push(x));
    }
    return false;
  };
  const accepted = [], cyclic = [];
  preds.forEach(p => { if (reachesId(p.id)) cyclic.push(p.id); else accepted.push(p); });
  return { preds: accepted, selfRemoved, unknownIds, cyclic, ancestor };
};
export const constrainedStartFrom = (pred, dep, taskDur) => {
  const lag = dep.lag || 0;
  // The LAG counts calendar days (addD) when lagUnit === "calendar", else working days (addBD).
  // The FS "next business day" base step stays business either way (split from the lag).
  const addLag = (base, n) => dep.lagUnit === "calendar" ? addD(base, n) : addBD(base, n);
  switch ((dep.type||"FS").toUpperCase()) {
    case "FS": return addLag(addBD(pred.end, 1), lag);
    case "SS": return addLag(pred.start, lag);
    case "FF": { const cEnd = addLag(pred.end, lag);
                 return taskDur <= 1 ? cEnd : addBD(cEnd, 1 - taskDur); }
    case "SF": { const cEnd = addLag(pred.start, lag);
                 return taskDur <= 1 ? cEnd : addBD(cEnd, 1 - taskDur); }
    default:   return addLag(addBD(pred.end, 1), lag);
  }
};
export const calcEnd = (start, dur) => !start ? "" : dur === 0 ? start : addBD(start, Math.max(0, dur - 1));

// ── Duration model (B615): days/weeks = WORKING days · months/years = CALENDAR-real ──────
// Faithful copy of the pure helpers in public/sequence/index.html. Keep in sync.
const DUR_UNIT_ALIASES = [
  { re: /^(mo|mos|month|months)$/,               unit: "mo" },
  { re: /^(y|yr|yrs|year|years)$/,               unit: "y"  },
  { re: /^(w|wk|wks|week|weeks)$/,               unit: "w"  },
  { re: /^(cd|cds|calday|caldays|caldy)$/,       unit: "cd" },   // calendar days (weekends counted)
  { re: /^(d|day|days|wd|workday|workdays)$/,    unit: "d"  },
];
export const parseDurationInput = raw => {
  const str = String(raw == null ? "" : raw).trim().toLowerCase();
  if (str === "") return { value: 0, unit: "d" };
  const m = str.match(/^(-?\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!m) return { error: `Couldn't read "${String(raw).trim()}" — try 10d, 3w, 30cd, 2mo, or 1y` };
  let value = Math.trunc(Number(m[1]));
  if (!Number.isFinite(value) || value < 0) return { error: `Duration can't be negative — try 10d, 3w, 30cd, 2mo, or 1y` };
  value = Math.min(value, 100000);
  const suffix = m[2];
  if (suffix === "") return { value, unit: "d" };
  const hit = DUR_UNIT_ALIASES.find(u => u.re.test(suffix));
  if (!hit) return { error: `Unknown unit "${suffix}" — try d (days), w (weeks), cd (calendar days), mo (months), y (years)` };
  return { value, unit: hit.unit };
};
export const addCalendarMonths = (iso, n) => {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!mt) return iso;
  const y = +mt[1], mo0 = +mt[2] - 1, d = +mt[3];
  const total = mo0 + Math.trunc(n);
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(ty, tm + 1, 0).getDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
};
export const rollForwardToWorkday = iso => {
  const d = pd(iso);
  if (isNaN(d)) return iso;
  let steps = 0;
  while ((d.getDay() === 0 || d.getDay() === 6 || HOLIDAY_SET.has(fd(d))) && steps++ < 4000) d.setDate(d.getDate() + 1);
  return fd(d);
};
export const workdaysBetween = (aIso, bIso) => {
  let a = pd(aIso), b = pd(bIso);
  if (isNaN(a) || isNaN(b)) return 0;
  if (a > b) { const t = a; a = b; b = t; }
  const MS = 86400000;
  const totalDays = Math.round((b - a) / MS) + 1;
  const full = Math.floor(totalDays / 7);
  let count = full * 5;
  const rem = totalDays - full * 7;
  const startDow = a.getDay();
  for (let i = 0; i < rem; i++) { const dow = (startDow + i) % 7; if (dow !== 0 && dow !== 6) count++; }
  for (const h of HOLIDAY_SET) {
    const hd = pd(h);
    if (!isNaN(hd) && hd >= a && hd <= b) { const dow = hd.getDay(); if (dow !== 0 && dow !== 6) count--; }
  }
  return Math.max(0, count);
};
const DUR_WD_FACTOR = { d: 1, w: 5 };
export const resolveDuration = (start, value, unit) => {
  const u = unit || "d";
  const v = Math.max(0, Math.trunc(Number(value) || 0));
  if (u === "d" || u === "w") {
    const count = v * DUR_WD_FACTOR[u];
    return { end: start ? calcEnd(start, count) : "", duration: count };
  }
  if (!start || v === 0) return { end: start && v === 0 ? start : "", duration: 0 };
  if (u === "cd") { const end = addD(start, v - 1); return { end, duration: workdaysBetween(start, end) }; }  // exact calendar window (weekends counted, no roll); working-day count derived
  const months = u === "y" ? v * 12 : v;
  const end = rollForwardToWorkday(addCalendarMonths(start, months));
  return { end, duration: workdaysBetween(start, end) };
};
export const taskDurValue = t => (t.durValue != null ? t.durValue : (typeof t.duration === "number" ? t.duration : 0));
export const taskDurUnit  = t => t.durUnit || "d";
export const resolveTaskSpan = t => resolveDuration(t.start, taskDurValue(t), taskDurUnit(t));
export const startForEnd = (end, duration) => !end ? "" : (duration <= 1 ? end : addBD(end, -(Math.max(1, duration) - 1)));
// B463072 — a SUMMARY row's only true duration is the span rollupParentDates derived from its children
// (`duration`); the leftover `durValue`/`durUnit`, which the rollup never rewrites, printed "0d" on a
// 40-working-day parent. Faithful copy of index.html.
export const fmtTaskDuration = (t, isSummary = false) => {
  if (t.duration === "" || t.duration == null) return "";
  if (isSummary) return `${t.duration}d`;
  return `${taskDurValue(t)}${taskDurUnit(t)}`;
};

// Worst-of-descendants rolled status for each parent task (faithful copy from index.html). A
// leaf child's contribution is its RULE-COMPUTED display health (computeDisplayHealth), never
// its raw stored `health` field — see index.html's own comment on this function for the full
// rationale and the no-self-reference argument. NOTE: computeDisplayHealth here is declared
// further down this file, but a `const` arrow function is only READ when rollup() is actually
// invoked at call time (not at parse time), so the forward reference is safe exactly as it is
// in index.html's own top-to-bottom script evaluation order.
export const HEALTH_PRIO = { red: 4, yellow: 3, paused: 2, green: 1, gray: 0, "": 0 };
export const computeRolledHealth = (all, settings) => {
  const byId = {}; all.forEach(t => { byId[t.id] = t; });
  const rollup = (id, stack) => {
    if (stack.has(id)) return byId[id]?.health || "";
    const children = all.filter(t => t.parentId === id);
    if (!children.length) { const t = byId[id]; return t ? (computeDisplayHealth(t, settings, byId) || "") : ""; }
    stack.add(id);
    let best = "", bestP = 0;
    for (const c of children) { const h = rollup(c.id, stack); const p = HEALTH_PRIO[h] || 0; if (p > bestP) { bestP = p; best = h; } }
    stack.delete(id);
    return best;
  };
  const map = {};
  all.forEach(t => { if (all.some(c => c.parentId === t.id)) map[t.id] = rollup(t.id, new Set()); });
  return map;
};

// Live "today" — in index.html this is module-scope `let NOW = fdLocal(new Date())`, refreshed on
// focus / midnight rollover. Settable here so tests can pin a deterministic today.
export let NOW = fdLocal(new Date());
export const setNOW = v => { NOW = v; };
// Test/audit hook: let a caller install a project-specific holiday set (the app rebuilds
// HOLIDAY_SET from settings.holidays on load; mirror that here so business-day math matches).
export const setHOLIDAY_SET = s => { HOLIDAY_SET = s; };

// ── Configurable health automation, v2 (faithful copy from index.html; B785744) ──────────────
// See index.html's own comment block for the full rationale; kept verbatim here.
export const RULE_FIELDS = [
  {k:"finish",          label:"Finish date",   type:"date"},
  {k:"start",           label:"Start date",    type:"date"},
  {k:"status",          label:"Status",        type:"status"},
  {k:"owner",           label:"Owner",         type:"text"},
  {k:"percentComplete", label:"% Complete",    type:"number"},
  {k:"cost",            label:"Cost",          type:"number"},
  {k:"budget",          label:"Budget",        type:"number"},
  {k:"actualCost",      label:"Actual Cost",   type:"number"},
  {k:"predecessor",     label:"Predecessor",   type:"flag"},
];
export const RULE_FIELD_BY_K = Object.fromEntries(RULE_FIELDS.map(f => [f.k, f]));
export const RULE_OPS = {
  date: [
    {k:"pastDueAtLeast",    label:"is N+ days past due",       needsValue:true,  defaultValue:1},
    {k:"withinDays",        label:"is within N days",           needsValue:true,  defaultValue:7},
    {k:"moreThanDaysAway",  label:"is more than N days away",   needsValue:true,  defaultValue:14},
    {k:"isToday",           label:"is today",                   needsValue:false},
    {k:"isBlank",           label:"is blank",                   needsValue:false},
    {k:"isNotBlank",        label:"is not blank",               needsValue:false},
  ],
  status: [
    {k:"is",    label:"is",     needsValue:true, valueKind:"status"},
    {k:"isNot", label:"is not", needsValue:true, valueKind:"status"},
  ],
  text: [
    {k:"isBlank",    label:"is blank",     needsValue:false},
    {k:"isNotBlank", label:"is not blank", needsValue:false},
    {k:"is",         label:"is",           needsValue:true, valueKind:"text"},
    {k:"contains",   label:"contains",     needsValue:true, valueKind:"text"},
  ],
  number: [
    {k:"eq",         label:"is",          needsValue:true, valueKind:"number"},
    {k:"gt",         label:"is more than",needsValue:true, valueKind:"number"},
    {k:"lt",         label:"is less than",needsValue:true, valueKind:"number"},
    {k:"gte",        label:"is at least", needsValue:true, valueKind:"number"},
    {k:"lte",        label:"is at most",  needsValue:true, valueKind:"number"},
    {k:"isBlank",    label:"is blank",     needsValue:false},
    {k:"isNotBlank", label:"is not blank", needsValue:false},
  ],
  flag: [
    {k:"isLate", label:"is late", needsValue:false},
  ],
};
export const opsForField = fieldK => RULE_OPS[RULE_FIELD_BY_K[fieldK]?.type] || [];

export const evalFieldCondition = (cond, task, NOWv, taskById) => {
  const field = cond?.field, op = cond?.op, value = cond?.value;
  if (field === "predecessor") {
    if (op !== "isLate") return false;
    const preds = Array.isArray(task.predecessors) ? task.predecessors : [];
    if (!preds.length || !taskById) return false;
    return preds.some(p => {
      const pt = taskById[p?.id];
      return !!pt && !!pt.end && (pt.percentComplete||0) < 100 && dif(pt.end, NOWv) >= 1;
    });
  }
  const ftype = RULE_FIELD_BY_K[field]?.type;
  if (!ftype) return false;
  if (ftype === "date") {
    const raw = field === "finish" ? task.end : task.start;
    const has = !!raw;
    switch (op) {
      case "isBlank":          return !has;
      case "isNotBlank":       return has;
      case "isToday":          return has && raw === NOWv;
      case "pastDueAtLeast":   return has && dif(raw, NOWv) >= (value ?? 1);
      case "withinDays":       { if (!has) return false; const d = dif(NOWv, raw); return d >= 0 && d <= (value ?? 7); }
      case "moreThanDaysAway": return has && dif(NOWv, raw) > (value ?? 0);
      default: return false;
    }
  }
  if (ftype === "status") {
    const raw = task.health;
    switch (op) {
      case "is":    return raw === value;
      case "isNot": return raw !== value;
      default: return false;
    }
  }
  if (ftype === "text") {
    if (field === "owner") {
      const list = ownerListOf(task);
      const v = String(value || "").trim().toLowerCase();
      switch (op) {
        case "isBlank":    return list.length === 0;
        case "isNotBlank": return list.length > 0;
        case "is":         return list.some(n => n.toLowerCase() === v);
        case "contains":   return v ? list.some(n => n.toLowerCase().includes(v)) : false;
        default: return false;
      }
    }
    const s = String(task[field] || "").trim();
    const v = String(value || "").trim().toLowerCase();
    switch (op) {
      case "isBlank":    return !s;
      case "isNotBlank": return !!s;
      case "is":         return s.toLowerCase() === v;
      case "contains":   return s.toLowerCase().includes(v);
      default: return false;
    }
  }
  const raw = task[field];
  const isBlank = raw === "" || raw == null;
  const num = isBlank || isNaN(raw) ? 0 : Number(raw);
  switch (op) {
    case "isBlank":    return isBlank;
    case "isNotBlank": return !isBlank;
    case "eq":  return num === Number(value);
    case "gt":  return num > Number(value);
    case "lt":  return num < Number(value);
    case "gte": return num >= Number(value);
    case "lte": return num <= Number(value);
    default: return false;
  }
};
export const evalConditionGroup = (conds, combinator, task, NOWv, taskById) => {
  if (!Array.isArray(conds) || !conds.length) return false;
  return combinator === "OR"
    ? conds.some(c => evalFieldCondition(c, task, NOWv, taskById))
    : conds.every(c => evalFieldCondition(c, task, NOWv, taskById));
};
export const evalRule = (rule, task, NOWv, taskById) => {
  if (!rule || !evalConditionGroup(rule.when, rule.whenCombinator, task, NOWv, taskById)) return null;
  if (evalConditionGroup(rule.unless, rule.unlessCombinator, task, NOWv, taskById)) return null;
  return rule.color;
};

export const LEGACY_RULE_FIELD_MAP = {
  finishPastDays:   days => [{field:"finish", op:"pastDueAtLeast", value: days ?? 1}],
  finishWithinDays: days => [{field:"finish", op:"withinDays",     value: days ?? 7}],
  finishToday:      ()   => [{field:"finish", op:"isToday"}],
  notStarted:       ()   => [{field:"start", op:"pastDueAtLeast", value:1}, {field:"percentComplete", op:"lte", value:0}],
  predecessorLate:  ()   => [{field:"predecessor", op:"isLate"}],
  noOwner:          ()   => [{field:"owner", op:"isBlank"}],
  complete:         ()   => [{field:"percentComplete", op:"gte", value:100}],
};
export const RULE_COMPLETE_PAUSED_GUARD = [{field:"status", op:"is", value:"green"}, {field:"status", op:"is", value:"paused"}];
export const migrateRule = r => {
  if (r && Array.isArray(r.when)) return r;
  const build = LEGACY_RULE_FIELD_MAP[r?.type];
  const when = build ? build(r.days) : [];
  const unless = (r && r.color && r.color !== "green") ? RULE_COMPLETE_PAUSED_GUARD : [];
  return {
    id: r?.id ?? `r${Math.random().toString(36).slice(2,10)}`,
    when, whenCombinator: "AND",
    color: r?.color,
    unless, unlessCombinator: "OR",
  };
};

// ⛔ RETAINED, UNUSED BY THE LIVE ENGINE — kept only as migrateRule's frozen behavioral reference
// and because the existing test suite pins its exact semantics.
export const HEALTH_CONDITIONS = [
  {k:"finishPastDays",   label:"Finish date is N+ days past due",     needsDays:true,  defaultDays:1},
  {k:"finishWithinDays", label:"Finish date is within N days",         needsDays:true,  defaultDays:7},
  {k:"finishToday",      label:"Finish date is today",                 needsDays:false},
  {k:"notStarted",       label:"Start date has passed, not started",   needsDays:false},
  {k:"predecessorLate",  label:"A predecessor is late",                needsDays:false},
  {k:"noOwner",          label:"No owner assigned",                    needsDays:false},
  {k:"complete",         label:"Task is 100% complete",                needsDays:false},
];
export const HEALTH_CONDITION_BY_KEY = Object.fromEntries(HEALTH_CONDITIONS.map(c => [c.k, c]));

export const evalHealthCondition = (type, days, task, NOWv, taskById) => {
  const pct = task.percentComplete || 0;
  switch (type) {
    case "finishPastDays":
      if (!task.end || pct >= 100) return false;
      return dif(task.end, NOWv) >= (days ?? 1);
    case "finishWithinDays": {
      if (!task.end || pct >= 100) return false;
      const d = dif(NOWv, task.end);
      return d >= 0 && d <= (days ?? 7);
    }
    case "finishToday":
      return !!task.end && pct < 100 && task.end === NOWv;
    case "notStarted":
      return !!task.start && pct <= 0 && dif(task.start, NOWv) >= 1;
    case "predecessorLate": {
      const preds = Array.isArray(task.predecessors) ? task.predecessors : [];
      if (!preds.length || !taskById) return false;
      return preds.some(p => {
        const pt = taskById[p?.id];
        return !!pt && !!pt.end && (pt.percentComplete||0) < 100 && dif(pt.end, NOWv) >= 1;
      });
    }
    case "noOwner":
      return ownerListOf(task).length === 0;
    case "complete":
      return pct >= 100;
    default:
      return false;
  }
};

export const migrateCfRulesToHealthRules = cfRules => {
  const cf = cfRules || {};
  const out = [];
  if (cf.completeGreen) out.push({id:"legacy-complete", type:"complete", color:"green"});
  if (cf.overdueRed)    out.push({id:"legacy-overdue",  type:"finishPastDays", days:1, color:"red"});
  if (cf.dueSoonYellow) out.push({id:"legacy-duesoon",  type:"finishWithinDays", days:7, color:"yellow"});
  return out;
};
export const DEFAULT_HEALTH_RULES = [
  {id:"default-overdue", when:[{field:"finish", op:"pastDueAtLeast", value:1}], whenCombinator:"AND",
    color:"red", unless:[...RULE_COMPLETE_PAUSED_GUARD], unlessCombinator:"OR"},
  {id:"default-duesoon", when:[{field:"finish", op:"withinDays", value:3}], whenCombinator:"AND",
    color:"yellow", unless:[...RULE_COMPLETE_PAUSED_GUARD], unlessCombinator:"OR"},
];
export const getHealthRules = settings => {
  const raw = Array.isArray(settings?.healthRules) ? settings.healthRules : migrateCfRulesToHealthRules(settings?.cfRules);
  return raw.map(migrateRule);
};
export const evalHealthRules = (task, settings, NOWv, taskById) => {
  const rules = getHealthRules(settings);
  for (const r of rules) { const c = evalRule(r, task, NOWv, taskById); if (c) return c; }
  return null;
};

// Compute display health (faithful copy from index.html ~L2563). ⛔ RULES-DECIDE (2026-08-25, owner
// correction — supersedes the earlier "RULES-ALWAYS-WIN" pass, which kept `healthOverride` as a
// fallback for when no rule matched). The override flag and its early return are RETIRED outright:
// nothing a user clicks can ever pin a task's color against a firing rule. The rule list runs first
// (first match wins); when no rule matches, the meeting-bound / deadline-row risk blocks below get
// their say (unrelated, always-on feature, unchanged), and the raw stored health is the final
// fallback either way. A task may still carry a `healthOverride` field in old stored data — dead,
// unread data; nothing here consults it anymore.
export const computeDisplayHealth = (task, settings, taskById) => {
  if (!task) return task?.health;
  // ⛔ COMPLETE-BEATS-ALL (2026-08-26, owner correction) — see index.html's own comment for the
  // full rationale. Marking a task Complete (task.health === "green") is evaluated ABOVE the rule
  // list, unconditionally.
  if (task.health === "green") return "green";
  const ruleResult = evalHealthRules(task, settings, NOW, taskById);
  if (ruleResult) return ruleResult;
  // B817 — a meeting-bound task surfaces its schedule risk BEFORE it slips: infeasible = red (a genuine
  // alert), ≤2 working days of float to the agenda deadline = at-risk yellow. Reads the cascade-derived
  // fields (no body lookup). Opt-in (only fires on bound rows); complete/paused rows are exempt.
  if (task.meetingBound && (task.percentComplete||0) < 100 && task.health !== "green" && task.health !== "paused") {
    if (task.meetingInfeasible) return "red";
    if (task.meetingDeadline && difBD(NOW, task.meetingDeadline) <= 2) return "yellow";
  }
  if (task.deadlineForTaskId != null && (task.percentComplete||0) < 100 && task.health !== "green" && task.health !== "paused") {
    if (task.deadlineInfeasible) return "red";
    if (task.end && difBD(NOW, task.end) >= 0 && difBD(NOW, task.end) <= 2) return "yellow";
  }
  return task.health;
};

// Focus-visibility classification for a LEAF task (faithful copy of the flatTasks rolledStatus leaf
// branch, index.html ~L6213). B717: it classifies by computeDisplayHealth (the grid's status), NOT
// raw health, so an overdue-but-Not-Started task that renders red is treated "active" and never
// hidden by Focus.
export const leafFocusStatus = h => h === "green" ? "done" : h === "gray" ? "upcoming" : h === "paused" ? "paused" : "active";
export const rolledStatusLeaf = (task, settings) => leafFocusStatus(computeDisplayHealth(task, settings));
// A leaf/sub-group is hideable by Focus unless it's "active" (index.html ~L6228).
export const hideStatusOf = status => status === "active" ? null : status;

// ── B816 (NEW-2) — meeting-bound snap (VERBATIM copy of public/sequence/index.html) ──
export let MEETING_BODY_INDEX = {};
export const applyMeetingBinding = (t, body, predEarly, drivingMeetingDate, minAfterDate) => {
  t.duration = 0;
  const pinnedDate = t.pinnedMeetingDate || (t.pinnedStart ? t.start : "");
  const packetReady = predEarly || (pinnedDate ? "" : t.start) || "";
  if (pinnedDate) {                                   // a person fixed this hearing — pin wins, never roll
    t.start = t.end = pinnedDate;
    t.meetingDeadline = agendaDeadline(body, pinnedDate) || "";
    // NEW-1 — a pinned date can be infeasible TWO different ways, and only one of them was ever
    // checked. `pinnedDate` here is almost always `pinnedStart` (updateTask sets that on ANY direct
    // date-cell edit — see its own comment — `pinnedMeetingDate` is a distinct deliberate-pin field
    // that nothing in this app ever sets), so a plain typed/dragged date on a meeting-bound row was
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
  let minAfterFloor = "";
  if (t.minMeetingsAfter && t.minMeetingsAfter.n > 0 && minAfterDate) {
    const seq = meetingDatesInRange(body, addD(minAfterDate, 1), addD(minAfterDate, 366 * 3));
    const nth = seq[t.minMeetingsAfter.n - 1];
    if (nth) minAfterFloor = addD(nth, -1);
  }
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
    if (!body.sameDayFilingAllowed) { const nd = addD(drivingMeetingDate, 1); if (nd > readyDate) readyDate = nd; }
  }
  if (minAfterFloor && (!afterDate || minAfterFloor > afterDate)) afterDate = minAfterFloor;
  const elig = nextEligibleMeeting(body, readyDate, afterDate);
  if (elig) { t.start = t.end = elig.meetingDate; t.meetingDeadline = elig.deadline; t.meetingInfeasible = false; t.meetingDateOffCalendar = false; }
  else { t.start = t.end = ""; t.meetingDeadline = ""; t.meetingInfeasible = false; t.meetingDateOffCalendar = false; }
};
export const cascadeDates = (tasks, bodies = []) => {
  const bodyMap = {...MEETING_BODY_INDEX};
  (Array.isArray(bodies) ? bodies : []).forEach(b => { if (b && b.id) bodyMap[b.id] = b; });
  const parentIds = new Set(tasks.filter(t => t.parentId !== null && t.parentId !== undefined).map(t => t.parentId));
  const map = {};
  tasks.forEach(t => { map[t.id] = {...t, predecessors: normPreds(t.predecessors)}; });
  // NEW-1 — a predecessor edge naming one of THIS task's own ancestors is not resolvable (an
  // ancestor's dates are rollup-derived from every descendant); see index.html for the full note.
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
    // B443249 — predecessors that contribute NO date (missing id, or a live row with no dates of its own).
    // Both were dropped in silence, so the successor showed a date derived from a SUBSET of its inputs.
    // NEW-1 — an ancestor-referencing edge is recorded here too, never silently dropped.
    t.predUnresolved = t.predecessors
      .filter(p => !map[p.id] || !(map[p.id].end || map[p.id].start) || isAncestorOf(p.id, id))
      .map(p => p.id);
    const bound = !!(t.meetingBound && bodyMap[t.meetingBodyId] && !parentIds.has(t.id) && !(t.pinnedEnd && t.end));
    // B864 — bound to a calendar that no longer exists (a lost meeting body). PRESERVE the stored date
    // (soft-pin, below) instead of reverting to a plain FS date, and flag it. VERBATIM mirror of index.html.
    const bodyMissing = !!(t.meetingBound && !bodyMap[t.meetingBodyId] && !parentIds.has(t.id));
    t.meetingBodyMissing = bodyMissing;
    // B443248 — a SUMMARY row's dates are OWNED by rollupParentDates. Deriving them here read durValue/
    // durUnit (fields a parent doesn't carry), collapsing a 40-day parent to a 0-day milestone on its own
    // start — and every FS successor then scheduled off that collapsed end. VERBATIM mirror of index.html.
    if (parentIds.has(t.id)) { t.finishConflict = false; t.startConflict = false; return; }
    // Locked FINISH (B616): the end is a FIXED POINT; the start back-calcs; the end never moves.
    if (t.pinnedEnd && t.end) {
      if (t.pinnedStart && t.start) {
        t.duration = t.start > t.end ? t.duration : Math.max(0, workdaysBetween(t.start, t.end));
        t.finishConflict = !!(t.start && t.start > t.end);
      } else {
        const backStart = startForEnd(t.end, t.duration);
        t.start = backStart;
        let conflict = false;
        if (preds.length) {
          const earliest = preds.map(p => constrainedStartFrom(map[p.id], p, t.duration)).filter(Boolean).reduce((a,b) => a>b?a:b, "");
          if (earliest && earliest > backStart) conflict = true;
        }
        t.finishConflict = conflict;
      }
      return;
    }
    t.finishConflict = false;
    t.startConflict = false;
    const predEarly = preds.length
      ? preds.map(p => constrainedStartFrom(map[p.id], p, Math.max(1, t.duration || 1))).filter(Boolean).reduce((a,b)=>a>b?a:b, "")
      : "";
    if (!preds.length || t.pinnedStart || (bodyMissing && t.start)) {
      const r = resolveTaskSpan(t); t.end = r.end; t.duration = r.duration;
      // B443250 — a pinned start wins over the chain, but a pin BEFORE what the chain allows is a real
      // conflict that used to be resolved silently. Flag it as a locked finish already does (B616).
      if (t.pinnedStart && t.start && predEarly && predEarly > t.start) t.startConflict = true;
    }
    else {
      const starts = preds.map(p => constrainedStartFrom(map[p.id], p, t.duration)).filter(Boolean);
      if (starts.length) t.start = starts.reduce((a,b) => a>b?a:b, starts[0]);
      const r = resolveTaskSpan(t); t.end = r.end; t.duration = r.duration;
    }
    if (bound) {
      const drivingMeetingDate = preds
        .filter(p => map[p.id] && map[p.id].meetingBound && map[p.id].start).map(p => map[p.id].start)
        .reduce((a,b) => a>b?a:b, "");
      const minAfterDate = (t.minMeetingsAfter && map[t.minMeetingsAfter.taskId]) ? map[t.minMeetingsAfter.taskId].start : "";
      applyMeetingBinding(t, bodyMap[t.meetingBodyId], predEarly, drivingMeetingDate, minAfterDate);
    } else if (bodyMissing) {
      t.meetingInfeasible = false; t.meetingDateOffCalendar = false;   // B864: preserve the stored date + last-known deadline; clear the unverifiable alert
    } else if (t.meetingDeadline || t.meetingInfeasible || t.meetingDateOffCalendar) {
      t.meetingDeadline = ""; t.meetingInfeasible = false; t.meetingDateOffCalendar = false;
    }
  });
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

export const rollupParentDates = tasks => {
  const map = {};
  tasks.forEach(t => { map[t.id] = {...t}; });
  const parentIds = new Set(tasks.filter(t => t.parentId !== null).map(t => t.parentId));
  if (!parentIds.size) return tasks;
  const childIdsByParent = new Map();
  tasks.forEach(t => {
    const p = t.parentId;
    if (p === null || p === undefined) return;
    if (!childIdsByParent.has(p)) childIdsByParent.set(p, []);
    childIdsByParent.get(p).push(t.id);
  });
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
      if (!map[pid]) return;
      const children = (childIdsByParent.get(pid) || []).map(id => map[id]).filter(Boolean);
      if (!children.length) return;
      const validStarts = children.map(t => t.start).filter(Boolean);
      const validEnds   = children.map(t => t.end  ).filter(Boolean);
      if (!validStarts.length || !validEnds.length) return;
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

// B836 — cascade-drift detector. A non-pinned task's SAVED start should always equal the start its
// predecessor chain implies. When it doesn't (a stale value from an older build, a hand-edited store,
// or a lag zeroed without a re-cascade — B835), the load re-cascade silently corrects it. This returns
// the corrected leaf tasks so the load path can surface the change LOUDLY (a banner) instead of swapping
// the number in silence. Pins are exempt (a pinned start is intentional); parents are excluded (their
// dates are always rollup-derived, not cascade drift). Pure — mirrored in public/sequence/index.html.
// B443248 — THE recompute: seed with a rollup so the first cascade reads real parent finishes, then
// iterate cascade→rollup to a FIXED POINT so a move propagates transitively down a chain of any depth.
// PASS_CAP is a runaway guard, never the normal exit. VERBATIM mirror of index.html.
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
export const detectCascadeDrift = (storedTasks, engineTasks) => {
  const eng = {}; (engineTasks || []).forEach(t => { eng[t.id] = t; });
  const parentIds = new Set((storedTasks || []).map(t => t.parentId).filter(p => p !== null && p !== undefined));
  const out = [];
  (storedTasks || []).forEach(t => {
    if (t.pinnedStart || (t.pinnedEnd && t.end)) return;   // intentional pins are exempt
    if (t.meetingBound || t.deadlineForTaskId != null) return;   // B864 — meeting-/deadline-derived dates aren't simple-cascade drift (like pins)
    if (parentIds.has(t.id)) return;                       // parents are rollup-derived, not cascade drift
    const e = eng[t.id];
    if (!e) return;
    const was = t.start || "", now = e.start || "";
    if (was !== now) out.push({ id: t.id, name: t.name || t.title || ("Task " + t.id), from: was, to: now });
  });
  return out;
};

// NEW-1 — ancestor ids of `id` within `tasks`, walking the parentId chain upward. VERBATIM mirror
// of public/sequence/index.html.
export const ancestorIdsOf = (tasks, id) => {
  const byId = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => { if (t) byId[t.id] = t; });
  const out = new Set();
  const seen = new Set([id]);
  let p = byId[id] ? byId[id].parentId : null;
  while (p != null && byId[p] && !seen.has(p)) { out.add(p); seen.add(p); p = byId[p].parentId; }
  return out;
};
// NEW-1 — drops a task's predecessor link(s) that name its own ancestor (a summary row's dates roll
// up from its children, so that edge can never converge). VERBATIM mirror of public/sequence/index.html.
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
// B836 — load-path glue: run the normal recompute (cascade → rollup) AND strip ancestor-predecessor
// edges first (they can never converge). VERBATIM mirror of public/sequence/index.html.
export const recascadeWithDrift = (tasks, pid, projName, driftSink, ancestorSink) => {
  const { tasks: clean, removed } = stripAncestorPredecessors(tasks);
  if (removed.length && ancestorSink) ancestorSink.push({ project: projName, pid, tasks: removed });
  const out = recomputeSchedule(clean);
  const removedIds = new Set(removed.map(r => r.id));
  const dr = detectCascadeDrift(clean, out).filter(d => !removedIds.has(d.id));
  if (dr.length) driftSink.push({ project: projName, pid, tasks: dr });
  return out;
};

// B864(b) — pure 3-way merge for the cloud whole-document save (VERBATIM mirror of public/sequence/index.html).
// The Scheduler cloud-saves the ENTIRE document last-write-wins; its rev-gate only BLOCKS a stale tab (and
// snapshots the loser to history), so a sibling tab's independent addition — e.g. a just-created meeting
// calendar — is lost when the other tab wins (the multi-writer clobber that orphaned hs-v1's election
// binding, B864). Instead of blocking, we REBASE our changes onto the newer cloud doc:
//   base   = the doc THIS tab last loaded or saved (the common ancestor)
//   ours   = this tab's current doc (base + our edits)
//   theirs = the newer cloud doc a sibling wrote (base + their edits)
// Rules, applied recursively on plain objects: a side unchanged vs base yields to the side that changed;
// a per-key add on either side survives; a delete on one side is honored only if the other side left that
// key untouched; a genuine both-changed conflict on the same leaf/array prefers OURS (the actively-edited
// tab), with the losing copy still recoverable from Version History. Pure + deterministic.
export const _mIsObj = v => !!v && typeof v === "object" && !Array.isArray(v);
export const _mEq = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; } };
export const _mStripRev = o => { if (_mIsObj(o)) { const { __rev, ...rest } = o; return rest; } return o; };
// Arrays of id-bearing objects (tasks, meetingBodies, contacts, customHealth…) are keyed collections, not
// ordered scalars — so both tabs editing DIFFERENT elements of the same array must merge per element, keyed
// by id, not "whole array, active tab wins" (which was silently dropping a sibling's binding). Order follows
// OURS for shared/our elements; a sibling's brand-new element is appended (load re-derives visual order).
const _mIdArr = a => Array.isArray(a) && a.length > 0 && a.every(e => _mIsObj(e) && "id" in e);
// NEW-1 (false-conflict/merge-toast inflation) — match an id-keyed array element by its permanent
// `_sid` when it carries one (a task, once migrated), falling back to plain `id` for every other
// id-keyed array. VERBATIM mirror of public/sequence/index.html.
export const _mKeyOf = e => (_mIsObj(e) && e._sid != null) ? ("sid:" + e._sid) : (e && e.id);
export const mergeCloudDoc = (base, ours, theirs) => {
  if (_mEq(ours, theirs)) return theirs;
  if (_mEq(ours, base)) return theirs;    // we changed nothing vs base → take the newer cloud
  if (_mEq(theirs, base)) return ours;    // cloud unchanged vs base → our doc IS the update
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    if (!_mIdArr(ours) || !_mIdArr(theirs)) return ours;   // scalar/mixed array both changed → active tab wins
    const bArr = Array.isArray(base) ? base : [];
    const byKey = arr => { const m = new Map(); arr.forEach(e => { const k = _mKeyOf(e); if (!m.has(k)) m.set(k, e); }); return m; };
    const bM = byKey(bArr), tM = byKey(theirs), oSeen = new Set();
    const out = [];
    for (const e of ours) {                // keep OUR order for shared/our-only elements
      const k = _mKeyOf(e);
      if (oSeen.has(k)) continue; oSeen.add(k);
      const inT = tM.has(k), inB = bM.has(k);
      if (inT) out.push(mergeCloudDoc(inB ? bM.get(k) : undefined, e, tM.get(k)));
      else if (!(inB && _mEq(e, bM.get(k)))) out.push(e);   // their delete honored only if we left it as-base
    }
    for (const e of theirs) {              // append a sibling's brand-new / changed elements (their adds survive)
      const k = _mKeyOf(e);
      if (oSeen.has(k)) continue;
      const inB = bM.has(k);
      if (!(inB && _mEq(e, bM.get(k)))) out.push(e);        // our delete honored only if they left it as-base
    }
    return out;
  }
  if (!_mIsObj(ours) || !_mIsObj(theirs)) return ours;   // scalar both changed → active tab wins
  const b = _mIsObj(base) ? base : {};
  const out = {};
  for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const inO = has(ours, k), inT = has(theirs, k), inB = has(b, k);
    if (inO && inT) { out[k] = mergeCloudDoc(b[k], ours[k], theirs[k]); continue; }
    if (inO && !inT) {                    // theirs lacks k: their delete (if we left it as-base) else our add/change
      if (!(inB && _mEq(ours[k], b[k]))) out[k] = ours[k];
      continue;
    }
    if (!inO && inT) {                     // ours lacks k: our delete (if they left it as-base) else their add/change
      if (!(inB && _mEq(theirs[k], b[k]))) out[k] = theirs[k];   // preserves a sibling's just-added calendar
      continue;
    }
  }
  return out;
};
// NEW-1 — for TASK content comparison only: map this array's own positional `id` → its permanent
// `_sid`, then rewrite a task's cross-reference fields from the renumbered id they point at to that
// same stable sid before comparing. VERBATIM mirror of public/sequence/index.html.
export const _taskSidMap = tasks => { const m = new Map(); (tasks || []).forEach(t => { if (t && t._sid != null) m.set(t.id, t._sid); }); return m; };
export const _taskKey = t => (t && t._sid != null) ? ("sid:" + t._sid) : (t ? t.id : t);
export const _taskFingerprint = (t, sidOf) => {
  if (!t || typeof t !== "object") return t;
  const { id, _sid, focused, ...rest } = t;   // id/_sid: identity, compared separately; focused: view-only
  if (rest.parentId != null) rest.parentId = sidOf.get(rest.parentId) ?? rest.parentId;
  if (Array.isArray(rest.predecessors)) rest.predecessors = rest.predecessors.map(p => (p && p.id != null) ? { ...p, id: sidOf.get(p.id) ?? p.id } : p);
  if (rest.deadlineForTaskId != null) rest.deadlineForTaskId = sidOf.get(rest.deadlineForTaskId) ?? rest.deadlineForTaskId;
  if (rest.minMeetingsAfter && rest.minMeetingsAfter.taskId != null) {
    rest.minMeetingsAfter = { ...rest.minMeetingsAfter, taskId: sidOf.get(rest.minMeetingsAfter.taskId) ?? rest.minMeetingsAfter.taskId };
  }
  return rest;
};
// NEW-3 — how many task rows a merge actually brought in from elsewhere. VERBATIM mirror of
// public/sequence/index.html.
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

// NEW-1 (owner follow-on to B1696640/B1696641/B1696642, 2026-09-16) — the schedule-ownership model
// (which Planyr project a schedule belongs to) plus the notice-label helpers built on it. VERBATIM
// mirror of public/sequence/index.html.
export const ORG_OWNER_KEY = "__org__";
export const OWNER_KIND_SITE = "site";
export const OWNER_KIND_ORG = "org";
export const ORG_OWNER_LABEL = "Organization";
export function ownerOf(schedule) {
  const s = schedule && typeof schedule === "object" ? schedule : {};
  const siteId = s.linkedSiteId != null && s.linkedSiteId !== "" ? s.linkedSiteId : null;
  const siteName = s.linkedSiteName != null && s.linkedSiteName !== "" ? s.linkedSiteName : null;
  if (s.ownerKind === OWNER_KIND_ORG) return { kind: OWNER_KIND_ORG, siteId: null, siteName: null, key: ORG_OWNER_KEY };
  if (s.ownerKind === OWNER_KIND_SITE && siteId != null) return { kind: OWNER_KIND_SITE, siteId, siteName, key: siteId };
  if (s.ownerKind == null && siteId != null) return { kind: OWNER_KIND_SITE, siteId, siteName, key: siteId };
  return { kind: OWNER_KIND_ORG, siteId: null, siteName: null, key: ORG_OWNER_KEY };
}

// "<Project> / <Schedule>" — the disambiguating label for a notice naming a row possibly outside
// the schedule on screen (two Planyr projects can each hold a schedule named "Master Schedule").
export function crossScheduleLabel(schedule) {
  const name = (schedule && schedule.name) || "Untitled schedule";
  const owner = ownerOf(schedule);
  const left = owner.kind === OWNER_KIND_ORG ? ORG_OWNER_LABEL : (owner.siteName || "an unnamed project");
  return `${left} / ${name}`;
}

// The prefix a notice prints before "#<id> "<name>"": nothing for a row already on screen, else
// crossScheduleLabel + a trailing space. String-compares pid/currentPid (object-key vs numeric id).
export function scheduleRowPrefix(projects, pid, currentPid) {
  if (pid == null || String(pid) === String(currentPid)) return "";
  const schedule = projects && projects[pid];
  if (!schedule) return "";
  return crossScheduleLabel(schedule) + " ";
}

// Which schedules (pids) a merge actually touched, for the "Merged in changes saved elsewhere" toast.
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

// The short "where" phrase for the merge toast.
export function mergeLocationPhrase(projects, changedPids, currentPid) {
  if (!changedPids || !changedPids.length) return "";
  if (changedPids.length === 1 && String(changedPids[0]) === String(currentPid)) return "in this schedule";
  const shown = changedPids.slice(0, 2).map(pid => crossScheduleLabel((projects && projects[pid]) || {}));
  const extra = changedPids.length - shown.length;
  return "in " + shown.join(", ") + (extra > 0 ? `, +${extra} more` : "");
}

// B835 (recurrence ×2) — the scheduling-input gate updateTask uses to decide whether an edit must re-run
// cascadeDates + rollupParentDates before persist. VERBATIM mirror of public/sequence/index.html.
// A typed duration edit commits {durValue,durUnit} (grid + master-view cells) and an unpin/unlock
// commits {pinnedStart:false} / {pinnedEnd:false,durValue,durUnit}; the pre-fix gate omitted those
// keys, so the edited task's own end updated but successors never cascaded — stale downstream dates +
// stale persist (the B835 recurrence). Any key NOT here can't move a date, so it skips the cascade.
export const SCHEDULE_INPUT_KEYS = ['start','end','duration','durValue','durUnit','predecessors','pinnedStart','pinnedEnd','meetingBound','meetingBodyId','pinnedMeetingDate','minMeetingsAfter','deadlineForTaskId'];
export const touchesSchedule = updates => !!updates && SCHEDULE_INPUT_KEYS.some(k => k in updates);

// B752848 (2026-08-25) — updateTask's "when health changes on a parent, cascade to all descendants"
// block, VERBATIM mirror of public/sequence/index.html's updateTask closure (~L6350-6365). This
// fragment previously had NO unit test at all — it lives inside a React useCallback closure that
// can't be imported, so per #1085 it was only ever exercised live in the browser. Extracted here
// (byte-identical logic, just lifted to module scope) so the "no healthOverride stamp" claim in
// RULES-DECIDE is proven by a real unit test, not only by the source-regex anti-drift checks below.
export const getDescIds = (id, all) => {
  const kids = all.filter(t => t.parentId === id);
  return [...kids.map(k => k.id), ...kids.flatMap(k => getDescIds(k.id, all))];
};
export const recolorBranch = (tasks, taskId, health) => {
  const descIds = new Set(getDescIds(taskId, tasks));
  if (descIds.size === 0) return tasks;
  const extra = health === 'green' ? { percentComplete: 100 } : {};
  return tasks.map(t => descIds.has(t.id) ? { ...t, health, ...extra } : t);
};

// Export filename — matches the Site Planner's PDF/PNG naming ("YYYY.MM.DD {Project} - {Plan}");
// here the trailing slot is "Schedule". Faithful copy from index.html (date injectable for tests).
export const scheduleExportName = (projects, date = new Date()) => {
  const p2 = n => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}.${p2(date.getMonth() + 1)}.${p2(date.getDate())}`;
  const clean = s => String(s == null ? "" : s).replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const names = (Array.isArray(projects) ? projects : []).map(p => p && p.name).filter(Boolean);
  const proj = clean(names.length === 1 ? names[0] : "Planyr") || "Planyr";
  return `${stamp} ${proj} - Schedule`;
};
export const parseFlexDate = s => {
  if (!s) return null; s = String(s).trim();
  // ISO fast-path that still rejects impossible calendar dates (mirror of index.html).
  const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoM) {
    const Y = +isoM[1], Mo = +isoM[2], Da = +isoM[3];
    const chk = new Date(s + "T12:00:00");
    return (!isNaN(chk) && chk.getMonth() + 1 === Mo && chk.getDate() === Da && Mo >= 1 && Mo <= 12 && Y >= 2000) ? s : null;
  }
  const parts = s.split(/[\/\-\.]/);
  if (parts.length < 2) return null;
  const m = parseInt(parts[0], 10), d = parseInt(parts[1], 10);
  let y = (parts[2] !== undefined && parts[2] !== "") ? parseInt(parts[2], 10) : new Date().getFullYear();
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000) return null;
  const iso = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const chk = new Date(iso + "T12:00:00");
  if (isNaN(chk) || chk.getMonth() + 1 !== m || chk.getDate() !== d) return null;
  return iso;
};

// NEW-1 (false-conflict/merge-toast inflation) — mint a permanent per-task identity, independent
// of the positional `id` renumberTasks reassigns below. VERBATIM mirror of public/sequence/index.html.
let _sidSeq = 0;
export const _mintTaskSid = () => "s" + Date.now().toString(36) + (_sidSeq++).toString(36) + Math.random().toString(36).slice(2, 7);
export const _legacySid = (pid, id) => `legacy:${pid}:${id}`;

export const renumberTasks = (tasks) => {
  const map = {};
  // B568: first-occurrence wins on a duplicate id (see index.html) — original task in visual order
  // keeps the reference, instead of the last occurrence silently capturing it. No-op for clean data.
  tasks.forEach((t, i) => { if (!(t.id in map)) map[t.id] = i + 1; });
  return tasks.map((t, i) => ({
    ...t,
    id: i + 1,
    _sid: t._sid || _mintTaskSid(),   // NEW-1 — preserve if present, mint fresh only the first time
    parentId: t.parentId !== null && t.parentId !== undefined ? (map[t.parentId] ?? null) : null,
    predecessors: normPreds(t.predecessors).map(p => ({...p, id: map[p.id]})).filter(p => p.id),
    ...(t.deadlineForTaskId != null ? { deadlineForTaskId: map[t.deadlineForTaskId] ?? null } : {}),
    ...(t.minMeetingsAfter && t.minMeetingsAfter.taskId != null
      ? { minMeetingsAfter: (map[t.minMeetingsAfter.taskId] ? { ...t.minMeetingsAfter, taskId: map[t.minMeetingsAfter.taskId] } : undefined) }
      : {}),
  }));
};

export const sortByVisualOrder = (tasks) => {
  const childMap = {};
  tasks.forEach(t => {
    const p = t.parentId ?? null;
    if (!childMap[p]) childMap[p] = [];
    childMap[p].push(t);
  });
  const result = [];
  const walk = (parentId) => {
    (childMap[parentId] || []).forEach(t => { result.push(t); walk(t.id); });
  };
  walk(null);
  const seen = new Set(result.map(t => t.id));
  tasks.filter(t => !seen.has(t.id)).forEach(t => result.push(t));
  return result;
};

const DEFAULT_SETTINGS = {defaultSplit:60, snapDefault:true, holidays:{...DEFAULT_HOLIDAYS}, customHealth:[], healthLabelOverrides:{}, barLabels:{left:"start", right:"end", year:true, nameAlign:"left"}, rowHeight:24};

// The four load-path normalizers (copied from inside the App component in index.html).
export const normalizeToV6 = d => {
  if (!d || typeof d !== "object") d = {};
  if (d._v6) return d;
  const projects = {};
  const srcProjects = (d.projects && typeof d.projects === "object") ? d.projects : {};
  Object.entries(srcProjects).forEach(([id, proj]) => {
    if (!proj || typeof proj !== "object") return;
    const srcTasks = Array.isArray(proj.tasks) ? proj.tasks : [];
    const tasks = srcTasks.filter(t => t && typeof t === "object").map(t => ({
      ...t,
      predecessors: normPreds(t.predecessors),
      end: calcEnd(t.start, t.duration),
    }));
    projects[id] = {...proj, tasks: rollupParentDates(tasks)};
  });
  return {...d, projects, _v6: true, healthColStyle: d.healthColStyle || "stoplight",
    settings: d.settings ? {...DEFAULT_SETTINGS, ...d.settings, holidays:{...DEFAULT_HOLIDAYS,...(d.settings.holidays||{})}, customHealth: d.settings.customHealth||[], healthLabelOverrides: d.settings.healthLabelOverrides||{}} : {...DEFAULT_SETTINGS, holidays:{...DEFAULT_HOLIDAYS}}};
};
// B615 duration-model migration — faithful copy of normalizeToV7 in index.html. Stamps durUnit/
// durValue (legacy = working days = unit 'd'), re-derives to the SAME end for 'd', idempotent (_v7).
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
      if (t.pinnedEnd && t.end) return {...t, durUnit, durValue};
      const r = resolveDuration(t.start, durValue, durUnit);
      return {...t, durUnit, durValue, duration: r.duration, end: r.end};
    });
    projects[id] = {...proj, tasks: rollupParentDates(tasks)};
  });
  return {...d, projects, _v7: true};
};
// ⛔ RETIRED (2026-08-25, B752848 owner correction): normalizeToV9 seeded the now-deleted
// `healthOverride` flag on load. Removed along with the flag itself.
export const ensureHolidays = d => {
  if (!d?.settings) return d;
  const merged = {...DEFAULT_HOLIDAYS, ...(d.settings.holidays||{})};
  return {...d, settings: {...d.settings, holidays: merged}};
};
export const normalizeIds = d => {
  if (!d?.projects) return d;
  const projects = {};
  Object.entries(d.projects).forEach(([pid, proj]) => {
    if (!proj || typeof proj !== "object") return;
    const tasks0 = (Array.isArray(proj.tasks) ? proj.tasks : []).filter(t => t && typeof t === "object").map(t => (t.duration === "" || t.duration == null) ? {...t, duration: 0} : t);
    // B550: break any parentId cycle on load (faithful copy of the index.html fix)
    const byId = {}; tasks0.forEach(t => { byId[t.id] = t; });
    const tasks = tasks0.map(t => {
      const seen = new Set([t.id]); let p = t.parentId;
      while (p != null && byId[p]) { if (seen.has(p)) return {...t, parentId: null}; seen.add(p); p = byId[p].parentId; }
      return t;
    });
    // NEW-1 — deterministic legacy _sid backfill (see index.html's normalizeIds for the full
    // rationale: two tabs migrating the SAME still-unmigrated doc must derive the identical sid).
    const tasksWithSid = tasks.map(t => (t._sid ? t : { ...t, _sid: _legacySid(pid, t.id) }));
    projects[pid] = {...proj, tasks: renumberTasks(sortByVisualOrder(tasksWithSid))};
  });
  const nTid = {...(d.nTid || {})};
  Object.entries(projects).forEach(([pid, proj]) => { nTid[pid] = (proj.tasks?.length || 0) + 1; });
  return {...d, projects, nTid};
};
// One-time shape fix: a legacy `responsibleParty` string becomes a one-element list. Naturally
// idempotent, so — unlike normalizeToV6/V7, which gate on their own version flag — this needs none.
export const normalizeOwnerLists = d => {
  if (!d || typeof d !== "object") return d;
  const projects = {};
  const srcProjects = (d.projects && typeof d.projects === "object") ? d.projects : {};
  Object.entries(srcProjects).forEach(([id, proj]) => {
    if (!proj || typeof proj !== "object") { projects[id] = proj; return; }
    const srcTasks = Array.isArray(proj.tasks) ? proj.tasks : [];
    projects[id] = {...proj, tasks: srcTasks.map(t => (t && typeof t === "object") ? {...t, responsibleParty: ownerListOf(t)} : t)};
  });
  return {...d, projects};
};
export const ensureContacts = d => {
  if (!d?.projects) return d;
  const existing = (d.settings?.contacts || []);
  const existingNames = new Set(existing.map(c => String(c?.name || '').toLowerCase()));
  const seen = new Set();
  Object.values(d.projects).forEach(proj => {
    ((proj && Array.isArray(proj.tasks)) ? proj.tasks : []).forEach(t => {
      ownerListOf(t).forEach(rp => {
        if (rp && !existingNames.has(rp.toLowerCase()) && !seen.has(rp.toLowerCase())) {
          existing.push({ id: Date.now() + existing.length + seen.size, name: rp, email: '' });
          existingNames.add(rp.toLowerCase());
          seen.add(rp.toLowerCase());
        }
      });
    });
  });
  return {...d, settings: {...d.settings, contacts: existing}};
};
// NEW-1 (2026-09-22) — one-time migration of every meetingBodies[].recurrence[] rule from the old
// {freq,setpos,onOrAfter} shape to the new sentence-UI shape {positions,weekday,months,anchor}. A
// DISTINCT flag (_mbv2, not _v9) — the retired normalizeToV9 already stamped `_v9:true` on every
// real schedule loaded since 2026-08-25, so reusing that flag would silently skip this migration on
// every one of them. Runs BEFORE normalizeToV8 rebuilds MEETING_BODY_INDEX, so the index always
// reflects already-migrated rules. The only anchor shape the OLD UI could ever produce was
// weekday:2 (Tue) + onOrAfter:2 (the "Tuesday after the 1st Monday" / Election Day primitive) —
// that maps exactly to the new anchor {position:1, weekday:1 (Mon)}; anything else defensively
// drops the (never-produced-by-UI) onOrAfter rather than guess, and says so loudly.
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
// The full load pipeline as index.html composes it.
export const loadPipeline = d => ensureContacts(normalizeOwnerLists(normalizeIds(ensureHolidays(normalizeToV7(normalizeToV6(normalizeMeetingCadence(d)))))));

// Faithful logic copy of rebuildHEALTH (index.html mutates module globals; this returns
// the maps so it's testable). Builds the status color maps from settings.customHealth +
// healthLabelOverrides, defensively skipping corrupt entries.
const BASE_HEALTH = { gray:{label:"Not Started"}, yellow:{label:"In Progress"}, red:{label:"Needs Attn."}, green:{label:"Complete"}, paused:{label:"Paused"} };
const BASE_HK = ["gray","yellow","red","green","paused"];
const BASE_HDARK = {gray:"#6b7280",yellow:"#92400e",red:"#991b1b",green:"#166534",paused:"#4b5563"};
export const rebuildHealthMaps = (custom = [], labelOverrides = {}) => {
  const HEALTH = {...BASE_HEALTH}, HK = [...BASE_HK], HDARK = {...BASE_HDARK};
  if (labelOverrides && typeof labelOverrides === "object") {
    Object.entries(labelOverrides).forEach(([k, label]) => { if (HEALTH[k]) HEALTH[k] = {...HEALTH[k], label}; });
  }
  (Array.isArray(custom) ? custom : []).forEach(ch => {
    if (!ch || typeof ch !== "object" || ch.k == null) return;
    HEALTH[ch.k] = {label:ch.label, dot:ch.dot, border:"none", bar:ch.bar, ganttBar:ch.dot, ganttStyle:"solid"};
    HDARK[ch.k]  = ch.dark || ch.dot;
    if (!HK.includes(ch.k)) HK.push(ch.k);
  });
  return { HEALTH, HK, HDARK };
};

// B1777120 — pure decomposition of the whole-account cloud document into the shape the
// dual-write path upserts into public.schedules / public.schedule_account_index. Mirrors
// schedules_decompose_from_planar_data() in
// src/workspaces/scheduler/db/schedules_decompose_recompose.sql field-for-field; `data` per
// schedule stays the COMPLETE untouched project object, matching that SQL function's own
// documented shape decision. Pure — no Supabase calls — so dualWriteScheduleRows (index.html
// only, not mirrored here: it's pure I/O over this) stays trivially thin.
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
  const { projects: _p, nPid, nTid, lastActiveBySite, settings, __rev, ...migrationFlags } = doc;
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
// either — a caller that needs one, e.g. the dual-read scaffold, attaches it itself from a
// separate cheap read). Returns null when there's no index row to build from (the caller's
// signal to fall back to the blob).
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
