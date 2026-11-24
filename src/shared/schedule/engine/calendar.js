// src/shared/schedule/engine/calendar.js
//
// Dates and the working-day calendar: date strings, holidays, business-day math, the live "today", default settings.
//
// Pure functions only (no React, no DOM). The Schedule page (public/sequence/index.html) gets this code
// through the generated script public/sequence/page.js (npm run build:sequence-page), and the unit
// tests import it directly — ONE copy, no paste-in. Moved here verbatim from the page (audit batch J1);
// behaviour is unchanged.

export const fd = d => d.toISOString().slice(0,10);

// Local calendar date (YYYY-MM-DD). Unlike fd()'s UTC slice, this never rolls a day
// early/late for the user's timezone — used for every "today" comparison (overdue,
// due-soon, the today line).
export const fdLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export const pd = s => new Date(s + "T12:00:00");

export const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return fd(d); };

export const dif  = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);

// Business-day arithmetic (skip Sat/Sun + holidays)
// Module-level holiday set — updated by App when settings change
export let HOLIDAY_SET = new Set();

export const nthWeekday = (y, mo, n, dow) => {
  // n>0: nth occurrence; n<0: last. dow: 0=Sun,1=Mon,...,6=Sat
  if (n > 0) { const d = new Date(y, mo-1, 1); while(d.getDay()!==dow) d.setDate(d.getDate()+1); d.setDate(d.getDate()+(n-1)*7); return d; }
  const d = new Date(y, mo, 0); while(d.getDay()!==dow) d.setDate(d.getDate()-1); return d;
};

export const HOLIDAY_DEFS = [
  {k:"newYearsDay",          label:"New Year's Day",        fn: y => `${y}-01-01`,                                                             rule: null},
  {k:"mlkDay",               label:"MLK Day",               fn: y => fdLocal(nthWeekday(y,1,3,1)),                                                  rule: "3rd Mon"},
  {k:"presidentsDay",        label:"Presidents' Day",       fn: y => fdLocal(nthWeekday(y,2,3,1)),                                                  rule: "3rd Mon"},
  {k:"memorialDay",          label:"Memorial Day",          fn: y => fdLocal(nthWeekday(y,5,-1,1)),                                                 rule: "Last Mon"},
  {k:"juneteenth",           label:"Juneteenth",            fn: y => `${y}-06-19`,                                                             rule: null},
  {k:"independence",         label:"Independence Day",      fn: y => `${y}-07-04`,                                                             rule: null},
  {k:"laborDay",             label:"Labor Day",             fn: y => fdLocal(nthWeekday(y,9,1,1)),                                                  rule: "1st Mon"},
  {k:"columbusDay",          label:"Columbus Day",          fn: y => fdLocal(nthWeekday(y,10,2,1)),                                                 rule: "2nd Mon"},
  {k:"veteransDay",          label:"Veterans Day",          fn: y => `${y}-11-11`,                                                             rule: null},
  {k:"thanksgiving",         label:"Thanksgiving",          fn: y => fdLocal(nthWeekday(y,11,4,4)),                                                 rule: "4th Thu"},
  {k:"dayAfterThanksgiving", label:"Day After Thanksgiving",fn: y => { const d=pd(fdLocal(nthWeekday(y,11,4,4))); d.setDate(d.getDate()+1); return fdLocal(d); }, rule: "Fri after Thu"},
  {k:"christmasEve",         label:"Christmas Eve",         fn: y => `${y}-12-24`,                                                             rule: null},
  {k:"christmas",            label:"Christmas Day",         fn: y => `${y}-12-25`,                                                             rule: null},
  {k:"newYearsEve",          label:"New Year's Eve",        fn: y => `${y}-12-31`,                                                             rule: null},
];

export const DEFAULT_HOLIDAYS = {newYearsDay:true,mlkDay:false,presidentsDay:false,memorialDay:true,juneteenth:false,independence:true,laborDay:true,columbusDay:false,veteransDay:false,thanksgiving:true,dayAfterThanksgiving:false,christmasEve:true,christmas:true,newYearsEve:false};

export const buildHolidaySet = holidays => {
  const s = new Set(); const y0 = new Date().getFullYear();
  for (let y = y0-5; y <= y0+15; y++) HOLIDAY_DEFS.forEach(h => { if(holidays[h.k]) s.add(h.fn(y)); });
  return s;
};

export const DEFAULT_SETTINGS = {defaultSplit:60, snapDefault:true, holidays:{...DEFAULT_HOLIDAYS}, customHealth:[], healthLabelOverrides:{}, barLabels:{left:"start", right:"end", year:true}, rowHeight:24};

// Hard ceiling on business-day iteration. Any real construction/development
// schedule task is far under this (~3,800 working years); the cap exists only so a
// garbage/fat-fingered duration (no upper clamp on the input) can never freeze the
// tab in a per-day loop, and so a far-future bad date can't spin difBD for seconds.
export const MAX_BD_STEPS = 1_000_000;

export const addBD = (s, n) => {
  if (!s) return s;
  n = Math.trunc(Number(n));                 // coerce + drop fractions (2.5d must not advance 3 BDs)
  if (!Number.isFinite(n) || n === 0) return s;  // NaN/±Infinity → no-op (was: Infinity → infinite loop / crash)
  const d = pd(s);
  if (isNaN(d)) return s;                     // invalid date string → no-op (was: fd() threw "Invalid time value")
  let rem = Math.min(Math.abs(n), MAX_BD_STEPS);
  const dir = n > 0 ? 1 : -1;
  while (rem > 0) { d.setDate(d.getDate() + dir); if (d.getDay() !== 0 && d.getDay() !== 6 && !HOLIDAY_SET.has(fd(d))) rem--; }
  return fd(d);
};

export const difBD = (a, b) => {
  const s = pd(a), e = pd(b);
  if (isNaN(s) || isNaN(e)) return 0;         // invalid date string → 0 (was: crash / runaway loop)
  if (+s === +e) return 0;
  const dir = e > s ? 1 : -1;
  let count = 0, steps = MAX_BD_STEPS;
  const cur = new Date(s);
  while ((dir === 1 ? cur < e : cur > e) && steps-- > 0) { cur.setDate(cur.getDate() + dir); if (cur.getDay() !== 0 && cur.getDay() !== 6 && !HOLIDAY_SET.has(fd(cur))) count++; }
  return count * dir;
};

// ── B815 (NEW-1) — Meeting-body cadence engine ────────────────────────────────
// A "meeting body" is an external decision authority (city council, P&Z, commissioners
// court) whose approvals only happen on a fixed cadence. Meetings resolve from recurrence
// rules; the agenda-submittal deadline closes a fixed lead before each meeting on the SAME
// working-day calendar the cascade uses. PURE (no React/DOM) — unit-tested in 
// test/schedulerEngine.test.js (anti-drift guard in test/schedulerEngine.test.js).
// subBD: subtract N business days — the exact inverse of addBD (skips Sat/Sun + HOLIDAY_SET).
export const subBD = (s, n) => addBD(s, -n);

export let NOW = fdLocal(new Date());

// Initialize with defaults
HOLIDAY_SET = buildHolidaySet(DEFAULT_HOLIDAYS);

export const setHolidaySet = s => { HOLIDAY_SET = s; };
export const setNOW = v => { NOW = v; };
