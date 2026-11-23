// src/shared/schedule/engine/predecessors.js
//
// Predecessors and durations: parsing/validating the predecessor text, lag, constrained starts, duration units, task spans.
//
// Pure functions only (no React, no DOM). The Schedule page (public/sequence/index.html) gets this code
// through the generated script public/sequence/engine.js (npm run build:sequence-engine), and the unit
// tests import it directly — ONE copy, no paste-in. Moved here verbatim from the page (audit batch J1);
// behaviour is unchanged.
import { HOLIDAY_SET, addBD, addD, fd, pd } from "./calendar.js";

// ── MS-Project predecessor helpers ────────────────────────
// Normalise: plain int or {id,type,lag} → always {id,type,lag}
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

// Format [{id,type,lag}] → display string
export const fmtPreds = preds => normPreds(preds).map(p => {
  let s = String(p.id);
  if (p.type !== "FS" || p.lag !== 0) {
    s += p.type;
    if (p.lag !== 0) s += (p.lag > 0 ? "+" : "") + p.lag + (p.lagUnit === "calendar" ? "cd" : "d");
  }
  return s;
}).join(", ");

// Validate a proposed predecessor list for task `id` against the project's tasks. Returns
// { preds, selfRemoved, unknownIds, cyclic, ancestor } where `preds` is the accepted subset with
//   • self-references dropped (a task can't depend on itself), and
//   • references to ids that don't exist in this project dropped (they'd render as a live
//     dependency but do nothing — cascadeDates filters them), and
//   • references that would create a circular dependency dropped (A→B→A produces silently
//     arbitrary dates otherwise — cascadeDates doesn't loop, but the result is meaningless), and
//   • references to this task's own ANCESTOR (its parent/grandparent/…) dropped — NEW-1, owner
//     report 2026-09-16: an ancestor's dates are rollup-derived from every descendant (this task
//     included), so this closes a cycle through rollupParentDates that `reachesId` below can never
//     see (rollup is a separate dependency channel from the predecessor graph it walks) — left in,
//     the date ratchets forward without bound on every recompute (cascadeDates drops the same edge
//     defensively for data already carrying it, but the UI must refuse a NEW one at entry too).
// Pure (no React/DOM) so it's unit-testable; the caller surfaces a toast per dropped reason.
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
  // Existing depends-on adjacency (id → [predecessor ids]) from the stored tasks.
  const predMap = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => { predMap[t.id] = normPreds(t.predecessors).map(p => p.id); });
  // NEW-1 (B1696640) — a SUMMARY row's dates roll up from its children (rollupParentDates), so a
  // parent "depends on" every one of its children exactly as if they were its own predecessors — an
  // edge `predMap` never carried, since a parent's `predecessors` field is never read (B443248).
  // Folding children-of-parent into the same adjacency this DFS already walks catches a task naming
  // its own parent/ancestor as a predecessor at ANY depth, and any other rollup-mediated cycle shape,
  // with no separate special case.
  const childrenOf = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => {
    if (!t || t.parentId === null || t.parentId === undefined) return;
    (childrenOf[t.parentId] = childrenOf[t.parentId] || []).push(t.id);
  });
  // A new edge id→p closes a cycle iff p already (transitively) depends on id — through its own
  // predecessors, or (if p is a summary row) through any of its children's dates.
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

// Constrained start of a task given one predecessor dep (MS Project convention)
// End dates are INCLUSIVE (last working day of task), so:
//   FS: successor starts NEXT BD after pred.end  (+lag BDs on top)
//   SS: successor starts same day as pred.start  (+lag)
//   FF: successor ends same day as pred.end (+lag) → derive start
//   SF: successor ends same day as pred.start (+lag) → derive start
export const constrainedStartFrom = (pred, dep, taskDur) => {
  const lag = dep.lag || 0;
  // The LAG counts calendar days (addD) when lagUnit === "calendar", else working days (addBD).
  // The FS "next business day" base step stays business either way (split from the lag).
  const addLag = (base, n) => dep.lagUnit === "calendar" ? addD(base, n) : addBD(base, n);
  switch ((dep.type||"FS").toUpperCase()) {
    case "FS": return addLag(addBD(pred.end, 1), lag);                                   // next BD, then + lag
    case "SS": return addLag(pred.start, lag);                                           // same start + lag
    case "FF": { const cEnd = addLag(pred.end, lag);                                     // end aligns + lag
                 return taskDur <= 1 ? cEnd : addBD(cEnd, 1 - taskDur); }
    case "SF": { const cEnd = addLag(pred.start, lag);                                   // finish at pred.start + lag
                 return taskDur <= 1 ? cEnd : addBD(cEnd, 1 - taskDur); }
    default:   return addLag(addBD(pred.end, 1), lag);
  }
};

// end = last working day (inclusive). duration 0 = milestone (start=end)
export const calcEnd = (start, dur) => !start ? "" : dur === 0 ? start : addBD(start, Math.max(0, dur - 1));

// ── Duration model (B615): days/weeks = WORKING days · months/years = CALENDAR-real ──────
// Two measuring sticks keyed to the typed unit. `duration` stays the canonical WORKING-DAY
// inclusive count every consumer already reads; durValue+durUnit carry the typed intent.
// All pure + dependency-free + unit-tested (test/schedulerEngine.test.js via the .mjs mirror).
//
// Parse a typed duration → {value, unit} | {error}. Accepts 3w/3 weeks, 15d/15 days, 2mo/
// 2 months, 1y/1 year, and a bare number → days. Empty = a cleared field → 0 days (milestone).
// Anything else → {error} so the field shows a VISIBLE inline error — never a silent 0 (B615).
export const DUR_UNIT_ALIASES = [
  { re: /^(mo|mos|month|months)$/,               unit: "mo" },
  { re: /^(y|yr|yrs|year|years)$/,               unit: "y"  },
  { re: /^(w|wk|wks|week|weeks)$/,               unit: "w"  },
  { re: /^(cd|cds|calday|caldays|caldy)$/,       unit: "cd" },   // calendar days (weekends counted)
  { re: /^(d|day|days|wd|workday|workdays)$/,    unit: "d"  },
];

export const parseDurationInput = raw => {
  const str = String(raw == null ? "" : raw).trim().toLowerCase();
  if (str === "") return { value: 0, unit: "d" };                       // cleared → milestone, not an error
  const m = str.match(/^(-?\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!m) return { error: `Couldn't read "${String(raw).trim()}" — try 10d, 3w, 30cd, 2mo, or 1y` };
  let value = Math.trunc(Number(m[1]));
  if (!Number.isFinite(value) || value < 0) return { error: `Duration can't be negative — try 10d, 3w, 30cd, 2mo, or 1y` };
  value = Math.min(value, 100000);                                      // upper clamp (fat-finger freeze guard)
  const suffix = m[2];
  if (suffix === "") return { value, unit: "d" };                       // bare number → days
  const hit = DUR_UNIT_ALIASES.find(u => u.re.test(suffix));
  if (!hit) return { error: `Unknown unit "${suffix}" — try d (days), w (weeks), cd (calendar days), mo (months), y (years)` };
  return { value, unit: hit.unit };
};

// Add n calendar months to an ISO date, clamping to the target month's last day
// (Jan 31 + 1mo → Feb 28/29). n may be negative. Pure — no HOLIDAY_SET, no weekends.
export const addCalendarMonths = (iso, n) => {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!mt) return iso;
  const y = +mt[1], mo0 = +mt[2] - 1, d = +mt[3];
  const total = mo0 + Math.trunc(n);
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(ty, tm + 1, 0).getDate();                    // day 0 of next month = last day of this
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
};

// Roll an ISO date FORWARD to the next working day if it lands on a weekend or a HOLIDAY_SET
// date. Plain forward — NO month-crossing guard (owner decision, B615). A working day is unchanged.
export const rollForwardToWorkday = iso => {
  const d = pd(iso);
  if (isNaN(d)) return iso;
  let steps = 0;
  while ((d.getDay() === 0 || d.getDay() === 6 || HOLIDAY_SET.has(fd(d))) && steps++ < 4000) d.setDate(d.getDate() + 1);
  return fd(d);
};

// Inclusive WORKING-day count between two ISO dates — CLOSED FORM (full-weeks×5 + partial-week
// remainder, then subtract HOLIDAY_SET weekday hits); NO day-by-day loop (B615). Order-independent.
// This is the DERIVED display count for a calendar (month/year) span — read off the resolved dates.
export const workdaysBetween = (aIso, bIso) => {
  let a = pd(aIso), b = pd(bIso);
  if (isNaN(a) || isNaN(b)) return 0;
  if (a > b) { const t = a; a = b; b = t; }
  const MS = 86400000;
  const totalDays = Math.round((b - a) / MS) + 1;                       // inclusive span length in calendar days
  const full = Math.floor(totalDays / 7);
  let count = full * 5;
  const rem = totalDays - full * 7;                                     // 0..6 leftover days, starting on a's weekday
  const startDow = a.getDay();
  for (let i = 0; i < rem; i++) { const dow = (startDow + i) % 7; if (dow !== 0 && dow !== 6) count++; }
  for (const h of HOLIDAY_SET) {                                        // subtract holidays landing on a weekday in [a,b]
    const hd = pd(h);
    if (!isNaN(hd) && hd >= a && hd <= b) { const dow = hd.getDay(); if (dow !== 0 && dow !== 6) count--; }
  }
  return Math.max(0, count);
};

// Resolve a typed (value, unit) duration against a real start → {end, duration}. `duration` is
// always the working-day inclusive count (the canonical field). d/w = working days; mo/y = calendar
// add + roll-forward, with the working-day count DERIVED off the resolved span. No months→days factor.
export const DUR_WD_FACTOR = { d: 1, w: 5 };

export const resolveDuration = (start, value, unit) => {
  const u = unit || "d";
  const v = Math.max(0, Math.trunc(Number(value) || 0));
  if (u === "d" || u === "w") {
    const count = v * DUR_WD_FACTOR[u];
    return { end: start ? calcEnd(start, count) : "", duration: count };
  }
  if (!start || v === 0) return { end: start && v === 0 ? start : "", duration: 0 };  // 0 = milestone / no anchor yet
  if (u === "cd") { const end = addD(start, v - 1); return { end, duration: workdaysBetween(start, end) }; }  // exact calendar window (weekends counted, no roll); working-day count derived
  const months = u === "y" ? v * 12 : v;
  const end = rollForwardToWorkday(addCalendarMonths(start, months));
  return { end, duration: workdaysBetween(start, end) };
};

// Read a task's typed duration into (value, unit) — defaulting legacy/parent tasks to days.
export const taskDurValue = t => (t.durValue != null ? t.durValue : (typeof t.duration === "number" ? t.duration : 0));

export const taskDurUnit  = t => t.durUnit || "d";

export const resolveTaskSpan = t => resolveDuration(t.start, taskDurValue(t), taskDurUnit(t));

// Back-calculate the start that makes a `duration`-working-day bar finish ON `end` (working-day
// inverse of calcEnd). Used for a locked finish (pinnedEnd, B616).
export const startForEnd = (end, duration) => !end ? "" : (duration <= 1 ? end : addBD(end, -(Math.max(1, duration) - 1)));

// Display: a task's duration with its typed unit. Month/year bars also expose the derived
// working-day count via the cell tooltip (nothing hidden — B615).
// B463072 — `isSummary` is NOT optional decoration. A parent row carries TWO durations: the span
// rollupParentDates derives from its children (`duration`, always working days) and the leftover typed
// value a parent never legitimately owns (`durValue`/`durUnit`, which the rollup does not rewrite, so it
// keeps whatever it happened to hold). Reading the leftover printed **"0d" on a 40-working-day summary**
// — measured on the owner's Grand Port row "CCID3: Lift Station & Force Main Approval", which rendered
// 08/07/26 · 10/02/26 · 0d. Same family as B443248: that one let a stale leftover drive a SUCCESSOR'S
// DATE, this one let it drive the NUMBER ON SCREEN. For a summary the rolled span is the only truth.
export const fmtTaskDuration = (t, isSummary = false) => {
  if (t.duration === "" || t.duration == null) return "";
  if (isSummary) return `${t.duration}d`;
  const u = taskDurUnit(t);
  return `${taskDurValue(t)}${u}`;
};

export const durTooltip = t => {
  const u = taskDurUnit(t);
  if (u === "cd") {
    const n = taskDurValue(t);
    return `${n} calendar day${n === 1 ? "" : "s"} (weekends counted) ≈ ${t.duration} working day${t.duration === 1 ? "" : "s"}`;
  }
  if (u !== "mo" && u !== "y") return null;
  const n = taskDurValue(t);
  return `${n} ${u === "y" ? "year" : "month"}${n === 1 ? "" : "s"} ≈ ${t.duration} working day${t.duration === 1 ? "" : "s"} (calendar-based)`;
};
