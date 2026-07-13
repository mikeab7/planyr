// Faithful extraction of the Scheduler date/cascade engine from
// public/sequence/index.html (lines ~389-697, 935-944).
// Copied VERBATIM so the stress harness exercises the real code paths.
// Keep in sync if the source changes.

export const fd = d => d.toISOString().slice(0,10);
export const fdLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const pd = s => new Date(s + "T12:00:00");
export const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return fd(d); };
export const dif  = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);

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
export const nthWeekdayOfMonth = (y, m, weekday, setpos) => {
  if (setpos === -1) return fdLocal(nthWeekday(y, m, -1, weekday));
  const d = nthWeekday(y, m, setpos, weekday);
  return (d.getMonth() === m - 1) ? fdLocal(d) : null;
};
export const meetingDatesInRange = (body, from, to) => {
  if (!body || !from || !to || from > to) return [];
  const set = new Set();
  const inWin = (iso, r) => (!r.effectiveFrom || iso >= r.effectiveFrom) && (!r.effectiveTo || iso <= r.effectiveTo);
  const fromY = pd(from).getFullYear(), toY = pd(to).getFullYear();
  (Array.isArray(body.recurrence) ? body.recurrence : []).forEach(r => {
    if (!r || r.weekday == null) return;
    if (r.freq === "weekly") {
      const hasAnchor = !!r.effectiveFrom;
      const interval = (r.interval > 1 && hasAnchor) ? Math.trunc(r.interval) : 1;
      const cur = pd(hasAnchor ? r.effectiveFrom : from);
      while (cur.getDay() !== r.weekday) cur.setDate(cur.getDate() + 1);
      const end = pd(to);
      let wk = 0;
      while (cur <= end) {
        const iso = fdLocal(cur);
        if (iso >= from && (wk % interval === 0) && inWin(iso, r)) set.add(iso);
        cur.setDate(cur.getDate() + 7); wk++;
      }
    } else {   // monthly (default)
      const setpos = Array.isArray(r.setpos) ? r.setpos : (r.setpos != null ? [r.setpos] : []);
      const months = (Array.isArray(r.months) && r.months.length) ? r.months : null;
      const anchorYM = r.effectiveFrom ? (pd(r.effectiveFrom).getFullYear() * 12 + pd(r.effectiveFrom).getMonth()) : null;
      const interval = (r.interval > 1 && anchorYM != null) ? Math.trunc(r.interval) : 1;
      for (let y = fromY; y <= toY; y++) for (let m = 1; m <= 12; m++) {
        if (months && !months.includes(m)) continue;
        if (interval > 1 && ((((y * 12 + (m - 1) - anchorYM) % interval) + interval) % interval) !== 0) continue;
        setpos.forEach(sp => {
          const iso = nthWeekdayOfMonth(y, m, r.weekday, sp);
          if (iso && iso >= from && iso <= to && inWin(iso, r)) set.add(iso);
        });
      }
    }
  });
  (Array.isArray(body.blackoutDates) ? body.blackoutDates : []).forEach(d => set.delete(d));
  (Array.isArray(body.extraDates) ? body.extraDates : []).forEach(d => { if (d >= from && d <= to) set.add(d); });
  return [...set].sort();
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
export const normPreds = arr => {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => {
    if (x === null || x === undefined) return null;
    if (typeof x === "object") return {id: x.id, type: (x.type||"FS").toUpperCase(), lag: x.lag||0};
    if (typeof x === "number" && !isNaN(x)) return {id: x, type: "FS", lag: 0};
    return null;
  }).filter(Boolean);
};
export const parsePreds = raw => {
  const str = String(raw||"").trim();
  if (!str) return [];
  return str.split(/[,;]/).map(p => {
    p = p.trim(); if (!p) return null;
    const m = p.match(/^(\d+)\s*(FS|FF|SS|SF)?\s*([+-]\s*\d+)?\s*d?$/i);
    if (!m) return null;
    return {id: parseInt(m[1]), type: (m[2]||"FS").toUpperCase(), lag: m[3] ? parseInt(m[3].replace(/\s/g,"")) : 0};
  }).filter(Boolean);
};
// Validate a proposed predecessor list for task `id` (faithful copy from index.html):
// drops self-refs, refs to nonexistent ids, and refs that would create a circular dependency.
export const validatePredEdit = (tasks, id, parsed) => {
  const list = Array.isArray(parsed) ? parsed : [];
  const selfRemoved = list.some(p => p && p.id === id);
  let preds = list.filter(p => p && p.id !== id);
  const known = new Set((Array.isArray(tasks) ? tasks : []).map(t => t.id));
  const unknownIds = [...new Set(preds.filter(p => !known.has(p.id)).map(p => p.id))];
  preds = preds.filter(p => known.has(p.id));
  const predMap = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => { predMap[t.id] = normPreds(t.predecessors).map(p => p.id); });
  const reachesId = startId => {
    const stack = [startId], seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === id) return true;
      if (seen.has(cur)) continue; seen.add(cur);
      (predMap[cur] || []).forEach(x => stack.push(x));
    }
    return false;
  };
  const accepted = [], cyclic = [];
  preds.forEach(p => { if (reachesId(p.id)) cyclic.push(p.id); else accepted.push(p); });
  return { preds: accepted, selfRemoved, unknownIds, cyclic };
};
export const constrainedStartFrom = (pred, dep, taskDur) => {
  const lag = dep.lag || 0;
  switch ((dep.type||"FS").toUpperCase()) {
    case "FS": return addBD(pred.end, 1 + lag);
    case "SS": return addBD(pred.start, lag);
    case "FF": { const cEnd = addBD(pred.end, lag);
                 return taskDur <= 1 ? cEnd : addBD(cEnd, 1 - taskDur); }
    case "SF": { const cEnd = addBD(pred.start, lag);
                 return taskDur <= 1 ? cEnd : addBD(cEnd, 1 - taskDur); }
    default:   return addBD(pred.end, 1 + lag);
  }
};
export const calcEnd = (start, dur) => !start ? "" : dur === 0 ? start : addBD(start, Math.max(0, dur - 1));

// ── Duration model (B615): days/weeks = WORKING days · months/years = CALENDAR-real ──────
// Faithful copy of the pure helpers in public/sequence/index.html. Keep in sync.
const DUR_UNIT_ALIASES = [
  { re: /^(mo|mos|month|months)$/,               unit: "mo" },
  { re: /^(y|yr|yrs|year|years)$/,               unit: "y"  },
  { re: /^(w|wk|wks|week|weeks)$/,               unit: "w"  },
  { re: /^(d|day|days|wd|workday|workdays)$/,    unit: "d"  },
];
export const parseDurationInput = raw => {
  const str = String(raw == null ? "" : raw).trim().toLowerCase();
  if (str === "") return { value: 0, unit: "d" };
  const m = str.match(/^(-?\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!m) return { error: `Couldn't read "${String(raw).trim()}" — try 10d, 3w, 2mo, or 1y` };
  let value = Math.trunc(Number(m[1]));
  if (!Number.isFinite(value) || value < 0) return { error: `Duration can't be negative — try 10d, 3w, 2mo, or 1y` };
  value = Math.min(value, 100000);
  const suffix = m[2];
  if (suffix === "") return { value, unit: "d" };
  const hit = DUR_UNIT_ALIASES.find(u => u.re.test(suffix));
  if (!hit) return { error: `Unknown unit "${suffix}" — try d (days), w (weeks), mo (months), y (years)` };
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
  const months = u === "y" ? v * 12 : v;
  const end = rollForwardToWorkday(addCalendarMonths(start, months));
  return { end, duration: workdaysBetween(start, end) };
};
export const taskDurValue = t => (t.durValue != null ? t.durValue : (typeof t.duration === "number" ? t.duration : 0));
export const taskDurUnit  = t => t.durUnit || "d";
export const resolveTaskSpan = t => resolveDuration(t.start, taskDurValue(t), taskDurUnit(t));
export const startForEnd = (end, duration) => !end ? "" : (duration <= 1 ? end : addBD(end, -(Math.max(1, duration) - 1)));
export const fmtTaskDuration = t => {
  if (t.duration === "" || t.duration == null) return "";
  return `${taskDurValue(t)}${taskDurUnit(t)}`;
};

// Worst-of-descendants rolled status for each parent task (faithful copy from index.html).
export const HEALTH_PRIO = { red: 4, yellow: 3, paused: 2, green: 1, gray: 0, "": 0 };
export const computeRolledHealth = (all) => {
  const rollup = (id, stack) => {
    const children = all.filter(t => t.parentId === id);
    if (!children.length || stack.has(id)) return all.find(t => t.id === id)?.health || "";
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

// Conditional-format display health (faithful copy from index.html ~L1976). Applies the cfRules
// (completeGreen / overdueRed / dueSoonYellow) on top of the raw stored health — this is the value
// the grid's Status column shows.
export const computeDisplayHealth = (task, settings) => {
  const cf = settings?.cfRules || {};
  if (!task) return task?.health;
  // Rule order matters: more specific overrides general
  if (cf.completeGreen && (task.percentComplete||0) >= 100) return "green";
  if (cf.overdueRed && task.end && task.end < NOW && (task.percentComplete||0) < 100 && task.health !== "green" && task.health !== "paused" && task.health !== "red") return "red";
  if (cf.dueSoonYellow && task.end && task.end >= NOW && task.health === "gray") {
    // Within 7 calendar days
    const today = new Date(NOW + "T12:00:00");
    const end = new Date(task.end + "T12:00:00");
    const days = Math.ceil((end - today) / 86400000);
    if (days <= 7) return "yellow";
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

export const cascadeDates = tasks => {
  const map = {};
  tasks.forEach(t => { map[t.id] = {...t, predecessors: normPreds(t.predecessors)}; });
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
    const preds = t.predecessors.filter(p => map[p.id]);
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
    if (!preds.length || t.pinnedStart) { const r = resolveTaskSpan(t); t.end = r.end; t.duration = r.duration; return; }
    const starts = preds.map(p => constrainedStartFrom(map[p.id], p, t.duration)).filter(Boolean);
    if (!starts.length) { const r = resolveTaskSpan(t); t.end = r.end; t.duration = r.duration; return; }
    const latest = starts.reduce((a,b) => a>b?a:b, starts[0] || t.start);
    t.start = latest;
    const r = resolveTaskSpan(t); t.end = r.end; t.duration = r.duration;
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

export const renumberTasks = (tasks) => {
  const map = {};
  // B568: first-occurrence wins on a duplicate id (see index.html) — original task in visual order
  // keeps the reference, instead of the last occurrence silently capturing it. No-op for clean data.
  tasks.forEach((t, i) => { if (!(t.id in map)) map[t.id] = i + 1; });
  return tasks.map((t, i) => ({
    ...t,
    id: i + 1,
    parentId: t.parentId !== null && t.parentId !== undefined ? (map[t.parentId] ?? null) : null,
    predecessors: normPreds(t.predecessors).map(p => ({...p, id: map[p.id]})).filter(p => p.id),
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
    projects[pid] = {...proj, tasks: renumberTasks(sortByVisualOrder(tasks))};
  });
  const nTid = {...(d.nTid || {})};
  Object.entries(projects).forEach(([pid, proj]) => { nTid[pid] = (proj.tasks?.length || 0) + 1; });
  return {...d, projects, nTid};
};
export const ensureContacts = d => {
  if (!d?.projects) return d;
  const existing = (d.settings?.contacts || []);
  const existingNames = new Set(existing.map(c => String(c?.name || '').toLowerCase()));
  const seen = new Set();
  Object.values(d.projects).forEach(proj => {
    ((proj && Array.isArray(proj.tasks)) ? proj.tasks : []).forEach(t => {
      const rp = String((t && t.responsibleParty) || '').trim();
      if (rp && !existingNames.has(rp.toLowerCase()) && !seen.has(rp.toLowerCase())) {
        existing.push({ id: Date.now() + existing.length + seen.size, name: rp, email: '' });
        existingNames.add(rp.toLowerCase());
        seen.add(rp.toLowerCase());
      }
    });
  });
  return {...d, settings: {...d.settings, contacts: existing}};
};
// The full load pipeline as index.html composes it.
export const loadPipeline = d => ensureContacts(normalizeIds(ensureHolidays(normalizeToV7(normalizeToV6(d)))));

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
