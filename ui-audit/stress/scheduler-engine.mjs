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
  {k:"mlkDay",               fn: y => fd(nthWeekday(y,1,3,1))},
  {k:"presidentsDay",        fn: y => fd(nthWeekday(y,2,3,1))},
  {k:"memorialDay",          fn: y => fd(nthWeekday(y,5,-1,1))},
  {k:"juneteenth",           fn: y => `${y}-06-19`},
  {k:"independence",         fn: y => `${y}-07-04`},
  {k:"laborDay",             fn: y => fd(nthWeekday(y,9,1,1))},
  {k:"columbusDay",          fn: y => fd(nthWeekday(y,10,2,1))},
  {k:"veteransDay",          fn: y => `${y}-11-11`},
  {k:"thanksgiving",         fn: y => fd(nthWeekday(y,11,4,4))},
  {k:"dayAfterThanksgiving", fn: y => { const d=pd(fd(nthWeekday(y,11,4,4))); d.setDate(d.getDate()+1); return fd(d); }},
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
    if (!preds.length || t.pinnedStart) { t.end = calcEnd(t.start, t.duration); return; }
    const starts = preds.map(p => constrainedStartFrom(map[p.id], p, t.duration)).filter(Boolean);
    if (!starts.length) { t.end = calcEnd(t.start, t.duration); return; }
    const latest = starts.reduce((a,b) => a>b?a:b, starts[0] || t.start);
    t.start = latest;
    t.end   = calcEnd(t.start, t.duration);
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

export const parseFlexDate = s => {
  if (!s) return null; s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
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
  tasks.forEach((t, i) => { map[t.id] = i + 1; });
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
    const tasks = (Array.isArray(proj.tasks) ? proj.tasks : []).filter(t => t && typeof t === "object").map(t => (t.duration === "" || t.duration == null) ? {...t, duration: 0} : t);
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
export const loadPipeline = d => ensureContacts(normalizeIds(ensureHolidays(normalizeToV6(d))));

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
