import "../../../shared/schedule/engine/pageEntry.js";
import { OWNER_KIND_ORG, OWNER_KIND_SITE, crossScheduleLabel, ownerOf, pruneScheduleRefs, scheduleLabelParts, setSiteNameResolver } from "../../../shared/schedule/scheduleOwnership.js";
import { OWNER_CAP, ownerDisplayParts, ownerHas, ownerJoin, ownerKey, ownerListOf, removeOwnerFrom, renameOwnerIn } from "../../../shared/schedule/engine/owners.js";
import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, HOLIDAY_DEFS, HOLIDAY_SET, NOW, addD, buildHolidaySet, dif, difBD, fd, fdLocal, pd, setHolidaySet, setNOW } from "../../../shared/schedule/engine/calendar.js";
import { _mintTaskSid, fmtD, groupRowsByProject, idPressMovesRows, indentSelection, insertRowAbove, moveSelectionToDestination, outdentSelection, parseFlexDate, promoteChildrenAndDelete, renumberTasks, rowDragArmed, rowDropIntent, rowFloatAtPointer, scheduleExportName, scheduleRowPrefix, sortByVisualOrder, toShortDate } from "../../../shared/schedule/engine/tasks.js";
import { calcEnd, durTooltip, fmtPreds, fmtTaskDuration, normPreds, parseDurationInput, parsePreds, resolveDuration, resolveTaskSpan, rollForwardToWorkday, taskDurUnit, taskDurValue, validatePredEdit } from "../../../shared/schedule/engine/predecessors.js";
import { MEETING_BODY_INDEX, adjacentMeetingDate, agendaDeadline, agendaLeadSummary, boundEditNotice, cadenceSummary, copyMeetingBodyWithNewId, dropDuplicateLagPatch, findMeetingBodyElsewhere, importMeetingBodies, importMeetingBody, joinWithAnd, mbBodiesSameCadence, mbRuleSummary, meetingBindingTrace, meetingBoundInfo, meetingCostDays, meetingDatesInRange, meetingDoubleLagFlag, meetingFloatBD, newPinConflicts, otherScheduleMeetingBodies, pinConflictNotice, positionMissingReport, rebuildMeetingBodyIndex, resolveBoundEdit, settleBoundNotice, startIsPinned, unpinStartPatch } from "../../../shared/schedule/engine/meetings.js";
import { DEFAULT_HEALTH_RULES, RULE_FIELDS, RULE_FIELD_BY_K, cascadeDelta, completionDelta, effectivePercentComplete, getHealthRules, isCompleteTask, leafPercent, opsForField } from "../../../shared/schedule/healthEngine.js";
import { recascadeWithDrift, recomputeAfterStructureChange, recomputeSchedule, touchesSchedule } from "../../../shared/schedule/engine/cascade.js";
import { computeDisplayHealth, computeRolledHealth, reconcileNeedsAttention } from "../../../shared/schedule/engine/health.js";
import { loadDocument } from "../../../shared/schedule/engine/normalize.js";
import { _deepClone, _mEq, _mIsObj, _mStripRev, changedProjectIds, countChangedTaskRows, decomposeForDualWrite, mergeCloudDoc, mergeLocationPhrase, recomposeFromRows } from "../../../shared/schedule/engine/merge.js";
import { MULTI_SELECTION_MESSAGE, addRange, cellsOf, isMulti, makeSelection, rangesOf, selContains, selEdgesAt, selIsRange, selRowsOf, selTouchesCol, selTouchesRow, toggleCellOut, withActive } from "../../../shared/selection/rangeSelection.js";
import { axisVelocity } from "../../../shared/selection/edgeScroll.js";
import { BASE_HK, ContactPicker, DepCell, HDARK, HEALTH, HK, MENU_STOPS_GRID, NO_AUTOFILL, anchorHidden, anchorSurroundings, avatarColor, contactField, getInitials, measuredColWidth, rebuildHEALTH, showToast, useAnchoredPopover } from "./common.jsx";
import { MasterView, installProjectOrderListener } from "./taskReport/TaskReport.jsx";
import { exposeToHarness } from "./harnessGlobals.js";

const { useState, useEffect, useRef, useMemo, useCallback } = React;





// NEW-1 (B2429233) — THE ONE removal of a schedule from the document. It used to refuse the LAST
// schedule (`projects.length <= 1`) from inside deleteProject, so the shell's confirm closed and
// nothing happened, with no message. There is no real reason to refuse: since B2285440 a document
// with no schedule renders the "No schedules yet" empty state, and the cloud write soft-deletes any
// row missing from the document. So the last schedule deletes like any other and `aPid` becomes
// null (never a dangling id). Returns `d` itself, unchanged, only when `id` names no schedule.
function removeScheduleFromDoc(d, id) {
  if (!d || !d.projects || !d.projects[id]) return d;
  const newProjects = { ...d.projects };
  delete newProjects[id];
  const remaining = Object.keys(newProjects).map(Number);
  const newAPid = d.aPid === id ? (remaining.length ? remaining[0] : null) : d.aPid;
  return pruneScheduleRefs({...d, aPid: newAPid, projects: newProjects});
}
// (end removeScheduleFromDoc)

// NEW-1 (owner dispatch 2026-09-17) — the merge toast itself was never instrumented, so an owner
// report of an inflated count ("687 tasks... +7 more") had no record to check it against; a live
// two-tab sitting was the only way to see one fire. This records every firing — the real schedule
// list and count the toast just showed — as a client_errors event, so the next occurrence on his
// account is a query, not a repro session. Fire-and-forget and best-effort: a lost diagnostic row
// here is not a LOUD-FAILURE case (nothing user-facing depends on it reaching the table), so it
// never throws into the app and never retries. Uses window.__sb (the already-exposed client)
// rather than the module-scoped `sb` so this can sit at module scope, above where `sb` is
// declared, without an ordering dependency — by the time a merge can fire, boot has long finished.
function logMergeToastEvent(changedRows, changedPids, projects) {
  try {
    if (!window.__sb) return;
    const names = (changedPids || []).map(pid => crossScheduleLabel((projects && projects[pid]) || {}));
    const msg = `merge toast fired — ${changedRows} task${changedRows===1?"":"s"} updated across ${names.length} schedule${names.length===1?"":"s"}` +
      (names.length ? `: ${names.join(", ")}` : "");
    window.__sb.from("client_errors").insert({ module: "scheduler", source: "event:merge-toast", message: msg.slice(0, 2000) }).then(() => {}, () => {});
  } catch (e) { /* telemetry must never throw into the app */ }
}



// ── Constants ─────────────────────────────────────────────
let ROW_H = 24;
// NEW-1 (Schedule grid, one light full grid) — THE one cell-line rule for every grid cell, ID and TASK
// included: a faint solid line on the right (column divider) and bottom (row line), same token everywhere.
// Each cell draws its OWN bottom line because the pinned ID/TASK cells paint an opaque background that
// covers the row's border-bottom (the row is ROW_H tall, border-box, and its cells are ROW_H too).
const GRID_LINE = "1px solid var(--bd)";
const GRID_LINE_RANGE = "1px solid #93c5fd";
const PPD = 22, TL_H = 30, BUF = 6;
// NEW-1 (2026-11-03) — "scrolling on the schedule module is kinda shakey vertically". The row window (which rows are
// mounted) used to be re-derived from the RAW scrollTop on every scroll event: one React commit per 24px of travel, with
// only ~100px of spare rows below the fold, so a wheel notch routinely out-ran the commit and the bottom row of each pane
// was blank for a frame (measured: ~40% of frames during a notch scroll, ui-audit/verify-schedule-scroll-smooth.mjs).
// Now the window moves in CHUNKS of whole rows and carries a generous overscan on both sides: the state only changes when
// the scroll crosses a chunk boundary (so most scroll events re-render nothing), and the rows that will be needed next
// are already mounted when it does.
const WIN_CHUNK = 8, WIN_OVER = 12;
const rowWindowTop = st => Math.floor(Math.max(0, st) / ROW_H / WIN_CHUNK) * WIN_CHUNK;
const rowWindow = (winTop, viewH, total) => ({
  startIdx: Math.max(0, winTop - WIN_OVER),
  endIdx:   Math.min(total, winTop + WIN_CHUNK + Math.ceil(viewH / ROW_H) + 1 + WIN_OVER),
});
// NEW-1 (recurrence of B463922, ×3) — `<ErrorBoundary key={data.view}>` (App's render, well above
// GridView/GanttView) remounts the whole Grid/Split/Gantt subtree fresh on every view switch, so
// neither pane's own scroll position survives one. Two small per-project memories, restored on
// mount (skipped while a goToFocus jump is pending — that jump wins) and updated on every scroll,
// so switching Grid → Gantt → Grid (or Split → Grid → Split) comes back where he left it instead
// of resetting to the top. Module-scope, not component state, precisely because it must outlive
// the remount it's compensating for.
const GRID_SCROLL_MEMO = new Map();
const GANTT_SCROLL_MEMO = new Map();
// Excel-style fill palette: 5 columns x 4 rows = 20 swatches. Top rows = pastel tints
// (read well on light grid rows + leave room for text); bottom rows = stronger fills
// (work well as Gantt-bar accents). Used by the right-click Format toolbar.
const ROW_COLORS = [
  { color: '#fef3c7', label: 'Yellow tint'  },
  { color: '#ffedd5', label: 'Orange tint'  },
  { color: '#fee2e2', label: 'Red tint'     },
  { color: '#fce7f3', label: 'Pink tint'    },
  { color: '#f3e8ff', label: 'Purple tint'  },
  { color: '#fde68a', label: 'Yellow'       },
  { color: '#fed7aa', label: 'Orange'       },
  { color: '#fecaca', label: 'Red'          },
  { color: '#fbcfe8', label: 'Pink'         },
  { color: '#e9d5ff', label: 'Purple'       },
  { color: '#d9f99d', label: 'Lime'         },
  { color: '#bbf7d0', label: 'Green'        },
  { color: '#a5f3fc', label: 'Cyan'         },
  { color: '#bfdbfe', label: 'Blue'         },
  { color: '#c7d2fe', label: 'Indigo'       },
  { color: '#ecfccb', label: 'Lime tint'    },
  { color: '#d1fae5', label: 'Green tint'   },
  { color: '#cffafe', label: 'Cyan tint'    },
  { color: '#dbeafe', label: 'Blue tint'    },
  { color: '#e0e7ff', label: 'Indigo tint'  },
];

// ── XSS sanitization ─────────────────────────────────────
// escapeHtml: use whenever user data is interpolated into HTML/SVG string templates.
// React JSX auto-escapes rendered content, but buildPDFHtml/buildGanttSVG build
// raw HTML strings via template literals that go into document.write — must escape manually.
const escapeHtml = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

// NEW-1 — the ONE rule for how a frozen (pinned) grid cell stacks its fills. `fills` is bottom → top (the
// row's colour, then the cell's own range tint / per-cell fill); CSS lists the TOP layer first, so reverse.
// A solid fill each (no opacity), laid over --bg by the caller, so scrolled content never shows through.
const pinnedFillLayers = (fills) => [...fills.filter(Boolean)].reverse().map(f => `linear-gradient(${f},${f})`).join(",");
// isValidColor: rowColor is placed into CSS background via inline styles.
// Restrict to hex colors from the ROW_COLORS palette or null to prevent CSS injection.
const SAFE_COLOR_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
const isValidColor = v => v == null || SAFE_COLOR_RE.test(v);
// B<PENDING> (NEW-2) — cell/row text-size steps for the format mini-toolbar's grow/shrink
// buttons and its type-in size box. Bounded so a runaway size can't blow out a fixed-height
// grid row (ROW_H floors at 20px, ceilings at 34px — see settings.rowHeight) or the Gantt bar
// labels; the cell itself clips with overflow:hidden regardless, this just keeps the picked
// values sane. Values chosen to bracket the grid's own default per-level sizes (11–13px).
const FONT_SIZE_STEPS = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24];
const FONT_SIZE_MIN = FONT_SIZE_STEPS[0], FONT_SIZE_MAX = FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1];
const isValidFontSize = n => typeof n === "number" && Number.isFinite(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX;
const stepFontSize = (cur, dir) => {
  const base = typeof cur === "number" ? cur : 12;
  if (dir > 0) { const next = FONT_SIZE_STEPS.find(v => v > base); return next != null ? next : FONT_SIZE_MAX; }
  const prev = FONT_SIZE_STEPS.filter(v => v < base);
  return prev.length ? prev[prev.length - 1] : FONT_SIZE_MIN;
};   // task-name alignment is per-project (proj.labelAlign), not here (B393)
// Gantt bar-label helpers — one source of truth for the on-screen chart and the PDF exhibit
const fmtBarDate = (s, withYear) => { if(!s) return ""; const d = new Date(s+"T12:00:00"); return isNaN(d) ? "" : `${d.getMonth()+1}/${d.getDate()}` + (withYear===false ? "" : `/${String(d.getFullYear()).slice(2)}`); };
const barLabelText = (t, field, withYear) => {
  if(!field || field==="none") return "";
  if(field==="start") return fmtBarDate(t.start, withYear);
  if(field==="end")   return fmtBarDate(t.end, withYear);
  if(field==="owner") return ownerDisplayParts(ownerListOf(t)).label;
  if(field==="pct")   return `${t.percentComplete||0}%`;
  return "";
};
// Initialize with defaults
setHolidaySet(buildHolidaySet(DEFAULT_HOLIDAYS)); // local "today"; refreshed live by App (focus / midnight rollover)

// ── In-app confirm (audit batch J3) ───────────────────────
// Replaces window.confirm: a themed dialog that matches the page (light + dark through the --bg/--txt tokens), answers with a
// Promise<boolean>. Enter = confirm, Escape / backdrop / Cancel = no. One at a time; a second call cancels the first.
const askConfirm = (() => {
  let _open = null;
  return ({ title, body = "", confirmLabel = "Continue", danger = false } = {}) => new Promise((resolve) => {
    if (_open) _open(false);
    const prevFocus = document.activeElement;
    const back = document.createElement("div");
    back.setAttribute("data-testid", "schedule-confirm");
    Object.assign(back.style, { position: "fixed", inset: "0", background: "rgba(0,0,0,.45)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    const card = document.createElement("div");
    card.setAttribute("role", "alertdialog"); card.setAttribute("aria-modal", "true");
    Object.assign(card.style, { background: "var(--bg)", color: "var(--txt)", border: "1px solid var(--bd2)", borderRadius: "10px", boxShadow: "0 12px 40px rgba(0,0,0,.35)", width: "min(440px, 100%)", padding: "18px 20px 14px", fontFamily: "'Inter', system-ui, sans-serif" });
    const h = document.createElement("div");
    h.textContent = title || "Are you sure?";
    Object.assign(h.style, { fontSize: "14px", fontWeight: "600", marginBottom: body ? "8px" : "14px", lineHeight: "1.4" });
    card.appendChild(h);
    if (body) {
      const b = document.createElement("div");
      b.textContent = body;
      Object.assign(b.style, { fontSize: "12.5px", color: "var(--mut)", lineHeight: "1.55", whiteSpace: "pre-wrap", marginBottom: "16px" });
      card.appendChild(b);
    }
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", justifyContent: "flex-end", gap: "8px" });
    const mk = (label, primary) => {
      const x = document.createElement("button");
      x.type = "button"; x.textContent = label;
      Object.assign(x.style, { font: "inherit", fontSize: "12.5px", fontWeight: "600", padding: "7px 14px", borderRadius: "7px", cursor: "pointer",
        border: primary ? "1px solid transparent" : "1px solid var(--bd2)",
        background: primary ? (danger ? "#b42318" : "var(--amber)") : "var(--surf)",
        color: primary ? (danger || document.documentElement.dataset.theme !== "dark" ? "#fff" : "#14171C") : "var(--txt)" });
      return x;
    };
    const no = mk("Cancel", false), yes = mk(confirmLabel, true);
    row.appendChild(no); row.appendChild(yes); card.appendChild(row); back.appendChild(card);
    let done = false;
    const finish = (v) => {
      if (done) return; done = true; _open = null;
      document.removeEventListener("keydown", onKey, true); back.remove();
      try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch {}
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(document.activeElement === no ? false : true); }
      else if (e.key === "Tab") { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
    };
    _open = finish;
    no.onclick = () => finish(false); yes.onclick = () => finish(true);
    back.addEventListener("mousedown", (e) => { if (e.target === back) finish(false); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    (danger ? no : yes).focus();
  });
})();

// ── Configurable health automation, v2 (B785744 — replaces the fixed 7-condition rule list from
// #1073, which the owner rejected twice: "you've got like two variables here"). The real ask,
// verbatim: "IF 'finish' is in the past, THEN status = Needs Attn, UNLESS status is marked
// COMPLETE" — a Smartsheet/MS-Project-style IF/THEN/UNLESS builder, not a picklist of canned
// sentences. RULE_FIELDS × RULE_OPS is the actual language: pick a FIELD (Finish, Start, Status,
// Owner, %Complete, Cost, Budget, Actual Cost, Predecessor), pick a COMPARISON valid for that
// field's type, give a VALUE. Multiple conditions in a `when`/`unless` group combine with AND/OR.
// A rule is `{id, when:[cond,...], whenCombinator, color, unless:[cond,...], unlessCombinator}` —
// it fires (sets `color`) when its `when` group matches AND its `unless` group does NOT. Rules stay
// an ORDERED list, first FIRING rule wins (owner's explicit choice over "worst color always wins" —
// he already knows and likes the ordered mental model).
//
// Absence-safety, preserved from v1: a MISSING date/text field always fails its condition (except
// the explicit isBlank/isNotBlank tests, whose whole job IS to test absence) — never a silent pass.
// A missing NUMBER field reads as 0 (matches how percentComplete has always been treated: `pct =
// task.percentComplete || 0`), so "% Complete is at least 100" behaves identically whether the field
// is absent or explicitly 0.


// Fix #1e: guard mkt so a bad caller can never crash the app with an invalid date.
// Also supports "blank" tasks: pass start="" AND dur="" (or null) → task is created with
// no start, no end, no duration. Callers that want a real date keep passing valid args.
const mkt = (id, name, start, dur, parentId=null, health="gray", predecessors=[]) => {
  const isBlank = !start && (dur === "" || dur === null || dur === undefined);
  const safeStart = isBlank ? "" : ((start && !isNaN(new Date(start).getTime())) ? start : NOW);
  // Blank tasks are born at 0d (renders "0d", never a bare "d"); dates stay
  // empty until the user types one — calcEnd("", 0) is "" by design.
  const safeDur   = isBlank ? 0 : dur;
  return {
    id, _sid: _mintTaskSid(), name, start: safeStart, end: calcEnd(safeStart, safeDur), duration: safeDur, durUnit: "d", durValue: safeDur, predecessors, health,
    percentComplete: health==="green" ? 100 : health==="yellow" ? 40 : 0,
    parentId, responsibleParty: [], cost: "", notes: [], isExpanded: true,
    meetingBound: false,   // B816 — new tasks are unbound by default; a task binds to a body via its Meeting cell
  };
};

// NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD, 2026-10-06) — tell the shell where this page's schedule-list load stands, so
// the Schedule tab can say "still loading" / "couldn't reach" instead of mistaking an UNLOADED list for an
// EMPTY one (which offered Create on a project that already had three schedules). State is "loading" or
// "failed"; a successful load is announced by the ordinary planar:nav-state, never by this.
window.__planarLoadStatus = "loading";
function postLoadState(state) {
  try {
    if (window.self !== window.top) {
      window.parent.postMessage({ source: "planar-seq", type: "planar:load-state", state }, window.location.origin);
    }
  } catch (_) {}
}
const LOAD_ATTEMPT_TIMEOUT_MS = 20000;   // one read attempt; a hung request is abandoned and retried
const LOAD_RETRY_BASE_MS = 2000, LOAD_RETRY_MAX_MS = 30000;

const SEED = {
  nPid: 4, nTid: {1:12, 2:5, 3:10}, aPid: 3, view: "split", section: "projects", editProjId: null, healthColStyle: "stoplight",
  settings: {...DEFAULT_SETTINGS, holidays:{...DEFAULT_HOLIDAYS}},
  projects: {
    1: { id:1, name:"Hillwood I-10 Logistics", tasks: [
      mkt(1,  "Site Acquisition",       "2025-01-06", 30,  null, "green",  []),
      mkt(2,  "Title Search",            "2025-01-06", 14,  1,    "green",  []),
      mkt(3,  "Environmental Phase I",   "2025-01-13", 21,  1,    "green",  [1]),
      mkt(4,  "Design & Engineering",    "2025-02-03", 60,  null, "yellow", []),
      mkt(5,  "Schematic Design",        "2025-02-03", 21,  4,    "green",  [1]),
      mkt(6,  "Construction Documents",  "2025-02-24", 35,  4,    "yellow", [5]),
      mkt(7,  "Permitting",              "2025-04-01", 45,  null, "yellow", [4]),
      mkt(8,  "Submit Plans",            "2025-04-01", 5,   7,    "green",  [6]),
      mkt(9,  "City Review",             "2025-04-07", 30,  7,    "yellow", [8]),
      mkt(10, "Permit Issued",           "2025-05-07", 0,   7,    "red",    [9]),
      mkt(11, "Construction",            "2025-05-08", 180, null, "gray",   [7]),
    ]},
    2: { id:2, name:"Grand Pkwy Distribution", tasks: [
      mkt(1, "Site Control",  "2025-03-01", 21,  null, "green",  []),
      mkt(2, "Due Diligence", "2025-03-22", 30,  null, "yellow", [1]),
      mkt(3, "Design",        "2025-04-22", 60,  null, "gray",   [2]),
      mkt(4, "Construction",  "2025-06-22", 150, null, "gray",   [3]),
    ]},
    3: { id:3, name:"Sample Project", tasks: [
      mkt(1,  "Project Kick Off",     "2025-06-02", 0,   null, "gray",   []),
      mkt(2,  "Due Diligence",        "2025-06-02", 30,  null, "green",  [1]),
      mkt(3,  "Order Reports",        "2025-06-02", 5,   2,    "green",  []),
      mkt(4,  "Review Reports",       "2025-06-09", 15,  2,    "yellow", [3]),
      mkt(5,  "Entitlements",         "2025-07-14", 60,  null, "gray",   [2]),
      mkt(6,  "Submit Application",   "2025-07-14", 5,   5,    "gray",   []),
      mkt(7,  "Agency Review",        "2025-07-21", 40,  5,    "gray",   [6]),
      mkt(8,  "Approval",             "2025-09-15", 0,   5,    "gray",   [7]),
      mkt(9,  "Construction",         "2025-09-16", 120, null, "gray",   [5]),
    ]},
  },
};
// Which kind of pointer made the press that is being handled: React's onMouseDown cannot say (a MouseEvent has
// no pointerType), but the pointerdown that precedes every mousedown — a tap's compatibility mouse events
// included — can.
let lastRowPointerType = "mouse";
window.addEventListener("pointerdown", ev => { lastRowPointerType = ev.pointerType || "mouse"; }, true);

const COLS = [
  {k:"id",              l:"ID",      w:30,  e:false           },
  {k:"name",            l:"Task",    w:220, e:true            },
  {k:"start",           l:"Start",   w:62,  e:true, t:"date"  },
  {k:"end",             l:"Finish",  w:62,  e:true, t:"date"  },
  {k:"duration",        l:"Dur",     w:42,  e:true, t:"num"   },
  {k:"predecessors",    l:"Predecessor",    w:148, e:true, t:"pred"  },
  {k:"successors",      l:"Successor",      w:148, e:false,t:"succ"  },
  {k:"health",          l:"●",       w:36,  e:true, t:"health"},
  {k:"status",          l:"Status",  w:84,  e:false           },
  {k:"responsibleParty",l:"Owner",   w:132, e:true            },
  {k:"cost",            l:"Cost",    w:88,  e:true, t:"cost"  },
  {k:"notes",           l:"Notes",   w:192, e:true, t:"notes" },
  // B212 — additional available fields. Hidden by default; user shows them per-project
  // via the Columns chooser. Cost/budget fields render blank when a task has no value.
  {k:"percentComplete", l:"% Comp",  w:78,  e:true, t:"num"   },
  {k:"budget",          l:"Budget",  w:92,  e:true, t:"cost"  },
  {k:"actualCost",      l:"Actual",  w:92,  e:true, t:"cost"  },
  {k:"meetingBody",     l:"Meeting", w:130, e:false,t:"meeting"},   // B816 — bind a task to a meeting body (hidden by default)
  {k:"floatToDeadline", l:"Float",   w:64,  e:false,t:"meeting"},   // B817 — working days to the agenda deadline
  {k:"costIfMissed",    l:"Cost/miss",w:74, e:false,t:"meeting"},   // B817 — calendar days the hearing slips if missed
];
const TOTAL_W = COLS.reduce((s,c) => s+c.w, 0);
// B212 — column-config plumbing. COLS is the master AVAILABLE-field registry; the left
// table shows a per-project subset/order. DEFAULT_GRID_COLS is what a project starts from
// (the original twelve; the new fields above ship hidden). Config persists per project at
// projects[pid].colConfig and rides the existing cloud-save path (setData → autosave).
const COL_BY_K = Object.fromEntries(COLS.map(c => [c.k, c]));
const DEFAULT_GRID_COLS = ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes"];
// B583 — a project's user-defined Formula columns (proj.formulaCols) are valid grid
// columns alongside the built-in COLS. Their keys (f_…) must survive the visible-list
// filter and get a default width, or a saved formula column would silently vanish on load.
const formulaColsOf = proj => (Array.isArray(proj && proj.formulaCols) ? proj.formulaCols : []);
const readGridCfg = (proj, data) => {
  const fcs = formulaColsOf(proj);
  const fKeys = new Set(fcs.map(fc => fc.k));
  const isValidKey = k => !!COL_BY_K[k] || fKeys.has(k);
  const cfg = proj && proj.colConfig;
  let visible;
  if (cfg && Array.isArray(cfg.visible) && cfg.visible.length) visible = cfg.visible.filter(isValidKey);
  else if (data && Array.isArray(data.gridColOrder) && data.gridColOrder.length) visible = data.gridColOrder.filter(k => COL_BY_K[k] && DEFAULT_GRID_COLS.includes(k)); // migrate legacy global order
  else visible = [...DEFAULT_GRID_COLS];
  if (!visible.includes("name")) visible = ["name", ...visible];   // the Task name column can't be hidden
  // B817/B844 — meeting columns default ON (unless the user set an explicit column config). The Meeting
  // column appears once the project DEFINES ≥1 meeting body (so right-click binding is discoverable via the
  // column too — B844); Float / Cost appear once any task is actually BOUND. All render blank on unbound rows.
  // NEW-1 (B<PENDING>, 2026-09-23) — a schedule with ZERO meeting bodies of its own can still have tasks
  // bound to a body imported/borrowed from ANOTHER schedule (B816's ids are globally unique). The old
  // "the project DEFINES ≥1 body" gate missed exactly that case — a schedule like this stayed on the
  // OLD default column set forever, so the Meeting column (now correctly naming the foreign body/its
  // schedule, see Cell()'s "meetingBody" case) never appeared for anyone to see it. Same OR as the
  // Float/Cost line below: a body defined here, OR a task actually bound (however the body got there).
  const anyBound = Array.isArray(proj?.tasks) && proj.tasks.some(t => t.meetingBound);
  if (!(cfg && Array.isArray(cfg.visible) && cfg.visible.length)) {
    if ((Array.isArray(proj?.meetingBodies) && proj.meetingBodies.length || anyBound) && !visible.includes("meetingBody")) visible.push("meetingBody");
    if (anyBound) {
      ["floatToDeadline","costIfMissed"].forEach(k => { if (!visible.includes(k)) visible.push(k); });
    }
  }
  const saved = (cfg && cfg.widths) || (data && data.gridColWidths) || {};
  const widths = {};
  COLS.forEach(c => { widths[c.k] = saved[c.k] ?? c.w; });
  fcs.forEach(fc => { widths[fc.k] = saved[fc.k] ?? fc.w ?? 130; });
  return { visible, widths };
};
const writeGridCfg = (setData, pid, next) => setData(d =>
  (d.projects && d.projects[pid]) ? {...d, projects: {...d.projects, [pid]: {...d.projects[pid], colConfig: next}}} : d);
// Friendly names for the chooser / context menu (some header labels are symbols, e.g. ● for health).
const COL_LABELS = {id:"ID", name:"Task name", start:"Start", end:"Finish", duration:"Duration",
  predecessors:"Predecessors", successors:"Successors", health:"Health", status:"Status",
  responsibleParty:"Owner", cost:"Cost", notes:"Notes", percentComplete:"% Complete",
  budget:"Budget", actualCost:"Actual / Spend", meetingBody:"Meeting body",
  floatToDeadline:"Float to deadline", costIfMissed:"Cost if missed"};
const colLabel = c => COL_LABELS[c.k] || c.l || c.k;

// ── B583 — Formula columns: effective per-project column registry ─────────────
// A project's user-defined Formula columns (proj.formulaCols: [{k,l,formula,w}])
// join the built-in COLS to form the project's effective column list. A column is
// targeted by INDEX (selectedColIdx, copy/format/nav), so the same list must be used
// wherever a column is resolved by index — the App keyboard/copy/format handlers AND
// the grid's row render — or a formula column's index won't line up. Formula columns
// are derived display columns: read-only in the grid (e:false), computed after the
// date cascade.
const formulaColToColDef = fc => ({ k: fc.k, l: fc.l || "Formula", w: fc.w || 130, e: false, t: "formula", formula: fc.formula || "" });
const effectiveColsOf = proj => (formulaColsOf(proj).length ? [...COLS, ...formulaColsOf(proj).map(formulaColToColDef)] : COLS);
const activeEffectiveCols = d => effectiveColsOf(activeProjectOf(d));

// ── B583 — Formula-engine host glue ───────────────────────────────────────────
// Bridges the scheduler's task records to the pure engine (window.PlanyrFormula,
// inlined above). Built-in columns are exposed to formulas by friendly name; Start/
// Finish become engine date values; WORKDAY/NETWORKDAYS read the SAME working-day
// calendar (HOLIDAY_SET + weekends) the schedule cascade uses, so date math agrees
// with the durations. % Complete is the stored 0–100 number; Duration is working days.
const _pfDateRef = iso => { const PF = window.PlanyrFormula; if (!iso) return PF.BLANK; const s = PF.isoToSerial(iso); return s == null ? PF.BLANK : PF.makeDate(s); };
const _pfNumOrBlank = v => (v === "" || v == null) ? window.PlanyrFormula.BLANK : (Number(v) || 0);
const _pfCostRef = (t, key, rolledKey) => {
  const PF = window.PlanyrFormula;
  if (t.hasChildren) return Number(t[rolledKey] || 0);
  const raw = t[key];
  return (raw === "" || raw == null) ? PF.BLANK : (Number(raw) || 0);
};
// One row per built-in column a formula may read. `name` is the canonical reference
// (what autocomplete offers); `aliases` are also accepted; `get(task)` returns a typed value.
const FORMULA_BUILTIN_REFS = [
  { name: "ID",         aliases: [],                                  get: t => Number(t.id) },
  { name: "Task",       aliases: ["Name", "Task name"],               get: t => (t.name || "") },
  { name: "Start",      aliases: [],                                  get: t => _pfDateRef(t.start) },
  { name: "Finish",     aliases: ["End"],                             get: t => _pfDateRef(t.end) },
  { name: "Duration",   aliases: ["Dur"],                             get: t => _pfNumOrBlank(t.duration) },
  { name: "% Complete", aliases: ["% Comp", "Percent Complete"],      get: t => Number(t.percentComplete || 0) },
  { name: "Cost",       aliases: [],                                  get: t => _pfCostRef(t, "cost", "rolledCost") },
  { name: "Budget",     aliases: [],                                  get: t => _pfCostRef(t, "budget", "rolledBudget") },
  { name: "Actual",     aliases: ["Actual / Spend", "Actual Cost"],   get: t => _pfCostRef(t, "actualCost", "rolledActual") },
  { name: "Owner",      aliases: ["Responsible", "Responsible Party"],get: t => ownerJoin(ownerListOf(t)) },
  { name: "Health",     aliases: ["Status"],                          get: t => (t.health || "") },
];
const formulaCalendar = () => {
  const PF = window.PlanyrFormula;
  return { isWorkingDay: serial => { const w = PF.weekdayOf(serial); if (w === 0 || w === 6) return false; return !HOLIDAY_SET.has(PF.serialToISO(serial)); } };
};
const formulaToday = () => { const PF = window.PlanyrFormula; const s = PF.isoToSerial(NOW); return s == null ? PF.isoToSerial(fdLocal(new Date())) : s; };
// Lowercased reference-name → built-in getter (incl. aliases).
const _formulaBuiltinMap = () => { const m = new Map(); FORMULA_BUILTIN_REFS.forEach(r => { m.set(r.name.toLowerCase(), r); r.aliases.forEach(a => m.set(a.toLowerCase(), r)); }); return m; };
// The built-in column values for one task, keyed lowercased (what the engine looks up).
const buildFormulaRowColumns = task => { const cols = {}; _formulaBuiltinMap().forEach((ref, lname) => { cols[lname] = ref.get(task); }); return cols; };
// Autocomplete name list = built-in canonical names + this project's formula labels.
const formulaColumnNames = proj => {
  const names = FORMULA_BUILTIN_REFS.map(r => r.name);
  formulaColsOf(proj).forEach(fc => { if (fc.l) names.push(fc.l); });
  return names;
};
const isBuiltinFormulaName = name => { const l = String(name || "").toLowerCase(); return FORMULA_BUILTIN_REFS.some(r => r.name.toLowerCase() === l || r.aliases.some(a => a.toLowerCase() === l)); };
// Compute every formula column's value for every task. Dependent formula columns are
// ordered topologically (a formula that reads another formula sees its value); cycles
// and parse errors surface as cell errors. Returns { [taskId]: { [colKey]: cell } }.
const computeFormulaValues = (tasks, formulaColDefs, proj) => {
  const PF = window.PlanyrFormula;
  const out = {};
  if (!PF || !Array.isArray(formulaColDefs) || !formulaColDefs.length || !Array.isArray(tasks)) return out;
  const cal = formulaCalendar();
  const today = formulaToday();
  const dateFmt = serial => toShortDate(PF.serialToISO(serial));
  const defByKey = Object.fromEntries(formulaColDefs.map(d => [d.k, d]));
  const labelLowerByKey = Object.fromEntries(formulaColDefs.map(d => [d.k, (d.l || "").toLowerCase()]));
  const nameToKey = name => { const l = String(name).toLowerCase(); const fc = formulaColDefs.find(d => (d.l || "").toLowerCase() === l); return fc ? fc.k : null; };
  const plan = PF.planFormulaColumns(formulaColDefs.map(d => ({ key: d.k, formula: d.formula })), nameToKey);
  // Whole-column aggregation (SUM([Cost]), COUNTIF, XLOOKUP, …) must read the project's
  // LEAF tasks of the FULL tree — NOT the visible/flattened rows. The flattened list
  // double-counts an EXPANDED group (the parent shows the rolled-up sum AND its children
  // are listed too) and omits a COLLAPSED group's children entirely — so neither matches
  // the true total. Leaves carry the atomic values; a parent's cell is a pure roll-up of them.
  const allTasks = (proj && Array.isArray(proj.tasks) && proj.tasks.length) ? proj.tasks : tasks;
  const parentIds = new Set(allTasks.map(t => t.parentId).filter(x => x !== null && x !== undefined));
  const isLeaf = t => !parentIds.has(t.id);
  // Working set = the visible rows we must OUTPUT a value for, PLUS any leaf hidden under a
  // collapsed parent (absent from `tasks`). Deduped by id; prefer the visible/augmented row
  // object (it carries rolledCost/rolledBudget for a parent's own this-row display value).
  const byId = new Map();
  tasks.forEach(t => byId.set(t.id, t));
  allTasks.forEach(t => { if (isLeaf(t) && !byId.has(t.id)) byId.set(t.id, t); });
  const work = [...byId.values()];
  const rowOf = new Map(work.map(t => [t.id, buildFormulaRowColumns(t)]));
  const aggRows = work.filter(isLeaf).map(t => rowOf.get(t.id)); // leaves only → the aggregation view
  const visibleIds = new Set(tasks.map(t => t.id));
  tasks.forEach(t => { out[t.id] = {}; });
  // Compute COLUMN-BY-COLUMN in dependency order — so a formula that aggregates ANOTHER
  // formula column sees that column already filled for every leaf.
  plan.order.forEach(key => {
    const def = defByKey[key]; if (!def) return;
    const ll = labelLowerByKey[key];
    work.forEach(task => {
      const cols = rowOf.get(task.id);
      let res;
      if (plan.cyclic.has(key)) res = { ok: false, error: PF.FORMULA_ERRORS.CIRC, detail: "circular reference between formula columns" };
      else res = PF.evaluateFormula(def.formula, { columns: cols, rows: aggRows, rowIndex: 0, calendar: cal, today, formatDate: dateFmt });
      // Expose to dependent formula columns (aggRows share these maps). An errored cell is
      // stored as an ERROR VALUE (not BLANK) so a downstream SUM/COUNT/etc. over this column
      // PROPAGATES the error — matching Excel — instead of silently skipping the bad row.
      if (ll) cols[ll] = res.ok ? res.value : PF.errVal(res.error);
      if (visibleIds.has(task.id)) {
        const display = res.ok ? PF.formatValue(res.value, { formatDate: dateFmt }) : res.error;
        out[task.id][key] = { ok: res.ok, error: res.ok ? null : res.error, detail: res.detail, display, value: res.ok ? res.value : undefined };
      }
    });
  });
  return out;
};

// Keyboard column navigation steps through the VISIBLE columns in DISPLAY ORDER so the
// cell cursor (a COLS/master index) never lands on a hidden, non-rendered column (which
// would make the blue selection outline vanish). `visIdxs` = master indices of the visible
// columns, display order. Mirrors stepVisibleColByIdx in
// src/workspaces/scheduler/lib/gridColNav.js (unit-tested) — keep the two in sync.
// NOTE: every caller passes dir = +1 or -1; the off-table snap below collapses dir<=0 into
// the backward walk. The module's distinct dir===0 closest-by-distance case is NOT needed
// here — that "selected column got hidden" snap is handled by the GridView effect instead.
function stepVisibleColIdx(visIdxs, curIdx, dir) {
  if (!visIdxs || !visIdxs.length) return curIdx;
  const pos = visIdxs.indexOf(curIdx);
  if (pos === -1) { // cursor off-table (hidden / initial id column) — snap onto the table toward dir
    if (dir > 0) { const f = visIdxs.find(i => i > curIdx); return f !== undefined ? f : visIdxs[visIdxs.length - 1]; }
    let b; visIdxs.forEach(i => { if (i < curIdx) b = i; }); return b !== undefined ? b : visIdxs[0];
  }
  return visIdxs[Math.max(0, Math.min(visIdxs.length - 1, pos + (dir > 0 ? 1 : -1)))];
}

// NEW-1 (owner report 2026-10-19, B463922 lineage) — Up/Down arrow row navigation. A selection in the
// visible list moves exactly one row; a LOST selection (its row hidden by a collapse / Focus, or deleted)
// is re-anchored at the gap it occupied and moves one row from THERE — never to the first or last row,
// which is where the old `findIndex === -1` fallbacks sent it (measured: fold the group holding the
// selection, press ↓ or ↑ → row 1 and the view to the top; delete a row, press ↓ → row 1, ↑ → the last
// row). Mirrors stepGridRow in src/workspaces/scheduler/lib/gridRowNav.js BYTE-IDENTICALLY — the unit
// tests (test/gridRowNav.test.js) fail if the two diverge.
function stepGridRow(flat, allTasks, selectedId, dir, lastIdx, topIdx) {
  const NEW = "__NEW_TASK__";
  const n = flat ? flat.length : 0;
  if (!n) return null;                                        // nothing to move through — never invent a destination
  const clamp = i => Math.max(0, Math.min(n - 1, i));
  if (selectedId === NEW) return dir < 0 ? flat[n - 1].id : null;
  const idx = selectedId == null ? -1 : flat.findIndex(t => t.id === selectedId);
  if (idx >= 0) {
    if (dir > 0) return idx === n - 1 ? NEW : flat[idx + 1].id;
    return flat[Math.max(0, idx - 1)].id;
  }
  // The selection is LOST: hidden (its group collapsed or Focused) or gone (deleted). Re-anchor at the
  // gap g where it sat — between flat[g] and flat[g + 1] — and move one row from there.
  let g = null;
  if (selectedId != null && allTasks) {
    // Still in the schedule, just hidden: the gap is after the last VISIBLE row that comes before it in
    // the full visual order (allTasks is stored in visual order).
    const pos = allTasks.findIndex(t => t.id === selectedId);
    if (pos >= 0) {
      const before = new Set(allTasks.slice(0, pos).map(t => t.id));
      g = -1;
      for (let i = 0; i < n; i++) if (before.has(flat[i].id)) g = i;
    }
  }
  if (g == null && Number.isInteger(lastIdx) && lastIdx >= 0) g = Math.min(lastIdx, n) - 1;  // deleted: the slot it last held
  if (g == null) return flat[clamp(Number.isInteger(topIdx) ? topIdx : 0)].id;               // nothing known: the row at the top of the view
  if (dir > 0) return g + 1 >= n ? NEW : flat[Math.max(0, g + 1)].id;
  return flat[clamp(g)].id;
}

// NEW-1 (B2451776, owner request 2026-10-28) — Ctrl/Cmd+Arrow jumps across blank cells like Excel: ride a run of
// filled cells to its last one, otherwise land on the next filled cell, otherwise the edge (first / last TASK row
// — never "+ New task" — or first / last visible column). Navigation is by VISIBLE order, so collapsed / Focused-away
// rows are skipped. "Blank" = the cell draws nothing that carries data (a rolled-up date on a summary IS data; the
// Notes "+" and an empty Owner are not). These three functions mirror src/workspaces/scheduler/lib/gridCtrlNav.js
// BYTE-IDENTICALLY (save the `export `); test/gridCtrlNav.test.js fails if they diverge. Rules + rationale live there.
function ctrlJumpIndex(isBlank, n, cur, dir) {
  const inRange = i => i >= 0 && i < n;
  const edge = dir > 0 ? n - 1 : 0;
  const next = cur + dir;
  if (!inRange(next)) return inRange(cur) ? cur : null;           // already on the edge (or off it, heading away)
  if (inRange(cur) && !isBlank(cur) && !isBlank(next)) {
    let i = next;                                                   // inside a run: ride it to its last cell
    while (inRange(i + dir) && !isBlank(i + dir)) i += dir;
    return i;
  }
  let i = next;                                                     // on / before a gap: the next filled cell
  while (inRange(i) && isBlank(i)) i += dir;
  return inRange(i) ? i : edge;                                     // none → the edge
}

function gridCtrlArrowTarget(key, rowCount, colMasters, row, col, blankAt) {
  const dir = (key === "ArrowDown" || key === "ArrowRight") ? 1 : -1;
  if (key === "ArrowUp" || key === "ArrowDown") {
    if (!(rowCount > 0)) return null;
    const r = ctrlJumpIndex(i => blankAt(i, col), rowCount, row, dir);
    return r == null ? null : { row: r, col };
  }
  const nc = colMasters ? colMasters.length : 0;
  if (!nc) return null;
  const pos = colMasters.indexOf(col);
  if (pos < 0) {                                                    // the cursor sits on a hidden column: snap toward dir
    if (dir > 0) { const f = colMasters.find(i => i > col); return { row, col: f !== undefined ? f : colMasters[nc - 1] }; }
    let b; colMasters.forEach(i => { if (i < col) b = i; });
    return { row, col: b !== undefined ? b : colMasters[0] };
  }
  const j = ctrlJumpIndex(q => blankAt(row, colMasters[q]), nc, pos, dir);
  return j == null ? null : { row, col: colMasters[j] };
}

function gridCellBlank(task, col, env) {
  if (!task) return true;
  if (col.t === "formula") {
    const f = env.formula(task.id, col.k);
    return !f || f.display === "" || f.display == null;
  }
  switch (col.k) {
    case "id": return false;
    case "name": return String(task.name == null ? "" : task.name).trim() === "";
    case "start": case "end": return !task[col.k];
    case "duration": return task.duration === "" || task.duration == null;
    case "predecessors": return env.predCount(task.predecessors) === 0;
    case "successors": return env.succCount(task.id) === 0;
    case "health": case "status": return !!(task.hasChildren && task.isExpanded);
    case "percentComplete": return false;
    case "responsibleParty": return env.ownerCount(task) === 0;
    case "cost": case "budget": case "actualCost": {
      const rolledKey = col.k === "cost" ? "rolledCost" : col.k === "budget" ? "rolledBudget" : "rolledActual";
      return !(task[rolledKey] ?? (Number(task[col.k]) || 0));
    }
    case "notes": return !(task.notes && task.notes.length);
    case "meetingBody": return task.hasChildren ? true : !(task.deadlineForTaskId != null || task.meetingBound);
    case "floatToDeadline": return env.floatDays(task) == null;
    case "costIfMissed": return env.costDays(task) == null;
    default: return task[col.k] == null || task[col.k] === "";
  }
}

// B2470832 — THE one rule for "this row is a Focus group": it has at least one child. `hasChildren` on the grid's
// rows (the flattened list and the review list), the Focus chip's visibility, and Alt+F's target all come from
// this set, so they can never disagree. Whether anything is currently HIDEABLE in the group is a different
// question (hideableCount) and decides only what the chip's tooltip and Alt+F's toast say — never whether the
// control exists. (It used to decide that too, plus "is expanded": a group whose children were all in progress,
// or one that was collapsed, had no Focus button at all while its siblings did.)
function focusGroupIds(tasks) {
  const ids = new Set();
  (tasks || []).forEach(t => { if (t.parentId != null) ids.add(t.parentId); });
  return ids;
}
// The grid draws a Focus chip on exactly these rows. `hideableCount` is a number only on the Focus-aware
// grid list (flatTasks); the review list ignores Focus entirely, so it has no chip.
function rowCanFocus(row) { return !!row && !!row.hasChildren && typeof row.hideableCount === "number"; }
// Chip tooltip. Every variant keeps its established prefix ("Focus: hide" / "Show all tasks") — other
// harnesses tell the chip's title apart from the task name by it.
function focusChipTitle(row) {
  if (row.focused)
    return `Show all tasks in this group — ${row.hideableDone} completed, ${row.hideablePaused} paused, ${row.hideableUpcoming} not started hidden (Alt+F)`;
  if (row.hideableCount > 0)
    return `Focus: hide ${row.hideableCount} completed / paused / not-started task${row.hideableCount>1?'s':''} (Alt+F)`;
  return "Focus: hide completed / paused / not-started tasks here — none right now (Alt+F)";
}

// NEW-1 (B2455200) — Alt+F toggles Focus. WHICH group: the anchor row is the TOP selected row; if it is a
// summary (has children) it is that row's own Focus, if it is a plain task it is its parent group's, and a
// top-level plain task (no parent) has none -> null (the key does nothing, no error). Pure; unit-tested by
// extracting this source (test/scheduleFocusKey.test.js).
function focusToggleTarget(allTasks, anchorId) {
  if (anchorId == null || anchorId === "__NEW_TASK__") return null;
  const t = (allTasks || []).find(x => x.id === anchorId);
  if (!t) return null;
  if (focusGroupIds(allTasks).has(t.id)) return t.id;
  return (t.parentId != null && allTasks.some(x => x.id === t.parentId)) ? t.parentId : null;
}
// After a Focus toggle: where the selection goes. Kept when its row is still visible; else the nearest
// ANCESTOR that is visible (the parent summary row, or higher when the parent is itself hidden); null when
// nothing qualifies (the selection is left alone).
function focusReselectTarget(allTasks, visibleIds, selId) {
  if (selId == null || selId === "__NEW_TASK__" || visibleIds.has(selId)) return selId;
  const byId = new Map((allTasks || []).map(t => [t.id, t]));
  let cur = byId.get(selId);
  for (let guard = 0; cur && cur.parentId != null && guard < 1000; guard++) {
    if (visibleIds.has(cur.parentId)) return cur.parentId;
    cur = byId.get(cur.parentId);
  }
  return null;
}

// ── Task-complete celebration ("Ring & Spark" toast) ──────
// A small toast rises from the bottom-center when a task transitions to
// Complete: the green dot pops in, the check draws itself, a ring pulses
// outward, and a few sparks fan up — then it sinks away after ~2.3s.
// Bottom-anchored (not in the row) so it stays visible even when the
// successor prompt modal opens; z-index above all modals, pointer-events:none
// so it never blocks a click. Pure Web Animations API on a body-level node —
// survives React re-renders. A new completion replaces the previous toast.
function celebrateTaskComplete(taskName) {
  try {
    document.getElementById("planar-celebrate-toast")?.remove();
    document.getElementById("planar-delete-toast")?.remove(); // same anchor spot — never stack
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const toast = document.createElement("div");
    toast.id = "planar-celebrate-toast";
    // env(safe-area-inset-bottom) keeps it clear of the iPhone home bar
    toast.style.cssText = "position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:100002;pointer-events:none;";

    const card = document.createElement("div");
    card.style.cssText = "display:flex;align-items:center;gap:11px;background:var(--bg);border:1px solid #d0d7de;border-radius:10px;padding:10px 16px 10px 13px;box-shadow:0 6px 24px rgba(27,31,36,.16),0 1px 3px rgba(27,31,36,.08);font-family:'Inter',system-ui,-apple-system,sans-serif;";
    toast.appendChild(card);

    // Dot + ring + sparks share one positioning context; nothing in the
    // ancestor chain clips, so sparks can fly past the card's top edge.
    const dotWrap = document.createElement("span");
    dotWrap.style.cssText = "position:relative;width:20px;height:20px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;";
    const ring = document.createElement("span");
    ring.style.cssText = "position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:2px solid #16a34a;opacity:0;";
    const dot = document.createElement("span");
    dot.style.cssText = "position:relative;width:20px;height:20px;border-radius:50%;background:#16a34a;display:inline-flex;align-items:center;justify-content:center;";
    dot.innerHTML = '<svg width="12" height="12" viewBox="0 0 13 13" fill="none"><path d="M3 6.7 L5.5 9.2 L10 3.8" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="stroke-dasharray:14;stroke-dashoffset:14;"/></svg>';
    dotWrap.appendChild(ring);
    dotWrap.appendChild(dot);
    card.appendChild(dotWrap);

    // textContent (not innerHTML) so task names can never inject markup
    const text = document.createElement("span");
    const nameEl = document.createElement("div");
    nameEl.style.cssText = "font-size:12.5px;font-weight:600;color:#1f2328;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35;";
    nameEl.textContent = (taskName || "Task").toString();
    const subEl = document.createElement("div");
    subEl.style.cssText = "font-size:11px;font-weight:500;color:#15803d;line-height:1.35;";
    subEl.textContent = "Marked complete";
    text.appendChild(nameEl); text.appendChild(subEl);
    card.appendChild(text);

    document.body.appendChild(toast);

    const chk  = dot.querySelector("path");
    const LIFE = 2300; // ms fully visible before the exit begins
    const exit = (dur) => {
      toast.animate(
        [{transform:"translateX(-50%) translateY(0)", opacity:1},
         {transform:"translateX(-50%) translateY(10px)", opacity:0}],
        {duration:dur, easing:"cubic-bezier(.4,0,1,1)", fill:"forwards"}
      );
      setTimeout(() => toast.remove(), dur + 30);
    };

    if (reduce) {
      // Reduced motion: keep the informative toast, drop the theatrics
      if (chk) chk.style.strokeDashoffset = "0";
      toast.animate([{opacity:0},{opacity:1}], {duration:150, fill:"forwards"});
      setTimeout(() => exit(200), LIFE);
      return;
    }

    // Entry: rise with a slight overshoot
    toast.animate(
      [{transform:"translateX(-50%) translateY(16px)", opacity:0},
       {transform:"translateX(-50%) translateY(-2px)", opacity:1, offset:.7},
       {transform:"translateX(-50%) translateY(0)",    opacity:1}],
      {duration:300, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"}
    );
    // Dot pops into existence
    dot.animate(
      [{transform:"scale(.4)"},{transform:"scale(1.28)",offset:.55},{transform:"scale(.95)",offset:.8},{transform:"scale(1)"}],
      {duration:420, delay:90, easing:"cubic-bezier(.34,1.56,.64,1)", fill:"backwards"}
    );
    // Check draws in (style fallback in case WAAPI can't tween SVG dashoffset)
    if (chk) {
      chk.animate([{strokeDashoffset:14},{strokeDashoffset:0}], {duration:320, delay:200, easing:"cubic-bezier(.65,0,.35,1)", fill:"forwards"});
      setTimeout(() => { chk.style.strokeDashoffset = "0"; }, 540);
    }
    // Ring pulses outward
    ring.animate(
      [{transform:"scale(.9)", opacity:.55},{transform:"scale(2.6)", opacity:0}],
      {duration:620, delay:160, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"}
    );
    // Sparks fan upward out of the card
    const colors = ["#16a34a","#22c55e","#4f46e5","#16a34a","#34d399","#4f46e5"];
    const N = 6;
    for (let i = 0; i < N; i++) {
      const s = document.createElement("span");
      s.style.cssText = `position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:${colors[i % colors.length]};opacity:0;`;
      dotWrap.appendChild(s);
      const ang  = (-90 + (i / (N - 1) - 0.5) * 150) * Math.PI / 180; // fan upward
      const dist = 22 + Math.random() * 14;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      s.animate(
        [{transform:"translate(0,0) scale(1)",                       opacity:1},
         {transform:`translate(${dx*.55}px,${dy*.55}px) scale(.7)`,  opacity:1, offset:.4},
         {transform:`translate(${dx}px,${dy}px) scale(.35)`,         opacity:0}],
        {duration:580, delay:170, easing:"cubic-bezier(.18,.7,.3,1)", fill:"forwards"}
      );
    }
    setTimeout(() => exit(240), LIFE);
  } catch (e) { /* celebration is decorative — never let it break a real update */ }
}

// ── Row-deletion toast ────────────────────────────────────
// Confirmation that rows were removed, in the same bottom-center style as the
// completion toast. Shows how many rows went (and, when parents were swept,
// how many tasks total including subtasks) plus a Ctrl+Z reminder — deletes
// flow through setData, so the existing undo history restores them fully.
function notifyRowsDeleted(rowCount, totalCount) {
  try {
    document.getElementById("planar-delete-toast")?.remove();
    document.getElementById("planar-celebrate-toast")?.remove(); // same anchor spot — never stack
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const toast = document.createElement("div");
    toast.id = "planar-delete-toast";
    toast.style.cssText = "position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:100002;pointer-events:none;";
    const card = document.createElement("div");
    card.style.cssText = "display:flex;align-items:center;gap:11px;background:var(--bg);border:1px solid #d0d7de;border-radius:10px;padding:10px 16px 10px 13px;box-shadow:0 6px 24px rgba(27,31,36,.16),0 1px 3px rgba(27,31,36,.08);font-family:'Inter',system-ui,-apple-system,sans-serif;";
    toast.appendChild(card);

    const dot = document.createElement("span");
    dot.style.cssText = "width:20px;height:20px;border-radius:50%;background:#dc2626;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;";
    dot.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.4 H10"/><path d="M4.6 3.4 V2.4 A.7 .7 0 0 1 5.3 1.7 H6.7 A.7 .7 0 0 1 7.4 2.4 V3.4"/><path d="M3.1 3.4 L3.7 9.9 A.8 .8 0 0 0 4.5 10.6 H7.5 A.8 .8 0 0 0 8.3 9.9 L8.9 3.4"/><path d="M5.1 5.4 V8.6 M6.9 5.4 V8.6"/></svg>';
    card.appendChild(dot);

    const text = document.createElement("span");
    const nameEl = document.createElement("div");
    nameEl.style.cssText = "font-size:12.5px;font-weight:600;color:#1f2328;line-height:1.35;";
    nameEl.textContent = rowCount === 1 ? "1 row deleted" : `${rowCount} rows deleted`;
    const subEl = document.createElement("div");
    subEl.style.cssText = "font-size:11px;font-weight:500;color:#57606a;line-height:1.35;";
    subEl.textContent = (totalCount > rowCount ? `${totalCount} tasks removed including subtasks · ` : "") + "Ctrl+Z to undo";
    text.appendChild(nameEl); text.appendChild(subEl);
    card.appendChild(text);

    document.body.appendChild(toast);

    const LIFE = 2600; // a touch longer than the celebration — it carries the undo hint
    const exit = (dur) => {
      toast.animate(
        [{transform:"translateX(-50%) translateY(0)", opacity:1},
         {transform:"translateX(-50%) translateY(10px)", opacity:0}],
        {duration:dur, easing:"cubic-bezier(.4,0,1,1)", fill:"forwards"}
      );
      setTimeout(() => toast.remove(), dur + 30);
    };
    if (reduce) {
      toast.animate([{opacity:0},{opacity:1}], {duration:150, fill:"forwards"});
      setTimeout(() => exit(200), LIFE);
      return;
    }
    toast.animate(
      [{transform:"translateX(-50%) translateY(16px)", opacity:0},
       {transform:"translateX(-50%) translateY(-2px)", opacity:1, offset:.7},
       {transform:"translateX(-50%) translateY(0)",    opacity:1}],
      {duration:280, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"}
    );
    setTimeout(() => exit(240), LIFE);
  } catch (e) { /* informational — never let the toast block a delete */ }
}

// ── Successor Prompt ──────────────────────────────────────
// NEW-1 — shared by both footer buttons (Skip, Update Successors) so "same size" is a single
// object, not two style literals kept in sync by hand.
const FOOTER_BTN_STYLE = {
  fontSize:12, width:150, height:34, display:'flex', alignItems:'center', justifyContent:'center',
  borderRadius:6, fontFamily:'inherit', fontWeight:600, cursor:'pointer',
  border:'1px solid #e5e7eb', background:'var(--bg)', color:'#374151',
};
function SuccessorPromptModal({ prompt, updateTask, onClose, onOpenTask }) {
  const { completedTask, projId, projName, successors } = prompt;
  const readyToStart  = successors.filter(t => t.health === 'gray');
  const alreadyActive = successors.filter(t => t.health !== 'gray');

  const [pending, setPending] = React.useState(() => {
    const m = {};
    successors.forEach(t => { m[t.id] = t.health === 'gray' ? 'yellow' : null; });
    return m;
  });

  const changeCount = Object.values(pending).filter(v => v !== null).length;

  function apply() {
    Object.entries(pending).forEach(([tid, hk]) => {
      if (hk !== null) updateTask(Number(tid), { health: hk }, projId);
    });
    onClose();
  }

  function StatusPills({ task }) {
    const opts = [
      { k:'gray',   label:'Not Started' },
      { k:'yellow', label:'In Progress' },
      { k:'red',    label:'Needs Attn.' },
      { k:'green',  label:'Complete' },
    ];
    const cur = pending[task.id];
    const isGray = task.health === 'gray';
    return (
      <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap',marginTop:6}}>
        {!isGray && (
          <button data-successor-pill="nochange" onClick={()=>setPending(p=>({...p,[task.id]:null}))}
            style={{fontSize:10,padding:'3px 8px',borderRadius:12,fontFamily:'inherit',cursor:'pointer',
              border: cur===null?'1.5px solid #6366f1':'1px solid #d1d5db',
              background:cur===null?'#eef2ff':'#f9fafb',
              color:cur===null?'#4f46e5':'#6b7280',fontWeight:cur===null?600:400}}>
            No change
          </button>
        )}
        {opts.map(o => {
          const h = HEALTH[o.k]||HEALTH.gray;
          const sel = pending[task.id]===o.k;
          return (
            <button key={o.k} data-successor-pill={o.k} onClick={()=>setPending(p=>({...p,[task.id]:o.k}))}
              style={{display:'flex',alignItems:'center',gap:5,fontSize:10,padding:'3px 9px',
                borderRadius:12,fontFamily:'inherit',cursor:'pointer',
                border: sel?`1.5px solid ${h.dot==='#ffffff'?'#d1d5db':h.dot}`:'1px solid #e5e7eb',
                background:sel?h.bar:'#f9fafb',
                color:sel?HDARK[o.k]:'#6b7280',fontWeight:sel?600:400}}>
              <span style={{width:7,height:7,borderRadius:'50%',flexShrink:0,
                background:h.dot==='#ffffff'?'#d1d5db':h.dot}} />
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  function TaskRow({ task, accent }) {
    const h = HEALTH[task.health]||HEALTH.gray;
    return (
      <div data-successor-row={task.id} style={{padding:'10px 14px',borderRadius:7,marginBottom:8,
        background:accent?'#fafbff':'#f9fafb',
        border:`1px solid ${accent?'#e0e4f8':'#e5e7eb'}`}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div style={{fontWeight:500,fontSize:13,color:'#1f2328',flex:1,minWidth:0,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={task.name}>
            {task.name}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
            <span style={{width:7,height:7,borderRadius:'50%',
              background:h.dot==='#ffffff'?'#d1d5db':h.dot}} />
            <span style={{fontSize:10,color:'#6b7280',whiteSpace:'nowrap'}}>{h.label}</span>
          </div>
        </div>
        <StatusPills task={task} />
        {onOpenTask && (
          <div style={{marginTop:7}}>
            <span onClick={()=>onOpenTask(projId, task.id)}
              style={{fontSize:11,color:'#4f46e5',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:3,fontWeight:500}}>
              Open in Projects
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-successor-modal onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{position:'fixed',inset:0,zIndex:4000,display:'flex',alignItems:'center',
        justifyContent:'center',background:'rgba(15,23,42,.35)'}}>
      <div style={{background:'var(--bg)',borderRadius:12,boxShadow:'0 16px 48px rgba(0,0,0,.18)',
        width:480,maxWidth:'94vw',maxHeight:'82vh',display:'flex',flexDirection:'column',overflow:'hidden'}}
        tabIndex={-1} ref={el=>el?.focus()}
        /* NEW-1 — Enter's meaning does not change: it applies `pending` exactly as it always has
         * (defaults every Ready-to-Start row to In Progress; that's the muscle memory the owner
         * keeps). Completing a successor goes through this SAME Enter/apply() path — pick the
         * Complete pill on its row, then Enter — there is no second accept mechanism here.
         * ⛔ The former "Mark Complete" bulk button and its Ctrl/Cmd+Enter twin were removed as a
         * redundant third footer control (the Complete pill already does the job); do not re-add a
         * second Enter-adjacent accept key without re-reading B463920 first — the
         * overlayAtKeyStartRef latch only needs ONE thing to stay true: a keystroke that dismisses
         * this modal must never read as "no overlay was open" to the grid's own key handler. */
        onKeyDown={e=>{
          if (e.key==='Escape') { onClose(); return; }
          if (e.key==='Enter' && changeCount>0) apply();
        }}>
        {/* Header */}
        <div style={{padding:'18px 20px 14px',borderBottom:'1px solid #e5e7eb',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:32,height:32,borderRadius:'50%',background:'#dcfce7',flexShrink:0,
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:'#16a34a',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:2}}>Task Completed</div>
                <div style={{fontSize:14,fontWeight:600,color:'#1f2328',maxWidth:340,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={completedTask.name}>{completedTask.name}</div>
              </div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:18,padding:'4px',borderRadius:4,lineHeight:1,flexShrink:0}}
              onMouseEnter={e=>e.currentTarget.style.color='#374151'} onMouseLeave={e=>e.currentTarget.style.color='#9ca3af'}>✕</button>
          </div>
          <div style={{fontSize:11,color:'#6b7280',marginTop:8,paddingLeft:42}}>
            {projName} · {successors.length} successor{successors.length!==1?'s':''} to review
          </div>
        </div>
        {/* Body */}
        <div style={{flex:1,overflowY:'auto',padding:'14px 20px'}}>
          {readyToStart.length>0 && (<>
            <div style={{fontSize:10,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:'#6366f1'}} /> Ready to Start
            </div>
            {readyToStart.map(t=><TaskRow key={t.id} task={t} accent={true}/>)}
          </>)}
          {alreadyActive.length>0 && (<>
            <div style={{fontSize:10,fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:8,marginTop:readyToStart.length?12:0,display:'flex',alignItems:'center',gap:6}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:'#9ca3af'}} /> Already Active
            </div>
            {alreadyActive.map(t=><TaskRow key={t.id} task={t} accent={false}/>)}
          </>)}
        </div>
        {/* Footer — NEW-1: back to TWO buttons, same width/weight/height (FOOTER_BTN_STYLE). The
            owner flagged the three-button footer as "horrible UI" — the removed "Mark Complete"
            button was redundant with the Complete pill two lines up (pick Complete on the pill,
            press Update Successors — same outcome), and having it as its own control broke the
            row's visual balance. Completing a successor is still one click away; it just no
            longer gets its own footer button. */}
        <div style={{padding:'12px 20px',borderTop:'1px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,background:'#f9fafb',flexShrink:0}}>
          <span style={{fontSize:11,color:'#9ca3af',marginRight:'auto'}}>
            {changeCount>0?`${changeCount} update${changeCount!==1?'s':''} pending`:'No changes'}
          </span>
          <button data-successor-apply="skip" onClick={onClose} style={FOOTER_BTN_STYLE}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#6b7280'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e5e7eb'}>
            Skip
          </button>
          <button data-successor-apply="update" onClick={apply} disabled={!changeCount}
            title="Applies the status picked for each row above · Enter"
            style={{...FOOTER_BTN_STYLE,
              cursor:changeCount?'pointer':'default',
              border:changeCount?'1px solid #4f46e5':'1px solid #e5e7eb',
              background:changeCount?'#4f46e5':'#f3f4f6',
              color:changeCount?'#fff':'#9ca3af'}}>
            Update Successors
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete-with-children prompt ────────────────────────────
// Owner correction (verbatim): don't silently cascade, don't silently promote — ask, with exactly
// two choices plus Cancel, and "the action buttons must be the same size as each other" (his
// standing complaint about the successor modal above, before that one was fixed). Reuses
// FOOTER_BTN_STYLE directly rather than a look-alike copy, so equal sizing is the SAME shared
// object, not two literals that could drift apart independently — measured in
// ui-audit/verify-schedule-indent-outdent-delete.mjs via getBoundingClientRect on all three.
function DeleteChildrenModal({ rowCount, totalCount, onCascade, onPromote, onCancel }) {
  const subtaskCount = totalCount - rowCount;
  const title = rowCount > 1 ? `Delete ${rowCount} tasks?` : "Delete this task?";
  const body = rowCount > 1
    ? `${subtaskCount} subtask${subtaskCount !== 1 ? "s" : ""} would come with ${rowCount > 1 ? "them" : "it"}.`
    : `This task has ${subtaskCount} subtask${subtaskCount !== 1 ? "s" : ""}.`;
  return (
    <div data-delete-children-modal onMouseDown={e=>{if(e.target===e.currentTarget)onCancel();}}
      style={{position:'fixed',inset:0,zIndex:4000,display:'flex',alignItems:'center',
        justifyContent:'center',background:'rgba(15,23,42,.35)'}}>
      <div style={{background:'var(--bg)',borderRadius:12,boxShadow:'0 16px 48px rgba(0,0,0,.18)',
        width:460,maxWidth:'94vw',display:'flex',flexDirection:'column',overflow:'hidden'}}
        tabIndex={-1} ref={el=>el?.focus()}
        onKeyDown={e=>{ if (e.key==='Escape') onCancel(); }}>
        <div style={{padding:'18px 20px 14px',borderBottom:'1px solid #e5e7eb'}}>
          <div style={{fontSize:14,fontWeight:600,color:'#1f2328'}}>{title}</div>
          <div style={{fontSize:12,color:'#6b7280',marginTop:6}}>
            {body} Delete them too, or keep them — they'll move up to this task's parent, in the same order.
          </div>
        </div>
        <div style={{padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,background:'#f9fafb'}}>
          <button data-delete-children-choice="cancel" onClick={onCancel} style={FOOTER_BTN_STYLE}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#6b7280'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e5e7eb'}>
            Cancel
          </button>
          <button data-delete-children-choice="promote" onClick={onPromote} style={FOOTER_BTN_STYLE}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#6b7280'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e5e7eb'}>
            Keep subtasks
          </button>
          <button data-delete-children-choice="cascade" onClick={onCascade}
            style={{...FOOTER_BTN_STYLE, border:'1px solid #dc2626', background:'#dc2626', color:'#fff'}}>
            Delete all {totalCount}
          </button>
        </div>
      </div>
    </div>
  );
}

// NEW-ROWMOVE — "Move to…": names the destination instead of aiming a drag at it, so it works
// whether or not the target group is expanded or even on screen. Steel-manned against drag for the
// owner's actual scenario (gathering scattered permitting/entitlement tasks into a Phase 2 group he
// just created): drag needs the destination visible and needs a precise drop; this needs only its
// name, typed once per task moved. Ships alongside drag rather than instead of it — drag is still
// the better tool for a quick local reorder.
function MoveToModal({ tasks, sourceIds, onCommit, onCancel }) {
  const [query, setQuery] = React.useState("");
  const [hi, setHi] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  // Every task the moved block can legally land under: everything EXCEPT the moved rows themselves
  // and any of their own descendants (moveSelectionToDestination refuses those anyway — filtering
  // here just keeps the list from offering a destination that would be rejected on commit).
  const blocked = React.useMemo(() => {
    const b = new Set(sourceIds);
    let grew = true;
    while (grew) { grew = false; tasks.forEach(t => { if (t.parentId != null && b.has(t.parentId) && !b.has(t.id)) { b.add(t.id); grew = true; } }); }
    return b;
  }, [tasks, sourceIds]);

  // Depth-labeled list for every candidate, walked WITHOUT the isExpanded gate (unlike
  // flatOrderWithLevel) — a collapsed destination must still be searchable and pickable by name.
  const options = React.useMemo(() => {
    const kidsBy = new Map();
    tasks.forEach(t => { const p = t.parentId ?? null; if (!kidsBy.has(p)) kidsBy.set(p, []); kidsBy.get(p).push(t); });
    const out = [];
    const walk = (parentId, level) => (kidsBy.get(parentId) || []).forEach(t => { if (!blocked.has(t.id)) out.push({ id: t.id, name: t.name || `Task ${t.id}`, level }); walk(t.id, level + 1); });
    walk(null, 0);
    const q = query.trim().toLowerCase();
    const filtered = q ? out.filter(o => o.name.toLowerCase().includes(q)) : out;
    return [{ id: null, name: "— Top level —", level: 0 }, ...filtered];
  }, [tasks, blocked, query]);

  const commit = (id) => { if (id !== undefined) onCommit(id, "end"); };
  return (
    <div data-move-to-modal onMouseDown={e=>{if(e.target===e.currentTarget)onCancel();}}
      style={{position:'fixed',inset:0,zIndex:4000,display:'flex',alignItems:'center',
        justifyContent:'center',background:'rgba(15,23,42,.35)'}}>
      <div style={{background:'var(--bg)',borderRadius:12,boxShadow:'0 16px 48px rgba(0,0,0,.18)',
        width:420,maxWidth:'94vw',maxHeight:'70vh',display:'flex',flexDirection:'column',overflow:'hidden'}}
        tabIndex={-1}
        onKeyDown={e=>{
          if (e.key === 'Escape') { onCancel(); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(options.length - 1, h + 1)); return; }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => Math.max(0, h - 1)); return; }
          if (e.key === 'Enter')    { e.preventDefault(); commit(options[hi]?.id); return; }
        }}>
        <div style={{padding:'14px 16px 10px',borderBottom:'1px solid #e5e7eb'}}>
          <div style={{fontSize:14,fontWeight:600,color:'#1f2328',marginBottom:8}}>
            Move {sourceIds.length > 1 ? `${sourceIds.length} tasks` : "task"} to…
          </div>
          <input {...NO_AUTOFILL} ref={inputRef} value={query} onChange={e=>{setQuery(e.target.value); setHi(0);}}
            placeholder="Search tasks…" style={{width:'100%',boxSizing:'border-box',fontSize:13,padding:'7px 9px',
            border:'1px solid #d1d5db',borderRadius:6,outline:'none',fontFamily:'inherit'}} />
        </div>
        <div style={{overflow:'auto',flex:1,padding:'4px 0'}}>
          {options.length === 1 && <div style={{padding:'10px 16px',fontSize:12,color:'#9ca3af'}}>No matching tasks</div>}
          {options.map((o, i) => (
            <div key={o.id ?? '__top'} data-move-to-option={o.id ?? "top"} onMouseEnter={()=>setHi(i)} onClick={()=>commit(o.id)}
              style={{padding:'6px 14px',paddingLeft:14 + o.level * 16,fontSize:13,cursor:'pointer',
                background: i === hi ? '#eff6ff' : 'transparent', color: o.id === null ? '#4b5563' : '#1f2328',
                fontStyle: o.id === null ? 'italic' : 'normal', whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {o.name}
            </div>
          ))}
        </div>
        <div style={{padding:'10px 16px',display:'flex',justifyContent:'flex-end',gap:8,background:'#f9fafb',borderTop:'1px solid #e5e7eb'}}>
          <button onClick={onCancel} style={FOOTER_BTN_STYLE}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#6b7280'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e5e7eb'}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactsPanel({ data, setData, onClose }) {
  const contacts = data.settings?.contacts || [];
  const [editId, setEditId] = React.useState(null);
  const [editName, setEditName] = React.useState('');
  const [editEmail, setEditEmail] = React.useState('');
  const [addMode, setAddMode] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newEmail, setNewEmail] = React.useState('');

  function saveContacts(updated) {
    setData(d => ({...d, settings:{...d.settings, contacts: updated}}));
  }
  function startEdit(c) { setEditId(c.id); setEditName(c.name); setEditEmail(c.email||''); setAddMode(false); }
  function commitEdit() {
    const nm = editName.trim();
    if (!nm) return;
    const oldName = (contacts.find(c => c.id === editId) || {}).name;
    setData(d => {
      const settings = {...d.settings, contacts: (d.settings?.contacts||[]).map(c => c.id===editId ? {...c, name:nm, email:editEmail.trim()} : c)};
      // The owner link is by NAME (and ensureContacts re-derives contacts from task owners on load), so
      // a rename must also rewrite every task's responsibleParty — else the change shows nothing on the
      // tasks AND the old name respawns as a duplicate contact on the next load (the rename "bounces back").
      let projects = d.projects;
      if (oldName && oldName !== nm) {
        projects = {};
        Object.entries(d.projects).forEach(([pid, proj]) => {
          projects[pid] = {...proj, tasks: (proj.tasks||[]).map(t => {
            const list = ownerListOf(t);
            if (!ownerHas(list, oldName)) return t;   // B1953795 (S7) -- case-insensitive link, same as the picker / ensureContacts
            return {...t, responsibleParty: renameOwnerIn(list, oldName, nm)};
          })};
        });
      }
      return {...d, settings, projects};
    });
    setEditId(null);
  }
  function del(id) {
    const goneName = (contacts.find(c => c.id === id) || {}).name;
    setData(d => {
      const settings = {...d.settings, contacts: (d.settings?.contacts||[]).filter(c => c.id!==id)};
      // Clear the owner on tasks that referenced this contact, else ensureContacts respawns it on the
      // next load (the link is by name) and the delete silently undoes itself.
      let projects = d.projects;
      if (goneName) {
        projects = {};
        Object.entries(d.projects).forEach(([pid, proj]) => {
          projects[pid] = {...proj, tasks: (proj.tasks||[]).map(t => {
            const list = ownerListOf(t);
            if (!ownerHas(list, goneName)) return t;
            return {...t, responsibleParty: removeOwnerFrom(list, goneName)};
          })};
        });
      }
      return {...d, settings, projects};
    });
  }
  function addContact() {
    if (!newName.trim()) return;
    const id = Date.now();
    saveContacts([...contacts, {id, name:newName.trim(), email:newEmail.trim()}]);
    setNewName(''); setNewEmail(''); setAddMode(false);
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.32)'}}>
      <div style={{background:'var(--bg)',borderRadius:12,boxShadow:'0 12px 40px rgba(0,0,0,.18)',width:420,maxWidth:'94vw',maxHeight:'80vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* Header */}
        <div style={{padding:'16px 20px 12px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div>
            <div style={{fontSize:15,fontWeight:600,color:'var(--txt)'}}>Contacts</div>
            <div style={{fontSize:11,color:'var(--mut)',marginTop:2}}>{contacts.length} contact{contacts.length!==1?'s':''}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--mut)',fontSize:18,lineHeight:1,padding:'4px 6px',borderRadius:5}}
            onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'} onMouseLeave={e=>e.currentTarget.style.background='none'}>✕</button>
        </div>
        {/* List */}
        <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
          {contacts.length===0 && !addMode && (
            <div style={{padding:'24px 20px',textAlign:'center',color:'var(--mut)',fontSize:13}}>
              No contacts yet. Add one below.
            </div>
          )}
          {contacts.map(c => (
            <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 20px',transition:'background .1s'}}
              onMouseEnter={e=>e.currentTarget.style.background='#f8f9fa'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {editId===c.id ? (
                <div style={{flex:1,display:'flex',gap:6,alignItems:'center'}}>
                  <input {...contactField("name")} value={editName} onChange={e=>setEditName(e.target.value)}
                    autoFocus placeholder="Name *"
                    style={{flex:1,fontSize:12,border:'1px solid var(--blue)',borderRadius:4,padding:'4px 7px',fontFamily:'inherit',outline:'none'}}
                    onKeyDown={e=>{if(e.key==='Enter')commitEdit();if(e.key==='Escape')setEditId(null);}} />
                  <input {...contactField("email")} value={editEmail} onChange={e=>setEditEmail(e.target.value)}
                    placeholder="Email"
                    style={{flex:1,fontSize:12,border:'1px solid var(--bd2)',borderRadius:4,padding:'4px 7px',fontFamily:'inherit',outline:'none'}}
                    onFocus={e=>e.target.style.borderColor='var(--blue)'} onBlur={e=>e.target.style.borderColor='var(--bd2)'}
                    onKeyDown={e=>{if(e.key==='Enter')commitEdit();if(e.key==='Escape')setEditId(null);}} />
                  <button onClick={commitEdit} style={{fontSize:11,padding:'4px 9px',borderRadius:4,border:'1px solid var(--amber)',background:'#eef2ff',color:'var(--amber)',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>Save</button>
                  <button onClick={()=>setEditId(null)} style={{fontSize:11,padding:'4px 7px',borderRadius:4,border:'1px solid var(--bd2)',background:'none',color:'var(--mut)',cursor:'pointer',fontFamily:'inherit'}}>✕</button>
                </div>
              ) : (<>
                <div style={{width:32,height:32,borderRadius:'50%',background:avatarColor(c.name),
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:11,fontWeight:700,color:'#fff',flexShrink:0}}>{getInitials(c.name)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:'var(--txt)',fontWeight:500}}>{c.name}</div>
                  {c.email && <div style={{fontSize:11,color:'var(--mut)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.email}</div>}
                  {!c.email && <div style={{fontSize:11,color:'var(--bd2)'}}>No email</div>}
                </div>
                <button onClick={()=>startEdit(c)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--mut)',padding:'4px 6px',borderRadius:4,fontSize:11,fontFamily:'inherit'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#e8eaf0'} onMouseLeave={e=>e.currentTarget.style.background='none'}>Edit</button>
                <button onClick={()=>del(c.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#f85149',padding:'4px 6px',borderRadius:4,fontSize:16,lineHeight:1}}
                  onMouseEnter={e=>e.currentTarget.style.background='#fef2f2'} onMouseLeave={e=>e.currentTarget.style.background='none'}>×</button>
              </>)}
            </div>
          ))}
        </div>
        {/* Add contact */}
        <div style={{borderTop:'1px solid var(--bd)',padding:'12px 20px',flexShrink:0}}>
          {!addMode ? (
            <button onClick={()=>setAddMode(true)}
              style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--blue)',fontWeight:500,
                background:'none',border:'1px dashed var(--bd2)',borderRadius:6,padding:'7px 14px',cursor:'pointer',width:'100%',justifyContent:'center',fontFamily:'inherit'}}
              onMouseEnter={e=>e.currentTarget.style.borderColor='var(--blue)'} onMouseLeave={e=>e.currentTarget.style.borderColor='var(--bd2)'}>
              <span style={{fontSize:16,lineHeight:1}}>+</span> Add Contact
            </button>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div style={{display:'flex',gap:8}}>
                <input {...contactField("name")} autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
                  placeholder="Full name *" style={{flex:1,fontSize:12,border:'1px solid var(--blue)',borderRadius:5,padding:'6px 9px',fontFamily:'inherit',outline:'none'}}
                  onKeyDown={e=>{if(e.key==='Enter')addContact();if(e.key==='Escape')setAddMode(false);}} />
                <input {...contactField("email")} value={newEmail} onChange={e=>setNewEmail(e.target.value)}
                  placeholder="Email (optional)" style={{flex:1,fontSize:12,border:'1px solid var(--bd2)',borderRadius:5,padding:'6px 9px',fontFamily:'inherit',outline:'none'}}
                  onFocus={e=>e.target.style.borderColor='var(--blue)'} onBlur={e=>e.target.style.borderColor='var(--bd2)'}
                  onKeyDown={e=>{if(e.key==='Enter')addContact();if(e.key==='Escape')setAddMode(false);}} />
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={addContact} style={{flex:1,fontSize:12,padding:'7px 0',borderRadius:5,
                  border:'1px solid var(--amber)',background:'#eef2ff',color:'var(--amber)',cursor:'pointer',fontFamily:'inherit',fontWeight:500}}>
                  Add Contact
                </button>
                <button onClick={()=>{setAddMode(false);setNewName('');setNewEmail('');}}
                  style={{fontSize:12,padding:'7px 14px',borderRadius:5,border:'1px solid var(--bd2)',
                    background:'none',color:'var(--mut)',cursor:'pointer',fontFamily:'inherit'}}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── HistoryPanel — browse / preview / restore snapshots from planar_history ─
function HistoryPanel({ data, setData, onClose, exportJSON, importJSON, applyLoadedData }) {
  const [rows, setRows]           = useState(null);   // null = loading
  const [previewRow, setPreviewRow] = useState(null);
  const [previewData, setPreviewData] = useState(null); // parsed full snapshot
  const [busy, setBusy]           = useState(false);

  // Fetch list on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await window.storage.getHistory("hs-v1", 100);
      if (alive) setRows(list);
    })();
    return () => { alive = false; };
  }, []);

  const refresh = async () => {
    setRows(null);
    const list = await window.storage.getHistory("hs-v1", 100);
    setRows(list);
  };

  const fmtAgo = (iso) => {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms/1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h/24);
    return `${d}d ago`;
  };
  const fmtAbs = (iso) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };
  const fmtBytes = (n) => {
    if (n == null) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };
  const labelStyle = (label) => {
    const map = {
      "auto":              { bg: "#f3f4f6", fg: "#4b5563" },
      "pre-import":        { bg: "#fef3c7", fg: "#92400e" },
      "pre-recascade":     { bg: "#fee2e2", fg: "#991b1b" },
      "pre-delete-project":{ bg: "#fee2e2", fg: "#991b1b" },
      "pre-restore":       { bg: "#dbeafe", fg: "#1e40af" },
      "safety-block":      { bg: "#fef2f2", fg: "#7f1d1d" },
    };
    return map[label] || { bg: "#f3f4f6", fg: "#4b5563" };
  };

  const doPreview = async (row) => {
    setBusy(true);
    const valStr = await window.storage.getHistoryValue(row.id);
    setBusy(false);
    if (!valStr) { showToast("Could not load snapshot.", { type: "error" }); return; }
    try {
      const parsed = JSON.parse(valStr);
      setPreviewRow(row);
      setPreviewData(parsed);
    } catch {
      showToast("Snapshot is not valid JSON.", { type: "error" });
    }
  };

  const doDownload = async (row) => {
    const valStr = await window.storage.getHistoryValue(row.id);
    if (!valStr) { showToast("Could not load snapshot.", { type: "error" }); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([valStr], { type: "application/json" }));
    const stamp = row.created_at?.replace(/[:.]/g, "-").slice(0,19) || "snapshot";
    a.download = `planar-snapshot-${stamp}.json`;
    a.click();
  };

  const doRestore = async (row) => {
    if (!(await askConfirm({
      title: `Restore the snapshot from ${fmtAbs(row.created_at)}?`,
      body: `${row.task_count} tasks, ${row.project_count} projects.\n\nThe current state is saved as a 'pre-restore' snapshot first.`,
      confirmLabel: "Restore",
    }))) return;
    setBusy(true);
    try {
      // 1. Snapshot current state with pre-restore label
      if (data) {
        await window.storage.set("hs-v1", JSON.stringify(stripViewState(data)), { label: "pre-restore", skipSanity: true });
      }
      // 2. Fetch the snapshot value
      const valStr = await window.storage.getHistoryValue(row.id);
      if (!valStr) { showToast("Could not load snapshot.", { type: "error" }); setBusy(false); return; }
      const parsed = JSON.parse(valStr);
      // 3. Apply through the SAME normalize + cascade pipeline import/load use (B4). Applying a snapshot
      // RAW skipped B550 cycle-breaking (a parentId cycle → sortByVisualOrder infinite-recurses → white-
      // screen on render), id renumbering (B568 dup-id graph scramble), the holiday remerge, and the
      // date recascade — restore was the inconsistent twin of importJSON, which routes through it.
      if (applyLoadedData) applyLoadedData(parsed); else setData(parsed);
      showToast(`Restored snapshot from ${fmtAgo(row.created_at)}.`, { type: "success", duration: 4000 });
      onClose && onClose();
    } catch (e) {
      console.error("Restore failed:", e);
      showToast("Restore failed — see console.", { type: "error" });
    }
    setBusy(false);
  };

  return (
    <div data-testid="history-panel"
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:9000,
        display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div style={{background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:10,
        width:"min(900px,96vw)",maxHeight:"86vh",display:"flex",flexDirection:"column",overflow:"hidden"}}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          padding:"12px 18px",borderBottom:"1px solid var(--bd)",flexShrink:0}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"var(--amber)",letterSpacing:".07em",textTransform:"uppercase",lineHeight:1,marginBottom:2}}>RECOVERY</div>
            <div style={{fontSize:14,fontWeight:600,color:"var(--txt)"}}>Version History</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {exportJSON && (
              <button className="btn" onClick={exportJSON} title="Download a complete offline copy of all data as a .json file"
                style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Backup file
              </button>
            )}
            {importJSON && (
              <label className="btn" title="Replace current data from a backup .json — current state is snapshotted first"
                style={{cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:11}}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 5 17 10"/><line x1="12" y1="5" x2="12" y2="17"/></svg>
                Restore file
                <input type="file" accept=".json" onChange={e=>{importJSON(e); e.target.value="";}} style={{display:"none"}}/>
              </label>
            )}
            <div style={{width:1,height:16,background:"var(--bd)"}} />
            <button className="btn" onClick={refresh} disabled={busy} aria-busy={busy || undefined} title="Refresh">↻</button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Banner */}
        <div style={{padding:"10px 18px",fontSize:11,color:"var(--mut)",background:"#fafbfc",borderBottom:"1px solid var(--bd)",flexShrink:0}}>
          Snapshots of your data, newest first. Restore reverts to a snapshot; your current state is backed up first as <code style={{background:"#eef2ff",padding:"1px 4px",borderRadius:2,fontSize:10}}>pre-restore</code>. For an offline copy, <strong>Backup file</strong> downloads everything as .json — <strong>Restore file</strong> loads one back.
        </div>

        {/* Body */}
        <div style={{flex:1,overflow:"auto"}}>
          {rows === null ? (
            <div style={{padding:"40px 18px",textAlign:"center",color:"var(--mut)",fontSize:12,cursor:"progress"}}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{padding:"40px 18px",textAlign:"center",color:"var(--mut)",fontSize:12}}>
              <div style={{marginBottom:8,fontSize:13,color:"var(--txt)",fontWeight:500}}>No snapshots yet.</div>
              <div>If you've just enabled history, the <code>planar_history</code> table needs to be created in Supabase.<br/>See the setup SQL in the project README. Snapshots will appear here as you edit.</div>
            </div>
          ) : (
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"#fafbfc",borderBottom:"1px solid var(--bd)"}}>
                  <th style={{textAlign:"left",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>When</th>
                  <th style={{textAlign:"left",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Label</th>
                  <th style={{textAlign:"right",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Projects</th>
                  <th style={{textAlign:"right",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Tasks</th>
                  <th style={{textAlign:"right",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Size</th>
                  <th style={{textAlign:"right",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const ls = labelStyle(r.label);
                  return (
                    <tr key={r.id} style={{borderBottom:"1px solid var(--bd)"}} data-testid="history-row">
                      <td style={{padding:"8px 12px",color:"var(--txt)"}} title={fmtAbs(r.created_at)}>{fmtAgo(r.created_at)}</td>
                      <td style={{padding:"8px 12px"}}>
                        <span style={{display:"inline-block",padding:"1px 7px",borderRadius:9,fontSize:10,fontWeight:500,background:ls.bg,color:ls.fg}}>{r.label || "auto"}</span>
                      </td>
                      <td style={{padding:"8px 12px",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{r.project_count ?? "—"}</td>
                      <td style={{padding:"8px 12px",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{r.task_count ?? "—"}</td>
                      <td style={{padding:"8px 12px",textAlign:"right",fontVariantNumeric:"tabular-nums",color:"var(--mut)"}}>{fmtBytes(r.byte_size)}</td>
                      <td style={{padding:"8px 12px",textAlign:"right"}}>
                        <button className="btn" disabled={busy} aria-busy={busy || undefined} onClick={()=>doPreview(r)} style={{marginRight:4,fontSize:10,padding:"2px 7px"}}>Preview</button>
                        <button className="btn" disabled={busy} aria-busy={busy || undefined} onClick={()=>doDownload(r)} style={{marginRight:4,fontSize:10,padding:"2px 7px"}}>Download</button>
                        <button className="btn" disabled={busy} aria-busy={busy || undefined} onClick={()=>doRestore(r)}
                          style={{fontSize:10,padding:"2px 7px",borderColor:"var(--amber)",color:"var(--amber)"}}>Restore</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Preview modal */}
        {previewRow && previewData && (
          <div onClick={()=>{setPreviewRow(null);setPreviewData(null);}}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"var(--bg)",borderRadius:8,width:"min(800px,94vw)",maxHeight:"82vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"10px 16px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>Snapshot Preview</div>
                  <div style={{fontSize:10,color:"var(--mut)"}}>{fmtAbs(previewRow.created_at)} · {previewRow.label}</div>
                </div>
                <button className="btn" onClick={()=>{setPreviewRow(null);setPreviewData(null);}}>Close</button>
              </div>
              <div style={{flex:1,overflow:"auto",padding:"12px 16px"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--bd)"}}>
                      <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600,color:"var(--mut)"}}>Project</th>
                      <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600,color:"var(--mut)"}}>Tasks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(previewData.projects || {}).map(([pid, p]) => (
                      <tr key={pid} style={{borderBottom:"1px solid var(--bd)"}}>
                        {/* B1873361 — a version-history snapshot can hold two same-named schedules
                            same as the live document does, so this row names the schedule via
                            crossScheduleLabel, never the bare (possibly ambiguous) name. */}
                        <td style={{padding:"6px 8px"}}>{crossScheduleLabel(p)}</td>
                        <td style={{padding:"6px 8px",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{p.tasks?.length || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{padding:"10px 16px",borderTop:"1px solid var(--bd)",display:"flex",justifyContent:"flex-end",gap:8}}>
                <button className="btn" onClick={()=>doDownload(previewRow)}>Download JSON</button>
                <button className="btn"
                  style={{borderColor:"var(--amber)",color:"var(--amber)"}}
                  onClick={()=>{ const r = previewRow; setPreviewRow(null); setPreviewData(null); doRestore(r); }}>
                  Restore This Snapshot
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ErrorBoundary ─────────────────────────────────────────
// Catches render errors in Gantt/Split view and shows a recovery UI
// instead of a white screen. Without this, any uncaught error in a
// child component tears down the entire React tree.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("[planar] View render error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          gap:12,background:"var(--bg)",padding:32}}>
          <span style={{fontSize:22}}>⚠️</span>
          <span style={{fontSize:14,fontWeight:600,color:"var(--txt)"}}>This view failed to load</span>
          <span style={{fontSize:12,color:"var(--mut)",maxWidth:360,textAlign:"center"}}>
            {String(this.state.error?.message || this.state.error || "Unknown render error")}
          </span>
          <button className="btn" style={{marginTop:8}} onClick={() => this.setState({hasError:false, error:null})}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Suggestions queue (email → AI suggestion → approve/dismiss) ───
const SGQ_HEALTH = {
  gray:  {label:"Not Started", dot:"#ffffff", bd:"1.5px solid #d1d5db"},
  yellow:{label:"In Progress", dot:"#c47b00", bd:"none"},
  red:   {label:"Needs Attn.", dot:"#dc2626", bd:"none"},
  green: {label:"Complete",    dot:"#16a34a", bd:"none"},
  paused:{label:"Paused",      dot:"#9ca3af", bd:"none"},
};
const SGQ_HKEYS = ["gray","yellow","red","green","paused"];
const SGQ_AV = ["#4f46e5","#0969da","#16a34a","#c47b00","#9333ea","#0891b2","#dc2626"];
const SGQ_ALLOWED_PATCH = new Set(["health","duration","end","percentComplete","responsibleParty","predecessors"]);
const SGQ_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function sgqAvatarColor(name) {
  let h = 0; for (const c of String(name||"")) h = (h*31 + c.charCodeAt(0)) >>> 0;
  return SGQ_AV[h % SGQ_AV.length];
}
function sgqInitials(name) {
  const parts = String(name||"").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}
function sgqConfClass(c) { const n = Number(c||0); return n >= 0.8 ? "hi" : n >= 0.5 ? "mid" : "lo"; }
function sgqFmtDate(s) {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return SGQ_MONTHS[+m[2] - 1] + " " + (+m[3]);
}
function SgqDot({h}) {
  const m = SGQ_HEALTH[h] || SGQ_HEALTH.gray;
  return <span className="sgq-dot" style={{background: m.dot, border: m.bd !== "none" ? m.bd : "none"}}/>;
}

function sgqChildrenOf(data, pid, parentId) {
  const proj = data && data.projects && data.projects[pid];
  if (!proj) return [];
  return proj.tasks.filter(t => parentId == null ? (t.parentId == null) : (t.parentId === parentId));
}

function sgqCrumbOf(data, pid, path) {
  if (pid == null || !Array.isArray(path) || path.length === 0) return null;
  const proj = data && data.projects && data.projects[pid];
  if (!proj) return null;
  const byId = new Map(proj.tasks.map(t => [t.id, t]));
  const names = path.map(id => byId.get(id) && byId.get(id).name).filter(Boolean);
  if (names.length === 0) return null;
  // B1873361 — this can name a task on ANY schedule on the account (a review suggestion can
  // match to a different project entirely), so the crumb's project half is the qualified label,
  // never the bare schedule name.
  return { project: crossScheduleLabel(proj), names };
}

function SgqCrumb({data, pid, path}) {
  const c = sgqCrumbOf(data, pid, path);
  if (!c) return <span style={{color:"#c47b00", fontWeight:600}}>No task selected</span>;
  return (
    <span className="sgq-crumbline">
      {c.project}
      {c.names.map((nm, i) => (
        <React.Fragment key={i}>
          <span className="sgq-arrow">▸</span>{nm}
        </React.Fragment>
      ))}
    </span>
  );
}

/* Cascade picker — row of selects: Project ▸ Phase ▸ … ▸ Task */
function SgqCascadePicker({data, pid, path, ready, onChange}) {
  const projects = (data && data.projects) ? Object.entries(data.projects) : [];
  const selects = [];
  if (pid != null && data && data.projects && data.projects[pid]) {
    let nodes = sgqChildrenOf(data, pid, null);
    let k = 0;
    /* eslint-disable no-constant-condition */
    while (true) {
      const val = path && path[k] != null ? path[k] : null;
      selects.push({ k, nodes, val });
      if (val == null) break;
      const kids = sgqChildrenOf(data, pid, val);
      if (kids.length === 0) break;
      nodes = kids;
      k++;
    }
  }
  return (
    <div className={"sgq-target" + (ready ? "" : " warnrow")}>
      <i className={ready ? "ti ti-map-pin" : "ti ti-help-circle"}/>
      {!ready && pid == null && <span className="sgq-needpick">Pick the task:</span>}
      <select className="sgq-sel"
        value={pid == null ? "" : pid}
        onChange={e => onChange(e.target.value === "" ? null : +e.target.value, [])}>
        <option value="" disabled>Project…</option>
        {/* B1873361 — every schedule on the account, so the qualified label (never a bare,
            possibly-duplicate schedule name) is what tells two "Master Schedule"s apart here. */}
        {projects.map(([k, p]) => <option key={k} value={k}>{crossScheduleLabel(p)}</option>)}
      </select>
      {selects.map(sel => (
        <React.Fragment key={sel.k}>
          <span className="sgq-arrow">▸</span>
          <select className="sgq-sel"
            value={sel.val == null ? "" : sel.val}
            onChange={e => {
              const v = e.target.value === "" ? null : +e.target.value;
              const np = (path || []).slice(0, sel.k);
              if (v != null) np.push(v);
              onChange(pid, np);
            }}>
            <option value="">{sel.k === 0 ? "Phase…" : "↳ refine (optional)"}</option>
            {sel.nodes.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </React.Fragment>
      ))}
    </div>
  );
}

function SgqChangeRow({field, fromVal, toVal, onEditTo, onRemove}) {
  if (field === "health") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">Status</span>
        <span className="sgq-fromval"><SgqDot h={fromVal}/>{(SGQ_HEALTH[fromVal] && SGQ_HEALTH[fromVal].label) || fromVal || "—"}</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <span className="sgq-statuslabel">
          <SgqDot h={toVal}/>
          <select className="sgq-sel" value={toVal || "gray"} onChange={e => onEditTo(e.target.value)}>
            {SGQ_HKEYS.map(k => <option key={k} value={k}>{SGQ_HEALTH[k].label}</option>)}
          </select>
        </span>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Don't apply this change" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  if (field === "percentComplete") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">% Complete</span>
        <span className="sgq-fromval">{fromVal != null ? fromVal : 0}%</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <input className="sgq-miniinput" type="number" min="0" max="100"
          value={toVal != null ? toVal : 0}
          onChange={e => onEditTo(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}/>
        <span style={{color:"#8b949e"}}>%</span>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Don't apply this change" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  if (field === "duration") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">Duration</span>
        <span className="sgq-fromval">{fromVal != null ? fromVal : 0}d</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <input className="sgq-miniinput" type="number" min="0"
          value={toVal != null ? toVal : 0}
          onChange={e => onEditTo(Math.max(0, parseInt(e.target.value, 10) || 0))}/>
        <span style={{color:"#8b949e"}}>d</span>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Don't apply this change" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  if (field === "responsibleParty") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">Owner</span>
        <span className="sgq-fromval">{fromVal || "—"}</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <input {...NO_AUTOFILL} className="sgq-miniinput" type="text" style={{minWidth:140}}
          value={toVal || ""}
          onChange={e => onEditTo(e.target.value)}/>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Don't apply this change" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  if (field === "end") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">End date</span>
        <span className="sgq-fromval">{fromVal || "—"}</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <input className="sgq-miniinput" type="date"
          value={toVal || ""}
          onChange={e => onEditTo(e.target.value)}/>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Reset — don't change end date" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  return null;
}

function InlineDate({value, onCommit}) {
  // B502: keep the YEAR (M/D/YY via toShortDate) — the old month/day-only display made
  // parseFlexDate default the year to the current year on commit, silently rewriting a
  // past/future-year date just by opening + blurring the field.
  const disp = value ? toShortDate(value) : "";
  const [txt, setTxt] = useState(disp);
  useEffect(() => { setTxt(disp); }, [disp]);
  const commit = () => { const isoV = parseFlexDate(txt); if (isoV) onCommit(isoV); else setTxt(disp); };
  return <input {...NO_AUTOFILL} className="rev-edit rev-date-edit" value={txt} placeholder="—"
    onChange={e => setTxt(e.target.value)}
    onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { setTxt(disp); e.currentTarget.blur(); } }}/>;
}

// Strip forwarded-email noise: URL-defense link wrappers, external-sender banners,
// and the quoted reply thread (returned separately so the UI can hide it behind a toggle).
function cleanEmailBody(raw) {
  if (!raw) return { body: "", quoted: "", hasQuoted: false };
  let text = String(raw).replace(/\r\n/g, "\n");

  // unwrap Outlook/Proofpoint plain-text links: "display<https://…>" / "name<mailto:…>" → "display"
  text = text.replace(/\s*<\s*https?:\/\/urldefense\.proofpoint\.com[^\n]*$/gim, "");
  text = text.replace(/\s*<\s*(?:https?:\/\/|mailto:)[^>\n]*>/gi, "");

  // drop a leading external-sender banner line if present
  text = text.replace(/^[ \t]*\[?\s*EXTERNAL[^\n]*\]?\s*\n?/gim, "");

  // split off the quoted reply thread at the first quote header
  const lines = text.split("\n");
  const quoteRe = /^\s*(?:-{3,}\s*Original Message\s*-{3,}|_{5,}|From:\s.+|On\b.+\bwrote:\s*)$/i;
  let cut = -1;
  for (let i = 0; i < lines.length; i++) { if (quoteRe.test(lines[i])) { cut = i; break; } }
  const head = cut >= 0 ? lines.slice(0, cut) : lines;
  const quoted = cut >= 0 ? lines.slice(cut) : [];

  const tidy = a => a.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const qtext = tidy(quoted);
  return { body: tidy(head), quoted: qtext, hasQuoted: qtext.length > 0 };
}

function SuggestionsView({data, updateTask, setData, rows, setRows, loading, onClose, gridProps, activeIdx, setActiveIdx}) {
  const [edits, setEdits] = useState({});
  const [view, setView] = useState("grid");
  const [split, setSplit] = useState(50);
  const [toast, setToast] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const bodyRef = useRef(null), targetRef = useRef(null), canvasRef = useRef(null);
  const toastTimer = useRef(null), undoRef = useRef(null);
  const [mailReaderOpen, setMailReaderOpen] = useState(false);
  const [mailOverflow, setMailOverflow] = useState(false);
  const mailBodyRef = useRef(null);

  // Pending suggestions are fetched + subscribed in App and passed in via props (rows / setRows / loading).

  useEffect(() => { setActiveIdx(i => Math.max(0, Math.min(i, rows.length - 1))); }, [rows.length]);
  useEffect(() => { setShowPicker(false); setShowQuoted(false); setMailReaderOpen(false); }, [activeIdx]);
  React.useLayoutEffect(() => {
    const measure = () => { const el = mailBodyRef.current; setMailOverflow(!!el && el.scrollHeight > el.clientHeight + 2); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeIdx]);

  const rfmt = s => { if (!s) return ""; const p = s.split('-'); return (+p[1]) + "/" + (+p[2]); };
  const rfmtIso = s => { if (!s) return ""; const p = s.split('-'); return (+p[1]) + "/" + (+p[2]) + "/" + String(p[0]).slice(2); };

  const getEff = (row) => {
    const e = edits[row.id] || {};
    return {
      project_id: ('project_id' in e) ? e.project_id : row.project_id,
      task_path:  ('task_path'  in e) ? e.task_path  : (row.task_path  || []),
      note_text:  ('note_text'  in e) ? e.note_text  : (row.note_text  || ''),
      patch:      ('patch'      in e) ? e.patch      : (row.patch      || {}),
    };
  };
  const patchRow = (id, p) => setEdits(E => ({ ...E, [id]: { ...(E[id] || {}), ...p } }));
  const setPatchField = (id, field, val) => setEdits(E => {
    const row = rows.find(r => r.id === id);
    const cur = (E[id] && E[id].patch) || (row && row.patch) || {};
    return { ...E, [id]: { ...(E[id] || {}), patch: { ...cur, [field]: val } } };
  });

  const cleanPatchFor = (patch, target) => {
    const out = {};
    Object.keys(patch || {}).forEach(k => {
      if (!SGQ_ALLOWED_PATCH.has(k)) return;
      const v = patch[k];
      if (v === undefined || v === null || v === "") return;
      // "unchanged?" check: structural-compare objects/arrays (a `predecessors` array of {id,type,lag}
      // objects all stringify to "[object Object]" via String(), so a real dependency change was silently
      // dropped); keep the cheap String() compare for primitives.
      const same = (x, y) => ((x && typeof x === "object") || (y && typeof y === "object"))
        ? JSON.stringify(x) === JSON.stringify(y) : String(x) === String(y);
      if (target && same(target[k], v)) return;
      out[k] = v;
    });
    return out;
  };
  const previewProject = (tasks, tId, patchIn) => {
    // NEW-1 — the SAME forward-to-a-real-meeting gate updateTask applies, so the preview never lies.
    const boundEdit = resolveBoundEdit(tasks, tId, patchIn, id => MEETING_BODY_INDEX[id]);
    const patch = boundEdit.updates;
    let ts = tasks.map(t => {
      if (t.id !== tId) return t;
      const u = { ...t, ...patch, ...completionDelta(t, patch) };
      // Editing a predecessor clears any manual pin so the cascade controls the start — mirror updateTask
      // here, else the preview cascades a PINNED task in place while the real apply moves it (the preview lies).
      if ('predecessors' in patch) delete u.pinnedStart;
      if ('duration' in patch && !('durValue' in patch) && !('durUnit' in patch)) { u.durUnit = 'd'; u.durValue = Math.max(0, Math.trunc(Number(patch.duration) || 0)); }
      if (('durValue' in patch) || ('durUnit' in patch)) { u.durUnit = u.durUnit || 'd'; if (u.durValue == null) u.durValue = 0; }
      const durEdited = ('duration' in patch) || ('durValue' in patch) || ('durUnit' in patch);
      if ((durEdited || ('start' in patch)) && !('end' in patch)) {
        if (!(u.pinnedEnd && u.end)) { const r = resolveDuration(u.start, taskDurValue(u), taskDurUnit(u)); u.end = r.end; u.duration = r.duration; }
      }
      else if ('end' in patch && !('start' in patch)) {
        if (u.end && !u.start) { u.start = u.end; u.durUnit = 'd'; u.durValue = 1; u.duration = 1; }
        else { u.duration = (u.start && u.end) ? Math.max(0, difBD(u.start, u.end) + 1) : ""; u.durUnit = 'd'; u.durValue = (typeof u.duration === 'number' ? u.duration : 0); }
        u.pinnedEnd = !!u.end;
      }
      if ('start' in patch) u.pinnedStart = true;
      if (boundEdit.startOverride) { u.start = boundEdit.startOverride; u.end = boundEdit.startOverride; }
      return u;
    });
    if ('health' in patch) {
      const desc = (id, all) => { const k = all.filter(t => t.parentId === id); return [...k.map(x => x.id), ...k.flatMap(x => desc(x.id, all))]; };
      const ids = new Set(desc(tId, ts));
      if (ids.size) { ts = ts.map(t => ids.has(t.id) ? { ...t, health: patch.health, ...cascadeDelta(t, patch.health) } : t); }
    }
    if ('duration' in patch || 'start' in patch || 'end' in patch || 'predecessors' in patch || 'meetingBound' in patch || 'meetingBodyId' in patch || 'pinnedMeetingDate' in patch || 'minMeetingsAfter' in patch) {
      ts = recomputeSchedule(ts);
    }
    return ts;
  };

  const active = rows[activeIdx] || null;
  const isCreate = !!(active && (active.kind === 'create_task' || (active.patch && active.patch.kind === 'create_task')));
  const eff = active ? getEff(active) : null;
  const pid = eff ? eff.project_id : null;
  const proj = (pid != null && data && data.projects) ? data.projects[pid] : null;
  const rawTargetId = (eff && eff.task_path && eff.task_path.length) ? eff.task_path[eff.task_path.length - 1] : null;
  const target = (proj && rawTargetId != null)
    ? (proj.tasks.find(t => String(t.id) === String(rawTargetId)) || proj.tasks.find(t => t.name === rawTargetId) || null)
    : null;
  const targetId = target ? target.id : null;   // resolved numeric id — used for injection/matching
  const matched = !isCreate && !!(proj && target);   // create mode runs a separate path below

  // Resolve an "add dependency" instruction (add_predecessors: [taskId|taskName, ...]) into a
  // concrete predecessors array, merged with whatever the target already depends on.
  const resolveTaskRef = (ref) => {
    if (ref == null || !proj) return null;
    return proj.tasks.find(t => String(t.id) === String(ref)) || proj.tasks.find(t => t.name === ref) || null;
  };
  let addedPredTasks = [];
  let cleanPatch = (matched && eff) ? cleanPatchFor(eff.patch, target) : {};
  if (matched && eff && eff.patch && Array.isArray(eff.patch.add_predecessors) && eff.patch.add_predecessors.length) {
    const existing = Array.isArray(target.predecessors) ? target.predecessors : [];
    const existingIds = new Set(existing.map(p => (p && typeof p === 'object') ? p.id : p));
    const additions = [];
    eff.patch.add_predecessors.forEach(ref => {
      const t = resolveTaskRef(ref);
      if (!t || t.id === targetId || existingIds.has(t.id)) return;
      additions.push({ id: t.id, type: 'FS', lag: 0 });
      addedPredTasks.push(t);
      existingIds.add(t.id);
    });
    if (additions.length) cleanPatch = { ...cleanPatch, predecessors: [...existing, ...additions] };
  }
  const previewTasks = matched ? previewProject(proj.tasks, targetId, cleanPatch) : [];
  const propById = {}; previewTasks.forEach(t => { propById[t.id] = t; });
  const propTarget = matched ? propById[targetId] : null;

  const moversList = [];
  if (matched) proj.tasks.forEach(t => {
    if (t.id === targetId) return;
    const p = propById[t.id]; if (!p) return;
    if (p.start !== t.start || p.end !== t.end) moversList.push({ id: t.id, newStart: p.start, newEnd: p.end, dStart: difBD(t.start, p.start), dEnd: difBD(t.end, p.end) });
  });
  const moverMap = {}; moversList.forEach(m => { moverMap[m.id] = m; });
  const maxDelta = moversList.reduce((a, m) => Math.max(a, m.dEnd), 0);
  // NEW-1 — the SAME conflict check updateTask runs (pinConflictsOf/newPinConflicts), so the preview of an approval
  // never disagrees with the apply: a typed date that would be earlier than its predecessor allows is called out BEFORE approving.
  const previewConflictMsg = matched ? pinConflictNotice(newPinConflicts(proj.tasks, previewTasks, (cleanPatch && (cleanPatch.start || cleanPatch.end)) ? [targetId] : []), (cleanPatch && (cleanPatch.start || cleanPatch.end)) ? targetId : null, rfmtIso) : "";

  const sugByTask = {};
  rows.forEach((r, i) => { const e = getEff(r); if (e.project_id === pid && e.task_path && e.task_path.length) { const tid = e.task_path[e.task_path.length - 1]; if (!(tid in sugByTask)) sugByTask[tid] = i; } });

  const propStatus = propTarget ? propTarget.health : (target ? target.health : 'gray');
  const propEnd = propTarget ? propTarget.end : (target ? target.end : '');
  // NEW-1 — Owner is a list now; the automation review panel still edits it as ONE proposed value
  // (approving a suggestion REPLACES the whole owner list with whatever is typed here) — shown
  // joined so an existing multi-owner task isn't misleadingly displayed as having just one.
  const propOwner = ownerJoin(propTarget ? ownerListOf(propTarget) : (target ? ownerListOf(target) : []));
  const endChanged = target && propEnd && propEnd !== target.end;
  const endDelta = endChanged ? difBD(target.end, propEnd) : 0;
  const startChanged = target && propTarget && propTarget.start !== target.start;
  const noteText = eff ? eff.note_text : '';

  // --- New-task suggestions (kind: 'create_task'): task_path points at the PARENT, patch.name is the new task ---
  const createReady = isCreate && !!proj && !!(eff && eff.patch && typeof eff.patch.name === 'string' && eff.patch.name.trim());
  let newTask = null, newTaskAddNames = [];
  if (createReady) {
    const parent = target; // in create mode, task_path's last element resolves here to the parent
    const preds = [];
    if (Array.isArray(eff.patch.add_predecessors)) eff.patch.add_predecessors.forEach(ref => {
      const t = resolveTaskRef(ref); if (t) { preds.push({ id: t.id, type: 'FS', lag: 0 }); newTaskAddNames.push(t.name); }
    });
    const newId = proj.tasks.reduce((m, t) => Math.max(m, +t.id || 0), 0) + 1;
    const fallbackStart = eff.patch.start || (parent ? parent.start : (proj.tasks[0] ? proj.tasks[0].start : new Date().toISOString().slice(0, 10)));
    let dur = (eff.patch.duration != null && eff.patch.duration !== '') ? eff.patch.duration : 1;
    if (eff.patch.end && (eff.patch.duration == null || eff.patch.duration === '')) {
      dur = (fallbackStart && eff.patch.end) ? Math.max(0, difBD(fallbackStart, eff.patch.end) + 1) : dur;
    }
    let prov = { id: newId, name: eff.patch.name.trim(), start: fallbackStart, end: '', duration: dur, durUnit: 'd', durValue: dur, predecessors: preds, health: eff.patch.health || 'gray', percentComplete: 0, parentId: parent ? parent.id : null, responsibleParty: eff.patch.responsibleParty || '', notes: [], isExpanded: true };
    prov.end = calcEnd(prov.start, prov.duration);
    let sim = recomputeSchedule([...proj.tasks, prov]);
    const c = sim.find(t => t.id === newId) || prov;
    newTask = { ...prov, start: c.start, end: c.end, duration: c.duration };
  }

  const flash = (msg) => { setToast({ msg }); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 6500); };

  const createTask = async () => {
    if (!createReady || !newTask) return;
    const row = active;
    undoRef.current = { kind: 'approve', pid, tasks: JSON.parse(JSON.stringify(proj.tasks)), row, idx: activeIdx };
    const dateMatch = row.email_date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.email_date);
    const ymd = dateMatch ? row.email_date : new Date().toISOString().slice(0, 10);
    const noteArr = (noteText && String(noteText).trim()) ? [{ id: Date.now(), date: ymd, text: String(noteText).trim() }] : [];
    setData(d => {
      if (!d.projects || !d.projects[pid]) return d;
      const p = d.projects[pid];
      const tasks = p.tasks.slice();
      const newId = tasks.reduce((m, t) => Math.max(m, +t.id || 0), 0) + 1;
      const t = { id: newId, name: newTask.name, start: newTask.start, end: newTask.end, duration: newTask.duration, predecessors: newTask.predecessors, health: newTask.health, percentComplete: 0, parentId: newTask.parentId, responsibleParty: newTask.responsibleParty ? [newTask.responsibleParty] : [], notes: noteArr, isExpanded: true };
      let insertIdx = tasks.length;
      if (newTask.parentId != null) {
        // Prefer right after the predecessor it depends on, when that predecessor is a sibling under
        // the same parent (so the task follows what must finish first) — matches the review preview.
        const predIds = new Set((newTask.predecessors || []).map(pp => pp.id));
        let afterPred = -1;
        tasks.forEach((x, i) => { if (predIds.has(x.id) && x.parentId === newTask.parentId) afterPred = i; });
        if (afterPred >= 0) {
          insertIdx = afterPred + 1;
        } else {
          const desc = new Set([newTask.parentId]);
          let changed = true; while (changed) { changed = false; tasks.forEach(x => { if (x.parentId != null && desc.has(x.parentId) && !desc.has(x.id)) { desc.add(x.id); changed = true; } }); }
          let last = -1; tasks.forEach((x, i) => { if (desc.has(x.id)) last = i; });
          if (last >= 0) insertIdx = last + 1;
        }
      }
      tasks.splice(insertIdx, 0, t);
      const recomputed = recomputeSchedule(tasks);
      return { ...d, projects: { ...d.projects, [pid]: { ...p, tasks: recomputed } } };
    });
    const sb = window.__sb;
    if (sb) { try { await sb.from('planar_suggestions').update({ status: 'approved' }).eq('id', row.id); } catch (e) { console.warn("mark approved failed:", e); } }
    setRows(R => R.filter(r => r.id !== row.id));
    setEdits(E => { const c = { ...E }; delete c[row.id]; return c; });
    flash("Task created · " + newTask.name);
  };

  const approve = async () => {
    if (isCreate) { return createTask(); }
    if (!active || !matched) return;
    const row = active, p = cleanPatch;
    const dateMatch = row.email_date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.email_date);
    const ymd = dateMatch ? row.email_date : new Date().toISOString().slice(0, 10);
    // Only attach a note when the reviewer actually typed one (matches createTask's guard) — an
    // unconditional append left a blank note on the task, inflating its notes badge/count.
    const noteTxt = String(noteText || "").trim();
    const existingNotes = Array.isArray(target.notes) ? target.notes : [];
    const merged = noteTxt
      ? { ...p, notes: [...existingNotes, { id: Date.now(), date: ymd, text: noteTxt }] }
      : { ...p };
    // NEW-1 — a suggested Owner is edited here as ONE proposed value (see propOwner above), but the
    // real task's field is a LIST — wrap it, or approving a suggestion would overwrite the array
    // with a bare string. Approving REPLACES the whole owner list, same as any other approved field.
    if ('responsibleParty' in merged) merged.responsibleParty = merged.responsibleParty ? [merged.responsibleParty] : [];
    undoRef.current = { kind: 'approve', pid, tasks: JSON.parse(JSON.stringify(proj.tasks)), row, idx: activeIdx };
    try { updateTask(targetId, merged, pid); }
    catch (e) { console.error("updateTask failed:", e); return; }
    const sb = window.__sb;
    if (sb) { try { await sb.from('planar_suggestions').update({ status: 'approved' }).eq('id', row.id); } catch (e) { console.warn("mark approved failed:", e); } }
    setRows(R => R.filter(r => r.id !== row.id));
    setEdits(E => { const c = { ...E }; delete c[row.id]; return c; });
    flash("Approved · " + (row.email_subject || "update"));
  };

  const dismiss = async () => {
    if (!active) return;
    const row = active;
    undoRef.current = { kind: 'dismiss', row, idx: activeIdx };
    const sb = window.__sb;
    if (sb) { try { await sb.from('planar_suggestions').update({ status: 'dismissed' }).eq('id', row.id); } catch (e) { console.warn("mark dismissed failed:", e); } }
    setRows(R => R.filter(r => r.id !== row.id));
    setEdits(E => { const c = { ...E }; delete c[row.id]; return c; });
    flash("Dismissed · " + (row.email_subject || "update"));
  };

  const doUndo = async () => {
    const snap = undoRef.current; if (!snap) return;
    undoRef.current = null; setToast(null);
    if (snap.kind === 'approve' && setData) {
      setData(d => (d.projects && d.projects[snap.pid]) ? { ...d, projects: { ...d.projects, [snap.pid]: { ...d.projects[snap.pid], tasks: snap.tasks } } } : d);
    }
    setRows(R => R.some(r => r.id === snap.row.id) ? R : [snap.row, ...R]);
    setActiveIdx(0);
    const sb = window.__sb;
    if (sb) { try { await sb.from('planar_suggestions').update({ status: 'pending' }).eq('id', snap.row.id); } catch (e) {} }
  };

  const prev = () => setActiveIdx(i => Math.max(0, i - 1));
  const next = () => setActiveIdx(i => Math.min(rows.length - 1, i + 1));

  useEffect(() => {
    const h = (e) => {
      const t = e.target;
      if (mailReaderOpen) { if (e.key === 'Escape') { e.preventDefault(); setMailReaderOpen(false); } return; }
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (k === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (k === 'a' || e.key === 'Enter') { if (active && (matched || createReady)) { e.preventDefault(); approve(); } }
      else if (k === 'x' || e.key === 'Backspace' || e.key === 'Delete') { if (active) { e.preventDefault(); dismiss(); } }
      else if (k === 'g') { e.preventDefault(); setView(v => v === 'grid' ? 'gantt' : 'grid'); }
      else if (k === 'u') { e.preventDefault(); doUndo(); }
      else if (e.key === 'Escape') { if (onClose) { e.preventDefault(); onClose(); } }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  useEffect(() => {
    if (!matched) return;
    const id = setTimeout(() => {
      if (view === 'grid' && targetRef.current) targetRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (view === 'gantt' && canvasRef.current && targetRef.current) {
        const bar = targetRef.current.querySelector('.rev-bar,.rev-amber,.rev-ghost');
        if (bar) canvasRef.current.scrollTo({ left: Math.max(0, bar.offsetLeft - 120), behavior: 'smooth' });
      }
    }, 60);
    return () => clearTimeout(id);
  }, [activeIdx, view, matched, targetId]);

  // Keep the real grid's selection on the targeted task, so it highlights + scrolls into view as you step the queue.
  useEffect(() => {
    if (!(matched && gridProps && gridProps.setSelectedId && targetId != null)) return;
    const id = setTimeout(() => gridProps.setSelectedId(targetId), 60);
    return () => clearTimeout(id);
  }, [targetId, matched]);

  const onDivDown = (e) => {
    e.preventDefault();
    const sy = e.clientY, sp = split, H = bodyRef.current.getBoundingClientRect().height;
    const mv = (ev) => { let p = sp + ((ev.clientY - sy) / H) * 100; p = Math.max(28, Math.min(76, p)); setSplit(p); };
    const release = window.pinSchedCursor("row-resize", { onExit: () => up() });
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); release(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  };

  const visualTasks = proj ? sortByVisualOrder(proj.tasks) : [];
  const byId = {}; (proj ? proj.tasks : []).forEach(t => byId[t.id] = t);
  const depthOf = (t) => { let d = 0, p = t.parentId; while (p != null && byId[p]) { d++; p = byId[p].parentId; } return d; };

  const renderStatus = (h) => {
    const m = HEALTH[h] || HEALTH.gray;
    return <span className="revstatus"><span className="revdot" style={{ background: m.dot, border: m.border }}/>{m.label}</span>;
  };

  const renderGrid = () => {
    if (!proj) return <div className="rev-hint">Pick a task in the panel below to preview this update against the plan.</div>;
    return (
      <div className="rev-grid">
        <div className="rev-ghead">
          <div className="rev-cell">Task</div><div className="rev-cell">Start</div><div className="rev-cell">End</div>
          <div className="rev-cell">Status</div><div className="rev-cell">Owner</div><div className="rev-cell"/>
        </div>
        {visualTasks.map(t => {
          const isTgt = matched && t.id === targetId;
          const mv = moverMap[t.id];
          const hasSug = (t.id in sugByTask) && !isTgt;
          const ss = mv ? { start: mv.newStart, end: mv.newEnd } : { start: t.start, end: t.end };
          return (
            <React.Fragment key={t.id}>
              <div ref={isTgt ? targetRef : null}
                   className={"rev-row" + (isTgt ? " tgt" : "") + (mv ? " mv" : "") + (hasSug ? " pick" : "")}
                   onClick={hasSug ? () => setActiveIdx(sugByTask[t.id]) : undefined}>
                <div className="rev-cell rev-name" style={{ paddingLeft: (12 + depthOf(t) * 15) + "px" }}>
                  {hasSug ? <span className="rev-sugdot" title="Pending update"/> : null}
                  <span className="nm">{t.name || "(untitled)"}</span>
                </div>
                <div className="rev-cell rev-date">{rfmt(ss.start)}{mv ? <span className="rev-delta">{mv.dStart >= 0 ? "+" : ""}{mv.dStart}d</span> : null}</div>
                <div className="rev-cell rev-date">{rfmt(ss.end)}{mv ? <span className="rev-delta">{mv.dEnd >= 0 ? "+" : ""}{mv.dEnd}d</span> : null}</div>
                <div className="rev-cell">{renderStatus(t.health)}</div>
                <div className="rev-cell rev-owner"><span className="nm">{ownerJoin(ownerListOf(t))}</span></div>
                <div className="rev-cell"/>
              </div>
              {isTgt ? (
                <div className="rev-sub">
                  <div className="rev-cell rev-prop" style={{ paddingLeft: (12 + depthOf(t) * 15) + "px" }}>
                    <i className="ti ti-corner-down-right"/>proposed
                  </div>
                  <div className="rev-cell rev-date faint">{startChanged ? rfmt(propTarget.start) : ""}</div>
                  <div className="rev-cell rev-endcell">
                    <InlineDate value={propEnd} onCommit={(isoV) => setPatchField(active.id, 'end', isoV)} />
                    {endChanged ? <span className="rev-delta">{endDelta >= 0 ? "+" : ""}{endDelta}d</span> : null}
                  </div>
                  <div className="rev-cell">
                    <select className="rev-sel" value={propStatus} onChange={e => setPatchField(active.id, 'health', e.target.value)}>
                      {HK.map(k => <option key={k} value={k}>{(HEALTH[k] && HEALTH[k].label) || k}</option>)}
                    </select>
                  </div>
                  <div className="rev-cell">
                    <input {...NO_AUTOFILL} className="rev-edit" value={propOwner} placeholder="—"
                      onChange={e => setPatchField(active.id, 'responsibleParty', e.target.value)} />
                  </div>
                  <div className="rev-cell rev-actcell">
                    <button className="rev-iconbtn ok" title="Approve (A)" onClick={approve}><i className="ti ti-check"/></button>
                    <button className="rev-iconbtn no" title="Dismiss (X)" onClick={dismiss}><i className="ti ti-x"/></button>
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const renderGantt = () => {
    if (!proj) return <div className="rev-hint">Pick a task in the panel below to preview this update on the timeline.</div>;
    const PPD = 13, ROWH = 30, HEAD = 40, DAY = 86400000;
    let lo = null, hi = null;
    const pushd = s => { if (!s) return; const d = pd(s); if (!lo || d < lo) lo = d; if (!hi || d > hi) hi = d; };
    visualTasks.forEach(t => { pushd(t.start); pushd(t.end); const p = propById[t.id]; if (p) { pushd(p.start); pushd(p.end); } });
    if (!lo || !hi) return <div className="rev-hint">No dated tasks to show yet.</div>;
    lo = new Date(lo.getTime() - 3 * DAY); hi = new Date(hi.getTime() + 4 * DAY);
    const days = Math.round((hi - lo) / DAY) + 1;
    const width = days * PPD;
    const xOf = s => Math.round((pd(s) - lo) / DAY) * PPD;
    const wOf = (s, e) => (Math.round((pd(e) - pd(s)) / DAY) + 1) * PPD;
    const weekends = [], wk = [], months = [];
    for (let i = 0; i < days; i++) { const d = new Date(lo.getTime() + i * DAY); const g = d.getDay(); if (g === 0 || g === 6) weekends.push(i); if (g === 1) wk.push(i); if (d.getDate() === 1 || i === 0) months.push({ i, label: SGQ_MONTHS[d.getMonth()] + " " + String(d.getFullYear()).slice(2) }); }
    return (
      <div className="rev-gantt">
        <div className="rev-glabels">
          <div className="rev-glabhd">Task</div>
          {visualTasks.map(t => { const isTgt = matched && t.id === targetId; const mv = moverMap[t.id]; const m = HEALTH[t.health] || HEALTH.gray;
            return <div key={t.id} className={"rev-glab" + (isTgt ? " tgt" : "") + (mv ? " mv" : "")} style={{ paddingLeft: (12 + depthOf(t) * 12) + "px" }}>
              <span className="revdot" style={{ background: m.dot, border: m.border }}/><span className="nm">{t.name || "(untitled)"}</span></div>; })}
        </div>
        <div className="rev-gcanvas" ref={canvasRef}>
          <div style={{ position: "relative", width: width + "px" }}>
            <div className="rev-axis">{months.map((m, k) => <div key={k} className="rev-month" style={{ left: (m.i * PPD) + "px" }}>{m.label}</div>)}</div>
            {weekends.map(i => <div key={'w'+i} className="rev-weekend" style={{ left: (i*PPD)+"px", width: PPD+"px", top: HEAD+"px" }}/>)}
            {wk.map(i => <div key={'l'+i} className="rev-wk" style={{ left: (i*PPD)+"px", top: HEAD+"px" }}/>)}
            {visualTasks.map((t, ri) => {
              const isTgt = matched && t.id === targetId; const mv = moverMap[t.id];
              const top = HEAD + ri * ROWH; const m = HEALTH[t.health] || HEALTH.gray;
              const p = propById[t.id];
              const changed = (isTgt && propTarget && (propTarget.end !== t.end || propTarget.start !== t.start)) || !!mv;
              return (
                <div key={t.id} className={"rev-grow" + (isTgt ? " tgt" : "") + (mv ? " mv" : "")} style={{ top: top + "px" }} ref={isTgt ? targetRef : null}>
                  {(!t.start || !t.end) ? null : (changed && p) ? (
                    <React.Fragment>
                      <div className="rev-ghost" style={{ left: xOf(t.start)+"px", width: wOf(t.start,t.end)+"px" }}/>
                      <div className="rev-amber" style={{ left: xOf(p.start)+"px", width: wOf(p.start,p.end)+"px" }}/>
                      {isTgt ? <div className="rev-flag" style={{ left: (xOf(p.end)+8)+"px" }}>{endDelta>=0?"+":""}{endDelta}d</div> : null}
                    </React.Fragment>
                  ) : (
                    <div className="rev-bar" style={{ left: xOf(t.start)+"px", width: wOf(t.start,t.end)+"px", background: m.ganttBar }}/>
                  )}
                </div>
              );
            })}
            <div style={{ height: (HEAD + visualTasks.length * ROWH) + "px" }}/>
          </div>
        </div>
      </div>
    );
  };

  const fromName = active ? (active.email_from || "Unknown sender") : "";
  const fromMatch = active ? /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(fromName) : null;
  const dispName = fromMatch ? (fromMatch[1] || fromMatch[2]) : fromName;
  const dispEmail = fromMatch ? fromMatch[2] : "";

  const renderDrawer = () => {
    if (!active) return (
      <div className="rev-empty"><div className="ico"><i className="ti ti-inbox"/></div><h3>Inbox zero</h3><p>No pending updates. Forward a work email and it’ll show up here as a suggested edit.</p></div>
    );
    return (
      <div className="rev-drawer">
        <div className="rev-cols">
          <div className="rev-mail">
            <div className="rev-head">
              <div className="rev-av" style={{ background: sgqAvatarColor(dispName) }}>{sgqInitials(dispName)}</div>
              <div className="rev-who"><div className="rev-name">{dispName}</div>{dispEmail ? <div className="rev-email">{dispEmail}</div> : null}</div>
              <div className="rev-meta"><span className="rev-date2">{rfmt(active.email_date)}</span><span className={"rev-conf " + sgqConfClass(active.confidence)}>{Math.round((active.confidence||0)*100)}% match</span></div>
            </div>
            <div className="rev-subject">{active.email_subject || "(no subject)"}{matched ? <span className="rev-tgtpill"><i className="ti ti-target-arrow"/>{target.name}</span> : null}</div>
            {(() => {
              const ce = cleanEmailBody(active.email_body);
              return (
                <React.Fragment>
                  <div className="rev-bodywrap">
                    <div className="rev-mailbody" ref={mailBodyRef} style={{maxHeight:156, overflow:"hidden"}}>{ce.body || "(no body)"}</div>
                    {mailOverflow ? <div className="rev-fade"/> : null}
                  </div>
                  {mailOverflow
                    ? <button className="rev-readmore" onClick={() => setMailReaderOpen(true)}><i className="ti ti-arrows-diagonal" style={{fontSize:13}}/>Read full message</button>
                    : (ce.hasQuoted ? (
                        <div className="rev-quotewrap">
                          <button className="rev-quote-toggle" onClick={() => setShowQuoted(q => !q)}>
                            <i className={"ti " + (showQuoted ? "ti-chevron-down" : "ti-chevron-right")} style={{fontSize:13}}/>
                            {showQuoted ? "Hide quoted thread & disclaimers" : "Show quoted thread & disclaimers"}
                          </button>
                          {showQuoted ? <div className="rev-quoted">{ce.quoted}</div> : null}
                        </div>
                      ) : null)
                  }
                </React.Fragment>
              );
            })()}
          </div>
          <div className="rev-card">
            {isCreate ? (
              <React.Fragment>
                <div className="rev-taskline">
                  <span style={{display:"inline-flex", alignItems:"center", gap:7, minWidth:0}}>
                    <span style={{fontSize:9.5, fontWeight:700, color:"#15803d", background:"#dcfce7", border:"1px solid #86efac", borderRadius:5, padding:"2px 6px", letterSpacing:".04em", flexShrink:0}}>NEW TASK</span>
                    <SgqCrumb data={data} pid={pid} path={eff.task_path}/>
                  </span>
                </div>
                <div className="rev-lbl" style={{ marginTop: 10 }}>Task name</div>
                <input {...NO_AUTOFILL} className="rev-note" style={{ flex:"0 0 auto", minHeight:0, height:34, fontWeight:600 }} value={(eff.patch && eff.patch.name) || ''} placeholder="New task name"
                  onChange={e => patchRow(active.id, { patch: { ...(eff.patch || {}), name: e.target.value } })}/>
                <div className="rev-lbl" style={{ marginTop: 10 }}>Note</div>
                <textarea className="rev-note" rows={2} value={noteText} placeholder="Add a note to the new task…"
                  onChange={e => patchRow(active.id, { note_text: e.target.value })}/>
                {createReady && newTask ? (
                  <div className="rev-cascade" style={{ color:"#15803d", background:"#ecfdf3", border:"1px solid #bbf7d0" }}>
                    <i className="ti ti-calendar-plus"/>
                    {"Scheduled " + rfmt(newTask.start) + "–" + rfmt(newTask.end) + " · " + newTask.duration + "d"}
                  </div>
                ) : null}
                {newTaskAddNames.length ? (
                  <div className="rev-cascade dep" style={{ marginLeft: 8 }}>
                    <i className="ti ti-arrow-bar-to-right"/>
                    {"Depends on " + newTaskAddNames.join(", ")}
                  </div>
                ) : null}
                <div className="rev-actions">
                  <div className="rev-qnav">
                    <button onClick={prev} disabled={activeIdx<=0} title="Previous (K)"><i className="ti ti-chevron-left"/></button>
                    <span className="rev-qpos">{activeIdx+1} of {rows.length}</span>
                    <button onClick={next} disabled={activeIdx>=rows.length-1} title="Next (J)"><i className="ti ti-chevron-right"/></button>
                  </div>
                  <div className="rev-actbtns">
                    <button className="rev-approve" onClick={approve} disabled={!createReady} style={!createReady ? {opacity:.5, cursor:"default"} : undefined}><i className="ti ti-plus"/>Create task</button>
                    <button className="rev-dismiss" onClick={dismiss}><i className="ti ti-x"/>Dismiss</button>
                  </div>
                </div>
              </React.Fragment>
            ) : !matched ? (
              <React.Fragment>
                <div className="rev-lbl">Match to a task</div>
                <p className="rev-cardhint">This suggestion isn’t linked to a task yet. Pick one to preview the change against the plan.</p>
                <SgqCascadePicker data={data} pid={eff.project_id} path={eff.task_path} ready={false}
                  onChange={(p, pa) => patchRow(active.id, { project_id: p, task_path: pa })}/>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <div className="rev-taskline">
                  <SgqCrumb data={data} pid={pid} path={eff.task_path}/>
                  <span className="rev-change" onClick={() => setShowPicker(s => !s)}>{showPicker ? "done" : "change task"}</span>
                </div>
                {showPicker ? <div style={{ marginTop: 8 }}><SgqCascadePicker data={data} pid={eff.project_id} path={eff.task_path} ready={true}
                  onChange={(p, pa) => patchRow(active.id, { project_id: p, task_path: pa })}/></div> : null}

                <div className="rev-lbl" style={{ marginTop: 10 }}>Note</div>
                <textarea className="rev-note" rows={2} value={noteText} placeholder="Add a note to the task…"
                  onChange={e => patchRow(active.id, { note_text: e.target.value })}/>

                <div className={"rev-cascade " + (moversList.length ? "has" : "none")}>
                  <i className={moversList.length ? "ti ti-arrow-ramp-right-2" : "ti ti-circle-check"}/>
                  {moversList.length ? (moversList.length + " task" + (moversList.length>1?"s":"") + " shift " + (maxDelta>=0?"+":"") + maxDelta + " business day" + (Math.abs(maxDelta)>1?"s":"") + " downstream") : "No downstream schedule impact"}
                </div>
                {previewConflictMsg ? (
                  <div className="rev-cascade has" style={{marginTop:4}}><i className="ti ti-alert-triangle"/>{previewConflictMsg}</div>
                ) : null}
                {addedPredTasks.length ? (
                  <div className="rev-cascade dep" style={{marginLeft:8}}>
                    <i className="ti ti-arrow-bar-to-right"/>
                    {"Adds dependency on " + addedPredTasks.map(t => t.name).join(", ")}
                  </div>
                ) : null}

                <div className="rev-actions">
                  <div className="rev-qnav">
                    <button onClick={prev} disabled={activeIdx<=0} title="Previous (K)"><i className="ti ti-chevron-left"/></button>
                    <span className="rev-qpos">{activeIdx+1} of {rows.length}</span>
                    <button onClick={next} disabled={activeIdx>=rows.length-1} title="Next (J)"><i className="ti ti-chevron-right"/></button>
                  </div>
                  <div className="rev-actbtns">
                    <button className="rev-approve" onClick={approve}><i className="ti ti-check"/>Approve</button>
                    <button className="rev-dismiss" onClick={dismiss}><i className="ti ti-x"/>Dismiss</button>
                  </div>
                </div>
              </React.Fragment>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Build the task list the REAL grid renders while reviewing ──
  // While reviewing we show the FULL plan in visual order, ignoring Focus and collapsed parents, so the
  // targeted task and any downstream movers are always present (otherwise they'd be hidden and the band
  // would have nothing to attach to). The target sprouts an ephemeral "proposed" band right beneath it,
  // movers carry preview dates + Δ, other pending tasks get a clickable dot. Pure view state — only Approve writes.
  const flattenAll = (ts) => {
    if (!ts || !ts.length) return [];
    const childSet = focusGroupIds(ts);
    const kids = new Map();
    ts.forEach(t => { if (!kids.has(t.parentId)) kids.set(t.parentId, []); kids.get(t.parentId).push(t); });
    const out = [];
    const walk = (pid, level) => { (kids.get(pid) || []).forEach(t => { out.push({ ...t, level, hasChildren: childSet.has(t.id) }); walk(t.id, level + 1); }); };
    walk(null, 0);
    return out;
  };
  const buildReviewTasks = () => {
    const base = (proj && proj.tasks && proj.tasks.length) ? flattenAll(proj.tasks) : ((gridProps && gridProps.tasks) ? gridProps.tasks : []);
    if (isCreate) {
      if (!createReady || !newTask) return base;
      const subtreeSet = (arr, rootId) => { const s = new Set([rootId]); let c = true; while (c) { c = false; arr.forEach(t => { if (t.parentId != null && s.has(t.parentId) && !s.has(t.id)) { s.add(t.id); c = true; } }); } return s; };
      const lastOfSubtree = (arr, rootId) => { if (rootId == null) return -1; const s = subtreeSet(arr, rootId); let last = -1; arr.forEach((t, i) => { if (s.has(t.id)) last = i; }); return last; };
      const predIds = new Set((newTask.predecessors || []).map(p => p.id));
      const parentRow = newTask.parentId != null ? base.find(t => t.id === newTask.parentId) : null;
      const row = { id: '__rvnew', __rvProposed: true, __rvNew: true, level: parentRow ? (parentRow.level || 0) + 1 : 0 };
      // Slot the new task right after the predecessor it depends on (when that predecessor sits under the
      // same parent) — a task should follow what must finish first. Otherwise drop it at the end of the parent's children.
      let anchor = -1;
      base.forEach((t, i) => { if (predIds.has(t.id) && t.parentId === newTask.parentId) anchor = i; });
      if (anchor >= 0) anchor = lastOfSubtree(base, base[anchor].id);
      else if (newTask.parentId != null) anchor = lastOfSubtree(base, newTask.parentId);
      if (anchor < 0) return [...base, row];
      const out = [];
      base.forEach((t, i) => { out.push(t); if (i === anchor) out.push(row); });
      return out;
    }
    if (!matched) return base.map(t => (t.id in sugByTask) ? { ...t, __rvPending: sugByTask[t.id] } : t);
    const out = [];
    base.forEach(t => {
      if (t.id === targetId) {
        out.push({ ...t, __rvTarget: true });
        out.push({ id: '__rvprop', name: '', __rvProposed: true, level: t.level || 0 });
      } else if (moverMap[t.id]) {
        const m = moverMap[t.id];
        out.push({ ...t, start: m.newStart, end: m.newEnd, __rvMover: m.dEnd });
      } else if (t.id in sugByTask) {
        out.push({ ...t, __rvPending: sugByTask[t.id] });
      } else {
        out.push(t);
      }
    });
    return out;
  };
  const reviewTasks = gridProps ? buildReviewTasks() : null;
  // End and duration are mutually exclusive drivers (matching the grid): setting one clears the other
  // so the preview engine recomputes the dependent value cleanly.
  const setPatchExclusive = (set, drop) => setEdits(E => {
    if (!active) return E;
    const row = rows.find(r => r.id === active.id);
    const cur = (E[active.id] && E[active.id].patch) || (row && row.patch) || {};
    const np = { ...cur, ...set }; drop.forEach(k => { delete np[k]; });
    return { ...E, [active.id]: { ...(E[active.id] || {}), patch: np } };
  });
  const reviewCtx = {
    isCreate,
    newName: newTask ? newTask.name : '',
    propStatus: isCreate ? (newTask ? newTask.health : 'gray') : propStatus,
    propEnd:    isCreate ? (newTask ? newTask.end : '') : propEnd,
    propOwner:  isCreate ? (newTask ? (newTask.responsibleParty || '') : '') : propOwner,
    propStart:  isCreate ? (newTask ? newTask.start : '') : (propTarget ? propTarget.start : (target ? target.start : '')),
    startChanged: isCreate ? true : !!startChanged,
    propDur:    isCreate ? (newTask ? newTask.duration : null) : (propTarget ? propTarget.duration : (target ? target.duration : null)),
    addedPreds: isCreate ? newTaskAddNames : addedPredTasks.map(t => t.name),
    endChanged: isCreate ? false : !!endChanged, endDelta,
    note: !!(noteText && String(noteText).trim()),
    onStatus: (v) => { if (active) setPatchField(active.id, 'health', v); },
    onEnd:    (v) => { if (active) setPatchExclusive({ end: v }, ['duration']); },
    onDur:    (v) => { if (active) setPatchExclusive({ duration: v }, ['end']); },
    onOwner:  (v) => { if (active) setPatchField(active.id, 'responsibleParty', v); },
    approve, dismiss,
    pick: (idx) => setActiveIdx(idx),
  };

  if (loading) return <div className="rev" style={{flex:1, minHeight:0}}><div className="rev-loading">Loading updates…</div></div>;

  return (
    <div className="rev" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <div className="rev-body" ref={bodyRef} style={{flex:1}}>
        <div className="rev-top" style={{ height: split + "%", overflow:"hidden", display:"flex", minHeight:0 }}>
          {(gridProps && reviewTasks)
            ? <GridView {...gridProps} tasks={reviewTasks} review={reviewCtx} />
            : (view==='grid' ? renderGrid() : renderGantt())}
        </div>
        <div className="rev-div" onMouseDown={onDivDown}><span className="grip"><i/><i/><i/></span></div>
        <div className="rev-bottom">{renderDrawer()}</div>
      </div>
      {toast ? <div className="rev-toast"><span className="tmsg"><i className="ti ti-check ok"/>{toast.msg}</span><button onClick={doUndo}><i className="ti ti-arrow-back-up"/>Undo</button></div> : null}
      {mailReaderOpen && active ? (
        <div className="rev-readeroverlay" onClick={() => setMailReaderOpen(false)}>
          <div className="rev-reader" onClick={e => e.stopPropagation()}>
            <div className="rev-reader-head">
              <div className="rev-av" style={{ background: sgqAvatarColor(dispName) }}>{sgqInitials(dispName)}</div>
              <div className="rev-who" style={{flex:1, minWidth:0}}>
                <div className="rev-name">{dispName}</div>
                {dispEmail ? <div className="rev-email">{dispEmail}</div> : null}
              </div>
              <span className="rev-date2">{rfmt(active.email_date)}</span>
              <button className="rev-reader-close" onClick={() => setMailReaderOpen(false)} title="Close (Esc)"><i className="ti ti-x"/></button>
            </div>
            <div className="rev-reader-subject">{active.email_subject || "(no subject)"}</div>
            <div className="rev-reader-body">
              {(() => { const ce = cleanEmailBody(active.email_body); return (
                <React.Fragment>
                  <div className="rev-mailbody" style={{marginTop:0}}>{ce.body || "(no body)"}</div>
                  {ce.hasQuoted ? (
                    <div className="rev-quotewrap">
                      <button className="rev-quote-toggle" onClick={() => setShowQuoted(q => !q)}>
                        <i className={"ti " + (showQuoted ? "ti-chevron-down" : "ti-chevron-right")} style={{fontSize:13}}/>
                        {showQuoted ? "Hide quoted thread & disclaimers" : "Show quoted thread & disclaimers"}
                      </button>
                      {showQuoted ? <div className="rev-quoted">{ce.quoted}</div> : null}
                    </div>
                  ) : null}
                </React.Fragment>
              ); })()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// B1107680 (NEW-1) — the 13 per-tab / per-browser VIEW-state keys that must NEVER live in the
// versioned hs-v1 cloud document. Before this fix they rode inside the same `data` object that
// gets cloud-saved on every change, so switching projects / zooming the grid / resizing a column
// rewrote the whole ~355KB document and bumped __rev — and every OTHER open tab read that write as
// a genuine concurrent edit, showing a phantom "a newer version was saved on another device" banner
// from a mere navigation. They now live client-side only: VIEW_TAB_KEYS in sessionStorage (per-tab
// — survives a reload of the SAME tab, never crosses to a new one) and VIEW_PREF_KEYS in
// localStorage (durable per-browser preferences a brand-new tab is expected to already have —
// column widths, sort, grouping, health style). editProjId (an in-progress rename) is deliberately
// never persisted at all — it always resets to null on load, like any other transient in-progress-
// edit flag.
const VIEW_TAB_KEYS  = ["aPid", "view", "section"];
const VIEW_PREF_KEYS = ["gridZoom", "gridColWidths", "masterSort", "masterCols", "masterColWidths",
                         "masterGroupBy", "masterLevelFilter", "masterHealthFilter", "masterProjectFilter", "healthColStyle"];
const VIEW_TRANSIENT_KEYS = ["editProjId"];
const VIEW_STATE_KEYS = new Set([...VIEW_TAB_KEYS, ...VIEW_PREF_KEYS, ...VIEW_TRANSIENT_KEYS]);
const VIEW_TAB_STORAGE_KEY   = "planar:tabView:v1";
const VIEW_PREFS_STORAGE_KEY = "planar:viewPrefs:v1";
function loadTabView()      { try { return JSON.parse(sessionStorage.getItem(VIEW_TAB_STORAGE_KEY) || "{}") || {}; } catch { return {}; } }
function saveTabView(obj)   { try { sessionStorage.setItem(VIEW_TAB_STORAGE_KEY, JSON.stringify(obj)); } catch (_) {} }
function loadViewPrefs()    { try { return JSON.parse(localStorage.getItem(VIEW_PREFS_STORAGE_KEY) || "{}") || {}; } catch { return {}; } }
function saveViewPrefs(obj) { try { localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify(obj)); } catch (_) {} }

// NEW-1 (2026-10-02, owner report: "the focus button on the schedule module doesn't hold ... It should
// just hold whatever the last status was") — the OTHER half of the 2026-09-17 strip below. `focused`
// stays OUT of the versioned document (TASK_VIEW_FIELDS), but the strip alone made it live only in
// memory, so every remount/reload came back fully expanded. It now lives per BROWSER in localStorage:
// { [scheduleId]: [focusedTaskId, ...] }. Written by persistViewState (every `focused` change, from the
// pill OR any flow that clears it — re-parent, indent, paste, open-row jump), re-applied by
// applyTaskFocus on every doc that enters memory (load / import / restore / sibling-tab merge).
// `focused` undefined = "not known" (a doc that came off the cloud); an explicit true/false is a
// decision and always wins over what is stored, so a remote doc can never wipe local focus.
const TASK_FOCUS_STORAGE_KEY = "planar:taskFocus:v1";
function loadTaskFocus()    { try { const v = JSON.parse(localStorage.getItem(TASK_FOCUS_STORAGE_KEY) || "{}"); return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}; } catch { return {}; } }
function saveTaskFocus(obj) { try { localStorage.setItem(TASK_FOCUS_STORAGE_KEY, JSON.stringify(obj)); } catch (_) {} }
function applyTaskFocus(d) {
  if (!d || typeof d !== "object" || !d.projects || typeof d.projects !== "object") return d;
  const store = loadTaskFocus();
  let projects = null;
  Object.keys(store).forEach(pid => {
    const proj = d.projects[pid], ids = store[pid];
    if (!proj || !Array.isArray(proj.tasks) || !Array.isArray(ids) || !ids.length) return;
    const want = new Set(ids);
    let changed = false;
    const tasks = proj.tasks.map(t => {
      if (t && want.has(t.id) && t.focused === undefined) { changed = true; return { ...t, focused: true }; }
      return t;
    });
    if (!changed) return;
    if (!projects) projects = { ...d.projects };
    projects[pid] = { ...proj, tasks };
  });
  return projects ? { ...d, projects } : d;
}
// Fold every explicit `focused` true/false in `next` into the stored map; prune ids that no longer
// exist in a project that is present. A no-op unless the projects tree actually changed.
function persistTaskFocus(prev, next) {
  if (!next || !next.projects || (prev && prev.projects === next.projects)) return;
  const store = loadTaskFocus();
  let dirty = false;
  Object.entries(next.projects).forEach(([pid, proj]) => {
    if (!proj || !Array.isArray(proj.tasks) || !proj.tasks.length) return;
    const before = Array.isArray(store[pid]) ? store[pid] : [];
    const live = new Set(proj.tasks.map(t => t && t.id));
    const set = new Set(before.filter(id => live.has(id)));
    proj.tasks.forEach(t => {
      if (!t) return;
      if (t.focused === true) set.add(t.id);
      else if (t.focused === false) set.delete(t.id);
    });
    const after = [...set];
    if (after.length === before.length && after.every((id, i) => id === before[i])) return;
    dirty = true;
    if (after.length) store[pid] = after; else delete store[pid];
  });
  if (dirty) saveTaskFocus(store);
}

// True when any key OUTSIDE the 13 view-state keys differs between `prev` and `next` — a shallow,
// reference-equality check per top-level key. Safe because every setData updater in this file
// builds its result via immutable spreads, so a changed sub-tree always gets a new object identity.
// Handles any future core key automatically: this only special-cases the fixed, enumerated view
// keys, never the core ones (VIEW-INDEPENDENT-ONCE — work whose inputs are the document's real data
// must not be redone just because the view moved).
function coreChanged(prev, next) {
  if (prev === next) return false;
  if (!prev || !next) return true;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (VIEW_STATE_KEYS.has(k)) continue;
    if (prev[k] !== next[k]) return true;
  }
  return false;
}

// NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — per-TASK view-only
// fields that must never ride into the versioned document either, same reasoning as the top-level
// VIEW_STATE_KEYS above, one level deeper. `focused` is a task's own "show me just what's still
// open under this row" toggle — pure UI convenience, not data anyone expects synced across devices
// — yet it lives inside the `task` object, which IS core data, so toggling it on an idle tab kept
// bumping __rev and reading as a genuine edit to every other open tab (measured: an idle tab's
// ENTIRE autosave diff, repeatedly, was one task's `focused: true → false`). Stripped here exactly
// like the 13 top-level keys — and restored per browser from localStorage (taskFocus, above), never from the doc.
const TASK_VIEW_FIELDS = ["focused"];
function stripTaskViewFields(tasks) {
  if (!Array.isArray(tasks)) return tasks;
  return tasks.map(t => {
    if (!t || typeof t !== "object") return t;
    let changed = false;
    const out = {...t};
    TASK_VIEW_FIELDS.forEach(k => { if (k in out) { delete out[k]; changed = true; } });
    return changed ? out : t;
  });
}
// The payload actually written to the cloud (a routine autosave OR an explicit pre-X checkpoint
// snapshot) never carries the 13 view-state keys — they are not versioned data and must never bump
// __rev or freeze a stale value into a Version History snapshot. Same treatment for every project's
// tasks' own view-only fields (TASK_VIEW_FIELDS, just above).
function stripViewState(d) {
  if (!d || typeof d !== "object") return d;
  const out = {...d};
  VIEW_STATE_KEYS.forEach(k => { delete out[k]; });
  if (out.projects && typeof out.projects === "object") {
    const projects = {};
    Object.entries(out.projects).forEach(([pid, proj]) => {
      projects[pid] = (proj && Array.isArray(proj.tasks)) ? { ...proj, tasks: stripTaskViewFields(proj.tasks) } : proj;
    });
    out.projects = projects;
  }
  return out;
}

// NEW-1 (recurrence of B1080547, owner report 2026-09-07: "how come I still can't make multiple
// schedules per project?") — which of a SITE's several linked schedules was most recently active.
// Deliberately NOT a view-state key (must live in the versioned document, not sessionStorage/
// localStorage): a brand-new tab has no per-tab aPid yet (see B1107680 above) and falls back to
// whichever project sorts first; the cross-module carry-in (planar:nav-select-by-site) used to make
// the exact same "first linked, always" choice — so a second/third schedule created for a site was
// reachable only by luck of staying in the same tab forever. This map is the durable memory that
// closes both gaps at once. Pure; a no-op (same object) when the recorded id is already current.
function withLastActiveSite(d, siteId, scheduleId) {
  if (siteId == null || scheduleId == null) return d;
  if (d.lastActiveBySite && d.lastActiveBySite[siteId] === scheduleId) return d;
  return { ...d, lastActiveBySite: { ...(d.lastActiveBySite || {}), [siteId]: scheduleId } };
}

// Persist whichever of the 13 keys actually changed since the last render — cheap (a few small JSON
// blobs), and this never touches the cloud.
function persistViewState(prev, next) {
  let tabChanged = false, prefsChanged = false;
  VIEW_TAB_KEYS.forEach(k => { if (!prev || prev[k] !== next[k]) tabChanged = true; });
  VIEW_PREF_KEYS.forEach(k => { if (!prev || prev[k] !== next[k]) prefsChanged = true; });
  if (tabChanged) {
    const cur = loadTabView();
    VIEW_TAB_KEYS.forEach(k => { cur[k] = next[k]; });
    saveTabView(cur);
  }
  if (prefsChanged) {
    const cur = loadViewPrefs();
    VIEW_PREF_KEYS.forEach(k => { cur[k] = next[k]; });
    saveViewPrefs(cur);
  }
  persistTaskFocus(prev, next);   // NEW-1 (2026-10-02) — per-task Focus, local-only
}

// Resolve the 13 view-state keys for a just-loaded/imported/restored document `d`: prefer whatever
// THIS tab (sessionStorage) / THIS browser (localStorage) already holds, and fall back to the value
// baked into `d` only the first time nothing is saved yet — a one-time migration off the legacy
// hs-v1 rows that used to carry these fields inline. This also means an import or a Version History
// restore can never yank the current tab onto a different project than what's on screen: this tab's
// already-saved aPid/view/section win over whatever happened to be baked into the imported/restored
// snapshot. editProjId always resets to null (never resurrected). A guard keeps aPid pointing at a
// REAL project — a stale per-tab id surviving a delete on another device, or an import that swapped
// in a different project set entirely, falls back to the document's own aPid, then to its first
// project, so nothing downstream ever reads the active project as undefined.
// B2285440 — THE ONE ACCESSOR for "which schedule is active". The document can legitimately hold no
// active schedule: an account whose every schedule was deleted (rows soft-deleted, index row still
// there, stale aPid in the index's view flags), or a per-tab aPid that outlived a delete on another
// device. ~8 render paths used to read the active project straight off the projects map bare, so ANY such document crashed
// the view ("This view failed to load"). Everything that needs the active schedule asks these two;
// they never throw and never write. pickActivePid keeps `preferred` when it is real, else the first
// real schedule, else null (the caller shows the visible empty state — nothing is created or deleted).
function pickActivePid(projects, preferred) {
  if (!projects || typeof projects !== "object") return null;
  if (preferred != null && projects[preferred]) return preferred;
  const first = Object.values(projects).find(p => p && typeof p === "object" && p.id != null);
  return first ? first.id : null;
}
function activeProjectOf(d) {
  if (!d || typeof d !== "object" || !d.projects) return null;
  const p = d.aPid != null ? d.projects[d.aPid] : null;
  return p && typeof p === "object" ? p : null;
}
function resolveViewState(d) {
  if (!d || typeof d !== "object") return d;
  const tab = loadTabView();
  const prefs = loadViewPrefs();
  const patch = { editProjId: null };
  VIEW_TAB_KEYS.forEach(k => { patch[k] = Object.prototype.hasOwnProperty.call(tab, k) ? tab[k] : d[k]; });
  VIEW_PREF_KEYS.forEach(k => { patch[k] = Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : d[k]; });
  if (d.projects && (patch.aPid == null || !d.projects[patch.aPid])) {
    patch.aPid = pickActivePid(d.projects, d.aPid);   // B2285440 — null (not a dangling id) when there is no schedule at all
  }
  const tabPatch = {};   VIEW_TAB_KEYS.forEach(k => { tabPatch[k] = patch[k]; });
  const prefsPatch = {}; VIEW_PREF_KEYS.forEach(k => { prefsPatch[k] = patch[k]; });
  saveTabView({...tab, ...tabPatch});
  saveViewPrefs({...prefs, ...prefsPatch});
  return applyTaskFocus({...d, ...patch});   // NEW-1 (2026-10-02) — re-apply per-task Focus before first render
}

// ── App ───────────────────────────────────────────────────
function App() {
  const [data,       setData]       = useState(null);
  const dataRef = useRef(null);
  useEffect(() => { dataRef.current = data; }, [data]);
  // B1539585 — a ref, not a plain closure `let`, because updateTask's setData(updater) can run its
  // updater EITHER eagerly (synchronously, inline with the dispatch call) OR deferred to the next
  // render, depending on whether React finds other work already pending on this fiber at click time
  // — which in an interactive app is common. A local variable checked immediately after `setData(...)`
  // races the deferred case and silently loses: the check runs with the pre-update `null` before the
  // updater has ever written to it, so the toast never fires. A ref written INSIDE the updater and read
  // by a `[data]`-effect is safe under both timings, because the effect is guaranteed to run only after
  // the render that incorporated the updater's write has committed.
  const rollToastRef = useRef(null);
  useEffect(() => {
    if (rollToastRef.current) { showToast(rollToastRef.current); rollToastRef.current = null; }
  }, [data]);
  // B212 — keyboard column navigation walks the active project's VISIBLE columns in
  // DISPLAY ORDER so the cell cursor always lands on an on-screen column and never on a
  // hidden one (a hidden column has no rendered cell, so the blue selection outline would
  // otherwise vanish). Algorithm unit-tested in src/workspaces/scheduler/lib/gridColNav.js.
  // B583: index into the EFFECTIVE registry (built-ins + this project's formula columns) so
  // a formula column is navigable too and lines up with the row render's ci = allCols.indexOf(c).
  const visibleColIdxs = () => {
    const d = dataRef.current;
    const eff = activeEffectiveCols(d);
    const vis = readGridCfg(d && d.projects?.[d.aPid], d).visible; // column keys, display order
    const idxs = [];
    vis.forEach(k => { const i = eff.findIndex(c => c.k === k); if (i >= 0) idxs.push(i); });
    return idxs;
  };
  // Step the cursor to the adjacent visible column (dir>0 right, dir<0 left), clamped at
  // the first/last visible column. If the cursor sits off-table (its column was hidden, or
  // the initial id column is hidden), snap onto the nearest visible column toward `dir`.
  const stepGridCol = (curIdx, dir) => stepVisibleColIdx(visibleColIdxs(), curIdx, dir);
  const [successorPrompt, setSuccessorPrompt] = useState(null);
  /* NEW-1 — a completion can unblock MORE THAN ONE successor at once (the bulk "Mark Complete"
   * action below can flip several to green in one apply(), and so can hand-picking the Complete
   * pill on more than one row). Each green transition independently schedules its own follow-up
   * prompt 80ms later (see the "fire when task transitions to complete" block), so two completions
   * in the same batch would race to overwrite the single `successorPrompt` slot — whichever
   * setTimeout lands last wins, and the other's follow-up prompt is silently lost. That is exactly
   * the silent-cascade shape the owner ruled out. A small FIFO queue makes it deterministic instead:
   * every triggered prompt is queued, and the queue drains one at a time as each prompt closes —
   * "one hop at a time, prompting again" holds even when the batch had more than one hop to offer. */
  const [successorPromptQueue, setSuccessorPromptQueue] = useState([]);
  useEffect(() => {
    if (!successorPrompt && successorPromptQueue.length > 0) {
      setSuccessorPrompt(successorPromptQueue[0]);
      setSuccessorPromptQueue(q => q.slice(1));
    }
  }, [successorPrompt, successorPromptQueue]);
  const [notesCtx,   setNotesCtx]   = useState(null);
  const [isMobile,   setIsMobile]   = useState(() => typeof window!=='undefined' && window.innerWidth < 768);
  const [mobMenuOpen, setMobMenuOpen] = useState(false);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  // B1241744/B1241745 — WIDTH drives LAYOUT (isMobile above: the 2-row header, the single overflow
  // menu, and — new this session — which Schedule view collapses to one pane). POINTER TYPE drives
  // CONTROL SIZING, and it is a SEPARATE axis: an iPhone in landscape is wide enough (832px+) to
  // clear the 768px isMobile threshold while still being operated with a finger, so a control sized
  // for a mouse there is exactly as unreachable as one on a narrow phone. `coarsePointer` is that
  // second axis — read once, live-updated on the rare device that changes pointer type — and is
  // never used to decide what's SHOWN (only how big it renders).
  const [coarsePointer, setCoarsePointer] = useState(() => typeof window!=='undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    if (typeof window==='undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const h = () => setCoarsePointer(mq.matches);
    (mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h));
    return () => (mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h));
  }, []);
  // B1281648 (RECURRENCE ×3 of B1241745) — Split at phone width used to collapse to ONE pane at a
  // time (a `phonePane` state switched by the header pill — see the pill's own history comment
  // below). The owner rejected that shape on a real iPhone across three shipped attempts (#1490,
  // #1497, #1504): a single pane behind the "Split" tab is indistinguishable from just picking
  // Grid or Gantt directly, so it reads as "nothing happens." Split now renders BOTH panes at
  // once, stacked vertically, at every width (`SplitView`'s own `isMobile` branch) — so there is
  // no longer a "which pane is phone-Split showing" question, and this state is gone.
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [projCtx,    setProjCtx]    = useState(null);
  const [taskCtx,    setTaskCtx]    = useState(null);
  const [iconPickerCtx, setIconPickerCtx] = useState(null);   // {taskId, projId, x, y} — the task-icon picker opened from the row's right-click menu (B2671196 ×2)
  // Task-level clipboard for Ctrl+C / Ctrl+X / Ctrl+V. Held in a ref because the
  // global keydown handler runs in a stable effect and would otherwise capture a
  // stale value. Shape: { mode: "copy"|"cut", tasks: [deep-copied subtree(s), concatenated], sourceProjId, sourceRootIds }
  const clipboardRef = useRef(null);
  const pasteSelectRef = useRef(null); // new id of the just-pasted root → select + scroll to it after paste
  const [, setClipboardTick] = useState(0); // bump to force re-render when clipboard changes (for menu/visual cues)
  const [renameModal, setRenameModal] = useState(null);
  const [deleteChoice, setDeleteChoice] = useState(null); // {ids, rowCount, totalCount} | null — delete-with-children prompt
  const [moveToCtx, setMoveToCtx] = useState(null); // {ids, projId} | null — "Move to…" destination-picker modal
  const moveSelectRef = useRef(null); // new id of the moved block's first root row → select + scroll to it after a move
  const [edit,       setEdit]       = useState(null);
  const editLiveRef = useRef(null);   // NEW-1 — the key handler's closure is stale w.r.t. `edit`; this is live
  useEffect(() => { editLiveRef.current = edit; }, [edit]);
  const focusReselectRef = useRef(null);   // NEW-1 — set by Alt+F, consumed by the layout effect below
  const [editStartChar, setEditStartChar] = useState(null);
  const [selectedId,    setSelectedId]    = useState(null);
  const [selRange,      setSelRange]      = useState(null); // {r1,r2,c1,c2} — row/col indices into flatTasks/COLS
  // NEW-1 — _sids of rows inserted under a Focus filter this session: Focus never hides them (view-only,
  // never saved), so an inserted blank row stays on screen without un-focusing its parent. Cleared when
  // any Focus toggle is pressed (re-applying the filter).
  const [focusPins, setFocusPins] = useState(() => new Set());
  const [selectedColIdx, setSelectedColIdx] = useState(0);
  // Keep "today" current within a live session so overdue/due-soon colors and the today line
  // re-evaluate on tab focus and roll over at midnight — no reload needed. NOW is module-scope
  // (read by computeDisplayHealth); bumping todayTick forces the re-render that re-reads it.
  const [, setTodayTick] = useState(0);
  const [, setHealthTick] = useState(0); // bumped after rebuildHEALTH so a new/renamed status renders this beat, not next (B5/M3)
  useEffect(() => {
    // B1161792 (NEW-1) — a health RULE transition (overdue/due-soon) can fire purely from the
    // clock rolling over a day, with no data edit at all, and the reconciliation this effect's
    // sibling `[data]` effect runs (below) only fires on a real edit (`coreChanged`) — it has no
    // notion of the clock. So a genuine date rollover reconciles here too, the one place that
    // already detects one.
    const refresh = () => { const t = fdLocal(new Date()); if (t !== NOW) { setNOW(t); setTodayTick(x => x + 1);
      // isDerivedUpdate stays armed only through the ONE state transition it targets — reset it
      // immediately if reconcileNeedsAttention turns out to be a no-op (same ref back), or the flag
      // would leak forward and wrongly swallow the NEXT real edit's history entry (that edit's own
      // setData would be the one to actually change `data` and consume the still-armed flag).
      isDerivedUpdate.current = true;
      setData(d => { const next = reconcileNeedsAttention(d); if (next === d) isDerivedUpdate.current = false; return next; });
    } };
    const onVis = () => { if (!document.hidden) refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(refresh, 60000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVis); clearInterval(iv); };
  }, []);
  const [goToFocus,      setGoToFocus]      = useState(null); // {taskId, n} — grid scrolls to + pulses this row after a cross-view jump
  const [offlineFallback, setOfflineFallback] = useState(false);
  // B778/NEW-1 — planar_data now requires sign-in + schedule ownership (RLS), so a signed-out
  // visitor gets denied (42501), not a connectivity failure. Distinct from offlineFallback's
  // "cloud unreachable" so the banner doesn't wrongly tell them to check their connection.
  const [authRequired, setAuthRequired] = useState(false);
  const [driftNotice, setDriftNotice] = useState(null);   // B836 — non-pinned tasks whose saved start the load re-cascade corrected; surfaced loudly (banner)
  const [ancestorPredNotice, setAncestorPredNotice] = useState(null);   // NEW-1 (B1696640) — tasks whose predecessors named their own parent/ancestor; the link was dropped on load
  const [staleNotice, setStaleNotice] = useState(false);
  const didInitialLoad = useRef(false);
  const prevCoreRef = useRef(null);   // B1107680 — last `data` whose CORE (versioned) portion was considered for a cloud save
  const [formatOpen, setFormatOpen] = useState(false);
  const [settingsOpen,    setSettingsOpen]    = useState(false);
  const [settingsSection, setSettingsSection] = useState(null);   // B844 — pre-expand a Settings section
  const [meetingCalOpen,  setMeetingCalOpen]  = useState(false);  // the dedicated Meeting-calendars editor window
  const [automationOpen,  setAutomationOpen]  = useState(false);
  const [contactsOpen,    setContactsOpen]    = useState(false);
  const [historyOpen,     setHistoryOpen]     = useState(false);
  const [reviewOpen,      setReviewOpen]      = useState(false);
  const [reviewRows,      setReviewRows]      = useState([]);
  const [reviewLoading,   setReviewLoading]   = useState(true);
  const [reviewIdx,       setReviewIdx]       = useState(0);
  // B844 — deep-link listener (e.g. an empty "Meeting" cell → set up). The "meetings" detail now
  // opens the dedicated Meeting-calendars window; any other section still opens Settings to it.
  useEffect(() => {
    const openTo = e => {
      if ((e?.detail || null) === "meetings") { setMeetingCalOpen(true); setSettingsOpen(false); }
      else { setSettingsSection(e?.detail || null); setSettingsOpen(true); }
      setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);
    };
    document.addEventListener("planar-open-settings", openTo);
    return () => document.removeEventListener("planar-open-settings", openTo);
  }, []);
  const [ganttPPD,   setGanttPPD]   = useState(() => {
    const ganttW = window.innerWidth * 0.46; // 46% goes to Gantt in default split view
    return Math.max(1, Math.floor(ganttW / 365));
  });
  const [gridZoom,   setGridZoom]   = useState(() => data?.gridZoom ?? 1.0);
  // The lazy initializer above runs on the FIRST render when `data` is still null, so it always
  // resolves to 1.0; adopt the persisted zoom once the async load sets data (the wheel handler keeps
  // data.gridZoom current, so this one-way sync just restores it instead of always snapping to 100%).
  useEffect(() => { if (data && typeof data.gridZoom === "number") setGridZoom(data.gridZoom); }, [data?.gridZoom]);
  const hoverZoneRef = useRef('gantt');
  const fileHandleRef = useRef(null);
  const fileHtmlRef   = useRef(null);

  // ── Review (suggestions) data: fetch + realtime subscribe; one source feeds both the toolbar badge and the Review panel ──
  useEffect(() => {
    const sb = window.__sb;
    if (!sb) { setReviewLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const { data: list, error } = await sb.from('planar_suggestions')
          .select('*').eq('status', 'pending').order('created_at', { ascending: false });
        if (!alive) return;
        if (!error && list) setReviewRows(list);
      } catch (e) { console.warn("suggestions fetch failed:", e); }
      if (alive) setReviewLoading(false);
    })();
    let channel = null;
    try {
      channel = sb.channel('planar_suggestions_pending')
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'planar_suggestions' }, payload => {
          if (payload && payload.new && payload.new.status === 'pending')
            setReviewRows(R => [payload.new, ...R.filter(r => r.id !== payload.new.id)]);
        })
        .on('postgres_changes', { event:'UPDATE', schema:'public', table:'planar_suggestions' }, payload => {
          if (!payload || !payload.new) return;
          if (payload.new.status !== 'pending') setReviewRows(R => R.filter(r => r.id !== payload.new.id));
          else setReviewRows(R => R.map(r => r.id === payload.new.id ? payload.new : r));
        })
        .on('postgres_changes', { event:'DELETE', schema:'public', table:'planar_suggestions' }, payload => {
          if (payload && payload.old) setReviewRows(R => R.filter(r => r.id !== payload.old.id));
        })
        .subscribe();
    } catch (e) { console.warn("suggestions subscribe failed:", e); }
    return () => { alive = false; try { if (channel) sb.removeChannel(channel); } catch (e) {} };
  }, []);

  // While reviewing, keep the shown project in sync with the active suggestion's project, so the proposed
  // row and its cascade inject into the correct plan grid.
  useEffect(() => {
    if (!reviewOpen || !data) return;
    const a = reviewRows[reviewIdx];
    if (a && a.project_id != null && data.aPid !== a.project_id && data.projects && data.projects[a.project_id]) setData(d => ({ ...d, aPid: a.project_id }));
  }, [reviewOpen, reviewIdx, reviewRows, data?.aPid]);
  const fileSaveTimer = useRef(null);
  const [fileLinked,  setFileLinked]  = useState(false);
  const [savePulse,   setSavePulse]   = useState(false);
  // Sticky save state: "saved" | "saving" | "error". Red ("error") persists
  // until a save actually lands — it never times out or fades on its own.
  const [saveStatus,  setSaveStatus]  = useState("saved");
  const saveSeq       = useRef(0);      // ignore stale resolutions when saves overlap
  const latestData    = useRef(null);   // freshest data, for retries
  const saveStatusRef = useRef("saved");
  useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);

  // One cloud-save attempt: mark "saving", then "saved"/"error" — unless a
  // newer attempt has superseded this one (then its resolution decides).
  const attemptCloudSave = (d) => {
    const seq = ++saveSeq.current;
    setSaveStatus("saving");
    // B1107680 — the payload never carries the 13 per-tab/per-browser view-state keys; they aren't
    // versioned data and must never bump __rev or ride into a cloud row other tabs watch.
    window.storage.set("hs-v1", JSON.stringify(stripViewState(d)), { label: "auto" })
      .then(res => { if (saveSeq.current === seq) setSaveStatus(res ? "saved" : "error"); })
      .catch(()  => { if (saveSeq.current === seq) setSaveStatus("error"); });
  };
  const [dlOpen,      setDlOpen]      = useState(false);
  const history      = useRef([]);
  const future       = useRef([]);  // Fix #8: redo stack
  const prevData     = useRef(null);
  const isUndoing    = useRef(false);
  // NEW-1 — a DERIVED-field recompute (reconcileNeedsAttention's needsAttentionSince stamp/clear,
  // the holiday recascade) is not a user edit: it's a `[data]` effect reacting to data IT JUST
  // helped produce, so its own `setData` re-triggers this same history-capture effect. Without this
  // flag that reactive write pushes an extra, invisible snapshot onto `history` right after every
  // real edit whose side effect flips some task's red/not-red status (most commonly a date edit,
  // since the default overdue/due-soon rules are date-driven) — and because the flag-mismatch that
  // triggered the recompute is now fixed, RESTORING that snapshot via Ctrl+Z immediately re-triggers
  // the same recompute again, which re-pushes an equivalent snapshot right back. The visible fields
  // (the date the user actually typed) never move, and every further Ctrl+Z repeats the same cycle —
  // the real prior edit sits one level further back and can never be reached. Owner repro: Goose
  // Creek Master Schedule task 168, "P&Z Public Hearing & Consideration" 9/10→9/30 — 9/10 was
  // overdue-red under the default rule (9/11 "today"), 9/30 was not, and Ctrl+Z never got past that
  // flip. Set this ref (like `isUndoing`) immediately before any `setData` whose ONLY job is to
  // re-derive a field from `data` that was already current — never for a real user action.
  const isDerivedUpdate = useRef(false);
  const flatTasksRef = useRef([]);
  const lastSelIdxRef = useRef(null);   // NEW-1 — see the layout effect beside flatTasks
  // NEW-1 — the flat index of the first task row whose top is inside the grid's viewport (below the sticky
  // header), read from the DOM at the instant of the key press. stepGridRow's last-resort anchor when a lost
  // selection has no known position. null when no grid is mounted.
  const viewportTopFlatIdx = (tasks) => {
    const g = document.querySelector('[data-grid-scroll="1"]'); if (!g) return null;
    const top = g.getBoundingClientRect().top;
    for (const r of g.querySelectorAll("[data-task-row]")) {
      const b = r.getBoundingClientRect();
      if (b.top >= top + 20) { const id = r.getAttribute("data-task-row"); const i = tasks.findIndex(t => String(t.id) === id); if (i >= 0) return i; }
    }
    return null;
  };
  const projIdRef    = useRef(null);
  const prevHolKey   = useRef(null);
  const skipHolRecasc = useRef(false);
  const prevHealthKey = useRef(null); // serialized customHealth+labelOverrides; detects real status-config changes (B5/M3)

  // Capture a snapshot AFTER every data change, except undo/redo operations and derived recomputes
  // (NEW-1 — a derived recompute folds into the CURRENT snapshot instead of becoming its own step,
  // exactly like an undo/redo restore already does).
  useEffect(() => {
    if (!data) return;
    if (isUndoing.current) { isUndoing.current = false; prevData.current = data; return; }
    if (isDerivedUpdate.current) { isDerivedUpdate.current = false; prevData.current = data; return; }
    if (prevData.current !== null) {
      history.current = [...history.current.slice(-19), prevData.current]; // cap undo at 20 deep snapshots (was 50) to bound memory on large boards
      future.current = []; // any new edit invalidates the redo stack
    }
    prevData.current = data;
  }, [data]);











  // ⛔ RETIRED (2026-08-25, B752848 owner correction): normalizeToV9 used to seed the now-deleted
  // `healthOverride` flag on load (green/red/paused → override:true). The flag and everything that
  // read it are gone, so this migration has nothing left to do; removed rather than left as a no-op,
  // per "delete it completely." Every call site below now calls normalizeToV8 directly.



  // Shared "apply a loaded / imported / restored data blob" pipeline. normalizeIds + ensureContacts are
  // defined INSIDE the load effect below, so importJSON + version-restore route through this ref rather
  // than re-calling them out of scope — calling them directly was a ReferenceError (import was broken).
  const applyLoadedDataRef = useRef(null);
  // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — the initial read can fail or hang (a slow/unreachable cloud). Inside
  // the shell a failed read must NOT fall back to the embedded demo SEED (that made an unreachable cloud look
  // like a working account, and its edits could then autosave over the real one): `data` stays null, the shell
  // is told "failed", and this effect re-runs on `loadTick` — on a backoff timer and on the shell's Retry.
  const [loadTick, setLoadTick] = useState(0);
  const loadAttemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false, retryTimer = null;   // a superseded attempt (Retry) must never apply its late result
    (async () => {


      // Expose the full normalize + cascade pipeline so importJSON + version-restore can reuse it (they
      // can't call normalizeIds/ensureContacts directly — those are scoped to this effect). Set
      // synchronously on mount, before the first await, so it's ready before any user import/restore.
      applyLoadedDataRef.current = (parsed) => {
        let d = loadDocument(parsed);
        d._pinnedClean = true;
        setHolidaySet(buildHolidaySet(d.settings?.holidays || DEFAULT_HOLIDAYS));
        const driftFound = [];   // B836 — same drift surfacing on import / version-restore
        const ancestorFound = [];   // NEW-1 (B1696640) — same ancestor-predecessor repair on import / version-restore
        Object.keys(d.projects).forEach(pid => {
          let tasks = d.projects[pid].tasks.map(({_pinStart, __wasDirectEdit, ...t}) => t);
          d.projects[pid] = {...d.projects[pid], tasks: recascadeWithDrift(tasks, pid, d.projects[pid].name || pid, driftFound, ancestorFound)};
        });
        if (driftFound.length) { setDriftNotice(driftFound); console.warn("[planar cascade-drift] imported/restored data had saved starts out of sync with predecessors (auto-recalculated, B835/B836):", driftFound); }
        if (ancestorFound.length) { setAncestorPredNotice(ancestorFound); console.warn("[planar ancestor-pred] imported/restored data had a task naming its own parent/ancestor as a predecessor (dropped, NEW-1):", ancestorFound); }
        try { window.storage.reseedScheduleBaseline && window.storage.reseedScheduleBaseline(d); } catch {}   // NEW-1 (2026-09-25) — see reseedScheduleBaseline's own header
        setData(resolveViewState(d));   // B1107680 — never let an import/restore's snapshot-time aPid/view yank this tab elsewhere
        // NEW-1 (B1696640) — this path runs well after the initial mount, so the normal
        // coreChanged-driven autosave effect (below) picks up the repair on its own; no explicit
        // save needed here the way the very-first-load path (below) requires one.
      };
      try {
        const _isMobile = window.innerWidth < 768;
        // Supabase is the source of truth for live edits — check it first.
        // __PLANAR_DATA__ is the seed used only when Supabase has no record yet.
        window.__planarCloudError = false; window.__planarAuthRequired = false;
        let r = null, readThrew = false, timer = null;
        try {
          r = await Promise.race([
            window.storage.get("hs-v1"),
            new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("hs-v1 read timed out")), LOAD_ATTEMPT_TIMEOUT_MS); }),
          ]);
        } catch { readThrew = true; }
        clearTimeout(timer);
        if (cancelled) return;
        if (readThrew) window.__planarCloudError = true;
        if (!r && window.__planarCloudError && window.self !== window.top) {
          window.__planarLoadStatus = "failed";
          postLoadState("failed");
          const n = ++loadAttemptRef.current;
          console.warn("[planar load] schedule read failed (attempt " + n + ") — retrying; nothing is written until it loads.");
          retryTimer = setTimeout(() => setLoadTick(t => t + 1), Math.min(LOAD_RETRY_MAX_MS, LOAD_RETRY_BASE_MS * Math.pow(2, n - 1)));
          return;
        }
        if (r) {
          const d = loadDocument(JSON.parse(r.value));
          // NOTE: a narrow viewport forces the GRID layout at RENDER time (see the body switch),
          // never by mutating the persisted `view` — baking "grid" into saved data let one phone
          // session overwrite the desktop's saved split/gantt preference across every device.
          // Enforce predecessor relationships on load
          // One-time migration: strip stale pinnedStart flags; after this only intentional pins persist
          const needsPinClean = !d._pinnedClean;
          d._pinnedClean = true;
          setHolidaySet(buildHolidaySet(d.settings?.holidays || DEFAULT_HOLIDAYS));
          const driftFound = [];   // B836 — collect non-pinned tasks whose saved start the recompute corrected
          const ancestorFound = [];   // NEW-1 (B1696640) — collect tasks whose predecessors named their own parent/ancestor
          Object.keys(d.projects).forEach(pid => {
            let tasks = d.projects[pid].tasks.map(t => {
              const {_pinStart, __wasDirectEdit, pinnedStart, ...rest} = t;
              if (!needsPinClean && pinnedStart) rest.pinnedStart = true; // preserve intentional pins
              return rest;
            });
            d.projects[pid] = {...d.projects[pid], tasks: recascadeWithDrift(tasks, pid, d.projects[pid].name || pid, driftFound, ancestorFound)};
          });
          if (driftFound.length) { setDriftNotice(driftFound); console.warn("[planar cascade-drift] saved starts that didn't match their predecessor chain were auto-recalculated on load (B835/B836):", driftFound); }
          if (ancestorFound.length) {
            setAncestorPredNotice(ancestorFound);
            console.warn("[planar ancestor-pred] a task named its own parent/ancestor as a predecessor — link dropped and dates recalculated (NEW-1):", ancestorFound);
            // NEW-1 (B1696640) — this repair happens on the very-first-load path, which the normal
            // autosave effect deliberately SKIPS (loading must never mint a new version on its own —
            // that's what made two freshly-opened tabs fight, B1107680). Without an explicit save
            // here, the corrected predecessors never reach storage, so the NEXT load re-reads the
            // same broken link and shows the same notice again — exactly the "fires on every load"
            // defect this item exists to end. attemptCloudSave strips view state itself
            // (stripViewState), so it doesn't need the resolved `d` resolveViewState below produces.
            attemptCloudSave(d);
          }
          try { window.storage.reseedScheduleBaseline && window.storage.reseedScheduleBaseline(d); } catch {}   // NEW-1 (2026-09-25) — see reseedScheduleBaseline's own header; THE fix for the reported false "saved elsewhere" banner
          setData(resolveViewState(d)); return;   // B1107680 — migrate the 13 view-state keys off the cloud doc on first read
        }
        // First load (Supabase empty) — seed from inline data or SEED constant
        const seed = window.__PLANAR_DATA__ || SEED;
        const d = loadDocument(seed);
          // Enforce predecessor relationships on load (seed data — no stale pins)
          setHolidaySet(buildHolidaySet(d.settings?.holidays || DEFAULT_HOLIDAYS));
          d._pinnedClean = true;
          // NEW-1 (B1696640) — a hand-embedded __PLANAR_DATA__ seed (or a future SEED edit) can
          // carry the same ancestor-predecessor bug as a real stored doc; route it through the same
          // strip+notice as the other two load paths rather than the bare recomputeSchedule this used
          // to call directly. No explicit save here — there's no stored doc yet to protect, and the
          // FIRST real save (of any edit) persists the already-clean result.
          const seedAncestorFound = [];
          Object.keys(d.projects).forEach(pid => {
            let tasks = d.projects[pid].tasks.map(({_pinStart, __wasDirectEdit, ...t}) => t);
            d.projects[pid] = {...d.projects[pid], tasks: recascadeWithDrift(tasks, pid, d.projects[pid].name || pid, [], seedAncestorFound)};
          });
          if (seedAncestorFound.length) {
            setAncestorPredNotice(seedAncestorFound);
            console.warn("[planar ancestor-pred] seed data had a task naming its own parent/ancestor as a predecessor (dropped, NEW-1):", seedAncestorFound);
          }
        if (window.__planarCloudError) setOfflineFallback(true);
        else if (window.__planarAuthRequired) setAuthRequired(true);
        try { window.storage.reseedScheduleBaseline && window.storage.reseedScheduleBaseline(d); } catch {}   // NEW-1 (2026-09-25) — see reseedScheduleBaseline's own header
        setData(resolveViewState(d));
      } catch {
        const d = loadDocument(window.__PLANAR_DATA__ || SEED);
        setOfflineFallback(true);
        try { window.storage.reseedScheduleBaseline && window.storage.reseedScheduleBaseline(d); } catch {}   // NEW-1 (2026-09-25) — no-op unless this account was already flipped before the error
        setData(resolveViewState(d));
      }
    })();
    return () => { cancelled = true; clearTimeout(retryTimer); };
  }, [loadTick]);

  useEffect(() => {
    if (!data) return;
    latestData.current = data;
    persistViewState(prevCoreRef.current, data);   // B1107680 — cheap, local-only; never touches the cloud

    // Don't re-save on initial load -- loading shouldn't mint a new version (that collision is what
    // made two freshly-opened tabs fight). B1107680 — and never re-save on a VIEW-ONLY change either:
    // navigating projects / resizing a column / zooming used to rewrite the whole versioned document
    // and bump __rev, which is exactly what made every OTHER open tab see a phantom "a newer version
    // was saved on another device" conflict from a mere navigation.
    const isFirstLoad = !didInitialLoad.current;
    if (isFirstLoad) didInitialLoad.current = true;
    const coreIsNew = coreChanged(prevCoreRef.current, data);
    prevCoreRef.current = data;
    if (!isFirstLoad && coreIsNew) attemptCloudSave(data);

    // Everything below derives from data.settings/data.projects (core, versioned fields) — skip it
    // entirely on a view-only change (VIEW-INDEPENDENT-ONCE: work whose inputs are the model/settings
    // must not be redone because the view moved). Always runs on first load.
    if (isFirstLoad || coreIsNew) {
      // Rebuild holiday set whenever settings change
      setHolidaySet(buildHolidaySet(data.settings?.holidays || DEFAULT_HOLIDAYS));
      ROW_H = Math.min(34, Math.max(20, data.settings?.rowHeight || 24));
      rebuildHEALTH(data.settings?.customHealth || [], data.settings?.healthLabelOverrides || {});
      // rebuildHEALTH mutates the module-scope HEALTH/HK/HDARK globals but doesn't itself
      // re-render; without this nudge a just-added/renamed status shows up one beat late
      // (you'd have to click around). Force one render when the status config actually
      // changed — keyed so it fires only on real changes, never looping (B5/M3).
      const healthKey = JSON.stringify([data.settings?.customHealth, data.settings?.healthLabelOverrides]);
      if (prevHealthKey.current !== null && healthKey !== prevHealthKey.current) setHealthTick(x => x + 1);
      prevHealthKey.current = healthKey;
      // Recascade all task dates when holidays change
      const holKey = JSON.stringify(data.settings?.holidays);
      if (!skipHolRecasc.current && holKey !== prevHolKey.current && prevHolKey.current !== null) {
        prevHolKey.current = holKey;
        skipHolRecasc.current = true;
        // Recompute from the LIVE `d` inside the updater, not the effect's closure snapshot — otherwise a
        // setData that lands between this effect's render and its callback (a realtime suggestion insert, an
        // autosave merge, a rapid second edit) would be clobbered by the stale projects map (data loss).
        // NEW-1 — this recascade is the automatic CONSEQUENCE of the holiday-settings edit that
        // triggered it, not a separate action; fold it into that same undo step (see isDerivedUpdate above).
        isDerivedUpdate.current = true;
        setData(d => {
          const newProjects = {};
          Object.entries(d.projects).forEach(([id, proj]) => {
            let tasks = proj.tasks.map(t => {
              if (t.pinnedEnd && t.end) return t;                        // preserve a locked finish (B616) — never re-derive its end
              const r = resolveTaskSpan(t); return {...t, end: r.end, duration: r.duration};  // unit-aware re-derive (days/weeks vs calendar)
            });
            tasks = recomputeSchedule(tasks);
            newProjects[id] = {...proj, tasks};
          });
          return {...d, projects: newProjects};
        });
      } else {
        if (skipHolRecasc.current) skipHolRecasc.current = false;
        else prevHolKey.current = holKey;
      }
      // B1161792 (NEW-1) — reconcile needsAttentionSince on every real data change (a task edit,
      // a rule/settings change, or the first load of an existing schedule). `reconcileNeedsAttention`
      // is a no-op (same `d` back) when nothing needs restamping, so this can't loop against its own
      // write. The complementary date-rollover case (health flips red with no edit at all) is
      // covered by the `refresh()` callback above.
      // NEW-1 — this write is a DERIVED restamp of a field the edit above already committed, not a
      // second edit; fold it into the same undo step (isDerivedUpdate — see its declaration for the
      // undo-stuck bug this fixes). Reset the flag immediately on a no-op (same ref back) so it can
      // never leak forward and swallow a later, unrelated edit's own history entry.
      isDerivedUpdate.current = true;
      setData(d => { const next = reconcileNeedsAttention(d); if (next === d) isDerivedUpdate.current = false; return next; });
    }
    if (fileHandleRef.current && fileHtmlRef.current) {
      clearTimeout(fileSaveTimer.current);
      fileSaveTimer.current = setTimeout(async () => {
        try {
          const tag = `<script id="planar-data">window.__PLANAR_DATA__=${JSON.stringify(data)};<\/script>`;
          let html = fileHtmlRef.current;
          if (html.includes('<script id="planar-data">')) {
            html = html.replace(/<script id="planar-data">[\s\S]*?<\/script>/, tag);
          } else {
            html = html.replace('<body>', '<body>\n' + tag);
          }
          fileHtmlRef.current = html;
          const writable = await fileHandleRef.current.createWritable();
          await writable.write(html);
          await writable.close();
        } catch(e) { console.warn('Auto-save failed:', e); }
      }, 700);
    }
  }, [data]);

  // Green save pulse — fires only when Supabase confirms the write, so gray
  // means "not yet confirmed" rather than "feature not set up"
  useEffect(() => {
    let t;
    const onSaved = () => { setSavePulse(true); setOfflineFallback(false); clearTimeout(t); t = setTimeout(() => setSavePulse(false), 1500); };
    window.addEventListener("planar:cloud-saved", onSaved);
    return () => { window.removeEventListener("planar:cloud-saved", onSaved); clearTimeout(t); };
  }, []);

  // While unsaved, retry automatically — every 20s, and the moment the
  // connection comes back. Red clears itself the instant a retry lands.
  useEffect(() => {
    if (saveStatus !== "error") return;
    const retry = () => { if (latestData.current) attemptCloudSave(latestData.current); };
    const iv = setInterval(retry, 20000);
    window.addEventListener("online", retry);
    return () => { clearInterval(iv); window.removeEventListener("online", retry); };
  }, [saveStatus]);

  // -- Multi-device live-refresh -- every 20s (and on focus / reconnect / tab
  // switch) ask the cloud whether another device saved a newer version. A clean
  // tab (everything saved) takes the latest: silently if it's backgrounded, or
  // via a one-click banner if you're looking at it. A tab with unsaved edits is
  // never auto-clobbered -- it just shows the banner. The storage-layer guard is
  // the hard backstop that blocks a stale save no matter what.
  // NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — this poll used to be
  // the only thing that ever SET the banner, with nothing to CLEAR it: once true, staleNotice
  // stayed true even after a later successful save/merge caught this tab up, so the banner could
  // sit on screen telling him to reload long after there was nothing left to reload for (and could
  // show at the same moment a "merged" toast just confirmed the opposite). Self-heals below: not
  // newer any more → clear it, the same way it was set.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || !window.storage || !window.storage.checkRemote) return;
      try {
        const r = await window.storage.checkRemote("hs-v1");
        if (!r || !r.ok) return;
        if (!r.newer) { setStaleNotice(false); return; }
        if (saveStatusRef.current === "saved" && document.hidden) { window.location.reload(); return; }
        // NEW-1 (false "newer version" banner on a flipped account, owner report 2026-09-25) — a
        // CLEAN (nothing unsaved), VISIBLE tab reporting "newer" almost always means some OTHER
        // instance of this same account (another keep-alive Scheduler iframe, another open tab) just
        // wrote — there is nothing of THIS tab's own to lose, so silently catch up instead of
        // nagging for a manual reload. A DIRTY tab (unsaved edits) still gets the banner below — it
        // has something to protect and a silent overwrite would be the wrong failure mode.
        if (saveStatusRef.current === "saved" && !document.hidden && window.storage.silentRefresh) {
          const fresh = await window.storage.silentRefresh("hs-v1");
          if (fresh && applyLoadedDataRef.current) { applyLoadedDataRef.current(fresh); setStaleNotice(false); return; }
        }
        setStaleNotice(true);
      } catch (e) {}
    };
    const iv = setInterval(check, 20000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => { stopped = true; clearInterval(iv); window.removeEventListener("focus", check); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check); };
  }, []);

  // The storage guard fired -- a save was blocked because the cloud moved ahead.
  useEffect(() => {
    const onStale = () => setStaleNotice(true);
    window.addEventListener("planar:stale", onStale);
    return () => window.removeEventListener("planar:stale", onStale);
  }, []);

  // B864(b) — a sibling tab's newer save was AUTO-MERGED with ours (a calendar it added, a task it edited).
  // Adopt the result so this tab's in-memory state converges with the cloud; reconcile against our CURRENT
  // state (mergeCloudDoc(ancestor, current, merged)) so any edit made during the save round-trip survives.
  useEffect(() => {
    const onMerged = (e) => {
      const merged = e && e.detail && e.detail.value;
      const anc = e && e.detail && e.detail.base;
      if (!merged || !merged.projects) return;
      // NEW-3 (B1696642) — this merge is detected purely from the cloud ROW's rev number, which
      // carries no tab/window/device identity. The old "from another tab" wording claimed a scope
      // this app can never actually know (it fires identically for another window or another device
      // entirely — the owner saw it while working in only one tab) — say only what's known: that
      // something changed elsewhere, and how many rows it touched.
      // NEW-1 (owner follow-on 2026-09-16) — "elsewhere" used to mean only "some other tab/device";
      // it never said WHICH of the account's schedules the merge actually landed in, even though the
      // cloud document holds every schedule under every project and a merge can land in one the user
      // isn't even looking at. changedProjectIds + mergeLocationPhrase name it (dropping the name
      // when the only schedule touched is the one already on screen — nothing to disambiguate there).
      const changedRows = countChangedTaskRows(anc, merged);
      const changedPids = changedProjectIds(anc, merged);
      const where = mergeLocationPhrase(merged.projects, changedPids, dataRef.current?.aPid);
      // NEW-1 (false "newer version"/empty merge toast on a flipped account, owner report
      // 2026-09-25) — a "merge" whose result is byte-identical to what this tab already had is not
      // news: it's the per-schedule write path (writeScheduleRowsPrimary) reconciling a rev this tab
      // was simply a save behind on, with no actual content difference (see reseedScheduleBaseline
      // and writeOneScheduleRow's identical-content adoption). countChangedTaskRows alone only
      // checks TASK content; also require the merged doc's whole `projects` tree to be byte-equal to
      // the ancestor's, so a real non-task change (a schedule's name/linkedSiteId) still toasts.
      const trulyEmpty = changedRows === 0 && _mEq(merged.projects, anc && anc.projects);
      setData(cur => {
        if (!cur) return applyTaskFocus(merged);
        try { return applyTaskFocus(mergeCloudDoc(anc, cur, merged)); } catch { return applyTaskFocus(merged); }   // NEW-1 (2026-10-02) — a merged-in remote doc carries no `focused`
      });
      // NEW-1 — a successful merge means this tab is caught up (its own save just became the new
      // top cloud version), so any "reload for the latest" banner is now stale advice — clear it
      // rather than let a toast saying "merged" and a banner saying "reload" sit on screen together
      // (the owner's report, verbatim: a banner "keeps appearing" alongside a green merge toast).
      setStaleNotice(false);
      if (!trulyEmpty && typeof showToast === "function") {
        const msg = changedRows > 0
          ? `Merged in changes saved elsewhere — ${changedRows} task${changedRows===1?"":"s"} updated${where ? " " + where : ""}.`
          : "Merged in changes saved elsewhere.";
        showToast(msg, { type: "info", duration: 4000 });
        logMergeToastEvent(changedRows, changedPids, merged.projects);
      }
    };
    window.addEventListener("planar:merged", onMerged);
    return () => window.removeEventListener("planar:merged", onMerged);
  }, []);

  // Last line of defense: if the tab is closed while the latest changes
  // haven't reached the cloud, the browser asks for confirmation first.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (saveStatusRef.current === "saved") return;
      e.preventDefault(); e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // True while any blocking overlay (modal / context menu / panel) is open. Read by the global key
  // handler below so document-level grid shortcuts (Delete / Insert / undo / paste / arrows) can't
  // fire on the hidden grid behind a modal — e.g. Delete behind the Successor prompt was clearing /
  // deleting the still-selected row or cell. A ref (not an effect dep) keeps the always-attached key
  // listener fresh without re-binding it every time a panel opens.
  const overlayOpenRef = useRef(false);
  useEffect(() => {
    overlayOpenRef.current = !!(successorPrompt || notesCtx || projCtx || taskCtx || renameModal ||
      deleteChoice || pdfExportOpen || formatOpen || settingsOpen || automationOpen || contactsOpen ||
      historyOpen || reviewOpen || meetingCalOpen);
  }, [successorPrompt, notesCtx, projCtx, taskCtx, renameModal, deleteChoice, pdfExportOpen, formatOpen,
      settingsOpen, automationOpen, contactsOpen, historyOpen, reviewOpen, meetingCalOpen]);

  /* NEW-1 — ⛔ THE GUARD ABOVE ASKS "IS AN OVERLAY OPEN?" AND THE RIGHT QUESTION IS "DID THIS
   * KEYSTROKE BEGIN WHILE ONE WAS?" — those differ for exactly one keystroke, the one that
   * DISMISSES the overlay, and that is the keystroke that caused the bug.
   *
   * Measured: press Enter on the successor prompt and the modal applies and closes itself
   * synchronously, so by the time this same event reaches the document-level handler below the ref
   * already reads false. The handler then does what Enter on a picker column is designed to do —
   * fire a synthetic click on the dot and open the picker — so the status menu the user had just
   * closed REAPPEARS. It is not the first menu left orphaned; it is a second one, opened by the
   * keystroke that dismissed the prompt. Enter left a menu up 7/7; Escape 0/7; the ✕ button 0/7;
   * and with no prompt in play, picking a swatch left one up 0/9.
   *
   * WHY LATCHING AND NOT "THE MODAL SWALLOWS THE KEY": making SuccessorPromptModal call
   * stopImmediatePropagation fixes SuccessorPromptModal. Thirteen overlays feed the ref above, and
   * the next one added would arrive with the same hole — the defect is in the QUESTION the guard
   * asks, not in any one modal's manners. Latching in capture (window capture runs before anything
   * on document, and before React's root handler) records the answer while it is still true, so
   * every overlay is covered by construction and no modal has to remember anything.
   *
   * It deliberately does NOT touch the legitimate feature: with no overlay in play the latch is
   * false at keydown, and Enter on a picker column still opens the picker. Both directions asserted
   * in ui-audit/verify-grid-overlay-input.mjs. */
  const overlayAtKeyStartRef = useRef(false);
  useEffect(() => {
    const latch = () => { overlayAtKeyStartRef.current = overlayOpenRef.current; };
    window.addEventListener("keydown", latch, true);
    return () => window.removeEventListener("keydown", latch, true);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      // A modal/menu owns the keyboard — don't run grid shortcuts behind it. `overlayAtKeyStart`
      // also covers the keystroke that DISMISSED the overlay: by the time that one arrives here the
      // modal has already closed itself, so the live ref reads false and the grid would act on a key
      // the user aimed at the modal (NEW-1 — that is what re-opened the status menu).
      if (overlayOpenRef.current || overlayAtKeyStartRef.current) return;
      const tag = document.activeElement.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Insert" && !typing) {
        e.preventDefault();
        if (!e.repeat) insertTask();
        return;
      }
      // NEW-1 (B2455200) — Alt+F toggles Focus for the group of the TOP selected row (see focusToggleTarget).
      // e.code, not e.key: with Alt held a Mac reports "ƒ". Never while a cell is being edited (an input has
      // focus, or the editor state is open) — then the key is left entirely alone. Outside editing,
      // preventDefault always runs (even when there is no group to toggle) so Chrome's own File menu never
      // opens on Windows: Alt+F is ours everywhere on the grid, consistently.
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "KeyF" &&
          !typing && !document.activeElement?.isContentEditable && !editLiveRef.current) {
        e.preventDefault();
        if (e.repeat) return;
        const ids = rowRangeSelIds();
        toggleGroupFocus(ids.length ? ids[0] : selectedId, selectedId);
        return;
      }
      if (e.key === "Delete" && !typing) {
        if (!e.repeat && selectedId !== null) {
          e.preventDefault();
          const lastColIdx = activeEffectiveCols(dataRef.current).length - 1;
          // B2530690 — EVERY range must be a full row for Delete to remove rows (ID-column select, Ctrl+click on
          // row numbers); any cell range in the mix makes Delete clear contents instead, as in Excel.
          const isFullRow = selRange && rangesOf(selRange).every(g => g.c1 === 0 && g.c2 === lastColIdx);
          if (isFullRow) {
            // Delete every row in the selected span (ID-column drag /
            // shift-click) — asks first if any of them have subtasks (requestDelete);
            // otherwise deletes immediately, exactly as before.
            const ids = fullRowSelIds();
            requestDelete(ids.length ? ids : [selectedId]);
            return;
          }
          // Multi-cell range delete (Excel-style): blank every editable, non-locked, non-picker cell in
          // the span — mirrors the fill path (typing into a range fills the whole range), which Delete
          // previously didn't match (it only cleared the focused cell).
          const cols = activeEffectiveCols(dataRef.current);
          if (selIsRange(selRange)) {
            const ftasks = flatTasksRef.current;
            // every cell of every range, grouped by row so each task gets ONE updateTask (one undo step overall)
            const byRow = new Map();
            cellsOf(selRange).forEach(({r, c}) => { if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(c); });
            for (const [r, cs] of byRow) {
              const t = ftasks[r]; if (!t) continue;
              const patch = {};
              for (const c of cs) {
                const col = cols[c];
                if (!col?.e || col.t === "health" || col.t === "notes") continue;
                if (t.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost")) continue;
                patch[col.k] = (col.k === "duration" || col.k === "percentComplete") ? 0 : "";
              }
              if (Object.keys(patch).length) updateTask(t.id, patch);
            }
            return;
          }
          // Fix #7: Delete on a single cell clears its value (Excel-style)
          const col = cols[selectedColIdx];
          if (col?.e && col.t !== "health" && col.t !== "notes") {
            const selTask = flatTasksRef.current.find(t => t.id === selectedId);
            const isParentDateLocked = selTask?.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost");
            if (!isParentDateLocked) {
              const blank = (col.k === "duration" || col.k === "percentComplete") ? 0 : "";
              updateTask(selectedId, {[col.k]: blank});
            }
          }
        }
        return;
      }
      // NEW-1 (B2451776) — Ctrl/Cmd+Arrow: jump across blank cells like Excel (the rule and the definition of
      // "blank" live in src/workspaces/scheduler/lib/gridCtrlNav.js; the three functions are mirrored near
      // stepGridRow). NAVIGATION MODE ONLY: a focused input / an open cell editor (editLiveRef) / a contentEditable
      // all fall through untouched so Ctrl+Arrow still moves by word in the text. preventDefault runs only once the
      // grid has an anchor to move from. Ctrl+Shift+Arrow extends the Shift+Arrow range from its moving end.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && selectedId !== null &&
          !document.activeElement?.isContentEditable && !editLiveRef.current &&
          (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const flat = flatTasksRef.current;
        const NEW_ROW = "__NEW_TASK__";
        const anchorRow = selectedId === NEW_ROW ? flat.length : flat.findIndex(t => t.id === selectedId);
        if (anchorRow < 0) return;                       // the selected row is hidden / gone — nothing to anchor on
        e.preventDefault();
        const proj = activeProjectOf(dataRef.current);
        const eff = activeEffectiveCols(dataRef.current);
        let formulas = null, succIds = null;             // built lazily — only if a scan actually reaches such a column
        const env = {
          formula: (id, k) => { if (!formulas) formulas = computeFormulaValues(flat, formulaColsOf(proj), proj); return formulas[id]?.[k]; },
          predCount: arr => normPreds(arr).length,
          succCount: id => {
            if (!succIds) { succIds = new Set(); (proj?.tasks || []).forEach(t => normPreds(t.predecessors).forEach(p => succIds.add(p.id))); }
            return succIds.has(id) ? 1 : 0;
          },
          ownerCount: t => ownerListOf(t).length,
          floatDays: t => t.hasChildren ? null : meetingFloatBD(t, fdLocal(new Date())),
          costDays: t => t.hasChildren ? null : meetingCostDays(t, MEETING_BODY_INDEX[t.meetingBodyId]),
        };
        // "+ New task" (row === flat.length) is a blank row to scan THROUGH, never a destination.
        const blankAt = (r, c) => r >= flat.length || !eff[c] ? true : gridCellBlank(flat[r], eff[c], env);
        const colMasters = visibleColIdxs();
        if (e.shiftKey) {
          if (selectedId === NEW_ROW) return;            // Shift+Arrow ignores "+ New task" too
          const cur = selRange || {r1:anchorRow, r2:anchorRow, c1:selectedColIdx, c2:selectedColIdx};
          const t = gridCtrlArrowTarget(e.key, flat.length, colMasters, cur.r2, cur.c2, blankAt);
          if (t) {
            setSelRange(withActive(cur, {r1:cur.r1, c1:cur.c1, r2:t.row, c2:t.col}));
            // the range's moving end is not the selection, so the grid's selection-chase doesn't follow it — ask it to
            document.dispatchEvent(new CustomEvent("planar-reveal-cell", {detail: {row: t.row, col: t.col}}));
          }
          return;
        }
        const t = gridCtrlArrowTarget(e.key, flat.length, colMasters, anchorRow, selectedColIdx, blankAt);
        if (t) {
          setSelectedColIdx(t.col);
          if (t.row !== anchorRow && flat[t.row]) setSelectedId(flat[t.row].id);
          setSelRange(null);
        }
        return;
      }
      // Fix #8: Ctrl/Cmd+Z → undo; Ctrl+Y / Ctrl+Shift+Z → redo
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          if (history.current.length > 0) {
            const prev = history.current[history.current.length - 1];
            history.current = history.current.slice(0, -1);
            future.current = [...future.current, dataRef.current];  // push the LIVE current state (the keydown effect omits `data` from its deps, so the closure `data` is stale — using it stored wrong redo snapshots and lost the redone edit)
            isUndoing.current = true;
            setData(prev);
          }
          return;
        }
        if (k === "y" || (k === "z" && e.shiftKey)) {
          e.preventDefault();
          if (future.current.length > 0) {
            const next = future.current[future.current.length - 1];
            future.current = future.current.slice(0, -1);
            history.current = [...history.current, dataRef.current];  // live current state, not the stale closure `data` (see undo branch)
            isUndoing.current = true;
            setData(next);
          }
          return;
        }
        // Ctrl/Cmd+C — copy the selected task (and its whole subtree) to the task clipboard, or the
        // WHOLE active row selection when selectedId is part of one (structuralTargets — same rule
        // indent/outdent/delete already use). Only fires when the row is selected at task level (no
        // cell-text selection); the typing-guard above already prevents this from stealing copy from
        // input fields.
        if (k === "c" && !e.shiftKey && selectedId !== null) {
          e.preventDefault();
          copyTaskById(structuralTargets(selectedId));
          return;
        }
        // Ctrl/Cmd+X — cut: same as copy, but the next paste removes the source.
        if (k === "x" && !e.shiftKey && selectedId !== null) {
          e.preventDefault();
          cutTaskById(structuralTargets(selectedId));
          return;
        }
        // Ctrl/Cmd+V — paste the clipboard's subtree below the currently-selected task,
        // as a sibling at the target's level. Internal predecessors are remapped; external
        // ones stay valid in the same project.
        if (k === "v" && !e.shiftKey && selectedId !== null) {
          e.preventDefault();
          pasteTaskAfter(selectedId);
          return;
        }
      }
      // Alt+Shift+Right → indent (make subtask of row above) — acts on the WHOLE selected row
      // range when one is active, not just the anchor cell (see rowRangeSelIds/structuralTargets).
      if (e.altKey && e.shiftKey && e.key === "ArrowRight" && !typing) {
        e.preventDefault();
        if (!e.repeat && selectedId !== null) { const ids = blockOnlyTargets(selectedId); if (ids) indentSelectionByIds(ids); }
        return;
      }
      // Alt+Shift+Left → outdent (promote one level up) — same whole-selection scope as indent.
      if (e.altKey && e.shiftKey && e.key === "ArrowLeft" && !typing) {
        e.preventDefault();
        if (!e.repeat && selectedId !== null) { const ids = blockOnlyTargets(selectedId); if (ids) outdentSelectionByIds(ids); }
        return;
      }
      // Fix #2: Tab / Shift+Tab — advance to next/previous column (Excel-style)
      if (e.key === "Tab" && !typing && selectedId !== null) {
        e.preventDefault();
        if (e.shiftKey) {
          setSelectedColIdx(i => stepGridCol(i, -1));
        } else {
          setSelectedColIdx(i => stepGridCol(i, +1));
        }
        setSelRange(null);
        return;
      }
      // Fix #9: Shift+Arrow — extend selection range
      if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !typing && selectedId !== null) {
        const arrowKeys = ["ArrowDown","ArrowUp","ArrowLeft","ArrowRight"];
        if (arrowKeys.includes(e.key)) {
          e.preventDefault();
          const ftasks = flatTasksRef.current;
          const anchorRi = ftasks.findIndex(t => t.id === selectedId);
          if (anchorRi >= 0) {
            const cur = selRange || {r1:anchorRi, r2:anchorRi, c1:selectedColIdx, c2:selectedColIdx};
            let {r1, r2, c1, c2} = cur;
            if (e.key === "ArrowDown")  r2 = Math.min(ftasks.length - 1, r2 + 1);
            if (e.key === "ArrowUp")    r2 = Math.max(0, r2 - 1);
            if (e.key === "ArrowRight") c2 = stepGridCol(c2, +1);
            if (e.key === "ArrowLeft")  c2 = stepGridCol(c2, -1);
            setSelRange(withActive(cur, {r1, r2, c1, c2}));   // B2530690 — only the newest range extends
          }
          return;
        }
      }
      // Shift+Space — select entire current row
      if (e.shiftKey && e.key === " " && !e.ctrlKey && !e.metaKey && !typing && selectedId !== null) {
        e.preventDefault();
        const tasks = flatTasksRef.current;
        const ri = tasks.findIndex(t => t.id === selectedId);
        if (ri >= 0) setSelRange({r1:ri, r2:ri, c1:0, c2:activeEffectiveCols(dataRef.current).length-1});
        return;
      }
            // Enter / F2 — open edit with existing value; notes → open modal; pickers → open picker
      if (!e.altKey && !e.ctrlKey && !e.metaKey && !typing && selectedId !== null &&
          (e.key === "Enter" || e.key === "F2")) {
        if (selectedId === "__NEW_TASK__") {
          e.preventDefault();
          openNameEditOnReveal.current = true;
          addTask();
          return;
        }
        const col = activeEffectiveCols(dataRef.current)[selectedColIdx];
        if (col) {
          e.preventDefault();
          if (col.t === "notes") {
            const pid = projIdRef.current;
            if (pid !== null) setNotesCtx({taskId: selectedId, projectId: pid});
          } else if (col.k === "health" || col.k === "status") {
                        // Fix #5: Enter on a picker column opens its picker (same as Alt+Down)
            const cell = document.querySelector(`[data-picker-cell="${col.k}-${selectedId}"]`);
            const trigger = cell?.querySelector("[data-health-dot], span[style]") || cell?.firstElementChild;
            trigger?.click();
          } else if (col.e) {
              const selTask = flatTasksRef.current.find(t => t.id === selectedId);
              const isParentDateLocked = selTask?.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost");
              if (!isParentDateLocked) setEdit({taskId: selectedId, col: col.k});
          }
          return;
        }
      }
      // Type-to-edit — any printable key opens the cell and seeds it with that character
      if (!e.altKey && !e.ctrlKey && !e.metaKey && !typing && selectedId !== null && e.key.length === 1) {
        if (selectedId === "__NEW_TASK__") return; // no-op on the "+ New task" affordance
        const col = activeEffectiveCols(dataRef.current)[selectedColIdx];
        if (col) {
          if (col.t === "notes") {
            const pid = projIdRef.current;
            if (pid !== null) { e.preventDefault(); setNotesCtx({taskId: selectedId, projectId: pid, initChar: e.key}); }
            return;
          }
          if (col.e && col.t !== "health") {
            const selTask = flatTasksRef.current.find(t => t.id === selectedId);
            const isParentDateLocked = selTask?.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost");
            if (isParentDateLocked) return;
            // Fix #3: numeric columns reject non-digit type-to-edit (matches Grid view behaviour)
            const isNum = col.k === "duration" || col.k === "percentComplete";
            if (isNum && !/\d/.test(e.key)) return;
            e.preventDefault();
            setEdit({taskId: selectedId, col: col.k});
            setEditStartChar(e.key);
            return;
          }
        }
      }
      // Alt+Down — open picker for health and status columns
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowDown" && !typing && selectedId !== null) {
        const col = activeEffectiveCols(dataRef.current)[selectedColIdx];
        if (col?.k === "health" || col?.k === "status") {
          e.preventDefault();
          const cell = document.querySelector(`[data-picker-cell="${col.k}-${selectedId}"]`);
          const trigger = cell?.querySelector("[data-health-dot], span[style]") || cell?.firstElementChild;
          trigger?.click();
          return;
        }
      }
      // Plain arrow keys — cell navigation (no modifiers, not typing)
      if (!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !typing) {
        const isArrow = e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight";
        if (isArrow) {
          // Close any open picker when navigating away
          document.dispatchEvent(new CustomEvent("planar-picker-open", {detail: "nav"}));
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          // NEW-1 — one row from where the selection IS (or, if its row is hidden / deleted, from the gap it
          // left), via stepGridRow. The old inline fallbacks sent a lost selection to the first or last row.
          e.preventDefault();
          const tasks = flatTasksRef.current;
          const target = stepGridRow(tasks, activeProjectOf(dataRef.current)?.tasks || [], selectedId,
            e.key === "ArrowDown" ? +1 : -1, lastSelIdxRef.current, viewportTopFlatIdx(tasks));
          if (target != null) { setSelectedId(target); setSelRange(null); }
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSelectedColIdx(i => stepGridCol(i, +1));
          setSelRange(null);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSelectedColIdx(i => stepGridCol(i, -1));
          setSelRange(null);
          return;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // NOTE: deleteTask/insertTask/requestDelete/indentSelectionByIds/outdentSelectionByIds/
    // structuralTargets/rowRangeSelIds/fullRowSelIds are intentionally NOT in this dependency
    // array. They are defined later in this component; the by-id helpers are stable
    // (useCallback([])) and read the current selection via `selectedId`/`selRange`, which ARE
    // dependencies here — so the listener re-binds (capturing the fresh selection) whenever either
    // changes. Referencing the helpers directly here would read them before initialization if the
    // build ever kept `const` block-scoping instead of hoisting to `var`.
  }, [selectedId, selectedColIdx, selRange, isUndoing]);

  // NEW-1 (B2455200) — the Alt+F action: flips `focused` through updateTask, i.e. EXACTLY what the summary row's
  // Focus chip does, so it is undoable the same way (one history step, Ctrl+Z). A multi-row selection
  // collapses to its top row (the toggle changes which rows exist, so the old row range would be stale). The
  // insert pins are dropped in the same batch (a Focus toggle re-applies the filter — the focusSig effect does
  // it too, but one render later). The selection follows below, in the focusSig layout effect.
  const toggleGroupFocus = (anchorId, selId) => {
    const all = activeProjectOf(dataRef.current)?.tasks || [];
    const gid = focusToggleTarget(all, anchorId);
    if (gid == null) return;
    const g = all.find(t => t.id === gid);
    if (!g) return;
    focusReselectRef.current = { selId };   // the row that IS selected (a range's cursor), not the range's top row
    setFocusPins(p => (p.size ? new Set() : p));
    setSelRange(null);
    updateTask(gid, { focused: !g.focused });
    // The chip is only drawn on an EXPANDED summary with something to hide; when it is not, say what happened.
    const row = (flatTasksRef.current || []).find(t => t.id === gid);
    if (!(row && row.isExpanded && row.hideableCount > 0))
      showToast(`Focus ${g.focused ? "off" : "on"} for "${g.name || "Untitled"}"` + (g.isExpanded ? " — nothing to hide in it yet" : " — expand the group to see it"), { type: "success", duration: 2500 });
  };

  // Ctrl+scroll → zoom Gantt timeline instead of browser zoom
  // RAF-throttled so rapid scrolling doesn't overwhelm React with renders
  const zoomRafRef = useRef(null);
  const zoomAccRef = useRef(0);
  useEffect(() => {
    // NEW-1 (2026-11-03) — a NON-PASSIVE wheel listener on the window makes the browser hold EVERY wheel notch until the
    // page's main thread has run it, so a busy frame (a row commit, a recompute) stalls the scroll itself — the grid
    // "sticks" and then jumps. The handler only ever acts when Ctrl/Cmd is down, so it is registered ONLY while one is
    // (keydown → add, keyup / blur → remove); a plain wheel never meets a blocking listener.
    // NEW-1 (2026-11-06, B2693?) — "i want ctrl zoom to always work if im hovering over the schedule". The gate above armed
    // from this frame's OWN key events only, so with keyboard focus anywhere else in the app (the header, a project switcher,
    // another panel) a Ctrl press never reached the frame, no listener existed, and Ctrl+wheel zoomed the BROWSER PAGE. It is
    // now armed from three more places, none of which leaves a blocking listener at rest (measured: a permanent one adds
    // ~15 ms to EVERY wheel→scroll at every CPU speed — docs on the B2644624 / NEW-1 entries):
    //   · any pointer event over the frame that carries the modifier (a pointer event reports Ctrl/Cmd even when the key went
    //     to another document — covers "Ctrl held in the address bar, then the mouse moves in");
    //   · the shell forwards Ctrl/Cmd down/up/blur from ITS window (`planar:modifier-keys`, Scheduler.jsx) — covers focus
    //     anywhere in the app, with the pointer resting still;
    //   · (unchanged) this frame's own keydown/keyup/blur.
    // NOT covered, by design: focus outside the page document with the pointer not moving after Ctrl goes down, and a
    // trackpad pinch (Chrome sends it as a ctrl+wheel with no key at all).
    let armed = false;
    const arm = on => {
      if (on === armed) return; armed = on;
      if (on) window.addEventListener("wheel", onWheel, {passive: false});
      else window.removeEventListener("wheel", onWheel);
    };
    const onKey = e => arm(!!(e.ctrlKey || e.metaKey));
    const onPointer = e => arm(!!(e.ctrlKey || e.metaKey));
    const onShellKeys = e => {
      if (!e || e.origin !== window.location.origin) return; // same-origin shell only (audit batch A)
      const m = e && e.data;
      if (!m || m.source !== "planar-shell" || m.type !== "planar:modifier-keys") return;
      arm(!!(m.ctrl || m.meta));
    };
    const onBlur = () => arm(false);
    const onWheel = e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAccRef.current += e.deltaY;
      if (zoomRafRef.current) return;
      zoomRafRef.current = requestAnimationFrame(() => {
        const delta = zoomAccRef.current;
        zoomAccRef.current = 0;
        zoomRafRef.current = null;
        if (hoverZoneRef.current === 'grid') {
          setGridZoom(z => {
            const factor = delta < 0 ? 1.12 : 1 / 1.12;
            const nz = Math.max(0.5, Math.min(2.0, Math.round(z * factor * 100) / 100));
            setData(d => ({...d, gridZoom: nz}));
            return nz;
          });
        } else {
          setGanttPPD(z => {
            const factor = delta < 0 ? 1.15 : 1 / 1.15;
            return Math.max(1, Math.min(80, Math.round(z * factor * 10) / 10));
          });
        }
      });
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("pointermove", onPointer, {capture: true, passive: true});
    window.addEventListener("pointerdown", onPointer, {capture: true, passive: true});
    window.addEventListener("message", onShellKeys);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("pointermove", onPointer, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("message", onShellKeys);
      window.removeEventListener("blur", onBlur);
      arm(false);
      if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
    };
  }, []);

  const updateTask = useCallback((taskId, updates, projId=null) => {
    const updatesIn = updates;   // the caller's patch; inside the updater `updates` is the gate's rewritten COPY (resolveBoundEdit), this one feeds the post-setData health prompt
    setData(d => {
      const pid = projId ?? d.aPid;
      // NEW-1 (2026-11-03) — a date reaching a meeting-bound row from an EDIT is resolved forward to a real
      // meeting HERE, before anything is stored: the one choke point for typed Start/Finish, range fill,
      // the task editor, suggestion approval and (re)binding. See resolveBoundEdit.
      const boundEdit = resolveBoundEdit(d.projects[pid]?.tasks || [], taskId, updatesIn, id => MEETING_BODY_INDEX[id]);
      const updates = boundEdit.updates;
      const _origStart = ((d.projects[pid]?.tasks || []).find(t => t.id === taskId) || {}).start || "";
      const _beforeTasks = d.projects[pid]?.tasks || [];   // NEW-1 — the pre-edit flags, for the "did THIS edit create a conflict" diff
      const _prevBoundStart = {};   // B816 — capture bound-task meeting dates BEFORE the edit, to detect rolls
      (d.projects[pid]?.tasks || []).forEach(t => { if (t.meetingBound && t.start) _prevBoundStart[t.id] = t.start; });
      let tasks = d.projects[pid].tasks.map(t => {
        if (t.id !== taskId) return t;
        const u = {...t, ...updates, ...completionDelta(t, updates)};   // B1953795 (S2) — keep status + % consistent on every leaf edit
        // ⛔ RULES-DECIDE (2026-08-25, owner correction) — RETIRED: a directly-picked status (StatusPicker /
        // context menu / grid cell / master-view cell) used to auto-stamp the override flag on every
        // plain color pick, silently opting the task out of automation forever — that's the exact
        // defect behind "why is an overdue task not turning red" (a single ordinary status click on a
        // task set healthOverride, and rules could never touch it again). The flag itself is now gone
        // (computeDisplayHealth never reads it), so an ordinary pick just writes `health`, full stop.
        // Sanitize rowColor — only allow known hex colors or null
        if ('rowColor' in updates) u.rowColor = isValidColor(updates.rowColor) ? updates.rowColor : null;
        // Sanitize per-task text-format overrides to strict booleans (so junk data can't render)
        if ('bold' in updates)      u.bold      = !!updates.bold;
        if ('italic' in updates)   u.italic    = !!updates.italic;
        // NEW-2 — underline/textColor/fontSize follow the exact same sanitize-on-write shape as
        // bold/italic/rowColor above: a strict boolean, a known-hex-or-null color, a clamped-or-null size.
        if ('underline' in updates) u.underline = !!updates.underline;
        if ('textColor' in updates) u.textColor = isValidColor(updates.textColor) ? updates.textColor : null;
        if ('fontSize' in updates)  u.fontSize  = isValidFontSize(updates.fontSize) ? updates.fontSize : null;
        // NEW-1 (task icons) — `icons` is its OWN field (0–2 emoji / "c:<name>" ids), never part of the name. Sanitised on
        // write like the format fields above; an empty list DELETES the key so an icon-free schedule is byte-identical to today.
        if ('icons' in updates) { const ic = PlanyrTaskIcons.normalizeTaskIcons(updates.icons); if (ic.length) u.icons = ic; else delete u.icons; }
        if ('predecessors' in updates) {
          u.predecessors = normPreds(updates.predecessors);
          // Editing a predecessor is an explicit instruction to let the cascade
          // control this task's start. Clear any manual pin so it takes effect.
          delete u.pinnedStart;
        }
        // Fold a duration edit into the typed-intent model (durValue/durUnit); a legacy programmatic
        // {duration} edit (range-fill / import) maps to days so back-compat consumers are unaffected.
        if ('duration' in updates && !('durValue' in updates) && !('durUnit' in updates)) { u.durUnit = 'd'; u.durValue = Math.max(0, Math.trunc(Number(updates.duration) || 0)); }
        if (('durValue' in updates) || ('durUnit' in updates)) { u.durUnit = u.durUnit || 'd'; if (u.durValue == null) u.durValue = 0; }
        const durEdited = ('duration' in updates) || ('durValue' in updates) || ('durUnit' in updates);
        if ((durEdited || ('start' in updates)) && !('end' in updates)) {
          // Duration or start is the source of truth → derive end + working-day count from the unit.
          // EXCEPT when a finish is locked (B616): the locked end wins; cascadeDates back-calcs the
          // start and flags a conflict — never let a duration edit silently overwrite the lock.
          if (!(u.pinnedEnd && u.end)) { const r = resolveDuration(u.start, taskDurValue(u), taskDurUnit(u)); u.end = r.end; u.duration = r.duration; }
        }
        else if ('end' in updates && !('start' in updates)) {
          // Typing a Finish PINS it as a hard-finish constraint (B616), mirroring the start lock.
          // Setting a Finish on a task that has no Start anchors a 1-day task on that date instead
          // of leaving duration "" (which rendered a bare "d") and letting the cascade wipe it.
          if (u.end && !u.start) { u.start = u.end; u.durUnit = 'd'; u.durValue = 1; u.duration = 1; }
          else { u.duration = (u.start && u.end) ? Math.max(0, difBD(u.start, u.end) + 1) : 0; u.durUnit = 'd'; u.durValue = u.duration; }  // numeric 0, never "" (no bare "d")
          u.pinnedEnd = !!u.end;                    // a real typed finish locks; clearing it unlocks (flow resumes)
        }
        // Start directly set (drag/manual date): pin position, successors still cascade from new end
        if ('start' in updates && !('predecessors' in updates)) u.pinnedStart = true;
        // NEW-1 — binding a dated row: its own date moves forward to a real meeting WITHOUT pinning it.
        if (boundEdit.startOverride) { u.start = boundEdit.startOverride; u.end = boundEdit.startOverride; }
        return u;
      });
      // When health changes on a parent, cascade to all descendants
      if ('health' in updates) {
        const getDescIds = (id, all) => {
          const kids = all.filter(t => t.parentId === id);
          return [...kids.map(k => k.id), ...kids.flatMap(k => getDescIds(k.id, all))];
        };
        const descIds = new Set(getDescIds(taskId, tasks));
        if (descIds.size > 0) {
          // ⛔ RULES-DECIDE (2026-08-25, owner correction): this cascade used to also set the
          // override flag on every descendant so it couldn't immediately be undone by a firing
          // rule. That flag is gone — a rule now decides every
          // cascaded descendant's displayed color exactly like any other task, same as the parent.
          tasks = tasks.map(t => descIds.has(t.id) ? {...t, health: updates.health, ...cascadeDelta(t, updates.health)} : t);
        }
      }
      if (touchesSchedule(updates)) {   // B835 (recurrence ×2) — fires for durValue/durUnit (typed duration) + pinnedStart/pinnedEnd (unpin/unlock) too, not just {duration}/{start}
        tasks = recomputeSchedule(tasks);
        // B816 — a bound task whose meeting moved from a prior meeting rolled a cycle; announce it
        // (once). Written to rollToastRef (not shown directly) — see its declaration for why: this
        // updater can run either synchronously or on a deferred render, and only the ref survives
        // both timings (B1539585).
        const editedT = tasks.find(t => t.id === taskId);
        // NEW-1 — the row the person edited announces ITS OWN move (below), never as an "agenda closed" roll.
        // B2642096 ×2 — settled against the CASCADED row: never announce a move the row didn't make.
        const _settled = settleBoundNotice(boundEdit, editedT && editedT.start);
        if (_settled && !rollToastRef.current) rollToastRef.current = boundEditNotice(_settled, editedT && editedT.name, fmtD);
        for (const t of tasks) {
          const prev = _prevBoundStart[t.id];
          if (t.id === taskId && ('start' in updates || 'end' in updates || boundEdit.rebinding)) continue;
          if (!rollToastRef.current && t.meetingBound && prev && t.start && t.start !== prev) {
            const body = MEETING_BODY_INDEX[t.meetingBodyId];
            if (body && !body.agendaLead) rollToastRef.current = `${t.name || "Task"} moved to ${fmtD(t.start)}, the next ${body.name || "meeting"} meeting.`;   // no filing lead: nothing "closed"
            else rollToastRef.current = `${t.name || "Task"} moved to ${fmtD(t.start)} — the ${fmtD(prev)} agenda closed ${fmtD(body ? agendaDeadline(body, prev) : "")}.`;
          }
        }
        // NEW-1 — binding a predecessor-driven, dated row: the engine (deadline rule) chose the meeting; say so.
        if (!rollToastRef.current && boundEdit.rebinding && editedT && editedT.meetingBound && _origStart && editedT.start && editedT.start !== _origStart) {
          const body = MEETING_BODY_INDEX[editedT.meetingBodyId];
          rollToastRef.current = `${editedT.name || "Task"} moved to ${fmtD(editedT.start)}, the next ${(body && body.name) || "meeting"} meeting${body && body.agendaLead ? " whose agenda is still open" : ""}.`;
        }
        // NEW-1 (owner decision) — a typed date HOLDS and he is told when this edit created a conflict (his date earlier
        // than the predecessor allows, or the predecessor moving past a typed date). One shared check, shared with the preview.
        const _typedDate = !!((('start' in updates) && updates.start) || (('end' in updates) && updates.end));
        const _pcMsg = pinConflictNotice(newPinConflicts(_beforeTasks, tasks, _typedDate ? [taskId] : []), _typedDate ? taskId : null, fmtD);
        if (_pcMsg) { const cur = rollToastRef.current || ""; if (!cur.includes(_pcMsg)) rollToastRef.current = cur ? cur + " " + _pcMsg : _pcMsg; }
      }
      return {...d, projects: {...d.projects, [pid]: {...d.projects[pid], tasks}}};
    });
    // ── Successor prompt: fire when task transitions to complete ──
    if (updates.health === 'green') {
      const snap = dataRef.current;
      if (snap) {
        const pid2 = projId ?? snap.aPid;
        const oldTask = snap.projects[pid2]?.tasks.find(t => t.id === taskId);
        if (oldTask && oldTask.health !== 'green') {
          // Ring & Spark toast: fire just after React paints the green state.
          // Bottom-anchored, so it stays visible when the successor prompt
          // opens at 80ms (and works from any view — grid, master, review).
          setTimeout(() => celebrateTaskComplete(oldTask.name), 60);
          setTimeout(() => {
            const d = dataRef.current;
            if (!d) return;
            const p = d.projects[pid2];
            if (!p) return;
            const completedTask = p.tasks.find(t => t.id === taskId);
            if (!completedTask) return;
            const successors = p.tasks.filter(t =>
              normPreds(t.predecessors).some(pr => pr.id === taskId) && t.health !== 'green'
            );
            // Only prompt when the completion actually unblocks something — i.e. there's at
            // least one Not Started (gray) successor to advance. Successors that are already
            // In Progress or Needs Attention need no review, so completing a task whose
            // successors are all already active opens nothing (the celebration still fires).
            // Already-active successors still ride along as context when the prompt does open.
            const hasReadyToStart = successors.some(t => t.health === 'gray');
            if (hasReadyToStart) {
              // NEW-1 — queued, not set directly: see the queue-drain effect near successorPrompt's
              // declaration. A batch completion (the modal's own "Mark Complete") can fire this twice
              // in close succession; queueing keeps both prompts instead of the second clobbering the first.
              // B1873361 — projName is the qualified crossScheduleLabel, not the bare schedule name:
              // two schedules can share a name, so context shown here must say which one.
              setSuccessorPromptQueue(q => [...q, { completedTask, projId: pid2, projName: crossScheduleLabel(p), successors }]);
            }
          }, 80);
        }
      }
    }
  }, []);

  // ── Multi-row delete ──────────────────────────────────────
  // Deletes several tasks (plus all their subtasks) in one pass — used by the
  // Delete key and the right-click menu when a full-row selection spans
  // multiple rows. Same pipeline as single delete (renumberTasks remaps ids
  // and drops dangling predecessor refs), so behavior matches exactly.
  // Selecting a parent together with its children is fine — the Set makes the
  // sweep idempotent. Shows a confirmation toast; Ctrl+Z restores everything.
  const deleteTasks = useCallback((taskIds) => {
    if (!taskIds || taskIds.length === 0) return;
    const pid = dataRef.current?.aPid;
    const all = dataRef.current?.projects?.[pid]?.tasks || [];
    const del = new Set();
    const mark = id => { del.add(id); all.filter(t => t.parentId === id).forEach(t => mark(t.id)); };
    taskIds.forEach(mark);
    const rowCount = taskIds.length, totalCount = del.size;
    setData(d => {
      const proj = d.projects[d.aPid];
      if (!proj) return d;
      // B501: recompute parent roll-ups + cascade after removal (matching indent/outdent/
      // paste/move) — else a deleted child leaves the parent summary bar/row showing a stale
      // span for work that no longer exists, until an unrelated edit re-triggers a rollup.
      return {...d, projects: {...d.projects, [d.aPid]: {...proj, tasks: renumberTasks(recomputeAfterStructureChange(proj.tasks.filter(t => !del.has(t.id))))}}};
    });
    notifyRowsDeleted(rowCount, totalCount);
  }, []);

  // Ids of every task in the current FULL-ROW selection (made by ID-column
  // click / drag / shift-click — the range spans all columns). Returns an
  // empty array when the selection isn't full-row, so callers fall back to
  // single-task behavior.
  const fullRowSelIds = () => {
    if (!selRange) return [];
    const lastColIdx = activeEffectiveCols(dataRef.current).length - 1;
    // B2530690 — with several ranges, the rows of ALL of them, but only when every one is a full-width row
    // selection (a cell range among them is a "clear contents" selection, not a "delete rows" one).
    if (!rangesOf(selRange).every(g => g.c1 === 0 && g.c2 === lastColIdx)) return [];
    const ft = flatTasksRef.current || [];
    return selRowsOf(selRange, ft.length - 1).map(r => ft[r].id);
  };

  // Ids of every task in the current row selection, regardless of which COLUMNS it spans.
  // Indent/outdent are row-level structural moves, never ambiguous with "clear cell content" the
  // way keyboard Delete is (fullRowSelIds' full-column requirement exists only to make THAT
  // distinction) — so a drag/shift-click selection made by dragging across the Name column (not
  // the ID column) still moves the whole block. Returns [] for a single row or no selection at
  // all, so callers fall back to [selectedId] exactly as before this existed.
  const rowRangeSelIds = () => {
    if (!selRange) return [];
    const ft = flatTasksRef.current || [];
    const rows = selRowsOf(selRange, ft.length - 1);   // B2530690 — every range's rows (copy / cut take all of them)
    if (rows.length <= 1) return [];
    return rows.map(r => ft[r].id);
  };

  // Resolve "the ids a structural op (indent/outdent/delete) should act on" for a caller that
  // has a definite anchor task (the right-clicked row, or the keyboard selection) — the row range
  // when the anchor is part of one, else just the anchor alone. One shared rule for both entry
  // points so they can never again diverge into "acts on the whole selection" vs "acts on one row."
  const structuralTargets = (anchorId) => {
    const ids = rowRangeSelIds();
    return ids.length > 1 && ids.includes(anchorId) ? ids : [anchorId];
  };
  // B2530690 — indent / outdent / "Move to…" / drag-reorder are built on ONE contiguous block of rows (see the
  // header of indentSelection). With several ranges selected they refuse, out loud — never act on part of the
  // selection or on none of it in silence. Returns null when refused.
  const blockOnlyTargets = (anchorId) => {
    if (isMulti(selRange)) { showToast(MULTI_SELECTION_MESSAGE, { type: "warn" }); return null; }
    return structuralTargets(anchorId);
  };

  // ── Delete-with-children: ask, never silently cascade or silently promote ──────────────────
  // Owner correction (verbatim): "maybe it should delete all the subtasks... or allow all subtasks
  // to get migrated to the next task above" — followed by "don't give me a menu, just... an option
  // to delete all subtasks with it or allow subtasks to get migrated." A row with NO children is
  // untouched by this — deletes immediately, exactly as before, no prompt, no extra click.
  const requestDelete = useCallback((taskIds) => {
    if (!taskIds || taskIds.length === 0) return;
    const pid = dataRef.current?.aPid;
    const all = dataRef.current?.projects?.[pid]?.tasks || [];
    const hasAnyChildren = taskIds.some(id => all.some(t => t.parentId === id));
    if (!hasAnyChildren) {
      // No subtasks anywhere in this selection — delete immediately, no prompt, no extra click,
      // exactly as before this existed.
      deleteTasks(taskIds);
      setSelectedId(null); setSelRange(null);
      return;
    }
    // The TRUE total, including any collapsed/hidden descendants — the number that matters on a
    // real schedule is how much is actually being removed, not how many rows happen to be
    // rendered when the prompt appears. Selection is left alone here so Cancel leaves it intact;
    // the modal's own choice handlers clear it once a delete actually happens.
    const del = new Set();
    const mark = id => { del.add(id); all.filter(t => t.parentId === id).forEach(t => mark(t.id)); };
    taskIds.forEach(mark);
    setDeleteChoice({ ids: taskIds, rowCount: taskIds.length, totalCount: del.size });
  }, [deleteTasks]);

  const promoteAndDeleteTasks = useCallback((taskIds) => {
    setData(d => {
      const pid = d.aPid;
      const proj = d.projects[pid];
      if (!proj) return d;
      const newTasks = promoteChildrenAndDelete(proj.tasks, taskIds);
      return {...d, projects: {...d.projects, [pid]: {...proj, tasks: renumberTasks(recomputeAfterStructureChange(newTasks))}}};
    });
    notifyRowsDeleted(taskIds.length, taskIds.length); // exactly these rows go; every child survives, promoted
  }, []);

  // ── Formatting scope (row vs cell) ────────────────────────
  // The right-click menu's format toolbar targets whatever was selected when
  // it opened: a full-row selection containing the clicked row formats the
  // row(s) — task-level bold/italic/rowColor, the original behavior — while
  // any other selection formats just the selected cell(s) via per-cell
  // entries stored on the task as cellFmt: { [colKey]: {bold, italic, fill} }.
  const fmtTargets = () => {
    const rowIds = fullRowSelIds();
    if (rowIds.length && taskCtx && rowIds.includes(taskCtx.task.id)) return {mode: 'row', ids: rowIds};
    const ft = flatTasksRef.current || [];
    const cells = [];
    if (selRange && ft.length) {
      const eff = activeEffectiveCols(dataRef.current);
      // B2530690 — every cell of every range (one format pass, one undo step)
      for (const {r, c} of cellsOf(selRange)) { const ck = eff[c]?.k; if (ck && ft[r]) cells.push({taskId: ft[r].id, colKey: ck}); }
    } else if (taskCtx) {
      cells.push({taskId: taskCtx.task.id, colKey: activeEffectiveCols(dataRef.current)[selectedColIdx]?.k || 'name'});
    }
    return {mode: 'cell', cells};
  };

  // Merge a format patch ({bold}/{italic}/{fill}/{underline}/{color}/{size}, or clearAll) into
  // the current targets in ONE data pass (one undo step), then patch the open menu's task
  // snapshot so its toolbar indicators update live.
  // NEW-2 (chat, 2026-09-11) — underline/color(text)/size ride the exact same patch/merge/prune
  // shape bold/italic/fill already use: a row-level field on the task, a per-cell entry inside
  // cellFmt[colKey], pruned back out the moment an entry has nothing truthy left in it.
  const applyFormatAndSync = (patch, {clearAll = false} = {}) => {
    const tgt = fmtTargets();
    const pid = taskCtx?.projId ?? dataRef.current?.aPid;
    const mergeCell = (entry) => {
      const e = {...(entry || {})};
      if ('bold' in patch) e.bold = patch.bold;
      if ('italic' in patch) e.italic = patch.italic;
      if ('fill' in patch) e.fill = patch.fill;
      if ('underline' in patch) e.underline = patch.underline;
      if ('color' in patch) e.color = patch.color;
      if ('size' in patch) e.size = patch.size;
      return (e.bold || e.italic || e.fill || e.underline || e.color || e.size) ? e : null; // prune empty entries
    };
    setData(d => {
      const proj = d.projects[pid]; if (!proj) return d;
      let tasks;
      if (tgt.mode === 'row') {
        const idset = new Set(tgt.ids);
        tasks = proj.tasks.map(t => {
          if (!idset.has(t.id)) return t;
          if (clearAll) { const {cellFmt: _cellFmt, ...rest} = t; return {...rest, rowColor: null, bold: false, italic: false, underline: false, textColor: null, fontSize: null}; }
          const u = {...t};
          if ('bold' in patch) u.bold = patch.bold;
          if ('italic' in patch) u.italic = patch.italic;
          if ('fill' in patch) u.rowColor = patch.fill;
          if ('underline' in patch) u.underline = patch.underline;
          if ('color' in patch) u.textColor = patch.color;
          if ('size' in patch) u.fontSize = patch.size;
          return u;
        });
      } else {
        const byTask = {};
        tgt.cells.forEach(({taskId, colKey}) => { (byTask[taskId] = byTask[taskId] || []).push(colKey); });
        tasks = proj.tasks.map(t => {
          const cols = byTask[t.id]; if (!cols) return t;
          const cf = {...(t.cellFmt || {})};
          cols.forEach(k => {
            const e = clearAll ? null : mergeCell(cf[k]);
            if (e) cf[k] = e; else delete cf[k];
          });
          if (Object.keys(cf).length) return {...t, cellFmt: cf};
          const {cellFmt: _cellFmt, ...rest} = t; return rest;
        });
      }
      return {...d, projects: {...d.projects, [pid]: {...proj, tasks}}};
    });
    setTaskCtx(c => {
      if (!c) return c;
      const t = {...c.task};
      if (tgt.mode === 'row') {
        if (clearAll) { t.rowColor = null; t.bold = false; t.italic = false; t.underline = false; t.textColor = null; t.fontSize = null; delete t.cellFmt; }
        else {
          if ('bold' in patch) t.bold = patch.bold;
          if ('italic' in patch) t.italic = patch.italic;
          if ('fill' in patch) t.rowColor = patch.fill;
          if ('underline' in patch) t.underline = patch.underline;
          if ('color' in patch) t.textColor = patch.color;
          if ('size' in patch) t.fontSize = patch.size;
        }
      } else {
        const key = activeEffectiveCols(dataRef.current)[selectedColIdx]?.k || 'name';
        const cf = {...(t.cellFmt || {})};
        const e = clearAll ? null : mergeCell(cf[key]);
        if (e) cf[key] = e; else delete cf[key];
        if (Object.keys(cf).length) t.cellFmt = cf; else delete t.cellFmt;
      }
      return {...c, task: t};
    });
  };

  // Toolbar state for the open context menu: which indicators light up, what
  // the eraser may clear, and a small scope label ("Cell", "Row", "3 rows"…).
  // In cell mode the eraser only clears cell formats — row-level formatting
  // is cleared by selecting the row (ID column) and erasing there.
  // NEW-2 — `size` additionally reports the sentinel 'mixed' rather than any one selected cell's/
  // row's number when the targets disagree, so the toolbar's size box can show blank instead of
  // a wrong number (item (e)); `count`/`unit` feed the toolbar's plain "N cell(s) SELECTED" readout.
  const ctxFmtState = () => {
    if (!taskCtx) return null;
    const tgt = fmtTargets();
    const ft = flatTasksRef.current || [];
    const oneOrMixed = vals => { const uniq = new Set(vals); return uniq.size <= 1 ? (vals[0] ?? null) : 'mixed'; };
    // NEW-2 — the size the anchor cell/row is ACTUALLY rendering at right now when no explicit
    // override is set, so Grow/Shrink steps off the size the user is looking at rather than a
    // flat guess. Without this, "Grow" on a never-formatted level-0 task name (which already
    // renders at 13) silently no-ops on its first click, because the LEVEL_SIZES table below is
    // the exact one `Cell()`'s name-column case already uses for its own default.
    const LEVEL_SIZES = [13, 12, 11.5, 11];
    const naturalSizeOf = (task, colKey) => colKey === 'name' ? LEVEL_SIZES[Math.min(task?.level || 0, 3)] : 12;
    if (tgt.mode === 'row') {
      const t = taskCtx.task;
      const sizes = tgt.ids.map(id => (id === t.id ? t : ft.find(x => x.id === id))?.fontSize ?? null);
      return {mode: 'row', bold: !!t.bold, italic: !!t.italic, underline: !!t.underline,
        fill: t.rowColor || null, color: t.textColor || null, size: oneOrMixed(sizes), naturalSize: naturalSizeOf(t, 'name'),
        hasAny: !!(t.bold || t.italic || t.underline || t.rowColor || t.textColor || t.fontSize || (t.cellFmt && Object.keys(t.cellFmt).length)),
        count: tgt.ids.length || 1, unit: tgt.ids.length > 1 ? 'rows' : 'row',
        scopeLabel: tgt.ids.length > 1 ? `${tgt.ids.length} rows` : 'Row'};
    }
    const key = activeEffectiveCols(dataRef.current)[selectedColIdx]?.k || 'name';
    const e = taskCtx.task.cellFmt?.[key] || {};
    // NEW-2 — the anchor cell (taskCtx.task / key) reads its OWN just-applied cellFmt straight
    // off the live taskCtx snapshot, same as `e` above — never off `ft` (flatTasksRef), which is
    // a ref refreshed in an effect AFTER commit and so is one render stale right after a format
    // click. `ft` is still right for every OTHER cell in a multi-cell selection, which is the
    // only reason this can't just read `e` for everything. Missing this for `size` alone (while
    // bold/italic/fill/underline/color already read `e`) is exactly what produced a size box
    // that lagged one click behind the cell it was editing — caught live in this session by
    // growing text twice in one open toolbar and diffing the box against the painted cell.
    const cellFmtOf = (taskId, colKey) => (taskId === taskCtx.task.id && colKey === key) ? e : (ft.find(x => x.id === taskId)?.cellFmt?.[colKey]);
    const hasAny = tgt.cells.some(({taskId, colKey}) => {
      const f = cellFmtOf(taskId, colKey);
      return !!(f && (f.bold || f.italic || f.underline || f.fill || f.color || f.size));
    });
    const sizes = tgt.cells.map(({taskId, colKey}) => cellFmtOf(taskId, colKey)?.size ?? null);
    return {mode: 'cell', bold: !!e.bold, italic: !!e.italic, underline: !!e.underline,
      fill: e.fill || null, color: e.color || null, size: oneOrMixed(sizes), naturalSize: naturalSizeOf(taskCtx.task, key), hasAny,
      count: tgt.cells.length || 1, unit: tgt.cells.length > 1 ? 'cells' : 'cell',
      scopeLabel: tgt.cells.length > 1 ? `${tgt.cells.length} cells` : 'Cell'};
  };

  // NEW-1 (B1638832) — set by goToTask (a person clicking a row's "Open row in <project>" link, or any
  // other in-embed jump); consumed by the nav-state emit effect below so the shell can tell a deliberate
  // jump from the embed merely RE-ANNOUNCING where it already was. Never set by a shell message.
  const rowJumpRef = useRef(false);
  // ── Jump to a task's row from anywhere (dashboard, modals) ──
  // Expands any collapsed ancestors (a hidden row can't be scrolled to),
  // switches to the task's project, and hands GridView a goToFocus token so it
  // scrolls the row into a comfortable position and pulses it on landing.
  // Gantt-only view flips to split, since there's no grid row to land on.
  const goToTask = useCallback((pid, taskId) => {
    rowJumpRef.current = true; // NEW-1 (B1638832) — the next nav-state announcement carries `rowLink` (see the emit effect)
    setData(d => {
      const proj = d.projects[pid];
      if (!proj) return d;
      const byId = {};
      proj.tasks.forEach(t => { byId[t.id] = t; });
      const toExpand = new Set();
      let p = byId[taskId]?.parentId;
      while (p != null && byId[p]) { toExpand.add(p); p = byId[p].parentId; }
      const needsExpand = [...toExpand].some(id => !byId[id].isExpanded);
      const tasks = needsExpand
        ? proj.tasks.map(t => toExpand.has(t.id) && !t.isExpanded ? {...t, isExpanded: true} : t)
        : proj.tasks;
      return {...d, section: 'projects', aPid: pid,
        view: d.view === 'gantt' ? 'split' : d.view,
        projects: {...d.projects, [pid]: {...proj, tasks}}};
    });
    setSelectedId(taskId);
    setSelectedColIdx(0);
    setSelRange(null);
    setGoToFocus({taskId, n: Date.now()}); // fresh token each jump, even to the same row
  }, []);

  // Reveal a freshly-inserted row Excel-style: select it (no edit field — typing a letter
  // begins editing, exactly like a spreadsheet) and let the existing select→scroll effect
  // bring it into view. Each insert expands & un-spotlights the new row's ancestors inside
  // its (pure) data update so the row can never land hidden; revealRef carries the
  // post-renumber id out, and rAF applies the selection after the commit.
  const revealRef = useRef(null);
  const openNameEditOnReveal = useRef(false);
  const revealInserted = useCallback(() => {
    const shouldOpenEdit = openNameEditOnReveal.current;
    openNameEditOnReveal.current = false;
    requestAnimationFrame(() => {
      const id = revealRef.current; revealRef.current = null;
      if (id == null) return;
      setSelectedId(id); setSelRange(null);
      const ni = COLS.findIndex(c => c.k === "name");
      if (ni >= 0) setSelectedColIdx(ni);
      if (shouldOpenEdit) {
        requestAnimationFrame(() => setEdit({taskId: id, col: "name"}));
      }
    });
  }, []);

  const addTask = useCallback(() => {
    setData(d => {
      const pid = d.aPid;
      // Collision-proof id: nTid can go stale (paste/duplicate grow the task
      // count without bumping it, and load-time renumbering compacts ids to
      // 1..n) — and a duplicate id poisons renumberTasks' remap table,
      // scrambling parent links. Always allocate above every existing id.
      const maxId = Math.max(0, ...d.projects[pid].tasks.map(t=>t.id));
      const id = Math.max(d.nTid[pid] ?? 1, maxId + 1);
      // Inherit parentId from the last task in visual order (same rule as insertTask)
      const visualOrder = sortByVisualOrder(d.projects[pid].tasks);
      const lastTask = visualOrder.length > 0 ? visualOrder[visualOrder.length - 1] : null;
      const newParentId = lastTask ? lastTask.parentId : null;
      const task = mkt(id, "", "", "", newParentId);
      let tasks = [...d.projects[pid].tasks, task];
      // expand & un-spotlight ancestors so the new row can't be hidden
      const anc = new Set(); { let p = newParentId; while (p != null) { anc.add(p); const par = tasks.find(t => t.id === p); p = par ? par.parentId : null; } }
      if (anc.size) tasks = tasks.map(t => anc.has(t.id) ? {...t, isExpanded: true, focused: t.id === newParentId ? false : t.focused} : t);
      const finalArr = sortByVisualOrder(tasks);
      revealRef.current = finalArr.indexOf(task) + 1;
      return {...d, nTid: {...d.nTid, [pid]: id+1}, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(finalArr)}}};
    });
    revealInserted();
  }, []);

  const deleteTask = useCallback((taskId) => {
    setData(d => {
      const pid = d.aPid;
      const del = new Set();
      const mark = id => { del.add(id); d.projects[pid].tasks.filter(t => t.parentId === id).forEach(t => mark(t.id)); };
      mark(taskId);
      // B501: recompute roll-ups/cascade after removal (see deleteTasks) so a deleted child
      // doesn't leave its parent summary span stale until the next unrelated edit.
      return {...d, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(recomputeAfterStructureChange(d.projects[pid].tasks.filter(t => !del.has(t.id))))}}};
    });
    if (selectedId === taskId) setSelectedId(null);
  }, [selectedId]);

  // NEW-1 — the one insert-above path (Insert key + context menu). Never touches isExpanded / focused:
  // the new row is pinned visible past its parent's Focus filter instead (focusPinsRef, by _sid), so the
  // rows Focus hides stay hidden and the row just added doesn't vanish into them.
  const insertAboveAnchor = useCallback((anchorId) => {
    const visibleIds = (flatTasksRef.current || []).map(t => t.id);
    const sid = _mintTaskSid();
    setData(d => {
      const pid = d.aPid;
      const newTask = { ...mkt(0, "", "", "", null), _sid: sid };
      const tasks = insertRowAbove(d.projects[pid].tasks, visibleIds, anchorId, newTask);
      const finalArr = sortByVisualOrder(tasks);
      revealRef.current = finalArr.findIndex(t => t._sid === sid) + 1;
      return { ...d, projects: { ...d.projects, [pid]: { ...d.projects[pid], tasks: renumberTasks(finalArr) } } };
    });
    setFocusPins(p => { const n = new Set(p); n.add(sid); return n; });
    revealInserted();
  }, []);

  // NEW-1 — Insert key: a new row directly above the selection in the VISIBLE order (Excel / MS Project
  // parity), with no Focus filter or collapsed subtree opened. All positioning is insertRowAbove (pure,
  // shared with the context menu's insertTaskAbove). A multi-row selection inserts ONE row above its top.
  const insertTask = useCallback(() => {
    const flat = flatTasksRef.current || [];
    let anchorId = selectedId;
    if (isMulti(selRange)) { showToast(MULTI_SELECTION_MESSAGE, { type: "warn" }); return; }   // B2530690
    if (selRange && selRange.r1 !== selRange.r2) {
      const top = flat[Math.min(selRange.r1, selRange.r2)];
      if (top) anchorId = top.id;
    }
    insertAboveAnchor(anchorId);
  }, [selectedId, selRange]);

  // (indentTask/outdentTask removed — the keyboard handler now calls the identical
  //  indentSelectionByIds/outdentSelectionByIds helpers below with the resolved selection. B255,
  //  extended to whole-selection scope by B<NEW> — see structuralTargets/rowRangeSelIds.)

  const insertTaskBelow = useCallback((taskId) => {
    setData(d => {
      const pid = d.aPid;
      const rawTasks = d.projects[pid].tasks;
      const flatOrder = [];
      const walk = (parentId) => {
        rawTasks.filter(t => t.parentId === parentId).forEach(t => {
          flatOrder.push(t);
          if (t.isExpanded) walk(t.id);
        });
      };
      walk(null);
      const flatIdx = taskId !== null ? flatOrder.findIndex(t => t.id === taskId) : flatOrder.length - 1;
      const targetTask = flatIdx >= 0 ? flatOrder[flatIdx] : null;
      const newParentId = targetTask ? targetTask.parentId : null;
      // New tasks start blank (see insertTask)
      const newTask = mkt(0, "", "", "", newParentId);
      let tasks = [...rawTasks];
      if (!targetTask) { tasks.push(newTask); }
      else { const rawIdx = tasks.findIndex(t => t.id === targetTask.id); tasks.splice(rawIdx + 1, 0, newTask); }
      const anc = new Set(); { let p = newParentId; while (p != null) { anc.add(p); const par = tasks.find(t => t.id === p); p = par ? par.parentId : null; } }
      if (anc.size) tasks = tasks.map(t => anc.has(t.id) ? {...t, isExpanded: true, focused: t.id === newParentId ? false : t.focused} : t);
      revealRef.current = tasks.indexOf(newTask) + 1;
      return { ...d, projects: { ...d.projects, [pid]: { ...d.projects[pid], tasks: renumberTasks(tasks) } } };
    });
    revealInserted();
  }, []);

  // insertTaskAbove: takes taskId directly to avoid stale-closure bug in context menu
  // (context menu called setSelectedId + insertTask() but state update is async,
  //  so insertTask() always saw the old selectedId — not the right-clicked row)
  const insertTaskAbove = useCallback((taskId) => { insertAboveAnchor(taskId); }, []);

  // Deadline row: a milestone spliced directly above its bound anchor, linked via deadlineForTaskId
  // so the cascade post-pass keeps it on the anchor's call/file-by date forever. The link is set with
  // the anchor's PRE-renumber id — renumberTasks remaps it alongside parentId/predecessors.
  const addDeadlineTask = useCallback((anchorId, projId = null) => {
    setData(d => {
      const pid = projId ?? d.aPid;
      const proj = d.projects[pid];
      if (!proj) return d;
      const rawTasks = proj.tasks || [];
      const anchor = rawTasks.find(t => t.id === anchorId);
      if (!anchor || !anchor.meetingBound) return d;
      const body = MEETING_BODY_INDEX[anchor.meetingBodyId];
      const newTask = { ...mkt(0, `Deadline — ${(body && body.name) || "meeting"}`, "", "", anchor.parentId), deadlineForTaskId: anchor.id };
      const tasks = [...rawTasks];
      const rawIdx = tasks.findIndex(t => t.id === anchorId);
      if (rawIdx === -1) tasks.push(newTask); else tasks.splice(rawIdx, 0, newTask);
      // Cascade BEFORE renumber (ids still match the link), so the row lands already dated.
      return { ...d, projects: { ...d.projects, [pid]: { ...proj, tasks: renumberTasks(recomputeAfterStructureChange(tasks)) } } };
    });
  }, []);

  const addSubtask = useCallback((taskId) => {
    setData(d => {
      const pid = d.aPid;
      // Same collision guard as addTask — never trust a stale nTid
      const maxId = Math.max(0, ...d.projects[pid].tasks.map(t=>t.id));
      const id = Math.max(d.nTid[pid] ?? 1, maxId + 1);
      // New tasks start blank (see insertTask)
      const task = mkt(id, "", "", "", taskId);
      let tasks = [...d.projects[pid].tasks, task];
      // expand & un-spotlight the parent and every ancestor so the new child can't be hidden
      const anc = new Set([taskId]); { let p = taskId; while (p != null) { const par = tasks.find(t => t.id === p); p = par ? par.parentId : null; if (p != null) anc.add(p); } }
      tasks = tasks.map(t => anc.has(t.id) ? {...t, isExpanded: true, focused: t.id === taskId ? false : t.focused} : t);
      revealRef.current = id;
      return {...d, nTid: {...d.nTid, [pid]: id+1}, projects: {...d.projects, [pid]: {...d.projects[pid], tasks}}};
    });
    revealInserted();
  }, []);

  const duplicateTask = useCallback((taskId) => {
    setData(d => {
      const pid = d.aPid;
      const tasks = d.projects[pid].tasks;
      const src = tasks.find(t => t.id === taskId);
      if (!src) return d;
      // Same collision guard as addTask — never trust a stale nTid
      const nid = Math.max(d.nTid[pid] ?? 1, Math.max(0, ...tasks.map(t=>t.id)) + 1);
      // NEW-1 — a duplicate is a genuinely NEW task, not a continuation of `src`; give it its own
      // _sid rather than inheriting src's (spreading `...src` would otherwise carry src's _sid
      // straight onto the copy, and the diff/merge machinery would then see one identity claiming
      // to be two different rows).
      const copy = {...src, id: nid, _sid: _mintTaskSid(), name: src.name + " (Copy)", notes: src.notes.map(n => ({...n}))};
      const srcIdx = tasks.findIndex(t => t.id === taskId);
      let newTasks = [...tasks];
      newTasks.splice(srcIdx + 1, 0, copy);
      const anc = new Set(); { let p = copy.parentId; while (p != null) { anc.add(p); const par = newTasks.find(t => t.id === p); p = par ? par.parentId : null; } }
      if (anc.size) newTasks = newTasks.map(t => anc.has(t.id) ? {...t, isExpanded: true, focused: t.id === copy.parentId ? false : t.focused} : t);
      revealRef.current = newTasks.indexOf(copy) + 1;
      return {...d, nTid: {...d.nTid, [pid]: nid+1}, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(newTasks)}}};
    });
    revealInserted();
  }, []);

  // ─── Task clipboard (Ctrl+C / Ctrl+X / Ctrl+V) ──────────────────────────────
  // Collects the task + every descendant as a deep-copied subtree so children come
  // along with their parent. Copies preserve formatting (rowColor/bold/italic),
  // predecessors, dates, notes — everything. Stored in clipboardRef so the global
  // keydown handler reads fresh state without re-binding on every change.
  //
  // NEW-ROWMOVE — MEASURED (see the harness/backlog writeup for the full per-surface table): before
  // this change, all three of copy/cut/paste operated on `selectedId` ALONE — the drag/shift-click
  // ANCHOR row — and silently ignored every other row in an active multi-row `selRange`. A 6-row
  // selection copied exactly 1 row's subtree, with no error and no indication anything was dropped;
  // paste then inserted only that one subtree. Fixed the same way as indent/outdent/delete: every
  // entry point now resolves the WHOLE selection via structuralTargets first (taskIds, plural) and
  // collectSubtreeFor runs once per ROOT id in that selection (a selected parent + its own selected
  // child collect once, as one subtree — not twice — via rootsOfSelection, the same "root = parent
  // not itself selected" rule indentSelection uses).
  const collectSubtreeFor = (rootId, allTasks) => {
    const out = [];
    const walk = id => {
      const t = allTasks.find(x => x.id === id);
      if (!t) return;
      out.push({...t, notes: (t.notes||[]).map(n => ({...n})), predecessors: (t.predecessors||[]).map(p => ({...p})), ...(Array.isArray(t.icons) ? {icons: [...t.icons]} : {})});   // NEW-1 — icons travel with a copied/pasted row
      allTasks.filter(x => x.parentId === id).forEach(c => walk(c.id));
    };
    walk(rootId);
    return out;
  };
  const rootsOfSelection = (taskIds, allTasks) => {
    const idSet = new Set(taskIds);
    const byId = new Map(allTasks.map(t => [t.id, t]));
    return taskIds.filter(id => byId.has(id) && !idSet.has(byId.get(id).parentId));
  };
  const copyTaskById = useCallback((taskIds) => {
    const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
    const pid = dataRef.current?.aPid;
    const tasks = dataRef.current?.projects?.[pid]?.tasks;
    if (!tasks) return;
    const rootIds = rootsOfSelection(ids, tasks);
    const subtree = rootIds.flatMap(id => collectSubtreeFor(id, tasks));
    if (subtree.length === 0) return;
    clipboardRef.current = { mode: "copy", tasks: subtree, sourceProjId: pid, sourceRootIds: rootIds };
    setClipboardTick(t => t + 1);
    const extra = subtree.length - rootIds.length;
    const label = rootIds.length > 1 ? `${rootIds.length} tasks` : `“${subtree[0].name || "task"}”`;
    showToast(`Copied ${label}${extra > 0 ? ` + ${extra} subtask${extra > 1 ? "s" : ""}` : ""}`, { duration: 1800 });
  }, []);
  const cutTaskById = useCallback((taskIds) => {
    const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
    const pid = dataRef.current?.aPid;
    const tasks = dataRef.current?.projects?.[pid]?.tasks;
    if (!tasks) return;
    const rootIds = rootsOfSelection(ids, tasks);
    const subtree = rootIds.flatMap(id => collectSubtreeFor(id, tasks));
    if (subtree.length === 0) return;
    clipboardRef.current = { mode: "cut", tasks: subtree, sourceProjId: pid, sourceRootIds: rootIds };
    setClipboardTick(t => t + 1);
    const extra = subtree.length - rootIds.length;
    const label = rootIds.length > 1 ? `${rootIds.length} tasks` : `“${subtree[0].name || "task"}”`;
    showToast(`Cut ${label}${extra > 0 ? ` + ${extra} subtask${extra > 1 ? "s" : ""}` : ""} — paste to move`, { duration: 1800 });
  }, []);
  const pasteTaskAfter = useCallback((targetId) => {
    const cb = clipboardRef.current;
    if (!cb || targetId == null) return;
    // NEW-4/B1080548 — cross-schedule paste (copy in one project, paste into another; the same
    // clipboard already supports this, since `pid` below is read fresh at paste time, not pinned
    // to the source). Precompute the "how many links can't survive" figure the same way `n` below
    // already is — from `cb` alone, before setData — so the toast can report it without depending
    // on updater-timing. A predecessor whose id is in the pasted set is INTERNAL and always
    // survives (remapped below); one that isn't is EXTERNAL — it points at a task left behind in
    // the source schedule. Same-project, that raw id still resolves to a real task and is kept
    // (unchanged from before). Cross-project it CANNOT survive: the destination has its own,
    // unrelated id space, so keeping the raw id risks silently rewiring onto whatever task happens
    // to share that number there — exactly the danger the owner flagged. Drop it instead, and say
    // so, rather than leaving that failure to renumberTasks' silent id-doesn't-exist prune.
    const pastedOldIds = new Set(cb.tasks.map(t => t.id));
    const crossProjectPaste = cb.sourceProjId !== dataRef.current?.aPid;
    const droppedLinkCount = crossProjectPaste
      ? cb.tasks.reduce((n, t) => n + (t.predecessors || []).filter(p => p && !pastedOldIds.has(p.id)).length, 0)
      : 0;
    setData(d => {
      const pid = d.aPid;
      const tasks = d.projects[pid].tasks;
      const target = tasks.find(t => t.id === targetId);
      if (!target) return d;

      // Remap old subtree IDs to a temporary high range so they can't collide with
      // existing IDs; sortByVisualOrder + renumberTasks below normalizes back to 1..N.
      const baseTempId = Math.max(0, ...tasks.map(t => t.id)) + 1000;
      const idMap = {};
      cb.tasks.forEach((t, i) => { idMap[t.id] = baseTempId + i; });

      const crossProject = cb.sourceProjId !== pid;
      const rootOldIds = new Set(cb.sourceRootIds || [cb.sourceRootId]); // sourceRootId: back-compat for a clipboard filled before this change
      // NEW-1 — cut+paste is a MOVE (the same logical task, new position): keep its _sid so a
      // diff/merge recognizes it as unchanged rather than "deleted here, added there". Copy+paste
      // duplicates it into a genuinely new row and must never carry the source's _sid onto it (the
      // clipboard's deep-copy in collectSubtreeFor preserves `_sid` from the live source, so this is
      // the one place a copy-mode paste has to explicitly override it).
      const pasted = cb.tasks.map(t => ({
        ...t,
        id: idMap[t.id],
        _sid: cb.mode === "cut" ? t._sid : _mintTaskSid(),
        // Each subtree's own root becomes a sibling of the target (same parent), in the SAME
        // relative order they were selected in; inner tasks keep their parent inside their own
        // subtree (remapped to the new IDs).
        parentId: rootOldIds.has(t.id) ? target.parentId : (idMap[t.parentId] ?? null),
        // Predecessor rewiring: internal (within the pasted subtree) → new ID, always. External
        // (points outside the subtree) → same-project, keep the original ID (it still resolves to
        // a real task there); cross-project, DROP it — the id space is unrelated in the
        // destination and keeping it risks silently rewiring onto an unrelated task that happens
        // to share that number (NEW-4/B1080548). renumberTasks below still prunes anything left
        // dangling for any other reason, as a backstop.
        predecessors: (t.predecessors || [])
          .map(p => (idMap[p.id] != null ? { ...p, id: idMap[p.id] } : (crossProject ? null : p)))
          .filter(Boolean),
      }));

      // Insert right after the target row in raw array order; sortByVisualOrder will
      // produce the correct visual ordering (target's whole subtree first, then pasted).
      const result = [...tasks];
      const targetIdx = result.findIndex(t => t.id === target.id);
      result.splice(targetIdx + 1, 0, ...pasted);

      // Cut: delete the source subtree from this project (move semantics). On copy mode,
      // the source stays. Cross-project cut is also handled (only delete if same project).
      let final = result;
      if (cb.mode === "cut" && cb.sourceProjId === pid) {
        const sourceIds = new Set(cb.tasks.map(t => t.id));
        // Move semantics: the source subtree is removed under its OLD ids and re-inserted under
        // new ids. Any OTHER task that depended on a moved task still points at its old id, which
        // no longer exists → renumberTasks would silently drop that dependency. Rewire every
        // remaining task's predecessors from the old subtree ids to the new ones (idMap). Pasted
        // tasks already carry new ids (not keys in idMap → unchanged); external preds are unchanged.
        final = result.filter(t => !sourceIds.has(t.id))
          .map(t => ({ ...t, predecessors: (t.predecessors || []).map(p => (p && idMap[p.id] !== undefined ? { ...p, id: idMap[p.id] } : p)) }));
      }

      // Normalize ordering/IDs, and record where the pasted root landed so we can select it.
      // recomputeAfterStructureChange refreshes parent roll-ups for the new placement (it
      // preserves array order + ids, so the rootIdx lookup below stays valid).
      const sorted = recomputeAfterStructureChange(sortByVisualOrder(final));
      const firstRootOldId = (cb.sourceRootIds || [cb.sourceRootId])[0];
      const rootTempId = idMap[firstRootOldId];
      const rootIdx = sorted.findIndex(t => t.id === rootTempId);
      pasteSelectRef.current = rootIdx >= 0 ? rootIdx + 1 : null; // renumberTasks assigns id = index + 1 — selects the FIRST pasted root

      return {
        ...d,
        projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(sorted)}}
      };
    });
    const n = cb.tasks.length;
    // NEW-4/B1080548 — LOUD-FAILURE: a paste that silently lost dependency logic is worse than one
    // that was refused outright, so say exactly how many links didn't survive rather than leaving
    // it to be discovered later as a schedule that "looks pasted" but doesn't cascade right.
    const dropMsg = droppedLinkCount > 0
      ? ` — ${droppedLinkCount} link${droppedLinkCount > 1 ? "s" : ""} to ${droppedLinkCount > 1 ? "tasks" : "a task"} left in the source schedule ${droppedLinkCount > 1 ? "were" : "was"} dropped`
      : "";
    showToast(`Pasted ${n} task${n > 1 ? "s" : ""}${dropMsg}`, { duration: droppedLinkCount > 0 ? 5000 : 1600 });
    // Cut is one-shot (move semantics); copy stays in the clipboard for repeated pastes.
    if (cb.mode === "cut") { clipboardRef.current = null; setClipboardTick(t => t + 1); }
  }, []);

  // After a paste commits, select the pasted root so it highlights and the grid scrolls to it.
  useEffect(() => {
    if (pasteSelectRef.current == null) return;
    const id = pasteSelectRef.current;
    pasteSelectRef.current = null;
    setSelectedId(id);
    setSelRange(null);
    setSelectedColIdx(1);
  }, [data]);

  // B<NEW> — both entry points (Alt+Shift+Right/Left and the right-click menu) now resolve the
  // FULL selected row range first (see rowRangeSelIds below) and pass every id through in one
  // batch — one setData call, one undo step, one recompute, matching the pre-existing single-row
  // behaviour exactly when the selection is just one row. The tree-mutation itself lives in the
  // pure indentSelection/outdentSelection above so it can be exercised without a live DOM.
  const indentSelectionByIds = useCallback((taskIds) => {
    setData(d => {
      const pid = d.aPid;
      const newTasks = indentSelection(d.projects[pid].tasks, taskIds);
      if (!newTasks) return d;
      return {...d, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(recomputeAfterStructureChange(sortByVisualOrder(newTasks)))}}};
    });
  }, []);

  const outdentSelectionByIds = useCallback((taskIds) => {
    setData(d => {
      const pid = d.aPid;
      const newTasks = outdentSelection(d.projects[pid].tasks, taskIds);
      if (!newTasks) return d;
      return {...d, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(recomputeAfterStructureChange(sortByVisualOrder(newTasks)))}}};
    });
  }, []);

  // NEW-ROWMOVE — the single commit point for BOTH the drag-and-drop row reorder (GridView's
  // rowgrip drag) and the "Move to…" command: one setData call, one recompute, so ONE undo step
  // covers the whole gesture regardless of how many rows moved or how far. taskIds is resolved by
  // the CALLER via structuralTargets(anchorId) (see shared.moveRows below), exactly like
  // indentSelectionByIds/outdentSelectionByIds already resolve their targets before calling in.
  const moveSelectionByIds = useCallback((taskIds, destParentId, insertAfterId) => {
    setData(d => {
      const pid = d.aPid;
      const proj = d.projects[pid];
      if (!proj) return d;
      const newTasks = moveSelectionToDestination(proj.tasks, taskIds, destParentId, insertAfterId);
      if (!newTasks) return d;
      const sorted = sortByVisualOrder(newTasks);
      // Track where the block landed (pre-renumber) so the effect below can restore selection to
      // it — renumberTasks assigns id = index + 1, the same trick pasteSelectRef already uses.
      const byId = new Map(proj.tasks.map(t => [t.id, t]));
      const rootIds = taskIds.filter(id => byId.has(id) && !taskIds.includes(byId.get(id).parentId));
      const firstIdx = rootIds.length ? sorted.findIndex(t => t.id === rootIds[0]) : -1;
      moveSelectRef.current = firstIdx >= 0 ? firstIdx + 1 : null;
      return {...d, projects: {...d.projects, [pid]: {...proj, tasks: renumberTasks(recomputeAfterStructureChange(sorted))}}};
    });
  }, []);

  // After a move commits, select the block's first root so it highlights and the grid scrolls to
  // it — same pattern as the paste-select effect below (search pasteSelectRef).
  useEffect(() => {
    if (moveSelectRef.current == null) return;
    const id = moveSelectRef.current;
    moveSelectRef.current = null;
    setSelectedId(id);
    setSelRange(null);
    setSelectedColIdx(1);
  }, [data]);

  const addProject = useCallback(async (opts) => {
    // opts (optional) = { name, ownerKind, linkedSiteId, linkedSiteName } — used by the
    // cross-module "create a schedule connected to this site" flow. Guard against a click event
    // being passed as the first arg (the in-app + dropdown buttons call addProject() bare).
    const o = (opts && typeof opts === "object" && !("nativeEvent" in opts)) ? opts : {};
    // EVERY SCHEDULE HAS AN OWNER. A bare addProject() — the in-app "+" button, which the shell
    // hides — used to mint a schedule owned by NOTHING; that unowned state is what this model
    // removes, so a bare create now explicitly belongs to the ORGANIZATION (the container the
    // owner asked for: "everything lives under something"), and the shell's own New-schedule
    // flow always passes a real, chosen owner. `ownerKind` is written unconditionally so no
    // path can leave it absent and fall back to inference.
    const ownerKind = o.linkedSiteId != null ? OWNER_KIND_SITE : OWNER_KIND_ORG;

    // B1777120 — once this account is flipped, a schedule's id is a real Postgres identity value,
    // reserved by an actual INSERT before the project is ever added to local state — never a
    // client-guessed `nPid` two tabs could independently mint the same value from (acceptance:
    // "task and project ids cannot collide when two tabs create rows at the same moment"). The
    // row is inserted with a placeholder `data` (no `id` yet — Postgres hasn't assigned one until
    // the INSERT returns) and immediately patched with the real id embedded, so every row this
    // account ever holds still carries `data.id === id`, matching every other read site's
    // assumption. window.storage.insertSchedule seeds scheduleBase/scheduleKnownRev itself so the
    // very next autosave for this schedule is an ordinary guarded UPDATE, not a second insert.
    if (window.storage && window.storage.scheduleRowsAuthoritative) {
      const id = await window.storage.insertSchedule({
        name: o.name || null, ownerKind,
        linkedSiteId: o.linkedSiteId ?? null, linkedSiteName: o.linkedSiteName ?? null,
      });
      if (id == null) {
        if (typeof showToast === "function") showToast("Couldn't create a new schedule — please try again.", { type: "error", duration: 6000 });
        return;
      }
      setData(d => {
        if (!d) return d;
        const proj = { id, name: o.name || `Project ${id}`, tasks: [], ownerKind };
        if (o.linkedSiteId != null) { proj.linkedSiteId = o.linkedSiteId; proj.linkedSiteName = o.linkedSiteName || null; }
        const nd = {...d, nPid: Math.max(d.nPid, id + 1), aPid: id, nTid: {...d.nTid, [id]: 1},
          projects: {...d.projects, [id]: proj}};
        return o.linkedSiteId != null ? withLastActiveSite(nd, o.linkedSiteId, id) : nd;
      });
      return;
    }

    setData(d => {
      if (!d) return d; // B644 — pre-load call: data not loaded yet, nothing to add onto
      const id = d.nPid;
      const proj = {id, name: o.name || `Project ${id}`, tasks: [], ownerKind};
      if (o.linkedSiteId != null) { proj.linkedSiteId = o.linkedSiteId; proj.linkedSiteName = o.linkedSiteName || null; }
      const nd = {...d, nPid: id+1, aPid: id, nTid: {...d.nTid, [id]: 1},
        projects: {...d.projects, [id]: proj}};
      // NEW-1 — a newly-created linked schedule is the one to come back to on this site later.
      return o.linkedSiteId != null ? withLastActiveSite(nd, o.linkedSiteId, id) : nd;
    });
  }, []);

  const renameProject = useCallback((id, name) => {
    // Guard a stale/non-existent id (e.g. a deleted project still in the shell breadcrumb): spreading
    // {...undefined, name} would mint a malformed ghost project (no id, no tasks) that white-screens the
    // schedule when activated. Matches the existence guard nav-link / nav-select already have.
    setData(d => (d && d.projects && d.projects[id]) ? {...d, editProjId: null, projects: {...d.projects, [id]: {...d.projects[id], name}}} : d);
  }, []);

  // Pure: builds the new project object (a copy of `src`) for a chosen `newId`. Split out of
  // duplicateProject so the id-allocation flow (B1777120 — an INSERT-first reservation once
  // flipped) and the legacy client-counter flow can share the exact same copy logic.
  const buildDuplicateProject = (src, newId) => {
    // B816 — RE-ID the copied meeting bodies so the copy's bodies are globally unique. Same-id bodies
    // in two projects would collapse in MEETING_BODY_INDEX → editing one would move the other's hearings.
    const bodyIdMap = {};
    const copiedBodies = Array.isArray(src.meetingBodies) ? src.meetingBodies.map((mb, i) => {
      const copy = copyMeetingBodyWithNewId(mb, i);
      if (mb && mb.id) bodyIdMap[mb.id] = copy.id;
      return copy;
    }) : undefined;
    const newTasks = src.tasks.map(t => ({...t, notes: t.notes.map(n => ({...n})),
      ...(Array.isArray(t.icons) ? {icons: [...t.icons]} : {}),   // NEW-1 — task icons ride along with the copy (a fresh array, not shared)
      ...(t.meetingBodyId && bodyIdMap[t.meetingBodyId] ? {meetingBodyId: bodyIdMap[t.meetingBodyId]} : {})}));
    // Spread ...src so the copy keeps the project's column layout (colConfig), label alignment, and
    // user-defined Formula columns — the old literal dropped all of them. Deep-copy formulaCols so
    // editing the copy can't mutate the original.
    //
    // ⛔ THE COPY KEEPS ITS OWNER (changed with the ownership model). It previously dropped
    // `linkedSiteId`, because back then the link was a ONE-schedule-per-site pointer and a
    // second schedule claiming the same site was ambiguous by construction. A project may now
    // hold several schedules, so that reason is gone — and leaving the old behaviour in place
    // would mean every "Duplicate" silently emigrated the copy to the ORGANIZATION, which is
    // both surprising ("duplicate this project's schedule" plainly means another schedule for
    // the same project) and the exact class of silent, unasked-for ownership change this work
    // exists to remove. The copy is a sibling under the same owner.
    return {...src, id: newId, name: src.name + " (Copy)", tasks: newTasks,
      formulaCols: Array.isArray(src.formulaCols) ? src.formulaCols.map(fc => ({...fc})) : undefined,
      meetingBodies: copiedBodies};               // B815/B816 — deep-copied AND re-ided (see above)
  };

  const duplicateProject = useCallback(async (id) => {
    // B1777120 — same reasoning as addProject: once flipped, the copy's id is a real Postgres
    // identity value reserved by an actual INSERT before it ever reaches local state, never a
    // client-guessed `nPid` two tabs could collide on.
    if (window.storage && window.storage.scheduleRowsAuthoritative) {
      const src = dataRef.current && dataRef.current.projects && dataRef.current.projects[id];
      if (!src) return;
      const maxTid = src.tasks.length ? Math.max(...src.tasks.map(t => t.id)) + 1 : 1;
      const newId = await window.storage.insertSchedule({
        name: src.name + " (Copy)", ownerKind: src.ownerKind,
        linkedSiteId: src.linkedSiteId ?? null, linkedSiteName: src.linkedSiteName ?? null,
        projectData: buildDuplicateProject(src, null),   // id filled in by insertSchedule once known
      });
      if (newId == null) {
        if (typeof showToast === "function") showToast("Couldn't duplicate this schedule — please try again.", { type: "error", duration: 6000 });
        return;
      }
      setData(d => {
        if (!d || !d.projects || !d.projects[id]) return d;
        const copy = buildDuplicateProject(d.projects[id], newId);
        const nd = {...d, nPid: Math.max(d.nPid, newId + 1), nTid: {...d.nTid, [newId]: maxTid}, aPid: newId,
          projects: {...d.projects, [newId]: copy}};
        rebuildMeetingBodyIndex(nd);
        return copy.linkedSiteId != null ? withLastActiveSite(nd, copy.linkedSiteId, newId) : nd;
      });
      return;
    }

    setData(d => {
      const src = d.projects[id];
      const newId = d.nPid;
      const copy = buildDuplicateProject(src, newId);
      const maxTid = copy.tasks.length ? Math.max(...copy.tasks.map(t => t.id)) + 1 : 1;
      const nd = {
        ...d,
        nPid: newId + 1,
        nTid: {...d.nTid, [newId]: maxTid},
        aPid: newId,
        projects: {...d.projects, [newId]: copy},
      };
      rebuildMeetingBodyIndex(nd);
      // The copy is now the one to come back to on this site — duplicateProject already switches
      // to it (aPid), and without this the site's last-active pointer would still name the
      // original, so a later return to the project would silently snap away from the copy.
      return src.linkedSiteId != null ? withLastActiveSite(nd, src.linkedSiteId, newId) : nd;
    });
  }, []);

  const deleteProject = useCallback(async (id, { skipConfirm = false } = {}) => {
    // J3 — the confirm is asked BEFORE the state update (it used to run inside the updater, which React may call twice).
    if (!skipConfirm) {
      const d0 = latestData.current;
      const proj0 = d0?.projects?.[id];
      if (!proj0) return;
      const taskCount0 = proj0.tasks?.length || 0;
      // B1873361 — a destructive confirm names the qualified label, not the bare name: deleting
      // the WRONG one of two identically-named schedules is exactly the costly mistake this
      // disambiguation exists to prevent.
      if (!(await askConfirm({
        title: `Delete project "${crossScheduleLabel(proj0)}"?`,
        body: `This removes ${taskCount0} task${taskCount0===1?"":"s"}.\n\nA backup snapshot will be saved — you can restore it from Version History.`,
        confirmLabel: "Delete", danger: true,
      }))) return;
    }
    setData(d => {
      if (!d || !d.projects || !d.projects[id]) return d; // B644 — null-safe pre-load; B2429233 — the last schedule is deletable
      const _proj = d.projects[id];
      // A labeled snapshot of the PRE-delete state is written before the deletion is applied, so the user can restore it
      // from the History panel. The shell breadcrumb (B440) already confirms inline, so it passes skipConfirm.
      // Fire-and-forget the labeled snapshot of the PRE-delete state
      try { window.storage.set("hs-v1", JSON.stringify(stripViewState(d)), { label: "pre-delete-project", skipSanity: true }); } catch {}
      // Invariant 6— a delete prunes the deleted schedule's per-schedule bookkeeping: its
      // next-task-id counter (`nTid`) and any "last schedule I looked at" pointer aimed at it
      // (`lastActiveBySite`). Neither was ever pruned, so production still carried counters for
      // ids 4, 8–14, 17 and 18 — schedules deleted long ago — inside a document that is the ENTIRE
      // account in one row, where that growth is unbounded. pruneScheduleRefs asks the LIVE set
      // rather than the removed id, so it cannot miss a map by forgetting to name it here, and a
      // stale pointer left by any other path is swept at the same time.
      return removeScheduleFromDoc(d, id);
    });
  }, []);

  // ── Embedded-mode bridge (Planyr shell) ───────────────────────────────────
  // Inside the Planyr shell this app runs in an iframe with its OWN header (the
  // project picker + Dashboard/Projects toggle) hidden. Bridge that navigation to
  // the shell's shared Row-1 breadcrumb over postMessage, so the Schedule module's
  // picker drives THIS app's projects (Goose Creek, Grand Port, …) — not the Site
  // Planner's. Same-origin, so messages are targeted to window.location.origin.
  const inShell = typeof window !== "undefined" && window.self !== window.top;
  // B2285440 — a per-tab aPid that points at a schedule that no longer exists (deleted on another device)
  // is repointed at a real one. aPid is VIEW state (stripped from every save — see stripViewState), so this
  // is a view move, never a data write. With NO schedule at all there is nothing to point at: the render
  // below shows the empty state instead.
  useEffect(() => {
    if (!data) return;
    const pid = pickActivePid(data.projects, data.aPid);
    if (pid != null && pid !== data.aPid) setData(d => (d && d.aPid !== pid) ? { ...d, aPid: pid } : d);
  }, [data && data.aPid, data && data.projects]);
  const navSigRef = useRef("");
  useEffect(() => {
    if (!inShell || !data) return;
    // NEW-1 (B1638832) — consume the row-jump flag on the first effect after it was set, whether or not
    // the announcement below is emitted (an unchanged signature emits nothing, and a stale flag must never
    // ride a later, ambient re-announcement).
    const rowLink = rowJumpRef.current; rowJumpRef.current = false;
    // Carry the cross-module link (linkedSiteId/Name) so the shell can map this schedule ↔ a
    // Site Planner project (group_id) and keep the project the same across the header tabs.
    // B1404352 — taskCount rides along so the shell's per-schedule delete confirmation can name
    // what it's about to remove ("This removes 8 tasks") without a second round-trip.
    const list = Object.values(data.projects || {}).map(p => ({ id: p.id, name: p.name, ownerKind: ownerOf(p).kind, linkedSiteId: p.linkedSiteId ?? null, linkedSiteName: p.linkedSiteName ?? null, taskCount: Array.isArray(p.tasks) ? p.tasks.length : 0 }));
    const sig = JSON.stringify([data.section ?? "projects", data.aPid ?? null, list]);
    if (sig === navSigRef.current) return; // only emit when the nav state actually changes
    navSigRef.current = sig;
    try {
      window.parent.postMessage({
        source: "planar-seq", type: "planar:nav-state",
        section: data.section ?? "projects", activeId: data.aPid ?? null, projects: list,
        ...(rowLink ? { rowLink: true } : {}),
      }, window.location.origin);
    } catch (_) {}
  }, [data, inShell]);
  // NEW-1 (B1991040) — the shell tells this page every project's LIVE name (planar:site-names) so a
  // schedule's "<Project> / <Schedule>" label resolves by linked id at read time instead of trusting
  // the `linkedSiteName` snapshot stored in the document (see scheduleOwnership.js `liveSiteName`).
  // A render-only tick: nothing here touches `data`, so it can never dirty or write the document.
  const [, setSiteNamesTick] = React.useState(0);
  useEffect(() => {
    const onNames = (e) => {
      if (!e || e.origin !== window.location.origin) return; // same-origin shell only (audit batch A)
      const m = e && e.data;
      if (!m || m.source !== "planar-shell" || m.type !== "planar:site-names") return;
      const names = m.names && typeof m.names === "object" ? m.names : {};
      setSiteNameResolver((id) => (id != null && names[id]) || null);
      setSiteNamesTick((n) => n + 1);
    };
    window.addEventListener("message", onNames);
    return () => window.removeEventListener("message", onNames);
  }, []);
  // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — the two shell messages that matter BEFORE the document has loaded
  // (the handler below drops everything until `data` exists): the shell's nav-request is answered with
  // where the load stands, and its Retry restarts the read. Neither writes anything.
  useEffect(() => {
    if (!inShell) return;
    const onLoadMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "planar-shell" || latestData.current) return;
      if (m.type === "planar:nav-request") postLoadState(window.__planarLoadStatus === "failed" ? "failed" : "loading");
      else if (m.type === "planar:retry-load") { window.__planarLoadStatus = "loading"; setLoadTick(t => t + 1); }
    };
    window.addEventListener("message", onLoadMsg);
    return () => window.removeEventListener("message", onLoadMsg);
  }, [inShell]);
  useEffect(() => {
    if (!inShell) return;
    const onMsg = (e) => {
      // These messages mutate state (switch project, open dashboard, create a project),
      // so only accept them from the same-origin shell — never a cross-origin embedder.
      if (e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "planar-shell") return;
      // B644 — `data` is null until the async hs-v1 load resolves, and every branch below
      // reads or mutates it. A functional updater queued now runs INSIDE the next useState
      // render, so a null `d.projects` read there throws and lands App in the error
      // boundary ("Cannot read properties of null (reading 'projects')" — the fresh-project
      // / cold-boot first paint). Drop shell messages until data exists: the shell re-posts
      // nav intents on every tab switch and retries nav-request, so an early drop self-heals
      // the moment the load lands (nav-request already no-op'd pre-load by design).
      if (!latestData.current) return;
      if (m.type === "planar:nav-request") {
        // The shell's loader asks us to (re-)announce our nav state, so a missed or slow first
        // emit can't strand it on its fallback timer. Answer from the latest data — a no-op until
        // it's loaded (the shell retries, and the data-change emit above also fires once it loads).
        const d = latestData.current;
        if (d) {
          // Carry the cross-module link fields, identical to the primary data-change emit above —
          // a stripped {id,name} reply (when it lands last before the shell stops polling) made the
          // shell drop linkedSiteId, falsely showing the "no schedule linked" panel over an already-
          // linked project and minting a duplicate schedule on "Create".
          const list = Object.values(d.projects || {}).map(p => ({ id: p.id, name: p.name, ownerKind: ownerOf(p).kind, linkedSiteId: p.linkedSiteId ?? null, linkedSiteName: p.linkedSiteName ?? null, taskCount: Array.isArray(p.tasks) ? p.tasks.length : 0 }));
          try { window.parent.postMessage({ source: "planar-seq", type: "planar:nav-state",
            section: d.section ?? "projects", activeId: d.aPid ?? null, projects: list }, window.location.origin); } catch (_) {}
        }
        return;
      }
      // Tell the shell a cross-module link was set/cleared/created, so it can mirror the
      // lightweight hint onto the Site Planner side (it can't read this app's backend).
      const emitLinkChanged = (siteId, scheduleId, name) => {
        try {
          window.parent.postMessage({ source: "planar-seq", type: "planar:link-changed",
            siteId: siteId ?? null, scheduleId: scheduleId ?? null, name: name ?? null }, window.location.origin);
        } catch (_) {}
      };
      if (m.type === "planar:nav-select" && m.id != null) {
        setData(d => {
          const proj = d.projects && d.projects[m.id];
          if (!proj) return d;
          const nd = { ...d, section: "projects", aPid: m.id };
          return proj.linkedSiteId != null ? withLastActiveSite(nd, proj.linkedSiteId, m.id) : nd;
        });
      } else if (m.type === "planar:nav-select-by-site" && m.siteId != null) {
        // Project-aware header tabs: activate the schedule linked to this Site Planner project
        // (group_id). No link yet → leave state untouched; the shell shows the resolution panel.
        setData(d => {
          const linked = Object.values(d.projects || {}).filter(p => p && p.linkedSiteId != null && p.linkedSiteId === m.siteId);
          if (!linked.length) return d;
          // NEW-1 (recurrence of B1080547, owner report 2026-09-07: "how come I still can't make
          // multiple schedules per project?") — a site can carry SEVERAL linked schedules once
          // B1080547 lifted the one-schedule-per-site constraint. Always resolving to whichever
          // sorts first (lowest id — always the oldest, by construction) meant creating a second
          // or third schedule and then coming back later (a fresh tab — see B1107680's aPid
          // migration above — or simply navigating elsewhere and back) silently snapped the grid
          // back to the ORIGINAL schedule every time, with no visible sign the newer ones still
          // existed. Prefer whichever schedule was last recorded active for this site; fall back
          // to the first-linked only when nothing is remembered yet (a brand-new link).
          const preferredId = d.lastActiveBySite ? d.lastActiveBySite[m.siteId] : null;
          const match = (preferredId != null && linked.find(p => p.id === preferredId)) || linked[0];
          // No-op if that schedule is ALREADY active in the projects section — return the same
          // state object so React doesn't re-run the auto-save effect. The shell re-posts this on
          // every switch; without the guard a burst of identical carry-ins fired a burst of saves
          // that tripped the optimistic-save guard against this tab's own write (the false "newer
          // version saved on another device" banner, B560).
          if (d.aPid === match.id && (d.section ?? "projects") === "projects") return d;
          return withLastActiveSite({ ...d, section: "projects", aPid: match.id }, m.siteId, match.id);
        });
      } else if (m.type === "planar:nav-link" && m.id != null) {
        // Set (m.siteId present) or clear (m.siteId null) the link on an existing schedule.
        setData(d => {
          if (!d.projects || !d.projects[m.id]) return d;
          const proj = { ...d.projects[m.id] };
          const base = { ...d, section: "projects", aPid: m.id };
          if (m.siteId != null) {
            proj.linkedSiteId = m.siteId; proj.linkedSiteName = m.siteName || null;
            return withLastActiveSite({ ...base, projects: { ...d.projects, [m.id]: proj } }, m.siteId, m.id);
          }
          // Unlinking a schedule from its project MOVES it to the organization — it does not
          // return it to the unowned state, which this model no longer has. Without this the one
          // remaining path back to "belongs to nothing" would still be open.
          delete proj.linkedSiteId; delete proj.linkedSiteName;
          proj.ownerKind = OWNER_KIND_ORG;
          return { ...base, projects: { ...d.projects, [m.id]: proj } };
        });
        emitLinkChanged(m.siteId ?? null, m.id, m.siteName ?? null);
      } else if (m.type === "planar:nav-create-linked") {
        // Create a new schedule pre-named after + linked to a Site Planner project, then open it.
        // addProject mints id = current nPid, so capture it for the mirror message.
        const newId = latestData.current ? latestData.current.nPid : null;
        // `m.ownerKind` is the owner the New-schedule modal actually chose. An org-owned create
        // arrives with siteId null, so addProject's own owner derivation already lands it on the
        // organization — this passes it through explicitly so the choice is carried, not re-guessed.
        addProject({ name: m.name, ownerKind: m.ownerKind ?? null, linkedSiteId: m.siteId ?? null, linkedSiteName: m.siteName ?? null });
        setData(d => ({ ...d, section: "projects" }));
        if (newId != null && m.siteId != null) emitLinkChanged(m.siteId, newId, m.siteName ?? null);
      } else if (m.type === "planar:nav-dashboard") {
        setData(d => ({ ...d, section: "reports" }));
      } else if (m.type === "planar:nav-new") {
        addProject();
        setData(d => ({ ...d, section: "projects" }));
      } else if (m.type === "planar:nav-duplicate" && m.id != null) {
        // NEW-2/B1080546 — deep-copy from the shell breadcrumb's kebab menu (duplicateProject
        // already exists and already strips linkedSiteId/linkedSiteName — see its own header —
        // this was previously reachable only from the in-iframe project list, which the shell
        // hides). duplicateProject also switches to the copy (sets aPid), so land on it directly.
        if (latestData.current && latestData.current.projects && latestData.current.projects[m.id]) {
          duplicateProject(m.id);
          setData(d => ({ ...d, section: "projects" }));
        }
      } else if (m.type === "planar:nav-rename" && m.id != null && typeof m.name === "string") {
        // B440 — rename from the shell breadcrumb. The breadcrumb already trimmed/validated;
        // guard once more so an empty name can never blank a project label.
        const name = m.name.trim();
        if (name) renameProject(m.id, name);
      } else if (m.type === "planar:nav-delete" && m.id != null) {
        // B440 — delete from the shell breadcrumb (already confirmed inline → skipConfirm).
        // If the deleted project was the active one, route home to the Dashboard (reports),
        // matching the "the open project no longer exists → go home" behavior.
        const projCount = latestData.current ? Object.keys(latestData.current.projects || {}).length : 0;
        const wasActive = latestData.current && latestData.current.aPid === m.id;
        deleteProject(m.id, { skipConfirm: true });
        // Route home only when a schedule actually remains to land on: deleting the LAST schedule
        // (B2429233) leaves the document's own "No schedules yet" empty state, which is the right
        // place to stay (there is no Dashboard worth routing to).
        if (wasActive && projCount > 1) setData(d => ({ ...d, section: "reports" }));
      } else if (m.type === "planar:nav-select-task" && m.siteId != null && (m.taskId != null || m.taskSid != null)) {
        // B1953795 (S3) — a caller that knows the task's STABLE `_sid` (the Dashboard feeds) sends it; a task
        // `id` is a row position that shifts on every insert above it, so an id sent from a stale read (or
        // from stored data renumbered on load) can name a DIFFERENT task. With a sid we resolve the CURRENT
        // id here and never fall back to the positional id.
        // B1161792 (NEW-1) — the Dashboard's "Needs attention" card jumping straight to one task,
        // not just its project. Resolve the schedule linked to the Site Planner project (same
        // lookup planar:nav-select-by-site uses above), then reuse the existing internal
        // goToTask jump — the same one the in-app Master view's row and the successor-prompt
        // modal already use — rather than inventing a second "select a task" mechanism.
        // NEW-1 (B1080547 recurrence) — a site can now carry several linked schedules, and a
        // task id is only meaningful within ONE of them (small per-schedule sequential integers)
        // — a bare "first linked" guess is the same defect as planar:nav-select-by-site above,
        // and here it can land on an unrelated task that happens to share the id in the wrong
        // schedule. Prefer the last-active schedule WHEN it actually contains the task (resolves
        // a genuine id collision the way the user's own recent activity would suggest); otherwise
        // whichever linked schedule does contain it (the unambiguous single-owner case); otherwise
        // the last-active one anyway (task not found — best guess); otherwise the first linked.
        const linkedForTask = latestData.current ? Object.values(latestData.current.projects || {}).filter(p => p && p.linkedSiteId != null && p.linkedSiteId === m.siteId) : [];
        const preferredForTask = latestData.current && latestData.current.lastActiveBySite ? latestData.current.lastActiveBySite[m.siteId] : null;
        const preferredScheduleForTask = preferredForTask != null ? linkedForTask.find(p => p.id === preferredForTask) : null;
        const bySid = m.taskSid != null;
        const hasTask = (p) => p && Array.isArray(p.tasks) && p.tasks.some(t => bySid ? t._sid === m.taskSid : t.id === m.taskId);
        const match = (hasTask(preferredScheduleForTask) && preferredScheduleForTask)
          || linkedForTask.find(hasTask)
          || preferredScheduleForTask
          || linkedForTask[0];
        if (match) {
          const target = bySid ? match.tasks.find(t => t._sid === m.taskSid) : null;
          if (bySid && !target) setData(d => ({ ...d, section: "projects", aPid: match.id }));   // task gone: land on its schedule, never a wrong row
          else goToTask(match.id, bySid ? target.id : m.taskId);
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [inShell, addProject, renameProject, deleteProject, duplicateProject, goToTask]);

  // ── Embedded-mode TOOLBAR bridge (Planyr shell, B388) ──────────────────────
  // The shell hides our in-iframe action toolbar (`.in-iframe .app-header`) and re-renders
  // those controls up in its own unified header. So when embedded: (1) report the toolbar's
  // live state up, and (2) accept the shell's toolbar commands and run the SAME actions our
  // own buttons do. Standalone (not embedded) is untouched — `inShell` gates both halves and
  // the in-iframe buttons keep their own handlers.
  const tbSigRef = useRef("");
  useEffect(() => {
    if (!inShell || !data) return;
    const sec = data.section ?? "projects";
    const section = sec === "suggestions" ? "projects" : sec;
    // B1281648 — effective view is simply `data.view` at every width now: Split renders both
    // panes stacked at phone width instead of collapsing to one, so there is no longer a
    // width-dependent override here. Must match the body switch below exactly, or the shell's
    // lifted zoom control (which reads `zoomable` off this) can disagree with what is on screen.
    const view = data.view ?? "grid";
    const state = {
      view, section, isMobile: !!isMobile,
      zoomPct: Math.round((ganttPPD || 22) / 6 * 100),
      zoomable: section === "projects" && (view === "split" || view === "gantt"),
      reviewCount: reviewRows.length,
      reviewOpen: !!reviewOpen,
      saveStatus, savePulse: !!savePulse, fileLinked: !!fileLinked,
      // B566 — bridge the offline/cloud-unreachable condition up too, so the unified header
      // cloud badge can show the honest amber "offline" state instead of a false-green "synced":
      // on a failed initial cloud READ, offlineFallback is set while saveStatus still reads its
      // initial "saved" (no write has been attempted yet), which would otherwise map to synced.
      offlineFallback: !!offlineFallback,
      // B778/NEW-1 — signed-out (or not on the schedule's team), distinct from offlineFallback.
      authRequired: !!authRequired,
      activePanel: settingsOpen ? "settings" : automationOpen ? "automation"
        : contactsOpen ? "contacts" : formatOpen ? "format" : historyOpen ? "history" : null,
    };
    const sig = JSON.stringify(state);
    if (sig === tbSigRef.current) return; // only emit when the toolbar state actually changes
    tbSigRef.current = sig;
    try {
      window.parent.postMessage({ source: "planar-seq", type: "planar:toolbar-state", ...state }, window.location.origin);
    } catch (_) {}
  }, [inShell, data, isMobile, ganttPPD, reviewRows, reviewOpen, saveStatus, savePulse, fileLinked,
      offlineFallback, authRequired, settingsOpen, automationOpen, contactsOpen, formatOpen, historyOpen]);

  useEffect(() => {
    if (!inShell) return;
    const onCmd = (e) => {
      // Same-origin shell only — these commands mutate state / trigger downloads. (Same strict
      // guards as the nav bridge: exact origin + the planar-shell source discriminator.)
      if (e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "planar-shell") return;
      switch (m.type) {
        case "planar:view-set":
          if (m.view) setData(d => d ? { ...d, view: m.view } : d);
          break;
        case "planar:review-toggle": {
          const opening = !reviewOpen;
          if (opening && reviewRows.length && data && data.projects) {
            const a = reviewRows[Math.min(reviewIdx, reviewRows.length - 1)];
            if (a && a.project_id != null && data.projects[a.project_id] && data.aPid !== a.project_id) setData(d => ({ ...d, aPid: a.project_id }));
          }
          setReviewOpen(opening);
          break;
        }
        case "planar:zoom":
          if (m.dir === "in") setGanttPPD(z => Math.min(80, Math.ceil(z * 1.35)));
          else if (m.dir === "out") setGanttPPD(z => Math.max(1, Math.floor(z / 1.35)));
          break;
        case "planar:export":
          if (m.mode === "pdf") setPdfExportOpen(true); else exportHTML();
          break;
        case "planar:save":
          if (saveStatus === "error") { if (latestData.current) attemptCloudSave(latestData.current); }
          else openFile();
          break;
        case "planar:history":
          setHistoryOpen(true); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);
          break;
        case "planar:contacts":
          setContactsOpen(o => !o); setSettingsOpen(false); setAutomationOpen(false); setFormatOpen(false);
          break;
        case "planar:automation":
          setAutomationOpen(o => !o); setSettingsOpen(false); setContactsOpen(false); setFormatOpen(false);
          break;
        case "planar:settings":
          setSettingsOpen(o => !o); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);
          break;
        case "planar:format":
          setFormatOpen(o => !o); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false);
          break;
        default: break;
      }
    };
    window.addEventListener("message", onCmd);
    return () => window.removeEventListener("message", onCmd);
  }, [inShell, data, reviewOpen, reviewRows, reviewIdx, saveStatus]);

  const proj = activeProjectOf(data);

  const flatTasks = useMemo(() => {
    if (!proj) return [];
    const settings = data?.settings; // healthRules (or legacy cfRules) for computeDisplayHealth — Focus must classify by the SAME status the grid shows (B717)
    const childSet = focusGroupIds(proj.tasks);
    const byId = {};
    const kidsBy = new Map();
    proj.tasks.forEach(t => {
      byId[t.id] = t;
      if (!kidsBy.has(t.parentId)) kidsBy.set(t.parentId, []);
      kidsBy.get(t.parentId).push(t);
    });
    const kidsOf = id => kidsBy.get(id) || [];

    // Rolled status of a task's whole subtree: "done" (every descendant complete),
    // "upcoming" (every descendant not-started), "paused" (every descendant paused),
    // or "active" (anything in progress / needs-attention / mixed).
    const statusMemo = {};
    const rolledStatus = id => {
      if (statusMemo[id] !== undefined) return statusMemo[id];
      const kids = kidsOf(id);
      let res;
      if (kids.length === 0) {
        // B717 single-source-of-truth: classify a leaf by the SAME status the grid shows
        // (computeDisplayHealth applies cfRules), NOT the raw stored health. Otherwise an
        // overdue Not-Started task renders red "Needs Attn." via overdueRed yet is classed
        // "upcoming" off its raw gray health → Focus wrongly hides it. Now red/yellow-promoted
        // (overdueRed / dueSoonYellow) both map to "active" and survive Focus, matching the grid.
        const h = computeDisplayHealth(byId[id], settings, byId);
        res = h === "green" ? "done" : h === "gray" ? "upcoming" : h === "paused" ? "paused" : "active";
      } else {
        const ss = kids.map(k => rolledStatus(k.id));
        res = ss.every(s => s === "done") ? "done"
            : ss.every(s => s === "upcoming") ? "upcoming"
            : ss.every(s => s === "paused") ? "paused"
            : "active";
      }
      statusMemo[id] = res;
      return res;
    };
    // A child (leaf OR sub-group) is hideable by Focus when its whole subtree is
    // done, not-started, or paused. Anything with in-progress/needs-attention work stays.
    const hideStatusOf = id => { const s = rolledStatus(id); return s === "active" ? null : s; };

    // Cost roll-up: a parent's cost is the sum of its descendant leaf costs (read-only,
    // like dates); a leaf shows its own entered value. Computed for display only.
    const costMemo = {};
    const costOf = id => {
      if (id in costMemo) return costMemo[id];
      const kids = kidsOf(id);
      // Include the node's OWN value too (0 for a normal parent → no change), so a cost entered on a
      // task BEFORE it gained children isn't silently dropped from the total (it's locked from editing,
      // so it would otherwise be stranded in the saved data, invisible + uneditable).
      const v = kids.length ? (Number(byId[id]?.cost) || 0) + kids.reduce((s, c) => s + costOf(c.id), 0) : (Number(byId[id]?.cost) || 0);
      costMemo[id] = v; return v;
    };
    // B212 — same bottom-up roll-up for the optional Budget / Actual columns.
    const _fieldMemo = {};
    const sumOf = (id, field) => {
      const k = field + ":" + id;
      if (k in _fieldMemo) return _fieldMemo[k];
      const kids = kidsOf(id);
      const v = kids.length ? (Number(byId[id]?.[field]) || 0) + kids.reduce((s, c) => s + sumOf(c.id, field), 0) : (Number(byId[id]?.[field]) || 0);
      _fieldMemo[k] = v; return v;
    };

    const out = [];
    const walk = (parentId, level) => {
      const parent = parentId === null ? null : byId[parentId];
      let children = kidsOf(parentId);
      if (parent && parent.focused) children = children.filter(c => !hideStatusOf(c.id) || focusPins.has(c._sid));
      children.forEach(t => {
        const hasChildren = childSet.has(t.id);
        // Separate counts of what Focus would hide: completed, paused, not-started
        let hideableDone = 0, hideableUpcoming = 0, hideablePaused = 0;
        if (hasChildren) {
          kidsOf(t.id).forEach(c => {
            const hs = focusPins.has(c._sid) ? null : hideStatusOf(c.id);
            if (hs === "done") hideableDone++;
            else if (hs === "upcoming") hideableUpcoming++;
            else if (hs === "paused") hideablePaused++;
          });
        }
        out.push({...t, level, hasChildren, hideableDone, hideableUpcoming, hideablePaused,
          hideableCount: hideableDone + hideableUpcoming + hideablePaused, rolledCost: costOf(t.id),
          rolledBudget: sumOf(t.id,"budget"), rolledActual: sumOf(t.id,"actualCost")});
        if (t.isExpanded) walk(t.id, level + 1);
      });
    };
    walk(null, 0);
    return out;
  }, [proj, data?.settings, NOW, focusPins]); // settings→cfRules, NOW→overdue rollover: keep Focus in sync with the grid's display health (B717)

  // Keep a ref in sync so the keydown handler can read tasks without a stale closure. NEW-1 — a LAYOUT
  // effect, not a passive one: it lands in the same commit as the state, so a key pressed right after an
  // edit can never read the previous (or an empty) list.
  React.useLayoutEffect(() => { flatTasksRef.current = flatTasks; }, [flatTasks]);
  // NEW-1 — a Focus toggle (any task's `focused` changing, keyed by _sid so a renumber is not a toggle)
  // re-applies the filter: rows pinned visible by an insert drop back under it.
  const focusSig = (proj?.tasks || []).filter(t => t.focused).map(t => t._sid).join(",");
  React.useEffect(() => { setFocusPins(p => (p.size ? new Set() : p)); }, [focusSig]);
  // NEW-1 (B2455200) — after an Alt+F toggle commits, a selection whose row Focus just hid moves to its
  // nearest visible ancestor (the parent summary row) instead of staying on an invisible row. Runs only for
  // a toggle the key made (focusReselectRef), never for a chip click or an undo.
  React.useLayoutEffect(() => {
    const r = focusReselectRef.current; if (!r) return;
    focusReselectRef.current = null;
    const next = focusReselectTarget(proj?.tasks || [], new Set(flatTasks.map(t => t.id)), r.selId);
    if (next != null && next !== r.selId) setSelectedId(next);
  }, [focusSig]);
  // NEW-1 — the flat index the selection was last SEEN at. When its row is deleted (selection → null) the
  // arrow keys re-anchor here instead of jumping to the first / last row (stepGridRow). Only ever written
  // while the selection is actually in the list, so a hide or a delete leaves the last real position.
  React.useLayoutEffect(() => {
    if (selectedId == null || selectedId === "__NEW_TASK__") return;
    const i = flatTasks.findIndex(t => t.id === selectedId);
    if (i >= 0) lastSelIdxRef.current = i;
  }, [selectedId, flatTasks]);
  useEffect(() => { projIdRef.current = data?.aPid ?? null; }, [data]);
  // Clear the start char whenever edit mode closes
  useEffect(() => { if (!edit) setEditStartChar(null); }, [edit]);

  const succMap = useMemo(() => {
    if (!proj) return {};
    const m = {};
    proj.tasks.forEach(t => normPreds(t.predecessors).forEach(p => { (m[p.id] = m[p.id] || []).push(t.id); }));
    return m;
  }, [proj]);

  const getTaskName = useCallback((id) => proj?.tasks.find(t => t.id === id)?.name ?? `#${id}`, [proj]);

  const liveNotesTask = notesCtx
    ? data?.projects[notesCtx.projectId]?.tasks.find(t => t.id === notesCtx.taskId)
    : null;

  const dl = (content, name, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], {type}));
    a.download = name; a.click();
  };
  const openFile = async () => {
    if (!window.showOpenFilePicker) { showToast('Auto-save requires Chrome or Edge.', { type: "warn", duration: 4000 }); return; }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'planar HTML file', accept: { 'text/html': ['.html'] } }],
        multiple: false,
      });
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return;
      const file = await handle.getFile();
      fileHtmlRef.current = await file.text();
      fileHandleRef.current = handle;
      setFileLinked(true);
    } catch(e) { /* cancelled */ }
  };

  const exportJSON = () => dl(JSON.stringify(data, null, 2), `${scheduleExportName(Object.values(data.projects))}.json`, "application/json");
  const importJSON = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async ev => {
      let parsed;
      try { parsed = JSON.parse(ev.target.result); }
      catch { showToast("Import failed — not valid JSON.", { type: "error", duration: 4000 }); return; }
      // Validate it has the shape we expect (projects object with tasks arrays)
      if (!parsed || typeof parsed !== "object" || !parsed.projects || typeof parsed.projects !== "object") {
        showToast("Import failed — missing 'projects' object.", { type: "error", duration: 4000 });
        return;
      }
      const taskCount = Object.values(parsed.projects).reduce((n, p) => n + (Array.isArray(p?.tasks) ? p.tasks.length : 0), 0);
      const projCount = Object.keys(parsed.projects).length;
      const curTaskCount = data ? Object.values(data.projects || {}).reduce((n, p) => n + (p.tasks?.length || 0), 0) : 0;
      if (!(await askConfirm({
        title: "Replace current data with this import?",
        body: `Current: ${Object.keys(data?.projects||{}).length} projects, ${curTaskCount} tasks\nIncoming: ${projCount} projects, ${taskCount} tasks\n\nA backup snapshot of the current state is saved first.`,
        confirmLabel: "Replace", danger: true,
      }))) {
        return;
      }
      // Snapshot the current state with a pre-import label BEFORE applying
      if (data) { try { window.storage.set("hs-v1", JSON.stringify(stripViewState(data)), { label: "pre-import", skipSanity: true }); } catch {} }
      // Route the import through the SAME shared normalize + cascade pipeline the cloud/seed load and
      // version-restore use (B4), so old/partial backups get migrated (predecessor format, holidays,
      // ids, contacts) and dates recomputed. (This used to inline the pipeline, calling normalizeIds/
      // ensureContacts directly — but those are scoped INSIDE the load effect, so the call threw
      // ReferenceError and import was silently broken. The ref closes over them.)
      if (applyLoadedDataRef.current) applyLoadedDataRef.current(parsed);
      else setData(parsed);
      showToast(`Imported ${projCount} project${projCount===1?"":"s"}, ${taskCount} task${taskCount===1?"":"s"}.`, { type: "success", duration: 3000 });
    };
    r.readAsText(f);
    e.target.value = "";
  };
  const exportHTML = () => {
    // B1873361 (PDF-PARITY) — this always exports EVERY schedule on the account together (no
    // per-project selection, unlike buildPDFHtml's Web Snapshot), so two same-named schedules
    // (the owner's own two "Master Schedule"s) are guaranteed to appear side by side; the
    // section header is the qualified crossScheduleLabel, never the bare name.
    const rows = Object.values(data.projects).map(p =>
      `<h2>${escapeHtml(crossScheduleLabel(p))}</h2><table><tr><th>ID</th><th>Task</th><th>Start</th><th>End</th><th>Dur</th><th>Status</th><th>%</th><th>Owner</th></tr>` +
      p.tasks.map(t => { const h = HEALTH[t.health] || HEALTH.gray; const pct = effectivePercentComplete(t, p.tasks); return `<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(fmtD(t.start))}</td><td>${escapeHtml(fmtD(t.end))}</td><td>${Number(t.duration)||0}d</td><td style="color:${escapeHtml(h.dot)}">${escapeHtml(h.label)}</td><td>${pct}%</td><td>${escapeHtml(ownerJoin(ownerListOf(t))||"—")}</td></tr>`; }).join("") +
      `</table>`).join("");
    // Title from the real data, not a hardcoded legacy project name / old brand:
    // a single project uses its name, multiple use the Planyr brand.
    const names = Object.values(data.projects).map(p => p.name).filter(Boolean);
    const title = names.length === 1 ? names[0] : "Planyr Schedule";
    dl(`<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title><style>body{font-family:monospace;background:#0d1117;color:#e6edf3;padding:24px}h1{color:#e6a817;margin-bottom:24px}h2{color:#58a6ff;margin:24px 0 8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #30363d;padding:6px 10px;text-align:left;font-size:12px}th{background:#161b22;color:#8b949e}</style></head><body><h1>${escapeHtml(title)} — ${new Date().toLocaleDateString()}</h1>${rows}</body></html>`,
      `${scheduleExportName(Object.values(data.projects))}.html`, "text/html");  // match the Site Planner PDF filename format
  };

  const rolledHealthMap = useMemo(() => proj ? computeRolledHealth(proj.tasks, data.settings) : {}, [proj?.tasks, data?.settings]);

  if (!data) return (
    <div style={{height:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",color:"#e6a817",fontFamily:"'Inter',system-ui,sans-serif",fontSize:14,letterSpacing:".1em"}}>LOADING...</div>
  );

  // B2285440 — no active schedule (every schedule deleted, or none yet): a visible, honest empty state,
  // never a crash. Nothing is written until the person presses the button.
  if (!proj) return (
    <div data-schedule-empty="1" style={{height:"100vh",background:"var(--bg)",color:"var(--txt)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,fontFamily:"'Inter',system-ui,sans-serif",textAlign:"center",padding:24}}>
      <div style={{fontSize:16,fontWeight:700}}>No schedules yet</div>
      <div style={{fontSize:13,maxWidth:360,lineHeight:1.5}}>This account has no schedule to show. Create one to start planning — nothing has been removed.</div>
      <button onClick={() => addProject()} style={{cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,background:"var(--accent)",color:"var(--on-accent,#fff)",border:"none",borderRadius:6,padding:"8px 16px"}}>New schedule</button>
    </div>
  );

  const setHoverZone = zone => { hoverZoneRef.current = zone; };
  // moveRows: resolved fresh every render (NOT a useCallback) so it always closes over the CURRENT
  // selRange/flatTasksRef — the same freshness structuralTargets itself already relies on for the
  // keyboard indent/outdent entry points. anchorId is the row whose drag handle was grabbed (or the
  // right-clicked/context row for "Move to…"); structuralTargets expands it to the whole active
  // selection when the anchor is part of one, exactly like indent/outdent do.
  const moveRows = (anchorId, destParentId, insertAfterId) => moveSelectionByIds(structuralTargets(anchorId), destParentId, insertAfterId);
  const shared = {tasks: flatTasks, succMap, updateTask, deleteTask, getTaskName, proj, setData, setNotesCtx, edit, setEdit, editStartChar, selectedId, setSelectedId, selRange, setSelRange, selectedColIdx, setSelectedColIdx, goToFocus, setGoToFocus, ganttPPD, setGanttPPD, gridZoom, setHoverZone, insertTask, insertTaskBelow, addTask, addSubtask, duplicateTask, setTaskCtx, rolledHealthMap, healthColStyle: data.healthColStyle || "stoplight", setHealthColStyle: v => setData(d => ({...d, healthColStyle: v})), data, moveRows, isMobile};

  let section = data.section ?? "projects";
  if (section === "suggestions") section = "projects";   // Suggestions tab removed — Review now lives inside Projects

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"var(--bg)",color:"var(--txt)",overflow:"hidden"}}>

      {/* HEADER */}
      {offlineFallback && (
        <div style={{background:"#fef2f2",borderBottom:"1px solid #fecaca",color:"#991b1b",padding:"7px 14px",
          display:"flex",alignItems:"center",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
          <span style={{fontSize:14,flexShrink:0}}>⚠</span>
          <span style={{flex:1}}>
            <strong>Cloud unreachable — showing the offline copy embedded in this file.</strong>{" "}
            It may be out of date, and changes will not save. Fix the connection, then reload.
          </span>
          <button onClick={()=>window.location.reload()}
            style={{flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,
              background:"var(--bg)",border:"1px solid #fca5a5",color:"#991b1b",borderRadius:5,padding:"4px 12px"}}>
            Reload
          </button>
        </div>
      )}
      {authRequired && !offlineFallback && (
        <div style={{background:"#fffbeb",borderBottom:"1px solid #fde68a",color:"#92400e",padding:"7px 14px",
          display:"flex",alignItems:"center",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          <span style={{flex:1}}>
            <strong>Sign in to see this schedule.</strong>{" "}
            Showing a blank starter copy —{" "}
            {window.self === window.top
              /* Standalone /sequence/ has no sign-in form of its own (NEW-1): the link opens Planyr's sign-in panel on the
                 Schedule tab. Embedded in Planyr, the header's Sign in button (top right) is the way. */
              ? <a data-testid="sequence-signin-link" href="/?app&auth=signin#/schedule" style={{color:"inherit",fontWeight:700}}>sign in to Planyr</a>
              : <>use Sign in at the top right of Planyr</>}
            , then reload.
          </span>
        </div>
      )}
      {staleNotice && !offlineFallback && !authRequired && (
        <div style={{background:"#fffbeb",borderBottom:"1px solid #fde68a",color:"#92400e",padding:"7px 14px",
          display:"flex",alignItems:"center",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
          <span style={{fontSize:14,flexShrink:0}}>&#8635;</span>
          <span style={{flex:1}}>
            {/* NEW-3 (B1696642) — this fires from a rev check against the cloud row alone, which
                carries no tab/window/device identity. "Another device" claimed a scope this app can't
                actually see (it could equally be another tab on THIS device) — say only what's known. */}
            {/* NEW-1 (owner follow-on 2026-09-16) — this banner can be read in a tab that's no longer
                on the schedule the reader thinks it is (two projects can each hold a "Master
                Schedule"), so it now names the ONE thing it always knows for free: which schedule
                THIS TAB currently has open (data.aPid) — never the schedule that changed remotely
                (checkRemote only reads the cloud row's __rev scalar, not its projects, so that's
                genuinely unknowable without fetching the whole document on every 20s poll). Always
                shown, never dropped for "the schedule on screen" — that exemption is for a per-row
                notice sitting right next to the row it names; this is a standalone banner with no
                grid underneath it to supply that context. */}
            <strong>A newer version was saved elsewhere.</strong>{" "}
            {saveStatus==="saved"
              ? `Reload to load the latest version of ${crossScheduleLabel(data.projects?.[data.aPid])}.`
              : `You have unsaved changes in ${crossScheduleLabel(data.projects?.[data.aPid])} -- reloading replaces them with the newer version. Your copy is kept in Version History either way.`}
          </span>
          <button onClick={async ()=>{
              // NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — this banner
              // offers to reload over a tab that may hold edits which never reached the cloud
              // (saveStatus !== "saved"), and a bare reload discards them with nothing saved
              // anywhere — despite the copy above promising "kept in Version History either way",
              // a promise the code never actually backed. Flush first, through the SAME auto-save
              // path a real edit already takes: it merges this tab's edits onto the newer cloud via
              // the existing guard, or — if a merge genuinely can't happen — snapshots this tab's
              // copy as 'stale-block' (_rawSet's own existing fallback), so the edits are preserved
              // one way or the other before the page goes away.
              // NEW-2 (B1629619, 2026-09-18) — "unsaved changes" as read by `saveStatus` means the
              // in-memory `data` object hasn't reached the cloud; it says nothing about a cell
              // editor that's still open with typed-but-not-yet-committed text (name/date/cost/etc.
              // -- the "text" editor class, EDITOR-EXIT-CONTRACT). That keystroke never made it into
              // `data` at all -- every one of this grid's text cells commits on blur
              // (onBlur={e=>commit(taskId,col,e.target.value)}, reading the DOM input's OWN current
              // value, not a stale React closure) -- so blurring whatever's focused is both safe (a
              // no-op if nothing's open) and sufficient (it reads the live keystrokes, not a copy).
              // The wait lets that blur's setData/updateTask land in `data` (and from there into
              // `latestData.current`, synced by its own effect) before this reads it.
              const ae = document.activeElement;
              if (ae && typeof ae.blur === "function" && ae !== document.body) {
                ae.blur();
                await new Promise(r => setTimeout(r, 50));
              }
              const d = latestData.current;
              if (d && saveStatusRef.current !== "saved") {
                try { await window.storage.set("hs-v1", JSON.stringify(stripViewState(d)), { label: "auto" }); } catch {}
              }
              window.location.reload();
            }}
            style={{flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,
              background:"var(--bg)",border:"1px solid #fcd34d",color:"#92400e",borderRadius:5,padding:"4px 12px"}}>
            Reload
          </button>
        </div>
      )}
      {ancestorPredNotice && ancestorPredNotice.length > 0 && (() => {
        // NEW-1 (B1696640) — LOUD surface for the load-time repair above: a task whose predecessor
        // named its own parent/ancestor (that link can never converge — a summary row's dates are the
        // ROLLUP of its children, so the two halves chase each other forever) had the link dropped and
        // its dates recalculated. One notice, once — the repair is persisted immediately (see the load
        // effect), so it doesn't recur on the next open the way it did before this fix.
        // NEW-1 (owner follow-on 2026-09-16) — a row here can belong to ANY schedule in the account,
        // not just the one on screen, so the schedule's own name alone is ambiguous (two projects can
        // each hold a "Master Schedule"); scheduleRowPrefix prints the full disambiguating
        // "<Project> / <Schedule>" label for a row elsewhere and nothing for a row already on screen.
        const flat = ancestorPredNotice.flatMap(p => (p.tasks || []).map(t => ({...t, project: p.project, pid: p.pid})));
        const n = flat.length;
        const shown = flat.slice(0, 3);
        const extra = n - shown.length;
        return (
          <div style={{background:"#fffbeb",borderBottom:"1px solid #fde68a",color:"#92400e",padding:"7px 14px",
            display:"flex",alignItems:"flex-start",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
            <span style={{fontSize:14,flexShrink:0}}>&#9888;</span>
            <span style={{flex:1}}>
              <strong>{n} task{n===1?"":"s"} named {n===1?"its own":"their own"} parent summary row as a predecessor — the link would loop forever, so it was removed and {n===1?"its date was":"their dates were"} recalculated.</strong>{" "}
              {shown.map((t, i) => (
                <React.Fragment key={t.pid + ":" + t.id}>
                  {i > 0 ? "; " : ""}
                  <span onClick={() => goToTask(t.pid, t.id)} title="Click to jump to this row"
                    style={{cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted"}}>
                    {scheduleRowPrefix(data.projects, t.pid, data.aPid)}#{t.id} "{t.name}"
                  </span>
                </React.Fragment>
              ))}
              {extra > 0 ? `; +${extra} more` : ""}. Add back a real dependency (a sibling task, not the summary row) if one was intended.
            </span>
            <button onClick={()=>setAncestorPredNotice(null)}
              style={{flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,
                background:"var(--bg)",border:"1px solid #fcd34d",color:"#92400e",borderRadius:5,padding:"4px 12px"}}>
              Dismiss
            </button>
          </div>
        );
      })()}
      {driftNotice && driftNotice.length > 0 && (() => {
        // B836 — LOUD surface for cascade drift the load quietly corrected. A non-pinned task whose
        // SAVED start didn't match its predecessor chain (B835) used to be re-derived in silence,
        // hiding the fact that the stored value was ever wrong. Now the correction is announced so
        // the user can confirm it matches their intent (or pin/lag a gap that was deliberate).
        // NEW-2 (B1696641) — each named row now carries its own ID and jumps to the row on click:
        // project NAME alone doesn't disambiguate (an account can hold several same-named projects,
        // and a project can hold several same-named tasks), but the ID always does.
        // NEW-1 (owner follow-on 2026-09-16) — and the schedule's own name alone STILL doesn't
        // disambiguate which PROJECT it belongs to (two projects can each hold a "Master Schedule");
        // scheduleRowPrefix prints "<Project> / <Schedule>" for a row in a different schedule than
        // the one on screen, and nothing when the row is already in view.
        const flat = driftNotice.flatMap(p => (p.tasks || []).map(t => ({...t, project: p.project, pid: p.pid})));
        const n = flat.length;
        const shown = flat.slice(0, 3);
        const extra = n - shown.length;
        return (
          <div style={{background:"#fffbeb",borderBottom:"1px solid #fde68a",color:"#92400e",padding:"7px 14px",
            display:"flex",alignItems:"flex-start",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
            <span style={{fontSize:14,flexShrink:0}}>&#9888;</span>
            <span style={{flex:1}}>
              <strong>{n} saved task {n===1?"date was":"dates were"} out of sync with {n===1?"its":"their"} predecessor{n===1?"":"s"} and {n===1?"has":"have"} been recalculated.</strong>{" "}
              {shown.map((t, i) => (
                <React.Fragment key={t.pid + ":" + t.id}>
                  {i > 0 ? "; " : ""}
                  <span onClick={() => goToTask(t.pid, t.id)} title="Click to jump to this row"
                    style={{cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted"}}>
                    {scheduleRowPrefix(data.projects, t.pid, data.aPid)}#{t.id} "{t.name}" {fmtD(t.from) || "(no date)"}→{fmtD(t.to)}
                  </span>
                </React.Fragment>
              ))}
              {extra > 0 ? `; +${extra} more` : ""}. Check they match your intended schedule — if a gap was deliberate, pin the date or add a lag.
            </span>
            <button onClick={()=>setDriftNotice(null)}
              style={{flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,
                background:"var(--bg)",border:"1px solid #fcd34d",color:"#92400e",borderRadius:5,padding:"4px 12px"}}>
              Dismiss
            </button>
          </div>
        );
      })()}
      {(() => {
        // B616 — LOUD, unmissable surface for locked-finish conflicts in the active project. A
        // conflicted task keeps its locked finish; this banner makes the user resolve it rather
        // than the schedule silently overrunning or overwriting the lock.
        // NEW-2 (B1696641) — same "names a task, not a row" gap driftNotice had: add the row ID and
        // make each named row jump to it (this banner is already scoped to the active project, so no
        // project-name ambiguity here — just the row).
        // NEW-1 (owner follow-on 2026-09-16) — reviewed for the same cross-project ambiguity as
        // driftNotice/ancestorPredNotice: `data.aPid` scopes this filter, so every row it can ever
        // show is already the schedule on screen. No prefix to add — there's nothing to disambiguate.
        const cft = (data?.projects?.[data.aPid]?.tasks || []).filter(t => t.finishConflict);
        if (!cft.length) return null;
        const shown = cft.slice(0, 3);
        const extra = cft.length - shown.length;
        return (
          <div style={{background:"#fef2f2",borderBottom:"1px solid #fecaca",color:"#991b1b",padding:"7px 14px",
            display:"flex",alignItems:"center",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
            <span style={{fontSize:14,flexShrink:0}}>⚠</span>
            <span style={{flex:1}}>
              <strong>{cft.length} task{cft.length>1?"s":""} can’t meet {cft.length>1?"their":"its"} locked finish date.</strong>{" "}
              The predecessor chain needs more time than the locked finish allows
              ({shown.map((t, i) => (
                <React.Fragment key={t.id}>
                  {i > 0 ? ", " : ""}
                  <span onClick={() => goToTask(data.aPid, t.id)} title="Click to jump to this row"
                    style={{cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted"}}>
                    #{t.id} "{t.name||("Task "+t.id)}"
                  </span>
                </React.Fragment>
              ))}{extra > 0 ? `, +${extra} more` : ""}).
              Move the finish, shorten the duration, or change the dependency.
            </span>
          </div>
        );
      })()}
      <div className="app-header" style={{minHeight:46,background:"var(--bg)",borderBottom:"1px solid var(--bd2)",display:"flex",alignItems:"center",flexWrap:"wrap",rowGap:6,columnGap:8,padding:"6px 14px",flexShrink:0,zIndex:30}}>

        {/* Logo — hidden when embedded (the shell chrome already shows the Planyr wordmark) */}
        <svg className="hdr-logo" height="26" viewBox="0 0 196 52" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0,marginRight:8,display:"block"}}>
          <g transform="translate(0,6)">
            <rect x="0"  y="0"  width="44" height="7"  rx="2" fill="#4f46e5"/>
            <rect x="10" y="13" width="33" height="7"  rx="2" fill="#4f46e5"/>
            <rect x="17" y="26" width="39" height="7"  rx="2" fill="#4f46e5"/>
            <path d="M44,3.5 L50,3.5 L50,16.5 L10,16.5" stroke="#4f46e5" strokeWidth="1.2" fill="none" opacity="0.32"/>
            <polygon points="10,16.5 15,13.5 15,19.5" fill="#4f46e5" opacity="0.32"/>
            <path d="M43,16.5 L52,16.5 L52,29.5 L17,29.5" stroke="#4f46e5" strokeWidth="1.2" fill="none" opacity="0.32"/>
            <polygon points="17,29.5 22,26.5 22,32.5" fill="#4f46e5" opacity="0.32"/>
          </g>
          <text x="62" y="36" fontFamily="'Inter',system-ui,sans-serif" fontSize="34" fontWeight="400" letterSpacing="-1.5" fill="#3730a3">planyr</text>
        </svg>

        {/* Mode toggle pill */}
        <div className="hdr-mode" style={{display:"flex",background:"#f0f0f0",borderRadius:7,padding:"3px",gap:2,flexShrink:0}}>
          {[["reports","Dashboard"],["projects","Projects"]].map(([s,label]) => (
            <button key={s} onClick={()=>setData(d=>({...d,section:s}))}
              style={{border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:section===s?600:500,
                letterSpacing:".01em",padding:"5px 12px",borderRadius:5,transition:"all .15s",
                background:section===s?"#fff":"transparent",
                color:section===s?"var(--amber)":"var(--mut)",
                boxShadow:section===s?"0 1px 3px rgba(0,0,0,0.12)":"none"}}>
              {label}
            </button>
          ))}
        </div>

        {/* Project picker — only in projects mode (hidden while reviewing: the queue drives the project) */}
        {section === "projects" && !reviewOpen && (
          <div className="hdr-project" style={{display:"flex",alignItems:"center",gap:8,marginLeft:8,flexShrink:0}}>
            <div style={{width:1,height:22,background:"var(--bd2)",flexShrink:0}} />
            <ProjDropdown data={data} setData={setData} addProject={addProject} setProjCtx={setProjCtx} />
          </div>
        )}

        {/* View switcher — hidden while reviewing (review is grid-only; prevents losing review state on remount).
            This is the ONLY view switcher at every width, and it is now the SAME simple pill at
            every width: tap a tab, `data.view` becomes that tab, and the tapped tab highlights.
            B1281648 (RECURRENCE ×3 of B1241745) — a prior mechanism here had Split, at phone
            width, collapse to ONE pane and repoint Grid/Gantt taps at a `phonePane` state instead
            of leaving Split. The owner rejected that shape on his own iPhone across three shipped
            builds (#1490, #1497, #1504): a single pane behind the "Split" tab looks and behaves
            exactly like just tapping Grid or Gantt, so it read as "Split does nothing" every time,
            no matter how the pill's own highlight was fixed. Split now renders BOTH panes at once,
            stacked, at every width (see `SplitView`'s own `isMobile` branch) — so there is no
            "which pane" state to route around here any more, and this pill needs no special case
            for phone width at all. */}
        {section === "projects" && !reviewOpen && (
          <div className="hdr-view" style={{display:"flex",background:"#f0f0f0",borderRadius:7,padding:"3px",gap:2,marginLeft:8,flexShrink:0}}>
            {[["grid","Grid"],["split","Split"],["gantt","Gantt"]].map(([v,label]) => {
              const active = data.view === v;
              return (
                <button key={v} onClick={()=>setData(d=>({...d,view:v}))}
                  style={{border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:active?600:500,
                    letterSpacing:".01em",padding:"5px 12px",borderRadius:5,transition:"all .15s",
                    background:active?"#fff":"transparent",
                    color:active?"var(--amber)":"var(--mut)",
                    boxShadow:active?"0 1px 3px rgba(0,0,0,0.12)":"none"}}>
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* Review toggle — only in projects mode; flips the in-place review panel on/off */}
        {section === "projects" && (
          <button onClick={()=>{
              const opening = !reviewOpen;
              if (opening && reviewRows.length && data && data.projects) {
                const a = reviewRows[Math.min(reviewIdx, reviewRows.length-1)];
                if (a && a.project_id != null && data.projects[a.project_id] && data.aPid !== a.project_id) setData(d=>({...d, aPid:a.project_id}));
              }
              setReviewOpen(opening);
            }} title="Review suggested updates from forwarded emails"
            className="hdr-review"
            style={{marginLeft:8,flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,
              letterSpacing:".01em",display:"flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:7,transition:"all .15s",
              border: reviewOpen ? "1px solid var(--amber)" : "1px solid var(--bd2)",
              background: reviewOpen ? "#eef2ff" : "var(--surf)",
              color: (reviewOpen || reviewRows.length) ? "var(--amber)" : "var(--mut)"}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            {reviewRows.length > 0 && (
              <span style={{fontSize:11,fontWeight:700,color:"#fff",background:"var(--amber)",borderRadius:20,
                padding:"1px 7px",minWidth:18,textAlign:"center",lineHeight:1.5}}>{reviewRows.length}</span>
            )}
          </button>
        )}

        {/* Spacer */}
        <div style={{flex:1}} />

        {/* Right action group — desktop: all buttons inline; mobile: overflow menu */}
        <div className="hdr-actions" style={{display:"flex",alignItems:"center",gap:5,flexShrink:0,marginLeft:"auto"}}>

          {/* B1241744 — the phone Gantt zoom control: the desktop pair below is INSIDE the
              `!isMobile` branch and never reaches a phone at all, which is exactly how the
              controls-too-small failure was reported ("hit the controls") once Gantt itself
              stopped being silently replaced by Grid. Same two buttons, touch-sized (44px —
              the WCAG/platform floor CONTROL_H.touch also uses) under a coarse pointer only;
              a narrow desktop window with a mouse keeps the desktop pair's own compact size. */}
          {/* B1281648 — Split now always shows its Gantt pane too (stacked), so the phone zoom
              control applies whenever a Gantt is on screen at all: "gantt" or "split". */}
          {isMobile && (data.view==="gantt" || data.view==="split") && (
            <div style={{display:"flex",alignItems:"center",gap:coarsePointer?4:1}}>
              <button style={{padding:"0 10px",fontSize:15,height:coarsePointer?44:26,minWidth:coarsePointer?44:26,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--bd2)",borderRadius:5,background:"none",color:"var(--mut)",cursor:"pointer"}} title="Zoom out" onClick={()=>setGanttPPD(z=>Math.max(1,Math.floor(z/1.35)))}>−</button>
              <span style={{fontSize:11,color:"var(--mut)",width:30,textAlign:"center",userSelect:"none"}}>{Math.round(ganttPPD/6*100)}%</span>
              <button style={{padding:"0 10px",fontSize:15,height:coarsePointer?44:26,minWidth:coarsePointer?44:26,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--bd2)",borderRadius:5,background:"none",color:"var(--mut)",cursor:"pointer"}} title="Zoom in" onClick={()=>setGanttPPD(z=>Math.min(80,Math.ceil(z*1.35)))}>+</button>
            </div>
          )}

          {isMobile ? (
            /* MOBILE: single overflow button containing Download/Import/Auto-Save */
            <div style={{position:"relative"}}>
              {mobMenuOpen && <div style={{position:"fixed",inset:0,zIndex:998}} onClick={()=>setMobMenuOpen(false)} />}
              <button onClick={()=>setMobMenuOpen(o=>!o)} aria-label="More actions"
                style={{background:mobMenuOpen?"#eef2ff":saveStatus==="error"?"#fef2f2":"none",
                  border:saveStatus==="error"?"1px solid #fca5a5":"1px solid var(--bd2)",cursor:"pointer",
                  borderRadius:5,padding:"6px 10px",display:"flex",alignItems:"center",gap:3,
                  color:saveStatus==="error"?"#dc2626":mobMenuOpen?"var(--amber)":"var(--mut)",transition:"all .12s"}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
              </button>
              {mobMenuOpen && (
                <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"var(--bg)",
                  border:"1px solid var(--bd2)",borderRadius:8,boxShadow:"0 6px 24px rgba(0,0,0,.14)",
                  zIndex:999,minWidth:220,padding:"6px 0",overflow:"hidden"}}>
                  {/* Auto-Save status row */}
                  <div onClick={()=>{ if (saveStatus==="error") { if (latestData.current) attemptCloudSave(latestData.current); } else { openFile(); } setMobMenuOpen(false);}}
                    style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9,borderBottom:"1px solid var(--bd)"}}>
                    <span style={{width:9,height:9,borderRadius:"50%",flexShrink:0,
                      background:saveStatus==="error"?"#dc2626":fileLinked?"#16a34a":"var(--bd2)"}} />
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:saveStatus==="error"?"#dc2626":"var(--txt)",fontWeight:saveStatus==="error"?600:500}}>{saveStatus==="error"?"Not saved — tap to retry":fileLinked?"Backup File Linked":"Link Backup File"}</span>
                      <span style={{fontSize:10,color:saveStatus==="error"?"#dc2626":"var(--mut)"}}>{saveStatus==="error"?"Changes have NOT reached the cloud":fileLinked?"Cloud + local file":"Cloud auto-save is always on"}</span>
                    </div>
                  </div>
                  {/* Download options */}
                  <div onClick={()=>{exportHTML();setMobMenuOpen(false);}} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--mut)",flexShrink:0}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:"var(--txt)",fontWeight:500}}>Web Snapshot</span>
                      <span style={{fontSize:10,color:"var(--mut)"}}>Quick plain task tables · .html</span>
                    </div>
                  </div>
                  <div data-testid="open-history-mobile" onClick={()=>{setHistoryOpen(true);setMobMenuOpen(false);}} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--mut)",flexShrink:0}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:"var(--txt)",fontWeight:500}}>Version History</span>
                      <span style={{fontSize:10,color:"var(--mut)"}}>Browse &amp; restore snapshots</span>
                    </div>
                  </div>
                  <div onClick={()=>{setPdfExportOpen(true);setMobMenuOpen(false);}} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9,borderBottom:"1px solid var(--bd)"}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--mut)",flexShrink:0}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:"var(--txt)",fontWeight:500}}>Export PDF</span>
                      <span style={{fontSize:10,color:"var(--mut)"}}>Print-ready exhibit</span>
                    </div>
                  </div>
                  {/* Automation */}
                  <div onClick={()=>{setAutomationOpen(o=>!o);setMobMenuOpen(false);}}
                    style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9,borderTop:"1px solid var(--bd)"}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--mut)",flexShrink:0}}>
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:"var(--txt)",fontWeight:500}}>Automation</span>
                      <span style={{fontSize:10,color:"var(--mut)"}}>Auto-status rules</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (<>
          {section==="projects" && (
            <button className={formatOpen ? "btn act" : "btn"} title="Format — row height & bar labels"
              onClick={()=>{setFormatOpen(o=>!o); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false);}}
              style={{padding:"0 7px",height:21,display:"flex",alignItems:"center",marginRight:5}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
                <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
              </svg>
            </button>
          )}
          {/* Zoom — only in split/gantt. B1241744 — height reads `coarsePointer`, NOT `isMobile`:
              this branch also serves a phone in LANDSCAPE (832px+ clears the 768px isMobile
              threshold while the pointer stays exactly as coarse — the "iPad in landscape" case
              the phone decision names), which is where the reported "controls too small to hit"
              failure actually lived. A standard fine-pointer desktop measures coarsePointer=false
              and renders at the original 21px — pixel-identical to before. */}
          {section==="projects" && !isMobile && (data.view==="split"||data.view==="gantt") && (
            <div style={{display:"flex",alignItems:"center",gap:coarsePointer?4:1,paddingRight:5,borderRight:"1px solid var(--bd2)"}}>
              <button className="btn" style={{padding:coarsePointer?"0 12px":"0 6px",fontSize:coarsePointer?15:13,height:coarsePointer?44:21,minWidth:coarsePointer?44:undefined,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--bd2)"}} title="Zoom out" onClick={()=>setGanttPPD(z=>Math.max(1,Math.floor(z/1.35)))}>−</button>
              <span style={{fontSize:11,color:"var(--mut)",width:30,textAlign:"center",userSelect:"none"}}>{Math.round(ganttPPD/6*100)}%</span>
              <button className="btn" style={{padding:coarsePointer?"0 12px":"0 6px",fontSize:coarsePointer?15:13,height:coarsePointer?44:21,minWidth:coarsePointer?44:undefined,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--bd2)"}} title="Zoom in" onClick={()=>setGanttPPD(z=>Math.min(80,Math.ceil(z*1.35)))}>+</button>
            </div>
          )}

          {/* Export menu — deliverables only; data backup/restore lives in Version History */}
          <div style={{position:"relative"}}>
            {dlOpen && <div style={{position:"fixed",inset:0,zIndex:998}} onClick={()=>setDlOpen(false)} />}
            <button className="btn" onClick={()=>setDlOpen(o=>!o)} title="Export — PDF exhibit or web snapshot"
              style={{display:"flex",alignItems:"center",gap:4,padding:"0 8px",height:21,lineHeight:1}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              <span style={{fontSize:8,opacity:.5}}>▾</span>
            </button>
            {dlOpen && (
              <div style={{position:"absolute",top:"calc(100% + 5px)",right:0,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:7,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",zIndex:999,minWidth:192,padding:"4px 0",overflow:"hidden"}}>
                <div onClick={()=>{setPdfExportOpen(true);setDlOpen(false);}} style={{padding:"8px 14px",cursor:"pointer",display:"flex",flexDirection:"column",gap:2}} onMouseEnter={e=>e.currentTarget.style.background="#f6f8fa"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{fontSize:12,color:"var(--txt)",fontWeight:500}}>PDF / Print Exhibit</span>
                  <span style={{fontSize:10,color:"var(--mut)"}}>Formatted pages — share or file</span>
                </div>
                <div style={{height:1,background:"var(--bd)",margin:"2px 0"}} />
                <div onClick={()=>{exportHTML();setDlOpen(false);}} style={{padding:"8px 14px",cursor:"pointer",display:"flex",flexDirection:"column",gap:2}} onMouseEnter={e=>e.currentTarget.style.background="#f6f8fa"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{fontSize:12,color:"var(--txt)",fontWeight:500}}>Web Snapshot</span>
                  <span style={{fontSize:10,color:"var(--mut)"}}>Quick plain task tables · .html</span>
                </div>
              </div>
            )}
          </div>


          <div style={{width:1,height:20,background:"var(--bd2)",flexShrink:0}} />

          {/* Save indicator — sticky tri-state. Gray = saved (quiet). Amber = write
              in flight. RED = latest changes did NOT reach the cloud; stays red,
              retries automatically, click retries now. Green flash on each save. */}
          <button className="btn"
            onClick={saveStatus === "error"
              ? () => { if (latestData.current) attemptCloudSave(latestData.current); }
              : openFile}
            title={saveStatus === "error" ? "Changes NOT saved to cloud — retrying automatically. Click to retry now."
              : saveStatus === "saving" ? "Saving to cloud…"
              : (savePulse ? "Saved to cloud ✓" : "All changes saved to cloud")
                + (fileLinked ? " · also writing to linked file" : " — click to also back up to a local file")}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"3px 8px",
              fontSize:11,fontWeight:600,
              color: saveStatus === "error" ? "#dc2626" : savePulse ? "#16a34a" : saveStatus === "saving" ? "#b45309" : "var(--mut)",
              borderColor: saveStatus === "error" ? "#fca5a5" : savePulse ? "#86efac" : (fileLinked ? "#bbf7d0" : undefined),
              background: saveStatus === "error" ? "#fef2f2" : savePulse ? "#f0fdf4" : undefined,
              boxShadow: savePulse && saveStatus !== "error" ? "0 0 0 3px #dcfce7" : "none",
              cursor: saveStatus === "saving" ? "progress" : undefined,
              transition:"color .25s, background .25s, border-color .25s, box-shadow .25s"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            {saveStatus === "error" && "Not saved"}
          </button>


          {/* Version History — icon-only; tooltip names it */}
          <button data-testid="open-history-desktop" onClick={()=>{setHistoryOpen(true); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);}}
            title="Version history — browse & restore snapshots"
            className={historyOpen ? "btn act" : "btn"}
            style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"3px 8px"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              <polyline points="12 7 12 12 15 14"/>
            </svg>
          </button>

          {/* Contacts — icon-only; tooltip names it */}
          <button onClick={()=>{setContactsOpen(o=>!o); setSettingsOpen(false); setAutomationOpen(false); setFormatOpen(false);}} title="Contacts"
            className={contactsOpen ? "btn act" : "btn"}
            style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"3px 8px"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </button>

          {/* Automation */}
          <button onClick={()=>{setAutomationOpen(o=>!o); setSettingsOpen(false); setContactsOpen(false); setFormatOpen(false);}} title="Automation rules"
            className={automationOpen ? "btn act" : "btn"}
            style={{display:"flex",alignItems:"center",gap:5,fontSize:11,padding:"0 9px",height:21,lineHeight:1}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Automation
          </button>

          {/* Settings */}
          <button onClick={()=>{setSettingsOpen(o=>!o); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);}} title="Settings"
            className={settingsOpen ? "btn act" : "btn"}
            style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"3px 8px"}}
          ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg></button>
          </>)}

          {/* Settings — always visible (mobile + desktop) */}
          {isMobile && (
            <button onClick={()=>setSettingsOpen(o=>!o)} title="Settings"
              style={{background:settingsOpen?"#eef2ff":"none",border:"1px solid var(--bd2)",cursor:"pointer",
                fontFamily:"inherit",padding:"6px 8px",borderRadius:5,lineHeight:1,
                color:settingsOpen?"var(--amber)":"var(--mut)",transition:"all .12s"}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          )}

        </div>
      </div>

      {settingsOpen    && <SettingsPanel    data={data} setData={setData} onClose={()=>setSettingsOpen(false)} openFile={openFile} fileLinked={fileLinked} initialSection={settingsSection} onOpenMeetingCalendars={()=>setMeetingCalOpen(true)} />}
      {meetingCalOpen  && <MeetingCalendarsModal
        projName={proj?.name}
        bodies={(activeProjectOf(data) || {}).meetingBodies || []}
        otherSchedules={otherScheduleMeetingBodies(data, data.aPid)}
        onChange={next => setData(d => {
          const p = d.projects && d.projects[d.aPid];
          if (!p) return d;
          const nd = {...d, projects:{...d.projects, [d.aPid]:{...p, meetingBodies: next}}};
          rebuildMeetingBodyIndex(nd);   // B816 — keep the global index fresh so the next cascade uses the edited cadence
          // Re-cascade immediately (same discipline as the Holidays editor): a cadence/lead edit must
          // move bound tasks + deadline rows NOW, not on the next unrelated task edit.
          const proj2 = nd.projects[nd.aPid];
          nd.projects = {...nd.projects, [nd.aPid]: {...proj2, tasks: recomputeSchedule((proj2.tasks || []).map(t => ({...t})))}};
          return nd;
        })}
        onClose={()=>setMeetingCalOpen(false)} />}
      {formatOpen      && <FormatPanel      data={data} setData={setData} onClose={()=>setFormatOpen(false)} />}
      {automationOpen  && <AutomationPanel  data={data} setData={setData} onClose={()=>setAutomationOpen(false)} />}
      {contactsOpen    && <ContactsPanel    data={data} setData={setData} onClose={()=>setContactsOpen(false)} />}
      {historyOpen     && <HistoryPanel     data={data} setData={setData} exportJSON={exportJSON} importJSON={importJSON} applyLoadedData={(parsed)=>applyLoadedDataRef.current?.(parsed)} onClose={()=>setHistoryOpen(false)} />}
      {successorPrompt && <SuccessorPromptModal prompt={successorPrompt} updateTask={updateTask} onClose={()=>setSuccessorPrompt(null)} onOpenTask={(pid, taskId)=>{ goToTask(pid, taskId); setSuccessorPrompt(null); }} />}
      {deleteChoice && (
        <DeleteChildrenModal
          rowCount={deleteChoice.rowCount}
          totalCount={deleteChoice.totalCount}
          onCascade={() => { deleteTasks(deleteChoice.ids); setSelectedId(null); setSelRange(null); setDeleteChoice(null); }}
          onPromote={() => { promoteAndDeleteTasks(deleteChoice.ids); setSelectedId(null); setSelRange(null); setDeleteChoice(null); }}
          onCancel={() => setDeleteChoice(null)}
        />
      )}
      {moveToCtx && (
        <MoveToModal
          tasks={(data.projects[moveToCtx.projId] || {}).tasks || []}
          sourceIds={moveToCtx.ids}
          onCommit={(destParentId, insertAfterId) => { moveSelectionByIds(moveToCtx.ids, destParentId, insertAfterId); setMoveToCtx(null); }}
          onCancel={() => setMoveToCtx(null)}
        />
      )}

      {/* BODY */}
      <div style={{flex:1,overflow:"hidden",display:"flex"}}>
        <ErrorBoundary key={data.view}>
        {/* B1281648 — effective view is just `data.view` at every width now (must match the
            toolbar-bridge copy above exactly). Split renders at every width — `SplitView` itself
            branches on `isMobile` (carried in `shared`) to stack its two panes vertically on a
            phone instead of the desktop's resizable side-by-side layout; Grid/Gantt are always
            full-height, single-pane, unchanged at any width. */}
        {section === "projects" && !reviewOpen && (data.view ?? "grid")==="grid"  && <GridView   {...shared} />}
        {section === "projects" && !reviewOpen && (data.view ?? "grid")==="gantt" && <GanttView  tasks={flatTasks} updateTask={updateTask} pxPerDay={ganttPPD} onZoomChange={setGanttPPD} rolledHealthMap={rolledHealthMap} proj={proj} onMouseEnter={()=>setHoverZone('gantt')} selectedId={selectedId} setSelectedId={setSelectedId} settings={data.settings} />}
        {section === "projects" && !reviewOpen && data.view==="split" && <SplitView  {...shared} />}
        {section === "reports"                         && <MasterView data={data} setData={setData} updateTask={updateTask} setNotesCtx={setNotesCtx} goToTask={goToTask} />}
        {section === "projects" && reviewOpen           && <SuggestionsView data={data} updateTask={updateTask} setData={setData} rows={reviewRows} setRows={setReviewRows} loading={reviewLoading} onClose={()=>setReviewOpen(false)} gridProps={shared} activeIdx={reviewIdx} setActiveIdx={setReviewIdx} />}
        </ErrorBoundary>
      </div>

      {liveNotesTask && (
        <NotesModal task={liveNotesTask} projectId={notesCtx.projectId} initChar={notesCtx?.initChar||null} updateTask={updateTask} onClose={() => setNotesCtx(null)} />
      )}
      {pdfExportOpen && (
        <PDFExportModal data={data} activePid={data.aPid} setData={setData} onClose={() => setPdfExportOpen(false)} />
      )}

      {iconPickerCtx && (
        <TaskIconPickerHost ctx={iconPickerCtx} tasks={(data.projects[iconPickerCtx.projId] || {}).tasks || []} updateTask={updateTask} onClose={() => setIconPickerCtx(null)} />
      )}

      {taskCtx && (
        <TaskContextMenu
          x={taskCtx.x} y={taskCtx.y}
          task={taskCtx.task}
          projId={taskCtx.projId}
          onInsertAbove={() => { insertTaskAbove(taskCtx.task.id); setTaskCtx(null); }}
          onInsertBelow={() => { insertTaskBelow(taskCtx.task.id); setTaskCtx(null); }}
          onAddSubtask={() => { addSubtask(taskCtx.task.id); setTaskCtx(null); }}
          onDuplicate={() => { duplicateTask(taskCtx.task.id); setTaskCtx(null); }}
          onCutTask={() => { cutTaskById(structuralTargets(taskCtx.task.id)); setTaskCtx(null); }}
          onCopyTaskFull={() => { copyTaskById(structuralTargets(taskCtx.task.id)); setTaskCtx(null); }}
          onPasteTask={() => { pasteTaskAfter(taskCtx.task.id); setTaskCtx(null); }}
          hasClipboard={!!clipboardRef.current}
          onIndent={() => { const ids = blockOnlyTargets(taskCtx.task.id); if (ids) indentSelectionByIds(ids); setTaskCtx(null); }}
          onOutdent={() => { const ids = blockOnlyTargets(taskCtx.task.id); if (ids) outdentSelectionByIds(ids); setTaskCtx(null); }}
          onMoveTo={() => { const ids = blockOnlyTargets(taskCtx.task.id); if (ids) setMoveToCtx({ ids, projId: taskCtx.projId }); setTaskCtx(null); }}
          canOutdent={(() => {
            const targets = structuralTargets(taskCtx.task.id);
            const ts = (data.projects[taskCtx.projId] || {}).tasks || [];
            const byId = new Map(ts.map(t => [t.id, t]));
            return targets.some(id => (byId.get(id)?.parentId ?? null) !== null);
          })()}
          meetingBodies={(data.projects[taskCtx.projId] || {}).meetingBodies || []}
          otherBodies={otherScheduleMeetingBodies(data, taskCtx.projId).flatMap(g => g.bodies.map(b => ({ pid: g.pid, schedName: g.schedName, body: b })))}
          bindCount={(() => { const ids = fullRowSelIds(); return ids.length > 1 && ids.includes(taskCtx.task.id) ? ids.length : 1; })()}
          boundTasks={(() => {
            // Bound LEAF tasks this row could serve as the deadline row for (exclude self + parents).
            const ts = (data.projects[taskCtx.projId] || {}).tasks || [];
            const parents = new Set(ts.filter(t => t.parentId != null).map(t => t.parentId));
            return ts.filter(t => t.meetingBound && t.meetingBodyId && t.id !== taskCtx.task.id && !parents.has(t.id)).map(t => ({ id: t.id, name: t.name || `Task ${t.id}` }));
          })()}
          deadlineAnchorName={(() => {
            if (taskCtx.task.deadlineForTaskId == null) return null;
            const a = ((data.projects[taskCtx.projId] || {}).tasks || []).find(t => t.id === taskCtx.task.deadlineForTaskId);
            return a ? (a.name || `Task ${a.id}`) : null;
          })()}
          onBindMeeting={bodyId => {
            // Right-click inside a multi-row selection binds the whole selection (mirror the delete semantics).
            // Binding clears any deadline link — the two snap modes are mutually exclusive.
            const ids = fullRowSelIds();
            const targets = ids.length > 1 && ids.includes(taskCtx.task.id) ? ids : [taskCtx.task.id];
            targets.forEach(id => updateTask(id, {meetingBound:true, meetingBodyId:bodyId, deadlineForTaskId:null}, taskCtx.projId));
            setTaskCtx(null);
          }}
          onUnbindMeeting={() => {
            const ids = fullRowSelIds();
            const targets = ids.length > 1 && ids.includes(taskCtx.task.id) ? ids : [taskCtx.task.id];
            targets.forEach(id => updateTask(id, {meetingBound:false, meetingBodyId:null, pinnedMeetingDate:undefined}, taskCtx.projId));
            setTaskCtx(null);
          }}
          onImportBindMeeting={(srcPid, srcBodyId) => {
            // NEW-1 (B1824576) — "reuse a meeting calendar from another schedule": copies the body
            // into THIS schedule (deduping against an identical-cadence body already here) and
            // binds the current selection to it, in one step. Mirrors onBindMeeting above, with
            // the copy-in as an extra setData ahead of the per-task updateTask loop.
            const ids = fullRowSelIds();
            const targets = ids.length > 1 && ids.includes(taskCtx.task.id) ? ids : [taskCtx.task.id];
            const projId = taskCtx.projId;
            const srcBody = ((data.projects[srcPid] || {}).meetingBodies || []).find(b => b.id === srcBodyId);
            if (!srcBody) { setTaskCtx(null); return; }
            const destBodies = (data.projects[projId] || {}).meetingBodies || [];
            const { bodies: nextBodies, id: newBodyId } = importMeetingBody(destBodies, srcBody);
            if (nextBodies !== destBodies) {
              setData(d => {
                const p = d.projects[projId];
                if (!p) return d;
                const nd = {...d, projects: {...d.projects, [projId]: {...p, meetingBodies: nextBodies}}};
                rebuildMeetingBodyIndex(nd);
                return nd;
              });
            }
            targets.forEach(id => updateTask(id, {meetingBound:true, meetingBodyId:newBodyId, deadlineForTaskId:null}, projId));
            setTaskCtx(null);
          }}
          onAddDeadlineRow={() => { addDeadlineTask(taskCtx.task.id, taskCtx.projId); setTaskCtx(null); }}
          onLinkAsDeadline={anchorId => { updateTask(taskCtx.task.id, {deadlineForTaskId: anchorId, meetingBound:false, meetingBodyId:null, pinnedMeetingDate:undefined}, taskCtx.projId); setTaskCtx(null); }}
          onUnlinkDeadline={() => { updateTask(taskCtx.task.id, {deadlineForTaskId: null}, taskCtx.projId); setTaskCtx(null); }}
          onAddMeetingCalendar={() => { setMeetingCalOpen(true); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false); setTaskCtx(null); }}
          onStepMeeting={iso => { if (iso) updateTask(taskCtx.task.id, {pinnedMeetingDate: iso}, taskCtx.projId); setTaskCtx(null); }}
          onDelete={() => {
            // Right-click inside a multi-row selection deletes the whole selection — asks first
            // if any row in it has subtasks (requestDelete); otherwise deletes immediately.
            const ids = fullRowSelIds();
            requestDelete(ids.length > 1 && ids.includes(taskCtx.task.id) ? ids : [taskCtx.task.id]);
            setTaskCtx(null);
          }}
          deleteCount={(() => { const ids = fullRowSelIds(); return ids.length > 1 && ids.includes(taskCtx.task.id) ? ids.length : 1; })()}
          onSetHealth={hk => { updateTask(taskCtx.task.id, {health: hk}, taskCtx.projId); setTaskCtx(null); }}
          hasIcons={window.PlanyrTaskIcons.normalizeTaskIcons(taskCtx.task.icons).length > 0}
          onSetIcon={() => { setIconPickerCtx({taskId: taskCtx.task.id, projId: taskCtx.projId, x: taskCtx.x, y: taskCtx.y}); setTaskCtx(null); }}
          onRemoveIcon={() => { updateTask(taskCtx.task.id, {icons: []}, taskCtx.projId); setTaskCtx(null); }}
          fmt={ctxFmtState()}
          onSetRowColor={color => applyFormatAndSync({fill: color ?? null})}
          onSetBold={v   => applyFormatAndSync({bold: v})}
          onSetItalic={v => applyFormatAndSync({italic: v})}
          onSetUnderline={v => applyFormatAndSync({underline: v})}
          onSetTextColor={color => applyFormatAndSync({color: color ?? null})}
          onSetFontSize={size => applyFormatAndSync({size: size ?? null})}
          onClearFormat={() => applyFormatAndSync({}, {clearAll: true})}
          onClose={() => setTaskCtx(null)}
        />
      )}

      {projCtx && (
        <ProjContextMenu
          x={projCtx.x} y={projCtx.y}
          projId={projCtx.id}
          canDelete={true}
          onRename={() => { setRenameModal({id: projCtx.id, name: data.projects[projCtx.id]?.name || ""}); setProjCtx(null); }}
          onDuplicate={() => { duplicateProject(projCtx.id); setProjCtx(null); }}
          onDelete={() => { deleteProject(projCtx.id); setProjCtx(null); }}
          onClose={() => setProjCtx(null)}
        />
      )}

      {renameModal && (
        <RenameModal
          name={renameModal.name}
          onConfirm={name => { renameProject(renameModal.id, name); setRenameModal(null); }}
          onClose={() => setRenameModal(null)}
        />
      )}
    </div>
  );
}

// ── ProjDropdown ──────────────────────────────────────────
function ProjDropdown({data, setData, addProject, setProjCtx, breadcrumb=false}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editVal,   setEditVal]   = useState("");
  const editRef = useRef(null);
  const btnRef  = useRef(null);
  const menuRef = useRef(null);
  const pos = useAnchoredPopover(open, btnRef, r => ({top: r.bottom + 4, left: r.left}), () => setOpen(false));   // NEW-1

  const projHealth = p => {
    if (!p.tasks.length) return "gray";
    if (p.tasks.some(t => t.health === "red"))    return "red";
    if (p.tasks.some(t => t.health === "yellow")) return "yellow";
    if (p.tasks.every(t => t.health === "green")) return "green";
    return "gray";
  };

  const toggle = () => setOpen(o => !o);

  useEffect(() => {
    if (!open) { setEditingId(null); return; }
    const down = e => {
      if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  useEffect(() => { if (editingId !== null) setTimeout(()=>editRef.current?.focus(),0); }, [editingId]);

  const cur = activeProjectOf(data);
  const dot = HEALTH[cur ? projHealth(cur) : "gray"].dot;

  return (
    <>
      <button ref={btnRef}
        className=""
        style={breadcrumb
          ? {background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",
             display:"flex",alignItems:"center",gap:5,padding:"3px 6px",borderRadius:4,
             fontSize:12,fontWeight:600,color:"var(--txt)"}
          : {display:"flex",alignItems:"center",gap:9,cursor:"pointer",fontFamily:"inherit",
             background:open?"#eef2ff":"transparent",border:`1px solid ${open?"#c7d2fe":"transparent"}`,
             borderRadius:7,padding:"4px 10px",maxWidth:230,minWidth:80,
             transition:"background .15s,border-color .15s"}}
        onClick={toggle}
        onMouseEnter={e=>{ if(!breadcrumb && !open) e.currentTarget.style.background="var(--surf)"; }}
        onMouseLeave={e=>{ if(!breadcrumb && !open) e.currentTarget.style.background="transparent"; }}>
        {!breadcrumb && <span style={{width:10,height:10,borderRadius:"50%",background:dot,flexShrink:0,boxShadow:`0 0 0 3px ${dot}1f`}} />}
        <span style={breadcrumb
          ? {overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"left"}
          : {overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"left",
             fontSize:16,fontWeight:700,letterSpacing:"-.015em",color:"var(--txt)",lineHeight:1.1}}>{cur?.name}</span>
        <i className="ti ti-chevron-down" aria-hidden="true"
          style={{fontSize:breadcrumb?11:13,color:"var(--mut)",flexShrink:0,transition:"transform .15s",transform:open?"rotate(180deg)":"none"}} />
      </button>

      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} style={{position:"fixed",top:pos.top,left:pos.left,background:"var(--bg)",border:"1px solid var(--bd2)",
          borderRadius:6,padding:4,zIndex:9999,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",minWidth:230}}>
          {Object.values(data.projects).map(p => {
            const h = projHealth(p);
            const isActive = p.id === data.aPid;
            const isEditing = editingId === p.id;
            const confirmRename = () => {
              if (editVal.trim()) setData(d=>({...d,projects:{...d.projects,[p.id]:{...d.projects[p.id],name:editVal.trim()}}}));
              setEditingId(null);
            };
            return (
              <div key={p.id}
                onClick={() => { if(!isEditing){ setData(d=>({...d, aPid:p.id})); setOpen(false); } }}
                onContextMenu={e => { e.preventDefault(); setProjCtx({id:p.id, x:e.clientX, y:e.clientY}); setOpen(false); }}
                style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",borderRadius:4,
                  cursor:isEditing?"default":"pointer",
                  background:isActive?"var(--surf)":"transparent",
                  fontFamily:"'Inter',system-ui,sans-serif",fontSize:12,
                  fontWeight:isActive?500:400,color:"var(--txt)"}}
                onMouseEnter={e=>{ if(!isActive&&!isEditing) e.currentTarget.style.background="var(--surf)"; }}
                onMouseLeave={e=>{ if(!isActive&&!isEditing) e.currentTarget.style.background="transparent"; }}>
                <span style={{width:7,height:7,borderRadius:"50%",background:HEALTH[h].dot,flexShrink:0}} />
                {/* B1873361 — the switcher lists EVERY schedule on the account flat, so a bare
                    name is exactly the ambiguity NEW-1 closed in the reports table: two schedules
                    named "Master Schedule" under different projects would be indistinguishable
                    here otherwise. The rename INPUT still edits the raw name (below), unaffected. */}
                {isEditing
                  ? <input {...NO_AUTOFILL} ref={editRef} value={editVal} onChange={e=>setEditVal(e.target.value)}
                      onClick={e=>e.stopPropagation()}
                      onKeyDown={e=>{if(e.key==="Enter"){e.stopPropagation();confirmRename();}if(e.key==="Escape"){e.stopPropagation();setEditingId(null);}}}
                      onBlur={confirmRename}
                      style={{flex:1,border:"1px solid var(--blue)",borderRadius:3,padding:"2px 5px",fontSize:12,
                        fontFamily:"inherit",outline:"none",background:"var(--bg)",color:"var(--txt)"}} />
                  : <span title={crossScheduleLabel(p)} style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{crossScheduleLabel(p)}</span>
                }
                {!isEditing && (
                  <span
                    onClick={e=>{ e.stopPropagation(); setEditVal(p.name); setEditingId(p.id); }}
                    title="Rename"
                    style={{opacity:0,fontSize:11,color:"var(--mut)",cursor:"pointer",flexShrink:0,padding:"1px 3px",borderRadius:3,lineHeight:1,
                      transition:"opacity .12s"}}
                    onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.color="var(--amber)";e.currentTarget.style.background="#eef2ff";}}
                    onMouseLeave={e=>{e.currentTarget.style.opacity="0";e.currentTarget.style.color="var(--mut)";e.currentTarget.style.background="transparent";}}
                    ref={el=>{
                      if(el){
                        const row=el.closest("div[style]");
                        if(row){
                          row.addEventListener("mouseenter",()=>{el.style.opacity="0.4";});
                          row.addEventListener("mouseleave",()=>{el.style.opacity="0";});
                        }
                      }
                    }}>
                    <i className="ti ti-pencil" style={{fontSize:11}} />
                  </span>
                )}
                {!isEditing && isActive && <i className="ti ti-check" aria-hidden="true" style={{fontSize:12,color:"var(--amber)",flexShrink:0}} />}
              </div>
            );
          })}
          <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
          <div onClick={() => { addProject(); setOpen(false); }}
            style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:4,cursor:"pointer",
              fontFamily:"'Inter',system-ui,sans-serif",fontSize:12,color:"var(--mut)"}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <i className="ti ti-plus" aria-hidden="true" style={{fontSize:13}} />
            New project
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── RenameModal ───────────────────────────────────────────
function RenameModal({name, onConfirm, onClose}) {
  const [val, setVal] = useState(name);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  const confirm = () => { if (val.trim()) onConfirm(val.trim()); };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000060",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={onClose}>
      <div style={{background:"var(--surf)",border:"1px solid var(--bd2)",borderTop:"2px solid var(--amber)",borderRadius:6,
        padding:20,width:340,display:"flex",flexDirection:"column",gap:14}}
        onClick={e=>e.stopPropagation()}>
        <div style={{color:"var(--amber)",fontFamily:"'Inter',system-ui,sans-serif",fontWeight:600,fontSize:11,letterSpacing:".06em"}}>RENAME PROJECT</div>
        <input {...NO_AUTOFILL} ref={inputRef} className="ei" value={val} onChange={e=>setVal(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") confirm(); if(e.key==="Escape") onClose(); }} />
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" style={{borderColor:"var(--amber)",color:"var(--amber)"}} onClick={confirm}>Rename</button>
        </div>
      </div>
    </div>
  );
}

// ── ProjContextMenu ───────────────────────────────────────
function ProjContextMenu({x, y, projId, canDelete, onRename, onDuplicate, onDelete, onClose}) {
  const menuRef = useRef(null);

  useEffect(() => {
    const down = e => { if (!menuRef.current?.contains(e.target)) onClose(); };
    const key  = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown",   key);
    // NEW-1 — opened at a click point, so a scroll or resize leaves it stranded: close it (like TaskContextMenu).
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true); window.removeEventListener("resize", onClose); };
  }, [onClose]);

  // Nudge menu back on-screen if it would overflow
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = 178, mh = canDelete ? 108 : 76;
  const left = x + mw > vw ? vw - mw - 8 : x;
  const top  = y + mh > vh ? vh - mh - 8 : y;

  const Item = ({icon, label, danger, onClick}) => (
    <div onClick={onClick}
      style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",cursor:"pointer",fontSize:12,
        color:danger?"#dc2626":"var(--txt)",borderRadius:4,transition:"background .1s",fontFamily:"'Inter',system-ui,sans-serif"}}
      onMouseEnter={e=>e.currentTarget.style.background=danger?"#fff1f2":"var(--surf)"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <i className={`ti ${icon}`} style={{fontSize:14,flexShrink:0,color:danger?"#dc2626":"var(--mut)"}} aria-hidden="true" />
      {label}
    </div>
  );

  return ReactDOM.createPortal(
    <div ref={menuRef} style={{position:"fixed",top,left,background:"var(--bg)",border:"1px solid var(--bd2)",
      borderRadius:6,padding:"4px",zIndex:9999,boxShadow:"0 4px 16px rgba(0,0,0,0.13)",minWidth:mw}}>
      <Item icon="ti-pencil"      label="Rename"    onClick={onRename} />
      <Item icon="ti-copy"        label="Duplicate" onClick={onDuplicate} />
      {canDelete && <>
        <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
        <Item icon="ti-trash" label="Delete" danger onClick={onDelete} />
      </>}
    </div>,
    document.body
  );
}

// ── SwatchGrid / CaretPopover — shared by the format mini-toolbar's two color carets ──
// Same 1-"none"+19-color palette, same layout, that used to sit inside the context menu
// itself (NEW-1, chat 2026-09-11): "nothing about which colours are available changes;
// they just stop occupying the top third of the menu."
const SwatchGrid = ({current, onPick}) => (
  <div style={{padding:"4px 5px",display:"grid",gridTemplateColumns:"repeat(10, 18px)",gap:2,justifyContent:"start"}}>
    <button title="None (clear)" onClick={()=>onPick(null)} type="button"
      style={{width:18,height:18,borderRadius:2,background:"var(--bg)",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",
        border: current==null ? "1.5px solid #4f46e5" : "1px solid #d1d5db"}}>
      <svg width="9" height="9" viewBox="0 0 10 10">
        <line x1="1" y1="1" x2="9" y2="9" stroke={current==null?"#4f46e5":"#9ca3af"} strokeWidth="1.5"/>
        <line x1="9" y1="1" x2="1" y2="9" stroke={current==null?"#4f46e5":"#9ca3af"} strokeWidth="1.5"/>
      </svg>
    </button>
    {ROW_COLORS.slice(0, 19).map(rc => (
      <button key={rc.color} title={rc.label} onClick={()=>onPick(rc.color)} type="button"
        style={{width:18,height:18,borderRadius:2,background:rc.color,cursor:"pointer",padding:0,
          border:current===rc.color?"1.5px solid #111827":"1px solid #d1d5db",
          boxShadow:current===rc.color?"inset 0 0 0 1px #fff":"none"}} />
    ))}
  </div>
);
const CaretPopover = ({children, popRef, openLeft}) => (
  <div ref={popRef} onMouseDown={e=>e.stopPropagation()}
    style={{position:"absolute", top:"100%", marginTop:4, ...(openLeft?{right:0}:{left:0}),
      background:"var(--bg)", border:"1px solid var(--bd2)", borderRadius:6,
      boxShadow:"0 8px 24px rgba(0,0,0,0.18)", zIndex:10002}}>
    {children}
  </div>
);

// ── FormatMiniToolbar ─────────────────────────────────────
// NEW-1/NEW-2 (chat, 2026-09-11, owner-approved mock-up) — the Word-mini-toolbar-style
// floating strip that replaced the context menu's old top-of-menu formatting section.
// Own surface (border/radius/shadow), positioned by the caller just above (or, if there's
// no room, below) the command menu, and forwards its DOM ref so the menu's own outside-
// click/Escape/scroll close logic can treat both as one unit (see TaskContextMenu below).
const FormatMiniToolbar = React.forwardRef(function FormatMiniToolbar(
  {fmt, onSetBold, onSetItalic, onSetUnderline, onSetTextColor, onSetFill, onSetFontSize, onClearFormat, top, left, maxWidth}, ref) {
  const fb = fmt;
  const [openCaret, setOpenCaret] = useState(null); // 'size' | 'color' | 'fill' | null
  const popRef = useRef(null);
  useEffect(() => {
    if (!openCaret) return;
    const down = e => {
      if (popRef.current?.contains(e.target)) return;          // inside the open popover — keep it open
      if (e.target.closest?.("[data-caret-toggle]")) return;   // the caret button owns its own toggle
      setOpenCaret(null);
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [openCaret]);

  const sizeDisplay = fb.size === "mixed" ? "" : (fb.size != null ? String(fb.size) : "");
  const [sizeText, setSizeText] = useState(sizeDisplay);
  useEffect(() => { setSizeText(sizeDisplay); }, [sizeDisplay]);
  const commitSize = raw => {
    const trimmed = String(raw).trim();
    if (trimmed === "") { onSetFontSize(null); return; }
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n)) { setSizeText(sizeDisplay); return; }
    onSetFontSize(Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n * 2) / 2)));
  };

  const MiniBtn = ({active, disabled, onClick, title, children, w = 20}) => (
    <button title={title} onClick={disabled ? undefined : onClick} disabled={disabled} type="button"
      style={{width:w,height:20,borderRadius:3,padding:0,cursor:disabled?"default":"pointer",flexShrink:0,
        display:"inline-flex",alignItems:"center",justifyContent:"center",
        color: disabled ? "#c0c8d0" : active ? "#fff" : "var(--txt)",
        background: active ? "#4f46e5" : "transparent",
        border: `1px solid ${active ? "#4338ca" : "transparent"}`,
        opacity: disabled ? 0.5 : 1}}
      onMouseEnter={e=>{ if(!disabled && !active) e.currentTarget.style.background="#e5e7eb"; }}
      onMouseLeave={e=>{ if(!disabled && !active) e.currentTarget.style.background="transparent"; }}>
      {children}
    </button>
  );
  const Row = ({children}) => <div style={{display:"flex",alignItems:"center",gap:2,height:22}}>{children}</div>;
  const Group = ({children, style}) => <div style={{display:"flex",flexDirection:"column",gap:1,padding:"3px 5px",justifyContent:"center",flexShrink:0,...style}}>{children}</div>;
  const VRule = () => <div style={{width:1,alignSelf:"stretch",background:"var(--bd2)",margin:"3px 0"}} />;
  // Text-colour / highlight caret button: an icon over a colored bar (the color it will
  // apply), with a caret that opens the SAME 20-swatch palette. (c) — same colours, same
  // "none" option; only WHERE they live changed.
  const ColorCaret = ({kind, icon, current, title, onPick}) => (
    <div style={{position:"relative",display:"flex",alignItems:"center",gap:1}}>
      <MiniBtn title={title} onClick={()=>{}} w={22}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
          {icon}
          <div style={{width:13,height:2.5,background:current||"transparent",border:current?"none":"1px dashed #c0c8d0",borderRadius:1}} />
        </div>
      </MiniBtn>
      <button data-caret-toggle title={`${title} options`} type="button" onClick={()=>setOpenCaret(c=>c===kind?null:kind)}
        style={{width:11,height:20,border:"none",background:"transparent",cursor:"pointer",color:"var(--mut)",flexShrink:0,fontSize:8,padding:0}}>▾</button>
      {openCaret===kind && <CaretPopover popRef={popRef}><SwatchGrid current={current} onPick={c=>{ onPick(c); setOpenCaret(null); }} /></CaretPopover>}
    </div>
  );

  return (
    <div ref={ref} onMouseDown={e=>e.stopPropagation()}
      style={{position:"fixed",top,left,maxWidth,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:8,
        boxShadow:"0 6px 20px rgba(0,0,0,0.16)",display:"flex",flexWrap:"wrap",alignItems:"stretch",
        fontFamily:"'Inter',system-ui,sans-serif",zIndex:10001,padding:1}}>
      {/* Group 1 — size (type-in + caret + grow/shrink), then B / I / U */}
      <Group>
        <Row>
          <input {...NO_AUTOFILL} value={sizeText} onChange={e=>setSizeText(e.target.value)}
            onBlur={e=>commitSize(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commitSize(e.target.value); e.currentTarget.blur(); } else if(e.key==="Escape"){ setSizeText(sizeDisplay); e.currentTarget.blur(); } }}
            placeholder="—" title="Text size" aria-label="Text size"
            style={{width:28,height:20,fontSize:11,border:"1px solid var(--bd2)",borderRadius:3,textAlign:"center",padding:0,fontFamily:"'Inter',system-ui,sans-serif"}} />
          <div style={{position:"relative"}}>
            <button data-caret-toggle title="Text size options" type="button" onClick={()=>setOpenCaret(c=>c==="size"?null:"size")}
              style={{width:11,height:20,border:"none",background:"transparent",cursor:"pointer",color:"var(--mut)",flexShrink:0,fontSize:8,padding:0}}>▾</button>
            {openCaret==="size" && (
              <CaretPopover popRef={popRef}>
                <div style={{padding:"2px 0",minWidth:56,maxHeight:220,overflow:"auto"}}>
                  {FONT_SIZE_STEPS.map(v => (
                    <div key={v} onClick={()=>{ onSetFontSize(v); setOpenCaret(null); }}
                      style={{padding:"4px 10px",fontSize:11,cursor:"pointer",textAlign:"left",
                        background: fb.size===v ? "var(--surf)" : "transparent", fontWeight: fb.size===v?700:400}}>{v}</div>
                  ))}
                </div>
              </CaretPopover>
            )}
          </div>
          <MiniBtn title="Shrink text" onClick={()=>onSetFontSize(stepFontSize(fb.size==="mixed"?(fb.naturalSize??12):(fb.size??fb.naturalSize??12), -1))}><span style={{fontSize:10,fontWeight:700}}>A−</span></MiniBtn>
          <MiniBtn title="Grow text"   onClick={()=>onSetFontSize(stepFontSize(fb.size==="mixed"?(fb.naturalSize??12):(fb.size??fb.naturalSize??12), +1))}><span style={{fontSize:10,fontWeight:700}}>A+</span></MiniBtn>
        </Row>
        <Row>
          <MiniBtn active={!!fb.bold}      onClick={()=>onSetBold(!fb.bold)}           title="Bold"><span style={{fontWeight:800,fontSize:12}}>B</span></MiniBtn>
          <MiniBtn active={!!fb.italic}    onClick={()=>onSetItalic(!fb.italic)}       title="Italic"><span style={{fontStyle:"italic",fontWeight:600,fontSize:12,fontFamily:"Georgia,'Times New Roman',serif"}}>I</span></MiniBtn>
          <MiniBtn active={!!fb.underline} onClick={()=>onSetUnderline(!fb.underline)} title="Underline"><span style={{fontWeight:700,fontSize:12,textDecoration:"underline"}}>U</span></MiniBtn>
        </Row>
      </Group>
      <VRule/>
      {/* Group 2 — text colour, then highlight/fill; both open the same swatch palette */}
      <Group>
        <Row>
          <ColorCaret kind="color" title="Text color" current={fb.color}
            icon={<span style={{fontSize:11,fontWeight:800,lineHeight:1,fontFamily:"'Inter',system-ui,sans-serif"}}>A</span>}
            onPick={onSetTextColor} />
        </Row>
        <Row>
          <ColorCaret kind="fill" title="Highlight / fill" current={fb.fill}
            icon={
              <svg width="12" height="10" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11l8 8a2 2 0 0 0 2.8 0L22 10.5 12.5 1 4 9.5a2 2 0 0 0 0 2.8z" />
                <path d="M5 9h13" />
              </svg>
            }
            onPick={onSetFill} />
        </Row>
      </Group>
      <VRule/>
      <Group style={{justifyContent:"center"}}>
        <MiniBtn title="Clear formatting" disabled={!fb.hasAny} onClick={onClearFormat} w={20}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 20H7l-4-4 8-8 12 12-4 4" />
            <path d="M9 11l4 4" />
            <path d="M22 21H7" />
          </svg>
        </MiniBtn>
      </Group>
      <VRule/>
      {/* Group 3 — plain, non-clickable selection-count readout ((d) in the item: this is
          what "CELL FORMAT" turned into — a readout, never a toggle). */}
      <Group style={{justifyContent:"center",alignItems:"center",minWidth:52}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--txt)",textAlign:"center",lineHeight:1.1,userSelect:"none"}}>{fb.count} {fb.unit}</div>
        <div style={{fontSize:8,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--mut)",textAlign:"center",userSelect:"none"}}>Selected</div>
      </Group>
    </div>
  );
});

// ── TaskContextMenu ───────────────────────────────────────
// NEW-1 (chat, 2026-09-11) — this is now COMMANDS ONLY; every formatting control moved into
// the sibling FormatMiniToolbar above, which this component portals alongside itself and
// shares open/close lifecycle with (Escape, click-away, scroll, or choosing any command
// closes both as one unit).
function TaskContextMenu({x, y, task, projId, onInsertAbove, onInsertBelow, onAddSubtask, onDuplicate, onCutTask, onCopyTaskFull, onPasteTask, hasClipboard, onIndent, onOutdent, onMoveTo, canOutdent, meetingBodies = [], otherBodies = [], bindCount = 1, boundTasks = [], deadlineAnchorName = null, onBindMeeting, onUnbindMeeting, onImportBindMeeting, onAddDeadlineRow, onLinkAsDeadline, onUnlinkDeadline, onAddMeetingCalendar, onStepMeeting, onDelete, deleteCount = 1, onSetHealth, hasIcons = false, onSetIcon, onRemoveIcon, onSetRowColor, onSetBold, onSetItalic, onSetUnderline, onSetTextColor, onSetFontSize, onClearFormat, fmt, onClose}) {
  const menuRef = useRef(null);
  const toolbarRef = useRef(null);

  useEffect(() => {
    const down = e => { if (!menuRef.current?.contains(e.target) && !toolbarRef.current?.contains(e.target)) onClose(); };
    const key  = e => { if (e.key === "Escape") onClose(); };
    // (f) — scroll closes the whole group too, same as click-away/Escape/choosing a command.
    // Registered on the capture phase so a scroll on any nested scrollable ancestor (the grid
    // body, a submenu's own overflow:auto list) is caught — 'scroll' doesn't bubble on its own.
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown",   key);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);   // NEW-1 — a resized window leaves the click point stale
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown",   key);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const vw = window.innerWidth, vh = window.innerHeight;
  // mh is an estimate of the menu's full rendered height; if y + mh would clip the
  // bottom of the viewport, top shifts up so the menu stays fully visible. Recomputed
  // when row padding changed below — better to slightly overestimate.
  // NEW-1 shrank this considerably once the formatting strip + swatch rows moved out.
  const mw = 220, mh = 460;
  const left = x + mw > vw ? vw - mw - 8 : x;
  const top  = y + mh > vh ? Math.max(8, vh - mh - 8) : y;

  // (e) — the toolbar sits just above the menu with a small gap; if there isn't room above,
  // it drops below the menu instead; either way it's clamped fully on screen. Because `top`
  // (the menu's own placed top) is always at-or-above the row's actual click point `y` (the
  // overflow branch above only ever shifts the menu UP), anchoring the toolbar above `top` —
  // or, in the fallback, below the menu's full height — keeps it off the clicked row either way.
  const TB_W = 258, TB_H = 54, TB_GAP = 6;
  const tbMaxWidth = Math.min(TB_W, vw - 16);
  let tbTop = top - TB_H - TB_GAP;
  if (tbTop < 8) tbTop = Math.min(top + mh + TB_GAP, vh - TB_H - 8);
  const tbLeft = Math.min(Math.max(8, left), vw - tbMaxWidth - 8);

  const Item = ({icon, label, hint, danger, disabled, onClick, children}) => (
    <div onClick={disabled ? undefined : onClick}
      style={{display:"flex",alignItems:"center",gap:7,padding:"3px 11px",cursor:disabled?"default":"pointer",
        fontSize:11,color:disabled?"#c0c8d0":danger?"#dc2626":"var(--txt)",borderRadius:4,
        transition:"background .1s",fontFamily:"'Inter',system-ui,sans-serif",opacity:disabled?0.5:1}}
      onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.background=danger?"#fff1f2":"var(--surf)"; }}
      onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}>
      <i className={`ti ${icon}`} style={{fontSize:12,flexShrink:0,color:disabled?"#c0c8d0":danger?"#dc2626":"var(--mut)",width:14,textAlign:"center"}} aria-hidden="true" />
      <span style={{flex:1}}>{label}{children}</span>
      {hint && <span style={{color:"#b0b7c0",fontSize:9,fontFamily:"'Inter',system-ui,sans-serif",letterSpacing:".03em"}}>{hint}</span>}
    </div>
  );
  const Sep = () => <div style={{height:1,background:"var(--bd)",margin:"2px 0"}} />;
  // Scope-aware toolbar state: fb reflects the cell OR row being formatted
  // (computed by App from the live selection); falls back to row flags.
  const fb = fmt || {bold: !!task.bold, italic: !!task.italic, underline: !!task.underline,
    fill: task.rowColor || null, color: task.textColor || null, size: task.fontSize || null, naturalSize: [13,12,11.5,11][Math.min(task.level||0,3)],
    hasAny: !!task.rowColor || !!task.bold || !!task.italic || !!task.underline || !!task.textColor || !!task.fontSize,
    count: 1, unit: "row", scopeLabel: null};
  const Header = () => (
    <div style={{padding:"5px 11px 4px",borderBottom:"1px solid var(--bd)",marginBottom:2}}>
      <div style={{fontSize:9,color:"var(--mut)",fontFamily:"'Inter',system-ui,sans-serif",letterSpacing:".06em",textTransform:"uppercase",marginBottom:1}}>Task {task.id}</div>
      <div style={{fontSize:11,fontWeight:task.bold?700:500,fontStyle:task.italic?"italic":"normal",color:"var(--txt)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200}}>{task.name || <span style={{color:"var(--mut)",fontStyle:"italic"}}>New task</span>}</div>
    </div>
  );

  // canOutdent is now passed in as a prop — computed by the caller against the WHOLE resolved
  // selection (structuralTargets), not just this one row, so a multi-row right-click correctly
  // disables Outdent only when every targeted row is already at depth 0.
  // B844 — meeting-calendar flyout. Parent label reflects the row's CURRENT state (bound body /
  // deadline link / unbound); the flyout is one radio list ("— none —" + bodies, ✓ on the current
  // choice) plus the deadline-row actions. Opens leftward when the menu is near the right edge.
  const [subMeet, setSubMeet] = useState(false);
  // NEW-1 (B<PENDING>, 2026-09-23) — a bound body can live on ANOTHER schedule (its id is globally
  // unique — B816; the date math already resolves it via MEETING_BODY_INDEX regardless of which
  // schedule it lives on). `meetingBodies` is only THIS schedule's own list, so a foreign binding
  // used to read as `null` here and fall through to the literal string "Meeting body". `otherBodies`
  // (every OTHER schedule's bodies, already schedule-tagged) is searched as the fallback before
  // giving up — genuinely nowhere (task.meetingBodyMissing) is the only case left unresolved.
  const localBody = task.meetingBound ? meetingBodies.find(b => b.id === task.meetingBodyId) : null;
  const foreignMatch = (task.meetingBound && !localBody) ? otherBodies.find(ob => ob.body.id === task.meetingBodyId) : null;
  const meetingBody = localBody || (foreignMatch ? foreignMatch.body : null);
  const curBodyName = !task.meetingBound ? ""
    : meetingBody ? (meetingBody.name || "Meeting body")
    : "⚠ calendar missing";
  const isDeadlineRow = task.deadlineForTaskId != null;
  const subOpenLeft = left + mw + 210 > vw;
  // "step this bound row to the next/previous meeting" reads off the SAME resolver
  // (adjacentMeetingDate → meetingDatesInRange) the snap flyout below uses; shown only when
  // the row is actually bound to a body that resolves (meetingBody truthy), and disabled
  // (never hidden) when there's no next/previous date to compute one.
  const nextMeetingIso = (meetingBody && task.start) ? adjacentMeetingDate(meetingBody, task.start, "next") : null;
  const prevMeetingIso = (meetingBody && task.start) ? adjacentMeetingDate(meetingBody, task.start, "prev") : null;
  const fmtMeetingStep = iso => { const d = new Date(iso + "T12:00:00"); return isNaN(d) ? "" : d.toLocaleDateString("en-US", {weekday:"short", month:"short", day:"numeric"}); };
  const SubCaption = ({children}) => (
    <div style={{padding:"4px 11px 2px",fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase",userSelect:"none"}}>{children}</div>
  );

  return ReactDOM.createPortal(
    <>
      <FormatMiniToolbar ref={toolbarRef} fmt={fb} top={tbTop} left={tbLeft} maxWidth={tbMaxWidth}
        onSetBold={onSetBold} onSetItalic={onSetItalic} onSetUnderline={onSetUnderline}
        onSetTextColor={onSetTextColor} onSetFill={onSetRowColor} onSetFontSize={onSetFontSize}
        onClearFormat={onClearFormat} />
      <div ref={menuRef} style={{position:"fixed",top,left,background:"var(--bg)",border:"1px solid var(--bd2)",
        borderRadius:6,padding:"3px 0",zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.14)",minWidth:mw}}>
        <Header />
        <Item icon="ti-row-insert-top"    label="Insert Row Above"  hint="Ins"  onClick={onInsertAbove} />
        <Item icon="ti-row-insert-bottom" label="Insert Row Below"              onClick={onInsertBelow} />
        <Item icon="ti-sitemap"           label="Add Subtask"                   onClick={onAddSubtask} />
        <Sep />
        {/* NEW-3 (chat, 2026-09-11) — the meeting group now reads step-first: Next meeting,
            Previous meeting (disabled-not-hidden — so the menu never changes height as the row
            selection changes), THEN the bind/snap flyout trigger. Was: flyout, then the two step
            rows; the owner asked for the reverse. */}
        {meetingBody && (<>
          <Item icon="ti-chevron-right" label={nextMeetingIso ? `Next meeting · ${fmtMeetingStep(nextMeetingIso)}` : "Next meeting"} disabled={!nextMeetingIso} onClick={() => onStepMeeting(nextMeetingIso)} />
          <Item icon="ti-chevron-left"  label={prevMeetingIso ? `Previous meeting · ${fmtMeetingStep(prevMeetingIso)}` : "Previous meeting"} disabled={!prevMeetingIso} onClick={() => onStepMeeting(prevMeetingIso)} />
        </>)}
        {/* B844 — meeting-calendar flyout: the parent label reads the row's current state; the
            flyout is one radio list (— none — + bodies) plus the deadline-row actions.
            NEW-1 (B1824576) — a schedule with zero bodies of its own but bodies available on
            OTHER schedules still opens the flyout (not the flat "Add a meeting calendar…" row),
            so "From other schedules" is reachable; a schedule with neither keeps the old flat row. */}
        <div style={{position:"relative"}} onMouseEnter={()=>setSubMeet(true)} onMouseLeave={()=>setSubMeet(false)}>
          {meetingBodies.length === 0 && otherBodies.length === 0 && !isDeadlineRow ? (
            <Item icon="ti-calendar-plus" label="Add a meeting calendar…" onClick={onAddMeetingCalendar} />
          ) : isDeadlineRow ? (
            <Item icon="ti-flag" label={`Deadline for: ${deadlineAnchorName || "(missing task)"}`} hint="▸" />
          ) : task.meetingBound ? (
            <Item icon="ti-calendar-event" label={`Meeting: ${curBodyName}${foreignMatch ? ` — from ${foreignMatch.schedName}` : ""}`} hint="▸" />
          ) : (
            <Item icon="ti-calendar-event" label={bindCount > 1 ? `Bind ${bindCount} rows to meeting calendar` : "Bind to meeting calendar"} hint="▸" />
          )}
          {subMeet && (meetingBodies.length > 0 || otherBodies.length > 0 || isDeadlineRow) && (
            <div style={{position:"absolute", top:-4, ...(subOpenLeft ? {right:"100%"} : {left:"100%"}), minWidth:200, maxHeight:320, overflow:"auto",
              background:"var(--bg)", border:"1px solid var(--bd2)", borderRadius:6, boxShadow:"0 8px 24px rgba(0,0,0,0.18)", padding:"3px 0", zIndex:10000}}>
              {isDeadlineRow ? (<>
                <SubCaption>Deadline row for “{deadlineAnchorName || "missing task"}”</SubCaption>
                <Item icon="ti-flag-off" label="Unlink (keep current date)" onClick={onUnlinkDeadline} />
              </>) : (<>
                <SubCaption>{bindCount > 1 ? `Snap ${bindCount} rows to` : "Snap this row to"}</SubCaption>
                <Item icon={!task.meetingBound ? "ti-check" : "ti-circle"} label="— none —" onClick={onUnbindMeeting} />
                {meetingBodies.map(b => {
                  const isCur = task.meetingBound && task.meetingBodyId === b.id;
                  return <Item key={b.id} icon={isCur ? "ti-check" : "ti-circle"} label={b.name || "Meeting body"} onClick={()=>onBindMeeting(b.id)} />;
                })}
                {otherBodies.length > 0 && (<>
                  <Sep />
                  <SubCaption>From other schedules</SubCaption>
                  {otherBodies.map(ob => {
                    // NEW-1 — the row currently bound to a FOREIGN body (foreignMatch) is checked here,
                    // same as a local body is checked in the list above, and its label makes the click's
                    // effect explicit: it copies that calendar's cadence into THIS schedule (B1824576's
                    // import path) and rebinds to the copy — the binding itself is untouched until he does.
                    const isCur = task.meetingBound && !localBody && task.meetingBodyId === ob.body.id;
                    return (
                      <Item key={`${ob.pid}:${ob.body.id}`} icon={isCur ? "ti-check" : "ti-calendar-event"}
                        label={`${ob.body.name || "Meeting body"} · ${ob.schedName}${isCur ? " — copy into this schedule" : ""}`}
                        onClick={()=>onImportBindMeeting(ob.pid, ob.body.id)} />
                    );
                  })}
                </>)}
                {bindCount === 1 && task.meetingBound && !task.hasChildren && (<>
                  <Sep />
                  <Item icon="ti-flag" label="+ Add deadline row (call/file-by date)" onClick={onAddDeadlineRow} />
                </>)}
                {bindCount === 1 && !task.meetingBound && !task.hasChildren && boundTasks.length > 0 && (<>
                  <Sep />
                  <SubCaption>Use as deadline row for</SubCaption>
                  {boundTasks.slice(0, 8).map(bt => <Item key={bt.id} icon="ti-flag" label={bt.name} onClick={()=>onLinkAsDeadline(bt.id)} />)}
                </>)}
              </>)}
              <Sep />
              <Item icon="ti-settings" label="Manage meeting calendars…" onClick={onAddMeetingCalendar} />
            </div>
          )}
        </div>
        <Sep />
        {/* B2671196 ×2 — the ONLY way to give a task its first icon (the hover "add" glyph and the empty slot are gone). Every row, phase or leaf. */}
        <Item icon="ti-icons"             label={hasIcons ? "Change icon…" : "Set icon…"} onClick={onSetIcon} />
        {hasIcons && <Item icon="ti-icons-off" label="Remove icon" onClick={onRemoveIcon} />}
        <Sep />
        <Item icon="ti-copy"              label="Duplicate Row"                 onClick={onDuplicate} />
        <Item icon="ti-scissors"          label="Cut"               hint="Ctrl+X" onClick={onCutTask} />
        <Item icon="ti-files"             label="Copy"              hint="Ctrl+C" onClick={onCopyTaskFull} />
        <Item icon="ti-clipboard"         label="Paste Below"       hint="Ctrl+V" onClick={onPasteTask} disabled={!hasClipboard} />
        <Sep />
        <Item icon="ti-indent-increase"   label="Indent →"          hint="Alt⇧→" onClick={onIndent} />
        <Item icon="ti-indent-decrease"   label="Outdent ←"         hint="Alt⇧←" onClick={onOutdent} disabled={!canOutdent} />
        <Item icon="ti-folder-symlink"    label="Move to…"                      onClick={onMoveTo} />
        <Sep />
        <Item icon="ti-trash"             label={deleteCount > 1 ? `Delete ${deleteCount} Rows` : "Delete Row"} danger onClick={onDelete} />
      </div>
    </>,
    document.body
  );
}

// ── HealthColHeader ───────────────────────────────────────
const HEALTH_COL_STYLES = [
  { k: "stoplight",   label: "Stoplight" },
  { k: "progressbar", label: "Progress bar" },
  { k: "signal",      label: "Signal bars" },
  { k: "flag",        label: "Flag icon" },
  { k: "text",        label: "\"Status\" text" },
  { k: "heartrate",   label: "Heart rate icon" },
];

function HealthColHeaderIcon({style: s, size=14}) {
  if (s === "stoplight") return (
    <span style={{display:"flex",gap:2,alignItems:"center"}}>
      <span style={{width:size*0.55,height:size*0.55,borderRadius:"50%",background:"#dc2626",flexShrink:0}} />
      <span style={{width:size*0.55,height:size*0.55,borderRadius:"50%",background:"#c47b00",flexShrink:0}} />
      <span style={{width:size*0.55,height:size*0.55,borderRadius:"50%",background:"#16a34a",flexShrink:0}} />
    </span>
  );
  if (s === "progressbar") return (
    <span style={{width:size*1.6,height:size*0.45,background:"#e2e8f0",borderRadius:3,overflow:"hidden",display:"inline-block",flexShrink:0}}>
      <span style={{display:"block",width:"55%",height:"100%",background:"#4f46e5",borderRadius:3}} />
    </span>
  );
  if (s === "signal") return (
    <span style={{display:"flex",alignItems:"flex-end",gap:1.5,height:size}}>
      {[0.36,0.55,0.78,1].map((h,i) => (
        <span key={i} style={{width:size*0.28,height:size*h,background:i<2?"#cbd5e1":"#4f46e5",borderRadius:1,flexShrink:0}} />
      ))}
    </span>
  );
  if (s === "flag") return <i className="ti ti-flag" aria-hidden="true" style={{fontSize:size,color:"var(--mut)",lineHeight:1}} />;
  if (s === "text") return <span style={{fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase",lineHeight:1}}>Status</span>;
  if (s === "heartrate") return <i className="ti ti-heart-rate-monitor" aria-hidden="true" style={{fontSize:size,color:"var(--mut)",lineHeight:1}} />;
  return null;
}

function HealthColHeader({current, onChange}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const anchorRef = useRef(null);
  // NEW-1 — a header cell scrolls sideways with the columns; the menu follows it (or closes when it leaves).
  const pos = useAnchoredPopover(open, anchorRef, r => ({top: r.bottom + 4, left: r.left}), () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const down = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const handleClick = e => {
    e.stopPropagation();
    setOpen(o => !o);
  };

  return (
    <>
      <span ref={anchorRef} onClick={handleClick} title="Change header style"
        style={{display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",
          width:"100%",height:"100%",borderRadius:3,
          outline:open?"1.5px solid var(--bd2)":"1.5px solid transparent",transition:"outline-color .1s"}}
        onMouseEnter={e=>e.currentTarget.style.outline="1.5px solid var(--bd2)"}
        onMouseLeave={e=>e.currentTarget.style.outline=open?"1.5px solid var(--bd2)":"1.5px solid transparent"}>
        <HealthColHeaderIcon style={current} size={13} />
      </span>
      {open && pos && ReactDOM.createPortal(
        <div ref={ref} style={{position:"fixed",top:pos.top,left:pos.left,background:"var(--bg)",
          border:"1px solid var(--bd2)",borderRadius:8,padding:8,zIndex:9999,
          boxShadow:"0 4px 20px rgba(0,0,0,0.14)",display:"flex",flexDirection:"column",gap:2,minWidth:160}}>
          <div style={{fontSize:9,fontWeight:600,color:"var(--mut)",letterSpacing:".07em",textTransform:"uppercase",padding:"0 4px 4px",borderBottom:"1px solid var(--bd)"}}>Column header style</div>
          {HEALTH_COL_STYLES.map(opt => (
            <div key={opt.k} onClick={() => { onChange(opt.k); setOpen(false); }}
              style={{display:"flex",alignItems:"center",gap:10,padding:"5px 6px",borderRadius:4,
                cursor:"pointer",background:current===opt.k?"var(--surf)":"transparent",
                transition:"background .1s"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
              onMouseLeave={e=>e.currentTarget.style.background=current===opt.k?"var(--surf)":"transparent"}>
              <span style={{width:36,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <HealthColHeaderIcon style={opt.k} size={13} />
              </span>
              <span style={{fontSize:11,color:"var(--txt)",fontFamily:"'Inter',system-ui,sans-serif"}}>{opt.label}</span>
              {current===opt.k && <i className="ti ti-check" style={{fontSize:11,color:"var(--amber)",marginLeft:"auto"}} />}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── GridView ──────────────────────────────────────────────
// ── StatusHeaderDropdown ─────────────────────────────────
const STATUS_PALETTE = [
  {dot:"#7c3aed", bar:"#ede9fe", dark:"#5b21b6"},
  {dot:"#0891b2", bar:"#cffafe", dark:"#155e75"},
  {dot:"#ea580c", bar:"#ffedd5", dark:"#9a3412"},
  {dot:"#db2777", bar:"#fce7f3", dark:"#9d174d"},
  {dot:"#4f46e5", bar:"#e0e7ff", dark:"#3730a3"},
];
function StatusHeaderDropdown({data, setData}) {
  const [open,    setOpen]    = useState(false);
  const [adding,  setAdding]  = useState(false);
  const [newLabel,setNewLabel]= useState("");
  const [newColor,setNewColor]= useState(STATUS_PALETTE[0].dot);
  const [editing, setEditing] = useState(null); // {k, label}
  const ref     = useRef(null);
  const menuRef = useRef(null);
  const menuPos = useAnchoredPopover(open, ref, r => ({top: r.bottom + 4, left: r.left}),
    () => { setOpen(false); setAdding(false); setEditing(null); setNewLabel(""); });   // NEW-1

  useEffect(() => {
    if (!open) return;
    const down = e => {
      if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        { setOpen(false); setAdding(false); setEditing(null); setNewLabel(""); }
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const openMenu = e => {
    e.stopPropagation();
    setOpen(o => !o);
  };

  const saveEdit = () => {
    if (!editing || !editing.label.trim()) { setEditing(null); return; }
    const k = editing.k;
    if (BASE_HK.includes(k)) {
      setData(d => ({...d, settings:{...d.settings,
        healthLabelOverrides:{...(d.settings?.healthLabelOverrides||{}), [k]: editing.label.trim()}}}));
    } else {
      setData(d => ({...d, settings:{...d.settings,
        customHealth:(d.settings?.customHealth||[]).map(c => c.k===k ? {...c,label:editing.label.trim()} : c)}}));
    }
    setEditing(null);
  };

  const addOption = () => {
    if (!newLabel.trim()) return;
    const pal = STATUS_PALETTE.find(p => p.dot === newColor) || STATUS_PALETTE[0];
    const ch = {k:"custom_"+Date.now(), label:newLabel.trim(), dot:newColor, bar:pal.bar, dark:pal.dark};
    setData(d => ({...d, settings:{...d.settings, customHealth:[...(d.settings?.customHealth||[]), ch]}}));
    setNewLabel(""); setAdding(false);
  };

  const removeOption = k => {
    setData(d => {
      // Reassign any task still carrying the deleted status back to "Not Started" (gray)
      // BEFORE removing it, so no view dereferences a now-missing HEALTH key and crashes (B1).
      const projects = {};
      Object.entries(d.projects || {}).forEach(([pid, p]) => {
        projects[pid] = {...p, tasks: (p.tasks || []).map(t => t.health === k ? {...t, health: "gray"} : t)};
      });
      return {...d, projects, settings:{...d.settings,
        customHealth:(d.settings?.customHealth||[]).filter(c=>c.k!==k)}};
    });
  };

  const OptionIcon = ({hk}) => {
    const h = HEALTH[hk] || {};
    const isHollow = h.dot === "#ffffff";
    return (
      <span style={{width:8,height:8,borderRadius:2,flexShrink:0,
        background: isHollow ? "#fff" : (h.dot||"#ccc"),
        border: isHollow ? "1.5px solid #d1d5db" : "none"}} />
    );
  };

  return (
    <>
      <span ref={ref} onClick={openMenu}
        style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3,userSelect:"none"}}>
        Status <span style={{fontSize:7,opacity:.7}}>▾</span>
      </span>
      {open && menuPos && ReactDOM.createPortal(
        <div ref={menuRef} onMouseDown={e=>e.stopPropagation()}
          style={{position:"fixed",top:menuPos.top,left:menuPos.left,minWidth:190,
            background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:6,
            padding:"6px",zIndex:9999,boxShadow:"0 4px 16px rgba(0,0,0,0.13)"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".07em",
            textTransform:"uppercase",padding:"2px 4px 6px"}}>Status options</div>

          {HK.map(hk => {
            const h = HEALTH[hk]; if (!h) return null;
            const isCustom = !BASE_HK.includes(hk);
            const isEditingThis = editing?.k === hk;
            return (
              <div key={hk} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 4px",borderRadius:3}}>
                <OptionIcon hk={hk} />
                {isEditingThis ? (
                  <>
                    <input {...NO_AUTOFILL} autoFocus value={editing.label}
                      onChange={e=>setEditing(ev=>({...ev,label:e.target.value}))}
                      onKeyDown={e=>{if(e.key==="Enter")saveEdit();if(e.key==="Escape")setEditing(null);}}
                      style={{flex:1,fontSize:11,padding:"2px 5px",border:"1px solid var(--amber)",
                        borderRadius:3,outline:"none",fontFamily:"'Inter',system-ui,sans-serif",minWidth:0}} />
                    <span onClick={saveEdit} title="Save"
                      style={{cursor:"pointer",color:"var(--amber)",fontSize:12,fontWeight:700,padding:"0 2px"}}>✓</span>
                    <span onClick={()=>setEditing(null)} title="Cancel"
                      style={{cursor:"pointer",color:"#9ca3af",fontSize:12,padding:"0 2px"}}>✕</span>
                  </>
                ) : (
                  <>
                    <span style={{flex:1,fontSize:12,color:"var(--txt)"}}>{h.label}</span>
                    <span onClick={()=>setEditing({k:hk,label:h.label})} title="Rename"
                      style={{cursor:"pointer",color:"#9ca3af",fontSize:11,opacity:.6,padding:"0 2px"}}
                      onMouseEnter={e=>e.currentTarget.style.opacity=1}
                      onMouseLeave={e=>e.currentTarget.style.opacity=.6}>✎</span>
                    {isCustom && <span onClick={()=>removeOption(hk)} title="Remove"
                      style={{cursor:"pointer",color:"#9ca3af",fontSize:13,padding:"0 2px"}}>×</span>}
                  </>
                )}
              </div>
            );
          })}

          <div style={{borderTop:"1px solid var(--bd)",marginTop:4,paddingTop:6}}>
            {adding ? (
              <div style={{display:"flex",flexDirection:"column",gap:6,padding:"0 2px"}}>
                <input {...NO_AUTOFILL} autoFocus value={newLabel} onChange={e=>setNewLabel(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter")addOption();if(e.key==="Escape"){setAdding(false);setNewLabel("");}}}
                  placeholder="Option label…"
                  style={{fontSize:11,padding:"4px 7px",border:"1px solid var(--bd2)",borderRadius:4,
                    outline:"none",fontFamily:"'Inter',system-ui,sans-serif"}} />
                <div style={{display:"flex",gap:5,padding:"0 1px"}}>
                  {STATUS_PALETTE.map(p=>(
                    <span key={p.dot} onClick={()=>setNewColor(p.dot)}
                      style={{width:18,height:18,borderRadius:4,background:p.dot,cursor:"pointer",flexShrink:0,
                        outline:newColor===p.dot?`2px solid ${p.dot}`:"2px solid transparent",outlineOffset:2}} />
                  ))}
                </div>
                <div style={{display:"flex",gap:4}}>
                  <span onClick={addOption}
                    style={{flex:1,textAlign:"center",padding:"4px",borderRadius:4,fontSize:11,fontWeight:600,
                      background:"var(--amber)",color:"#fff",cursor:"pointer",
                      fontFamily:"'Inter',system-ui,sans-serif"}}>Add</span>
                  <span onClick={()=>{setAdding(false);setNewLabel("");}}
                    style={{flex:1,textAlign:"center",padding:"4px",borderRadius:4,fontSize:11,
                      background:"var(--bd2)",color:"var(--txt)",cursor:"pointer",
                      fontFamily:"'Inter',system-ui,sans-serif"}}>Cancel</span>
                </div>
              </div>
            ) : (
              <div onClick={()=>setAdding(true)}
                style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",cursor:"pointer",
                  color:"var(--mut)",fontSize:11,borderRadius:3,fontFamily:"'Inter',system-ui,sans-serif"}}
                onMouseEnter={e=>e.currentTarget.style.background="#f3f4f6"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{fontSize:15,fontWeight:300,lineHeight:1}}>+</span> Add option
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}


// ── NotesColHeader ────────────────────────────────────────
const NOTE_SIZES = [{k:"sm",l:"Small",px:11},{k:"md",l:"Medium",px:13},{k:"lg",l:"Large",px:15}];

function NotesColHeader({data, setData}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // {value:string} — pending text-size change
  const [size, setSize] = useState(() => { try { return localStorage.getItem("planar_noteSize")||"sm"; } catch { return "sm"; } });
  const ref = useRef(null);
  const menuRef = useRef(null);
  const menuPos = useAnchoredPopover(open, ref, r => ({top: r.bottom + 4, left: r.left}), () => { setOpen(false); setConfirm(null); });   // NEW-1

  const hasNotes = data ? Object.values(data.projects||{}).some(p=>(p.tasks||[]).some(t=>(t.notes||[]).length>0)) : false;

  useEffect(() => {
    if (!open) { setConfirm(null); return; }
    const down = e => { if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target)) { setOpen(false); setConfirm(null); } };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const openMenu = e => { e.stopPropagation(); setOpen(o=>!o); };

  const applySize = (value, overrideAll) => {
    setSize(value); try { localStorage.setItem("planar_noteSize", value); } catch {}
    if (setData) {
      setData(d => ({...d, projects: Object.fromEntries(Object.entries(d.projects).map(([pid,proj]) => [pid, {
        ...proj,
        tasks: proj.tasks.map(t => ({...t, notes: (t.notes||[]).map(n => {
          if (overrideAll) return {...n, size: value}; // stamp new size on every note immediately
          return n.size ? n : {...n, size: size}; // freeze at OLD size if not already frozen
        })}))
      }]))}));
    }
    setConfirm(null); setOpen(false);
  };

  const handleSize = value => { if (value===size) { setOpen(false); return; } hasNotes ? setConfirm({value}) : applySize(value, true); };

  const BtnStyle = (primary) => ({border:primary?"none":"1px solid var(--bd2)",borderRadius:4,padding:"6px 10px",fontSize:11,
    cursor:"pointer",textAlign:"left",fontFamily:"inherit",width:"100%",
    background:primary?"var(--amber)":"var(--surf)", color:primary?"#fff":"var(--txt)", fontWeight:primary?500:400});

  return (
    <div ref={ref} style={{display:"flex",alignItems:"center",gap:4,width:"100%"}}>
      <span>Notes</span>
      <button onClick={openMenu}
        style={{background:"transparent",border:"none",cursor:"pointer",padding:"1px 3px",
          borderRadius:3,fontSize:13,lineHeight:1,color:"var(--mut)",letterSpacing:"1px",
          fontFamily:"inherit",marginLeft:"auto",transition:"background .1s"}}
        onMouseEnter={e=>e.currentTarget.style.background="var(--bd)"}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>···</button>
      {open && menuPos && ReactDOM.createPortal(
        <div ref={menuRef} style={{position:"fixed",top:menuPos.top,left:menuPos.left,
          background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:7,
          boxShadow:"0 4px 18px rgba(0,0,0,.13)",zIndex:9999,minWidth:192,padding:"4px 0",overflow:"hidden"}}>
          {confirm ? (
            <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:6}}>
              <div style={{fontSize:11,fontWeight:600,color:"var(--txt)"}}>Change text size?</div>
              <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.5}}>
                Apply the new size to all existing notes, or only to new ones going forward?
              </div>
              <button style={BtnStyle(true)} onClick={()=>applySize(confirm.value, true)}>Override all existing</button>
              <button style={BtnStyle(false)} onClick={()=>applySize(confirm.value, false)}>New notes only</button>
              <button style={{...BtnStyle(false),background:"transparent",border:"none",color:"var(--mut)"}} onClick={()=>setConfirm(null)}>Cancel</button>
            </div>
          ) : <>
            <div style={{padding:"4px 12px 3px",fontSize:9,fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",color:"#9ca3af"}}>Text size</div>
            <div style={{display:"flex",gap:4,padding:"4px 12px 8px"}}>
              {NOTE_SIZES.map(({k,l})=>(
                <div key={k} onClick={()=>handleSize(k)}
                  style={{flex:1,textAlign:"center",padding:"4px 0",cursor:"pointer",borderRadius:4,fontSize:11,
                    fontWeight:size===k?600:400,
                    background:size===k?"var(--amber)":"var(--surf)",
                    color:size===k?"#fff":"var(--mut)",
                    border:`1px solid ${size===k?"var(--amber)":"var(--bd2)"}`}}>
                  {l}
                </div>
              ))}
            </div>
          </>}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Grid column chooser + header context menu (B212) ──────
// Both portal-mount at document root (per the established z-index pattern) so they never
// clip under the table's sticky header or the split divider.
function GridColumnsChooser({cols, visible, hidden, onToggle, onMove, onReset, onClose, onAddFormula, onEditFormula, onDeleteFormula, anchor}) {
  // NEW-1/B1350080 — anchor under the header row's ⋯ button when we have its measured
  // screen position; fall back to the old fixed corner if the button ref isn't ready yet.
  const top   = anchor ? Math.min(anchor.bottom + 6, window.innerHeight - 40) : 46;
  const right = anchor ? Math.max(8, window.innerWidth - anchor.right) : 18;
  return ReactDOM.createPortal(
    <>
      <div onClick={onClose} onContextMenu={e=>{e.preventDefault();onClose();}} style={{position:"fixed",inset:0,zIndex:9998}} />
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top,right,zIndex:9999,width:258,maxHeight:"72vh",overflow:"auto",
        background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:9,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",padding:"10px 8px",
        fontFamily:"'Inter',system-ui,sans-serif"}}>
        <div style={{fontSize:9.5,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",padding:"0 8px 6px"}}>Shown columns</div>
        {visible.map((k,idx)=>{ const c=cols.find(x=>x.k===k); if(!c) return null; const locked=k==="name"; const isF=c.t==="formula";
          return (
          <div key={k} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:5}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{display:"flex",flexDirection:"column",lineHeight:0.62}}>
              <span onClick={()=>onMove(k,-1)} title="Move up"   style={{cursor:idx>0?"pointer":"default",opacity:idx>0?0.65:0.18,fontSize:9}}>▲</span>
              <span onClick={()=>onMove(k,1)}  title="Move down" style={{cursor:idx<visible.length-1?"pointer":"default",opacity:idx<visible.length-1?0.65:0.18,fontSize:9}}>▼</span>
            </span>
            <span style={{flex:1,fontSize:12,color:"var(--txt)",display:"flex",alignItems:"center",gap:5,minWidth:0}}>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{colLabel(c)}</span>
              {isF && <span title="Formula column" style={{flexShrink:0,fontSize:8,fontWeight:700,color:"var(--amber)",border:"1px solid var(--amber)",borderRadius:3,padding:"0 3px",letterSpacing:".04em"}}>fx</span>}
            </span>
            {isF && <span onClick={()=>onEditFormula&&onEditFormula(k)} title="Edit formula" style={{cursor:"pointer",color:"var(--mut)",fontSize:12,lineHeight:1,padding:"0 2px"}}>✎</span>}
            {locked
              ? <span style={{fontSize:9,color:"var(--bd2)"}} title="The Task name column can't be hidden">locked</span>
              : <span onClick={()=>onToggle(k,false)} title="Hide column" style={{cursor:"pointer",color:"var(--mut)",fontSize:14,lineHeight:1,padding:"0 2px"}}>✕</span>}
          </div>);
        })}
        {hidden.length>0 && <div style={{fontSize:9.5,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",padding:"10px 8px 6px",borderTop:"1px solid var(--bd)",marginTop:6}}>Available — click to add</div>}
        {hidden.map(c=>{ const isF=c.t==="formula"; return (
          <div key={c.k} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:5}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span onClick={()=>onToggle(c.k,true)} style={{flex:1,cursor:"pointer",display:"flex",alignItems:"center",gap:6,minWidth:0}}>
              <span style={{color:"#16a34a",fontSize:14,width:14,textAlign:"center",lineHeight:1,flexShrink:0}}>+</span>
              <span style={{fontSize:12,color:"var(--txt)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{colLabel(c)}</span>
              {isF && <span title="Formula column" style={{flexShrink:0,fontSize:8,fontWeight:700,color:"var(--amber)",border:"1px solid var(--amber)",borderRadius:3,padding:"0 3px"}}>fx</span>}
            </span>
            {isF && <span onClick={()=>onEditFormula&&onEditFormula(c.k)} title="Edit formula" style={{cursor:"pointer",color:"var(--mut)",fontSize:12,padding:"0 2px"}}>✎</span>}
            {isF && onDeleteFormula && <span onClick={()=>onDeleteFormula(c.k)} title="Delete formula column" style={{cursor:"pointer",color:"var(--mut)",fontSize:13,padding:"0 2px"}}>🗑</span>}
          </div>
        ); })}
        <div style={{borderTop:"1px solid var(--bd)",marginTop:8,paddingTop:7,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span onClick={()=>onAddFormula&&onAddFormula()} title="Create a column computed from an Excel-style formula"
            style={{fontSize:11,fontWeight:600,color:"var(--amber)",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:13,lineHeight:1}}>+</span> Formula column
          </span>
          <span onClick={onReset} style={{fontSize:10.5,color:"var(--mut)",cursor:"pointer",textDecoration:"underline"}}>Reset</span>
        </div>
      </div>
    </>,
    document.body
  );
}

function GridHeaderMenu({ctx, hidden, onHide, onInsert, onColumns, onClose, isFormula, onAddFormula, onEditFormula, onDeleteFormula}) {
  const [sub,setSub]=React.useState(false);
  const x=Math.min(ctx.x, window.innerWidth-210), y=Math.min(ctx.y, window.innerHeight-210);
  const Row=({label,onClick,disabled,arrow})=>(
    <div onClick={disabled?undefined:onClick} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,padding:"6px 12px",cursor:disabled?"default":"pointer",color:disabled?"var(--bd2)":"var(--txt)",whiteSpace:"nowrap"}}
      onMouseEnter={e=>{if(!disabled)e.currentTarget.style.background="var(--surf)";}} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <span>{label}</span>{arrow&&<span style={{fontSize:10,opacity:.55}}>▸</span>}
    </div>
  );
  return ReactDOM.createPortal(
    <>
      <div onClick={onClose} onContextMenu={e=>{e.preventDefault();onClose();}} style={{position:"fixed",inset:0,zIndex:9998}} />
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:y,left:x,zIndex:9999,minWidth:186,
        background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.18)",padding:"5px 0",
        fontFamily:"'Inter',system-ui,sans-serif",fontSize:12.5}}>
        {isFormula && <>
          <Row label="Edit formula…" onClick={onEditFormula} />
          <Row label="Delete this formula column" onClick={onDeleteFormula} />
          <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
        </>}
        <Row label="Hide this column" disabled={ctx.colKey==="name"} onClick={onHide} />
        <div style={{position:"relative"}} onMouseEnter={()=>setSub(true)} onMouseLeave={()=>setSub(false)}>
          <Row label="Insert column" disabled={!hidden.length} arrow />
          {sub && hidden.length>0 && (
            <div style={{position:"absolute",left:"100%",top:-5,minWidth:172,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.18)",padding:"5px 0",maxHeight:300,overflow:"auto"}}>
              {hidden.map(c=><Row key={c.k} label={colLabel(c)} onClick={()=>onInsert(c.k)} />)}
            </div>
          )}
        </div>
        <Row label="Add formula column…" onClick={onAddFormula} />
        <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
        <Row label="Columns…" onClick={onColumns} />
      </div>
    </>,
    document.body
  );
}

// ── B583 — Formula column editor ──────────────────────────────────────────────
// Inline (portal) editor for a user-defined Formula column: a name field, a formula
// box with autocomplete for [Column] names and FUNCTION() names, and a live preview
// that evaluates against the selected row. No window.prompt — owner rule. Excel is
// the mental model (the formula bar). Save is blocked until the name + formula are valid.
function FormulaColumnEditor({mode, initLabel, initFormula, columnNames, existingLabels, preview, onSave, onDelete, onClose}) {
  const PF = window.PlanyrFormula;
  const [label, setLabel] = useState(initLabel || "");
  const [formula, setFormula] = useState(initFormula || "");
  const [caret, setCaret] = useState((initFormula || "").length);
  const [sugIdx, setSugIdx] = useState(0);
  const taRef = useRef(null);
  const FNS = (PF && PF.FUNCTION_NAMES) || [];
  const FN_HELP = (PF && PF.FUNCTION_HELP) || {};

  // The token under the caret → contextual suggestions.
  const ctxAt = (() => {
    const upto = formula.slice(0, caret);
    const lastOpen = upto.lastIndexOf("[");
    const lastClose = upto.lastIndexOf("]");
    if (lastOpen > lastClose) return { kind: "col", start: lastOpen, frag: upto.slice(lastOpen + 1) };
    const m = /([A-Za-z][A-Za-z0-9_]*)$/.exec(upto);
    if (m) return { kind: "word", start: caret - m[1].length, frag: m[1] };
    return { kind: "none", start: caret, frag: "" };
  })();
  const suggestions = (() => {
    const frag = ctxAt.frag.toLowerCase();
    if (ctxAt.kind === "col") {
      return columnNames.filter(n => n.toLowerCase().includes(frag)).slice(0, 8).map(n => ({ type: "col", name: n }));
    }
    if (ctxAt.kind === "word") {
      const fns = FNS.filter(n => n.toLowerCase().startsWith(frag)).slice(0, 6).map(n => ({ type: "fn", name: n }));
      const cols = columnNames.filter(n => n.toLowerCase().startsWith(frag)).slice(0, 4).map(n => ({ type: "col", name: n }));
      return frag ? [...fns, ...cols] : [];
    }
    return [];
  })();

  const applySuggestion = (sug) => {
    const before = formula.slice(0, ctxAt.start);
    const after = formula.slice(caret);
    let insert, newCaret;
    if (sug.type === "col") {
      insert = "[" + sug.name + "]";
      const trimmedAfter = after.replace(/^\s*\]/, ""); // don't double a trailing ]
      const next = before + insert + trimmedAfter;
      newCaret = (before + insert).length;
      setFormula(next);
    } else {
      insert = sug.name + "(";
      const next = before + insert + after;
      newCaret = (before + insert).length;
      setFormula(next);
    }
    setSugIdx(0);
    setTimeout(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.setSelectionRange(newCaret, newCaret); setCaret(newCaret); } }, 0);
  };

  // Validation
  const trimmedLabel = label.trim();
  const dupLabel = existingLabels.some(l => (l || "").trim().toLowerCase() === trimmedLabel.toLowerCase());
  const isBuiltinName = isBuiltinFormulaName(trimmedLabel);
  // A name containing [ or ] could never be referenced from another formula: a [Column]
  // reference scans to the first ], so a name like "Cost [USD]" would tokenize as the
  // truncated "Cost [USD" plus a stray ] and surface #ERROR! — reject the brackets up front.
  const bracketInName = /[[\]]/.test(trimmedLabel);
  const parsed = PF ? PF.parseFormula(formula) : { error: "engine unavailable" };
  const parseErr = parsed && parsed.error ? parsed.error : null;
  const labelErr = !trimmedLabel ? "Give the column a name" : bracketInName ? "Name can't contain [ or ]" : dupLabel ? "A column with this name already exists" : isBuiltinName ? "That name is reserved for a built-in column" : null;
  const canSave = !labelErr && !parseErr && formula.trim() !== "";
  const prev = (canSave && preview) ? preview(formula) : null;

  const handleKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (canSave) onSave({ label: trimmedLabel, formula: formula.trim() }); return; }
    if (suggestions.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSugIdx(i => Math.min(suggestions.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSugIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applySuggestion(suggestions[Math.min(sugIdx, suggestions.length - 1)]); return; }
    }
  };
  const syncCaret = (e) => setCaret(e.target.selectionStart);

  const box = { fontFamily: "'Inter',system-ui,sans-serif" };
  return ReactDOM.createPortal(
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100000,background:"rgba(15,18,23,0.28)"}} />
      <div onClick={e=>e.stopPropagation()} style={{...box,position:"fixed",top:"14vh",left:"50%",transform:"translateX(-50%)",zIndex:100001,width:480,maxWidth:"94vw",
        background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:12,boxShadow:"0 16px 48px rgba(0,0,0,0.28)",padding:"18px 18px 14px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"var(--txt)",marginBottom:2}}>{mode==="edit"?"Edit formula column":"New formula column"}</div>
        <div style={{fontSize:11.5,color:"var(--mut)",marginBottom:12,lineHeight:1.5}}>
          A formula column computes a value for <b>every task row</b> from that row's other columns — like a calculated column in Excel. Reference a column by name in brackets, e.g. <code style={{background:"var(--surf)",padding:"0 4px",borderRadius:3}}>[Finish] - [Start]</code>.
        </div>

        <label style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--mut)"}}>Column name</label>
        <input {...NO_AUTOFILL} autoFocus value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Days remaining"
          style={{width:"100%",boxSizing:"border-box",margin:"4px 0 2px",padding:"7px 9px",fontSize:13,border:`1px solid ${labelErr?"var(--danger,#d83a3a)":"var(--bd2)"}`,borderRadius:6,fontFamily:"inherit"}} />
        <div style={{fontSize:10.5,color:labelErr?"var(--danger,#d83a3a)":"transparent",minHeight:14}}>{labelErr||"."}</div>

        <label style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--mut)"}}>Formula</label>
        <div style={{position:"relative",margin:"4px 0 2px"}}>
          <textarea ref={taRef} value={formula} rows={2} spellCheck={false}
            onChange={e=>{setFormula(e.target.value);setCaret(e.target.selectionStart);setSugIdx(0);}}
            onKeyDown={handleKey} onKeyUp={syncCaret} onClick={syncCaret}
            placeholder='IF([% Complete] >= 100, "Done", NETWORKDAYS([Start], [Finish]) & " days")'
            style={{width:"100%",boxSizing:"border-box",padding:"8px 9px",fontSize:12.5,lineHeight:1.45,
              border:`1px solid ${parseErr?"var(--danger,#d83a3a)":"var(--bd2)"}`,borderRadius:6,
              fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",resize:"vertical"}} />
          {suggestions.length>0 && (
            <div style={{position:"absolute",top:"100%",left:0,marginTop:2,zIndex:5,minWidth:240,maxWidth:"100%",
              background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:7,boxShadow:"0 8px 24px rgba(0,0,0,0.16)",overflow:"hidden"}}>
              {suggestions.map((sg,i)=>(
                <div key={sg.type+sg.name} onMouseDown={e=>{e.preventDefault();applySuggestion(sg);}} onMouseEnter={()=>setSugIdx(i)}
                  style={{padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,background:i===sugIdx?"#fff6e9":"transparent"}}>
                  <span style={{fontSize:8,fontWeight:700,color:sg.type==="fn"?"var(--amber)":"#0e7490",border:`1px solid ${sg.type==="fn"?"var(--amber)":"#0e7490"}`,borderRadius:3,padding:"0 3px"}}>{sg.type==="fn"?"fx":"col"}</span>
                  <span style={{fontSize:12,color:"var(--txt)",fontFamily:"ui-monospace,monospace"}}>{sg.type==="fn"?sg.name+"()":"["+sg.name+"]"}</span>
                  {sg.type==="fn" && FN_HELP[sg.name] && <span style={{fontSize:10.5,color:"var(--mut)",marginLeft:"auto",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{FN_HELP[sg.name]}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{minHeight:18,fontSize:11.5,margin:"2px 0 8px"}}>
          {parseErr
            ? <span style={{color:"var(--danger,#d83a3a)",fontWeight:600}}>Can't read this formula: {parseErr}{parsed.detail?` — ${parsed.detail}`:""}</span>
            : prev
              ? (prev.ok
                  ? <span style={{color:"var(--mut)"}}>Preview {prev.sampleName?`(${prev.sampleName})`:""}: <b style={{color:"var(--txt)"}}>{prev.display===""?"(empty)":prev.display}</b></span>
                  : <span style={{color:"var(--danger,#d83a3a)",fontWeight:600}}>Preview: {prev.error}{prev.detail?` — ${prev.detail}`:""}</span>)
              : <span style={{color:"var(--mut)"}}>Type a formula to see a live preview.</span>}
        </div>

        <details style={{marginBottom:10}}>
          <summary style={{fontSize:11,color:"var(--mut)",cursor:"pointer"}}>Columns &amp; functions you can use</summary>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
            {columnNames.map(n=>(
              <span key={n} onClick={()=>applySuggestion({type:"col",name:n})} title="Insert"
                style={{fontSize:10.5,padding:"2px 6px",borderRadius:10,background:"#f1f5f9",color:"#0e7490",cursor:"pointer",fontFamily:"ui-monospace,monospace"}}>[{n}]</span>
            ))}
          </div>
          <div style={{fontSize:10.5,color:"var(--mut)",marginTop:7,lineHeight:1.5}}>
            <b>Functions:</b> {FNS.join(", ")}
          </div>
          <div style={{fontSize:10.5,color:"var(--mut)",marginTop:5,lineHeight:1.5}}>
            Dates use the project working-day calendar (WORKDAY/NETWORKDAYS skip weekends + holidays). % Complete is 0–100; Duration is in working days.
          </div>
        </details>

        <div style={{display:"flex",alignItems:"center",gap:8,borderTop:"1px solid var(--bd)",paddingTop:11}}>
          {onDelete && <button onClick={onDelete} style={{border:"1px solid var(--bd2)",background:"var(--bg)",color:"var(--danger,#d83a3a)",borderRadius:6,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>}
          <span style={{flex:1}} />
          <button onClick={onClose} style={{border:"1px solid var(--bd2)",background:"var(--bg)",color:"var(--txt)",borderRadius:6,padding:"7px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          <button onClick={()=>canSave&&onSave({label:trimmedLabel,formula:formula.trim()})} disabled={!canSave}
            style={{border:"none",background:canSave?"var(--amber)":"var(--bd2)",color:"#fff",borderRadius:6,padding:"7px 16px",fontSize:12,fontWeight:600,cursor:canSave?"pointer":"default",fontFamily:"inherit"}}>
            {mode==="edit"?"Save":"Add column"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

function GridView({tasks, succMap, updateTask, deleteTask, getTaskName, proj, setData, setNotesCtx, edit, setEdit, editStartChar, selectedId, setSelectedId, selRange, setSelRange, selectedColIdx, setSelectedColIdx, goToFocus, setGoToFocus, scrollRef, onScroll, setTaskCtx, insertTask, insertTaskBelow, addTask, addSubtask, duplicateTask, rolledHealthMap, healthColStyle, setHealthColStyle, data, gridZoom=1, setHoverZone, onColWidths, review, moveRows}) {
  // Predecessor lookup for the "a predecessor is late" health condition — memoized on the
  // project's own task array so it's built once per data change, not once per row.
  const taskById = useMemo(() => { const m = {}; (proj?.tasks||[]).forEach(t => m[t.id] = t); return m; }, [proj?.tasks]);
  const [winTop, setWinTop] = useState(0);      // NEW-1 — first row of the CHUNK the scroll is in (not the raw scrollTop)
  const localRef = useRef(null);
  const ref = scrollRef || localRef;
  const vh = (ref.current?.clientHeight || window.innerHeight) - 80;
  const emptyPad = Math.max(100, Math.ceil(vh / ROW_H) + 40);
  const totalRows = tasks.length + emptyPad;
  const { startIdx, endIdx } = rowWindow(winTop, (ref.current?.clientHeight || window.innerHeight), totalRows);

  const isDraggingCells = useRef(false);
  const cellDragPin = useRef(null);   // release fn of the `cell` cursor pin while a range-select drag spans 2+ cells
  const _healthClickSel = useRef(null); // captures selRange at health/status mousedown before collapse
  const colBtnRef       = useRef(null); // NEW-1/B1350080 — header-row Columns (⋯) button, anchors the chooser panel

  // ── NEW-ROWMOVE — drag-and-drop row reorder ────────────────────────────────────────────────
  // Deliberately NO React state at all during the move: everything the drag needs (which rows,
  // where the cursor is, what's currently highlighted) lives on rowDragRef, and the live
  // insertion-line/highlight paint is done by writing DOM styles directly through refs on an
  // internal requestAnimationFrame loop. So a drag across the owner's 529-row schedule causes
  // ZERO re-renders of the row list for however long the gesture lasts — moveRows (passed down
  // from App, see `shared`) is called EXACTLY ONCE, on drop, which is the one setData/undo-step/
  // recompute (and the one render) the whole gesture produces.
  const rowDragRef  = useRef(null); // {ids, blocked, overIdx, overPos, overTaskId, lastClientY, rafId} while ARMED (past the drag threshold)
  const rowDragCancelRef = useRef(null); // tears down the press/drag in flight — a release that was never seen must not outlive the next press
  useEffect(() => () => { rowDragCancelRef.current?.(); }, []);
  const dragLineRef = useRef(null);   // insertion-line indicator DOM node
  const dragNestRef = useRef(null);   // NEW-ROWNEST — nest-under / blocked-target box DOM node

  // Ids the drag should move: the WHOLE active row-selection range when the grabbed row is part of
  // one, else just the grabbed row — the exact same rule App's structuralTargets applies to
  // indent/outdent/cut/copy, reimplemented locally off the props GridView already has (selRange,
  // tasks — the same flat array App's own rowRangeSelIds reads via flatTasksRef) so the drag can
  // resolve its target set at mousedown without waiting on a round-trip through App.
  const dragTargetIds = (anchorId) => {
    if (!selRange) return [anchorId];
    const r1 = Math.max(0, Math.min(selRange.r1, selRange.r2));
    const r2 = Math.min(tasks.length - 1, Math.max(selRange.r1, selRange.r2));
    if (r2 <= r1) return [anchorId];
    const ids = tasks.slice(r1, r2 + 1).map(t => t.id);
    return ids.includes(anchorId) ? ids : [anchorId];
  };

  // NEW-1 (2026-10-28) — A PRESS IS A CLICK UNTIL THE POINTER HAS REALLY TRAVELLED. The drag used to arm on
  // mousedown: rows dimmed, the page cursor pinned to "grabbing", the drop target painted, and the per-frame
  // loop below auto-scrolling the grid whenever the pointer sat near its top/bottom edge — all with a motionless
  // mouse. A plain click near the edge therefore slid other rows under the stationary pointer, and because a
  // grip press has no click path, its release committed the drop wherever the rows had slid to ("I've barely
  // moved or maybe not even moved by the time I've clicked, and it still moves it"). Now the press only RECORDS
  // where it started; nothing is painted, pinned, scrolled or committed until the held pointer has travelled
  // past rowDragThreshold (mouse < pen < touch). A release before that is a click (opts.onClick, if any); a
  // release back within the threshold of the press point writes nothing; a context menu, focus loss, Escape or a
  // button released out of sight cancels instead of leaving a half-armed drag to be dropped by the next click.
  const startRowDrag = (e, anchorTaskId, opts = null) => {
    if (review || e.button !== 0) return;
    const onClick = opts && opts.onClick;   // a press that never travels (an ID-cell press inside the selection, a grip click) is a click
    if (rowDragCancelRef.current) rowDragCancelRef.current();
    const ids = dragTargetIds(anchorTaskId);
    // Full blocked set (dragged rows + every descendant, from the FULL project tree so a
    // COLLAPSED descendant still blocks a drop into its own ancestor being dragged).
    const allTasks = proj?.tasks || [];
    const blocked = new Set(ids);
    let grew = true;
    while (grew) { grew = false; allTasks.forEach(t => { if (t.parentId != null && blocked.has(t.parentId) && !blocked.has(t.id)) { blocked.add(t.id); grew = true; } }); }

    const startX = e.clientX, startY = e.clientY;
    const state = { ids, blocked, lastClientX: startX, lastClientY: startY, rafId: null, overGapIndex: null, intent: null, moved: false };
    const pointerType = lastRowPointerType;
    let releaseCursor = null, finished = false;
    const el0 = ref.current;
    // Cached ONCE (not per animation frame) — the x-offset where the Task Name column's own text
    // starts, so the insertion-line indicator can be drawn at that same x. Uniform across every
    // row (fixed column widths), so any currently-rendered row's cell answers for all of them.
    const nameCellEl = el0 ? el0.querySelector('[data-col-key="name"]') : null;
    const nameIndentBase = nameCellEl ? nameCellEl.offsetLeft : 0;
    const nameCellW = nameCellEl ? nameCellEl.offsetWidth : 0;

    // The drop decision itself (gap vs nest vs blocked, and the depth rule) is the module-level
    // rowDropIntent / resolveDropParent above — pure, so the unit tests exercise the real code. This
    // closure only paints it and, on release, commits it.
    const intentAt = () => {
      const el = ref.current;
      if (!el || !tasks.length) return { kind: "none" };
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetHeight ? rect.height / el.offsetHeight : (gridZoom || 1);
      return rowDropIntent(tasks, state.blocked, rowFloatAtPointer(state.lastClientY, rect.top, el.scrollTop, zoom, TL_H, ROW_H));
    };

    const computeAndPaint = () => {
      const el = ref.current;
      if (!el || !tasks.length) return;
      const rect = el.getBoundingClientRect();
      const intent = intentAt();
      state.intent = intent;
      state.overGapIndex = intent.kind === "gap" ? intent.gapIndex : null;
      const paintTop = intent.kind === "gap" ? intent.gapIndex * ROW_H : null;
      const level = intent.kind === "gap" ? intent.level : 0;

      if (dragLineRef.current) {
        dragLineRef.current.style.display = paintTop != null ? "block" : "none";
        if (paintTop != null) {
          dragLineRef.current.style.top = `${paintTop - 1.5}px`;
          // The line starts at the SAME x the dropped row's own name text would start at — so
          // the picture and the depth rule always agree: flush with a sibling's indent reads as
          // "beside", indented one step further reads as "inside". Matches Cell's own
          // `paddingLeft:4+task.level*14` for the name column exactly (name cell's real DOM
          // offset + that formula), so it's pixel-true, not an approximation.
          dragLineRef.current.style.left = `${nameIndentBase + 4 + level * 14}px`;
        }
      }

      // NEW-ROWNEST — the nest-under / blocked target: a box around the WHOLE hovered row (a line
      // between rows can never read as "inside this row"), blue for a legal nest, red dashed for a row
      // that is being dragged or sits inside one. Imperative like the line — no React state.
      const nb = dragNestRef.current;
      if (nb) {
        const showBox = intent.kind === "into" || (intent.kind === "blocked" && state.moved);
        nb.style.display = showBox ? "block" : "none";
        if (showBox) {
          const bad = intent.kind === "blocked";
          nb.style.top = `${intent.index * ROW_H}px`;
          nb.style.height = `${ROW_H}px`;
          nb.style.border = bad ? "2px dashed #dc2626" : "2px solid var(--blue)";
          nb.style.background = bad ? "rgba(220,38,38,0.10)" : "rgba(37,99,235,0.14)";
          nb.setAttribute("data-drag-nest-kind", bad ? "blocked" : "into");
          const chip = nb.firstChild;
          if (chip) {
            chip.textContent = bad ? "Not allowed" : "Nest inside";
            chip.style.background = bad ? "#dc2626" : "var(--blue)";
            chip.style.left = `${Math.max(0, nameIndentBase + nameCellW - 86)}px`;
          }
        }
      }

      // Auto-scroll near the top/bottom edge of the viewport — continuous while the cursor sits
      // in the edge band, not just on mousemove, so holding still near the edge keeps scrolling.
      const EDGE = 36, MAX_SPEED = 14;
      const y = state.lastClientY - rect.top;
      let dy = 0;
      if (y < EDGE) dy = -MAX_SPEED * (1 - Math.max(0, y) / EDGE);
      else if (y > rect.height - EDGE) dy = MAX_SPEED * (1 - Math.max(0, rect.height - y) / EDGE);
      if (dy) el.scrollTop = Math.max(0, el.scrollTop + dy);
    };

    const tick = () => {
      if (!rowDragRef.current) return; // drag ended
      computeAndPaint();
      state.rafId = requestAnimationFrame(tick);
    };

    // ARM — the held pointer has travelled past the threshold: only now does anything pick up, paint, pin or scroll.
    const arm = () => {
      // B2530690 — a drag of rows needs ONE contiguous block; with several ranges selected it says so (out loud)
      // instead of moving part of the selection. A press that never travels is still a click (handled above).
      if (isMulti(selRange)) { showToast(MULTI_SELECTION_MESSAGE, { type: "warn" }); cancel(); return; }
      state.moved = true;
      rowDragRef.current = state;
      // The cursor stays the grab hand for the WHOLE drag (pinned at the root: every cell, header and Gantt row paints its own
      // inline cursor, which a body-level cursor loses to). Escape / blur / pointercancel CANCEL the drop (no move).
      releaseCursor = window.pinSchedCursor("grabbing", { onExit: () => cancel() });
      document.body.style.userSelect = "none";
      // Mark the dragged row(s) as IN-FLIGHT, once — dimmed with a dashed outline (reads as "lifted out"; the row's slot
      // can't vacate without reflowing every row below it, the per-mousemove re-render this design forbids). Only
      // currently-rendered (virtualized) rows are found; cosmetic cue, not the source of truth for what moves.
      if (el0) ids.forEach(id => { const r = el0.querySelector(`[data-task-row="${id}"]`); if (r) { r.style.opacity = "0.45"; r.style.outline = "1.5px dashed var(--blue)"; r.style.outlineOffset = "-1.5px"; } });
      computeAndPaint(); // paint at the pointer's current position before the first frame
      state.rafId = requestAnimationFrame(tick);
    };
    // Everything the gesture installed comes off here — pressed-and-never-armed, armed, committed or cancelled alike.
    const teardown = () => {
      if (finished) return false;
      finished = true;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("contextmenu", cancel, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", cancel);
      if (rowDragCancelRef.current === cancel) rowDragCancelRef.current = null;
      if (state.rafId != null) cancelAnimationFrame(state.rafId);
      if (releaseCursor) releaseCursor();
      if (state.moved) {
        document.body.style.userSelect = "";
        if (dragLineRef.current) dragLineRef.current.style.display = "none";
        if (dragNestRef.current) dragNestRef.current.style.display = "none";
        // Clear the dim + in-flight outline. A SUCCESSFUL move re-renders every row from scratch (fresh inline styles)
        // anyway; this matters for the no-op/cancelled-drop case, where no setData fires and these exact DOM nodes
        // would otherwise stay dimmed/outlined forever.
        const elEnd = ref.current;
        if (elEnd) ids.forEach(id => { const r = elEnd.querySelector(`[data-task-row="${id}"]`); if (r) { r.style.opacity = ""; r.style.outline = ""; r.style.outlineOffset = ""; } });
      }
      rowDragRef.current = null;
      return true;
    };
    // Abandon the press/drag with NO click and NO drop.
    function cancel() { teardown(); }
    function onKey(ev) { if (ev.key === "Escape") cancel(); }
    function onMove(ev) {
      if (ev.buttons === 0) { cancel(); return; }   // the button came up where we could not see it (context menu, another window)
      state.lastClientX = ev.clientX; state.lastClientY = ev.clientY;
      if (!state.moved && rowDragArmed(pointerType, ev.clientX - startX, ev.clientY - startY)) arm();
    }
    function onUp(ev) {
      if (finished) return;
      if (ev && typeof ev.clientX === "number") { state.lastClientX = ev.clientX; state.lastClientY = ev.clientY; }
      const wasArmed = state.moved;
      // Read the drop where the pointer ACTUALLY is at release (the last frame's paint can be a frame stale).
      const intent = wasArmed ? intentAt() : null;
      teardown();
      // A press that never travelled is a click, not a drag (an ID-cell press inside the selection; a grip click).
      if (!wasArmed) { if (onClick) onClick(); return; }
      // Armed, but let go back at the press point: nothing was asked for, so nothing is written (no reorder, no
      // parent/date change, no undo entry, no sync).
      if (!rowDragArmed(pointerType, state.lastClientX - startX, state.lastClientY - startY)) return;
      if (intent && intent.kind === "gap" && moveRows) {
        moveRows(anchorTaskId, intent.destParentId, intent.insertAfterId);
      } else if (intent && intent.kind === "into" && moveRows) {
        // NEW-ROWNEST — nest under the hovered row. A row with no children becomes a SUMMARY row:
        // its own start/finish/duration are replaced by the roll-up of what was just put under it
        // (the same thing indent does). Say so — never a silent change; Ctrl+Z restores the lot.
        const target = allTasks.find(t => t.id === intent.targetId);
        const wasLeaf = target && !allTasks.some(t => t.parentId === target.id);
        moveRows(anchorTaskId, intent.destParentId, intent.insertAfterId);
        if (wasLeaf && target) showToast(`"${target.name || "Untitled"}" is now a summary row — its dates and duration roll up from the rows under it. Ctrl+Z undoes the move.`, { type: "success", duration: 5000 });
      } else if (intent && intent.kind === "blocked") {
        showToast("A row can't be moved into itself or its own sub-rows.", { type: "error", duration: 3500 });
      }
    }
    rowDragCancelRef.current = cancel;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("contextmenu", cancel, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", cancel);
  };

  useEffect(() => {
    const up = () => { isDraggingCells.current = false; if (cellDragPin.current) { cellDragPin.current(); cellDragPin.current = null; } };
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  // NEW-3 — keyboard navigation hands the highlight to the keyboard. While a nav key is the last thing that
  // happened, the grid carries data-kbnav (CSS then drops the row-HOVER outline); only a REAL pointer move — its
  // coordinates differ from where the pointer sat when the key went down — gives hover back. A scroll or a
  // re-render under a parked pointer can synthesize a pointermove at the SAME coordinates, which is ignored, so a
  // row sliding under a still mouse never re-lights. Imperative on purpose: a re-render per keystroke is not free.
  useEffect(() => {
    const NAV = new Set(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Tab","PageUp","PageDown","Home","End","Enter"]);
    const ptr = { x: null, y: null }, at = { x: null, y: null };
    const onKey = e => { if (!NAV.has(e.key)) return; const el = ref.current; if (!el) return;
      at.x = ptr.x; at.y = ptr.y; el.setAttribute("data-kbnav", "1"); };
    const onMove = e => { ptr.x = e.clientX; ptr.y = e.clientY;
      const el = ref.current; if (!el || !el.hasAttribute("data-kbnav")) return;
      if (e.clientX !== at.x || e.clientY !== at.y) el.removeAttribute("data-kbnav"); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointermove", onMove, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointermove", onMove, true); };
  }, []);

  // Is cell (ri, ci) inside ANY selected range? (B2530690 — the selection is a list of ranges now; the shared
  // model in the RANGE-SELECTION block is the one place that answers it.)
  const inRange = (ri, ci) => selContains(selRange, ri, ci);
  // Box-shadow string for selection outline on edge cells
  const selShadow = (ri, ci, selected, active) => {
    if (active) return "inset 0 0 0 2px var(--blue)";
    if (!selected || !selRange) return "none";
    const ed = selEdgesAt(selRange, ri, ci);
    const s=[];
    if(ed.top) s.push("inset 0 2px 0 0 #2563eb");
    if(ed.bottom) s.push("inset 0 -2px 0 0 #2563eb");
    // (B2160464) no inner 1px row separator here any more: every cell now draws its OWN bottom line
    // (GRID_LINE_RANGE inside a range), so an inset one would stack a second blue line beside it.
    if(ed.left) s.push("inset 2px 0 0 0 #2563eb");
    // when the range reaches the LAST visible column, the right edge belongs to the row's filler strip (its far end)
    if(ed.right && !(stripJoinsRange && ci===stripCi)) s.push("inset -2px 0 0 0 #2563eb");
    return s.join(",");
  };
  // The ONE press / drag-enter / right-click behaviour of a body cell. The row's right-edge FILLER strip
  // (NEW-1) calls these same three with the row's last visible column, so a press in the leftover width
  // selects the row exactly as a press on that row's own last cell does (shift-extend and drag included).
  // B2530690 — ONE drag session for every gesture that extends a cell / row range (a cell press, a Ctrl+press that
  // adds a range, an ID-column press). It mirrors the Spreadsheet's beginRangeDrag (B2452528): window listeners
  // + a rAF loop, the row under the pointer found by COORDINATES (so a row that is not rendered yet is still
  // reachable) and the grid scrolling while the pointer sits at/past an edge — even held perfectly still. The
  // speed ramp is the shared edgeScroll.axisVelocity. Nothing extends or scrolls until the pointer has really
  // travelled (a press near the edge is a click, not a drag — the lesson of NEW-1's row drag). `apply(ri, ci)`
  // gets the cell the selection should reach; `onEnd(reason, moved)` is "up" | "cancel".
  const cellSessionRef = useRef(null);
  const skipColClickRef = useRef(false);   // a Ctrl+click that TOOK a cell out of the selection: the click that follows must not re-aim the active column at it
  const liveGridRef = useRef({ tasks, allCols: [], gridZoom, stripCi: -1 });   // refreshed every render, right after stripCi is known (below). ⛔ never name a const declared LATER in this component here: the compiled production build keeps const block-scoping (TDZ) where the in-browser Babel page used in dev does not
  const beginCellDrag = (startEvent, { rowMode, apply, onEnd }) => {
    cellSessionRef.current?.stop("cancel");
    const el = ref.current;
    if (!el) return;
    const pointer = { x: startEvent.clientX, y: startEvent.clientY };
    const start = { x: startEvent.clientX, y: startEvent.clientY };
    let raf = 0, lastT = 0, lastKey = "", moved = false, lastCi = null;
    isDraggingCells.current = true;
    const reach = () => {
      const g = liveGridRef.current;
      if (!g.tasks.length) return;
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetHeight ? rect.height / el.offsetHeight : (g.gridZoom || 1);
      const rf = Math.floor(rowFloatAtPointer(pointer.y, rect.top, el.scrollTop, zoom, TL_H, ROW_H));
      const r = Math.max(0, Math.min(g.tasks.length - 1, rf));
      let c = rowMode ? 0 : lastCi;
      if (!rowMode) {
        // The column under the pointer, found on the element actually painted there (so a pinned column that
        // covers a scrolled one answers as itself); a pointer outside the grid is clamped to its nearest cell.
        const x = Math.max(rect.left + 2, Math.min(rect.right - 3, pointer.x));
        const y = Math.max(rect.top + (TL_H + 2) * zoom, Math.min(rect.bottom - 3, pointer.y));
        const hit = document.elementFromPoint(x, y);
        const cell = hit && hit.closest ? hit.closest("[data-task-row] [data-col-key]") : null;
        if (cell) { const k = cell.getAttribute("data-col-key"); const i = g.allCols.findIndex(col => col.k === k); if (i >= 0) c = i; }
        else if (hit && hit.closest && hit.closest("[data-grid-strip]") && g.stripCi >= 0) c = g.stripCi;
        if (c == null) return;
        lastCi = c;
      }
      const key = r + ":" + c;
      if (key !== lastKey) { lastKey = key; apply(r, c); }
    };
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (!moved) return;
      const dt = lastT ? Math.min(64, now - lastT) : 16;
      lastT = now;
      const g = liveGridRef.current;
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetHeight ? rect.height / el.offsetHeight : (g.gridZoom || 1);
      const vy = axisVelocity(pointer.y - rect.top, TL_H * zoom, rect.height);
      if (vy) el.scrollTop += (vy * dt) / 1000;
      if (!rowMode) {
        const pin = pinRef.current || { lw: 0, rw: 0 };
        const vx = axisVelocity(pointer.x - rect.left, pin.lw * zoom, rect.width - pin.rw * zoom);
        if (vx) el.scrollLeft += (vx * dt) / 1000;
      }
      reach();   // re-target every frame: scrolling moves which cell sits under a still pointer
    };
    const onMove = (ev) => {
      if (ev.buttons === 0) { stop("up"); return; }   // a release we never saw
      pointer.x = ev.clientX; pointer.y = ev.clientY;
      if (!moved) {
        if (Math.abs(pointer.x - start.x) + Math.abs(pointer.y - start.y) < 3) return;
        moved = true;
        // A range-select drag that has travelled shows the `cell` cursor until the button is released
        // (pinned, driven by the gesture — never by a ref read at render, which left it stuck after mouseup).
        if (!cellDragPin.current) cellDragPin.current = window.pinSchedCursor("cell", { onExit: () => { isDraggingCells.current = false; cellDragPin.current = null; } });
      }
      reach();
    };
    const onUp = () => stop("up");
    const onCancel = () => stop("cancel");
    const stop = (reason) => {
      if (cellSessionRef.current !== session) return;
      cellSessionRef.current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onCancel);
      isDraggingCells.current = false;
      if (cellDragPin.current) { cellDragPin.current(); cellDragPin.current = null; }
      onEnd?.(reason, moved);
    };
    const session = { stop };
    cellSessionRef.current = session;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onCancel);
    raf = requestAnimationFrame(tick);
  };
  useEffect(() => () => cellSessionRef.current?.stop("cancel"), []);
  // The selection as it stands BEFORE a press: the range list, or — after keyboard navigation cleared it — the
  // one active cell.
  const currentSelection = () => {
    if (selRange) return selRange;
    const ri0 = selectedId != null ? tasks.findIndex(t => t.id === selectedId) : -1;
    return ri0 >= 0 ? { r1: ri0, r2: ri0, c1: selectedColIdx ?? 0, c2: selectedColIdx ?? 0 } : null;
  };
  // The ONE press / right-click behaviour of a body cell. The row's right-edge FILLER strip (NEW-1) calls the same
  // with the row's last visible column, so a press in the leftover width selects the row exactly as a press on that
  // row's own last cell does (shift-extend, Ctrl-add and drag included).
  const cellMouseDown = (e, task, ri, c, ci) => {
    if (e.button !== 0) return;
    skipColClickRef.current = false;
    const additive = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;   // B2530690 — Ctrl/Cmd+press adds a range
    const lastCol = allCols.length - 1;
    // Shift+click — Excel-style: extend selection from anchor (current selectedId/selectedColIdx)
    // to this cell. Anchor stays put so subsequent shift-clicks/shift-arrows continue from it. Only the NEWEST
    // range extends; earlier ranges (Ctrl+click) stay as they are.
    if (e.shiftKey && selectedId !== null) {
      e.preventDefault();
      const anchorRi = tasks.findIndex(t => t.id === selectedId);
      const anchorCi = selectedColIdx ?? 0;
      if (anchorRi >= 0) {
        const cur = selRange || null;
        // ID column shift-click extends to full rows
        if (c.k === "id") {
          setSelRange(withActive(cur, {r1: anchorRi, r2: ri, c1: 0, c2: lastCol}));
        } else {
          setSelRange(withActive(cur, {r1: anchorRi, r2: ri, c1: anchorCi, c2: ci}));
        }
        // Keep focus on the grid container; keyboard nav is handled at the document level.
        setTimeout(()=>ref.current?.focus({preventScroll:true}), 0);
        return;
      }
    }
    // Health dot: the HealthPicker opens itself on mousedown.
    // Here we only sync row/column selection — no drag-select from the dot.
    if (c.k === "health" && e.target.closest("[data-health-dot]")) {
      setSelectedId(task.id);
      setSelectedColIdx(ci);
      // Keep an active multi-row range that COVERS this row so the picker fills the whole
      // range — the mouse path used to collapse here, so a multi-row health/status fill
      // silently changed only the clicked cell while the keyboard path filled every row.
      // Only collapse when the click is OUTSIDE the range (a fresh single selection).
      const inSpan = selRange && selTouchesRow(selRange, ri);
      if (!inSpan) setSelRange({r1:ri, r2:ri, c1:ci, c2:ci});
      return;
    }
    // ID column — Excel row-header behavior: click selects the
    // whole row, and dragging up/down extends the selection
    // across full rows (rowMode: all columns whichever column the pointer crosses). Ctrl+press adds this row
    // as another range.
    if (c.k === "id") {
      // B2445008 (×2) — the ID cell of a row inside a multi-row selection is a pick-up handle for the
      // whole selection (the 8px grip was the only way in, and the owner drags by the ID he selected by).
      if (!review && !e.ctrlKey && !e.metaKey && !e.altKey && idPressMovesRows(selRange, ri, allCols.length)) {
        e.preventDefault();
        startRowDrag(e, task.id, { onClick: () => { setSelectedId(task.id); setSelectedColIdx(0); setSelRange({r1:ri, r2:ri, c1:0, c2:allCols.length-1}); } });
        return;
      }
      const base = additive ? rangesOf(currentSelection()) : undefined;
      setSelectedId(task.id);
      setSelectedColIdx(0);
      setSelRange(makeSelection({r1:ri, r2:ri, c1:0, c2:lastCol}, base));
      beginCellDrag(e, { rowMode: true, apply: (r) => { setSelRange(makeSelection({r1:ri, r2:r, c1:0, c2:lastCol}, base)); const t = tasks[r]; if (t) { setSelectedId(t.id); setSelectedColIdx(0); } } });
      return;
    }
    // Everywhere else: pure Excel — drag starts immediately on mousedown
    if (additive) {
      // Ctrl+click adds this cell as a NEW range (the earlier ones stay highlighted) and Ctrl+drag grows it. A
      // Ctrl+press on an already-selected cell is a toggle, decided on release: no drag = take that cell OUT.
      const prev = currentSelection();
      const wasSel = selContains(prev, ri, ci);
      const base = rangesOf(prev);
      setSelectedId(task.id);
      setSelectedColIdx(ci);
      setSelRange(addRange(prev, {r1:ri, r2:ri, c1:ci, c2:ci}));
      beginCellDrag(e, {
        apply: (r, cc) => { setSelRange(makeSelection({r1:ri, r2:r, c1:ci, c2:cc}, base)); const t = tasks[r]; if (t) { setSelectedId(t.id); setSelectedColIdx(cc); } },
        onEnd: (reason, moved) => {
          if (reason !== "up" || !wasSel || moved) return;
          const next = toggleCellOut(prev, ri, ci);
          setSelRange(next);
          const t = tasks[next.r1];
          if (t) { setSelectedId(t.id); setSelectedColIdx(next.c1); skipColClickRef.current = true; }
        },
      });
      return;
    }
    setSelectedId(task.id);
    setSelectedColIdx(ci);
    setSelRange({r1:ri, r2:ri, c1:ci, c2:ci});
    beginCellDrag(e, { apply: (r, cc) => { setSelRange({r1:ri, r2:r, c1:ci, c2:cc}); const t = tasks[r]; if (t) { setSelectedId(t.id); setSelectedColIdx(cc); } } });
  };
  const cellContextMenu = (e, task, ri, c, ci) => {
    e.preventDefault(); e.stopPropagation();
    // Excel semantics: right-clicking INSIDE the current
    // selection keeps it (so the menu can act on the whole
    // thing — e.g. "Delete N Rows"); right-clicking OUTSIDE
    // collapses the selection to this cell so the previous
    // click's highlight never lingers alongside this one.
    if (!inRange(ri, ci)) setSelRange({r1:ri, r2:ri, c1:ci, c2:ci});
    setSelectedId(task.id); setSelectedColIdx(ci);
    if (setTaskCtx) setTaskCtx({task, projId: proj?.id, x: e.clientX, y: e.clientY});
  };
  // (NEW-2) the old "rows × columns" size pill that used to paint in the header's leftover width is GONE — it
  // was a readout only (nothing read it back) and nobody could tell what "14 × 18" meant. `hasRange` is still the
  // one "a multi-cell selection exists" test the range paint below keys off.
  const hasRange = selIsRange(selRange);

  const colWidthsRef = useRef(null);
  const pinRef = useRef({ lw: 0, rw: 0, l: [], r: [], w: {} });   // NEW-1 — pinned-column geometry for the reveal effect

  // B463922 (×2) — a toggle click sets this to the row it just EXPANDED, so the layout effect
  // below can prefer it over a stale `selectedId`. Expand-only: collapsing never needs its own
  // row protected (nothing new needs to become visible), so leaving it null there keeps the
  // existing selectedId/top-of-viewport anchor in charge, unchanged. See the click handler
  // below (search `expandAnchorRef.current = task.id`) and the layout effect that consumes it.
  const expandAnchorRef = useRef(null);
  // Set for exactly one effect pass when the layout effect below chose the expand-anchor over
  // `selectedId` — tells the next effect (which otherwise chases `selectedId` back into view) to
  // sit this one out, so it doesn't undo the reveal it just decided to prioritize.
  const suppressSelChaseRef = useRef(false);

  // ── B463922 — hold the row you are working on STILL when the list re-lays out ──────────
  // Collapsing (or expanding) a group ABOVE the row you are editing changes how much content
  // sits above it, so with no compensation that row slides up or down the screen by the whole
  // height of what appeared or vanished — under a cursor that has not moved. Rows here are
  // ABSOLUTELY POSITIONED inside a spacer, so the browser's own scroll anchoring cannot help:
  // an out-of-flow row is never an anchor candidate (measured — inserting 500px above this
  // container moves scrollTop by exactly 0). So the app owns the adjustment explicitly, which
  // is VIEWPORT-STABLE (a): fold the MEASURED delta into the scroll position in the SAME frame
  // as the re-layout, in a LAYOUT effect (before paint), so nothing is ever seen to move.
  //
  // The anchor is, in priority order: (1) a row just EXPANDED by a click, so what he opened it
  // to see is what stays put — UNLESS a cell editor is actually open elsewhere, in which case
  // losing keystrokes is worse than a delayed reveal and the edit keeps priority; (2) the
  // selected row while it is on screen; (3) otherwise the row at the top of the viewport.
  //
  // (×2, B548xxx-class recurrence, owner repro 2026-08-18): "clicking to open up the ALTA &
  // Topo Survey stuff... jumps me down to the middle of the schedule so I can't even see what I
  // just opened." Measured cause: a stale `selectedId` — a row merely clicked earlier, with no
  // editor open, sitting BELOW the toggle and still on screen — was winning the anchor. Holding
  // IT fixed forced the toggled row and its brand-new children off screen above by exactly the
  // height of what was revealed (144px for 6 rows in the reproduction). The old priority was
  // right for protecting a live edit against an unrelated background change; it was wrong for
  // the click whose entire point was to reveal the rows it just threw away.
  //
  // When the anchor row itself disappears (you collapsed the group it lives in) we walk UP the
  // previous list to the nearest row that survived, which is its parent.
  const heldListRef = useRef(tasks);
  // NEW-1 (recurrence of B463922, ×3) — companion to suppressSelChaseRef: records whether the
  // selected row was ACTUALLY on screen before this tasks change, so the passive "keep selectedId
  // visible" effect below can tell a real selection change (always chase, as today) from a
  // tasks-only change (collapse, undo, a cloud merge, a recompute, a Gantt drag, a status change —
  // none of which touched selectedId/selectedColIdx), which must chase ONLY when the selection was
  // already on screen — never drag the view back to a selection the user has since scrolled away
  // from. Defaults false: on a fresh mount this effect's own `prev === tasks` bail below never
  // runs, so a remount relies on the scroll-memory restore instead of forcing a chase.
  const selChaseAllowedRef = useRef(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    const prev = heldListRef.current;
    heldListRef.current = tasks;
    const expandAnchorId = expandAnchorRef.current;
    expandAnchorRef.current = null;
    if (!el || prev === tasks || !prev.length || !tasks.length) return;
    const st = el.scrollTop;
    // Index into the PREVIOUS list of the row sitting at the top of the viewport. React has not
    // touched the scroll position, so `st` is still the pre-commit value the old list was laid
    // out against. (Row N's document top is TL_H + N*ROW_H — the sticky header holds TL_H.)
    const topIdx = Math.max(0, Math.min(prev.length - 1, Math.round((st - TL_H) / ROW_H)));
    let anchorIdx = topIdx;
    let usedExpandAnchor = false;
    let selOnScreen = false;
    if (expandAnchorId != null && edit == null) {
      const ei = prev.findIndex(t => t.id === expandAnchorId);
      if (ei >= 0) { anchorIdx = ei; usedExpandAnchor = true; }
    }
    if (!usedExpandAnchor && selectedId != null) {
      const si = prev.findIndex(t => t.id === selectedId);
      const sTop = TL_H + si * ROW_H;
      if (si >= 0 && sTop >= st + TL_H && sTop + ROW_H <= st + el.clientHeight) { anchorIdx = si; selOnScreen = true; }
    }
    suppressSelChaseRef.current = usedExpandAnchor;
    selChaseAllowedRef.current = selOnScreen;
    // The anchor row may itself have been collapsed away — walk up to the nearest survivor.
    let now = -1;
    while (anchorIdx >= 0) {
      now = tasks.findIndex(t => t.id === prev[anchorIdx].id);
      if (now >= 0) break;
      anchorIdx--;
    }
    if (now < 0) return;
    const delta = (now - anchorIdx) * ROW_H;
    if (delta) el.scrollTop = Math.max(0, st + delta);
  }, [tasks]);

  // B548xxx — a row-height change (Format panel slider) rescales every row's absolute `top`,
  // but the raw pixel scrollTop doesn't rescale with it: measured, changing 24px rows to 34px
  // rows with no compensation threw the row that had been on screen clean out of the rendered
  // window (virtualisation dropped it) with ZERO app scroll write — the same "view abandoned,
  // not dragged" failure shape as the B463922 layout-count case, just triggered by a style
  // knob instead of a row count. Same anchor priority as that effect (selected row while it's
  // on screen, else the row at the top of the viewport) and the same algebra: holding a row's
  // index N fixed on screen across a uniform per-row rescale needs scrollTop += N*(new−old);
  // that reduces to the fractional top-of-viewport case when N is a fraction, so one formula
  // covers both anchors.
  const heldRowHRef = useRef(ROW_H);
  React.useLayoutEffect(() => {
    const el = ref.current;
    const prevRH = heldRowHRef.current;
    heldRowHRef.current = ROW_H;
    if (!el || prevRH === ROW_H) return;
    const st = el.scrollTop;
    let anchor = (st - TL_H) / prevRH;
    if (selectedId != null) {
      const si = tasks.findIndex(t => t.id === selectedId);
      const sTop = TL_H + si * prevRH;
      if (si >= 0 && sTop >= st + TL_H && sTop + prevRH <= st + el.clientHeight) anchor = si;
    }
    el.scrollTop = Math.max(0, st + anchor * (ROW_H - prevRH));
  }, [ROW_H]);

  // NEW-1 (B2451776) — the two scroll-into-view moves of the selection chase below, as closures so the grid can
  // ALSO reveal a cell that is not the selection: Ctrl+Shift+Arrow moves a range's far end (the selection itself
  // stays at the anchor), and asks for it via the "planar-reveal-cell" event. Bodies are the chase effect's own,
  // moved verbatim — row N's document top is TL_H + N*ROW_H (the sticky header holds TL_H).
  const revealRowIdx = idx => {
    const el = ref.current;
    if (!el || !(idx >= 0)) return;
    const rowTop = TL_H + idx * ROW_H, rowBottom = rowTop + ROW_H;
    const visTop = el.scrollTop + TL_H, visBottom = el.scrollTop + el.clientHeight;
    if (rowTop < visTop)            el.scrollTop = rowTop - TL_H;
    else if (rowBottom > visBottom) el.scrollTop = rowBottom - el.clientHeight;
  };
  const revealColKey = selKey => {
    const el = ref.current;
    if (!el) return;
    // Horizontal reveal: measure from the columns ACTUALLY rendered (the visible set in
    // display order) — not COLS.slice, which would sum hidden columns' widths and scroll
    // to the wrong place when columns are hidden or reordered.
    const pin = pinRef.current || { lw: 0, rw: 0, l: [], r: [], w: {} };
    const cw = { ...(colWidthsRef.current || {}), ...pin.w };     // DISPLAY widths (the Task cap applies)
    const dispPos = selKey ? colOrder.indexOf(selKey) : -1;
    if (dispPos >= 0) {
      // +2: every row/header starts after its 2px left border (the selection/review marker), so a column's
      // true offset in the scrolled content is 2px more than the sum of the widths before it.
      const colLeft  = 2 + colOrder.slice(0, dispPos).reduce((s, k) => s + (cw[k] || colByK[k]?.w || 0), 0);
      const colRight = colLeft + (cw[selKey] || colByK[selKey]?.w || 0);
      // NEW-1 — the pinned columns cover the edges of the scrollport, so "visible" is the strip BETWEEN
      // them; a pinned column itself is always visible and never needs a scroll.
      const selPinned = pin.l.includes(selKey) || pin.r.includes(selKey);
      const visLeft  = el.scrollLeft + pin.lw, visRight = el.scrollLeft + el.clientWidth - pin.rw;
      if (!selPinned) {
        if (colLeft < visLeft)          el.scrollLeft = colLeft - pin.lw;
        else if (colRight > visRight)   el.scrollLeft = colRight - (el.clientWidth - pin.rw);
      }
    }
  };
  const revealCellRef = useRef(null);
  revealCellRef.current = (row, masterCol) => { revealRowIdx(row); revealColKey(allCols[masterCol]?.k); };
  useEffect(() => {
    const on = e => { const d = e.detail || {}; if (revealCellRef.current) revealCellRef.current(d.row, d.col); };
    document.addEventListener("planar-reveal-cell", on);
    return () => document.removeEventListener("planar-reveal-cell", on);
  }, []);

  const chasedSelRef = useRef({ id: selectedId, col: selectedColIdx });
  useEffect(() => {
    const suppressSelChase = suppressSelChaseRef.current;
    suppressSelChaseRef.current = false;
    const prevSel = chasedSelRef.current;
    chasedSelRef.current = { id: selectedId, col: selectedColIdx };
    if (selectedId === null) return;
    const el = ref.current;
    if (!el) return;
    // NEW-1 (recurrence of B463922, ×3) — a real selection change (arrow keys, Tab, a fresh
    // click, a dashboard/successor-prompt jump) always chases the row into view, same as always.
    // A TASKS-ONLY change chases only when the selected row was already on screen before it
    // (selChaseAllowedRef, set by the anchor effect above from the very same commit) — otherwise
    // this effect (which re-runs on every `tasks` change purely because `tasks` is in its deps)
    // was dragging the view back to a selection the user had long since scrolled away from.
    const selMoved = prevSel.id !== selectedId || prevSel.col !== selectedColIdx;
    const shouldChase = selMoved || selChaseAllowedRef.current;
    const idx = tasks.findIndex(t => t.id === selectedId);
    if (idx >= 0 && !suppressSelChase && shouldChase) {
      // Omitting TL_H in revealRowIdx nudged the topmost fully-visible row up by one header height on a
      // plain click/select — bug C of NEW-1.
      revealRowIdx(idx);
    }
    revealColKey(allCols[selectedColIdx]?.k);
  }, [selectedId, selectedColIdx, tasks]);

  // While reviewing, scroll the proposed/target row into view whenever the active target changes.
  const rvAnchorId = review ? (tasks.find(t => t.__rvTarget)?.id ?? tasks.find(t => t.__rvProposed)?.id ?? null) : null;
  const [rvEdit, setRvEdit] = useState(null); // which proposed-row field is being edited: "end" | "owner" | null
  useEffect(() => { setRvEdit(null); }, [rvAnchorId]);
  useEffect(() => {
    if (!review || rvAnchorId == null) return;
    const el = ref.current; if (!el) return;
    const idx = tasks.findIndex(t => t.__rvTarget) >= 0 ? tasks.findIndex(t => t.__rvTarget) : tasks.findIndex(t => t.__rvProposed);
    if (idx < 0) return;
    // Same TL_H alignment as the goToFocus landing effect below (NEW-1) — row N's document top is
    // TL_H + N*ROW_H, the sticky header holds TL_H.
    const id = setTimeout(() => { el.scrollTop = Math.max(0, TL_H + idx * ROW_H - Math.min(120, el.clientHeight / 3)); }, 50);
    return () => clearTimeout(id);
  }, [rvAnchorId]);

  // ── Cross-view jump landing ───────────────────────────────
  // When App hands us a goToFocus token (dashboard ↗, successor-prompt open),
  // place the row about a third down the viewport — not pinned to an edge the
  // way the plain selection-keeper does — then pulse its outline so the eye
  // lands on it. The 60ms delay lets the section/project switch paint first.
  useEffect(() => {
    if (!goToFocus) return;
    const el = ref.current; if (!el) return;
    const idx = tasks.findIndex(t => t.id === goToFocus.taskId);
    if (idx < 0) return;
    const id = setTimeout(() => {
      // Row N's document top is TL_H + N*ROW_H — the sticky header holds TL_H (same formula the
      // selection-chase effect above uses). Omitting it here landed the row one header height
      // higher than intended.
      el.scrollTop = Math.max(0, TL_H + idx * ROW_H - Math.min(120, el.clientHeight / 3));
      // NEW-1 (bug E, recurrence of B463922 ×3) — App never cleared this token, so it stayed
      // truthy in App state after landing; a LATER remount (any view switch, a phone-breakpoint
      // stack remount) is a brand-new effect instance that runs on mount regardless of whether its
      // deps "changed", and replayed the jump to this same — by then likely unrelated — row.
      // Clear it here, once the scroll write above is actually committed, so a later remount sees
      // goToFocus already null and does nothing. Deliberately NOT cleared synchronously at the top
      // of this effect: `setGoToFocus` there re-renders App with a new `goToFocus` reference before
      // this very `setTimeout` fires, and a dependency change on THIS SAME effect runs its own
      // cleanup first — `clearTimeout(id)` — canceling the landing scroll before it ever happens
      // (measured: the jump then landed nowhere, silently). Clearing after the write is committed
      // has nothing left to race. Guarded on the token (`n`) so this can't clobber a NEWER jump
      // that landed first (shouldn't happen given effect ordering, but it's a one-line guard).
      setGoToFocus?.(gf => (gf && gf.n === goToFocus.n) ? null : gf);
      // The row may not exist in the DOM until the virtualizer re-renders for
      // the new scrollTop — give React a beat before looking it up.
      setTimeout(() => {
        const rowEl = el.querySelector(`[data-task-row="${goToFocus.taskId}"]`);
        if (rowEl && rowEl.animate) rowEl.animate(
          [{boxShadow:"inset 0 0 0 2px #2563eb", offset:0},
           {boxShadow:"inset 0 0 0 2px #2563eb", offset:.45},
           {boxShadow:"inset 0 0 0 2px rgba(37,99,235,0)"}],
          {duration:1100, easing:"ease-out"}
        );
      }, 120);
    }, 60);
    return () => clearTimeout(id);
  }, [goToFocus]);

  // NEW-1 (recurrence of B463922, ×3) — restore this project's last scroll position on mount
  // (bug D: a Grid↔Gantt↔Split view switch remounts this whole component via App's
  // `<ErrorBoundary key={data.view}>`, which otherwise resets to the top every time). Skipped
  // while a goToFocus jump is pending — that jump is a deliberate "go here", so it wins over
  // "go back to where I was". A layout effect so it applies before paint, same as every other
  // scroll-position write in this file.
  const gridMemoKey = proj?.id ?? null;
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || gridMemoKey == null) return;
    const saved = GRID_SCROLL_MEMO.get(gridMemoKey);
    if (saved != null && !goToFocus) { el.scrollTop = saved; setWinTop(rowWindowTop(el.scrollTop)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridMemoKey]);

  const handleScroll = e => {
    if (gridMemoKey != null) GRID_SCROLL_MEMO.set(gridMemoKey, e.currentTarget.scrollTop);
    setWinTop(rowWindowTop(e.currentTarget.scrollTop)); if (onScroll) onScroll(e);
    const el = e.currentTarget, l = el.scrollLeft > 1, r = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setScrollSide(p => (p.l === l && p.r === r ? p : { l, r }));     // NEW-1 — only re-renders when a pin edge flips
  };

  const applyUpdate = (id, col, val) => {
    if (col==="start"||col==="end") {
      const raw = String(val ?? "").trim();
      if (!raw) { updateTask(id,{[col]:""}); return; }                  // cleared → unschedule that endpoint (was: silently reverted)
      let p = parseFlexDate(raw);
      if (!p) { showToast("Couldn't read that date — try M/D or M/D/YY"); return; }  // was: silently reverted, no feedback
      // NEW-1 — a meeting-bound row is a milestone on a MEETING day, which the body's own calendar decides
      // (a Saturday meeting is a real meeting): skip the working-day roll for it, or a typed 12/12 (Sat) would
      // roll to Monday and then jump PAST the real meeting. updateTask/resolveBoundEdit resolves it forward.
      const _bt = tasks.find(x => x.id === id);
      const _boundHere = !!(_bt && _bt.meetingBound && !_bt.hasChildren && MEETING_BODY_INDEX[_bt.meetingBodyId]);
      // The schedule runs on WORKING days — a Start/Finish can't sit on a weekend or holiday (B624).
      // Roll a non-working-day entry FORWARD to the next working day and say why, rather than silently
      // accepting it. rollForwardToWorkday skips Sat/Sun + HOLIDAY_SET; a working day is unchanged.
      const rolled = _boundHere ? p : rollForwardToWorkday(p);
      if (rolled !== p) {
        const wd = pd(p).getDay();
        const why = (wd === 0 || wd === 6) ? "a weekend" : "a holiday";
        showToast(`${col==="end" ? "Finish" : "Start"} moved to ${toShortDate(rolled)} — you picked ${why}.`, { type: "info" });
        p = rolled;
      }
      if (col==="end") {
        const t = tasks.find(x => x.id === id);
        if (t && !_boundHere && t.start && p < t.start) { showToast("Finish can't be before Start — change the Start date first."); return; }  // was: silently collapsed to a 0-day milestone, losing the typed date
      }
      updateTask(id,{[col]:p});
    }
    else if (col==="percentComplete") {
      const pt = tasks.find(x => x.id === id);
      if (pt && pt.hasChildren) { showToast("% Complete on a parent row rolls up from its tasks — edit the tasks (or set the parent's status to cascade)."); return; }
      updateTask(id,{percentComplete:Math.max(0,Math.min(100,parseInt(val)||0))});
    }
    else if (col==="duration") {
      // B615: parse the typed unit — days/weeks = working days, months/years = calendar-real.
      // An unparseable string surfaces a VISIBLE inline error, never silently coercing to 0.
      const parsed = parseDurationInput(val);
      if (parsed.error) { showToast(parsed.error); return; }
      updateTask(id,{durValue: parsed.value, durUnit: parsed.unit});   // updateTask derives duration + end from the unit
    }
    else if (col==="predecessors") {
      // Drop self-references (Fix #16), references to ids that don't exist, and references
      // that would create a circular dependency — each surfaced with a toast so the edit is
      // honest rather than silently stored-but-inert / silently-wrong.
      const { preds, selfRemoved, unknownIds, cyclic, ancestor } = validatePredEdit(proj?.tasks || tasks, id, parsePreds(val));
      if (selfRemoved) showToast(`Task ${id} can't be its own predecessor — removed.`);
      else if (cyclic.length) showToast(`That would create a circular dependency (task ${cyclic.join(", ")}) — ignored.`);
      else if (ancestor.length) showToast(`Task ${ancestor.join(", ")} is this task's own summary row — a summary's dates come FROM its tasks, not the other way around. Ignored.`);
      else if (unknownIds.length) showToast(`No task ${unknownIds.join(", ")} in this project — ignored.`);
      updateTask(id, {predecessors: preds});
    }
    else if (col==="health"||col==="status") { updateTask(id,{health:val}); }
    else if (col==="cost"||col==="budget"||col==="actualCost") { const n=String(val).replace(/[^0-9.]/g,""); updateTask(id,{[col]: n==="" ? "" : (parseFloat(n)||0)}); }
    else updateTask(id,{[col]:val});
  };

  /* B1341728 — the WRITE half of commit, split out so a write-through (tokens-class) editor can
   * save what it shows WITHOUT closing itself. Range-fill semantics are byte-for-byte the ones
   * `commit` has always had; `commit` is now exactly this plus closing the editor, nothing else. */
  const applyCommit = (taskId, col, val) => {
    const isHealthOp = col === "health" || col === "status";
    if (hasRange && selRange) {
      const ci = COLS.findIndex(c => c.k === col);
      const ri = tasks.findIndex(t => t.id === taskId);
      if (isHealthOp ? selTouchesRow(selRange, ri) : inRange(ri, ci)) {
        if (col === "name" || col === "notes" || col === "predecessors") {
          // These are never range-filled (filling one name across many rows is destructive), but the
          // focused cell's OWN edit must still commit — the old loop skipped every row and returned,
          // silently discarding the typed value when a row/range selection covered the edited cell.
          applyUpdate(taskId, col, val);
        } else {
          // B2530690 — every range, not just the active one: a row is filled when the column's cell sits in a range
          // (a health/status fill takes every row any range touches).
          for (const r of selRowsOf(selRange, tasks.length - 1)) {
            if (!isHealthOp && !inRange(r, ci)) continue;
            const t = tasks[r];
            // Don't fill a parent's rolled-up fields: dates self-correct via rollupParentDates, but
            // cost/budget/actual have no rollup-on-write, so a filled value would persist invisibly into
            // cloud-save + JSON/CSV export. Matches the single-cell parent lock.
            if (t && !(t.hasChildren && (col==="start"||col==="end"||col==="duration"||col==="cost"||col==="budget"||col==="actualCost"))) applyUpdate(t.id, col, val);
          }
        }
        return;
      }
    }
    applyUpdate(taskId, col, val);
  };

  const commit = (taskId, col, val) => { applyCommit(taskId, col, val); setEdit(null); };

  const commitAndAdvance = (taskId, col, val) => {
    // Fix #6: capture the next task's id BEFORE commit so the date cascade
    // can't reshuffle rows and land the cursor on the wrong task.
    const idxBefore = tasks.findIndex(t => t.id === taskId);
    const nextIdBefore = tasks[idxBefore + 1]?.id ?? null;
    commit(taskId, col, val);
    if (nextIdBefore !== null) setSelectedId(nextIdBefore);
    // A date / dependency edit can re-sort rows via the cascade, so the flat-index selRange is now stale
    // (its highlight + Shift-Arrow anchor would point at whatever rows moved into that span); drop it so
    // the next selection re-derives cleanly. Non-reordering edits (owner/cost/…) keep their range.
    if (col === "start" || col === "end" || col === "duration" || col === "predecessors") setSelRange(null);
  };

  // ── Per-project column config (B212) ────────────────────────
  // The left table's columns — which, order, widths — are configured PER PROJECT and persist
  // through the existing cloud-save path (writeGridCfg → setData → autosave). COLS is the
  // master available-field registry; `cfg.visible` is this project's ordered, shown subset.
  // (Legacy global gridColOrder/gridColWidths migrate in via readGridCfg on first read.)
  const pid = proj?.id;
  // B583 — the project's effective column registry: built-in COLS + user Formula columns.
  const formulaCols = useMemo(() => formulaColsOf(proj), [proj?.formulaCols]);
  const allCols = useMemo(() => effectiveColsOf(proj), [proj?.formulaCols]);
  const colByK = useMemo(() => Object.fromEntries(allCols.map(c => [c.k, c])), [allCols]);
  // B844 — proj.meetingBodies / proj.tasks are in the deps so the meeting-column auto-show (readGridCfg)
  // recomputes when a body is defined or a task is bound; without them the memo went stale and the Meeting /
  // Float / Cost columns never appeared until an unrelated column change forced a recompute.
  const cfg = useMemo(() => readGridCfg(proj, data), [proj?.colConfig, proj?.formulaCols, proj?.meetingBodies, proj?.tasks, data.gridColOrder, data.gridColWidths, pid]);
  const colOrder = cfg.visible;
  // B583 — per-row computed values for every Formula column, evaluated AFTER the date
  // cascade has settled (this renders from the already-cascaded `tasks`). Dependent
  // formula columns are computed in topological order; cycles surface as #CIRC!.
  // Shape: { [taskId]: { [colKey]: { ok, error, display, value } } }.
  const formulaValues = useMemo(
    () => computeFormulaValues(tasks, formulaCols, proj),
    [tasks, formulaCols, data.settings?.holidays, NOW]
  );
  // Live width override during a drag-resize: kept local so the drag stays smooth, then
  // committed to the project config on mouse-up (calling setData mid-render warns/loops).
  const [liveW, setLiveW] = useState(null); // { k, w } | null
  const widthOf = (k) => (liveW && liveW.k === k ? liveW.w : (cfg.widths[k] ?? colByK[k]?.w ?? 100));
  const colWidths = useMemo(() => { const o = {}; allCols.forEach(c => { o[c.k] = (liveW && liveW.k === c.k ? liveW.w : (cfg.widths[c.k] ?? c.w)); }); return o; }, [cfg, liveW, allCols]);
  // Sync the ref during render so handlers reading colWidthsRef.current always see current widths.
  colWidthsRef.current = colWidths;
  useEffect(() => { if (onColWidths) onColWidths({ order: colOrder, widths: colWidths }); }, [colWidths, colOrder]);

  const orderedCols = colOrder.map(k => colByK[k]).filter(Boolean);
  // ── NEW-1 (Schedule grid holds at narrow widths) — pinned columns + a pane-relative Task cap ──────
  // Owner: "I want the frame to always work regardless of the size of computer or screen." Sideways
  // scrolling already lived inside this container (the page never scrolled — measured); what was missing
  // was ANY pinned column, so ID/Task scrolled away and the ●/status tail was cut off. Now ID + Task pin
  // LEFT (the leading run of those columns), a trailing ●/Status run pins RIGHT, and the Task column is
  // capped at about half THIS PANE'S width (Split's pane, not the window) so START/FINISH stay visible.
  // The cap is a DISPLAY width only — the saved/resized width (cfg.widths, colWidths, onColWidths → the
  // Split divider snap) is untouched, so widening the window gives the user's width back. Pins switch off
  // entirely when they'd eat most of a very small pane (an 18% Split divider), so the grid just scrolls.
  const [gridW, setGridW] = useState(0);                       // this pane's inner width, in content px
  const [scrollSide, setScrollSide] = useState({ l: false, r: false }); // content is under the left / right pins
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setGridW(Math.floor(el.getBoundingClientRect().width / (gridZoom || 1)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [gridZoom]);
  const NAME_MIN_W = 100;
  const nameCap = (leftOthers) => Math.max(NAME_MIN_W, Math.floor(gridW * 0.5) - leftOthers);
  let pinL = []; for (const c of orderedCols) { if (c.k === "id" || c.k === "name") pinL.push(c.k); else break; }
  let pinR = []; for (let i = orderedCols.length - 1; i >= 0; i--) { const k = orderedCols[i].k; if (k === "health" || k === "status") pinR.unshift(k); else break; }
  const dispW = { ...colWidths };
  if (gridW > 0 && pinL.includes("name")) dispW.name = Math.min(colWidths.name, nameCap(pinL.includes("id") ? colWidths.id : 0));
  if (pinL.length + pinR.length >= orderedCols.length) { pinL = []; pinR = []; }   // nothing left to scroll under them
  const pinLW = pinL.reduce((s, k) => s + dispW[k], 0), pinRW = pinR.reduce((s, k) => s + dispW[k], 0);
  if (gridW > 0 && pinLW + pinRW > gridW * 0.8) { pinL = []; pinR = []; }       // tiny pane: don't pin
  const pinOn = pinL.length + pinR.length > 0;
  const pinLeftOff = (k) => pinL.slice(0, pinL.indexOf(k)).reduce((s, x) => s + dispW[x], 0);
  const pinRightOff = (k) => pinR.slice(pinR.indexOf(k) + 1).reduce((s, x) => s + dispW[x], 0);
  const pinCls = (k) => (k === pinL[pinL.length - 1] ? `pin-edge-l${scrollSide.l ? " pin-on" : ""}` : k === pinR[0] ? `pin-edge-r${scrollSide.r ? " pin-on" : ""}` : "");
  // `fill` = the cell's own opaque look (row colour / header surface); layered over --bg so even a
  // translucent row colour is opaque once pinned and scrolled content never shows through.
  // NEW-1 (row highlight reaches ID + Task) — `fills` is listed BOTTOM → TOP (row colour first, then the
  // cell's own range tint / per-cell fill). CSS paints the FIRST background-image layer on TOP, so the
  // stack is reversed (`pinnedFillLayers`): the old code listed the row colour first and it painted over
  // the tint and the fill, which is why a selection or a cell fill showed from START rightward and
  // stopped short of the frozen ID / Task cells.
  const pinStyle = (k, fills, z) => {
    if (!pinL.includes(k) && !pinR.includes(k)) return null;
    const layers = pinnedFillLayers(fills);
    return { position: "sticky", zIndex: z, ...(pinL.includes(k) ? { left: pinLeftOff(k) } : { right: pinRightOff(k) }),
      backgroundColor: "var(--bg)", ...(layers ? { backgroundImage: layers } : {}) };
  };
  const syncScrollSide = (el) => {
    if (!el) return; const l = el.scrollLeft > 1, r = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setScrollSide(p => (p.l === l && p.r === r ? p : { l, r }));
  };
  const totalW = orderedCols.reduce((s, c) => s + dispW[c.k], 0);
  useEffect(() => { syncScrollSide(ref.current); }, [gridW, totalW, pinOn]);
  pinRef.current = { lw: pinLW, rw: pinRW, l: pinL, r: pinR, w: dispW };   // read by the keyboard reveal effect
  const hiddenCols = allCols.filter(c => !colOrder.includes(c.k)); // available-but-not-shown
  // Effective-registry indices of the visible columns, in display order — drives in-cell Tab
  // navigation through the SHOWN columns only (passed to Cell). B583: index into allCols
  // (built-ins + formula columns) so a formula column is navigable too and lines up with the
  // row render's ci = allCols.indexOf(c). Mirrors stepVisibleColIdx (gridColNav.js).
  const colMasterIdxs = orderedCols.map(c => allCols.indexOf(c));
  // NEW-1 — the leftover width right of the last column ("the strip"). Each row carries a flex-filling filler cell
  // there so the strip reads as the row continuing: same tint (the row's own background), the same solid cell line,
  // the multi-row selection highlight + outline running to the pane's edge, and a press selecting the row exactly as
  // a press on its last visible cell does. It is flex:1 1 0, so it is zero-width (and adds no scroll width) when the
  // columns already fill the pane.
  const stripCol = orderedCols[orderedCols.length - 1];
  const stripCi = stripCol ? allCols.indexOf(stripCol) : -1;
  liveGridRef.current = { tasks, allCols, gridZoom, stripCi };
  const stripJoinsRange = hasRange && selTouchesCol(selRange, stripCi);
  const stripShadow = (ri) => {
    if (!stripJoinsRange || !inRange(ri, stripCi)) return "none";
    const ed = selEdgesAt(selRange, ri, stripCi);
    const sh = [];
    if (ed.top) sh.push("inset 0 2px 0 0 #2563eb");
    if (ed.bottom) sh.push("inset 0 -2px 0 0 #2563eb");
    sh.push("inset -2px 0 0 0 #2563eb");
    return sh.join(",");
  };

  // If the selected column is no longer on screen — hidden via the Columns chooser, or the
  // initial id column hidden in this layout — snap the cursor to the nearest visible column
  // so the blue selection outline never silently disappears on a layout change.
  useEffect(() => {
    if (selectedId === null || !colMasterIdxs.length) return;
    if (colMasterIdxs.includes(selectedColIdx)) return; // still visible — nothing to do
    const target = colMasterIdxs.reduce(
      (best, i) => (Math.abs(i - selectedColIdx) < Math.abs(best - selectedColIdx) ? i : best),
      colMasterIdxs[0]);
    if (target !== selectedColIdx) setSelectedColIdx(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colOrder, selectedColIdx, selectedId]);

  // ── B583 — Formula-column add/edit/delete (persist on proj.formulaCols + colConfig) ──
  const [formulaEditor, setFormulaEditor] = useState(null); // { mode:'add'|'edit', colKey?, label, formula } | null
  const saveFormulaCol = ({ colKey, label, formula }) => setData(d => {
    const p = d.projects?.[pid]; if (!p) return d;
    const existing = Array.isArray(p.formulaCols) ? p.formulaCols : [];
    let fcs, visible;
    const curCfg = readGridCfg(p, d);
    if (colKey) {
      fcs = existing.map(fc => fc.k === colKey ? { ...fc, l: label, formula } : fc);
      visible = curCfg.visible;
    } else {
      const key = "f_" + Date.now().toString(36);
      fcs = [...existing, { k: key, l: label, formula, w: 140 }];
      visible = curCfg.visible.includes(key) ? curCfg.visible : [...curCfg.visible, key];
    }
    return { ...d, projects: { ...d.projects, [pid]: { ...p, formulaCols: fcs, colConfig: { visible, widths: curCfg.widths } } } };
  });
  const deleteFormulaCol = (colKey) => setData(d => {
    const p = d.projects?.[pid]; if (!p) return d;
    const fcs = (Array.isArray(p.formulaCols) ? p.formulaCols : []).filter(fc => fc.k !== colKey);
    const curCfg = readGridCfg(p, d);
    const visible = curCfg.visible.filter(k => k !== colKey);
    const widths = { ...curCfg.widths }; delete widths[colKey];
    return { ...d, projects: { ...d.projects, [pid]: { ...p, formulaCols: fcs, colConfig: { visible, widths } } } };
  });
  // Live preview for the editor: evaluate an in-progress formula against the selected
  // row (or the first task), including the OTHER formula columns' computed values.
  const previewFormula = (formula) => {
    const PF = window.PlanyrFormula;
    if (!PF) return { ok: false, error: "engine unavailable" };
    const sample = tasks.find(t => t.id === selectedId) || tasks.find(t => !t.hasChildren) || tasks[0];
    if (!sample) return { ok: true, value: PF.BLANK, display: "", sampleName: null };
    // Mirror computeFormulaValues: aggregation reads the FULL tree's LEAF tasks (so a
    // SUM([Cost]) preview matches the grid, not a double-counted visible-row sum). The
    // sample row's own cells (incl. computed formula columns) drive the this-row context.
    const allTasks = (proj && Array.isArray(proj.tasks) && proj.tasks.length) ? proj.tasks : tasks;
    const parentIds = new Set(allTasks.map(t => t.parentId).filter(x => x !== null && x !== undefined));
    const colMap = t => {
      const cols = buildFormulaRowColumns(t);
      const fcCells = formulaValues[t.id] || {};
      formulaCols.forEach(fc => { const c = fcCells[fc.k]; if (c && fc.l) cols[fc.l.toLowerCase()] = c.ok ? c.value : PF.errVal(c.error); });
      return cols;
    };
    const aggRows = allTasks.filter(t => !parentIds.has(t.id)).map(colMap);
    const dateFmt = serial => toShortDate(PF.serialToISO(serial));
    const res = PF.evaluateFormula(formula, { columns: colMap(sample), rows: aggRows, rowIndex: 0, calendar: formulaCalendar(), today: formulaToday(), formatDate: dateFmt });
    return { ...res, display: res.ok ? PF.formatValue(res.value, { formatDate: dateFmt }) : res.error, sampleName: sample.name || ("Task " + sample.id) };
  };

  const [dragColKey, setDragColKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [colMenuOpen, setColMenuOpen] = useState(false);  // the "Columns" chooser flyout (portal)
  const [hdrCtx, setHdrCtx] = useState(null);             // right-click header menu { x, y, colKey } (portal)

  const persistVisible = (visible) => writeGridCfg(setData, pid, { visible, widths: cfg.widths });
  const persistWidths  = (widths)  => writeGridCfg(setData, pid, { visible: colOrder, widths });

  const reorderCols = (fromKey, toKey) => {
    if (fromKey === toKey || !fromKey || !toKey) return;
    const next = [...colOrder];
    const fi = next.indexOf(fromKey), ti = next.indexOf(toKey);
    if (fi < 0 || ti < 0) return;
    next.splice(fi, 1); next.splice(ti, 0, fromKey);
    persistVisible(next);
  };
  const hideCol = (k) => { if (k === "name") return; persistVisible(colOrder.filter(c => c !== k)); };
  const showCol = (k, afterKey) => {
    if (!colByK[k] || colOrder.includes(k)) return;  // colByK includes formula (f_) columns; COL_BY_K is built-ins only
    const next = [...colOrder];
    const at = afterKey != null ? next.indexOf(afterKey) + 1 : next.length;
    next.splice(at > 0 ? at : next.length, 0, k);
    persistVisible(next);
  };
  const resetCols = () => writeGridCfg(setData, pid, { visible: [...DEFAULT_GRID_COLS], widths: {} });

  const startResize = (colKey, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = dispW[colKey] ?? widthOf(colKey);
    let latestW = startW;
    const move = ev => { latestW = Math.max(36, startW + ev.clientX - startX); setLiveW({ k: colKey, w: latestW }); };
    const release = window.pinSchedCursor("col-resize", { onExit: () => up() });   // held even when the pointer leaves the 6px grip
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      release();
      setLiveW(null);
      persistWidths({ ...cfg.widths, [colKey]: latestW });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const autoSizeCol = (colKey) => {
    const col = colByK[colKey];
    if (!col) return;
    const values = tasks.map(t => {
      let val = '';
      switch(colKey) {
        case 'name': val = t.name||''; break;
        case 'start': case 'end': { if(!t[colKey]){ val=''; break; } const [y,m,d]=t[colKey].split('-'); val=`${String(+m).padStart(2,'0')}/${String(+d).padStart(2,'0')}/${(y||'').slice(2)}`; break; }  // empty date → measure nothing, not the literal "NaN/NaN/"
        case 'duration': val = `${t.duration}d`; break;
        case 'health': val = HEALTH[t.health]?.label||''; break;
        case 'percentComplete': val = `${t._pct ?? effectivePercentComplete(t, proj?.tasks)}%`; break;
        case 'responsibleParty': val = ownerDisplayParts(ownerListOf(t)).label; break;
        case 'predecessors': val = fmtPreds(normPreds(t.predecessors)); break;
        case 'successors': val = String((succMap[t.id]||[]).length>0?(succMap[t.id]||[]).join(', '):''); break;
        case 'id': val = String(t.id); break;
        case 'cost': case 'budget': case 'actualCost': { const v=Number(t[colKey])||0; val = v?("$"+v.toLocaleString("en-US")):''; break; }
        default: val = col.t === "formula" ? (formulaValues[t.id]?.[colKey]?.display || '') : String(t[colKey]||'');
      }
      return val;
    });
    persistWidths({ ...cfg.widths, [colKey]: measuredColWidth(col.l||colKey, values, 36) });
  };

  return (
    <div style={{position:"relative",flex:1,minWidth:0,minHeight:0,display:"flex"}}>
    <div ref={ref} data-grid-scroll="1" data-scroll-bounds style={{flex:1,overflow:"auto",position:"relative",zoom:gridZoom,paddingBottom:`calc(var(--fab-dock, 0px) / ${gridZoom})`}} onScroll={handleScroll} onMouseEnter={()=>setHoverZone?.("grid")}>
      <div data-grid-header="1" style={{position:"sticky",top:0,zIndex:10,display:"flex",background:"var(--surf)",borderBottom:"2px solid var(--amber)",borderLeft:"2px solid transparent",minWidth:totalW,height:30}}>
        {orderedCols.map(c => (
          <div key={c.k} data-hdr-col={c.k} className={pinCls(c.k) || undefined}
            draggable={c.k !== "health" && c.k !== "status"}
            onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDragColKey(c.k);}}
            onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="move";setDragOverKey(c.k);}}
            onDragLeave={()=>setDragOverKey(null)}
            onDrop={e=>{e.preventDefault();reorderCols(dragColKey,c.k);setDragColKey(null);setDragOverKey(null);}}
            onDragEnd={()=>{setDragColKey(null);setDragOverKey(null);}}
            onContextMenu={e=>{e.preventDefault();e.stopPropagation();setHdrCtx({x:e.clientX,y:e.clientY,colKey:c.k});}}
            style={{width:dispW[c.k],flexShrink:0,padding:"0 8px",fontSize:10,fontWeight:600,
              color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase",
              display:"flex",alignItems:"center",justifyContent:c.k==="health"?"center":"flex-start",
              borderRight:"1px solid var(--bd)",borderLeft:dragOverKey===c.k&&dragColKey!==c.k?"2px solid var(--blue)":"2px solid transparent",
              fontFamily:"'Inter',system-ui,sans-serif",position:"relative",userSelect:"none",
              cursor:c.k!=="health"&&c.k!=="status"?"grab":"default",
              opacity:dragColKey===c.k?0.4:1,transition:"border-color .1s,opacity .1s",
              ...(pinStyle(c.k, ["var(--surf)"], 4) || {})}}>
            {c.k === "health"
              ? <HealthColHeader current={healthColStyle||"stoplight"} onChange={setHealthColStyle} />
              : c.k === "status"
              ? <StatusHeaderDropdown data={data} setData={setData} />
              : c.k === "notes"
              ? <NotesColHeader data={data} setData={setData} />
              : c.l}
            {c.k !== "health" && <div
              onMouseDown={e=>{e.stopPropagation();e.preventDefault();startResize(c.k,e);}}
              onClick={e=>e.stopPropagation()}
              onDoubleClick={e=>{e.stopPropagation();autoSizeCol(c.k);}}
              style={{position:"absolute",right:0,top:0,bottom:0,width:6,cursor:"col-resize",zIndex:2}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--blue)33"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"} />}
          </div>
        ))}
      </div>

      <div style={{position:"relative",height:totalRows*ROW_H,minWidth:totalW}}>
        {/* NEW-ROWMOVE — insertion-line drop indicator: positioned imperatively via dragLineRef
            during a row drag (see startRowDrag/computeAndPaint), never through React state, so
            painting it never re-renders this row list. Hidden (display:none) when not dragging
            or when hovering a blocked target (itself or its own descendant). */}
        <div ref={dragLineRef} data-drag-insert-line
          style={{position:"absolute", left:0, right:0, height:3, background:"var(--blue)", zIndex:50, pointerEvents:"none", display:"none"}} />
        {/* NEW-ROWNEST — the nest-under target: a box around the hovered row (blue = legal, red dashed =
            a row being dragged or inside one). Same imperative contract as the line above. */}
        <div ref={dragNestRef} data-drag-nest
          style={{position:"absolute", left:0, right:0, boxSizing:"border-box", borderRadius:3, zIndex:49, pointerEvents:"none", display:"none"}}>
          <span style={{position:"absolute", top:"50%", transform:"translateY(-50%)", left:0, color:"#fff", fontSize:10, fontWeight:600, lineHeight:1, padding:"2px 6px", borderRadius:3, fontFamily:"'Inter',system-ui,sans-serif", whiteSpace:"nowrap"}} />
        </div>
        {tasks.slice(startIdx, endIdx).map((task, i) => {
          const ri = startIdx + i;
          if (task.__rvProposed) {
            const rv = review || {};
            const lvl = task.level || 0;
            const cs = {fontSize:12, padding:"0 8px", height:ROW_H, display:"flex", alignItems:"center", overflow:"hidden", whiteSpace:"nowrap"};
            const mono = {fontFamily:"'Inter',system-ui,sans-serif"};
            const dateDisp = iso => { if (!iso) return ""; const [y,m,d] = iso.split('-'); return String(+m).padStart(2,'0')+'/'+String(+d).padStart(2,'0')+'/'+y.slice(2); };
            const creating = !!(rv && rv.isCreate);
            return (
              <div key="__rvprop" className="drow rv-prow" style={{top:ri*ROW_H, height:ROW_H, minWidth:totalW, background: creating ? "#ecfdf3" : "#f3f0ff", borderLeft: creating ? "2px solid #16a34a" : "2px solid var(--amber)"}}>
                {orderedCols.map(c => {
                  const w = dispW[c.k];
                  let inner = <span style={cs} />;
                  if (c.k === "name") inner = creating ? (
                    <span style={{...cs, paddingLeft:4+lvl*14, gap:0, flex:1, minWidth:0}}>
                      <span style={{width:16, flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", color:"#16a34a"}}><i className="ti ti-plus" style={{fontSize:12}}/></span>
                      <span style={{color:"#15803d", fontWeight:600, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", minWidth:0}}>{rv.newName || "New task"}</span>
                      <span style={{flexShrink:0, marginLeft:6, fontSize:8.5, fontWeight:700, color:"#15803d", background:"#dcfce7", border:"1px solid #86efac", borderRadius:4, padding:"1px 4px", letterSpacing:".04em"}}>NEW</span>
                    </span>
                  ) : (
                    <span style={{...cs, paddingLeft:4+lvl*14, gap:0, flex:1, minWidth:0}}>
                      <span style={{width:16, flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", color:"var(--amber)"}}><i className="ti ti-corner-down-right" style={{fontSize:12}}/></span>
                      <span style={{color:"var(--amber)", fontWeight:600, fontStyle:"italic", fontSize:12, overflow:"hidden", textOverflow:"ellipsis", minWidth:0}}>proposed</span>
                    </span>
                  );
                  else if (c.k === "start") inner = rv.startChanged
                    ? <span style={{...cs, ...mono, justifyContent:"center", color:"var(--mut)", fontSize:11}}>{dateDisp(rv.propStart)}</span>
                    : <span style={{...cs, ...mono, justifyContent:"center"}} />;
                  else if (c.k === "end") inner = (rvEdit === "end")
                    ? <input {...NO_AUTOFILL} autoFocus className="ei" placeholder="M/D or M/D/YY" defaultValue={toShortDate(rv.propEnd)}
                        onBlur={e => { const iso = parseFlexDate(e.target.value); if (iso && rv.onEnd) rv.onEnd(iso); setRvEdit(null); }}
                        onKeyDown={e => { if (e.key==="Enter"){ e.preventDefault(); const iso=parseFlexDate(e.target.value); if(iso&&rv.onEnd) rv.onEnd(iso); setRvEdit(null); } else if (e.key==="Escape"){ setRvEdit(null); } }} />
                    : <span style={{...cs, ...mono, justifyContent:"center", color:"var(--mut)", fontSize:11, cursor:"text"}} title="Click to edit" onClick={()=>setRvEdit("end")}>{dateDisp(rv.propEnd)}</span>;
                  else if (c.k === "predecessors") inner = (rv.addedPreds && rv.addedPreds.length)
                    ? <span style={{...cs, color:"var(--amber)", fontWeight:600, gap:5, display:"inline-flex", alignItems:"center"}}><i className="ti ti-arrow-bar-to-right" style={{fontSize:13}}/>{rv.addedPreds.join(", ")}</span>
                    : <span style={cs} />;
                  else if (c.k === "duration") inner = (rvEdit === "duration")
                    ? <input {...NO_AUTOFILL} autoFocus className="ei" placeholder="days" defaultValue={rv.propDur!=null ? String(rv.propDur) : ""}
                        onBlur={e => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n >= 0 && rv.onDur) rv.onDur(n); setRvEdit(null); }}
                        onKeyDown={e => { if (e.key==="Enter"){ e.preventDefault(); const n=parseInt(e.target.value,10); if(!isNaN(n)&&n>=0&&rv.onDur) rv.onDur(n); setRvEdit(null); } else if (e.key==="Escape"){ setRvEdit(null); } }} />
                    : <span style={{...cs, ...mono, color:"var(--mut)", cursor:"text"}} title="Click to edit" onClick={()=>setRvEdit("duration")}>{rv.propDur!=null ? rv.propDur+"d" : ""}</span>;
                  else if (c.k === "health") inner = <span style={{...cs, justifyContent:"center", padding:0}}><HealthPicker value={rv.propStatus||"gray"} onChange={hk=>rv.onStatus&&rv.onStatus(hk)} /></span>;
                  else if (c.k === "status") inner = <span style={{...cs, padding:"0 4px"}}><StatusPicker value={rv.propStatus||"gray"} onChange={hk=>rv.onStatus&&rv.onStatus(hk)} /></span>;
                  else if (c.k === "responsibleParty") inner = (rvEdit === "owner")
                    ? <input {...NO_AUTOFILL} autoFocus className="ei" placeholder="Owner" defaultValue={rv.propOwner||""}
                        onBlur={e => { if (rv.onOwner) rv.onOwner(e.target.value); setRvEdit(null); }}
                        onKeyDown={e => { if (e.key==="Enter"){ e.preventDefault(); if(rv.onOwner) rv.onOwner(e.target.value); setRvEdit(null); } else if (e.key==="Escape"){ setRvEdit(null); } }} />
                    : <span style={{...cs, color: rv.propOwner ? "var(--txt)" : "var(--mut)", cursor:"text"}} title="Click to edit" onClick={()=>setRvEdit("owner")}>{rv.propOwner||""}</span>;
                  const wrap = {width:w, flexShrink:0, height:ROW_H, position:"relative", overflow: c.k==="health" ? "visible" : "hidden", borderRight:GRID_LINE, borderBottom:GRID_LINE,
                    ...(pinStyle(c.k, [creating ? "#ecfdf3" : "#f3f0ff"], 5) || {})};
                  return <div key={c.k} data-row-line className={pinCls(c.k) || undefined} style={wrap}>{inner}</div>;
                })}
                <div data-grid-strip style={{flex:"1 1 0", minWidth:0, height:ROW_H, position:"relative", borderBottom:GRID_LINE}} />
              </div>
            );
          }
          const isFocused = selectedId === task.id;
          // A parent ALWAYS reflects rolled-up child health — collapsed or expanded — so a
          // conditional-format rule (overdue/due-soon/complete) on the parent's own stale, non-
          // rolled fields can't flip its color when you expand it. Matches GanttView + MasterView
          // (which key on isSummary, not expand state); only leaves get computeDisplayHealth.
          const displayHealth = task.hasChildren
            ? (rolledHealthMap?.[task.id] || task.health)
            : computeDisplayHealth(task, data.settings, taskById);
          const isExpandedParent = task.hasChildren && task.isExpanded;
          const rowBg = task.__rvMover ? "#fff8ee" : task.__rvTarget ? "#f3f0ff" : (task.rowColor || (isExpandedParent ? (ri%2?"#f8fafc":"var(--bg)") : (displayHealth==="red"?"#ffdfdf":displayHealth==="yellow"?"#fff7b9":displayHealth==="green"?"#d6fae2":displayHealth==="paused"?"#f3f4f6":ri%2?"#f8fafc":"var(--bg)")));
          return (
            <div key={task.id} className="drow" data-task-row={task.id} data-row-sel={(isFocused && !hasRange) ? "1" : undefined}
              style={{top:ri*ROW_H, height:ROW_H,
                // the selected row's blue accent is drawn on the FIRST cell (it sticks with the pinned columns
                // at every scroll position) — a border on the row itself scrolls away with the row.
                borderLeft: task.__rvTarget ? "2px solid var(--amber)" : "2px solid transparent",
                background: rowBg}}>
              {(task.__rvTarget || task.__rvPending !== undefined) ? <span onMouseDown={task.__rvPending!==undefined ? (e=>{e.stopPropagation(); review && review.pick(task.__rvPending);}) : undefined} title={task.__rvPending!==undefined ? "Review this update" : "Being reviewed"} style={{position:"absolute",left:3,top:"50%",transform:"translateY(-50%)",width:7,height:7,borderRadius:"50%",background:"var(--amber)",boxShadow:"0 0 0 2.5px #eef2ff",zIndex:7,cursor:task.__rvPending!==undefined?"pointer":"default"}}/> : null}
              {task.__rvMover ? <span style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",fontSize:10,fontWeight:600,color:"var(--amber)",background:"#fff3d6",border:"1px solid #f0c98a",padding:"0 5px",borderRadius:9,zIndex:7,pointerEvents:"none"}}>{task.__rvMover>=0?"+":""}{task.__rvMover}d</span> : null}

              {orderedCols.map((c) => { const ci = allCols.indexOf(c);
                const activeInMulti = isFocused && selectedColIdx === ci && isMulti(selRange);   // B2530690 — with several ranges the active cell keeps its own outline
                const active = isFocused && selectedColIdx === ci && (!hasRange || activeInMulti);
                const selected = inRange(ri, ci);
                const tinted = selected && hasRange && !activeInMulti;
                const cfmt = task.cellFmt?.[c.k]; // per-cell format (bold/italic/fill/underline/color/size)
                const cellOverlay = tinted ? "#dbeafe" : (cfmt?.fill || null);   // NEW-1 — the cell's own fill over the row colour; ONE value, read by the cell AND by its pinned layer stack
                // Predecessor editor shows a live hint below the input — let it escape the clipped 24px cell.
                const predEditing = c.k==="predecessors" && edit?.taskId===task.id && edit?.col===c.k;
                return (
                  <div key={c.k} data-col-key={c.k} data-cell-active={active ? "1" : undefined} data-cell-in-range={(selected && hasRange) ? "1" : undefined} className={pinCls(c.k) || undefined} style={{
                    width:dispW[c.k], flexShrink:0,
                    overflow: (c.k==="health" || predEditing) ? "visible" : "hidden",
                    height:ROW_H,
                    position:"relative",
                    zIndex: predEditing ? 30 : (active ? 2 : "auto"),
                    backgroundColor: cellOverlay || "transparent",   // longhand only: a `background` shorthand here resets the pinned cells' own layers on a re-render
                    fontWeight: cfmt?.bold ? 700 : undefined,
                    fontStyle: cfmt?.italic ? "italic" : undefined,
                    textDecoration: cfmt?.underline ? "underline" : undefined,
                    color: cfmt?.color || undefined,
                    borderRight: tinted ? GRID_LINE_RANGE : GRID_LINE,
                    borderBottom: tinted ? GRID_LINE_RANGE : GRID_LINE,
                    boxShadow: [selShadow(ri, ci, selected, active), (isFocused && c === orderedCols[0]) ? "inset 2px 0 0 0 var(--blue)" : "none"].filter(x => x !== "none").join(",") || "none",
                    userSelect: isDraggingCells.current ? "none" : "auto",
                    cursor: (c.k === "id" && !review && idPressMovesRows(selRange, ri, allCols.length)) ? "grab" : "default",   // the range-select drag's own `cell` cursor is pinned by the gesture (cellDragPin), never read from a ref here; an ID cell inside a multi-row selection is a pick-up handle (B2445008 ×2)
                    // NEW-1 — a pinned cell paints its own opaque look (row colour, then any range / cell fill on top)
                    ...(pinStyle(c.k, [rowBg, cellOverlay], 5) || {})
                  }}
                    onMouseDown={e => cellMouseDown(e, task, ri, c, ci)}
                    onClick={() => { if (skipColClickRef.current) { skipColClickRef.current = false; return; } setSelectedColIdx(ci); }}
                    onContextMenu={e => cellContextMenu(e, task, ri, c, ci)}
                    onDoubleClick={() => {
                      if (review) return;
                      const isParentDateLocked = task.hasChildren && (c.k==="start"||c.k==="end"||c.k==="duration"||c.t==="cost");
                      // Picker columns (health/status) have their own popover — text-edit on them
                      // would render the raw value (e.g. "yellow") in an input, which is meaningless
                      // to the user. Notes also handled separately via the notes modal.
                      const isPicker = c.k === "health" || c.k === "status";
                      if (c.e && c.t !== "notes" && !isPicker && !isParentDateLocked) setEdit({taskId: task.id, col: c.k});
                    }}>
                    {c.k === "id" && !review && (
                      <span className="rowgrip" data-row-drag-handle={task.id} title="Drag to move"
                        onMouseDown={e => { e.stopPropagation(); e.preventDefault(); startRowDrag(e, task.id, { onClick: () => { setSelectedId(task.id); setSelectedColIdx(0); setSelRange({r1:ri, r2:ri, c1:0, c2:allCols.length-1}); } }); }}
                        style={{position:"absolute", left:0, top:0, bottom:0, width:8, display:"flex", alignItems:"center", justifyContent:"center", zIndex:3}}>
                        <i className="ti ti-grip-vertical" style={{fontSize:10, color:"var(--mut)"}} />
                      </span>
                    )}
                    <Cell task={task} col={{...c, w:dispW[c.k]}} colMasterIdxs={colMasterIdxs} edit={edit} setEdit={setEdit} commit={commit} commitAndAdvance={commitAndAdvance} applyCommit={applyCommit}
                      proj={proj} succMap={succMap} getTaskName={getTaskName} data={data}
                      setNotesCtx={setNotesCtx} projId={proj?.id} updateTask={updateTask}
                      editStartChar={edit?.taskId===task.id && edit?.col===c.k ? editStartChar : null}
                      contacts={data?.settings?.contacts||[]}
                      formulaCell={c.t === "formula" ? (formulaValues[task.id]?.[c.k]) : undefined}
                      addContact={(nc)=>setData(d=>({...d, settings:{...d.settings, contacts:[...(d.settings?.contacts||[]), {id:Date.now(), ...nc}]}}))}
                      isExpandedParent={isExpandedParent} dispHealth={displayHealth} setSelectedColIdx={setSelectedColIdx} expandAnchorRef={expandAnchorRef} />

                  </div>
                );
              })}
              {stripCol && <div data-grid-strip
                onMouseDown={e => cellMouseDown(e, task, ri, stripCol, stripCi)}
                onContextMenu={e => cellContextMenu(e, task, ri, stripCol, stripCi)}
                style={{flex:"1 1 0", minWidth:0, height:ROW_H, position:"relative", cursor:"default",
                  background: (stripJoinsRange && inRange(ri, stripCi)) ? "#dbeafe" : "transparent",
                  borderBottom: (stripJoinsRange && inRange(ri, stripCi)) ? GRID_LINE_RANGE : GRID_LINE,
                  boxShadow: stripShadow(ri)}} />}
            </div>
          );
        })}
        {Array.from({length: Math.max(0, Math.min(endIdx, totalRows) - Math.max(startIdx, tasks.length))}, (_, i) => {
          const ri = Math.max(startIdx, tasks.length) + i;
          const isNewTaskFocused = ri === tasks.length && selectedId === "__NEW_TASK__";
          return (
            <div key={`_e${ri}`} className="drow"
              data-new-task-row={ri===tasks.length ? (isNewTaskFocused ? "sel" : "1") : undefined}
              onClick={ri===tasks.length ? ()=>addTask() : undefined}
              style={{top:ri*ROW_H, height:ROW_H,
                borderLeft: isNewTaskFocused ? "2px solid var(--blue)" : "2px solid transparent",
                background: isNewTaskFocused ? "#eff6ff" : (ri%2?"#f8fafc":"var(--bg)"),
                cursor:ri===tasks.length?"pointer":"default"}}>
              {orderedCols.map(c => (
                <div key={c.k} data-row-line className={pinCls(c.k) || undefined} style={{width:dispW[c.k],flexShrink:0,borderRight:GRID_LINE,borderBottom:GRID_LINE,height:ROW_H,position:"relative",
                  ...(pinStyle(c.k, [isNewTaskFocused ? "#eff6ff" : (ri%2?"#f8fafc":"var(--bg)")], 5) || {}),
                  ...(ri===tasks.length && c.k==="name" ? {
                    color: isNewTaskFocused ? "var(--blue)" : "var(--mut)",
                    fontSize:11,display:"flex",alignItems:"center",paddingLeft:8,
                    fontWeight: isNewTaskFocused ? 600 : undefined
                  } : {})}}>
                  {ri===tasks.length && c.k==="name" ? "+ New task" : ""}
                </div>
              ))}
              <div data-grid-strip style={{flex:"1 1 0", minWidth:0, height:ROW_H, position:"relative", borderBottom:GRID_LINE}} />
            </div>
          );
        })}
      </div>
    </div>
    {/* B1397536 — corrects B1350080's dedicated 28px gutter, which the owner saw live as a dead
        extra column running the table's full height. The Columns (⋯) button now sits directly ON
        the header row, pinned to the pane's true right edge, and deliberately OVERLAPS the tail
        of whatever column is last — no reserved width, no column shrink, no per-row spacer. It's
        a sibling of the scrolling region (not inside it), so it never scrolls away with the
        columns even though it now shares their row instead of owning a strip of its own. */}
    <button ref={colBtnRef} onClick={()=>{setColMenuOpen(o=>!o);setHdrCtx(null);}}
      title="Show, hide, add or reorder table columns"
      style={{position:"absolute",top:4,right:14+pinRW,zIndex:30,display:"flex",alignItems:"center",justifyContent:"center",width:22,height:22,padding:0,
        border:"none",borderRadius:6,cursor:"pointer",
        color: colMenuOpen ? "var(--amber)" : "var(--mut)",
        background: colMenuOpen ? "#eef2ff" : "transparent"}}
      onMouseEnter={e=>{if(!colMenuOpen){e.currentTarget.style.color="var(--amber)";e.currentTarget.style.background="var(--surf)";}}}
      onMouseLeave={e=>{if(!colMenuOpen){e.currentTarget.style.color="var(--mut)";e.currentTarget.style.background="transparent";}}}>
      <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14}><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
    </button>
    {colMenuOpen && <GridColumnsChooser cols={allCols} visible={colOrder} hidden={hiddenCols}
      anchor={colBtnRef.current?.getBoundingClientRect()}
      onToggle={(k,on)=>on?showCol(k):hideCol(k)}
      onMove={(k,dir)=>{const next=[...colOrder];const i=next.indexOf(k);const j=i+dir;if(i<0||j<0||j>=next.length)return;next.splice(i,1);next.splice(j,0,k);persistVisible(next);}}
      onReset={resetCols} onClose={()=>setColMenuOpen(false)}
      onAddFormula={()=>{setColMenuOpen(false);setFormulaEditor({mode:"add",label:"",formula:""});}}
      onEditFormula={(k)=>{const fc=formulaCols.find(f=>f.k===k);if(fc){setColMenuOpen(false);setFormulaEditor({mode:"edit",colKey:k,label:fc.l||"",formula:fc.formula||""});}}}
      onDeleteFormula={(k)=>deleteFormulaCol(k)} />}
    {hdrCtx && <GridHeaderMenu ctx={hdrCtx} hidden={hiddenCols} isFormula={colByK[hdrCtx.colKey]?.t==="formula"}
      onHide={()=>{hideCol(hdrCtx.colKey);setHdrCtx(null);}}
      onInsert={(k)=>{showCol(k,hdrCtx.colKey);setHdrCtx(null);}}
      onColumns={()=>{setHdrCtx(null);setColMenuOpen(true);}}
      onAddFormula={()=>{setHdrCtx(null);setFormulaEditor({mode:"add",label:"",formula:""});}}
      onEditFormula={()=>{const fc=formulaCols.find(f=>f.k===hdrCtx.colKey);if(fc)setFormulaEditor({mode:"edit",colKey:fc.k,label:fc.l||"",formula:fc.formula||""});setHdrCtx(null);}}
      onDeleteFormula={()=>{deleteFormulaCol(hdrCtx.colKey);setHdrCtx(null);}}
      onClose={()=>setHdrCtx(null)} />}
    {formulaEditor && <FormulaColumnEditor
      mode={formulaEditor.mode} initLabel={formulaEditor.label} initFormula={formulaEditor.formula}
      columnNames={formulaColumnNames(proj)} existingLabels={formulaCols.filter(f=>f.k!==formulaEditor.colKey).map(f=>f.l)}
      preview={previewFormula}
      onSave={({label,formula})=>{saveFormulaCol({colKey:formulaEditor.colKey,label,formula});setFormulaEditor(null);}}
      onDelete={formulaEditor.mode==="edit"?()=>{deleteFormulaCol(formulaEditor.colKey);setFormulaEditor(null);}:null}
      onClose={()=>setFormulaEditor(null)} />}
    </div>
  );
}

// ── HealthPicker ──────────────────────────────────────────
// One picker open at a time — any picker dispatches this when opening; others listen and close
const PICKER_EVENT = "planar-picker-open";

function HealthPicker({value, onChange}) {
  const [open, setOpen]   = useState(false);
  const [hiIdx, setHiIdx] = useState(-1);
  const dotRef  = useRef(null);
  const menuRef = useRef(null);
  const idRef   = useRef(`hp-${Math.random()}`);
  // NEW-1 — follows its cell while open; closes (no commit) when the cell leaves the visible grid.
  const pos = useAnchoredPopover(open, dotRef, r => ({top: r.bottom + 4, left: r.left + r.width / 2 - 10}), () => setOpen(false));

  useEffect(() => {
    const onOther = e => { if (e.detail !== idRef.current) setOpen(false); };
    document.addEventListener(PICKER_EVENT, onOther);
    return () => document.removeEventListener(PICKER_EVENT, onOther);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Don't pre-highlight the current value — standard dropdown behavior shows all options
    // equally on open; user navigates via hover/arrow keys. The trigger itself still shows
    // the current value with its halo so they know what's currently set.
    setHiIdx(-1);

    const handleDown = e => {
      if (!dotRef.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [open]);

  // Capture-phase keydown — fires BEFORE the global row-navigation handler
  useEffect(() => {
    if (!open) return;
    const handleKey = e => {
      // B1341729 — Tab is an EXIT gesture like any other, so it CLOSES the menu (it used to fall
      // through the guard below, leaving an open popover floating over the grid while focus moved
      // on). It chooses nothing: a menu's highlight is in-progress, never finished, so leaving
      // without pressing Enter correctly keeps the value that was already there.
      if (e.key === "Tab") { setOpen(false); return; }
      if (!["ArrowDown","ArrowUp","Enter","Escape"," "].includes(e.key)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") { setHiIdx(i => Math.min(HK.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp")   { setHiIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" || e.key === " ") {
        // Read the highlighted index via the updater (its closure is stale), but defer the
        // commit + close so they don't run setState during render.
        setHiIdx(i => { const sel = HK[i] ?? value; setTimeout(() => { onChange(sel); setOpen(false); }, 0); return i; });
      }
    };
    document.addEventListener("keydown", handleKey, true); // capture = true
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, value, onChange]);

  const handleDotClick = e => {
    // Match StatusPicker exactly: open on click with stopPropagation. Earlier this was
    // on mousedown to "win the race" against the cell re-render, but jsdom tests showed
    // that race wasn't real — the perceived two-click was a small hit area, now fixed
    // by the full-cell trigger below. onClick is more reliable in practice.
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent(PICKER_EVENT, {detail: idRef.current}));
    setOpen(o => !o);
  };

  const h = HEALTH[value] || HEALTH.gray;
  const dot = h.dot;
  const DotSpan = ({hk, size=13, active=false, noPointer=false}) => {
    const hh = HEALTH[hk] || HEALTH.gray;
    return <span style={{width:size,height:size,borderRadius:"50%",background:hh.dot,border:hh.border,
      display:"block",flexShrink:0,boxShadow:active?`0 0 0 2px ${hh.dot === "#ffffff" ? "#d1d5db" : hh.dot}44`:"none",
      transition:"box-shadow .15s",pointerEvents:noPointer?"none":"auto"}} />;
  };
  return (
    <>
      <span ref={dotRef} onClick={handleDotClick}
        data-health-dot="true"
        title="Set status"
        onMouseEnter={e=>{ if(!open) e.currentTarget.style.background="rgba(0,0,0,0.045)"; }}
        onMouseLeave={e=>{ if(!open) e.currentTarget.style.background="transparent"; }}
        style={{display:"flex",alignItems:"center",justifyContent:"center",position:"relative",
          width:"100%",height:"100%",cursor:"pointer",
          background:open?"rgba(9,105,218,0.07)":"transparent",
          transition:"background .12s"}}>
        {/* Inner pill + dot are pointer-events:none so a click on the dot itself bubbles
            cleanly to the outer trigger's onClick instead of getting absorbed by inner
            spans — fixes the "click on the colored circle does nothing" hit-target issue. */}
        <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",position:"relative",
          width:24,height:18,borderRadius:4,pointerEvents:"none",
          outline:open?`1.5px solid ${dot === "#ffffff" ? "#d1d5db" : dot}`:"1.5px solid transparent",
          outlineOffset:0,transition:"outline-color .1s"}}>
          <DotSpan hk={value} active={open} noPointer />
        </span>
      </span>
      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} {...MENU_STOPS_GRID}
          style={{position:"fixed",top:pos.top,left:pos.left,
            background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:6,
            padding:"5px 4px",display:"flex",flexDirection:"column",gap:2,
            zIndex:9999,boxShadow:"0 4px 14px rgba(0,0,0,0.15)"}}>
          {/* ⛔ RULES-DECIDE (2026-08-25, owner correction): the "Automatic" entry that used to sit
              here is RETIRED along with healthOverride — there is no lock left to hand back, so a
              control that only ever cleared one would do nothing. */}
          {HK.map((hk, i) => (
            <span key={hk} title={HEALTH[hk].label}
              onMouseEnter={()=>setHiIdx(i)}
              onMouseLeave={()=>setHiIdx(-1)}
              onClick={e => { e.stopPropagation(); onChange(hk); setOpen(false); }}
              style={{display:"flex",alignItems:"center",justifyContent:"center",
                width:28,height:20,borderRadius:4,cursor:"pointer",
                outline: i===hiIdx ? `1.5px solid ${HEALTH[hk].dot === "#ffffff" ? "#d1d5db" : HEALTH[hk].dot}` : "1.5px solid transparent",
                outlineOffset:0,transition:"outline-color .1s",
                background: i===hiIdx ? "var(--surf)" : "transparent"}}>
              {/* active driven by hiIdx only — no auto-halo on the current value so the menu
                  doesn't "drop down to the current color." pointer-events:none on the dot so
                  direct clicks land on this <span>'s onClick rather than getting absorbed. */}
              <DotSpan hk={hk} active={i===hiIdx} noPointer />
            </span>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── StatusPicker ──────────────────────────────────────────
function StatusPicker({value, onChange}) {
  const [open, setOpen]   = useState(false);
  const [hiIdx, setHiIdx] = useState(-1);
  const ref     = useRef(null);
  const menuRef = useRef(null);
  const idRef   = useRef(`sp-${Math.random()}`);
  // NEW-1 — follows its cell while open; closes (no commit) when the cell leaves the visible grid.
  const pos = useAnchoredPopover(open, ref, r => ({top: r.bottom + 4, left: r.left}), () => setOpen(false));

  useEffect(() => {
    const onOther = e => { if (e.detail !== idRef.current) setOpen(false); };
    document.addEventListener(PICKER_EVENT, onOther);
    return () => document.removeEventListener(PICKER_EVENT, onOther);
  }, []);

  useEffect(() => {
    if (!open) return;
    setHiIdx(-1); // standard dropdown: no current-value preselection
    const handleDown = e => {
      if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [open]);

  // Capture-phase keydown — fires before the global row-navigation handler
  useEffect(() => {
    if (!open) return;
    const handleKey = e => {
      // B1341729 — Tab is an EXIT gesture like any other, so it CLOSES the menu (it used to fall
      // through the guard below, leaving an open popover floating over the grid while focus moved
      // on). It chooses nothing: a menu's highlight is in-progress, never finished, so leaving
      // without pressing Enter correctly keeps the value that was already there.
      if (e.key === "Tab") { setOpen(false); return; }
      if (!["ArrowDown","ArrowUp","Enter","Escape"," "].includes(e.key)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") { setHiIdx(i => Math.min(HK.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp")   { setHiIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" || e.key === " ") {
        setHiIdx(i => { const sel = HK[i] ?? value; setTimeout(() => { onChange(sel); setOpen(false); }, 0); return i; });
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, value, onChange]);

  const handleClick = e => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent(PICKER_EVENT, {detail: idRef.current}));
    setOpen(o => !o);
  };

  const Pill = ({hk, showDot=false}) => {
    const hh = HEALTH[hk] || HEALTH.gray;
    const dotColor = hh.dot === "#ffffff" ? "#d1d5db" : hh.dot;
    return (
      <span style={{background:hh.bar,border:`1px solid ${dotColor}88`,borderRadius:4,
        padding:"2px 9px",fontSize:11,display:"inline-flex",alignItems:"center",gap:5,
        color:HDARK[hk],fontFamily:"'Inter',system-ui,sans-serif",whiteSpace:"nowrap",userSelect:"none"}}>
        {showDot && <span style={{width:7,height:7,borderRadius:2,flexShrink:0,
          background: hh.dot === "#ffffff" ? "#fff" : dotColor,
          border: hh.dot === "#ffffff" ? "1.5px solid #d1d5db" : "none"}} />}
        {hh.label}
      </span>
    );
  };

  return (
    <>
      <span ref={ref} onClick={handleClick}
        style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4,color:"var(--mut)",fontSize:11,fontFamily:"'Inter',system-ui,sans-serif"}}>
        {(HEALTH[value]||HEALTH.gray).label}
      </span>
      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} {...MENU_STOPS_GRID}
          style={{position:"fixed",top:pos.top,left:pos.left,background:"var(--bg)",
            border:"1px solid var(--bd2)",borderRadius:6,padding:"5px 6px",
            display:"flex",flexDirection:"column",gap:3,
            zIndex:9999,boxShadow:"0 4px 14px rgba(0,0,0,0.15)"}}>
          {/* ⛔ RULES-DECIDE (2026-08-25, owner correction): "Automatic" retired along with
              healthOverride — see HealthPicker's own note above. */}
          {HK.map((hk, i) => (
            <span key={hk} onMouseEnter={()=>setHiIdx(i)} onMouseLeave={()=>setHiIdx(-1)}
              onClick={e=>{e.stopPropagation();onChange(hk);setOpen(false);}}
              style={{cursor:"pointer",padding:"1px 0",borderRadius:3,display:"block",
                background: i===hiIdx ? "var(--surf)" : "transparent"}}>
              <Pill hk={hk} showDot={true} />
            </span>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── Predecessor inline editor ────────────────────────────
// Plain-English readback of a typed predecessor string, spelling out working vs calendar days
// so the "cd" suffix is discoverable + confirmable while typing. Pure — leans on parsePreds.
const predLagPlainEnglish = raw => {
  const preds = parsePreds(raw);
  if (!preds.length) return "";
  return preds.map(p => {
    const base = { FS:`After task ${p.id} finishes`, SS:`When task ${p.id} starts`,
                   FF:`As task ${p.id} finishes`,   SF:`Until task ${p.id} starts` }[p.type]
                 || `After task ${p.id} finishes`;
    if (!p.lag) return base;
    const n = Math.abs(p.lag), unit = p.lagUnit === "calendar" ? "calendar" : "working";
    const days = `${n} ${unit} day${n === 1 ? "" : "s"}`;
    return p.lag > 0 ? `${base}, then ${days}` : `${base}, ${days} earlier`;
  }).join(" · ");
};
// Uncontrolled input (never fights the caret) + a sibling live hint. The parent cell drops its
// overflow:hidden while this cell is being edited so the hint can escape the 24px row.
function PredEditor({ seedVal, taskId, colKey, commit, commitAndAdvance, setEdit, tabStep }) {
  const [hint, setHint] = useState(() => predLagPlainEnglish(seedVal));
  return (
    <React.Fragment>
      <input {...NO_AUTOFILL} autoFocus className="ei"
        placeholder="e.g. 2, 3SS, 4FF+2d  ·  add 'cd' for calendar days"
        defaultValue={seedVal}
        onChange={e => setHint(predLagPlainEnglish(e.target.value))}
        onBlur={e => commit(taskId, colKey, e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter")  { e.nativeEvent.stopImmediatePropagation(); commitAndAdvance(taskId, colKey, e.target.value); return; }
          if (e.key === "Escape") { e.nativeEvent.stopImmediatePropagation(); setEdit(null); return; }
          if (e.key === "Tab")    { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); commit(taskId, colKey, e.target.value); tabStep(e.shiftKey); }
        }} />
      <div style={{ position:"absolute", top:"100%", left:0, marginTop:2, zIndex:40,
        minWidth:210, maxWidth:340, background:"var(--surf,#f6f8fa)",
        border:"1px solid var(--bd2,#d0d7de)", borderRadius:6, boxShadow:"0 4px 14px rgba(0,0,0,0.14)",
        padding:"6px 9px", fontSize:11, lineHeight:1.45, textAlign:"left", whiteSpace:"normal",
        pointerEvents:"none", fontFamily:"'Inter', system-ui, sans-serif" }}>
        {hint ? <div style={{ fontWeight:600, color:"var(--txt,#1f2328)", marginBottom:3 }}>{hint}</div> : null}
        <div style={{ color:"var(--mut,#57606a)" }}>'d' = working days · 'cd' = calendar days (weekends counted)</div>
      </div>
    </React.Fragment>
  );
}

// ── Cell ─────────────────────────────────────────────────
// ── NEW-1 (2026-11-06) — TASK ICONS: the slot between the chevron and the task name, the picker, the collapsed-phase summary.
// The library, search, 2-icon rule and phase summary are PURE and live in /sequence/taskIcons.js (window.PlanyrTaskIcons);
// this is only the drawing. Emoji draw as bundled Twemoji SVGs (a missing file falls back to the plain character, never a
// broken image); "c:<name>" ids draw as inline SVG. Icons are their own task field — editing a name never touches them.
// Amended 2026-11-09 (B2671196 ×2): the slot takes ZERO width when a task has no icons (the chevron sits right against the name) and
// exactly its icons' width when it has some — the old fixed width that kept names aligned across 0/1/2 icons is intentionally gone.
// taskIconsW is the one place that width is computed, so the name EDITOR's text starts where the displayed name starts.
const TASK_ICON_PX = 16, TASK_ICON_GAP = 2, TASK_ICON_PAD = 2, TASK_ICON_AFTER = 2;
const taskIconsW = n => n > 0 ? n * TASK_ICON_PX + (n - 1) * TASK_ICON_GAP + 2 * TASK_ICON_PAD + TASK_ICON_AFTER : 0;
let TASK_ICON_UID = 0;   // per-rendered-instance counter: a drawing with a <mask> (the Permit) needs an id no other icon on the page shares
function TaskIconGlyph({id, size = 16, faded = false}) {
  const [failed, setFailed] = React.useState(false);
  const uidRef = React.useRef(null);
  if (uidRef.current === null) uidRef.current = "ti" + (++TASK_ICON_UID);
  const TI = window.PlanyrTaskIcons;
  const st = {display:"block", flexShrink:0, opacity: faded ? 0.55 : 1};
  if (TI.isCustom(id)) {
    const nm = TI.customName(id);
    if (!TI.CUSTOM_SVG[nm]) return null;   // an id from a newer client: keep it stored, draw nothing
    return <svg viewBox={TI.customViewBox(nm)} width={size} height={size} aria-hidden="true" style={st} dangerouslySetInnerHTML={{__html: TI.customMarkup(nm, uidRef.current)}} />;
  }
  if (TI.isBuiltinSvg(id)) {   // built-in line art ("svg:<name>"): currentColor, so it follows the text colour of the row / picker it sits in
    const b = TI.BUILTIN_SVG[TI.svgName(id)];
    if (!b) return null;   // an id from a newer client: keep it stored, draw nothing
    return <svg viewBox={b.viewBox} width={size} height={size} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={st} dangerouslySetInnerHTML={{__html: b.markup}} />;
  }
  if (failed) return <span aria-hidden="true" style={{...st, width:size, height:size, fontSize:Math.round(size*0.8), lineHeight:size+"px", textAlign:"center"}}>{id}</span>;
  return <img src={"/sequence/vendor/twemoji/" + TI.twemojiFile(id) + ".svg"} width={size} height={size} alt="" draggable={false} style={st} onError={() => setFailed(true)} />;
}

function TaskIconPicker({anchorRef, icons, onChange, onClose}) {
  const TI = window.PlanyrTaskIcons;
  const [q, setQ] = React.useState("");
  const rootRef = React.useRef(null);
  const PW = 336;
  const pos = useAnchoredPopover(true, anchorRef, r => {
    const room = window.innerHeight - r.bottom - 12, above = room < 300 && r.top > room;
    const maxH = Math.max(220, Math.min(420, (above ? r.top : room) - 8));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PW - 8));
    return above ? {left, bottom: window.innerHeight - r.top + 4, maxH} : {left, top: r.bottom + 4, maxH};
  }, onClose);
  React.useEffect(() => {
    const down = e => { const el = rootRef.current, a = anchorRef.current; if (el && el.contains(e.target)) return; if (a && a.contains(e.target)) return; onClose(); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);
  const groups = TI.searchTaskIcons(q);
  const shown = TI.normalizeTaskIcons(icons);
  if (!pos) return null;
  return ReactDOM.createPortal(
    <div ref={rootRef} data-task-icon-picker {...MENU_STOPS_GRID} role="dialog" aria-label="Choose task icons"
      onKeyDown={e => { e.nativeEvent.stopImmediatePropagation(); e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      onDoubleClick={e => e.stopPropagation()}
      style={{position:"fixed", left:pos.left, top:pos.top, bottom:pos.bottom, width:PW, maxHeight:pos.maxH, zIndex:100000, display:"flex", flexDirection:"column",
        background:"var(--bg)", border:"1px solid var(--bd2)", borderRadius:9, boxShadow:"0 8px 28px rgba(0,0,0,.18)", fontFamily:"'Inter',system-ui,sans-serif", overflow:"hidden"}}>
      <div style={{padding:"8px 8px 6px", borderBottom:"1px solid var(--bd)", flexShrink:0}}>
        <input {...NO_AUTOFILL} autoFocus type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search icons — tia, sewer, roof, tilt…"
          aria-label="Search icons"
          style={{width:"100%", height:28, border:"1px solid var(--bd2)", borderRadius:6, padding:"0 8px", fontSize:12, fontFamily:"inherit", outline:"none", color:"var(--txt)", background:"var(--bg)"}}
          onFocus={e => { e.target.style.borderColor = "var(--blue)"; }} onBlur={e => { e.target.style.borderColor = ""; }} />
      </div>
      <div style={{overflowY:"auto", padding:"4px 8px 8px", flex:"1 1 auto", minHeight:0}}>
        {groups.length === 0 && <div style={{padding:"18px 6px", fontSize:12, color:"var(--mut)", textAlign:"center"}}>Nothing matches “{q.trim()}”. Try another word.</div>}
        {groups.map(g => (
          <div key={g.key} data-icon-group={g.key}>
            <div style={{fontSize:9.5, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--mut)", padding:"8px 2px 3px"}}>{g.title}</div>
            <div style={{display:"flex", flexWrap:"wrap", gap:2}}>
              {g.items.map(it => {
                const on = shown.includes(it.id), lab = TI.iconLabel(it.id, it.label);
                return (
                  <button key={it.id} type="button" className="ti-pick-cell" data-icon-id={it.id} aria-pressed={on} aria-label={lab} title={lab}
                    onClick={() => onChange(TI.toggleTaskIcon(shown, it.id))}>
                    <TaskIconGlyph id={it.id} size={22} />
                    {TI.isDrawn(it.id) && <span aria-hidden="true" style={{position:"absolute", top:3, right:3, width:5, height:5, borderRadius:"50%", background:"#16a34a"}} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{display:"flex", alignItems:"center", gap:6, padding:"7px 8px", borderTop:"1px solid var(--bd)", flexShrink:0, background:"var(--surf)"}}>
        <a href="/sequence/vendor/twemoji/CREDITS.txt" target="_blank" rel="noopener" title="Emoji art: Twemoji, CC-BY 4.0" style={{fontSize:10, color:"var(--mut)", textDecoration:"none", marginRight:"auto"}}>Emoji art: Twemoji (CC-BY 4.0)</a>
        <button type="button" data-icon-clear disabled={shown.length === 0} onClick={() => onChange([])}
          style={{height:24, padding:"0 10px", fontSize:11.5, fontFamily:"inherit", borderRadius:5, border:"1px solid var(--bd2)", background:"var(--bg)", color:shown.length ? "var(--txt)" : "var(--mut)", cursor:shown.length ? "pointer" : "default"}}>Clear</button>
        <button type="button" data-icon-done onClick={onClose}
          style={{height:24, padding:"0 12px", fontSize:11.5, fontWeight:600, fontFamily:"inherit", borderRadius:5, border:"1px solid var(--blue)", background:"var(--blue)", color:"#fff", cursor:"pointer"}}>Done</button>
      </div>
    </div>,
    document.body
  );
}

function TaskIconSlot({task, updateTask}) {
  const TI = window.PlanyrTaskIcons;
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const icons = TI.normalizeTaskIcons(task.icons);
  const close = React.useCallback(() => setOpen(false), []);
  // No icons → NOTHING is rendered (no hover glyph, no reserved width). The first icon is added from the right-click menu.
  if (icons.length === 0) return null;
  return (
    <>
      <span ref={ref} data-task-icon-slot={icons.length} role="button" aria-label="Task icons" aria-haspopup="dialog" aria-expanded={open}
        onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{height:ROW_H - 2, flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"flex-start", gap:TASK_ICON_GAP, padding:"0 " + TASK_ICON_PAD + "px", marginRight:TASK_ICON_AFTER, borderRadius:3, cursor:"pointer", userSelect:"none"}}>
        {icons.map(id => <span key={id} data-task-icon={id} title={TI.iconLabel(id)} style={{display:"inline-flex"}}><TaskIconGlyph id={id} size={TASK_ICON_PX} /></span>)}
      </span>
      {open && <TaskIconPicker anchorRef={ref} icons={icons} onChange={next => updateTask(task.id, {icons: next})} onClose={close} />}
    </>
  );
}

// The picker opened from the row's RIGHT-CLICK menu ("Set icon…" / "Change icon…"). It lives at the app level (the menu does) and
// anchors to that task's NAME in the grid; if the name column is hidden or the row is not in the grid (Gantt-only), it anchors to
// the point that was right-clicked. It reads the LIVE task, so every pick is written through and shows on the row at once.
function TaskIconPickerHost({ctx, tasks, updateTask, onClose}) {
  const anchorRef = React.useRef(null);
  const pointRef = React.useRef(null);
  if (!anchorRef.current) {
    let el = document.querySelector('[data-task-row="' + ctx.taskId + '"] [data-task-name]');
    if (el) { const s = anchorSurroundings(el); if (anchorHidden(el.getBoundingClientRect(), s.area, s.occluders)) el = null; }   // name scrolled out of sight → use the click point instead of closing at once
    if (!el) {
      el = document.createElement("span");   // a 1px marker where the right-click happened (name column hidden, or a Gantt-only view)
      el.style.cssText = "position:fixed;width:1px;height:1px;pointer-events:none;visibility:hidden;left:" + ctx.x + "px;top:" + ctx.y + "px";
      document.body.appendChild(el); pointRef.current = el;
    }
    anchorRef.current = el;
  }
  React.useEffect(() => () => { if (pointRef.current) pointRef.current.remove(); }, []);
  const task = (tasks || []).find(t => t.id === ctx.taskId);
  if (!task) return null;
  return <TaskIconPicker anchorRef={anchorRef} icons={window.PlanyrTaskIcons.normalizeTaskIcons(task.icons)} onChange={next => updateTask(ctx.taskId, {icons: next}, ctx.projId)} onClose={onClose} />;
}

// Collapsed summary/phase row: the distinct icons of every leaf task inside it (faded). No task count (owner, 2026-11-09). Nothing when expanded.
function PhaseIconSummary({tasks, taskId}) {
  const sum = window.PlanyrTaskIcons.phaseIconSummary(tasks, taskId);
  if (!sum.icons.length) return null;   // amended 2026-11-09: there is no "N tasks" count any more — no icons inside, nothing shown
  const MAXI = 8, vis = sum.icons.slice(0, MAXI), more = sum.icons.length - vis.length;
  return (
    <span data-phase-icons style={{display:"inline-flex", alignItems:"center", gap:3, marginLeft:8, flex:"0 1000 auto", minWidth:0, overflow:"hidden", whiteSpace:"nowrap"}}>   {/* shrinks ~1000x faster than the name: in a narrow column the summary yields first, the phase name keeps its room */}
      {vis.map(id => <TaskIconGlyph key={id} id={id} size={13} faded />)}
      {more > 0 && <span style={{fontSize:10, color:"var(--mut)"}}>+{more}</span>}
    </span>
  );
}

function Cell({task, col, colMasterIdxs, edit, setEdit, commit, commitAndAdvance, applyCommit, proj, succMap, getTaskName, setNotesCtx, projId, updateTask, editStartChar, isExpandedParent, dispHealth, setSelectedColIdx, contacts, addContact, formulaCell, expandAnchorRef, data}) {
  // B212 — Tab/Shift+Tab while editing advance only through VISIBLE columns (display order),
  // skipping hidden ones, via the shared stepVisibleColIdx helper.
  const tabStep = back => setSelectedColIdx(i => stepVisibleColIdx(colMasterIdxs, i, back ? -1 : +1));
  // NEW-2 — this cell's own per-column format entry (bold/italic/fill/underline/color/size).
  // `s` is fresh per (task, col) — folding cf.size/color/underline in here reaches every case
  // below that spreads {...s} without itself re-asserting a fixed fontSize/color (the same
  // partial reach bold/italic already have via the wrapper's cascade — cases with their own
  // semantic color, like a conflict date's red, keep it, same as they already keep their own
  // fontWeight over a cellFmt.bold cascade).
  const cf = task.cellFmt?.[col.k];
  const s = {fontSize:cf?.size || 12,padding:"0 8px",height:ROW_H,display:"flex",alignItems:"center",overflow:"hidden",whiteSpace:"nowrap",
    color: cf?.color || undefined, textDecoration: cf?.underline ? "underline" : undefined};
  const mono = {fontFamily:"'Inter',system-ui,sans-serif"};

  // B583 — Formula column: a derived, read-only display value computed by GridView
  // (after the date cascade). Errors render in red with the Excel-style code + tooltip;
  // a healthy value renders right-aligned like the other computed/number columns.
  if (col.t === "formula") {
    const fc = formulaCell;
    if (!fc || fc.display === "" || fc.display == null) return <span style={{...s, justifyContent:"flex-end", color:"var(--mut)"}} />;
    if (!fc.ok) return (
      <span style={{...s, ...mono, justifyContent:"flex-end", color:"var(--danger, #d83a3a)", fontSize:11, fontWeight:600}}
        title={(fc.detail ? fc.error + " — " + fc.detail : fc.error)}>{fc.display}</span>
    );
    return <span style={{...s, ...mono, justifyContent:"flex-end", color:"var(--txt)", fontSize:11}} title={fc.display}>{fc.display}</span>;
  }

  // Picker columns (health/status) are NEVER text-editable — their popover IS the editor.
  // If something accidentally sets edit to a picker column, ignore it (don't render as input).
  const isPickerCol = col.k === "health" || col.k === "status";
  const isEdit = !isPickerCol && edit?.taskId === task.id && edit?.col === col.k;

  if (isEdit) {
    // Parent tasks: start/end/duration are computed from children — never editable
    const isParentDateLocked = task.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost");
    if (!isParentDateLocked) {
      // Date columns: plain text input accepting "5/7", "5/7/26", "5/7/2026"
      if (col.t==="date") {
        const seedVal = editStartChar != null ? editStartChar : toShortDate(task[col.k]);
        return (
          <input {...NO_AUTOFILL} autoFocus className="ei" placeholder="M/D or M/D/YY"
            style={{textAlign:"center", fontSize:11}}
            defaultValue={seedVal}
            onBlur={e => commit(task.id, col.k, e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  { e.nativeEvent.stopImmediatePropagation(); commitAndAdvance(task.id, col.k, e.target.value); return; }
              if (e.key === "Escape") { e.nativeEvent.stopImmediatePropagation(); setEdit(null); return; }
              if (e.key === "Tab")    { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); commit(task.id, col.k, e.target.value); tabStep(e.shiftKey); }
            }} />
        );
      }
      // Task name: match the level-based font size, weight, and indentation of the
      // display text so the row doesn't visibly resize when you start editing.
      // Also honor per-task bold/italic overrides so editing matches the displayed style.
      if (col.k === "name") {
        const ls = [{fontSize:13,fontWeight:600},{fontSize:12,fontWeight:500},{fontSize:11.5,fontWeight:400},{fontSize:11,fontWeight:400}][Math.min(task.level,3)];
        const seedVal = editStartChar != null ? editStartChar : (task.name ?? "");
        const cf = task.cellFmt?.name;
        const fw = (task.bold || cf?.bold) ? 700 : ls.fontWeight;
        const fs = (task.italic || cf?.italic) ? "italic" : "normal";
        // NEW-2 — size/color/underline follow the SAME cell-overrides-row-overrides-default
        // precedence as fw/fs above, just for a value instead of a boolean (?? rather than ||).
        const fSize = cf?.size ?? task.fontSize ?? ls.fontSize;
        const fColor = cf?.color ?? task.textColor ?? undefined;
        const fUnderline = (task.underline || cf?.underline) ? "underline" : "none";
        return (
          <input {...NO_AUTOFILL} autoFocus className="ei"
            defaultValue={seedVal}
            style={{fontSize:fSize, fontWeight:fw, fontStyle:fs, color:fColor, textDecoration:fUnderline, paddingLeft:20+taskIconsW(window.PlanyrTaskIcons.normalizeTaskIcons(task.icons).length)+task.level*14}}
            onFocus={e => { if (editStartChar == null) e.target.select(); }}
            onBlur={e => commit(task.id, "name", e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  { e.nativeEvent.stopImmediatePropagation(); commitAndAdvance(task.id, "name", e.target.value); return; }
              if (e.key === "Escape") { e.nativeEvent.stopImmediatePropagation(); setEdit(null); return; }
              if (e.key === "Tab")    { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); commit(task.id, "name", e.target.value); tabStep(e.shiftKey); }
            }} />
        );
      }
      // Owner / responsible party: an ORDERED LIST of contacts (NEW-1) — chips + autocomplete.
      // Typing a first character NEVER replaces the existing owners any more (that was the single-
      // value picker's "select-all, then type replaces" behavior) — it seeds the NEXT chip instead,
      // so a quick keystroke can only ADD an owner, never silently wipe the others.
      if (col.k === "responsibleParty") {
        return (
          <ContactPicker
            variant="grid"
            owners={ownerListOf(task)}
            seedText={editStartChar != null ? editStartChar : ''}
            contacts={contacts || []}
            onOwnersChange={(names, newContacts) => {
              (newContacts || []).forEach(nc => addContact && addContact(nc));
              applyCommit(task.id, "responsibleParty", names);
            }}
            onClose={() => setEdit(null)}
          />
        );
      }
      // For all other editable inputs, seed with the typed char if available, else existing value
      const seedVal = editStartChar != null
        ? editStartChar
        : col.k==="predecessors" ? fmtPreds(task.predecessors) : (task[col.k] ?? "");
      // Predecessors get a richer editor: a live plain-English readback + the calendar-days ('cd') hint.
      if (col.k === "predecessors") {
        return <PredEditor seedVal={seedVal} taskId={task.id} colKey={col.k}
          commit={commit} commitAndAdvance={commitAndAdvance} setEdit={setEdit} tabStep={tabStep} />;
      }
      return (
        <input {...NO_AUTOFILL} autoFocus className="ei"
          placeholder={col.k==="duration" ? "e.g. 10d, 3w, 30cd, 2mo" : undefined}
          style={(col.k==="duration"||col.k==="percentComplete") ? {textAlign:"center", fontSize:11} : undefined}
          defaultValue={seedVal}
          onBlur={e => commit(task.id, col.k, e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter")  { e.nativeEvent.stopImmediatePropagation(); commitAndAdvance(task.id, col.k, e.target.value); return; }
            if (e.key === "Escape") { e.nativeEvent.stopImmediatePropagation(); setEdit(null); return; }
            if (e.key === "Tab")    { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); commit(task.id, col.k, e.target.value); tabStep(e.shiftKey); }
          }} />
      );
    }
    // isParentDateLocked: fall through to display rendering below
  }

  switch(col.k) {
    case "id": {
      // Compact format-override indicators next to the ID: small color square left of
      // the number when a fill is set, tiny B/I letter badges right of it when those
      // toggles are on. Lets users scan the ID column to spot formatted rows without
      // opening the right-click menu.
      const hasCellFmt = !!(task.cellFmt && Object.keys(task.cellFmt).length);
      const hasFmt = !!task.rowColor || !!task.bold || !!task.italic || !!task.underline || !!task.textColor || !!task.fontSize || hasCellFmt;
      const fmtSummary = hasFmt
        ? `Formatted: ${[task.rowColor && "fill color", task.bold && "bold", task.italic && "italic", task.underline && "underline", task.textColor && "text color", task.fontSize && "text size", hasCellFmt && "cell formats"].filter(Boolean).join(", ")}`
        : "Click to select row";
      return (
        // B<NEW> — paddingLeft was 4 while the drag grip (a separate absolutely-positioned
        // overlay, left:0 width:8) sits on top of it, so the number's own left edge landed
        // UNDER the grip icon with no visible gap ("crab icon" — voice transcription for
        // GRAB icon — "butted right up against the number", owner report 2026-08-25). 12
        // clears the grip's 8px strip plus a small breathing gap, without touching the
        // grip's hit area (still exactly 8px, pointer-events always on — CHROME-NEVER-
        // EATS-A-PRESS: widening the grip itself previously broke row-range select).
        <span title={fmtSummary} style={{...s,...mono,color:"var(--mut)",fontSize:11,cursor:"pointer",userSelect:"none",display:"flex",alignItems:"center",gap:3,paddingLeft:12}}>
          {task.rowColor && <span style={{width:7,height:7,borderRadius:1.5,background:task.rowColor,border:"1px solid rgba(0,0,0,0.2)",flexShrink:0}} />}
          <span>{task.id}</span>
          {task.bold && <span style={{fontSize:8.5,fontWeight:800,color:"#4f46e5",lineHeight:1,fontFamily:"'Inter',system-ui,sans-serif"}}>B</span>}
          {task.italic && <span style={{fontSize:8.5,fontWeight:700,fontStyle:"italic",color:"#4f46e5",lineHeight:1,fontFamily:"'Inter',system-ui,sans-serif"}}>I</span>}
          {task.underline && <span style={{fontSize:8.5,fontWeight:700,textDecoration:"underline",color:"#4f46e5",lineHeight:1,fontFamily:"'Inter',system-ui,sans-serif"}}>U</span>}
        </span>
      );
    }
    case "name": return (
      <span style={{...s,paddingLeft:4+task.level*14,gap:0,flex:1,minWidth:0}}>
        {proj?.tasks.some(t=>t.parentId===task.id) ? (
          <span
            className="ti-chev"
            onClick={e=>{
              e.stopPropagation();
              const opening = !task.isExpanded;
              // B463922 (×2) — tell GridView's scroll-anchor effect this row is the one whose
              // reveal the click was FOR, so a stale selection elsewhere can't outrank it and
              // throw the new children off screen. Expand only: a collapse never needs this.
              if (opening && expandAnchorRef) expandAnchorRef.current = task.id;
              updateTask(task.id,{isExpanded:opening});
            }}
            /* B463922 — the click already refused to move the selection (stopPropagation), but the
               grid selects on MOUSEDOWN, so folding a group still stole the selection from the cell
               you were editing: every keystroke after it went to the group row instead, and the
               keep-the-selection-visible effect started chasing a row nobody was editing. Stop the
               press too, so showing/hiding a group is a view action and nothing more. */
            onMouseDown={e=>e.stopPropagation()}
            onDoubleClick={e=>e.stopPropagation()}
            title={task.isExpanded?"Collapse":"Expand"}
            /* NEW-1 (task icons) — a real Tabler chevron (right when collapsed, down when open) replaces the text-glyph
               triangle in a bordered box. Same element, title and handlers, so every harness that finds the toggle still does. */
            style={{
              cursor:"pointer",flexShrink:0,
              width:16,height:ROW_H - 2,
              display:"inline-flex",alignItems:"center",justifyContent:"center",
              borderRadius:3,
              color:task.isExpanded?"var(--blue)":"var(--mut)",
              userSelect:"none",
            }}
          >
            <i className={"ti " + (task.isExpanded ? "ti-chevron-down" : "ti-chevron-right")} aria-hidden="true" style={{fontSize:14,lineHeight:1}} />
          </span>
        ) : (
          <span style={{width:16,flexShrink:0,display:"inline-block"}} />
        )}
        <TaskIconSlot task={task} updateTask={updateTask} />
        {(() => { const ls=[{fontSize:13,fontWeight:600},{fontSize:12,fontWeight:500},{fontSize:11.5,fontWeight:400},{fontSize:11,fontWeight:400}][Math.min(task.level,3)]; const cf = task.cellFmt?.name; const isEmpty = !task.name; const fw = (task.bold || cf?.bold) ? 700 : ls.fontWeight; const fs = (task.italic || cf?.italic || isEmpty) ? "italic" : "normal";
          // NEW-2 — same cell-overrides-row-overrides-default precedence as fw/fs, for a value not a boolean.
          const fSize = cf?.size ?? task.fontSize ?? ls.fontSize; const fColor = cf?.color ?? task.textColor; const fUnderline = (task.underline || cf?.underline) ? "underline" : "none"; return (
          <span title={task.name || undefined} data-task-name style={{overflow:"hidden",textOverflow:"ellipsis",color:isEmpty?"var(--mut)":(fColor||"#1f2328"),fontStyle:fs,fontSize:fSize,fontWeight:fw,textDecoration:fUnderline,minWidth:0}}>
            {task.name || "New task"}
          </span>
        ); })()}
        {!task.isExpanded && task.hasChildren && <PhaseIconSummary tasks={proj?.tasks} taskId={task.id} />}
        {rowCanFocus(task) && (
          <span
            data-focus-chip={task.focused ? "on" : "off"}
            onClick={e=>{ e.stopPropagation(); updateTask(task.id, {focused: !task.focused}); }}
            onDoubleClick={e=>e.stopPropagation()}
            title={focusChipTitle(task)}
            style={{
              marginLeft:"auto", flexShrink:0, cursor:"pointer", userSelect:"none",
              display:"inline-flex", alignItems:"center", gap:5,
              fontSize:10, fontWeight:600, lineHeight:1, whiteSpace:"nowrap",
              color:"var(--mut)",
              padding:"2px 7px", borderRadius:10,
              background: task.focused ? "var(--surf)" : "transparent",
              border: `1px solid ${task.focused ? "var(--bd2)" : "transparent"}`,
              transition:"background .12s,border-color .12s",
            }}
            onMouseEnter={e=>{ e.currentTarget.style.background="var(--surf)"; e.currentTarget.style.borderColor="var(--bd2)"; }}
            onMouseLeave={e=>{ if(!task.focused){ e.currentTarget.style.background="transparent"; e.currentTarget.style.borderColor="transparent"; } }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.65,flexShrink:0}}>
              <path d="M3 5h18M6 12h12M10 19h4"/>
            </svg>
            {/* Status breakdown only when focused (children hidden); when expanded you can already see statuses */}
            {task.focused && task.hideableDone > 0 && (
              <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"#16a34a",flexShrink:0}} />
                {task.hideableDone}
              </span>
            )}
            {task.focused && task.hideablePaused > 0 && (
              <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"#9ca3af",flexShrink:0}} />
                {task.hideablePaused}
              </span>
            )}
            {task.focused && task.hideableUpcoming > 0 && (
              <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"var(--bg)",border:"1.5px solid #d1d5db",flexShrink:0}} />
                {task.hideableUpcoming}
              </span>
            )}
          </span>
        )}
      </span>
    );
    case "start": case "end": {
      const rawDate = task[col.k];
      if (!rawDate) return <span style={{...s,...mono,justifyContent:"center",color:"var(--mut)",fontSize:11}} />;
      const [y,m,d] = rawDate.split('-');
      const dateStr = String(+m).padStart(2,'0')+'/'+String(+d).padStart(2,'0')+'/'+y.slice(2);
      // Start pin (existing) + Finish lock (B616) — one padlock, identical icon + interaction.
      const isStart = col.k === "start";
      const isPinned = !task.hasChildren && (isStart ? startIsPinned(task) : task.pinnedEnd);
      // B443250 — the start cell carries its own conflict: a pinned start EARLIER than the predecessor
      // chain allows. The pin still wins (that is the contract); this makes the override visible instead
      // of silently resolved, reusing B616's locked-finish treatment exactly.
      const isConflict = !task.hasChildren && (isStart ? !!task.startConflict : !!task.finishConflict);
      const unpin = e => {
        e.stopPropagation();
        if (isStart) updateTask(task.id, unpinStartPatch(task), projId);   // B2642096 ×2 — clears the stepped pin as well
        else         updateTask(task.id, {pinnedEnd: false, durValue: taskDurValue(task), durUnit: taskDurUnit(task)}, projId);  // unlock → finish flows from start + duration
      };
      return (
        <span style={{...s,...mono,justifyContent:"center",color: isConflict ? "var(--danger,#d83a3a)" : task.hasChildren ? "#94a3b8" : "var(--mut)",fontSize:11,fontWeight: isConflict ? 700 : undefined}}
          title={task.hasChildren ? "Computed from subtasks"
            : isConflict ? (isStart
                ? "Pinned start is earlier than the predecessors allow — the pin is winning and the dependency is being overridden. Unpin to follow the predecessors, or change the dependency."
                : "Locked finish can't be met — the predecessor chain needs more time. Move the finish, shorten the duration, or change the dependency.")
            : isPinned ? (isStart ? "Start pinned — click the lock to let the predecessor drive this date" : "Finish locked (hard constraint) — click the lock to let it flow from start + duration")
            : undefined}>
          {isConflict && <span style={{marginRight:2,flexShrink:0,fontSize:11}}>⚠</span>}
          {isPinned && (
            <span
              title={isStart ? "Pinned start — click to unpin and let the predecessor drive this date" : "Locked finish — click to unlock and let it flow from start + duration"}
              onClick={unpin}
              style={{display:"inline-flex",alignItems:"center",marginRight:3,cursor:"pointer",color: isConflict ? "var(--danger,#d83a3a)" : "var(--amber)",opacity:0.85,flexShrink:0}}
              onMouseEnter={e=>e.currentTarget.style.opacity="1"}
              onMouseLeave={e=>e.currentTarget.style.opacity="0.85"}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
          )}
          {isStart && !task.hasChildren && task.meetingBound && MEETING_BODY_INDEX[task.meetingBodyId] && (() => {
            // B816 — the civic mark: a meeting calendar fixes this date (distinct from the padlock — a person
            // fixed this date). Three states track severity; clicking/hovering explains the row in plain English.
            const info = meetingBoundInfo(task);
            const color = info?.state === "danger" ? "var(--danger,#d83a3a)" : info?.state === "warning" ? "var(--warn-text,#b45309)" : "var(--mut)";
            const b = info?.body || {};
            // NEW-2 (B<PENDING>, 2026-09-23) — "how was this date reached": names the driving predecessor,
            // the lag it adds, the earliest-ready date that produces, and any of the body's own meetings
            // that were too early to make (skipped because their agenda deadline fell before that earliest
            // date) — READ-ONLY narration via meetingBindingTrace, never a second engine.
            const trace = meetingBindingTrace(task, id => (proj?.tasks || []).find(t => t.id === id), b);
            const traceLines = [];
            if (trace && trace.driver) {
              const { dep, predTask } = trace.driver;
              const typeWord = {FS:"finish-to-start", SS:"start-to-start", FF:"finish-to-finish", SF:"start-to-finish"}[(dep.type||"FS").toUpperCase()] || "finish-to-start";
              const lagPhrase = dep.lag ? `, plus a ${Math.abs(dep.lag)}-${dep.lagUnit === "calendar" ? "calendar" : "working"}-day lag (${typeWord}),` : ` (${typeWord}, no lag)`;
              traceLines.push(`Driven by "${predTask.name || "task " + predTask.id}", finishing ${fmtD(predTask.end || predTask.start)}${lagPhrase} ready no earlier than ${fmtD(trace.earliestDate)}.`);
              if (trace.skipped.length) traceLines.push(`Skipped ${trace.skipped.length === 1 ? "meeting" : "meetings"}: ${trace.skipped.map(sk => `${fmtD(sk.meetingDate)} (agenda closed ${fmtD(sk.deadline)}, before the packet was ready)`).join("; ")}.`);
            }
            const dupFlag = meetingDoubleLagFlag(task, b);
            const title = [
              `${b.name || "Meeting body"}${b.jurisdiction ? " · " + b.jurisdiction : ""}`,
              `Meets ${cadenceSummary(b)}; ${agendaLeadSummary(b)}.`,
              task.start ? `Hearing ${fmtD(task.start)} — file the agenda by ${fmtD(info?.deadline)}${b.cutoffTime ? " (" + b.cutoffTime + ")" : ""}.` : "No eligible meeting yet — waiting on a predecessor date.",
              ...traceLines,
              dupFlag ? "⚠ Possible double count: this task's own link lag and this calendar's filing lead look like they're counting the same wait — see the ⚠×2 mark on this row." : null,
              info?.state === "danger" ? (task.meetingDateOffCalendar
                ? "⚠ INFEASIBLE: this date isn't a scheduled meeting day for this body at all — roll to the next meeting or unpin."
                : "⚠ INFEASIBLE: this date is pinned but the agenda has already closed — roll to the next meeting or unpin.") :
                info?.state === "warning" ? `⚠ Only ${info.floatBD} working day(s) of float before the agenda deadline.` :
                "This is a meeting-calendar date: it can't be freely typed, has no duration, and slips by a full cycle if the deadline is missed.",
              b.verifiedOn ? `Calendar verified ${fmtD(b.verifiedOn)}.` : "Calendar is rule-derived (unverified).",
            ].filter(Boolean).join("\n");
            return (<>
              <span title={title} style={{display:"inline-flex",alignItems:"center",marginRight:3,color,flexShrink:0,cursor:"help"}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M4 10h16"/><path d="M12 3 3 8h18L12 3Z"/>
                </svg>
              </span>
              {dupFlag && (() => {
                // NEW-2 — the one-click fix: drops ONLY the flagged predecessor edge's lag (keeps the
                // edge + the binding), reversible with Ctrl+Z like any other edit, and never fires on
                // its own — it's a plain click handler on a visible, clearly-labelled mark.
                const fixTitle = `⚠ Possible double count: the ${dupFlag.lagN}-${dupFlag.unit}-day link lag and "${b.name || "this calendar"}"'s own ${dupFlag.leadN}-${dupFlag.unit}-day filing lead may both be counting the same wait, pushing this task out an extra meeting cycle.\nClick to drop the duplicate lag (keeps the predecessor link and the meeting binding). Undo with Ctrl+Z.`;
                return (
                  <span title={fixTitle}
                    onClick={e => { e.stopPropagation(); const patch = dropDuplicateLagPatch(task, dupFlag); if (patch) updateTask(task.id, {predecessors: patch}, projId); }}
                    style={{display:"inline-flex",alignItems:"center",marginRight:3,color:"var(--warn-text,#b45309)",flexShrink:0,cursor:"pointer"}}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z"/>
                    </svg>
                  </span>
                );
              })()}
            </>);
          })()}
          {isStart && !task.hasChildren && task.meetingBound && !MEETING_BODY_INDEX[task.meetingBodyId] && (() => {
            // B864 — the binding points at a meeting calendar that no longer exists (a lost meeting body).
            // The normal civic mark above renders only when the body IS present, so without this the broken
            // binding is INVISIBLE. Surface it LOUDLY: a danger-toned calendar with an alert dot; its date is
            // held at the last known value (cascade soft-pins it) but won't update until the calendar returns.
            const title = [
              "⚠ Bound to a meeting calendar that no longer exists" + (task.meetingBodyId ? ` (id ${task.meetingBodyId})` : "") + ".",
              "Its date is held at the last known value but won't update on its own — this usually means the calendar was lost when another browser tab saved over it.",
              "Fix: re-create or re-select the calendar in Settings → Meeting Calendars, or unbind this task (right-click → Meeting binding).",
            ].join("\n");
            return (
              <span title={title} aria-label="Bound to a missing meeting calendar" style={{position:"relative",display:"inline-flex",alignItems:"center",marginRight:3,color:"var(--danger,#d83a3a)",flexShrink:0,cursor:"help"}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M4 10h16"/><path d="M12 3 3 8h18L12 3Z"/>
                </svg>
                <span aria-hidden style={{position:"absolute",top:-2,right:-2,width:5,height:5,borderRadius:"50%",background:"var(--danger,#d83a3a)"}}/>
              </span>
            );
          })()}
          {isStart && !task.hasChildren && task.deadlineForTaskId != null && (() => {
            // Deadline-row mark: this row always sits on its anchor's call/file-by date (one-way
            // derivation from the anchor's meeting binding — see the cascadeDates post-pass).
            const anchor = (proj?.tasks || []).find(a => a.id === task.deadlineForTaskId);
            const body = anchor ? MEETING_BODY_INDEX[anchor.meetingBodyId] : null;
            const color = task.deadlineInfeasible ? "var(--danger,#d83a3a)" : "var(--mut)";
            const title = [
              anchor ? `Deadline row for "${anchor.name || "task " + anchor.id}"${body && body.name ? ` (${body.name})` : ""}.` : "Deadline row — its anchor task is missing; the date no longer auto-updates.",
              body ? `Always sits ${agendaLeadSummary(body).replace("agenda due ", "")} the meeting — moves automatically when the meeting date moves.` : "",
              task.deadlineInfeasible ? "⚠ INFEASIBLE: this row's predecessors land AFTER the call/file-by date." : "",
            ].filter(Boolean).join("\n");
            return (
              <span title={title} style={{display:"inline-flex",alignItems:"center",marginRight:3,color,flexShrink:0,cursor:"help"}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 21V4"/><path d="M4 4h12l-2 4 2 4H4"/>
                </svg>
              </span>
            );
          })()}
          {dateStr}
        </span>
      );
    }
    case "meetingBody": {
      // B816 — bind a task to a meeting body (native select = robust, no popover positioning). Setting a
      // body makes the task a milestone that snaps to the body's cadence; clearing it returns it to normal.
      if (task.hasChildren) return <span style={{...s,justifyContent:"center",color:"#94a3b8"}} title="A summary/parent can't be meeting-bound">—</span>;
      if (task.deadlineForTaskId != null) {
        // A deadline row derives its date from its anchor's binding — not directly bindable here.
        const anchor = (proj?.tasks || []).find(a => a.id === task.deadlineForTaskId);
        const body = anchor ? MEETING_BODY_INDEX[anchor.meetingBodyId] : null;
        return <span style={{...s,fontSize:10,color:"var(--mut)"}} title={anchor ? `Deadline row for "${anchor.name || "task " + anchor.id}" — unlink via right-click to bind it directly` : "Deadline row (anchor missing)"}>deadline{body && body.name ? ` · ${body.name}` : ""}</span>;
      }
      const bodies = Array.isArray(proj?.meetingBodies) ? proj.meetingBodies : [];
      const cur = task.meetingBound ? (task.meetingBodyId || "") : "";
      const localMatch = cur ? bodies.find(b => b.id === cur) : null;
      // NEW-1 (B<PENDING>, 2026-09-23) — a task can be bound to a body that lives on a DIFFERENT
      // schedule (its id is globally unique — B816). The local `bodies` array can't name it, which
      // used to read as "set up…" (unbound) when this schedule has none of its own, or a blank
      // native <select> (no matching <option>) when it has some but not this one — either way an
      // actually-bound task read as unbound here. Resolve against every other schedule before
      // falling back to the old empty-state / select paths.
      const foreign = (task.meetingBound && cur && !localMatch) ? findMeetingBodyElsewhere(data, projId, cur) : null;
      if (task.meetingBound && !localMatch && foreign) {
        return (
          <span style={{...s,fontSize:10,color:"var(--txt)"}}
            title={`Bound to "${foreign.body.name || "Meeting body"}" from ${foreign.schedName} — right-click → Meeting binding to change it or copy it into this schedule.`}>
            {foreign.body.name || "Meeting body"} · {foreign.schedName}
          </span>
        );
      }
      if (task.meetingBound && !localMatch && !foreign) {
        return (
          <span style={{...s,fontSize:10,color:"var(--danger,#d83a3a)"}}
            title="Bound to a meeting calendar that no longer exists anywhere on the account — right-click → Meeting binding to unbind it.">
            ⚠ calendar missing
          </span>
        );
      }
      if (!bodies.length) return (
        <span style={{...s,justifyContent:"center",color:"var(--amber)",fontSize:10,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2}}
          title="Click to set up meeting calendars"
          onClick={e => { e.stopPropagation(); document.dispatchEvent(new CustomEvent("planar-open-settings", {detail:"meetings"})); }}>set up…</span>);
      return (
        <span style={{...s,padding:0}} data-picker-cell={`meeting-${task.id}`}>
          <select value={cur}
            onClick={e => e.stopPropagation()}
            onChange={e => { const v = e.target.value; updateTask(task.id, v ? {meetingBound:true, meetingBodyId:v} : {meetingBound:false, meetingBodyId:null, pinnedMeetingDate:undefined}, projId); }}
            style={{width:"100%",fontSize:11,border:"none",background:"transparent",color: cur ? "var(--txt)" : "var(--mut)",cursor:"pointer",padding:"0 4px"}}>
            <option value="">— none —</option>
            {bodies.map(b => <option key={b.id} value={b.id}>{b.name || "Meeting body"}</option>)}
          </select>
        </span>
      );
    }
    case "floatToDeadline": {
      // B817 — working days from today to the agenda deadline. Blank on unbound rows.
      const fb = task.hasChildren ? null : meetingFloatBD(task, fdLocal(new Date()));
      if (fb == null) return <span style={{...s,...mono,justifyContent:"center",color:"var(--mut)"}} />;
      const c = fb < 0 ? "var(--danger,#d83a3a)" : fb <= 2 ? "var(--warn-text,#b45309)" : "var(--mut)";
      return <span style={{...s,...mono,justifyContent:"center",color:c,fontWeight: fb <= 2 ? 700 : undefined}}
        title="Float to deadline — working days from today until the agenda-submittal deadline (≤2 reads at-risk)">{fb}d</span>;
    }
    case "costIfMissed": {
      // B817 — calendar days the hearing slips if this deadline is missed (gap to the next eligible meeting).
      const cost = task.hasChildren ? null : meetingCostDays(task, MEETING_BODY_INDEX[task.meetingBodyId]);
      if (cost == null) return <span style={{...s,...mono,justifyContent:"center",color:"var(--mut)"}} />;
      return <span style={{...s,...mono,justifyContent:"center",color:"var(--mut)"}}
        title="Cost if missed — calendar days the hearing slips to the next eligible meeting (one day of slip is routinely a month)">+{cost}d</span>;
    }
    case "duration":
      return <span style={{...s,...mono,color: task.hasChildren ? "#94a3b8" : "var(--mut)"}}
        title={task.hasChildren ? "Computed from subtasks" : (durTooltip(task) || undefined)}>
        {fmtTaskDuration(task, task.hasChildren)}
      </span>;
    case "predecessors": {
      const preds = normPreds(task.predecessors);
      // B443249 — name the predecessors that drive nothing. `predUnresolved` is set by the cascade, so the
      // mark can never disagree with the engine that ignored them.
      const un = new Set(task.predUnresolved || []);
      const unNames = [...un].map(id => { const n = getTaskName(id); return n ? `${id} · ${n}` : `${id} (no longer in this schedule)`; });
      return <DepCell items={preds} renderLabel={p => fmtPreds([p])} renderName={p => getTaskName(p.id)} s={s}
        flagged={p => un.has(p.id)}
        title={unNames.length
          // NEW-1 — a flagged id can ALSO be one of this task's own ancestors (its summary row), never
          // just "no dates" — a summary's dates come FROM its tasks, so listing it back as a predecessor
          // is a cycle the app can't resolve and ignores, same as a dateless predecessor.
          ? `This date is NOT driven by ${unNames.length === 1 ? "" : "any of "}${unNames.join("; ")} — ${unNames.length === 1 ? "it has" : "they have"} no dates, or it's this task's own summary row (a cycle). The date shown comes from the remaining predecessors only.`
          : predLagPlainEnglish(fmtPreds(preds))} />;
    }
    case "successors": {
      const ids = succMap[task.id] || [];
      return <DepCell items={ids} renderLabel={id => String(id)} renderName={id => getTaskName(id)} s={s} />;
    }
    case "health": {
      if (isExpandedParent) return <span style={{...s, justifyContent:"center", padding:0}} />;
      return (
        <span style={{...s, justifyContent:"center", padding:0}} data-picker-cell={`health-${task.id}`}>
          <HealthPicker value={dispHealth || task.health} onChange={hk => commit(task.id, "health", hk)} />
        </span>
      );
    }
    case "status":
      if (isExpandedParent) return <span style={{...s, padding:"0 4px"}} />;
      return (
        <span style={{...s,padding:"0 4px"}} data-picker-cell={`status-${task.id}`}>
          <StatusPicker value={dispHealth || task.health} onChange={hk => commit(task.id, "status", hk)} />
        </span>
      );
    case "percentComplete":
      return (
        <span style={{...s,gap:6}}>
          <span style={{width:50,height:3,background:"#e2e8f0",borderRadius:2,overflow:"hidden",flexShrink:0}}>
            <span style={{width:`${effectivePercentComplete(task, proj?.tasks)}%`,height:"100%",background:(HEALTH[task.health]||HEALTH.gray).dot,display:"block"}} />
          </span>
          <span style={{...mono,fontSize:11,color:"var(--mut)"}} title={task.hasChildren ? "Rolled up from this row's tasks" : undefined}>{effectivePercentComplete(task, proj?.tasks)}%</span>
        </span>
      );
    case "responsibleParty": {
      // Match the neighboring data cells (dates, duration, notes): muted, 11px. NEW-1 — the column
      // must not widen, so a multi-owner task shows "First +N"; the full list is on hover.
      const { label, title } = ownerDisplayParts(ownerListOf(task));
      return <span title={title || undefined} style={{...s,color:"var(--mut)",fontSize:11}}>{label}</span>;
    }
    case "cost":
    case "budget":
    case "actualCost": {
      // B212 — Cost / Budget / Actual all render the same way: parents show the rolled sum
      // of their leaf values, leaves show their own; an empty value renders blank (never an
      // error), so the columns are safe to switch on for a project that tracks no money yet.
      const rolledKey = col.k==="cost" ? "rolledCost" : col.k==="budget" ? "rolledBudget" : "rolledActual";
      const v = task[rolledKey] ?? (Number(task[col.k]) || 0);
      const rolled = task.hasChildren;
      const tip = rolled ? "Sum of subtask "+(col.k==="cost"?"costs":col.k==="budget"?"budgets":"actuals") : undefined;
      const st = {...s, ...mono, fontSize:11, justifyContent:"flex-end", color: rolled ? "#94a3b8" : "var(--mut)"};
      if (!v) return <span style={st} title={tip} />;
      return <span style={st} title={tip}>
        {"$" + Number(v).toLocaleString("en-US", {maximumFractionDigits:2})}
      </span>;
    }
    case "notes": {
      const _count = task.notes.length;
      const latest = task.notes[task.notes.length - 1];
      return (
        <span style={{...s,gap:6,cursor:"pointer"}} onClick={e=>{e.stopPropagation();setNotesCtx({taskId:task.id,projectId:projId});}}>

          {/* Full text fills the cell — CSS ellipsis trims at the real cell
              edge, so widening the column reveals more (no hard char limit) */}
          <span style={{color:"var(--mut)",fontSize:11,flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {latest ? (() => { const [,m,d] = latest.date.split('-'); return `${+m}/${+d} | ${latest.text}`; })() : "+"}
          </span>
        </span>
      );
    }
    default: return <span style={s}>{task[col.k]}</span>;
  }
}

// ── B393/B394/B395 — shared Gantt label + dependency-connector geometry ──────────────
// Pure helpers used by BOTH render paths — the on-screen <GanttView> and the print
// <buildGanttSVG> — so the two can never drift (the recurring "both paths" rule of
// B210/B211/B222). No React/DOM here.

// One uniform near-black ink for EVERY in-chart Gantt label (leaf bar, summary bracket,
// milestone), both paths. B320 eye-comfort: hierarchy comes from WEIGHT, never from
// fading text toward the background — so the B210 depth-navy is removed from label TEXT
// (it stays on the bracket GRAPHIC, which is not text). (B393)
const GANTT_INK = "#1a1a1a";

// Per-project label alignment (view-level, one choice per chart), persisted on the
// project record and riding the existing cloud-save path — same shape as the B212
// column config. Default "right" (name trailing just after the bar end). (B393)
const resolveLabelAlign = proj => {
  const a = proj && proj.labelAlign;
  return (a === "left" || a === "center" || a === "right") ? a : "right";
};
const writeLabelAlign = (setData, pid, align) => setData(d =>
  (d.projects && d.projects[pid]) ? {...d, projects: {...d.projects, [pid]: {...d.projects[pid], labelAlign: align}}} : d);

// Weight ramp: top-level summary boldest → child summaries medium → leaf/milestone
// regular. Color is uniform (GANTT_INK); only the weight steps. An explicit per-task
// bold lifts to at least 700. (B393)
const ganttNameWeight = (depth, kind, bold) => {
  const d = Math.min(depth || 0, 3);
  let w;
  if (kind === "summary") w = [800, 700, 600, 600][d];
  else if (kind === "milestone") w = 600;
  else w = 500;                       // leaf — regular
  return bold ? Math.max(w, 700) : w;
};

// Estimated label width (px) from char count × per-char width (~0.6·fontSize, a slight
// over-estimate so a flip/lift triggers before a real clip, never after). (B393)
const estLabelWidth = (s, fs) => Math.max(1, String(s == null ? "" : s).length) * fs * 0.6 + 4;

// THE placement helper. Given a bar/bracket/diamond's geometry, the label width and the chosen
// alignment, decide where the name goes. ONE RULE, no per-row variation, at every zoom:
//
//   ⛔ EVERY task name renders ABOVE its bar. Never centered on it, never inside it, never
//      beside it. `align` chooses only the HORIZONTAL ANCHOR — which end of the bar the caption
//      hangs off (left edge / midpoint / right edge) — never whether it sits on the bar.
//
// NEW-1 (owner, 2026-07-31, Grand Port → Schedule → Split view at 33%): *"on the bar in the Gantt
// chart, the task name is IN THE MIDDLE of the Gantt chart bar — which we have talked about before
// and you proposed — but I don't want it in the middle. I just want it ABOVE the bar just like
// every other bar."* This AMENDS B393, which shipped the per-kind ladder this replaces: Center =
// on a white contrast "plate" ON the bar when the name fit inside it, Left = "before" the bar and
// Right = "after" it (both inline, vertically centered on the bar), each falling back to a caption
// above only when it would run off the chart. B393's stated goal was "never painted on the bar
// FILL", and the plate was its answer to the earlier bug where centered names were covered by the
// bar — a legible backing rather than a move off the bar. It worked as designed; the owner simply
// does not want the name on the bar at all. So the plate is not made better here, it is removed,
// and the case it protected (a name wider than its bar) is handled by the same above-the-bar
// caption every other row already used.
//
// The B1188 invariant still holds and is now trivially true: a FIT failure may relocate or shorten
// a label but may NEVER blank it. There is no branch here that returns nothing — a caption too wide
// for the chart is slid horizontally by `clampX` until it fits, never dropped. (Collision-driven
// declutter, which MAY legitimately hide, does not exist on this surface: rows are disjoint
// vertical bands and each carries exactly one name, so a name can only ever contend with itself.)
//
//   kind     "leaf" | "summary" | "milestone" — kept for callers/telemetry; placement no longer
//            branches on it, which is precisely what makes the rule uniform
//   align    "left" | "center" | "right" — horizontal anchor only
//   bx,bw    bar left x + width (px); milestone passes its diamond center as bx, bw 0
//   rowTop   y of the row band's top
//   barTopY  top y of the bar/span/diamond — the caption is seated in the clear air above it
//   labelW   estimated label width
//   chartL/chartR  horizontal clip — a label must stay within (no horizontal scroll)
//   capHalf  caption half-height; rowH the row band's height (B629 confinement)
// Returns { x, y, anchor:"start"|"middle"|"end", mode:"above" }.
const placeGanttLabel = ({align, bx, bw, rowTop, barTopY, labelW,
                          chartL, chartR, capHalf = 6, rowH = null}) => {
  const barStart = bx, barEnd = bx + bw;
  // Keep a caption's vertical box inside its OWN row band [rowTop, rowTop+rowH] when the band is
  // known, so a cross-row label↔bar / label↔label overlap is geometrically impossible (rows are
  // disjoint vertical bands). A pure no-op when rowH is not supplied. (B629)
  const confineY = r => {
    if (rowH == null) return r;
    const y = Math.max(rowTop + capHalf, Math.min(rowTop + rowH - capHalf, r.y));
    return y === r.y ? r : {...r, y};
  };
  // The caption is vertically centered in the upper part of the row band: it sits just above the
  // bar/span (clear air) but never rides above the row top (which, for the topmost summary, is the
  // timeline header).
  const aboveY = Math.max(rowTop + capHalf,
                          Math.min(rowTop + capHalf + 1, (barTopY != null ? barTopY : rowTop) - 1 - capHalf));
  const clampX = (x, anchor) => {
    let x0 = anchor === "start" ? x : anchor === "middle" ? x - labelW / 2 : x - labelW;
    const x1 = x0 + labelW;
    if (x1 > chartR) x -= (x1 - chartR);          // shift left so the right edge fits
    x0 = anchor === "start" ? x : anchor === "middle" ? x - labelW / 2 : x - labelW;
    if (x0 < chartL) x += (chartL - x0);          // then shift right so the left edge fits
    return x;
  };
  const above = (x, anchor) => confineY({ x: clampX(x, anchor), y: aboveY, anchor, mode: "above" });

  // A milestone has bw 0, so all three anchors resolve against its diamond centre — the caption
  // still hangs left of / over / right of the glyph, and still above it.
  return align === "left"  ? above(barStart, "start")
       : align === "right" ? above(barEnd,   "end")
       :                     above(barStart + bw / 2, "middle");
};

// <gantt-geom> — NEW-1 (2026-11-04, owner: "why is the top level task have smaller than the lower
// level task labels on the gantt chart") — ONE SOURCE OF TRUTH for how big a task NAME is and where
// the GLYPH under it (leaf bar / summary bracket / milestone diamond) sits, on BOTH render paths.
//
// THE RULE: a name's size is its RANK (higher in the hierarchy = larger), at EVERY row height. The
// text is the priority; the GLYPH gives way. Before this, the name was derived from the bracket
// (fitCaptionFs(base, spanTop)), and the bracket gets THICKER with rank — so at a short row the top
// level had the least headroom and its name was shrunk hardest (level 0 ≈ 6.8 vs level 2 = 8.5 at
// the owner's row height 20). The rank was inverted by the very thing that was supposed to sit
// under it. Now: reserve the name's full ranked size FIRST, hand the glyph whatever is left, and
// compute that ONE geometry here so the renderer, the name placer AND the dependency-arrow anchors
// (glyphEdges, on both paths) all read the same numbers — an arrow can never attach to where a
// glyph used to be (B396/B402 class).
//
// Pure and self-contained ON PURPOSE: test/ganttLabelAbove.test.js evaluates this block straight
// out of the shipped file (the page is an in-browser Babel app with no bundler), so it can never
// drift from what the owner runs.
//
//   GANTT_CAPTION_LH   GanttName's CSS lineHeight; the caption box is LH × fs tall (was a 1.3 factor
//                      in fitCaptionFs — wider than the box it was protecting; 1.2 is the real box)
//   profile            "screen" | "print": base name sizes by level, the NOMINAL bracket ramp, the
//                      baselines each glyph is seated on, floors that keep a squeezed bracket legible
const GANTT_CAPTION_LH = 1.2;
const ganttCaptionNeed = fs => fs * GANTT_CAPTION_LH;          // headroom a caption of size fs needs above its glyph
const ganttCaptionHalf = fs => fs * GANTT_CAPTION_LH / 2;      // its half-height (placeGanttLabel's capHalf)
// Cap a caption's font size so the whole caption fits in the HEADROOM above its own glyph — now only
// the LAST-RESORT safety (the glyph helpers below already leave every ranked size its full room);
// floored so it stays legible.
const fitCaptionFs = (baseFs, headroom) => Math.max(6.5, Math.min(baseFs, (headroom + 1e-6) / GANTT_CAPTION_LH));   // +1e-6: float dust must not turn 9 into 8.999999
const GANTT_PROFILES = {
  screen: { names:[10,9.25,8.5,8], span:[6,5,4,4], leg:[0.16,0.12,0.09,0.07], minSpan:2, minLeg:2,
            leafFrac:0.25, mileHalf:3*Math.SQRT2, mileMin:2.5, leafBase:1, summaryBase:2, mileBase:1 },
  print:  { names:[9,8.5,8,7.5],   span:[4,3.5,3,3], leg:[0.14,0.10,0.08,0.06],  minSpan:2, minLeg:1.5,
            leafFrac:0.30, mileHalf:4,            mileMin:2.5, leafBase:2, summaryBase:2, mileBase:2 },
};
const ganttNameSize = (P, level) => P.names[Math.min(Math.max(level || 0, 0), 3)];
// Leaf bar: bottom-aligned; as tall as the profile asks unless that would crowd the LARGEST leaf
// name (level 0) — a bar's height never depends on depth, so it is bounded by the biggest name.
const ganttLeafGeom = (P, rowH) => {
  const bot = rowH - P.leafBase;
  const h = Math.max(3, Math.min(P.leafFrac * rowH, bot - ganttCaptionNeed(P.names[0])));
  return { top: bot - h, bot, h };
};
// Summary bracket (span + legs). Nominal thickness steps down with depth (darkest/thickest on top —
// B210). The room above it is whatever the level's FULL-SIZE name leaves; the binding level is 0
// (biggest name, thickest bracket), so ONE scale factor — taken from level 0 — shrinks every level
// together. That keeps the ramp strictly ordered (a level is never thinner than the level below it)
// while a short row makes the whole bracket family slimmer, never the text smaller.
const ganttSummaryGeom = (P, rowH, level) => {
  const d = Math.min(Math.max(level || 0, 0), 3), bot = rowH - P.summaryBase;
  const nom0 = P.span[0] + P.leg[0] * rowH;
  const s = Math.min(1, Math.max(0, bot - ganttCaptionNeed(P.names[0])) / nom0);
  // The legible floor only ever PROPS UP a thinned bracket — it never grows one past its own nominal size,
  // so at any row height where the bracket already fits, it is exactly the ramp above (today's look).
  const nomLeg = P.leg[d] * rowH;
  let span = Math.max(Math.min(P.minSpan, P.span[d]), P.span[d] * s), leg = Math.max(Math.min(P.minLeg, nomLeg), nomLeg * s);
  const room = Math.max(0, bot - ganttCaptionNeed(P.names[d]));        // the floors must never eat this level's own name
  if (span + leg > room) { const k = room / (span + leg); span *= k; leg *= k; }
  const top = bot - leg - span;
  return { span, leg, top, bot, mid: top + span / 2 };
};
// Milestone diamond, seated on its baseline; `half` is the distance from the centre to each vertex.
// It shrinks (never moves up) only as far as its own level's full-size name needs.
const ganttMilestoneGeom = (P, rowH, level) => {
  const d = Math.min(Math.max(level || 0, 0), 3), bot = rowH - P.mileBase;
  const half = Math.max(P.mileMin, Math.min(P.mileHalf, rowH * 0.25, (bot - ganttCaptionNeed(P.names[d])) / 2));
  const cy = bot - half;
  return { half, cy, top: cy - half, bot };
};
// </gantt-geom>

// Dependency connectors are CURVED (cubic bézier) — owner preference (B396, reverting the
// B395 orthogonal experiment). WHERE a curve attaches to each bar is decided by the ONE shared
// pure function below, so the on-screen GanttView and the print buildGanttSVG can't drift
// (they had: B396 bound BOTH endpoints to the bar's vertical CENTER — 9 o'clock — which stacked
// every outbound link on one point and dropped every arrowhead straight onto the start-date
// label at the bar's left-middle; B402 later fixed only the print path). Re-report of the
// B395→B396 anchor thread (owner: "raised at least twice before"), so NO new B# — it ships in
// the same PR as the B629 low-zoom label fix.
//
// Clock-face convention (owner spec): 3 o'clock = the right-middle of the bar. Rules:
//  • Exit DOWN  (successor sits lower): leave the source's BOTTOM edge, biased toward the
//    finish/connection end (≈4–6 o'clock). Multiple outbound links FAN across that arc instead
//    of stacking on one pixel.
//  • Exit UP    (successor sits higher): leave the source's TOP edge (≈12–2 o'clock), fanned.
//  • Entry: arrive at the target's TOP edge coming from above / BOTTOM edge coming from below,
//    at the target's connection (start/finish) x — NEVER 9 o'clock. The start-date label sits
//    just LEFT of the bar there, so a corner entry clears it; if a passed-in label right-edge
//    would still catch the arrowhead, the entry x is nudged clear of it (exclusion zone).
//
// Per-glyph geometry is passed in as {startX,endX,topY,botY,rowTop} (each render path seats bars
// differently in the row, so the EDGES are computed there; the ROUTING lives here). Returns
// {x1,y1,x2,y2,down} — exit (x1,y1) → entry (x2,y2).
// How far a dependency arrowhead reaches BACK from its tip (≈ its length). A near-horizontal
// entry points its head sideways, so the head sweeps ~this many px back toward the start-date
// label — the entry x must clear the label by at least this much, not just the head's half-width.
const ARROW_REACH = 7;
const depAnchors = ({ type, src, tgt, fanIndex = 0, fanCount = 1, tgtLabelRightX = null }) => {
  const down = tgt.rowTop >= src.rowTop;                       // successor lower on the chart (ties → down)
  const srcConnX = (type === "SS" || type === "SF") ? src.startX : src.endX;   // SS/SF leave the source START, FS/FF the FINISH
  const tgtConnX = (type === "FF" || type === "SF") ? tgt.endX   : tgt.startX; // FF/SF enter the target FINISH, FS/SS the START
  const y1 = down ? src.botY : src.topY;                       // exit edge in the travel direction
  const y2 = down ? tgt.topY : tgt.botY;                       // entry edge on the opposing side
  // Fan the exit x from the connection corner toward the bar centre so N links spread across the
  // allowed arc (bottom-right → bottom-centre for a down FS chain) rather than bundling. A
  // zero-width source (a milestone diamond, or an off-window bar clamped to one x) has no arc, so
  // fall back to a small fixed spread when there are multiple links, otherwise its spokes would
  // all leave one pixel.
  const srcCenterX = (src.startX + src.endX) / 2;
  const halfW = Math.abs(srcCenterX - srcConnX);
  const toCenter = Math.sign(srcCenterX - srcConnX) || -1;     // corner → centre; point-glyph → spread left
  const arc = halfW > 0.5 ? halfW : (fanCount > 1 ? 4 : 0);    // point glyph → small fixed fan
  const spread = Math.min(arc, 7 * Math.max(0, fanCount - 1));
  const step = fanCount > 1 ? spread / (fanCount - 1) : 0;
  const x1 = srcConnX + toCenter * step * fanIndex;
  // Entry x = the target connection corner; nudge right only enough to lift the whole arrowhead
  // off a start-date label that would otherwise sit under it, never past the bar's finish.
  let x2 = tgtConnX;
  if (tgtLabelRightX != null && x2 - ARROW_REACH < tgtLabelRightX + 2)
    x2 = Math.min(tgt.endX, tgtLabelRightX + ARROW_REACH + 2);
  return { x1, y1, x2, y2, down };
};

// ── GanttView ─────────────────────────────────────────────
function GanttView({tasks, updateTask, pxPerDay, onZoomChange, scrollRef, onScroll, rolledHealthMap, proj, onMouseEnter, selectedId, setSelectedId, settings, rowZoom=1}) {
  const [winTop, setWinTop] = useState(0);      // NEW-1 — first row of the CHUNK the scroll is in (not the raw scrollTop)
  const localRef = useRef(null);
  const ref = scrollRef || localRef;
  const ppd = pxPerDay || 22;
  const vh = (ref.current ? ref.current.clientHeight : window.innerHeight) - 80;

  // Predecessor lookup for the "a predecessor is late" health condition (matches GridView).
  const taskById = useMemo(() => { const m = {}; (proj?.tasks || tasks).forEach(t => m[t.id] = t); return m; }, [proj?.tasks, tasks]);

  const childParentIds = useMemo(() => {
    const allTasks = proj?.tasks || tasks;
    return new Set(allTasks.filter(t => t.parentId !== null).map(t => t.parentId));
  }, [proj?.tasks, tasks]);

  // Progress % per parent: green descendants / total descendants
  const _progressMap = useMemo(() => {
    const allTasks = proj?.tasks || tasks;
    if (!allTasks.length) return {};
    const getDesc = id => {
      const kids = allTasks.filter(t => t.parentId === id);
      return [...kids, ...kids.flatMap(k => getDesc(k.id))];
    };
    const map = {};
    childParentIds.forEach(pid => {
      const desc = getDesc(pid);
      if (!desc.length) return;
      map[pid] = Math.round(desc.filter(t => t.health === 'green').length / desc.length * 100);
    });
    return map;
  }, [proj?.tasks, tasks, childParentIds]);

  const {minD, totD} = useMemo(() => {
    // Fixed wide window: 5 years back → 15 years forward from today
    const windowStart = addD(NOW, -365 * 5);
    const windowEnd   = addD(NOW,  365 * 15);
    if (!tasks.length) return {minD: windowStart, totD: dif(windowStart, windowEnd)};
    // Blank tasks have start/end "" — exclude them or sorting puts "" first and addD("", -60) throws
    const starts = tasks.map(t=>t.start).filter(Boolean).slice().sort();
    const ends   = tasks.map(t=>t.end  ).filter(Boolean).slice().sort();
    if (!starts.length || !ends.length) return {minD: windowStart, totD: dif(windowStart, windowEnd)};
    // Use whichever is earlier/later: fixed window or actual task extent
    let mn = starts[0] < windowStart ? addD(starts[0], -60) : windowStart;
    let mx = ends[ends.length-1] > windowEnd ? addD(ends[ends.length-1], 60) : windowEnd;
    // Anchor the axis to TODAY. Expanding the window to the real task extent is right for a normal long
    // schedule, but a single far-past/far-future outlier (a 1900 baseline, a year-4000 typo, an import
    // artifact) must not drag the axis to it: that froze the tab (a multi-million-px canvas + tens of
    // thousands of axis cells) and — once the span was naively capped — pushed the real bars + today
    // line off the clamped axis. Cap expansion at NOW-30y .. NOW+50y (~80y, beyond any real schedule);
    // anything past that pins to the chart edge because xOf is clamped to [0, totalW] below.
    const hardBack = addD(NOW, -365 * 30), hardFwd = addD(NOW, 365 * 50);
    if (mn < hardBack) mn = hardBack;
    if (mx > hardFwd)  mx = hardFwd;
    return {minD: mn, totD: dif(mn, mx)};
  }, [tasks]);

  const totalW = totD * ppd;
  // Clamp positions to the axis window so an out-of-window outlier date pins to the chart edge instead
  // of drawing past the months/years header — keeps every bar + the today line aligned with the axis.
  const xOf = d => Math.max(0, Math.min(totalW, dif(minD, d) * ppd));
  const todayX = xOf(NOW);

  const months = useMemo(() => {
    const out = [];
    const endD = addD(minD, totD);
    let cur = new Date(pd(minD).getFullYear(), pd(minD).getMonth(), 1);
    while (fd(cur) <= endD) {
      const x0 = dif(minD, fd(cur)) * ppd;
      const nxt = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
      out.push({label: cur.toLocaleString("default",{month:"short"}), x0, w: dif(minD,fd(nxt))*ppd - x0});
      cur = nxt;
    }
    return out;
  }, [minD, totD, ppd]);

  const years = useMemo(() => {
    const out = [];
    const endD = addD(minD, totD);
    let cur = new Date(pd(minD).getFullYear(), 0, 1);
    while (fd(cur) <= endD) {
      const nxt = new Date(cur.getFullYear()+1, 0, 1);
      const x0 = dif(minD, fd(cur)) * ppd;
      const x1 = dif(minD, fd(nxt)) * ppd;
      out.push({label: String(cur.getFullYear()), x0, w: x1 - x0});
      cur = nxt;
    }
    return out;
  }, [minD, totD, ppd]);

  // Per-glyph bar EDGES within a row (leaf pill / summary bracket / milestone diamond), in the
  // on-screen frame — the shared depAnchors() routes connectors between these edges. Bars are
  // bottom-aligned in the row, matching the bar renderer below. (B396 re-report — replaces depYCenter:
  // curves now attach to a directional top/bottom EDGE per travel direction, not the 9-o'clock
  // center.)
  const glyphEdges = (t, idx) => {
    const rowTop = idx * ROW_H;
    const sX = xOf(t.start), eX = xOf(t.end);
    // NEW-1 — every glyph's geometry comes from the ONE shared helpers the bar renderer reads (ganttSummaryGeom /
    // ganttMilestoneGeom / ganttLeafGeom), so an arrow can never attach to where a glyph used to be.
    if (childParentIds.has(t.id)) {                                     // summary bracket (test before milestone — a duration-0 parent is a bracket, matches the bar renderer)
      const g = ganttSummaryGeom(GANTT_PROFILES.screen, ROW_H, t.level);
      return { startX:sX, endX:eX, topY:rowTop + g.top, botY:rowTop + g.bot, rowTop };
    }
    if (t.duration === 0) {                                             // milestone diamond — anchor to the VERTEX tips (the box is rotated 45°)
      const g = ganttMilestoneGeom(GANTT_PROFILES.screen, ROW_H, t.level);
      return { startX:sX, endX:sX, topY:rowTop + g.top, botY:rowTop + g.bot, rowTop };
    }
    const lg = ganttLeafGeom(GANTT_PROFILES.screen, ROW_H);             // leaf pill (bottom-aligned, min visible width 9)
    return { startX:sX, endX:sX + Math.max(9, eX - sX), topY:rowTop + lg.top, botY:rowTop + lg.bot, rowTop };
  };

  // Right edge x of a task's start-date bar-label (the "8/7" at 9 o'clock, just LEFT of the bar)
  // when start-date labels are shown — handed to depAnchors as the arrowhead exclusion zone so a
  // start-side entry can never overprint it. (B396 re-report)
  const startDateLabelRightX = t => {
    const bl = settings?.barLabels; if (!bl || !bl.left) return null;
    if (childParentIds.has(t.id)) return null;                 // summaries draw NO date labels on-screen — no exclusion (parity with the print path's isParent guard)
    if (!barLabelText(t, bl.left, bl.year)) return null;
    return xOf(t.start) - (t.duration === 0 ? 8 : 4);
  };

  const depLines = useMemo(() => {
    // Collect the raw, guard-passing links, then group by SOURCE so a bar's outbound links FAN
    // across the exit arc (the LOI bar's many links spread instead of bundling on one pixel).
    const idxOf = new Map(tasks.map((t, i) => [t.id, i]));   // one id→row lookup instead of O(n) indexOf per link
    const raw = [];
    tasks.forEach(task => normPreds(task.predecessors).forEach(p => {
      const pred = idxOf.has(p.id) ? tasks[idxOf.get(p.id)] : null; if(!pred) return;
      // A connector needs a real bar/diamond at BOTH ends. An unscheduled task has blank dates →
      // no x-position (xOf("") is NaN) → an arrow into empty space. Skip it (the blank row shows an
      // "Unscheduled" tag). Mirrors the bar renderer + the export connector guard (B386/B519).
      if (!pred.start || !pred.end || !task.start || !task.end || isNaN(pd(pred.start)) || isNaN(pd(pred.end)) || isNaN(pd(task.start)) || isNaN(pd(task.end))) return;
      raw.push({ pred, task, type: (p.type||"FS").toUpperCase() });
    }));
    const bySrc = new Map();
    raw.forEach(l => { const a = bySrc.get(l.pred.id) || []; a.push(l); bySrc.set(l.pred.id, a); });
    // Stable fan order: by the target's row, then type, so the spread is deterministic.
    bySrc.forEach(a => a.sort((x,y) => (idxOf.get(x.task.id) - idxOf.get(y.task.id)) || (x.type<y.type?-1:x.type>y.type?1:0)));
    return raw.map(l => {
      const group = bySrc.get(l.pred.id);
      const src = glyphEdges(l.pred, idxOf.get(l.pred.id));
      const tgt = glyphEdges(l.task, idxOf.get(l.task.id));
      const a = depAnchors({ type:l.type, src, tgt, fanIndex:group.indexOf(l), fanCount:group.length,
                             tgtLabelRightX:(l.type==="SS"||l.type==="FS") ? startDateLabelRightX(l.task) : null });
      // NEW-1/B1113712 — carry both endpoints' ROW INDEX (their position in this same `tasks`
      // array) alongside the geometry, so the render below can require both to fall in the same
      // [startIdx,endIdx) window the BARS use. `tasks` is already collapse-filtered (flatTasks
      // never walks into a collapsed parent's children), so pred/task here are always visible
      // rows and srcIdx/tgtIdx are always valid indices into it — a link into a hidden descendant
      // never reaches this point at all (the idxOf.has(p.id) guard above already dropped it,
      // matching buildGanttSVG's ix.has(pr.id) print-path guard — PDF-PARITY, B1113713).
      return { key:`${l.pred.id}-${l.task.id}-${l.type}`, x1:a.x1, y1:a.y1, x2:a.x2, y2:a.y2, down:a.down, type:l.type,
               srcIdx: idxOf.get(l.pred.id), tgtIdx: idxOf.get(l.task.id) };
    });
  // AMENDMENT to B1113712/B1113713 — ROW_H is a module-scope `let`, set from an effect keyed on
  // data.settings.rowHeight (App's own render, far above this component) that runs AFTER the
  // commit that reads it, not during it. So the FIRST paint of a project whose rowHeight differs
  // from the module's initial default (24) renders self-consistently at 24 (bars and this memo
  // agree, because both read ROW_H fresh in that same commit); the effect then mutates ROW_H in
  // place with no render of its own. glyphEdges bakes ROW_H into every x/y this memo returns, but
  // ROW_H was missing from this dependency list — so the NEXT render this memo doesn't otherwise
  // recompute for (a plain scroll: tasks/minD/ppd/childParentIds/settings all unchanged) re-renders
  // the bars fresh at the CURRENT ROW_H while this memo keeps serving geometry baked at the STALE
  // one. The drift is `rowIdx * (staleROW_H - currentROW_H)` px — small near the top, large enough
  // by the bottom of a long schedule to land an arrowhead past the last rendered row, which is
  // exactly the "arrow pointing to nothing" shape being re-reported after B1113712/B1113713 (those
  // fixed the INDEX-bounds class; this is a separate PIXEL-staleness class the index guard cannot
  // see, since srcIdx/tgtIdx are still perfectly valid — only the x/y baked alongside them is
  // wrong). Reproduced live and measured before this line existed: mount with rowHeight:20, wait
  // for the settings effect, then scroll — bar row tops correctly read 0/20/40/…, this memo's own
  // arrow y-coordinates stayed frozen at 0/24/48/… until something else it already depends on
  // changed. Fix: ROW_H joins the dependency list like any other value this computation reads.
  }, [tasks, minD, ppd, childParentIds, settings, ROW_H]);

  // ── In-chart name labels (B393) ──────────────────────────
  // Per-project alignment; the chart's horizontal clip is [0, totalW] (a label past it
  // would add horizontal scroll — the gotcha — so the helper flips/lifts instead).
  const labelAlign = resolveLabelAlign(proj);
  const chartL = 0, chartR = Math.max(totalW, 400);
  const NAME_SIZE = lvl => ganttNameSize(GANTT_PROFILES.screen, lvl);          // NEW-1: the RANKED size — never derived from the glyph beneath it
  // One name renderer for all three kinds: uniform near-black ink, weight-by-level, an
  // optional contrast plate for the centered-on-bar case. (x,y) is the alignment anchor +
  // vertical center, in the row's local space; the transform seats the box on it.
  // NEW-1: the caption always sits in the clear air ABOVE its glyph, so there is no on-bar
  // "plate" variant any more — no contrast backing, because nothing is painted on a fill.
  const GanttName = ({task, kind, place, fs}) => {
    const ax = place.anchor === "middle" ? "-50%" : place.anchor === "end" ? "-100%" : "0";
    return <span data-gantt-name={task.id} data-gantt-mode={place.mode} style={{position:"absolute",
      left:place.x, top:place.y, transform:`translate(${ax}, -50%)`,
      fontSize:fs, lineHeight:1.2, fontWeight:ganttNameWeight(task.level, kind, task.bold || task.cellFmt?.name?.bold),
      fontStyle:(task.italic || task.cellFmt?.name?.italic)?"italic":"normal", textDecoration:(task.underline || task.cellFmt?.name?.underline)?"underline":"none", color:GANTT_INK,
      fontFamily:"'Inter',system-ui,sans-serif", whiteSpace:"nowrap", pointerEvents:"none", zIndex:7}}>{task.name}</span>;
  };

  // NEW-1 (recurrence of B463922, ×3) — same per-project scroll memory as GridView (bug D):
  // restore on mount so a Grid↔Gantt↔Split view switch (which remounts this component via App's
  // `<ErrorBoundary key={data.view}>`) comes back where he left it instead of resetting to the top.
  const ganttMemoKey = proj?.id ?? null;
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || ganttMemoKey == null) return;
    const saved = GANTT_SCROLL_MEMO.get(ganttMemoKey);
    if (saved != null) { el.scrollTop = saved; setWinTop(rowWindowTop(el.scrollTop)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ganttMemoKey]);

  const handleScroll = e => {
    if (ganttMemoKey != null) GANTT_SCROLL_MEMO.set(ganttMemoKey, e.currentTarget.scrollTop);
    setWinTop(rowWindowTop(e.currentTarget.scrollTop)); if (onScroll) onScroll(e);
  };
  const { startIdx, endIdx } = rowWindow(winTop, (ref.current ? ref.current.clientHeight : window.innerHeight), tasks.length);
  // Fix #14: match GridView's bottom-padding formula so both panes have identical scroll heights
  const emptyPad = Math.max(100, Math.ceil(vh / ROW_H) + 40);
  const _zoom = dir => { if (onZoomChange) onZoomChange(dir > 0 ? Math.min(80, Math.ceil(ppd*1.35)) : Math.max(1, Math.floor(ppd/1.35))); };

  // Auto-scroll to today on mount
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth || 800;
    el.scrollLeft = Math.max(0, todayX - w * 0.35);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the center date stable when zoom changes
  const prevPpdRef = useRef(ppd);
  useEffect(() => {
    const el = ref.current;
    if (!el || prevPpdRef.current === ppd) return;
    const oldPpd = prevPpdRef.current;
    const centerDayOffset = (el.scrollLeft + el.clientWidth / 2) / oldPpd;
    el.scrollLeft = Math.max(0, centerDayOffset * ppd - el.clientWidth / 2);
    prevPpdRef.current = ppd;
  }, [ppd]);

  const isPanning   = useRef(false);
  const panPin      = useRef(null);   // release fn of the pinned `grabbing` cursor while a pan is live
  const panOrigin   = useRef({x:0, y:0, sl:0, st:0});
  const overscrollY = useRef(0);
  const animFrame   = useRef(null);

  const springBack = () => {
    const el = ref.current; if (!el) return;
    const cur = overscrollY.current;
    if (cur <= 0.5) { overscrollY.current = 0; el.style.transform = ''; return; }
    const next = cur * 0.74;
    overscrollY.current = next;
    el.style.transform = `translateY(${next}px)`;
    animFrame.current = requestAnimationFrame(springBack);
  };

  const onPanDown = e => {
    if (e.button !== 0) return;
    const el = ref.current; if (!el) return;
    if (animFrame.current) cancelAnimationFrame(animFrame.current);
    isPanning.current = true;
    panOrigin.current = {x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop};
    // The hand closes for the whole pan, over task rows / bars / labels too (pinned at the root, not set on the pane alone).
    if (panPin.current) panPin.current();
    panPin.current = window.pinSchedCursor("grabbing", { onExit: () => { isPanning.current = false; panPin.current = null; } });
    e.preventDefault();
  };

  const onPanMove = e => {
    if (!isPanning.current) return;
    const el = ref.current; if (!el) return;
    const rawSL = panOrigin.current.sl - (e.clientX - panOrigin.current.x);
    const rawST = panOrigin.current.st - (e.clientY - panOrigin.current.y);
    el.scrollLeft = Math.max(0, rawSL);
    if (rawST < 0) {
      el.scrollTop = 0;
      const pull = -rawST * 0.32;
      overscrollY.current = pull;
      el.style.transform = `translateY(${pull}px)`;
    } else {
      el.scrollTop = rawST;
      overscrollY.current = 0;
      el.style.transform = '';
    }
  };

  const onPanUp = () => {
    isPanning.current = false;
    if (panPin.current) { panPin.current(); panPin.current = null; }
    const el = ref.current; if (!el) return;
    if (overscrollY.current > 0) springBack();
  };

  return (
    <div style={{flex:1, display:"flex", flexDirection:"column", overflow:"hidden"}}>

      {/* Scrollable chart — B1241746 (NEW-3): `rowZoom` mirrors GridView's own gridZoom ONLY when
          this instance is the Gantt half of SplitView (its only caller that passes a value other
          than the default 1). GridView zooms its whole subtree via the CSS `zoom` property
          (data-grid-scroll="1" below), which — because it re-layouts every descendant px, ROW_H
          included — changes GridView's OWN rendered row height without touching the module-scope
          ROW_H the Gantt pane also reads. Two panes reading one ROW_H is not enough when only one
          of them is then visually rescaled: the grid's rows grow, the Gantt's don't, and the drift
          compounds one row at a time down the list. Zooming both panes by the SAME factor keeps
          every row's rendered top/height identical AND keeps the scroll-sync below numerically
          correct (scrollTop is copied 1:1 between the two refs, which is only meaningful when both
          sides are scaled the same). Standalone GanttView (no grid to align against) keeps rowZoom=1. */}
      <div ref={ref} data-gantt-scroll="1" style={{flex:1,overflow:"auto",background:"var(--bg)",cursor:"grab",zoom:rowZoom,paddingBottom:`calc(var(--fab-dock, 0px) / ${rowZoom})`}} onMouseEnter={onMouseEnter}
        onScroll={handleScroll}
        onMouseDown={onPanDown}
        onMouseMove={onPanMove}
        onMouseUp={onPanUp}
        onMouseLeave={onPanUp}>
        {/* Timeline header — two tiers within TL_H */}
        <div style={{position:"sticky",top:0,zIndex:10,height:TL_H,background:"var(--surf)",borderBottom:"2px solid var(--amber)",width:Math.max(totalW,400)}}>
          {/* Top tier: years — 13px tall */}
          {years.map(y => (
            <div key={y.label} style={{position:"absolute",left:y.x0,width:y.w,height:13,top:0,borderRight:"1px solid var(--bd2)",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",padding:"0 6px",overflow:"hidden"}}>
              <span style={{fontSize:9,fontWeight:700,color:"var(--txt)",fontFamily:"'Inter',system-ui,sans-serif",letterSpacing:".04em",whiteSpace:"nowrap"}}>{y.label}</span>
            </div>
          ))}
          {/* Bottom tier: months — remaining height */}
          {months.map(m => (
            <div key={m.label+m.x0} style={{position:"absolute",left:m.x0,width:m.w,height:TL_H-13,top:13,borderRight:"1px solid var(--bd)",display:"flex",alignItems:"center",padding:"0 4px",overflow:"hidden"}}>
              <span style={{fontSize:9,fontWeight:600,color:"var(--mut)",fontFamily:"'Inter',system-ui,sans-serif",textTransform:"uppercase",letterSpacing:".04em",whiteSpace:"nowrap"}}>{m.label}</span>
            </div>
          ))}
        </div>

        {/* Chart body — height matches GridView's emptyPad so scroll heights stay in sync */}
        <div style={{position:"relative",
          height:(tasks.length + emptyPad) * ROW_H,
          width:Math.max(totalW,400),
          background:"var(--bg)"}}>
          {/* Phantom rows below last task — count matches GridView emptyPad */}
          {Array.from({length:emptyPad},(_,i)=>(
            <div key={`ph${i}`} style={{position:"absolute",
              top:(tasks.length+i)*ROW_H,left:0,right:0,height:ROW_H,
              borderBottom:"1px solid rgba(0,0,0,0.07)",
              pointerEvents:"none"}} />
          ))}
          {/* month lines removed per user preference */
          false && months.map(m => <div key={"gl"+m.x0} style={{position:"absolute",left:m.x0,top:0,bottom:0,width:1,background:"rgba(0,0,0,0.1)"}} />)}
          {years.map(y => <div key={"yl"+y.x0} style={{position:"absolute",left:y.x0,top:0,bottom:0,width:1,background:"rgba(0,0,0,0.07)",zIndex:2}} />)}

          {/* Today line */}
          <div style={{position:"absolute",left:0,top:0,bottom:0,width:2,background:"#ef4444",opacity:.9,zIndex:4,pointerEvents:"none",
            transform:`translateX(${todayX}px)`,willChange:"transform"}}>
            <div style={{position:"absolute",top:0,left:-1,background:"#ef4444",borderRadius:"0 2px 2px 0",padding:"1px 4px",whiteSpace:"nowrap"}}>
              <span style={{fontSize:8,color:"#fff",fontFamily:"'Inter',system-ui,sans-serif",letterSpacing:".06em",fontWeight:700}}>TODAY</span>
            </div>
          </div>

          {/* Dependency arrows — B1113712: windowed to the SAME [startIdx,endIdx) range the bars
              slice below use, so an arrow can never terminate on a row whose bar isn't mounted
              (a scrolled-off task above/below the buffer, or — belt-and-suspenders — any row
              index that ever fell outside the current collapse-filtered `tasks` array). */}
          <svg style={{position:"absolute",top:0,left:0,width:totalW,height:tasks.length*ROW_H,pointerEvents:"none",zIndex:3,overflow:"visible"}}>
            {depLines.filter(l => l.srcIdx >= startIdx && l.srcIdx < endIdx && l.tgtIdx >= startIdx && l.tgtIdx < endIdx).map(l => {
            const color = l.type==="SS"?"#7c3aed":l.type==="FF"?"#0891b2":l.type==="SF"?"#be185d":"#0969da";
            // Curved (cubic bézier) connector — owner-preferred (B396) — now leaving the source's
            // top/bottom EDGE and entering the target's opposing edge (shared depAnchors, B396 re-report).
            // Handles follow the vertical travel direction (a down-link's exit descends, its entry
            // arrives from above) with a little horizontal lead so a long link reads as a natural
            // arc, not a stiff elbow. Arrowhead is oriented along the entry tangent.
            const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
            const vh = Math.max(6, Math.min(28, Math.abs(dy) * 0.5));
            const vSign = l.down ? 1 : -1;
            const c1x = l.x1 + dx*0.25, c1y = l.y1 + vSign*vh;
            const c2x = l.x2 - dx*0.25, c2y = l.y2 - vSign*vh;
            const ex = l.x2 - c2x, ey = l.y2 - c2y, el = Math.hypot(ex,ey)||1, ux = ex/el, uy = ey/el;
            const a1x = l.x2 - ux*6 - uy*3, a1y = l.y2 - uy*6 + ux*3, a2x = l.x2 - ux*6 + uy*3, a2y = l.y2 - uy*6 - ux*3;
            return (
              <g key={l.key}>
                <path d={`M${l.x1},${l.y1} C${c1x},${c1y} ${c2x},${c2y} ${l.x2},${l.y2}`}
                  stroke={color} strokeWidth="1.2" fill="none" strokeDasharray="4 3" opacity=".55" />
                <path d={`M${l.x2},${l.y2} L${a1x},${a1y} L${a2x},${a2y}Z`} fill={color} opacity=".55" />
              </g>
            );
          })}
          </svg>

          {/* Bars */}
          {tasks.slice(startIdx, endIdx).map((task, i) => {
            const ri  = startIdx + i;
            const isBlankDates = !task.start || !task.end;
            const bx  = isBlankDates ? 0 : xOf(task.start);
            const bw  = isBlankDates ? 0 : Math.max(6, xOf(task.end) - bx);  // clamped endpoints bound a far-future bar to the canvas (== dif(start,end)*ppd for any in-window task)
            const isSummary   = childParentIds.has(task.id);
            const isMilestone = task.duration === 0;
            const _isCollapsed = isSummary && !task.isExpanded;
            const isExpandedParent = isSummary && task.isExpanded;
            const displayHealth = isSummary
              // Parent tasks: always use rolled-up children health so overdue/CF rules
              // on the parent's own stale data don't override what the children say.
              ? (rolledHealthMap?.[task.id] || task.health)
              // Leaf tasks: apply computeDisplayHealth (overdue, due-soon, etc.)
              : computeDisplayHealth(task, settings, taskById);
            const _h = HEALTH[displayHealth] || HEALTH["gray"];
            const rowBg = task.rowColor || (isExpandedParent ? (ri%2?"#f8fafc":"var(--bg)") : (displayHealth==="red"?"#ffdfdf":displayHealth==="yellow"?"#fff7b9":displayHealth==="green"?"#d6fae2":displayHealth==="paused"?"#f3f4f6":ri%2?"#f8fafc":"var(--bg)"));
            const isGanttSel = selectedId === task.id;
            // Leaf bars: slim enough to sit just under the deepest parent bracket (monotonic
            // by depth), bottom-aligned with the brackets so baselines line up across the chart.
            const LEAF_H = ganttLeafGeom(GANTT_PROFILES.screen, ROW_H).h;

            // Blank-date task (an unscheduled stub): no bar/diamond, and — by design — no
            // dependency arrows are drawn to it (the depLines guard skips it). Show an explicit,
            // horizontally-sticky "Unscheduled" tag so the empty row reads as intentional rather
            // than a rendering glitch — never a silent void. Hardcoded light hues to match this
            // (always-light) chart body, like the bar labels above.
            if (isBlankDates) {
              return <div key={task.id} data-gantt-row={task.id} onClick={()=>setSelectedId?.(task.id)}
                style={{position:"absolute",top:ri*ROW_H,left:0,right:0,height:ROW_H,
                  display:"flex",alignItems:"center",
                  borderBottom:"1px solid rgba(0,0,0,0.1)",
                  borderLeft:isGanttSel?"3px solid var(--blue)":"3px solid transparent",
                  background:isGanttSel?(task.rowColor||"#eff6ff"):rowBg}}>
                <span style={{position:"sticky",left:8,display:"inline-flex",alignItems:"center",
                  height:14,padding:"0 6px",fontSize:8,fontWeight:600,letterSpacing:".05em",
                  textTransform:"uppercase",color:"#6b7280",background:"var(--bg)",
                  border:"1px dashed #cbd5e1",borderRadius:7,whiteSpace:"nowrap",
                  pointerEvents:"none",fontFamily:"'Inter',system-ui,sans-serif"}}>Unscheduled</span>
              </div>;
            }

            return (
              <div key={task.id} data-gantt-row={task.id} onClick={()=>setSelectedId?.(task.id)} style={{position:"absolute",top:ri*ROW_H,left:0,right:0,height:ROW_H,borderBottom:"1px solid rgba(0,0,0,0.1)",borderLeft:isGanttSel?"3px solid var(--blue)":"3px solid transparent",background:isGanttSel?(task.rowColor||"#eff6ff"):rowBg}}>

                {/* B222 — Bars, milestone diamonds and summary brackets keep their OWN identity
                    hue (neutral gray / depth-navy), INDEPENDENT of the row fill. rowColor paints
                    the row BACKGROUND only, so a fill can never repaint the on-row data its own
                    color and hide it. Each datum also carries a hairline edge so it stays legible
                    on any fill color. Paint order is locked by z-index: the row fill lives on the
                    row <div> (z auto, bottom) → grid / today / dependency lines (z2–4) → bars and
                    milestones (z5, the data layer) → bar + name labels (z6–7, top). */}
                {/* a duration-0 PARENT renders as a summary bracket, not a diamond (B2) — so gate milestone on !isSummary */}
                {(isMilestone && !isSummary) ? (<>
                  {(() => {                                    // milestone name: ALWAYS above the diamond; align anchors it L/C/R (NEW-1)
                    const mg = ganttMilestoneGeom(GANTT_PROFILES.screen, ROW_H, task.level);   // vertex top, not the un-rotated box top
                    const fs = fitCaptionFs(NAME_SIZE(task.level), mg.top);
                    const place = placeGanttLabel({kind:"milestone", align:labelAlign, bx, bw:0, rowTop:0,
                      barTopY:mg.top, labelW:estLabelWidth(task.name, fs),
                      chartL, chartR, capHalf:ganttCaptionHalf(fs), rowH:ROW_H});
                    return <GanttName task={task} kind="milestone" place={place} fs={fs} />;
                  })()}
                  {(() => {
                    // Milestone diamond — same monochrome language as task bars (B211): the task
                    // gray, filled when complete, hollow outline otherwise. B222: the hue is the
                    // diamond's own identity, NOT the row fill, and its border is a darker slate
                    // than the fill so the diamond reads even if a fill matches its gray.
                    const hue = "#94a3b8";
                    const done = displayHealth === "green" || isCompleteTask(task);
                    const mg = ganttMilestoneGeom(GANTT_PROFILES.screen, ROW_H, task.level), side = mg.half*Math.SQRT2;   // a square rotated 45°: vertex distance = side·√2/2
                    return <div data-gantt-bar={task.id} style={{position:"absolute",left:bx-side/2,top:mg.cy-side/2,width:side,height:side,transform:"rotate(45deg)",background:done?hue:"#fff",border:"1.25px solid #475569",boxSizing:"border-box",zIndex:5}} />;
                  })()}
                  {(() => { const bl=settings?.barLabels; if(!bl) return null;
                    const L=barLabelText(task,bl.left,bl.year), R=barLabelText(task,bl.right,bl.year);
                    const mlTop = ganttMilestoneGeom(GANTT_PROFILES.screen, ROW_H, task.level).cy - 4.8;   // the date labels stay centred on the diamond
                    return (<>
                      {L && <span style={{position:"absolute",left:bx-8,transform:"translateX(-100%)",top:mlTop,fontSize:8,color:"#6b7280",whiteSpace:"nowrap",pointerEvents:"none",zIndex:6,fontFamily:"'Inter',system-ui,sans-serif"}}>{L}</span>}
                      {R && <span style={{position:"absolute",left:bx+8,top:mlTop,fontSize:8,color:"#6b7280",whiteSpace:"nowrap",pointerEvents:"none",zIndex:6,fontFamily:"'Inter',system-ui,sans-serif"}}>{R}</span>}
                    </>); })()}
                </>) : isSummary ? (
                  (() => {
                    // Depth-stepped BRACKET (B210): a thin span with straight-down legs at each
                    // end. The GRAPHIC keeps its top-of-tree-strongest ramp — darkness, span
                    // thickness and leg length all step together (depth 0 = #2B3340, darkest +
                    // thickest, stepping lighter/thinner as nesting deepens; B222 keeps it
                    // independent of the row fill). B393: the navy was REMOVED from the name TEXT
                    // (see GanttName — uniform near-black, weight carries hierarchy) but stays on
                    // this graphic, which is not text; magnitudes are compressed a touch vs B210
                    // so the always-above caption has clear air within the row.
                    const d    = Math.min(task.level||0, 3);
                    const col  = ["#2B3340","#46506A","#6E7790","#8A93A8"][d];
                    // NEW-1: geometry from the ONE shared helper (also read by the arrow anchors). The name
                    // keeps its full RANKED size; the bracket slims at short rows to leave it the room
                    // (rank was inverted when the name was fitted to the bracket — B629's direction).
                    const sg = ganttSummaryGeom(GANTT_PROFILES.screen, ROW_H, task.level);
                    const SPAN = sg.span, LEG = sg.leg, spanTop = sg.top;
                    const legW = 1.5;                             // vertical leg stroke width
                    const fs = fitCaptionFs(NAME_SIZE(task.level), spanTop);
                    // Summary caption ALWAYS above the thin span (a near-full-width top summary
                    // has no side room); alignment anchors it L/center/R (B393 — the top-summary fix).
                    const place = placeGanttLabel({kind:"summary", align:labelAlign, bx, bw, rowTop:0,
                      barTopY:spanTop, labelW:estLabelWidth(task.name, fs),
                      chartL, chartR, capHalf:ganttCaptionHalf(fs), rowH:ROW_H});
                    return (<>
                      <GanttName task={task} kind="summary" place={place} fs={fs} />
                      <div data-gantt-bar={task.id} data-gantt-kind="summary" style={{position:"absolute",left:bx,width:bw,top:spanTop,height:SPAN+LEG,zIndex:5,pointerEvents:"none"}}>
                        <div style={{position:"absolute",left:0,right:0,top:0,height:SPAN,background:col,borderRadius:1}} />
                        <div style={{position:"absolute",left:0,top:0,width:legW,height:SPAN+LEG,background:col}} />
                        <div style={{position:"absolute",right:0,top:0,width:legW,height:SPAN+LEG,background:col}} />
                      </div>
                    </>);
                  })()
                ) : (<>
                  {(() => {                                    // leaf name: ALWAYS above the bar; align anchors it L/C/R (NEW-1, amending B393's on-bar plate)
                    const barTopY = ganttLeafGeom(GANTT_PROFILES.screen, ROW_H).top;
                    const fs = fitCaptionFs(NAME_SIZE(task.level), barTopY);
                    const place = placeGanttLabel({kind:"leaf", align:labelAlign, bx, bw, rowTop:0,
                      barTopY, labelW:estLabelWidth(task.name, fs),
                      chartL, chartR, capHalf:ganttCaptionHalf(fs), rowH:ROW_H});
                    return <GanttName task={task} kind="leaf" place={place} fs={fs} />;
                  })()}
                  {(() => { const bl=settings?.barLabels; if(!bl) return null;
                    const L=barLabelText(task,bl.left,bl.year), R=barLabelText(task,bl.right,bl.year);
                    return (<>
                      {L && <span style={{position:"absolute",left:bx-4,transform:"translateX(-100%)",top:ROW_H-11.5,fontSize:8,color:"#6b7280",whiteSpace:"nowrap",pointerEvents:"none",zIndex:6,fontFamily:"'Inter',system-ui,sans-serif"}}>{L}</span>}
                      {R && <span style={{position:"absolute",left:bx+bw+4,top:ROW_H-11.5,fontSize:8,color:"#6b7280",whiteSpace:"nowrap",pointerEvents:"none",zIndex:6,fontFamily:"'Inter',system-ui,sans-serif"}}>{R}</span>}
                    </>); })()}
                  {/* B211 status reads as a FILL treatment (hollow → partial → solid), never as
                      color. B222: the bar's hue is its own neutral identity, NOT the row fill, and
                      every state carries a hairline EDGE (a slate darker than the fill) so the bar
                      stays legible on any row fill — including the solid/complete bar, which used
                      to be borderless and vanished when a fill matched its gray. */}
                  {(() => {
                    // The leaf bar keeps one identity hue (neutral task gray); 0→100% complete
                    // reads as hollow → partial → solid. The red/paused/overdue signal stays in the
                    // row background + the table, so status never collides with the navy hierarchy
                    // of the summary brackets — and the row fill stays pure background decoration.
                    const hue  = "#94a3b8";   // neutral identity, independent of task.rowColor (B222)
                    const EDGE = "#475569";   // hairline edge, darker than the fill → legible on any fill
                    const pct = displayHealth === "green" ? 100 : leafPercent(task);
                    const top = ganttLeafGeom(GANTT_PROFILES.screen, ROW_H).top;
                    const barW = Math.max(bw, 9);   // min-width floor: a 0% bar can't collapse to a sliver
                    const base = {position:"absolute",left:bx,top,height:LEAF_H,width:barW,zIndex:5,borderRadius:LEAF_H/2,boxSizing:"border-box"};
                    if (pct >= 100)
                      return <div data-gantt-bar={task.id} style={{...base,background:hue,border:`1px solid ${EDGE}`}} />;          // Complete → solid + hairline edge
                    if (pct <= 0)
                      return <div data-gantt-bar={task.id} style={{...base,background:"var(--bg)",border:`1.5px solid ${EDGE}`}} />;      // Not started → hollow pill
                    return (                                                                               // In progress → partial fill
                      <div data-gantt-bar={task.id} style={{...base,background:"var(--bg)",border:`1px solid ${EDGE}`,overflow:"hidden",display:"flex",alignItems:"stretch"}}>
                        <div style={{width:`${pct}%`,background:hue,flexShrink:0}} />
                        <div style={{flex:1,background:hue,opacity:0.22}} />
                      </div>
                    );
                  })()}
                </>)}

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Meeting calendars — dedicated editor window (B815/B845 editor, promoted out of Settings) ──
// B815 built this editor inside the 300px Settings popover; the owner called that UI out
// (2026-07-15) — the dense editor (presets, multi-rule cadence cards, 12 month chips, the
// next-6-meetings preview) needs real width. Now a centered master-detail window: left rail =
// the project's bodies, right pane = the selected body's editor. Module-scope
// (MODULE-SCOPE-COMPONENTS): an inner definition would remount per render and drop input focus.
// Fully controlled: `bodies` in, `onChange(next)` out — the caller owns the setData write path
// (and MUST call rebuildMeetingBodyIndex, see the render site). Live-previews the next 6
// resolved meeting dates + agenda deadlines so a wrong rule is visible immediately.
const MB_WD = [{v:0,l:"Sun"},{v:1,l:"Mon"},{v:2,l:"Tue"},{v:3,l:"Wed"},{v:4,l:"Thu"},{v:5,l:"Fri"},{v:6,l:"Sat"}];
// NEW-1 — POSITION is a multi-pick: 1st..5th plus 2nd-to-last/Last, with "Every week" exclusive
// (picking it clears everything else — the new home for the old separate Weekly mode).
const MB_POSITIONS = [{v:1,l:"1st"},{v:2,l:"2nd"},{v:3,l:"3rd"},{v:4,l:"4th"},{v:5,l:"5th"},{v:-2,l:"2nd-to-last"},{v:-1,l:"Last"}];
const MB_MONTHS = [{v:1,l:"Jan"},{v:2,l:"Feb"},{v:3,l:"Mar"},{v:4,l:"Apr"},{v:5,l:"May"},{v:6,l:"Jun"},{v:7,l:"Jul"},{v:8,l:"Aug"},{v:9,l:"Sep"},{v:10,l:"Oct"},{v:11,l:"Nov"},{v:12,l:"Dec"}];
// One dot color per pattern (cycled), so the merged "next meetings" list can show which pattern
// produced each date without repeating the whole sentence.
const MB_PATTERN_COLORS = ["#2563eb","#d97706","#059669","#db2777","#7c3aed","#0891b2"];
const newMeetingBody = () => ({
  id: "mb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  name: "", jurisdiction: "",
  recurrence: [{ positions: [2, 4], weekday: 2, months: "all", anchor: null }],
  agendaLead: { type: "offset", n: 10, unit: "business" },
  cutoffTime: "12:00 PM", sameDayFilingAllowed: false,
  blackoutDates: [], extraDates: [], sourceUrl: "", verifiedOn: "",
});
const mbFmt = iso => { if(!iso) return ""; const d=new Date(iso+"T12:00:00"); return isNaN(d)?"":d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); };
// MB_ACTIVE_POPOVER_CLOSE — a single module-level slot naming the currently-open MBMultiPick's own
// close function. MeetingCalendarsModal's Escape handler (a document-level CAPTURE listener) always
// runs before any handler bound inside the modal, so a popover can't just listen for its own
// Escape — the modal would close first. Routing through this slot lets the modal's own handler close
// the popover INSTEAD of itself when one is open, satisfying "Escape closes the popover" without a
// second competing capture listener.
let MB_ACTIVE_POPOVER_CLOSE = null;
// MBMultiPick (NEW-1) — the multi-select popover POSITION and MONTHS share: `value` is either
// `allValue` (the exclusive "every"/"all" sentinel) or a non-empty array of picked option values.
// Fully keyboard-operable: the trigger is a real <button> (native Enter/Space activation + focus),
// every option is a real <button role="checkbox">, and Escape closes it via MB_ACTIVE_POPOVER_CLOSE.
function MBMultiPick({ value, onChange, options, allValue, allRowLabel, allButtonLabel, formatSelected }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null), popRef = useRef(null);
  const pos = useAnchoredPopover(open, btnRef, r => ({top: r.bottom + 4, left: r.left}), () => setOpen(false));   // NEW-1
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    MB_ACTIVE_POPOVER_CLOSE = close;
    const down = e => { if (!btnRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => { document.removeEventListener("mousedown", down); if (MB_ACTIVE_POPOVER_CLOSE === close) MB_ACTIVE_POPOVER_CLOSE = null; };
  }, [open]);
  const isAll = value === allValue;
  const picked = isAll ? [] : (Array.isArray(value) ? value : []);
  const toggle = v => {
    const has = picked.includes(v);
    const next = has ? picked.filter(x => x !== v) : [...picked, v];
    onChange(next.length ? next : allValue);
  };
  const openMenu = e => {
    e.stopPropagation();
    setOpen(o => !o);
  };
  const chip = (on, extra) => ({padding:"4px 10px",fontSize:11.5,borderRadius:5,cursor:"pointer",border:"1px solid var(--bd2)",background:on?"var(--amber)":"#fff",color:on?"#fff":"var(--mut)",fontFamily:"inherit",...extra});
  const label = isAll ? allButtonLabel : (formatSelected ? formatSelected(picked) : joinWithAnd(picked.map(v => (options.find(o=>o.v===v)||{}).l || String(v))));
  return (
    <>
      <button type="button" ref={btnRef} onClick={openMenu}
        style={{fontSize:12,padding:"3px 8px",border:"1px solid var(--bd2)",borderRadius:5,background:"var(--bg)",color:"var(--txt)",cursor:"pointer",fontWeight:600,display:"inline-flex",alignItems:"center",gap:3,fontFamily:"inherit"}}>
        {label} <span style={{fontSize:7,opacity:.7}}>▾</span>
      </button>
      {open && pos && ReactDOM.createPortal(
        <div ref={popRef} onMouseDown={e=>e.stopPropagation()}
          style={{position:"fixed",top:pos.top,left:pos.left,minWidth:200,maxWidth:260,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:6,padding:6,zIndex:9999,boxShadow:"0 4px 16px rgba(0,0,0,.15)",display:"flex",flexWrap:"wrap",gap:4}}>
          <button type="button" role="checkbox" aria-checked={isAll} onClick={()=>{ onChange(allValue); setOpen(false); }}
            style={chip(isAll, {flexBasis:"100%",fontWeight:700})}>{allRowLabel}</button>
          {options.map(o => {
            const on = picked.includes(o.v);
            return <button type="button" role="checkbox" aria-checked={on} key={String(o.v)} onClick={()=>toggle(o.v)} style={chip(on)}>{o.l}</button>;
          })}
        </div>, document.body)}
    </>
  );
}
// MeetingImportPicker (NEW-1, B1824576) — "Import from another schedule…": every meeting body on
// every OTHER schedule on the account, grouped by schedule, multi-select, each showing its cadence
// sentence + next few dates so the owner can tell same-named bodies with different cadences apart.
// A body whose name + recurrence already match one on THIS schedule is tagged "already here" —
// still pickable (importMeetingBody dedupes it to the existing copy, never a second one).
function MeetingImportPicker({ otherSchedules, existingBodies, onImport, onCancel }) {
  const [picked, setPicked] = useState(() => new Set());
  const toggle = key => setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const today = fdLocal(new Date());
  const nextDates = b => meetingDatesInRange(b, today, addD(today, 366 * 2)).slice(0, 3);
  const alreadyHere = b => (existingBodies || []).some(eb => mbBodiesSameCadence(eb, b));
  const entries = otherSchedules.flatMap(g => g.bodies.map(b => ({ key: `${g.pid}:${b.id}`, g, b })));
  const byKey = new Map(entries.map(e => [e.key, e.b]));
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"9px 18px",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <span onClick={onCancel} title="Back" style={{cursor:"pointer",color:"var(--mut)",fontSize:13,lineHeight:1}}>&larr;</span>
        <span style={{fontSize:12.5,fontWeight:600,color:"var(--txt)"}}>Import meeting calendars</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 18px"}}>
        {otherSchedules.length === 0 && (
          <div style={{fontSize:12,color:"var(--mut)",fontStyle:"italic"}}>No other schedules on this account have meeting calendars yet.</div>
        )}
        {otherSchedules.map(g => (
          <div key={g.pid} style={{marginBottom:16}}>
            {/* B1873361 — g.schedName is now the full "<Project> / <Schedule>" label (house order),
                so the old reversed "<Schedule> · <Project>" tacked on here is retired, not just
                reordered — schedName already carries both halves. */}
            <div style={{fontSize:10,fontWeight:700,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>
              {g.schedName}
            </div>
            {g.bodies.map(b => {
              const key = `${g.pid}:${b.id}`;
              const on = picked.has(key);
              const dup = alreadyHere(b);
              const dates = nextDates(b);
              return (
                <label key={key} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"7px 8px",borderRadius:6,cursor:"pointer",background:on?"var(--surf)":"transparent"}}>
                  <input type="checkbox" checked={on} onChange={()=>toggle(key)} style={{marginTop:3,flexShrink:0}} />
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:"var(--txt)"}}>
                      {b.name || <span style={{color:"var(--mut)",fontStyle:"italic",fontWeight:400}}>Untitled body</span>}
                      {dup && <span style={{marginLeft:7,fontSize:9.5,fontWeight:700,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".04em"}}>already here</span>}
                    </div>
                    <div style={{fontSize:10.5,color:"var(--mut)",marginTop:2}}>{cadenceSummary(b)}</div>
                    <div style={{fontSize:10.5,color:"var(--mut)",marginTop:1}}>{dates.length ? dates.map(d=>mbFmt(d)).join(" · ") : "no dates resolve"}</div>
                  </div>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{padding:"10px 16px",borderTop:"1px solid var(--bd)",display:"flex",justifyContent:"flex-end",gap:8,flexShrink:0}}>
        <button className="btn" onClick={onCancel} style={{fontSize:12,padding:"6px 12px"}}>Cancel</button>
        <button className="btn" disabled={picked.size===0}
          onClick={()=>onImport([...picked].map(k=>byKey.get(k)).filter(Boolean))}
          style={{fontSize:12,padding:"6px 14px",background:picked.size?"var(--amber)":"#eee",color:picked.size?"#fff":"var(--mut)",borderColor:picked.size?"var(--amber)":"var(--bd2)",cursor:picked.size?"pointer":"default"}}>
          Import{picked.size ? ` ${picked.size}` : ""}
        </button>
      </div>
    </div>
  );
}
function MeetingCalendarsModal({ projName, bodies, otherSchedules = [], onChange, onClose }) {
  // Draft / Save model (owner ask, 2026-07-15): the window edits a WORKING COPY — nothing touches the
  // schedule until "Save changes", so it's unmistakable when the edits take effect. savedRef holds the
  // last-applied snapshot, driving the dirty flag + the unsaved-close guard. All edits are JSON-safe.
  const initial = Array.isArray(bodies) ? bodies : [];
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(initial)));
  const savedRef = useRef(JSON.stringify(initial));
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const list = draft;
  const dirty = JSON.stringify(draft) !== savedRef.current;
  const [selId, setSelId] = useState(() => (list[0] && list[0].id) || null);
  const sel = list.find(b => b.id === selId) || null;
  const save = () => { onChange(JSON.parse(JSON.stringify(draft))); savedRef.current = JSON.stringify(draft); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1600); };
  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };
  // NotesModal-style close hardening: a text-selection drag ending on the backdrop must not dismiss;
  // Escape backs out (an open POSITION/MONTHS popover first, then the confirm bar, then the close)
  // via a capture-phase listener — this always fires before any handler bound inside the modal, so a
  // popover can't just listen for its own Escape (see MB_ACTIVE_POPOVER_CLOSE).
  const backdropRef = useRef(null);
  const downOnBackdropRef = useRef(false);
  useEffect(() => {
    const onKey = e => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (MB_ACTIVE_POPOVER_CLOSE) { MB_ACTIVE_POPOVER_CLOSE(); MB_ACTIVE_POPOVER_CLOSE = null; return; }
      if (confirmClose) setConfirmClose(false); else requestClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
  // All edits mutate the DRAFT only (setDraft) — the parent's onChange runs once, on Save.
  const patch = (id, fields) => setDraft(prev => prev.map(b => b.id === id ? { ...b, ...fields } : b));
  const rulesOf = b => (Array.isArray(b.recurrence) && b.recurrence.length) ? b.recurrence : [{ positions:[2,4], weekday:2, months:"all", anchor:null }];
  const patchRuleAt = (id, idx, rf) => setDraft(prev => prev.map(b => b.id === id ? { ...b, recurrence: rulesOf(b).map((r, i) => i === idx ? { ...r, ...rf } : r) } : b));
  const addRuleAt = id => setDraft(prev => prev.map(b => b.id === id ? { ...b, recurrence: [...rulesOf(b), { positions:[1], weekday:2, months:"all", anchor:null }] } : b));
  const removeRuleAt = (id, idx) => setDraft(prev => prev.map(b => b.id === id ? { ...b, recurrence: rulesOf(b).filter((_, i) => i !== idx) } : b));
  const patchLead = (id, lf) => setDraft(prev => prev.map(b => b.id === id ? { ...b, agendaLead: { ...(b.agendaLead||{}), ...lf } } : b));
  const add = () => { const b = newMeetingBody(); setDraft(prev => [...prev, b]); setSelId(b.id); };
  const remove = id => { const rest = list.filter(b => b.id !== id); setDraft(prev => prev.filter(b => b.id !== id)); if (selId === id) setSelId((rest[0] && rest[0].id) || null); };
  // NEW-1 (B1824576) — "Import from another schedule…": pulls one or more bodies' cadence in
  // from another of the owner's schedules instead of re-entering it. Imported bodies land in the
  // DRAFT like any other edit — still gated behind Save changes, same as everything else here.
  const [importOpen, setImportOpen] = useState(false);
  const importBodies = sourceBodies => {
    const { bodies: next, ids } = importMeetingBodies(draft, sourceBodies);
    setDraft(next);
    if (ids.length) setSelId(ids[ids.length - 1]);
    setImportOpen(false);
  };
  const inp = { fontSize:12, padding:"5px 8px", border:"1px solid var(--bd2)", borderRadius:5, background:"var(--bg)", color:"var(--txt)", width:"100%", boxSizing:"border-box", fontFamily:"'Inter',system-ui,sans-serif" };
  const lbl = { fontSize:10, fontWeight:600, color:"var(--mut)", textTransform:"uppercase", letterSpacing:".05em", margin:"0 0 4px", display:"block" };
  const sect = { fontSize:10, fontWeight:700, color:"var(--mut)", textTransform:"uppercase", letterSpacing:".07em", margin:"18px 0 8px", paddingBottom:5, borderBottom:"1px solid var(--bd)" };
  const seg = (opts, val, on) => (
    <div style={{display:"flex",border:"1px solid var(--bd2)",borderRadius:5,overflow:"hidden",flexShrink:0}}>
      {opts.map(o => <span key={String(o.v)} onClick={()=>on(o.v)} style={{padding:"4px 10px",fontSize:11.5,cursor:"pointer",whiteSpace:"nowrap",background:val===o.v?"var(--amber)":"transparent",color:val===o.v?"#fff":"var(--mut)"}}>{o.l}</span>)}
    </div>
  );
  const today = fdLocal(new Date());
  // preview: the next N merged, de-duplicated meeting dates, each tagged with the color of the
  // FIRST pattern (in rule order) that produces it — N is 8 when any pattern is "every week"
  // (matches the acceptance spec: an every-week body's dates come far more densely).
  const preview = b => {
    const rules = rulesOf(b);
    const n = rules.some(r => r.positions === "every") ? 8 : 6;
    const merged = meetingDatesInRange(b, today, addD(today, 366*2)).slice(0, n);
    return merged.map(date => {
      const idx = rules.findIndex(r => meetingDatesInRange({ recurrence:[r] }, date, date).length > 0);
      return { date, dot: MB_PATTERN_COLORS[(idx >= 0 ? idx : 0) % MB_PATTERN_COLORS.length] };
    });
  };
  const detail = b => {
    const rules = rulesOf(b);
    const lead = b.agendaLead || { type:"offset", n:10, unit:"business" };
    const dates = preview(b);
    return (
      <div style={{padding:"16px 20px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:12,alignItems:"end"}}>
          <div>
            <label style={lbl}>Body name</label>
            <input {...NO_AUTOFILL} value={b.name||""} placeholder="e.g. Baytown city council" onChange={e=>patch(b.id,{name:e.target.value})} style={{...inp,fontWeight:600}} />
          </div>
          <div>
            <label style={lbl}>Jurisdiction</label>
            <input {...NO_AUTOFILL} value={b.jurisdiction||""} placeholder="e.g. Baytown, TX" onChange={e=>patch(b.id,{jurisdiction:e.target.value})} style={inp} />
          </div>
          <button className="btn" onClick={()=>remove(b.id)} title="Remove this meeting body" style={{fontSize:11,padding:"5px 10px",color:"var(--danger,#d83a3a)"}}>Remove</button>
        </div>

        <div style={sect}>Meets</div>
        {rules.map((rule, ri) => {
          const isEvery = rule.positions === "every";
          const months = (rule.months === "all" || !Array.isArray(rule.months) || !rule.months.length) ? "all" : rule.months;
          const hasAnchor = !!(rule.anchor && rule.anchor.weekday != null && rule.anchor.position != null);
          const missing = positionMissingReport(rule, today);
          const ruleDates = meetingDatesInRange({ recurrence:[rule] }, today, addD(today, 366*4)).slice(0, 3);
          const dot = MB_PATTERN_COLORS[ri % MB_PATTERN_COLORS.length];
          return (
            <div key={ri} style={{border:"1px solid var(--bd)",borderRadius:6,padding:"10px 12px",marginBottom:8,background:"var(--surf)"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}>
                <span title="This pattern's color in the resolved-dates list below" style={{width:7,height:7,marginTop:6,borderRadius:"50%",background:dot,flexShrink:0}} />
                <div style={{display:"flex",gap:6,rowGap:4,alignItems:"center",flexWrap:"wrap",flex:1,fontSize:12.5,color:"var(--txt)"}}>
                  <span>Meets</span>
                  {!isEvery && <span style={{color:"var(--mut)"}}>the</span>}
                  <MBMultiPick
                    value={isEvery ? "every" : (Array.isArray(rule.positions) ? rule.positions : [1])}
                    onChange={v => patchRuleAt(b.id, ri, v === "every" ? {positions:"every", anchor:null} : {positions:v})}
                    options={MB_POSITIONS} allValue="every" allRowLabel="Every week" allButtonLabel="every"
                    formatSelected={arr=>joinWithAnd(arr.map(v=>(MB_POSITIONS.find(o=>o.v===v)||{}).l||String(v)))} />
                  <select value={rule.weekday} onChange={e=>patchRuleAt(b.id,ri,{weekday:+e.target.value})} style={{...inp,width:"auto",display:"inline-block"}}>
                    {MB_WD.map(w=><option key={w.v} value={w.v}>{w.l}</option>)}
                  </select>
                  <span style={{color:"var(--mut)"}}>{isEvery ? (months==="all" ? "," : "in") : "of"}</span>
                  <MBMultiPick
                    value={months}
                    onChange={v => patchRuleAt(b.id, ri, {months:v})}
                    options={MB_MONTHS} allValue="all" allRowLabel="Every month"
                    allButtonLabel={isEvery ? "all year" : "every month"} />
                </div>
                {rules.length>1 && <span onClick={()=>removeRuleAt(b.id,ri)} title="Remove this pattern" style={{cursor:"pointer",color:"var(--mut)",fontSize:14,padding:"0 2px",flexShrink:0}}>&#x2715;</span>}
              </div>
              {!isEvery && (
                <label style={{fontSize:11.5,color:"var(--txt)",display:"flex",alignItems:"flex-start",gap:6,cursor:"pointer",marginTop:10,paddingLeft:13}}>
                  <input type="checkbox" checked={hasAnchor} style={{marginTop:2,flexShrink:0}}
                    onChange={e=>patchRuleAt(b.id,ri, e.target.checked
                      ? {anchor:{position:1, weekday:(rule.weekday+6)%7}}
                      : {anchor:null})} />
                  <span style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span>counting from after the</span>
                    {hasAnchor ? (<>
                      <select value={rule.anchor.position} onChange={e=>patchRuleAt(b.id,ri,{anchor:{...rule.anchor,position:+e.target.value}})} style={{...inp,width:"auto",display:"inline-block"}}>
                        {MB_POSITIONS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                      <select value={rule.anchor.weekday} onChange={e=>patchRuleAt(b.id,ri,{anchor:{...rule.anchor,weekday:+e.target.value}})} style={{...inp,width:"auto",display:"inline-block"}}>
                        {MB_WD.map(w=><option key={w.v} value={w.v}>{w.l}</option>)}
                      </select>
                    </>) : <span style={{color:"var(--mut)",fontStyle:"italic"}}>1st Monday (e.g. the U.S. Election Day pattern)</span>}
                  </span>
                </label>
              )}
              {!isEvery && missing && missing.missing > 0 && (
                <div style={{marginTop:8,paddingLeft:13,fontSize:11,color:"var(--warn-text,#b45309)"}}>
                  ⚠ {missing.missing} of the next {missing.checked} picked months have no such meeting.
                </div>
              )}
              <div style={{marginTop:10,paddingTop:8,paddingLeft:13,borderTop:"1px dashed var(--bd2)",fontSize:11.5,lineHeight:1.5}}>
                <span style={{color:"var(--mut)"}}>Resolves to </span>
                <span style={{fontWeight:600,color:"var(--txt)"}}>{mbRuleSummary(rule)}</span>
                {ruleDates.length
                  ? <span style={{color:"var(--mut)"}}> — next: {ruleDates.map(d=>mbFmt(d)).join(" · ")}</span>
                  : <span style={{color:"var(--warn-text,#b45309)",fontWeight:600}}> — no dates resolve; check the rule</span>}
              </div>
            </div>
          );
        })}
        <button className="btn" onClick={()=>addRuleAt(b.id)} style={{fontSize:11,padding:"4px 10px"}}>+ And also…</button>

        <div style={sect}>Deadline before each meeting <span style={{textTransform:"none",fontWeight:400,letterSpacing:0}}>— file the agenda / call the election by (e.g. 78 calendar days before an election)</span></div>
        <div style={{fontSize:10.5,color:"var(--mut)",margin:"0 0 8px",lineHeight:1.5}}>
          To put this date on the schedule: right-click the bound task → “+ Add deadline row”. The row then always sits this far ahead of the meeting and moves with it.
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {seg([{v:"offset",l:"Days before"},{v:"weekdayAnchor",l:"Weekday anchor"}], lead.type||"offset", v=>patchLead(b.id,{type:v}))}
          {(lead.type||"offset")==="offset" ? (<>
            <input type="number" min={0} value={lead.n??10} onChange={e=>patchLead(b.id,{n:+e.target.value})} style={{...inp,width:60}} />
            {seg([{v:"business",l:"business"},{v:"calendar",l:"calendar"}], lead.unit||"business", v=>patchLead(b.id,{unit:v}))}
            <span style={{fontSize:11.5,color:"var(--mut)"}}>days before</span>
          </>) : (<>
            <input type="number" min={0} value={lead.weeksBefore??2} onChange={e=>patchLead(b.id,{weeksBefore:+e.target.value})} style={{...inp,width:52}} />
            <span style={{fontSize:11.5,color:"var(--mut)"}}>weeks before, on</span>
            <select value={lead.weekday??3} onChange={e=>patchLead(b.id,{weekday:+e.target.value})} style={{...inp,width:"auto"}}>
              {MB_WD.map(w=><option key={w.v} value={w.v}>{w.l}</option>)}
            </select>
          </>)}
        </div>
        <div style={{display:"flex",gap:18,marginTop:10,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div><label style={lbl}>Cutoff time</label>
            <input {...NO_AUTOFILL} value={b.cutoffTime||""} placeholder="12:00 PM" onChange={e=>patch(b.id,{cutoffTime:e.target.value})} style={{...inp,width:100}} /></div>
          <label style={{fontSize:11.5,color:"var(--txt)",display:"flex",alignItems:"center",gap:6,cursor:"pointer",paddingBottom:6}}>
            <input type="checkbox" checked={!!b.sameDayFilingAllowed} onChange={e=>patch(b.id,{sameDayFilingAllowed:e.target.checked})} /> Same-day filing OK
          </label>
        </div>

        <div style={sect}>Exceptions &amp; source</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <label style={lbl}>Cancelled / blackout dates</label>
            <input {...NO_AUTOFILL} value={(b.blackoutDates||[]).join(", ")} placeholder="2026-12-22, 2026-12-29" title="Comma-separated YYYY-MM-DD" onChange={e=>patch(b.id,{blackoutDates:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})} style={inp} />
          </div>
          <div>
            <label style={lbl}>Special-called / extra dates</label>
            <input {...NO_AUTOFILL} value={(b.extraDates||[]).join(", ")} placeholder="2026-08-18" title="Comma-separated YYYY-MM-DD" onChange={e=>patch(b.id,{extraDates:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})} style={inp} />
          </div>
          <div>
            <label style={lbl}>Published calendar URL</label>
            <input {...NO_AUTOFILL} value={b.sourceUrl||""} placeholder="https://…/agenda-calendar" onChange={e=>patch(b.id,{sourceUrl:e.target.value})} style={inp} />
          </div>
          <div>
            <label style={lbl}>Verified on</label>
            <input type="date" value={b.verifiedOn||""} onChange={e=>patch(b.id,{verifiedOn:e.target.value})} style={{...inp,width:"auto"}} />
          </div>
        </div>

        <div style={{marginTop:18,background:"var(--surf)",border:"1px solid var(--bd)",borderRadius:8,padding:"10px 14px 12px"}}>
          <div style={{fontSize:12,marginBottom:8,paddingBottom:8,borderBottom:"1px solid var(--bd)"}}>
            <span style={{color:"var(--mut)"}}>This body meets </span>
            <span style={{fontWeight:600,color:"var(--txt)"}}>{cadenceSummary(b)}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:4}}>
            <span style={{fontSize:10,fontWeight:700,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".06em"}}>Next {dates.length || (rules.some(r=>r.positions==="every")?8:6)} meetings → file by</span>
            <span style={{fontSize:10,color: b.verifiedOn ? "var(--mut)" : "var(--warn-text,#b45309)"}}>{b.verifiedOn ? `verified ${mbFmt(b.verifiedOn)}` : "rule-derived, unverified"}</span>
          </div>
          {dates.length===0 && <div style={{fontSize:12,color:"var(--mut)",fontStyle:"italic",marginTop:4}}>No dates resolve — check the recurrence rule.</div>}
          {dates.map(({date:m, dot})=>(
            <div key={m} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"3px 0",color:"var(--txt)",gap:8,borderTop:"1px dashed var(--bd)"}}>
              <span style={{display:"flex",alignItems:"center",gap:6,fontWeight:500}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:dot,flexShrink:0}} />
                {mbFmt(m)}
              </span>
              <span style={{color:"var(--mut)"}}>file by {mbFmt(agendaDeadline(b,m))}{b.cutoffTime?` · ${b.cutoffTime}`:""}</span>
            </div>
          ))}
          {b.sourceUrl && <div style={{marginTop:6}}><a href={b.sourceUrl} target="_blank" rel="noreferrer" style={{fontSize:10.5,color:"var(--amber)"}}>published calendar ↗</a></div>}
        </div>
      </div>
    );
  };

  return (
    <div ref={backdropRef}
      onMouseDown={e => { downOnBackdropRef.current = (e.target === backdropRef.current); }}
      onClick={e => { const hit = e.target === backdropRef.current && downOnBackdropRef.current; downOnBackdropRef.current = false; if (hit) requestClose(); }}
      style={{position:"fixed",inset:0,background:"rgba(15,23,42,.38)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div data-testid="meeting-calendars-modal" onMouseDown={e=>e.stopPropagation()}
        style={{background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:10,width:"min(860px,96vw)",height:"min(640px,90vh)",
          display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 16px 48px rgba(0,0,0,.18)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"12px 18px",borderBottom:"1px solid var(--bd)",flexShrink:0}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"var(--amber)",letterSpacing:".07em",textTransform:"uppercase",lineHeight:1,marginBottom:2}}>Meeting calendars</div>
            <div style={{fontSize:14,fontWeight:600,color:"var(--txt)"}}>{projName || "Project"}</div>
          </div>
          <div style={{display:"flex",gap:14,alignItems:"center",minWidth:0}}>
            <span style={{fontSize:10.5,color:"var(--mut)",maxWidth:380,textAlign:"right",lineHeight:1.45}}>External decision bodies (city council, P&amp;Z, commissioners court). Bind a task to one and its hearing date snaps to the body's calendar.</span>
            <span onClick={requestClose} title="Close (Esc)" style={{cursor:"pointer",color:"var(--mut)",fontSize:17,lineHeight:1,flexShrink:0}}>&#x2715;</span>
          </div>
        </div>
        {importOpen ? (
          <MeetingImportPicker otherSchedules={otherSchedules} existingBodies={draft} onCancel={()=>setImportOpen(false)} onImport={importBodies} />
        ) : (
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          <div style={{width:216,flexShrink:0,borderRight:"1px solid var(--bd)",display:"flex",flexDirection:"column",background:"var(--surf)"}}>
            <div style={{flex:1,overflowY:"auto",padding:"8px 0"}}>
              {list.length===0 && <div style={{fontSize:11,color:"var(--mut)",fontStyle:"italic",padding:"8px 14px"}}>No meeting bodies yet.</div>}
              {list.map(b => {
                const isSel = b.id === selId;
                return (
                  <div key={b.id} data-testid="meeting-body-row" onClick={()=>setSelId(b.id)}
                    style={{padding:"8px 12px 8px 13px",cursor:"pointer",borderLeft:`3px solid ${isSel?"var(--amber)":"transparent"}`,background:isSel?"#fff":"transparent"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"var(--txt)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name || <span style={{color:"var(--mut)",fontStyle:"italic",fontWeight:400}}>Untitled body</span>}</div>
                    <div style={{fontSize:10,color:"var(--mut)",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cadenceSummary(b)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:10,borderTop:"1px solid var(--bd)",flexShrink:0,display:"flex",flexDirection:"column",gap:6}}>
              <button className="btn" onClick={add} style={{width:"100%",fontSize:11.5,padding:"6px 10px"}}>+ Add meeting body</button>
              {/* NEW-1 (B1824576) — hidden entirely with no OTHER schedule on the account (nothing
                  to import); otherwise always enabled, even with zero bodies here. Never a dead button. */}
              {otherSchedules.length > 0 && (
                <button className="btn" onClick={()=>setImportOpen(true)} style={{width:"100%",fontSize:11.5,padding:"6px 10px"}}>Import from another schedule…</button>
              )}
            </div>
          </div>
          <div style={{flex:1,overflowY:"auto",minWidth:0}}>
            {sel ? detail(sel) : (
              <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,textAlign:"center",padding:"0 48px"}}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M4 10h16"/><path d="M12 3 3 8h18L12 3Z"/>
                </svg>
                <div style={{fontSize:13.5,fontWeight:600,color:"var(--txt)"}}>No meeting calendars yet</div>
                <div style={{fontSize:11.5,color:"var(--mut)",lineHeight:1.55,maxWidth:380}}>
                  Add an external decision body — a city council, P&amp;Z commission, or commissioners court.
                  Bind a task to it (right-click the task) and its hearing date snaps to the body's calendar,
                  with the agenda-filing deadline derived automatically.
                </div>
                <div style={{display:"flex",gap:8,marginTop:4}}>
                  <button className="btn" onClick={add} style={{fontSize:12,padding:"7px 14px"}}>+ Add meeting body</button>
                  {otherSchedules.length > 0 && (
                    <button className="btn" onClick={()=>setImportOpen(true)} style={{fontSize:12,padding:"7px 14px"}}>Import from another schedule…</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
        {/* Footer — the explicit apply gate. Nothing on the schedule moves until Save changes. */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"10px 16px",borderTop:"1px solid var(--bd)",flexShrink:0,background:"var(--surf)"}}>
          {confirmClose ? (<>
            <span style={{fontSize:12,fontWeight:600,color:"var(--warn-text,#b45309)"}}>You have unsaved changes.</span>
            <div style={{display:"flex",gap:8}}>
              <button className="btn" onClick={()=>setConfirmClose(false)} style={{fontSize:12,padding:"6px 12px"}}>Keep editing</button>
              <button className="btn" onClick={onClose} style={{fontSize:12,padding:"6px 12px",color:"var(--danger,#d83a3a)"}}>Discard</button>
              <button className="btn" onClick={()=>{ save(); onClose(); }} style={{fontSize:12,padding:"6px 12px",background:"var(--amber)",color:"#fff",borderColor:"var(--amber)"}}>Save &amp; close</button>
            </div>
          </>) : (<>
            {/* NEW-2 (2026-09-22): this dialog does NOT autosave — edits live only in the draft until
                Save changes is clicked. The footer used to show "All changes saved" beside a (merely
                disabled) Save changes button at the same time, which read as self-contradictory even
                though the two never disagreed about the real state. Fix: when there is nothing to
                save, the Save button is gone entirely — only Close remains, matching what's true. */}
            <span style={{fontSize:11.5,fontWeight:600,color: dirty ? "var(--warn-text,#b45309)" : savedFlash ? "#15803d" : "var(--mut)"}}>
              {dirty ? "● Unsaved changes — nothing on the schedule has moved yet" : savedFlash ? "✓ Saved — the schedule updated" : "All changes saved"}
            </span>
            <div style={{display:"flex",gap:8}}>
              <button className="btn" onClick={requestClose} style={{fontSize:12,padding:"6px 12px"}}>{dirty ? "Cancel" : "Close"}</button>
              {dirty && <button className="btn" onClick={save} style={{fontSize:12,padding:"6px 14px",background:"var(--amber)",color:"#fff",borderColor:"var(--amber)"}}>Save changes</button>}
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
function SettingsPanel({data, setData, onClose, openFile, fileLinked, initialSection, onOpenMeetingCalendars}) {
  const s = data.settings || DEFAULT_SETTINGS;
  const upd = patch => setData(d => ({...d, settings:{...d.settings,...patch}}));
  const updHol = (k, v) => setData(d => {
    const holidays = {...d.settings.holidays, [k]: v};
    setHolidaySet(buildHolidaySet(holidays));
    const newProjects = {};
    Object.entries(d.projects || {}).forEach(([pid, proj]) => {
      let tasks = (proj.tasks || []).map(t => ({...t}));   // clone — never mutate prior state
      tasks = recomputeSchedule(tasks);                     // respects pinnedStart
      newProjects[pid] = {...proj, tasks};
    });
    return {...d, settings:{...d.settings, holidays}, projects: newProjects};
  });
  const pinCount = Object.values(data.projects || {}).reduce((n, p) => n + (p.tasks || []).filter(t => t.pinnedStart).length, 0);
  // B844 — seed the collapsible sections; initialSection (e.g. "meetings") starts expanded so a deep-link
  // from the right-click menu / an empty Meeting cell lands directly on the right editor.
  const [open, setOpen] = useState(() => ({view: true, holidays: false, cf: false, backup: false, ...(initialSection ? {[initialSection]: true} : {})}));
  const tog = k => setOpen(p => ({...p, [k]: !p[k]}));
  // Fix #10: close on Escape (consistent with other modals/pickers)
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // B844 — when deep-linked to a section, scroll it into view (it may sit below the panel fold).
  useEffect(() => {
    if (!initialSection) return;
    const el = document.querySelector(`[data-section="${initialSection}"]`);
    if (el) el.scrollIntoView({ block: "start" });
  }, [initialSection]);

  const thisYear = new Date().getFullYear();
  const holDates = {};
  HOLIDAY_DEFS.forEach(h => {
    const ds = h.fn(thisYear);
    const d = new Date(ds + "T12:00:00");
    const dateStr = d.toLocaleDateString("en-US", {month:"short", day:"numeric"});
    holDates[h.k] = h.rule ? `${h.rule} · ${dateStr}` : dateStr;
  });

  const SectionHdr = ({id, title}) => (
    <div data-section={id} onClick={()=>tog(id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
      padding:"10px 0 7px",borderBottom:"1px solid var(--bd)",marginBottom: open[id] ? 8 : 0,
      cursor:"pointer",userSelect:"none"}}>
      <span style={{fontSize:10,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase"}}>{title}</span>
      <span style={{fontSize:10,color:"var(--mut)",display:"inline-block",
        transform: open[id] ? "rotate(180deg)" : "rotate(0deg)", transition:"transform .18s", lineHeight:1}}>&#9662;</span>
    </div>
  );
  const Row = ({label, children}) => (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 0",gap:12}}>
      <span style={{fontSize:12,color:"var(--txt)"}}>{label}</span>
      {children}
    </div>
  );
  const Toggle = ({on, onChange}) => (
    <span onClick={e=>{e.stopPropagation();onChange(!on);}} style={{width:28,height:15,borderRadius:8,background:on?"var(--amber)":"var(--bd2)",
      display:"inline-flex",alignItems:"center",cursor:"pointer",flexShrink:0,transition:"background .15s",padding:"0 2px"}}>
      <span style={{width:11,height:11,borderRadius:"50%",background:"var(--bg)",boxShadow:"0 1px 3px rgba(0,0,0,.2)",
        transform:on?"translateX(13px)":"translateX(0)",transition:"transform .15s",flexShrink:0}} />
    </span>
  );
  const SegBtn = ({options, value, onChange}) => (
    <div style={{display:"flex",border:"1px solid var(--bd2)",borderRadius:4,overflow:"hidden",flexShrink:0}}>
      {options.map(o => (
        <span key={String(o.v)} onClick={()=>onChange(o.v)}
          style={{padding:"3px 10px",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",
            background:value===o.v?"var(--amber)":"transparent",
            color:value===o.v?"#fff":"var(--mut)",transition:"background .12s,color .12s",
            fontFamily:"'Inter',system-ui,sans-serif",fontWeight:value===o.v?500:400}}>
          {o.l}
        </span>
      ))}
    </div>
  );

  return (
    <div style={{position:"fixed",top:48,right:12,width:300,background:"var(--bg)",border:"1px solid var(--bd2)",
      borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.14)",zIndex:9999,padding:"0 16px 14px",
      overflow:"hidden",maxHeight:"calc(100vh - 64px)",overflowY:"auto"}}
      onMouseDown={e=>e.stopPropagation()}>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 4px"}}>
        <span style={{fontWeight:600,fontSize:13,color:"var(--txt)"}}>Settings</span>
        <span onClick={onClose} style={{cursor:"pointer",color:"var(--mut)",fontSize:16,lineHeight:1}}>&#x2715;</span>
      </div>

      <SectionHdr id="view" title="View" />
      {open.view && (
        <div style={{marginBottom:4}}>
          <Row label="Default drag mode">
            <SegBtn options={[{l:"Snap",v:true},{l:"Free",v:false}]} value={s.snapDefault} onChange={v=>upd({snapDefault:v})} />
          </Row>
          <div style={{padding:"4px 0 2px"}}>
            <span style={{fontSize:12,color:"var(--txt)",display:"block",marginBottom:6}}>Default split (grid %)</span>
            <div style={{position:"relative",height:20,display:"flex",alignItems:"center"}}>
              <div style={{position:"absolute",left:0,right:0,height:4,borderRadius:2,background:"var(--bd2)",overflow:"hidden",pointerEvents:"none"}}>
                <div style={{width:`${((s.defaultSplit-20)/(82-20))*100}%`,height:"100%",background:"var(--amber)",transition:"width .05s"}} />
              </div>
              <input type="range" min={20} max={82} value={s.defaultSplit}
                onChange={e=>upd({defaultSplit:+e.target.value})}
                style={{width:"100%",appearance:"none",WebkitAppearance:"none",background:"transparent",
                  margin:0,cursor:"pointer",position:"relative",zIndex:1}} />
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:2}}>
              <span style={{fontSize:10,color:"var(--mut)"}}>20%</span>
              <span style={{fontSize:12,fontWeight:600,color:"var(--amber)"}}>{s.defaultSplit}% grid</span>
              <span style={{fontSize:10,color:"var(--mut)"}}>82%</span>
            </div>
          </div>
        </div>
      )}

      <div style={{marginTop: open.view ? 6 : 2}}>
        <SectionHdr id="holidays" title="Holidays" />
        {open.holidays && (<>
          <div style={{fontSize:10,color:"var(--mut)",lineHeight:1.45,margin:"0 0 6px"}}>
            Toggling a holiday recalculates every schedule immediately. Pinned start dates stay put — computed finish dates and downstream tasks shift.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 4px",paddingBottom:4}}>
            {HOLIDAY_DEFS.map(h => {
              const on = !!(s.holidays||{})[h.k];
              return (
                <div key={h.k} onClick={()=>updHol(h.k,!on)}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"5px 6px",borderRadius:4,cursor:"pointer",gap:4,
                    background: on ? "#f5f3ff" : "transparent", transition:"background .12s"}}
                  onMouseEnter={e=>{ if(!on) e.currentTarget.style.background="var(--surf)"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background = on ? "#f5f3ff" : "transparent"; }}>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontSize:11,color: on ? "var(--txt)" : "var(--mut)",fontWeight: on ? 500 : 400,
                      whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",lineHeight:1.3}}>{h.label}</div>
                    <div style={{fontSize:10,color: on ? "#7c6ad6" : "#b0b7c0",lineHeight:1.3,marginTop:1}}>{holDates[h.k]}</div>
                  </div>
                  <Toggle on={on} onChange={v=>updHol(h.k,v)} />
                </div>
              );
            })}
          </div>
        </>)}

        <SectionHdr id="meetings" title="Meeting calendars" />
        {open.meetings && (
          <div style={{paddingBottom:8}}>
            <div style={{fontSize:10,color:"var(--mut)",lineHeight:1.45,margin:"0 0 8px"}}>
              External decision bodies (city council, P&amp;Z, commissioners court) whose approvals only happen on a cadence — stored per project. Edited in their own window.
            </div>
            <button className="btn" onClick={()=>{ onOpenMeetingCalendars && onOpenMeetingCalendars(); onClose(); }} style={{fontSize:11,padding:"5px 11px"}}>
              {(() => { const n = ((activeProjectOf(data) || {}).meetingBodies || []).length; return n ? `Open Meeting calendars (${n}) ↗` : "Set up Meeting calendars ↗"; })()}
            </button>
          </div>
        )}

        <SectionHdr id="schedule" title="Schedule" />
        {open.schedule && (
          <div style={{paddingBottom:6}}>
            <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.5,marginBottom:8}}>
              Editing a date directly <strong>pins</strong> it — the dependency cascade stops moving that task.
              Recascade removes every pin in every project and recomputes all dates from predecessor logic.
              A snapshot is saved first, so it can be undone from Version History.
            </div>
            <div style={{fontSize:11,color:"var(--txt)",marginBottom:8}}>
              Currently pinned: <strong>{pinCount}</strong> task{pinCount===1?"":"s"} across all projects
            </div>
            <button className="btn"
              title="Strip all pinned dates and recalculate everything from predecessor logic"
              style={{display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"4px 11px",
                borderColor:"#fca5a5",color:"#b91c1c"}}
              onClick={async ()=>{
                // Guardrail: confirm + snapshot before destructive recascade
                if (!(await askConfirm({
                  title: "Strip all pinned dates and recalculate?",
                  body: "Every project is recalculated from predecessor logic.\n\nA backup snapshot is saved first — you can restore from Version History if needed.",
                  confirmLabel: "Recalculate", danger: true,
                }))) return;
                setData(d => {
                  try { window.storage.set("hs-v1", JSON.stringify(stripViewState(d)), { label: "pre-recascade", skipSanity: true }); } catch {}
                  setHolidaySet(buildHolidaySet(d.settings?.holidays || DEFAULT_HOLIDAYS));
                  const newProjects = {};
                  Object.entries(d.projects).forEach(([pid, proj]) => {
                    let tasks = proj.tasks.map(({pinnedStart, _pinStart, __wasDirectEdit, ...t}) => t);
                    tasks = recomputeSchedule(tasks);
                    newProjects[pid] = {...proj, tasks};
                  });
                  return {...d, _pinnedClean: true, projects: newProjects};
                });
                onClose();
              }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Recascade all projects
            </button>
          </div>
        )}

        {/* B566 — "Link a local backup file" moved here from the floppy Save button (the Save
            control is now the unified cloud sync badge in the shell header). Cloud auto-save is
            always on; this is the optional second copy, written to a local .html file on disk on
            every save (Chrome/Edge File System Access API). */}
        {typeof openFile === "function" && (<>
          <SectionHdr id="backup" title="Local backup file" />
          {open.backup && (
            <div style={{paddingBottom:6}}>
              <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.5,marginBottom:8}}>
                Your schedule <strong>auto-saves to the cloud</strong> automatically — this is optional.
                Link a local <strong>.html</strong> file (Chrome or Edge) to ALSO keep a copy on this
                computer, re-written on every save.
              </div>
              <button className="btn"
                title={fileLinked ? "A local backup file is linked — click to choose a different file" : "Pick a local .html file to mirror every save into"}
                style={{display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"4px 11px",
                  borderColor: fileLinked ? "#86efac" : "var(--bd2)", color: fileLinked ? "#16a34a" : "var(--txt)"}}
                onClick={()=>{ openFile(); }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                </svg>
                {fileLinked ? "Backup file linked ✓ — choose another" : "Link a local backup file…"}
              </button>
            </div>
          )}
        </>)}
      </div>

    </div>
  );
}

// ── FormatPanel — how the chart looks (row height, bar labels). Settings stays behavioral. ──
function FormatPanel({data, setData, onClose}) {
  const s = data.settings || {};
  const upd = patch => setData(d => ({...d, settings:{...d.settings, ...patch}}));
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const Toggle = ({on, onChange}) => (
    <span onClick={e=>{e.stopPropagation();onChange(!on);}} style={{width:28,height:15,borderRadius:8,background:on?"var(--amber)":"var(--bd2)",position:"relative",display:"inline-block",cursor:"pointer",transition:"background .15s",flexShrink:0}}>
      <span style={{width:11,height:11,borderRadius:"50%",background:"var(--bg)",boxShadow:"0 1px 3px rgba(0,0,0,.2)",position:"absolute",top:2,left:on?15:2,transition:"left .15s"}} />
    </span>
  );
  const SegBtn = ({options, value, onChange}) => (
    <div style={{display:"inline-flex",background:"#f0f0f0",borderRadius:6,padding:2,gap:2}}>
      {options.map(o=>(
        <button key={String(o.v)} onClick={()=>onChange(o.v)}
          style={{border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:4,
            background:value===o.v?"#fff":"transparent",color:value===o.v?"var(--amber)":"var(--mut)",
            boxShadow:value===o.v?"0 1px 2px rgba(0,0,0,.12)":"none",transition:"all .12s"}}>{o.l}</button>
      ))}
    </div>
  );
  const rh = Math.min(34, Math.max(20, s.rowHeight || 24));
  return (
    <div style={{position:"fixed",top:48,right:12,width:300,background:"var(--bg)",border:"1px solid var(--bd2)",
      borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.14)",zIndex:9999,padding:"0 16px 14px",
      maxHeight:"calc(100vh - 70px)",overflowY:"auto",fontFamily:"inherit"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 8px",borderBottom:"1px solid var(--bd)",position:"sticky",top:0,background:"var(--bg)",zIndex:2}}>
        <span style={{fontSize:13,fontWeight:700,color:"var(--txt)"}}>Format</span>
        <button onClick={onClose} title="Close" style={{background:"none",border:"none",cursor:"pointer",fontSize:15,color:"var(--mut)",padding:"2px 4px",lineHeight:1}}>✕</button>
      </div>

      <div style={{padding:"8px 0 2px"}}>
        <span style={{fontSize:12,color:"var(--txt)",display:"block",marginBottom:6}}>Row height — grid &amp; Gantt</span>
        <div style={{position:"relative",height:20,display:"flex",alignItems:"center"}}>
          <div style={{position:"absolute",left:0,right:0,height:4,borderRadius:2,background:"var(--bd2)",overflow:"hidden",pointerEvents:"none"}}>
            <div style={{width:`${((rh-20)/(34-20))*100}%`,height:"100%",background:"var(--amber)",transition:"width .05s"}} />
          </div>
          <input type="range" min={20} max={34} value={rh}
            onChange={e=>upd({rowHeight:+e.target.value})}
            style={{width:"100%",appearance:"none",WebkitAppearance:"none",background:"transparent",
              margin:0,cursor:"pointer",position:"relative",zIndex:1}} />
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:2}}>
          <span style={{fontSize:10,color:"var(--mut)"}}>20px</span>
          <span style={{fontSize:12,fontWeight:600,color:"var(--amber)"}}>{rh}px</span>
          <span style={{fontSize:10,color:"var(--mut)"}}>34px</span>
        </div>
      </div>

      <div style={{padding:"10px 0 2px",borderTop:"1px solid var(--bd)",marginTop:8}}>
        <span style={{fontSize:12,color:"var(--txt)",display:"block",marginBottom:5}}>Gantt bar labels</span>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead><tr>
            <th style={{textAlign:"left",padding:"3px 6px",borderBottom:"1px solid var(--bd)",fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase"}}>Position</th>
            <th style={{textAlign:"left",padding:"3px 6px",borderBottom:"1px solid var(--bd)",fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase"}}>Field</th>
          </tr></thead>
          <tbody>
            {[["left","Left of bar"],["right","Right of bar"]].map(([k,label])=>(
              <tr key={k}>
                <td style={{padding:"4px 6px",borderBottom:"1px solid var(--bd)",color:"var(--txt)"}}>{label}</td>
                <td style={{padding:"2px 4px",borderBottom:"1px solid var(--bd)"}}>
                  <select value={(s.barLabels||{})[k]||"none"}
                    onChange={e=>upd({barLabels:{...(s.barLabels||{}),[k]:e.target.value}})}
                    style={{width:"100%",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:3,padding:"3px 6px",fontSize:11,color:"var(--txt)",fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                    <option value="none">None</option>
                    <option value="start">Start date</option>
                    <option value="end">End date</option>
                    <option value="owner">Owner</option>
                    <option value="pct">% complete</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 2px 0"}}>
          <span style={{fontSize:12,color:"var(--txt)"}}>Show year in dates</span>
          <Toggle on={(s.barLabels||{}).year!==false} onChange={v=>upd({barLabels:{...(s.barLabels||{}),year:v}})} />
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 2px 0"}}>
          <span style={{fontSize:12,color:"var(--txt)"}}>Task name alignment</span>
          <SegBtn options={[{l:"Left",v:"left"},{l:"Center",v:"center"},{l:"Right",v:"right"}]}
            value={resolveLabelAlign(data.projects?.[data.aPid])}
            onChange={v=>writeLabelAlign(setData, data.aPid, v)} />
        </div>
        <div style={{fontSize:10,color:"var(--mut)",marginTop:6,lineHeight:1.4}}>
          Task names sit beside the bar (Left / Right), on it (Center), or — when there's no room — above it, never on the fill. Saved per project, and used on screen and in the PDF exhibit. The small date/owner labels are set by the table above.
        </div>
      </div>
    </div>
  );
}

// ── RuleColorPicker ──────────────────────────────────────
// Small inline color-swatch picker for one rule row — click the dot to choose which existing
// health color the rule assigns. No new colors: options come straight from this plan's own HK
// palette (the same list every StatusPicker offers), never invented here.
//
// B1449(schedule) — the dropdown used to render INLINE (position:absolute, no portal) inside
// AutomationPanel, whose own root has onMouseDown={e=>e.stopPropagation()} (line ~11579, the same
// pattern every side panel in this file uses — SettingsPanel, ContactsPanel, MeetingCalendarsModal
// — to keep a click anywhere inside the panel from being misread as an "outside click" by some
// OTHER already-open picker's own document-level dismiss listener). That's fine for a panel with
// no floating sub-menu of its own, but this picker's dropdown DOES need to hear document-level
// mousedowns to know when to close — and the panel's blanket stopPropagation was eating every one
// of them before they ever left the panel's own DOM subtree, not just clicks on the menu itself.
// Measured live: with the dropdown open, a click on the panel's own blank space, or on a DIFFERENT
// rule row's <select>, left it open and floating over that control — only a click that landed
// outside the whole panel (on the grid behind it) closed it. That's exactly Michael's report ("I
// clicked everywhere else, but it just closed off that drop down").
// Two-part fix, matching how every other menu in this app behaves (HealthPicker/StatusPicker, the
// Status-options editor at ~8301): (1) portal the dropdown to document.body as position:fixed
// computed from the trigger's own rect, with the stopPropagation pair on the MENU's own root
// ({...MENU_STOPS_GRID}) — a click landing inside the menu still can't leak out and arm grid
// drag-select (NEW-2). (2) Listen for the outside-click in the CAPTURE phase, not bubble — a
// capture-phase document listener runs before the event ever reaches AutomationPanel's bubble-
// phase stopPropagation, so it fires for every click outside this picker regardless of which
// stopPropagation-wrapped panel it's sitting inside. Every other picker here is bubble-phase, but
// none of them live inside a panel that blanket-stops propagation the way this one does — this is
// the minimal change that makes the DISMISS RULE (click anywhere outside it closes it) match
// theirs exactly, without touching AutomationPanel or any other panel's own behavior.
function RuleColorPicker({value, onChange}) {
  const [open, setOpen] = useState(false);
  const dotRef  = useRef(null);
  const menuRef = useRef(null);
  const pos = useAnchoredPopover(open, dotRef, r => ({top: r.bottom + 4, left: r.right - 110}), () => setOpen(false));   // NEW-1

  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (!dotRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  const openMenu = () => {
    setOpen(o => !o);
  };

  const hh = HEALTH[value] || HEALTH.gray;
  return (
    <span style={{position:"relative",flexShrink:0}}>
      <span ref={dotRef} onClick={openMenu} title={hh.label} data-rule-color-swatch="1"
        style={{width:16,height:16,borderRadius:"50%",background:hh.dot,border:hh.dot==="#ffffff"?"1.5px solid #d1d5db":hh.border,
          display:"block",cursor:"pointer"}} />
      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} {...MENU_STOPS_GRID} data-rule-color-menu="1"
          style={{position:"fixed",top:pos.top,left:pos.left,background:"var(--bg)",border:"1px solid var(--bd2)",
            borderRadius:6,padding:"4px",display:"flex",flexDirection:"column",gap:2,zIndex:10000,
            boxShadow:"0 4px 14px rgba(0,0,0,0.15)",minWidth:110}}>
          {HK.map(hk => { const h = HEALTH[hk]; return (
            <span key={hk} onClick={()=>{onChange(hk);setOpen(false);}}
              style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",borderRadius:4,cursor:"pointer",
                background: hk===value?"var(--surf)":"transparent"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
              onMouseLeave={e=>e.currentTarget.style.background = hk===value?"var(--surf)":"transparent"}>
              <span style={{width:9,height:9,borderRadius:"50%",background:h.dot,border:h.dot==="#ffffff"?"1.5px solid #d1d5db":h.border,flexShrink:0}} />
              <span style={{fontSize:11,color:"var(--txt)"}}>{h.label}</span>
            </span>
          ); })}
        </div>,
        document.body
      )}
    </span>
  );
}

// ── ConditionRow / ConditionGroup — the field/comparison/value builder shared by a rule's IF and
// UNLESS groups (B785744). One row = pick a FIELD, pick a COMPARISON valid for that field's type,
// give a VALUE if the comparison needs one. Multiple rows in a group combine with AND/OR.
function ConditionRow({cond, onChange, onRemove}) {
  const field = RULE_FIELD_BY_K[cond.field] || RULE_FIELDS[0];
  const ops = opsForField(field.k);
  const op = ops.find(o => o.k === cond.op) || ops[0];
  const setField = fk => {
    const f = RULE_FIELD_BY_K[fk];
    const newOp = opsForField(fk)[0];
    onChange({field:fk, op:newOp.k, value: newOp.needsValue ? (newOp.defaultValue ?? (f.type==="status" ? "red" : "")) : undefined});
  };
  const setOp = ok => {
    const newOp = ops.find(o => o.k === ok);
    onChange({op:ok, value: newOp.needsValue ? (cond.value ?? newOp.defaultValue ?? (field.type==="status" ? "red" : "")) : undefined});
  };
  const selSt = {fontSize:11,color:"var(--txt)",border:"1px solid var(--bd2)",borderRadius:4,padding:"3px 4px",background:"var(--bg)",minWidth:0};
  return (
    <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
      <select value={field.k} onChange={e=>setField(e.target.value)} style={{...selSt,flex:"1 1 120px"}}>
        {RULE_FIELDS.map(f => <option key={f.k} value={f.k}>{f.label}</option>)}
      </select>
      <select value={op?.k} onChange={e=>setOp(e.target.value)} style={{...selSt,flex:"1 1 130px"}}>
        {ops.map(o => <option key={o.k} value={o.k}>{o.label}</option>)}
      </select>
      {op?.needsValue && field.type==="date" && (
        <input type="number" min={0} value={cond.value ?? op.defaultValue ?? 0}
          onChange={e=>onChange({value: Math.max(0, parseInt(e.target.value,10)||0)})}
          style={{width:36,fontSize:11,border:"1px solid var(--bd2)",borderRadius:4,padding:"3px 4px",flexShrink:0}} />
      )}
      {op?.needsValue && op.valueKind==="status" && (
        <RuleColorPicker value={cond.value || "red"} onChange={hk=>onChange({value:hk})} />
      )}
      {op?.needsValue && op.valueKind==="text" && (
        <input {...NO_AUTOFILL} type="text" value={cond.value || ""} placeholder="value"
          onChange={e=>onChange({value:e.target.value})}
          style={{width:80,fontSize:11,border:"1px solid var(--bd2)",borderRadius:4,padding:"3px 4px",flexShrink:1,minWidth:0}} />
      )}
      {op?.needsValue && op.valueKind==="number" && (
        <input type="number" value={cond.value ?? 0}
          onChange={e=>onChange({value: parseFloat(e.target.value)||0})}
          style={{width:64,fontSize:11,border:"1px solid var(--bd2)",borderRadius:4,padding:"3px 4px",flexShrink:0}} />
      )}
      <span onClick={onRemove} title="Remove condition"
        style={{cursor:"pointer",color:"var(--mut)",fontSize:12,lineHeight:1,flexShrink:0,padding:"0 2px",marginLeft:"auto"}}>&#x2715;</span>
    </div>
  );
}
function ConditionGroup({conds, combinator, onChange, addLabel}) {
  const setConds = next => onChange({conds: next, combinator});
  const updCond = (i, patch) => setConds(conds.map((c,ci) => ci===i ? {...c, ...patch} : c));
  const removeCond = i => setConds(conds.filter((_,ci) => ci!==i));
  const addCond = () => {
    const op = opsForField(RULE_FIELDS[0].k)[0];
    setConds([...conds, {field:RULE_FIELDS[0].k, op:op.k, value: op.needsValue ? op.defaultValue : undefined}]);
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {conds.map((c,i) => (
        <React.Fragment key={i}>
          {i>0 && (
            <div style={{display:"flex",gap:4}}>
              {["AND","OR"].map(op => (
                <span key={op} onClick={()=>onChange({conds, combinator:op})}
                  style={{fontSize:9,fontWeight:700,letterSpacing:".03em",cursor:"pointer",padding:"1px 6px",borderRadius:3,
                    color: combinator===op ? "var(--on-accent)" : "var(--mut)",
                    background: combinator===op ? "var(--blue)" : "var(--surf)"}}>{op}</span>
              ))}
            </div>
          )}
          <ConditionRow cond={c} onChange={patch=>updCond(i,patch)} onRemove={()=>removeCond(i)} />
        </React.Fragment>
      ))}
      <span onClick={addCond} style={{fontSize:10.5,color:"var(--amber)",fontWeight:600,cursor:"pointer",alignSelf:"flex-start"}}>+ {addLabel}</span>
    </div>
  );
}

// ── AutomationPanel — IF/THEN/UNLESS rule builder (B785744, rebuild #2) ──────────────────────
// Replaces the ordered-list-of-canned-conditions panel from #1073 (owner, verbatim: "you've got
// like two variables here"). The real ask was Smartsheet/MS-Project-style conditional formatting:
// pick a field, pick a comparison, give a value, combine with AND/OR, and — the piece the old
// panel had no way to express — an UNLESS exception clause, so "Complete beats overdue" is a rule
// you can read and edit instead of a hardcoded early-return. Rules stay an ORDERED list, first
// FIRING rule wins (unchanged mental model — the owner kept this over "worst color always wins").
// `rules` resolves via getHealthRules, which now also carries v1 (old ordered-list) and the very
// old 3-toggle cfRules forward into this shape live — nothing repaints until this panel is opened
// and something in it is touched (matches the migration precedent this panel has always used).
function AutomationPanel({data, setData, onClose}) {
  const s = data.settings || DEFAULT_SETTINGS;
  const rules = getHealthRules(s);
  const setRules = next => setData(d => ({...d, settings:{...d.settings, healthRules: next}}));
  const updRule = (id, patch) => setRules(rules.map(r => r.id === id ? {...r, ...patch} : r));
  const removeRule = id => setRules(rules.filter(r => r.id !== id));
  const moveRule = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setRules(next);
  };
  const addRule = () => {
    const op = opsForField(RULE_FIELDS[0].k)[0];
    setRules([...rules, {
      id:`r${Date.now()}${Math.random().toString(36).slice(2,6)}`,
      when:[{field:RULE_FIELDS[0].k, op:op.k, value: op.needsValue ? op.defaultValue : undefined}], whenCombinator:"AND",
      color:"red",
      unless:[], unlessCombinator:"OR",
    }]);
  };
  const resetDefaults = () => setRules(DEFAULT_HEALTH_RULES.map(r => ({
    ...r, id:`r${Date.now()}${Math.random().toString(36).slice(2,6)}`,
    when: r.when.map(c=>({...c})), unless: r.unless.map(c=>({...c})),
  })));

  return (
    <div style={{position:"fixed",top:48,right:12,width:440,maxHeight:"calc(100vh - 64px)",overflowY:"auto",background:"var(--bg)",border:"1px solid var(--bd2)",
      borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.14)",zIndex:9999,padding:"0 16px 14px"}}
      onMouseDown={e=>e.stopPropagation()}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 10px",position:"sticky",top:0,background:"var(--bg)"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          {/* Lightning bolt icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          <span style={{fontWeight:600,fontSize:13,color:"var(--txt)"}}>Automation</span>
        </div>
        <span onClick={onClose} style={{cursor:"pointer",color:"var(--mut)",fontSize:16,lineHeight:1}}>&#x2715;</span>
      </div>

      {/* Description */}
      <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.5,marginBottom:10,paddingBottom:10,borderBottom:"1px solid var(--bd)"}}>
        First matching rule sets a task's color — IF its conditions are true, THEN it sets the status, UNLESS an exception applies.
      </div>

      {/* Rules */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {rules.length === 0 && (
          <div style={{fontSize:11,color:"var(--mut)",padding:"6px 2px"}}>No rules yet — a task's status stays exactly what you set it to.</div>
        )}
        {rules.map((r, i) => (
          <div key={r.id} style={{display:"flex",flexDirection:"column",gap:7,padding:"8px 9px",borderRadius:6,background:"var(--surf)",border:"1px solid var(--bd)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--mut)"}}>Rule {i+1}</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span onClick={()=>moveRule(i,-1)} title="Move up"
                  style={{cursor:i===0?"default":"pointer",opacity:i===0?0.3:1,fontSize:10,color:"var(--mut)"}}>▲</span>
                <span onClick={()=>moveRule(i,1)} title="Move down"
                  style={{cursor:i===rules.length-1?"default":"pointer",opacity:i===rules.length-1?0.3:1,fontSize:10,color:"var(--mut)"}}>▼</span>
                <span onClick={()=>removeRule(r.id)} title="Delete rule"
                  style={{cursor:"pointer",color:"var(--mut)",fontSize:13,lineHeight:1}}>&#x2715;</span>
              </div>
            </div>

            <div>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:".05em",color:"var(--mut)",marginBottom:3}}>IF</div>
              <ConditionGroup conds={r.when} combinator={r.whenCombinator}
                onChange={({conds,combinator})=>updRule(r.id,{when:conds, whenCombinator:combinator})}
                addLabel="Add condition" />
            </div>

            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:".05em",color:"var(--mut)"}}>THEN set status to</span>
              <RuleColorPicker value={r.color} onChange={hk=>updRule(r.id,{color:hk})} />
            </div>

            <div>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:".05em",color:"var(--mut)",marginBottom:3}}>
                UNLESS <span style={{fontWeight:400,textTransform:"none",letterSpacing:0}}>(optional)</span>
              </div>
              {r.unless && r.unless.length > 0 ? (
                <ConditionGroup conds={r.unless} combinator={r.unlessCombinator}
                  onChange={({conds,combinator})=>updRule(r.id,{unless:conds, unlessCombinator:combinator})}
                  addLabel="Add exception" />
              ) : (
                <span onClick={()=>updRule(r.id,{unless:[{field:"status",op:"is",value:"green"}]})}
                  style={{fontSize:10.5,color:"var(--amber)",fontWeight:600,cursor:"pointer"}}>+ Add exception</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / reset */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:10,paddingTop:10,borderTop:"1px solid var(--bd)"}}>
        <span onClick={addRule} style={{fontSize:11.5,color:"var(--amber)",fontWeight:600,cursor:"pointer"}}>+ Add rule</span>
        <span onClick={resetDefaults} style={{fontSize:11,color:"var(--mut)",cursor:"pointer"}}>Reset to suggested defaults</span>
      </div>
    </div>
  );
}

// ── SplitView ─────────────────────────────────────────────
// B1281648 (RECURRENCE ×3 of B1241745) — dispatches to the phone-width stacked layout or the
// desktop resizable side-by-side layout. See PhoneSplitView's own header comment for why the
// phone shape changed from "one pane at a time" to "both panes, stacked."
function SplitView(props) {
  return props.isMobile ? <PhoneSplitView {...props} /> : <DesktopSplitView {...props} />;
}

// ── PhoneSplitView (stacked, B1281648) ───────────────────
// The owner's report, verbatim, on a real iPhone after three prior shipped fixes (#1490, #1497,
// #1504): "Nothing happens, it's stays or goes to gant or grid." Every prior fix kept Split
// showing exactly ONE pane at phone width (first via its own switcher, then via the header's
// existing Grid/Split/Gantt pill) — which is indistinguishable from just picking Grid or Gantt
// directly, so from his chair Split was a dead button no matter how correctly the pill's own
// highlight tracked it. THE FIX IS STRUCTURAL, not another highlight tweak: at phone width, Split
// now renders the task grid AND the Gantt chart at the same time, one above the other, each in
// its own independently-scrolling pane, with a visible divider between them — so it is
// immediately obvious Split is a third thing, never a relabelled Grid or Gantt. Grid and Gantt
// picked directly are UNCHANGED — still full-height, single-pane, at every width.
// Deliberately NOT draggable/resizable (unlike the desktop divider below) — a touch-drag divider
// risks fighting the page's own vertical scroll gestures, and the brief did not ask for resize;
// the split ratio reuses the existing Settings › "default split" percentage (the same number that
// already means "how much of Split's space goes to grid vs. gantt" on desktop) so a session that
// prefers more Gantt there gets the same preference here, clamped to a range that keeps either
// phone pane from shrinking to nothing.
function PhoneSplitView(props) {
  const settings = props.data?.settings || DEFAULT_SETTINGS;
  const topPct = Math.min(70, Math.max(30, settings.defaultSplit || 60));
  return (
    <div data-split-stack="1" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
      <div data-split-pane="grid" style={{flex:`0 0 ${topPct}%`,minHeight:0,overflow:"hidden",display:"flex"}}>
        <GridView {...props} />
      </div>
      <div data-split-divider="1" style={{height:9,flexShrink:0,background:"var(--bd2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{width:32,height:3,borderRadius:2,background:"var(--mut)",opacity:0.5}} />
      </div>
      <div data-split-pane="gantt" style={{flex:1,minHeight:0,overflow:"hidden",display:"flex"}}>
        <GanttView tasks={props.tasks} updateTask={props.updateTask} pxPerDay={props.ganttPPD} onZoomChange={props.setGanttPPD} rolledHealthMap={props.rolledHealthMap} proj={props.proj} onMouseEnter={()=>props.setHoverZone?.('gantt')} selectedId={props.selectedId} setSelectedId={props.setSelectedId} settings={props.data?.settings} rowZoom={props.gridZoom || 1} />
      </div>
    </div>
  );
}

// ── DesktopSplitView (resizable) ──────────────────────────
function DesktopSplitView(props) {
  const settings = props.data?.settings || DEFAULT_SETTINGS;
  const gridRef      = useRef(null);
  const ganttRef     = useRef(null);
  const [split, setSplit] = useState(() => settings.defaultSplit || 60);
  const containerRef = useRef(null);
  const divDragging  = useRef(false);
  const [snapMode, setSnapMode]     = useState(() => settings.snapDefault !== false);
  const [dragging,  setDragging]    = useState(false);
  const [_hintY,    setHintY]       = useState(0);
  const snapModeRef = useRef(settings.snapDefault !== false);
  useEffect(() => { snapModeRef.current = snapMode; }, [snapMode]);
  // Stay in sync when settings change
  useEffect(() => {
    const v = settings.snapDefault !== false;
    setSnapMode(v);
    snapModeRef.current = v;
  }, [settings.snapDefault]);

  // NEW-1 (2026-11-03) — keep the two panes level WITHOUT ever writing a stale value back at the pane being scrolled.
  // The old guard (`lock`, released on the next animation frame) ignored every second scroll event of the pane the
  // person was actually driving, and — because the rAF fires in the same frame as the echo event it was meant to
  // swallow — could let the OTHER pane's echo through, rewriting the driven pane to where it was a frame ago (which
  // also cancels a smooth wheel scroll in flight). Now: each programmatic write remembers the exact value it wrote, and
  // the scroll event that write causes is recognised by that value and dropped — nothing else is ever ignored.
  const echo = useRef({ grid: null, gantt: null });
  const sync = src => e => {
    const st = e.currentTarget.scrollTop, dst = src === "grid" ? "gantt" : "grid";
    if (echo.current[src] === st) { echo.current[src] = null; return; }          // our own write coming back
    echo.current[src] = null;
    const other = src === "grid" ? ganttRef.current : gridRef.current;
    if (!other || other.scrollTop === st) return;
    other.scrollTop = st;
    const landed = other.scrollTop;
    if (landed === st) {                                                          // a scroll event WILL follow — recognise it
      echo.current[dst] = landed;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (echo.current[dst] === landed) echo.current[dst] = null; }));
    }
  };

  const liveColWidths = useRef(null); // updated by GridView via onColWidths

  const onDividerDown = e => {
    e.preventDefault();
    divDragging.current = true;
    setDragging(true);
    setHintY(e.clientY);
    // Measure the grid's vertical scrollbar width — it sits inside the grid pane and would otherwise cover the last column
    const gridScroll = containerRef.current.querySelector('[data-grid-scroll="1"]');
    const scrollbarW = gridScroll ? Math.max(0, gridScroll.offsetWidth - gridScroll.clientWidth) : 0;
    const snapOffset = scrollbarW + 2; // scrollbar + small breathing room past the column edge
    // Use actual rendered column widths if available, fall back to COLS defaults
    const cw = liveColWidths.current;
    // B212 — snap to the VISIBLE columns in their configured order (cw is {order, widths}).
    const order = (cw && cw.order) || DEFAULT_GRID_COLS;
    const widths = (cw && cw.widths) || {};
    const colEdges = order.reduce((acc, k) => { acc.push((acc[acc.length-1]||0) + (widths[k] ?? COL_BY_K[k]?.w ?? 100)); return acc; }, []);
    const move = ev => {
      if (!divDragging.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rawPx = ev.clientX - rect.left;
      let pct;
      if (snapModeRef.current) {
        const nearest = colEdges.reduce((best, edge) =>
          Math.abs(edge - rawPx) < Math.abs(best - rawPx) ? edge : best, colEdges[0]);
        pct = Math.min(82, Math.max(18, (nearest + snapOffset) / rect.width * 100));
      } else {
        pct = Math.min(82, Math.max(18, rawPx / rect.width * 100));
      }
      setSplit(pct);
    };
    // Snap mode jumps the divider to the nearest column edge, so the pointer is routinely OUTSIDE the grab zone mid-drag.
    const release = window.pinSchedCursor("col-resize", { onExit: () => up() });
    const up = () => {
      divDragging.current = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      release();
      setTimeout(() => setDragging(false), 5000);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  return (
    <div ref={containerRef} style={{flex:1,display:"flex",overflow:"hidden",userSelect:"none"}}>
      <div style={{width:`${split}%`,overflow:"hidden",display:"flex",flexShrink:0}}>
        <GridView {...props} scrollRef={gridRef} onScroll={sync("grid")} onColWidths={w => { liveColWidths.current = w; }} />
      </div>
      <div style={{width:1,background:"var(--bd2)",cursor:"col-resize",flexShrink:0,zIndex:20,transition:"background .15s",position:"relative"}}
        onMouseDown={onDividerDown}
        onMouseEnter={e=>e.currentTarget.style.background="var(--blue)"}
        onMouseLeave={e=>e.currentTarget.style.background="var(--bd2)"}>
        {/* Grab zone extends only rightward into the Gantt — never back into the grid */}
        <div style={{position:"absolute",top:0,bottom:0,left:0,right:-9,cursor:"col-resize",zIndex:21}}
          onMouseDown={onDividerDown}
          onMouseEnter={e=>e.currentTarget.parentElement.style.background="var(--blue)"}
          onMouseLeave={e=>e.currentTarget.parentElement.style.background="var(--bd2)"} />
        {dragging && ReactDOM.createPortal(
          <div onMouseDown={e=>e.stopPropagation()}
            style={{position:"fixed", top: 12, right: 16, transform: "none",
              background:"#1f2328", borderRadius:6, padding:"3px 4px",
              display:"flex", gap:3, zIndex:9999, boxShadow:"0 2px 10px rgba(0,0,0,0.25)",
              pointerEvents:"all"}}>
            {[{label:"Snap", val:true},{label:"Free", val:false}].map(({label,val}) => (
              <span key={label}
                onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setSnapMode(val); snapModeRef.current = val; }}
                style={{padding:"3px 10px", borderRadius:4, fontSize:11, cursor:"pointer",
                  fontFamily:"'Inter',system-ui,sans-serif", fontWeight:500, whiteSpace:"nowrap",
                  background: snapMode===val ? "var(--amber)" : "transparent",
                  color: snapMode===val ? "#fff" : "#9ca3af",
                  transition:"background .12s,color .12s"}}>
                {label}
              </span>
            ))}
          </div>,
          document.body
        )}
      </div>
      <div style={{flex:1,overflow:"hidden",display:"flex"}}>
        <GanttView tasks={props.tasks} updateTask={props.updateTask} pxPerDay={props.ganttPPD} onZoomChange={props.setGanttPPD} scrollRef={ganttRef} onScroll={sync("gantt")} rolledHealthMap={props.rolledHealthMap} proj={props.proj} onMouseEnter={()=>props.setHoverZone?.('gantt')} selectedId={props.selectedId} setSelectedId={props.setSelectedId} settings={props.data?.settings} rowZoom={props.gridZoom || 1} />
      </div>
    </div>
  );
}
installProjectOrderListener();


// ── PDF helpers ──────────────────────────────────────────
const PAGE_SIZES = {
  letter:  {label:"Letter (8.5 × 11 in)",  w:8.5,  h:11,    css:"letter",    short:"Letter"},
  legal:   {label:"Legal (8.5 × 14 in)",   w:8.5,  h:14,    css:"legal",     short:"Legal"},
  tabloid: {label:"Tabloid (11 × 17 in)",  w:11,   h:17,    css:"11in 17in", short:"11×17"},
  a4:      {label:"A4 (8.27 × 11.69 in)", w:8.27, h:11.69, css:"A4",        short:"A4"},
};
function buildGanttSVG(projects, svgWidth, orientation, opts = {}) {
  const noLabels = !!opts.noLabels;
  const ROW_H=18, LABEL_W=noLabels ? 0 : (orientation==="landscape"?200:155);
  const ganttW=svgWidth-LABEL_W;
  // NEW-1 / PDF-PARITY — EVERY glyph in a print row is BOTTOM-ALIGNED on one baseline, exactly as
  // on screen, so the always-above name caption owns the row's upper band. The summary bracket
  // already sat on this baseline; the leaf bar and the milestone diamond used to be vertically
  // CENTRED (an old screen↔print drift), which left a 9px-tall caption nowhere to go but on top of
  // the glyph it names. The bar renderer AND the dependency router both read these helpers, so the
  // two can no longer disagree about where a glyph is.
  // NEW-1 (name rank) — the numbers come from the ONE shared geometry block (GANTT_PROFILES.print), the
  // same helpers the on-screen chart reads: a name keeps its full ranked size and the glyph (bar /
  // bracket / diamond) gives way, so the top level can never print smaller than the level below it.
  const PP=GANTT_PROFILES.print;
  const leafBand=yTop=>{const g=ganttLeafGeom(PP,ROW_H), top=yTop+g.top; return {top,bot:top+g.h,mid:top+g.h/2,h:g.h};};
  const mileBand=(yTop,depth)=>{const g=ganttMilestoneGeom(PP,ROW_H,depth); return {top:yTop+g.top,bot:yTop+g.bot,mid:yTop+g.cy,half:g.half};};
  const summaryBand=(yTop,depth)=>{const g=ganttSummaryGeom(PP,ROW_H,depth);
    return {top:yTop+g.top,bot:yTop+g.bot,mid:yTop+g.mid,SPAN:g.span,LEG:g.leg};};
  const pd=s=>new Date(s+"T12:00:00"), fd=d=>d.toISOString().slice(0,10);
  const allTasks=projects.flatMap(p=>p.tasks);
  if(!allTasks.length) return "";
  // Drop empty AND unparseable dates so a single bad value (imported/hand-edited) can't
  // poison the min/max → NaN geometry across the whole exhibit.
  const dates=allTasks.flatMap(t=>[t.start,t.end]).filter(d=>d&&!isNaN(pd(d))).sort();
  if(!dates.length) return "";
  const minD=dates[0], maxD=dates[dates.length-1];
  const DAY=86400000;
  const addDays=(s,n)=>fd(new Date(pd(s).getTime()+Math.round(n)*DAY));
  const getDepth=(tasks,id)=>{let dep=0,t=tasks.find(x=>x.id===id);while(t&&t.parentId!==null){dep++;t=tasks.find(x=>x.id===t.parentId);}return Math.min(dep,3);};
  // ── Visible time window: auto-fit by default (B401), optional timescale + pan (B361) ──
  // Start from the natural [minD,maxD]; EXTEND it just enough that every start/end label
  // sits on the sheet without clipping (frame it — never move the labels); then apply the
  // owner's timescale unit / fine-zoom / pan if set. Default (no unit, mul 1, pan 0) = pure
  // auto-fit. The discrete unit and the continuous multiplier compose into ONE span, so the
  // sidebar selector and the toolbar control can't fight each other.
  let winStart, winEnd, totalDays, ppd;
  {
    const td0=Math.max(1,Math.ceil((pd(maxD)-pd(minD))/DAY)+2), ppd0=ganttW/td0;
    const xo0=d=>LABEL_W+Math.round((pd(d)-pd(minD))/DAY*ppd0);
    let leadPx=0, trailPx=0;
    try{
      allTasks.forEach(t=>{
        if(!t||!t.start||!t.end||isNaN(pd(t.start))||isNaN(pd(t.end))) return;
        const proj=projects.find(p=>p.tasks.some(x=>x.id===t.id));
        const depth=proj?getDepth(proj.tasks,t.id):0;
        const isMile=t.duration===0, isParent=proj?proj.tasks.some(x=>x.parentId===t.id):false;
        if(opts.barNames===false) return;
        const bx=xo0(t.start), bw=Math.max(3,Math.round((pd(t.end)-pd(t.start))/DAY*ppd0));
        const kind=isMile?"milestone":isParent?"summary":"leaf";
        const align=opts.labelAlign||resolveLabelAlign(proj);
        const fs=ganttNameSize(GANTT_PROFILES.print,depth);
        const nm=t.name==null?"":String(t.name), lw=estLabelWidth(nm,fs);
        const place=placeGanttLabel({kind,align,bx,bw:isMile?0:bw,rowTop:0,barTopY:0,labelW:lw,
          chartL:-1e9,chartR:1e9,capHalf:ganttCaptionHalf(fs)});
        const x0=place.anchor==="start"?place.x:place.anchor==="middle"?place.x-lw/2:place.x-lw, x1=x0+lw;
        if(LABEL_W-x0>leadPx) leadPx=LABEL_W-x0;
        if(x1-svgWidth>trailPx) trailPx=x1-svgWidth;
      });
    }catch(_){ leadPx=0; trailPx=0; }
    // Cap the lead/trail so a long label can't crush the schedule into a sliver of the page —
    // give breathing room, then let an over-long label clamp/flip as before (B401 intent).
    const cap=Math.max(8,Math.ceil(td0*0.22));
    const leadD=Math.min(cap,Math.max(0,Math.ceil((leadPx+4)/ppd0))), trailD=Math.min(cap,Math.max(0,Math.ceil((trailPx+4)/ppd0)));
    const afStart=addDays(minD,-leadD), afEnd=addDays(maxD,trailD+2);
    const afDays=Math.max(1,Math.ceil((pd(afEnd)-pd(afStart))/DAY));
    const PPU={days:14,weeks:3.7,months:1.5,quarters:0.57};   // target px/day per discrete unit
    const mul=(typeof opts.zoomMul==="number"&&opts.zoomMul>0)?opts.zoomMul:1;
    let vis=(opts.timeUnit&&PPU[opts.timeUnit])?(ganttW/PPU[opts.timeUnit]):afDays;
    vis=Math.max(3,Math.min(vis/mul,afDays*16));
    const panFrac=(typeof opts.panFrac==="number"?opts.panFrac:0);
    const scroll=afDays-vis;
    // When zoomed in, default the landing to center on TODAY (clamped) so it lands on current
    // work rather than a far-back empty stretch; the user's pan is an offset from there (B361).
    const todayDays=(pd(fdLocal(new Date()))-pd(afStart))/DAY;
    const todayFrac=scroll>0?Math.max(0,Math.min(1,(todayDays-vis/2)/scroll)):0;
    const eff=Math.max(0,Math.min(1,todayFrac+panFrac));
    const start=scroll>0?addDays(afStart,Math.round(eff*scroll)):addDays(afStart,Math.round(scroll/2));
    winStart=start; winEnd=addDays(start,vis); totalDays=Math.max(1,vis); ppd=ganttW/totalDays;
  }
  const xOf=d=>LABEL_W+Math.round((pd(d)-pd(winStart))/DAY*ppd);
  // Build full month list with date metadata for the axis + adaptive label density.
  const months=[], cur2=new Date(pd(winStart));cur2.setDate(1);
  // Bound the header loop: a valid-but-extreme end date (e.g. a typo'd year 9999, or
  // imported far-future data) would otherwise build ~95k month cells. 12000 months =
  // 1000 years, far beyond any real schedule.
  let _mGuard=12000;
  while(cur2<=pd(winEnd) && _mGuard-->0){
    months.push({x:xOf(fd(cur2)), mo:cur2.getMonth(), yr:cur2.getFullYear(),
      label:cur2.toLocaleDateString("en-US",{month:"short"})});   // "Jun" — the YEAR is its own tier now (B399)
    cur2.setMonth(cur2.getMonth()+1);
  }
  // Each month's right edge = next month's start (last → chart right edge) so tier labels center.
  months.forEach((m,i)=>{ m.x1 = months[i+1] ? months[i+1].x : svgWidth; m.cx=(m.x+m.x1)/2; });
  // Year spans for the top tier (group the months by calendar year).
  const yearSpans=[];
  months.forEach(m=>{ const last=yearSpans[yearSpans.length-1]; if(last&&last.yr===m.yr) last.x1=m.x1; else yearSpans.push({yr:m.yr,x0:m.x,x1:m.x1}); });
  yearSpans.forEach(y=>y.cx=(y.x0+y.x1)/2);
  // Adaptive month-label density — drop labels that would overlap (~26px each); single-letter when tight.
  const monthPx=ppd*30.4;
  const monLabel = m => monthPx>=30 ? m.label : m.label[0];
  const visibleMonths=monthPx>=22?months:monthPx>=12?months.filter(m=>m.mo%2===0):monthPx>=6?months.filter(m=>[0,3,6,9].includes(m.mo)):months.filter(m=>m.mo===0);
  // B399 (owner pick "D") — a two-tier LIGHT header: a YEAR band over a MONTH band, HEADER_H tall.
  const YEAR_TIER=14, MON_TIER=16, HEADER_H=YEAR_TIER+MON_TIER, svgH=HEADER_H+ROW_H*allTasks.length;
  // B397 — paint in explicit LAYERS so the data sits ON TOP of the vertical rules (mirrors the
  // on-screen Gantt's z-order, B222): row bands (bottom) → grid / today / dependency lines →
  // bars + milestones → text labels (top). The per-row string is split into separate buckets
  // (the old `${gridLines}${rows}${yearLines}${arrows}${todayLine}` put the rules over the bars).
  const rowBands=[], barLayer=[], labelLayer=[], nameRecords=[];
  allTasks.forEach((t,i)=>{
    const y=HEADER_H+i*ROW_H, bg=i%2?"#f6f6f6":"#fff";
    // An unscheduled task (no/invalid start or end) gets NO bar — drawing one yields NaN SVG
    // coords (an invisible, broken row). Mirror the on-screen Gantt's "Unscheduled" treatment.
    const blank = !t.start || !t.end || isNaN(pd(t.start)) || isNaN(pd(t.end));
    const bx=xOf(t.start), bw=Math.max(3,Math.round((pd(t.end)-pd(t.start))/86400000*ppd));
    const isMilestone=t.duration===0;
    const proj=projects.find(p=>p.tasks.some(x=>x.id===t.id));
    const depth=proj?getDepth(proj.tasks,t.id):0;
    const isParent=proj?proj.tasks.some(x=>x.parentId===t.id):false;
    const labelHtml = noLabels ? "" :
      (() => {
        const indent=depth*8, nameX=4+indent;
        const maxCh=Math.floor((LABEL_W-nameX-4)/5.2);
        const nm=t.name==null?"":String(t.name);   // a nameless task must not crash the exhibit (was: t.name.length on undefined)
        const nameStr=nm.length>maxCh?nm.slice(0,maxCh-1)+"…":nm;
        const fw=depth===0?"bold":depth===1?"600":"normal", fs=depth===0?9:depth===1?8.5:8;
        return `<text x="${nameX}" y="${y+ROW_H*0.68}" font-size="${fs}" font-weight="${fw}" fill="#1a1a1a" font-family="Arial,sans-serif">${escapeHtml(nameStr)}</text>`;
      })();
    const _barY=y+ROW_H*0.22, _barH=ROW_H*0.55, _midY=y+ROW_H*0.5;
    let blText="";
    if(opts.barLabels && !isParent && !blank){
      const L=barLabelText(t,opts.barLabels.left,opts.barLabels.year), R=barLabelText(t,opts.barLabels.right,opts.barLabels.year);
      const lx=isMilestone?bx-8:bx-3, rx=isMilestone?bx+8:bx+bw+3;
      if(L) blText+=`<text x="${lx}" y="${y+ROW_H*0.68}" font-size="6.5" fill="#555" text-anchor="end" font-family="Arial,sans-serif">${escapeHtml(L)}</text>`;
      if(R) blText+=`<text x="${rx}" y="${y+ROW_H*0.68}" font-size="6.5" fill="#555" font-family="Arial,sans-serif">${escapeHtml(R)}</text>`;
    }
    // B210/B211 — match the on-screen Gantt: navy depth-stepped brackets for summaries,
    // a single gray fill treatment (hollow → partial → solid) for task status.
    const GRAY="#94a3b8";
    const pct = leafPercent(t);
    let barSvg;
    if(blank){
      barSvg="";   // unscheduled — no geometry; an "Unscheduled" tag is added to labelLayer below
    }else if(isParent){
      // a summary (has children) renders as a BRACKET even when its rolled span is 0 days —
      // checked before the milestone branch so a parent whose children are all milestones
      // isn't mistaken for a single diamond (B2).
      // Depth-stepped BRACKET (B210): a thin span + straight-down legs (no triangles). The
      // GRAPHIC keeps its ramp (depth 0 = #2B3340, darkest/thickest, stepping lighter/thinner);
      // magnitudes compressed a touch vs B210 so the always-above caption has clear air (B393).
      const dd=Math.min(depth,3);
      const NAVY=["#2B3340","#46506A","#6E7790","#8A93A8"][dd];
      const legW=1.1, sb=summaryBand(y,depth), SPAN=sb.SPAN, LEG=sb.LEG, sTop=sb.top;
      barSvg=`<rect x="${bx}" y="${sTop}" width="${bw}" height="${SPAN}" rx="1" fill="${NAVY}"/>`
        +`<rect x="${bx}" y="${sTop}" width="${legW}" height="${SPAN+LEG}" fill="${NAVY}"/>`
        +`<rect x="${bx+bw-legW}" y="${sTop}" width="${legW}" height="${SPAN+LEG}" fill="${NAVY}"/>`;
    }else if(isMilestone){
      const done = pct>=100, mb=mileBand(y,depth), h=mb.half;
      barSvg=`<polygon points="${bx},${mb.top} ${bx+h},${mb.mid} ${bx},${mb.bot} ${bx-h},${mb.mid}" fill="${done?GRAY:'#fff'}" stroke="${GRAY}" stroke-width="1.1"/>`;
    }else{
      const lb=leafBand(y), LH=lb.h, by=lb.top, bw2=Math.max(bw,5), r=LH/2;
      if(pct>=100){
        barSvg=`<rect x="${bx}" y="${by}" width="${bw2}" height="${LH}" rx="${r}" fill="${GRAY}"/>`;                         // Complete → solid
      }else if(pct<=0){
        barSvg=`<rect x="${bx}" y="${by}" width="${bw2}" height="${LH}" rx="${r}" fill="#fff" stroke="${GRAY}" stroke-width="1.1"/>`; // Not started → hollow
      }else{
        const fw=Math.max(0.5, Math.min(bw2, bw2*pct/100));                                                                  // In progress → partial
        barSvg=`<rect x="${bx}" y="${by}" width="${bw2}" height="${LH}" rx="${r}" fill="${GRAY}" opacity="0.18"/>`
          +`<rect x="${bx}" y="${by}" width="${fw}" height="${LH}" rx="${r}" fill="${GRAY}"/>`
          +`<rect x="${bx}" y="${by}" width="${bw2}" height="${LH}" rx="${r}" fill="none" stroke="${GRAY}" stroke-width="0.8"/>`;
      }
    }
    // In-chart NAME on the bar/bracket/diamond (B394) — the layer GanttView draws but the
    // exhibit used to omit. Same placement helper, alignment, uniform ink and weight ramp as
    // on-screen so the two paths can't drift; uniform near-black (no B210 depth-navy here
    // either); escaped via escapeHtml (B248). Default on (opts.barNames !== false).
    // Skip a name whose bar is fully OUTSIDE the visible window (B361 zoom/pan) — otherwise its
    // label would clamp onto the chart edge with no bar (no-op for the auto-fit default, where
    // every bar is in view).
    const nameInView = !blank && (isMilestone ? (bx>=LABEL_W-2 && bx<=svgWidth+2) : (bx+bw>=LABEL_W-2 && bx<=svgWidth+2));
    if(opts.barNames!==false && nameInView){
      const kind = isMilestone?"milestone":isParent?"summary":"leaf";
      const align = opts.labelAlign || resolveLabelAlign(proj);
      const band = isMilestone ? mileBand(y,depth) : isParent ? summaryBand(y,depth) : leafBand(y);
      const barTopY = band.top, bwN = isMilestone ? 0 : bw;
      // EVERY caption auto-fits the headroom above its own glyph so it clears it at this row
      // height (B629's summary rule, now uniform — NEW-1 made every name a caption above its bar).
      const fs = fitCaptionFs(ganttNameSize(PP,depth), barTopY-y);
      const nm = t.name==null?"":String(t.name);
      const lw = estLabelWidth(nm, fs);
      const place = placeGanttLabel({kind, align, bx, bw:bwN, rowTop:y, barTopY,
        labelW:lw, chartL:LABEL_W, chartR:svgWidth, capHalf:ganttCaptionHalf(fs), rowH:ROW_H});
      // Collected, not emitted: the in-chart names are de-collided AFTER the row pass so
      // co-dated labels never overprint each other (B402), then drawn on the top layer.
      nameRecords.push({x:place.x, y:place.y, anchor:place.anchor, mode:place.mode, lw, fs,
        weight:ganttNameWeight(depth, kind, t.bold || t.cellFmt?.name?.bold), italic:!!(t.italic || t.cellFmt?.name?.italic), underline:!!(t.underline || t.cellFmt?.name?.underline), str:escapeHtml(nm)});
    }
    const unsched = blank ? `<text x="${LABEL_W+6}" y="${y+ROW_H*0.68}" font-size="7.5" fill="#9aa0a6" font-style="italic" font-family="Arial,sans-serif">Unscheduled</text>` : "";
    rowBands.push(`<rect x="0" y="${y}" width="${svgWidth}" height="${ROW_H}" fill="${bg}"/>`);
    barLayer.push(barSvg);
    labelLayer.push(`${labelHtml}${blText}${unsched}`);   // task-column name + bar labels (+ Unscheduled tag) (in-chart names → nameLayer, B402)
  });
  // Dependency connectors — same curved style as the in-app Gantt (cubic bezier,
  // direction-flipped 32px handles, type colors, dashed). Opacity lifted .55 -> .7 for print.
  let arrows="";
  if(opts.showArrows!==false){
    const DEP_C={FS:"#0969da",SS:"#7c3aed",FF:"#0891b2",SF:"#be185d"};
    let base=0;
    for(const p of projects){
      const ix=new Map();
      p.tasks.forEach((t,i)=>ix.set(t.id, base+i));
      // WHERE each connector attaches is decided by the SHARED depAnchors() — the same routing as
      // the on-screen Gantt, so the two paths can't drift (B396 re-report, replacing the print-only edgeYOf
      // of B402). A down-link leaves the source's BOTTOM edge near its finish and drops into the
      // target's TOP edge near its start (never 9 o'clock, so it clears the start-date label); an
      // up-link mirrors it. A bar's outbound links FAN across the exit arc instead of bundling.
      const isParentTask=task=>p.tasks.some(x=>x.parentId===task.id);
      // Reads the SAME bottom-aligned glyph bands the bar renderer draws (NEW-1), so an arrow can
      // never attach to where a glyph used to be.
      const glyphEdges=(task,gidx)=>{
        const yTop=HEADER_H+gidx*ROW_H, sX=xOf(task.start), eX=xOf(task.end);
        if(isParentTask(task)){                                                          // summary bracket (before milestone — a duration-0 parent draws as a bracket)
          const b=summaryBand(yTop,getDepth(p.tasks,task.id)); return {startX:sX,endX:eX,topY:b.top,botY:b.bot,rowTop:yTop};
        }
        if(task.duration===0){ const b=mileBand(yTop,getDepth(p.tasks,task.id)); return {startX:sX,endX:sX,topY:b.top,botY:b.bot,rowTop:yTop}; }  // diamond vertices
        const b=leafBand(yTop); return {startX:sX,endX:Math.max(eX,sX+5),topY:b.top,botY:b.bot,rowTop:yTop};            // leaf bar
      };
      // Right edge x of a target's start-date bar-label (text-anchor:end at bx-3 / bx-8 for a
      // milestone) when start labels are shown — the arrowhead exclusion zone (B396 re-report).
      const startLabelRightX=task=>{
        if(!opts.barLabels||isParentTask(task)||!opts.barLabels.left) return null;
        if(!barLabelText(task,opts.barLabels.left,opts.barLabels.year)) return null;
        return xOf(task.start)-(task.duration===0?8:3);
      };
      // Collect this project's guard-passing links, then group by SOURCE for fanning.
      const raw=[];
      for(const t of p.tasks){
        for(const pr of normPreds(t.predecessors)){   // tolerate plain-number preds (seed/imported) so arrows draw like the table (F2)
          if(!ix.has(pr.id)) continue;
          const pt=p.tasks[ix.get(pr.id)-base];
          // B519: skip a present-but-unparseable date too — else xOf()→NaN emits a garbage arrow path.
          if(!pt||!pt.start||!pt.end||!t.start||!t.end||isNaN(pd(pt.start))||isNaN(pd(pt.end))||isNaN(pd(t.start))||isNaN(pd(t.end))) continue;
          if(ix.get(pr.id)===ix.get(t.id)) continue;
          raw.push({pt,t,type:(pr.type||"FS").toUpperCase()});
        }
      }
      const bySrc=new Map();
      raw.forEach(l=>{const a=bySrc.get(l.pt.id)||[];a.push(l);bySrc.set(l.pt.id,a);});
      bySrc.forEach(a=>a.sort((x,y)=>(ix.get(x.t.id)-ix.get(y.t.id))||(x.type<y.type?-1:x.type>y.type?1:0)));
      for(const l of raw){
        const group=bySrc.get(l.pt.id);
        const src=glyphEdges(l.pt,ix.get(l.pt.id)), tgt=glyphEdges(l.t,ix.get(l.t.id));   // GLOBAL row index — bars are laid out across ALL projects at HEADER_H+globalIdx*ROW_H (the -base local index would misplace every arrow in the 2nd+ project)
        const a=depAnchors({type:l.type,src,tgt,fanIndex:group.indexOf(l),fanCount:group.length,
                            tgtLabelRightX:(l.type==="SS"||l.type==="FS")?startLabelRightX(l.t):null});
        const sx=a.x1, sBot=a.y1, tx=a.x2, tTop=a.y2, vSign=a.down?1:-1;
        const dx=tx-sx, dy=tTop-sBot, vh=Math.max(6,Math.min(26,Math.abs(dy)*0.5));
        const c1x=sx+dx*0.30, c1y=sBot+vSign*vh;                        // exit in the travel direction
        const c2x=tx-dx*0.30, c2y=tTop-vSign*vh;                        // entry from the travel direction
        // Arrowhead oriented along the ENTRY tangent so an angled entry reads right.
        const ex=tx-c2x, ey=tTop-c2y, el=Math.hypot(ex,ey)||1, ux=ex/el, uy=ey/el;
        const a1x=tx-ux*6-uy*3, a1y=tTop-uy*6+ux*3, a2x=tx-ux*6+uy*3, a2y=tTop-uy*6-ux*3;
        const color=DEP_C[l.type]||DEP_C.FS;
        arrows+=`<path class="dep" d="M${sx.toFixed(1)},${sBot.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${tx.toFixed(1)},${tTop.toFixed(1)}" stroke="${color}" stroke-width="1.2" fill="none" stroke-dasharray="4 3" opacity="0.7"/>`
          +`<path d="M${tx.toFixed(1)},${tTop.toFixed(1)} L${a1x.toFixed(1)},${a1y.toFixed(1)} L${a2x.toFixed(1)},${a2y.toFixed(1)}Z" fill="${color}" opacity="0.7"/>`;
      }
      base+=p.tasks.length;
    }
  }
  // ── Weighted vertical grid rules (B399, owner spec) — ONE line per month boundary, RANKED
  //    year > quarter > month, each thicker + a touch darker, so hierarchy reads by line weight
  //    (no quarter LABEL, just the rule). Year rules drop from the very top; quarter + month from
  //    below the year tier — down THROUGH the body, kept light and painted BEFORE the bars (B397)
  //    so nothing ever crosses a bar / bracket / milestone.
  const gridRules=months.map(m=>{
    if(m.mo===0)   return `<line x1="${m.x}" y1="0" x2="${m.x}" y2="${svgH}" stroke="#8b95a3" stroke-width="1.3"/>`;            // YEAR — thickest
    if(m.mo%3===0) return `<line x1="${m.x}" y1="${YEAR_TIER}" x2="${m.x}" y2="${svgH}" stroke="#c2c9d2" stroke-width="0.8"/>`; // QUARTER — medium (line only)
    return                `<line x1="${m.x}" y1="${YEAR_TIER}" x2="${m.x}" y2="${svgH}" stroke="#e7ebf0" stroke-width="0.4"/>`; // MONTH — thinnest
  }).join("");
  // B398 — ONE continuous left chart-edge boundary, full height, drawn once (not per-row).
  const leftEdge=`<line x1="${LABEL_W}" y1="0" x2="${LABEL_W}" y2="${svgH}" stroke="#c4c8ce" stroke-width="0.8"/>`;
  // Today marker — red dashed line + a small tick at the bottom of the header band.
  const todayStr=fdLocal(new Date());
  const todayLine=(opts.showToday!==false && todayStr>=winStart&&todayStr<=winEnd)
    ? `<line x1="${xOf(todayStr)}" y1="${HEADER_H}" x2="${xOf(todayStr)}" y2="${svgH}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3,2"/>
<polygon points="${xOf(todayStr)-3.5},${HEADER_H-5} ${xOf(todayStr)+3.5},${HEADER_H-5} ${xOf(todayStr)},${HEADER_H}" fill="#dc2626"/>`
    : "";
  // ── Two-tier LIGHT header (owner pick "D"): a year band over a month band ──
  const headerBg=`<rect x="${LABEL_W}" y="0" width="${ganttW}" height="${HEADER_H}" fill="#f6f8fa"/>`
    +`<rect x="${LABEL_W}" y="0" width="${ganttW}" height="${YEAR_TIER}" fill="#e9edf2"/>`;
  const yearLabels=yearSpans.map(y=>`<text x="${y.cx}" y="${YEAR_TIER-3.5}" font-size="9.5" font-weight="700" fill="#3a4452" font-family="Arial,sans-serif" text-anchor="middle" letter-spacing="0.6">${y.yr}</text>`).join("");
  const monthLabels=visibleMonths.map(m=>{const strong=m.mo%3===0;return `<text x="${m.cx}" y="${HEADER_H-5}" font-size="7.5" font-weight="${strong?700:500}" fill="${strong?"#3a4452":"#69727f"}" font-family="Arial,sans-serif" text-anchor="middle">${monLabel(m)}</text>`;}).join("");
  const headerLines=`<line x1="${LABEL_W}" y1="${YEAR_TIER}" x2="${svgWidth}" y2="${YEAR_TIER}" stroke="#d4d8de" stroke-width="0.7"/>`
    +`<line x1="${LABEL_W}" y1="${HEADER_H}" x2="${svgWidth}" y2="${HEADER_H}" stroke="#b9c0c9" stroke-width="1"/>`;
  const taskHeaderText = noLabels ? "" : `<text x="4" y="${HEADER_H-6}" font-size="8" font-weight="bold" fill="#3a4452" font-family="Arial,sans-serif">TASK</text>`;
  // ── B402: de-collide in-chart name labels ──────────────────────────────────────────
  // Co-dated labels must never overprint each other. Sweep top→down; if a label's box hits
  // one already placed, nudge it down until clear (capped). A pure no-op when nothing
  // overlaps (the common per-row case), so existing layouts are untouched. Defensive: any
  // failure falls back to the un-nudged labels.
  let nameLayer="";
  const emitName=r=>{
    // No contrast plate: since NEW-1 every name is a caption in the clear air above its glyph, so
    // there is nothing to knock out behind it.
    return `<text x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" font-size="${r.fs}" font-weight="${r.weight}" fill="${GANTT_INK}" text-anchor="${r.anchor}" dominant-baseline="central" font-family="Arial,sans-serif"${r.italic?' font-style="italic"':''}${r.underline?' text-decoration="underline"':''}>${r.str}</text>`;
  };
  try{
    const boxOf=r=>{const x0=r.anchor==="middle"?r.x-r.lw/2:r.anchor==="end"?r.x-r.lw:r.x;return {x0,x1:x0+r.lw,y0:r.y-r.fs*0.72,y1:r.y+r.fs*0.72};};
    const recs=nameRecords.map(r=>({...r,_y0:r.y})).sort((a,b)=>(a.y-b.y)||(a.x-b.x));
    const placed=[];
    for(const r of recs){
      let b=boxOf(r),tries=0;
      while(tries<8){
        const hit=placed.find(p=>b.x0<p.x1&&b.x1>p.x0&&b.y0<p.y1&&b.y1>p.y0);
        if(!hit) break;
        r.y+=(hit.y1-b.y0)+1.5;
        if(r.y-r._y0>ROW_H*2.2){ r.y=r._y0; break; }   // give up rather than fling it far
        b=boxOf(r); tries++;
      }
      placed.push(b);
    }
    nameLayer=recs.map(emitName).join("");
  }catch(_){ nameLayer=nameRecords.map(emitName).join(""); }
  // B400 — a viewBox makes the whole 0..svgWidth content scale to fill the container width EXACTLY
  // (with style:width:100%), so the full min→max timeline always fits the page Gantt column with no
  // right-edge clipping. Render is 1:1 at the export widths, so per-page slicing is unchanged (the
  // paginator's GANTT_HEAD must match HEADER_H).
  // Paint order (B397): white → header band → row bands → grid rules → left edge → today →
  // dependency (main's curved, B396) → bars → header labels/lines (axis text on top) → bar labels.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgH}" viewBox="0 0 ${svgWidth} ${svgH}" style="width:100%;display:block">
<rect width="${svgWidth}" height="${svgH}" fill="#fff"/>
${headerBg}
${rowBands.join("")}${gridRules}${leftEdge}${todayLine}${arrows}${barLayer.join("")}${yearLabels}${monthLabels}${headerLines}${taskHeaderText}${labelLayer.join("")}${nameLayer}</svg>`;
}

// ── Exhibit column sizing (B390 content-fit + B392 drag-resize) ─────────────────────
// Minimum px the Gantt timeline keeps in the split exhibit, so widening columns can never
// collapse the chart. Shared by buildPDFHtml and the live drag-resize script it embeds.
const EXHIBIT_MIN_GANTT = 240;
// Approximate the rendered width (px) of `str` at font-size `fs` for the exhibit's
// Inter/Arial face. Per-character advances run slightly generous so a fixed-format value
// (a date, a duration, a percent) is never clipped by an under-sized column. Pure +
// DOM-free so the preview, the print window, and the unit tests all agree.
function approxTextPx(str, fs){
  let w=0; const s=String(str==null?"":str);
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c===' '||/[.,:;'!|il]/.test(c)) w+=0.30*fs;
    else if(/[fjt()/\-]/.test(c)) w+=0.38*fs;
    else if(/[0-9]/.test(c)) w+=0.58*fs;
    else if(c==='M'||c==='W') w+=0.92*fs;
    else if(/[A-Z]/.test(c)) w+=0.70*fs;
    else if(c==='m'||c==='w') w+=0.86*fs;
    else w+=0.54*fs;
  }
  return w;
}
// Lay the exhibit columns out from their content-fit base widths, letting a user's
// per-column drag override (cfg.colWidths) win, each clamped to its [min,max]. The table
// block is exactly its columns' total and the Gantt takes the rest, but never less than
// EXHIBIT_MIN_GANTT — if the columns would crowd the chart, flexible columns shrink toward
// their min first, then a uniform scale as a last resort. Returns { widths:{k:px}, tableW,
// ganttW }. Pure + DOM-free, so the preview, the print window, and the tests all agree.
function layoutExhibitCols(specs, opts){
  const ov = opts.override || {};
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const widths={};
  for(const s of specs) widths[s.k]=Math.round(clamp(ov[s.k]!=null?ov[s.k]:s.base, s.min, s.max));
  const total=()=>specs.reduce((a,s)=>a+widths[s.k],0);
  const budget=Math.max(160, opts.budget-EXHIBIT_MIN_GANTT); // reserve room for the chart
  if(total()>budget){
    const flex=specs.filter(s=>s.flex);
    const slack=flex.reduce((a,s)=>a+(widths[s.k]-s.min),0);
    if(slack>0){
      const need=Math.min(total()-budget, slack);
      for(const s of flex) widths[s.k]-=Math.round((widths[s.k]-s.min)/slack*need);
    }
    if(total()>budget){ // no flex slack left → uniform scale as a last resort
      const f=budget/total();
      for(const s of specs) widths[s.k]=Math.max(s.min, Math.round(widths[s.k]*f));
    }
  }
  const tableW=total();
  return { widths, tableW, ganttW: Math.max(EXHIBIT_MIN_GANTT, opts.budget-tableW) };
}

// B1873361 (PDF-PARITY) — the per-project section header this prints when more than one schedule
// is exported together (".proj-name", below) uses crossScheduleLabel, not the bare schedule name,
// for the same reason MasterView's "Group by project" does: exporting two same-named schedules
// (the owner's own two "Master Schedule"s) together must not print two identical headers.
function buildPDFHtml(cfg, data, forPreview) {
  const projs = Object.values(data.projects);
  const selProjs = projs.filter(p => cfg.selProjects.includes(String(p.id)));
  const COL_DEFS = [
    {k:"id",w:20},{k:"name",w:null},{k:"start",w:42},{k:"end",w:42},
    {k:"duration",w:28},{k:"health",w:72},{k:"percentComplete",w:36},
    {k:"responsibleParty",w:64},{k:"predecessors",w:36},{k:"cost",w:56},
  ];
  const COL_LABELS = {id:"ID",name:"Task Name",start:"Start",end:"End",duration:"Dur",health:"Status",percentComplete:"%",responsibleParty:"Owner",predecessors:"Pred",cost:"Cost"};
  const colDefs = COL_DEFS.filter(c => cfg.columns.includes(c.k));
  const HC = {gray:{l:"Not Started",c:"#94a3b8"},yellow:{l:"In Progress",c:"#d97706"},red:{l:"Needs Attn.",c:"#dc2626"},green:{l:"Complete",c:"#16a34a"},paused:{l:"Paused",c:"#9ca3af"}};
  const fmtD = s => { if(!s) return ""; const [y,m,d]=s.split("-"); return String(+m).padStart(2,'0')+'/'+String(+d).padStart(2,'0')+'/'+y.slice(2); };
  const getDepth = (tasks,id) => {let dep=0,t=tasks.find(x=>x.id===id);while(t&&t.parentId!==null){dep++;t=tasks.find(x=>x.id===t.parentId);}return Math.min(dep,3);};
  // Collapse state for this exhibit only — keys are "projectId:taskId". Never written back to live tasks.
  const collapsedSet = new Set(cfg.collapsedIds || []);
  // A task is hidden when any ancestor is collapsed (walked against the full project list).
  const visibleTasks = proj => proj.tasks.filter(t => {
    let pid = t.parentId;
    while (pid != null) { if (collapsedSet.has(proj.id + ":" + pid)) return false; const par = proj.tasks.find(x => x.id === pid); pid = par ? par.parentId : null; }
    return true;
  });
  // Rolled cost for the exhibit: parent = sum of descendant leaf costs; leaf = own value.
  const costOfIn = (tasks, id) => { const kids = tasks.filter(x=>x.parentId===id); const own = Number(tasks.find(x=>x.id===id)?.cost)||0; return kids.length ? own + kids.reduce((s,c)=>s+costOfIn(tasks,c.id),0) : own; };
  // The exhibit's Status column must show what the SCREEN shows, not the raw stored `health`
  // field: a task with no manual override is colored live by the automation rule engine
  // (computeDisplayHealth, #1073) and that computed color is never written back to `health` —
  // so reading `t.health` directly here silently printed the pre-automation color on every
  // un-overridden task (B568128, measured live: an overdue leaf read "Not Started" in the PDF while
  // the grid showed "Needs Attn." for the same task at the same moment). Mirrors the grid Cell's
  // own rule exactly: a parent shows the worst-of-children ROLLED health, a leaf runs the engine.
  // Memoized per project (keyed by the project's task array identity) — O(n) once, not per cell.
  let _healthCtxTasks = null, _healthCtxById = null, _healthCtxRolled = null;
  const healthCtxFor = tasks => {
    if (_healthCtxTasks !== tasks) {
      _healthCtxTasks = tasks;
      _healthCtxById = {}; tasks.forEach(x => { _healthCtxById[x.id] = x; });
      _healthCtxRolled = computeRolledHealth(tasks, data.settings);
    }
    return { byId: _healthCtxById, rolled: _healthCtxRolled };
  };
  const displayHealthOf = (t, tasks) => {
    const { byId, rolled } = healthCtxFor(tasks);
    const isParent = tasks.some(x => x.parentId === t.id);
    return isParent ? (rolled[t.id] || t.health) : computeDisplayHealth(t, data.settings, byId);
  };
  // The grid blanks the Status/Health cell for an EXPANDED parent (Cell(), case "status"/"health"
  // — B222/B211: the rolled color only ever shows on the COLLAPSED row, because the children are
  // ALSO shown as their own rows right below it). The exhibit's analog of "expanded" is its OWN
  // `collapsedSet` — not the live task's `.isExpanded` — because collapsedSet is what actually
  // decides whether this task's children appear as separate rows in THIS SAME document
  // (visibleTasks() and the preview's own ▾/▸ collapse triangle both key off it too, and a user
  // can toggle it independently of the live grid via Expand/Collapse All or the triangle). Using
  // `.isExpanded` instead would self-contradict the exhibit's own triangle the moment someone
  // collapses/expands a row inside the PDF preview without touching the live grid. Defaults agree
  // with `.isExpanded` (collapsedIds is seeded from it — PDFExportModal's seedCollapsed), so this
  // is a strict improvement, not a behavior change, for every schedule that hasn't been
  // interactively re-collapsed inside the export preview (B575904, PDF-PARITY).
  const isExpandedParentOf = (t, tasks, projId) => tasks.some(x => x.parentId === t.id) && !collapsedSet.has(projId + ":" + t.id);
  const cellVal = (t,k,tasks,projId) => {    switch(k){
      case "start": case "end": return fmtD(t[k]);
      case "duration": return `${t.duration}d`;
      case "percentComplete": return `${displayHealthOf(t,tasks)==="green" ? 100 : effectivePercentComplete(t, tasks)}%`;  // match the Gantt bar's green→100 convention
      case "predecessors": return (t.predecessors||[]).map(p=>p.id||p).join(", ");
      case "health":{if(isExpandedParentOf(t,tasks,projId)) return "";const dh=displayHealthOf(t,tasks);const h=HC[dh]||{l:dh,c:"#94a3b8"};return `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:${h.c};flex-shrink:0;display:inline-block"></span>${escapeHtml(h.l)}</span>`;}
      case "name":{const dep=getDepth(tasks,t.id);const ind=dep*14;const fw=dep===0?700:dep===1?600:400;const fs=dep===0?10.5:dep===1?10:9.5;const isP=tasks.some(x=>x.parentId===t.id);const key=projId+":"+t.id;const col=collapsedSet.has(key);const tri=(forPreview&&isP)?`<span class="pl-tri${col?"":" open"}" data-collapse="${key}" title="${col?"Expand":"Collapse"}">${col?"\u25B8":"\u25BE"}</span>`:"";return `<span class="pl-name" style="padding-left:${ind}px;font-weight:${fw};font-size:${fs}px">${tri}${escapeHtml(t.name)}</span>`;}
      case "cost":{const v=costOfIn(tasks,t.id);return v?("$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2})):"";}
      case "responsibleParty": return escapeHtml(ownerJoin(ownerListOf(t)));
      default: return escapeHtml(t[k]);
    }
  };
  const isLand=cfg.orientation==="landscape";
  const ps=PAGE_SIZES[cfg.pageSize]||PAGE_SIZES.letter;
  const pgW=isLand?ps.h:ps.w, pgR=isLand?ps.w:ps.h;
  const contentW=pgW-parseFloat(cfg.margins.left||0.75)-parseFloat(cfg.margins.right||0.75);
  const contentPx=Math.max(300,Math.round(contentW*96));
  // px geometry for the WYSIWYG preview paginator — 96 CSS px per inch, the same
  // density the browser print engine uses, so preview math = print math
  const mTopPx=Math.round(parseFloat(cfg.margins.top||0.75)*96);
  const mBotPx=Math.round(parseFloat(cfg.margins.bottom||0.75)*96);
  const mLeftPx=Math.round(parseFloat(cfg.margins.left||0.75)*96);
  const mRightPx=Math.round(parseFloat(cfg.margins.right||0.75)*96);
  const pageWpx=Math.round(pgW*96), pageHpx=Math.round(pgR*96);

  let bodyHtml="", resizeScript="";
  if(cfg.includeGantt) {
    // Side-by-side: a content-fit grid on the left, the Gantt timeline on the right —
    // like MS Project / Excel split view. The exhibit stacks every selected project under
    // one shared header, so the columns are sized once against the widest value of each
    // visible column across them all (B390) — no dead gap before the dates, no clipped
    // start/end/duration. cfg.colWidths (a user's drag, B392) overrides a column's width.
    const projTaskLists = selProjs.map(proj=>{
      let tasks=visibleTasks(proj);
      // Filter by the same DISPLAY health the Status column now prints (not the raw stored
      // field) — otherwise an automatically-red/green task with no manual override could be
      // silently dropped from (or kept out of) the "Active"/"Done" filtered exhibit.
      if(cfg.healthFilter==="active") tasks=tasks.filter(t=>{const h=displayHealthOf(t,proj.tasks);return h==="yellow"||h==="red";});
      if(cfg.healthFilter==="complete") tasks=tasks.filter(t=>displayHealthOf(t,proj.tasks)==="green");
      return {proj, tasks};
    });
    // Plain-text form of each cell, for width measurement (cellVal returns marked-up HTML).
    const cellText=(t,k,tasks,projId)=>{ switch(k){
      case "start": case "end": return fmtD(t[k]);
      case "duration": return `${t.duration}d`;
      case "percentComplete": return `${displayHealthOf(t,tasks)==="green" ? 100 : effectivePercentComplete(t, tasks)}%`;  // match the Gantt bar's green→100 convention
      case "predecessors": return (t.predecessors||[]).map(p=>p.id||p).join(", ");
      case "health": { if(isExpandedParentOf(t,tasks,projId)) return ""; const dh=displayHealthOf(t,tasks); const h=HC[dh]; return h?h.l:(dh||""); }
      case "name": return t.name==null?"":String(t.name);
      case "cost": { const v=costOfIn(tasks,t.id); return v?("$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2})):""; }
      case "responsibleParty": return ownerJoin(ownerListOf(t));
      default: return t[k]==null?"":String(t[k]);
    }};
    // Per-column fit profile: font px, clamp range, whether it may shrink (flex), and any
    // non-text px (the Status dot+gap). Short fixed-format columns are NOT flex — a date or
    // a duration must never be the value that gets clipped to make room.
    const COL_FIT={
      id:{fs:8,min:22,max:64,flex:false,extra:0}, name:{fs:10.5,min:96,max:280,flex:true,extra:0},
      start:{fs:9,min:50,max:96,flex:false,extra:0}, end:{fs:9,min:50,max:96,flex:false,extra:0},
      duration:{fs:9,min:34,max:74,flex:false,extra:0}, health:{fs:9,min:62,max:132,flex:false,extra:13},
      percentComplete:{fs:9,min:34,max:74,flex:false,extra:0}, responsibleParty:{fs:9,min:52,max:144,flex:true,extra:0},
      predecessors:{fs:9,min:40,max:120,flex:true,extra:0}, cost:{fs:9,min:50,max:132,flex:true,extra:0},
    };
    const PADX=12, SLACK=3; // td horizontal padding (6+6) + a hair of safety
    const specs=colDefs.map(c=>{
      const f=COL_FIT[c.k]||{fs:9,min:30,max:130,flex:false,extra:0};
      const lbl=COL_LABELS[c.k]||c.k;
      let base=approxTextPx(lbl.toUpperCase(),8)*1.04+lbl.length*0.45; // header is bold + .05em tracked
      for(const {proj,tasks} of projTaskLists){
        for(const t of tasks){
          let w;
          if(c.k==='name'){
            const dep=getDepth(proj.tasks,t.id), fs=dep===0?10.5:dep===1?10:9.5;
            const tri=forPreview&&proj.tasks.some(x=>x.parentId===t.id)?15:0; // collapse triangle (preview only)
            w=approxTextPx(cellText(t,'name',proj.tasks),fs)+dep*14+tri;
          } else {
            w=approxTextPx(cellText(t,c.k,proj.tasks,proj.id),f.fs)+f.extra;
          }
          if(w>base) base=w;
        }
      }
      return {k:c.k, base:base+PADX+SLACK, min:f.min, max:f.max, flex:f.flex};
    });
    const fit=layoutExhibitCols(specs,{override:cfg.colWidths||{}, budget:contentPx-2});
    const colW=fit.widths, canResize=!!forPreview;
    // One shared header for every project. In the preview each column carries a drag
    // handle (B392); the print output never does.
    const thCols=colDefs.map(c=>`<th data-k="${c.k}" style="width:${colW[c.k]}px">${COL_LABELS[c.k]}${canResize?`<span class="col-rs" data-rs="${c.k}" title="Drag to resize"></span>`:""}</th>`).join("");
    projTaskLists.forEach(({proj,tasks})=>{
      const rows=tasks.map((t,i)=>{
        const cells=colDefs.map(c=>`<td class="c-${c.k}">${cellVal(t,c.k,proj.tasks,proj.id)}</td>`).join("");
        return `<tr class="${i%2?"alt":""}">${cells}</tr>`;
      }).join("");
      const ganttProj={...proj, tasks}; // Gantt task list matches the table
      const ganttSvg=buildGanttSVG([ganttProj], fit.ganttW, cfg.orientation, {noLabels:true, showToday:cfg.showToday!==false, showArrows:cfg.showArrows!==false, barLabels:data.settings?.barLabels, barNames:cfg.barNames!==false, labelAlign:cfg.labelAlign, timeUnit:cfg.timeUnit, zoomMul:cfg.zoomMul, panFrac:cfg.panFrac});
      bodyHtml+=`<div class="proj-block">${selProjs.length>1?`<div class="proj-name">${escapeHtml(crossScheduleLabel(proj))}</div>`:""}
        <div class="split-view">
          <div class="split-table" style="width:${fit.tableW}px;flex-shrink:0">
            <table class="aligned"><thead><tr>${thCols}</tr></thead><tbody>${rows}</tbody></table>
          </div>
          <div class="split-gantt" style="width:${fit.ganttW}px;flex-shrink:0;overflow:hidden">${ganttSvg}</div>
        </div></div>`;
    });
    // B392 — live drag-to-resize. Handles live in the preview header; this script (preview
    // only) resizes the dragged column across every page in real time, trading the width
    // against the Gantt (which keeps EXHIBIT_MIN_GANTT), then posts the final width to the
    // parent on release so it persists and the Gantt re-fits cleanly.
    if(forPreview){
      resizeScript=`<script>(function(){
  var W=${JSON.stringify(colW)}, MINc=${JSON.stringify(Object.fromEntries(specs.map(s=>[s.k,s.min])))}, MAXc=${JSON.stringify(Object.fromEntries(specs.map(s=>[s.k,s.max])))};
  var ORDER=${JSON.stringify(colDefs.map(c=>c.k))}, SPLIT=${fit.tableW+fit.ganttW}, MING=${EXHIBIT_MIN_GANTT};
  function sum(){var t=0;for(var i=0;i<ORDER.length;i++)t+=W[ORDER[i]];return t;}
  function apply(){
    var tw=sum(), gw=Math.max(MING,SPLIT-tw);
    document.querySelectorAll('.split-table').forEach(function(e){e.style.width=tw+'px';});
    document.querySelectorAll('.split-gantt').forEach(function(e){e.style.width=gw+'px';});
    ORDER.forEach(function(k){document.querySelectorAll('th[data-k="'+k+'"]').forEach(function(e){e.style.width=W[k]+'px';});});
  }
  var drag=null;
  document.addEventListener('mousedown',function(ev){
    var h=ev.target&&ev.target.closest?ev.target.closest('[data-rs]'):null; if(!h) return;
    ev.preventDefault(); ev.stopPropagation();
    var k=h.getAttribute('data-rs'); drag={k:k,x:ev.clientX,w0:W[k]};
    document.body.style.cursor='col-resize'; document.body.style.userSelect='none';
  },true);
  document.addEventListener('mousemove',function(ev){
    if(!drag) return;
    var mn=MINc[drag.k]||30, others=sum()-W[drag.k], cap=Math.min(MAXc[drag.k]||9999,Math.max(mn,(SPLIT-MING)-others));
    W[drag.k]=Math.round(Math.max(mn,Math.min(drag.w0+(ev.clientX-drag.x),cap))); apply();
  });
  document.addEventListener('mouseup',function(){
    if(!drag) return; var k=drag.k, w=W[k]; drag=null;
    document.body.style.cursor=''; document.body.style.userSelect='';
    try{window.parent.postMessage({type:'planarColResize',key:k,w:w},'*');}catch(_){}
  });
})();<\/script>`;
    }
  } else {
    // Tables only (no Gantt) — full width
    selProjs.forEach(proj=>{
      let tasks=visibleTasks(proj);
      if(cfg.healthFilter==="active") tasks=tasks.filter(t=>{const h=displayHealthOf(t,proj.tasks);return h==="yellow"||h==="red";});
      if(cfg.healthFilter==="complete") tasks=tasks.filter(t=>displayHealthOf(t,proj.tasks)==="green");
      const thCols=colDefs.map(c=>`<th${c.w?` style="width:${c.w}px"`:""}>${COL_LABELS[c.k]}</th>`).join("");
      const rows=tasks.map((t,i)=>{
        const cells=colDefs.map(c=>`<td class="c-${c.k}">${cellVal(t,c.k,proj.tasks,proj.id)}</td>`).join("");
        return `<tr class="${i%2?"alt":""}">${cells}</tr>`;
      }).join("");
      bodyHtml+=`<div class="proj-block">${selProjs.length>1?`<div class="proj-name">${escapeHtml(crossScheduleLabel(proj))}</div>`:""}<table><thead><tr>${thCols}</tr></thead><tbody>${rows}</tbody></table></div>`;
    });
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${escapeHtml(scheduleExportName(selProjs))}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@page{size:${pgW}in ${pgR}in;margin:${cfg.margins.top}in ${cfg.margins.right}in ${cfg.margins.bottom}in ${cfg.margins.left}in}
body{padding:${cfg.margins.top}in ${cfg.margins.right}in ${cfg.margins.bottom}in ${cfg.margins.left}in;font-family:'Inter',Arial,sans-serif;font-size:10px;color:#1a1a1a;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{html,body{margin:0!important;padding:0!important}}
*{box-sizing:border-box;margin:0;padding:0}

/* ── Pagination ── */
.doc-header{page-break-inside:avoid;break-inside:avoid}
.doc-footer{page-break-inside:avoid;break-inside:avoid}
.proj-block+.proj-block{page-break-before:always;break-before:page}
/* Split view: do NOT repeat table headers on continuation pages — the Gantt SVG
   beside the table can't repeat anything, so a repeated thead shifts every row
   ~22px out of alignment with its bar on each page after the first. */
@media print{.split-view thead{display:table-row-group}}
/* Tables-only mode: frame the table; keep rows whole across page breaks.
   (Split view intentionally keeps pixel slicing — pushing table rows while the
   Gantt SVG slices freely would desync rows from bars.) */
.proj-block>table{border:1px solid #d4d4d4}
.proj-block>table tbody tr{page-break-inside:avoid;break-inside:avoid}

.doc-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;margin-bottom:18px;border-bottom:2.5px solid #1a1a1a}
.dh-left .exhibit{font-size:8.5px;font-weight:700;color:#4f46e5;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px}
.dh-left .title{font-size:17px;font-weight:700;color:#1a1a1a;line-height:1.15}
.dh-left .subline{font-size:9.5px;color:#555;margin-top:4px}
.dh-right{text-align:right;font-size:9px;color:#555;line-height:2}
.dh-right strong{color:#1a1a1a;font-weight:600}
.dh-right .conf{color:#b91c1c;font-weight:700;font-size:9px;margin-top:2px}
.proj-block{margin-bottom:20px}
.proj-name{font-size:14px;font-weight:700;color:#4f46e5;letter-spacing:0;padding-bottom:5px;margin-bottom:9px;border-bottom:2px solid #4f46e5}
.split-view{display:flex;align-items:flex-start;width:100%;border:1px solid #d4d4d4}
.split-table{border-right:1px solid #d4d4d4}
.split-table table.aligned{width:100%;border-collapse:collapse;font-size:9px;table-layout:fixed}
.split-table table.aligned thead th{position:relative;height:30px;padding:0 6px;vertical-align:middle;background:#1a1a1a;color:#fff;font-weight:700;font-size:8px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;text-align:left}
/* B392 — drag-to-resize handle on each header cell's right edge (preview only). */
.col-rs{position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:col-resize;z-index:6}
.col-rs:hover{background:rgba(99,102,241,.5)}
@media print{.col-rs{display:none}}
.split-table table.aligned tbody tr{height:18px}
.split-table table.aligned tbody tr.alt{background:#f6f6f6}
.split-table table.aligned tbody td{padding:0 6px;vertical-align:middle;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #ebebeb}
.pl-tri{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;font-size:8px;line-height:1;border-radius:3px;color:#64748b;background:#f1f3f5;border:1px solid #d4d8de;cursor:pointer;margin-right:3px;vertical-align:middle;user-select:none}
.c-cost{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pl-tri.open{background:#e8f0fe;color:#4f46e5;border-color:#b6cef7}
.pl-tri:hover{background:#eef0fe;color:#4f46e5;border-color:#c2c7f5}
@media print{.pl-tri{display:none}}
table{width:100%;border-collapse:collapse;font-size:9px}
thead tr{background:#1a1a1a}
thead th{padding:5px 6px;text-align:left;font-weight:700;font-size:8px;letter-spacing:.05em;text-transform:uppercase;color:#fff;white-space:nowrap}
tbody tr{border-bottom:1px solid #ebebeb}
tbody tr.alt{background:#f8f8f8}
td{padding:4px 6px;vertical-align:middle;line-height:1.3}
.c-id{color:#999;font-size:8px;white-space:nowrap}
.c-duration,.c-percentComplete,.c-predecessors{color:#666;white-space:nowrap}
.c-responsibleParty{color:#444}
.c-start,.c-end{white-space:nowrap;color:#555}
.gantt-wrap{margin-top:22px}
.section-label{font-size:9px;font-weight:700;color:#4f46e5;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #ddd}
.doc-footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:8px;color:#aaa}
.print-bar{position:fixed;bottom:20px;right:20px;display:flex;gap:8px;z-index:999}
.btn-pdf{background:#4f46e5;color:#fff;border:none;padding:10px 22px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.btn-cl{background:#fff;color:#555;border:1px solid #ddd;padding:10px 16px;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit}
@media print{.print-bar{display:none}}
</style></head><body>
<div class="print-bar"${forPreview?' style="display:none"':''}><button class="btn-cl" onclick="window.close()">&#x2715; Close</button><button class="btn-pdf" onclick="window.print()">&#8595; Save as PDF</button></div>
<script>
/*__PAGINATE_SRC__*/
(function(){
  var MODE='${forPreview?"preview":"print"}';
  var MT=${mTopPx}, MB=${mBotPx}, ML=${mLeftPx}, MR=${mRightPx};
  var PW=${pageWpx}, PH=${pageHpx};
  var CW=PW-ML-MR, CH=Math.max(160,PH-MT-MB)-2;  /* printable height, 2px sub-pixel slack */
  var GANTT_HEAD=30, GANTT_ROW=18;               /* must match buildGanttSVG HEADER_H (YEAR_TIER+MON_TIER) + ROW_H */
  var FRAME='#d4d4d4';

  function outerH(el){
    if(!el) return 0;
    var cs=getComputedStyle(el);
    return el.getBoundingClientRect().height+(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0);
  }

/*__PACK_SRC__*/
  /* Pure pagination: every page is a self-contained unit. Each chunk carries its
     own column header (headOv = frame + thead); continuation chunks add a
     "(continued)" label (contH). Whole rows only - a row never splits. */
  function packPages(model, BUDGET){
    var pages=[], cur=null, used=0;
    function open(){ cur={doc:false,proj:-1,name:false,cont:false,r0:0,r1:0,foot:false}; used=0; }
    function close(){ if(cur) pages.push(cur); cur=null; }
    open();
    if(model.docH){ cur.doc=true; used+=model.docH; }
    for(var p=0;p<model.projs.length;p++){
      var pr=model.projs[p];
      if(p>0){ close(); open(); }                 /* each project starts a fresh page */
      var i=0, first=true;
      while(i<pr.rows.length || first){
        var ov=(first?pr.nameH:pr.contH)+pr.headOv;
        var avail=BUDGET-used-ov;
        var cnt=0,h=0;
        while(i+cnt<pr.rows.length && h+pr.rows[i+cnt]<=avail){ h+=pr.rows[i+cnt]; cnt++; }
        if(cnt===0 && i<pr.rows.length){
          if(used>0){ close(); open(); continue; }/* retry on a clean page */
          cnt=1; h=pr.rows[i];                    /* single row taller than a page: force */
        }
        cur.proj=p;
        if(first) cur.name=true; else cur.cont=true;
        cur.r0=i; cur.r1=i+cnt;
        used+=ov+h; i+=cnt; first=false;
        if(i<pr.rows.length){ close(); open(); }
        else break;
      }
    }
    if(model.footH){
      if(used+model.footH>BUDGET && used>0){ close(); open(); }
      cur.foot=true; used+=model.footH;
    }
    close();
    return pages;
  }
/*__PACK_END__*/

  function paginate(){
    var body=document.body;
    /* 1. Stage the document offscreen at exact printable width and measure. */
    var master=document.createElement('div');
    master.style.cssText='width:'+CW+'px;position:absolute;left:-100000px;top:0;background:#fff';
    var kids=[].slice.call(body.children);
    for(var i=0;i<kids.length;i++){
      var el=kids[i];
      if(el.tagName==='SCRIPT'||el.tagName==='STYLE') continue;
      if(el.classList&&el.classList.contains('print-bar')) continue;
      master.appendChild(el);
    }
    body.style.padding='0'; body.style.margin='0';
    body.appendChild(master);

    var docEl=master.querySelector('.doc-header');
    var footEl=master.querySelector('.doc-footer');
    var blocks=[].slice.call(master.querySelectorAll('.proj-block'));
    /* continuation label sample - measured once, reused */
    var contSample=document.createElement('div');
    contSample.style.cssText='font:600 9px Arial,sans-serif;color:#4f46e5;letter-spacing:.04em;padding:0 0 4px';
    contSample.textContent='X - continued';
    master.appendChild(contSample);
    var contH=outerH(contSample);
    master.removeChild(contSample);

    var projs=[];
    for(var b=0;b<blocks.length;b++){
      var blk=blocks[b];
      var nameEl=blk.querySelector('.proj-name');
      var sv=blk.querySelector('.split-view');
      var tableEl=sv?sv.querySelector('table'):blk.querySelector('table');
      var theadEl=tableEl?tableEl.querySelector('thead'):null;
      var rowEls=tableEl?[].slice.call(tableEl.querySelectorAll('tbody tr')):[];
      var svgEl=sv?sv.querySelector('svg'):null;
      var tHalf=sv?sv.querySelector('.split-table'):null;
      projs.push({
        nameEl:nameEl, nameH:outerH(nameEl),
        nameTxt:nameEl?nameEl.textContent:'',
        split:!!sv,
        tableW:tHalf?tHalf.getBoundingClientRect().width:0,
        ganttW:svgEl?svgEl.getBoundingClientRect().width:0,
        theadEl:theadEl, rowEls:rowEls, svgEl:svgEl,
        contH:contH,
        headOv:2+(theadEl?theadEl.getBoundingClientRect().height:0),
        rows:rowEls.map(function(r){return r.getBoundingClientRect().height;})
      });
    }
    var model={docH:outerH(docEl), footH:outerH(footEl), projs:projs};
    var pages=packPages(model, CH);

    /* 2. Assemble each page as a real, self-contained DOM unit. */
    function svgWindow(svgEl,y0,h,w){
      var win=document.createElement('div');
      win.style.cssText='width:'+w+'px;height:'+h+'px;overflow:hidden;position:relative;flex-shrink:0';
      var c=svgEl.cloneNode(true);
      c.style.position='absolute'; c.style.left='0'; c.style.top=(-y0)+'px'; c.style.width=w+'px';
      win.appendChild(c);
      return win;
    }
    function buildPage(pg){
      var page=document.createElement('div');
      page.style.cssText='width:'+CW+'px;background:#fff';
      if(pg.doc&&docEl) page.appendChild(docEl);
      if(pg.proj>=0){
        var pr=projs[pg.proj];
        if(pg.name&&pr.nameEl) page.appendChild(pr.nameEl);
        if(pg.cont){
          var cl=document.createElement('div');
          cl.style.cssText='font:600 9px Arial,sans-serif;color:#4f46e5;letter-spacing:.04em;padding:0 0 4px';
          cl.textContent=pr.nameTxt+' - continued';
          page.appendChild(cl);
        }
        var framed=document.createElement('div');
        framed.style.cssText='border:1px solid '+FRAME+';background:#fff'+(pr.split?';display:flex;align-items:flex-start':'');
        var tbl=document.createElement('table');
        tbl.className='aligned';
        if(pr.theadEl) tbl.appendChild(pr.theadEl.cloneNode(true));
        var tb=document.createElement('tbody');
        for(var r=pg.r0;r<pg.r1;r++) tb.appendChild(pr.rowEls[r]);   /* move real rows */
        tbl.appendChild(tb);
        if(pr.split){
          var left=document.createElement('div');
          left.className='split-table';
          left.style.cssText='width:'+pr.tableW+'px;flex-shrink:0';
          left.appendChild(tbl);
          framed.appendChild(left);
          var right=document.createElement('div');
          right.className='split-gantt';                                                              /* keep the class so column drag-resize can trade width against it (B392) */
          right.style.cssText='width:'+pr.ganttW+'px;flex-shrink:0';
          if(pr.svgEl){                                                                                   /* a project filtered to zero rows yields an empty Gantt (no <svg>) → svgEl null; guard so svgWindow's cloneNode can't throw and blank the whole PDF */
            right.appendChild(svgWindow(pr.svgEl,0,GANTT_HEAD,pr.ganttW));                                /* date band: repeats every page */
            if(pg.r1>pg.r0) right.appendChild(svgWindow(pr.svgEl,GANTT_HEAD+pg.r0*GANTT_ROW,(pg.r1-pg.r0)*GANTT_ROW,pr.ganttW));
          }
          framed.appendChild(right);
        } else {
          framed.appendChild(tbl);
        }
        page.appendChild(framed);
      }
      if(pg.foot&&footEl) page.appendChild(footEl);
      return page;
    }

    var pageEls=pages.map(buildPage);
    master.parentNode.removeChild(master);

    /* 3. Render: preview = sheets on gray; print = one block per page. */
    if(MODE==='preview'){
      var wrap=document.createElement('div');
      wrap.style.cssText='width:'+PW+'px;padding:14px 0 6px;box-sizing:border-box';
      for(var p=0;p<pageEls.length;p++){
        var sheet=document.createElement('div');
        sheet.style.cssText='width:'+PW+'px;height:'+PH+'px;background:#fff;box-sizing:border-box;padding:'+MT+'px '+MR+'px '+MB+'px '+ML+'px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.35)';
        sheet.appendChild(pageEls[p]);
        wrap.appendChild(sheet);
        var lbl=document.createElement('div');
        lbl.textContent='Page '+(p+1)+' of '+pageEls.length;
        lbl.style.cssText='text-align:center;font:600 8px Arial,sans-serif;color:#56616b;letter-spacing:.9px;text-transform:uppercase;padding:7px 0 11px';
        wrap.appendChild(lbl);
      }
      body.style.background='#a9b2bb';
      body.appendChild(wrap);
      window.parent.postMessage({type:'planarPreviewHeight', h: body.scrollHeight}, '*');
    } else {
      var st=document.createElement('style');
      st.textContent='.pg{page-break-after:always;break-after:page;page-break-inside:avoid;break-inside:avoid}'
        +'.pg:last-child{page-break-after:auto;break-after:auto}'
        +'@media screen{body{background:#eef0f2;padding:18px 0}.pg{margin:0 auto 16px;outline:1px solid #d8d8d8;background:#fff;padding:'+MT+'px '+MR+'px '+MB+'px '+ML+'px;width:'+PW+'px;box-sizing:border-box}}'
        +'@media print{.pg{width:'+CW+'px}}';
      document.head.appendChild(st);
      for(var q=0;q<pageEls.length;q++){ pageEls[q].className='pg'; body.appendChild(pageEls[q]); }
    }
  }
  function go(){
    if(document.fonts && document.fonts.ready){ document.fonts.ready.then(function(){ setTimeout(paginate,30); }); }
    else setTimeout(paginate,80);
  }
  window.addEventListener('load',go);
})();
/*__PAGINATE_END__*/
<\/script>
<div class="doc-header">
  <div class="dh-left">
    ${cfg.exhibitLabel?`<div class="exhibit">${escapeHtml(cfg.exhibitLabel)}</div>`:""}
    <div class="title">${escapeHtml(cfg.projectTitle)}</div>
    ${cfg.preparedFor?`<div class="subline">Prepared for: <strong>${escapeHtml(cfg.preparedFor)}</strong></div>`:""}
  </div>
  <div class="dh-right">
    <div>Date:&nbsp;<strong>${escapeHtml(cfg.docDate)}</strong></div>
    ${cfg.preparedBy?`<div>Prepared by:&nbsp;<strong>${escapeHtml(cfg.preparedBy)}</strong></div>`:""}
    ${cfg.confidential?`<div class="conf">${escapeHtml(cfg.confidential)}</div>`:""}
  </div>
</div>
${bodyHtml}
<div class="doc-footer">
  <span>Generated ${new Date().toLocaleString()}</span>
  <span>${escapeHtml(cfg.confidential||"")}</span>
  <span>planar</span>
</div>
${forPreview?`<script>(function(){document.addEventListener("click",function(e){var el=e.target.closest&&e.target.closest("[data-collapse]");if(!el)return;e.preventDefault();e.stopPropagation();try{window.parent.postMessage({type:"planarToggleCollapse",key:el.getAttribute("data-collapse")},"*");}catch(_){}}, true);})();<\/script>`:""}
${resizeScript}
</body></html>`;
}

// ── PDFExportModal ────────────────────────────────────────
// PDFExportModal presentational helpers, hoisted to module scope so React keeps a STABLE
// component identity across renders. Defined inside the modal, each render minted a fresh
// identity, so React unmounted the live <input> and mounted a new one — stealing focus
// after every keystroke in the Header/Cover fields (B3/M4). Props-only (no closure over
// modal state); SHdr deliberately stays inside the modal because it closes over setSecOpen.
const Toggle = ({on,onChange}) => (
  <span onClick={()=>onChange(!on)} style={{width:28,height:15,borderRadius:8,background:on?"var(--amber)":"var(--bd2)",
    display:"inline-flex",alignItems:"center",cursor:"pointer",flexShrink:0,transition:"background .15s",padding:"0 2px"}}>
    <span style={{width:11,height:11,borderRadius:"50%",background:"var(--bg)",boxShadow:"0 1px 3px rgba(0,0,0,.2)",
      transform:on?"translateX(13px)":"translateX(0)",transition:"transform .15s",flexShrink:0}} />
  </span>
);
const SegBtn = ({options,value,onChange,small}) => (
  <div style={{display:"flex",border:"1px solid var(--bd2)",borderRadius:4,overflow:"hidden",flexShrink:0}}>
    {options.map(o=>(
      <span key={o.v} onClick={()=>onChange(o.v)} style={{padding:small?"2px 7px":"3px 9px",fontSize:10,cursor:"pointer",whiteSpace:"nowrap",
        background:value===o.v?"var(--amber)":"transparent",color:value===o.v?"#fff":"var(--mut)",
        transition:"background .12s,color .12s",fontWeight:value===o.v?500:400}}>{o.l}</span>
    ))}
  </div>
);
const Field = ({value,onChange,placeholder}) => (
  <input {...NO_AUTOFILL} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""}
    style={{width:"100%",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:3,
      padding:"3px 7px",fontSize:11,color:"var(--txt)",fontFamily:"inherit",outline:"none"}}
    onFocus={e=>e.target.style.borderColor="var(--blue)"}
    onBlur={e=>e.target.style.borderColor="var(--bd2)"} />
);
const Row = ({label,children}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"3px 0",gap:8,minHeight:26}}>
    <span style={{fontSize:11,color:"var(--txt)",flexShrink:0}}>{label}</span>
    {children}
  </div>
);
// B403 — silently persist & restore the export screen's settings across opens (no badge).
// Per browser/user via localStorage (the column WIDTH state already rides data.exportColWidths,
// B392; task-specific selection/collapse is intentionally NOT persisted). docDate is left to
// default to "today" each open rather than freezing a stale date onto an exhibit.
const EXPORT_PREFS_KEY = "planar:exportPrefs:v1";
const EXPORT_PERSIST_KEYS = ["orientation","pageSize","margins","columns","includeGantt","showToday","showArrows","barNames","labelAlign","healthFilter","exhibitLabel","projectTitle","preparedBy","preparedFor","confidential","timeUnit","zoomMul","panFrac"];
function loadExportPrefs(){ try { return JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY) || "{}") || {}; } catch { return {}; } }
function saveExportPrefs(obj){ try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(obj)); } catch (_) {} }

function PDFExportModal({data, activePid, onClose, setData}) {
  const projs = Object.values(data.projects);
  const now = new Date();
  const seedCollapsed = useMemo(() => {
    const out = [];
    Object.values(data.projects).forEach(p => p.tasks.forEach(t => {
      if (p.tasks.some(x => x.parentId === t.id) && t.isExpanded === false) out.push(p.id + ":" + t.id);
    }));
    return out;
  }, []);
  const initPrefs = useMemo(() => loadExportPrefs(), []);   // B403
  const [cfg, setCfg] = useState(() => {
    const base = {
      exhibitLabel: "",
      projectTitle: "",
      preparedBy: "", preparedFor: "",
      docDate: now.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}),
      orientation: "landscape",
      pageSize: "letter",
      margins: {top:"0.75", right:"0.75", bottom:"0.75", left:"0.75"},
      selProjects: activePid ? [String(activePid)] : projs.map(p => String(p.id)),
      columns: (() => { const PRINTABLE=new Set(["id","name","start","end","duration","health","percentComplete","responsibleParty","predecessors"]); const mc=(data.masterCols||[]).filter(k=>PRINTABLE.has(k)); return mc.length>0?mc:["id","name","start","end","duration","health","responsibleParty"]; })(),
      includeGantt: true,
      showToday: true,
      showArrows: true,
      barNames: true,                                              // in-chart Gantt names ON by default (B394)
      labelAlign: resolveLabelAlign(activePid!=null ? data.projects?.[activePid] : null),  // seed from the on-screen choice
      healthFilter: "all",
      confidential: "",
      collapsedIds: seedCollapsed,
      detailLevel: seedCollapsed.length ? "custom" : "all",
      // B392 — per-column width overrides from dragging a column edge in the preview.
      colWidths: data.exportColWidths || {},
      // B361 time axis: discrete unit (null = auto-fit), continuous fine multiplier, pan 0..1.
      timeUnit: null, zoomMul: 1, panFrac: 0,
    };
    // B403 — overlay the persisted choices (only the safe-to-restore keys).
    EXPORT_PERSIST_KEYS.forEach(k => { if (initPrefs[k] !== undefined) base[k] = initPrefs[k]; });
    return base;
  });
  const upd = patch => setCfg(c => ({...c, ...patch}));
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  const [headerOpen, setHeaderOpen] = useState(() => !!initPrefs.headerOpen);   // B403
  // Collapsible sidebar sections — default open; clicking a section header toggles it
  const [secOpen, setSecOpen] = useState(() => initPrefs.secOpen || {});        // B403
  const secIsOpen = k => secOpen[k] !== false;

  // B403 — silently persist the restorable settings on any change (no badge). Written
  // synchronously (not debounced) so closing the modal right after a change still saves it.
  useEffect(() => {
    const out = {}; EXPORT_PERSIST_KEYS.forEach(k => { out[k] = cfg[k]; });
    out.secOpen = secOpen; out.headerOpen = headerOpen;
    saveExportPrefs(out);
  }, [cfg, secOpen, headerOpen]);

  // Debounced config for preview (avoids re-render on every keystroke)
  const [previewCfg, setPreviewCfg] = useState(cfg);
  useEffect(() => {
    const t = setTimeout(() => setPreviewCfg(cfg), 280);
    return () => clearTimeout(t);
  }, [cfg]);

  // ── Collapse / detail level (exhibit-only; never written back to live tasks) ──
  // Collapse changes flush the preview immediately rather than waiting on the debounce.
  const applyCollapse = (idsArr, lvl) => { const next = {...cfg, collapsedIds: idsArr, detailLevel: lvl}; setCfg(next); setPreviewCfg(next); };
  const levelCollapsedIds = n => {
    const out = [];
    cfg.selProjects.forEach(pidStr => {
      const p = data.projects[pidStr]; if (!p) return;
      p.tasks.forEach(t => {
        if (!p.tasks.some(x => x.parentId === t.id)) return;
        let d = 0, cur = t; while (cur && cur.parentId != null) { d++; cur = p.tasks.find(x => x.id === cur.parentId); }
        if (d >= (n - 1)) out.push(p.id + ":" + t.id);
      });
    });
    return out;
  };
  const setDetailLevel = lvl => { if (lvl === "all") applyCollapse([], "all"); else applyCollapse(levelCollapsedIds(+lvl), String(lvl)); };
  const expandAll = () => setDetailLevel("all");
  const collapseAll = () => setDetailLevel("1");

  // Collapse toggles fired from the ▾/▸ triangles inside the preview iframe.
  useEffect(() => {
    const onToggle = e => {
      if (e.origin !== window.location.origin) return;   // B516: same-origin only (matches the nav/toolbar bridges)
      if (!e.data || e.data.type !== "planarToggleCollapse") return;
      const key = e.data.key, c = cfgRef.current, s = new Set(c.collapsedIds || []);
      if (s.has(key)) s.delete(key); else s.add(key);
      const next = {...c, collapsedIds: [...s], detailLevel: "custom"};
      setCfg(next); setPreviewCfg(next);
    };
    window.addEventListener("message", onToggle);
    return () => window.removeEventListener("message", onToggle);
  }, []);

  // Column drag-resize (B392) fired from a header handle inside the preview iframe: stash
  // the new width as an override (flush the preview immediately, like collapse) and persist
  // it on the schedule so the tuned exhibit comes back next time.
  useEffect(() => {
    const onResize = e => {
      if (e.origin !== window.location.origin) return;   // B516: same-origin only — this persists to saved data
      if (!e.data || e.data.type !== "planarColResize") return;
      const { key, w } = e.data;
      if (!key || !(w > 0)) return;
      const c = cfgRef.current, next = {...c, colWidths: {...(c.colWidths || {}), [key]: Math.round(w)}};
      setCfg(next); setPreviewCfg(next);
      if (setData) setData(d => ({...d, exportColWidths: {...(d.exportColWidths || {}), [key]: Math.round(w)}}));
    };
    window.addEventListener("message", onResize);
    return () => window.removeEventListener("message", onResize);
  }, []);
  const hasColOverrides = Object.keys(cfg.colWidths || {}).length > 0;
  const resetColWidths = () => {
    const next = {...cfg, colWidths: {}}; setCfg(next); setPreviewCfg(next);
    if (setData) setData(d => { const n = {...d}; delete n.exportColWidths; return n; });
  };

  // Blob URL for iframe preview
  const [previewUrl, setPreviewUrl] = useState(null);
  useEffect(() => {
    const html = buildPDFHtml(previewCfg, data, true);
    const blob = new Blob([html], {type:"text/html"});
    const url  = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewCfg]);

  // Measure preview pane width for scaling
  const previewPaneRef = useRef(null);
  const [paneW, setPaneW] = useState(760);
  const [_paneH, setPaneH] = useState(520);
  useEffect(() => {
    const el = previewPaneRef.current; if (!el) return;
    const obs = new ResizeObserver(([e]) => { setPaneW(e.contentRect.width); setPaneH(e.contentRect.height); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const _ps = PAGE_SIZES[cfg.pageSize] || PAGE_SIZES.letter;
  const pageW = Math.round((cfg.orientation === "landscape" ? _ps.h : _ps.w) * 96);
  const pageH = Math.round((cfg.orientation === "landscape" ? _ps.w : _ps.h) * 96);

  // iframe reports its full content height via postMessage — more reliable than reading contentDocument
  const iframeRef = useRef(null);
  const [iframeH, setIframeH] = useState(pageH);
  useEffect(() => { setIframeH(pageH); }, [pageH]);
  useEffect(() => {
    const handler = e => {
      if (e.origin !== window.location.origin) return;   // B516: same-origin only (matches the nav/toolbar bridges)
      if (e.data?.type === 'planarPreviewHeight') setIframeH(Math.max(pageH, e.data.h));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [pageH]);

  const fitScale = Math.min(1, (paneW - 48) / pageW);
  const [previewZoom, setPreviewZoom] = useState(1);
  const scale = fitScale * previewZoom;
  const zoomTo = z => setPreviewZoom(Math.min(4, Math.max(0.25, z)));
  // "Fit" resets BOTH the page magnification AND the time axis back to the auto-fit whole-
  // schedule frame (B361/B401) — one button that says "show everything, nicely framed".
  const fitWidth = () => { setPreviewZoom(1); upd({timeUnit:null, zoomMul:1, panFrac:0}); };

  // B361 — time-axis controls. The discrete unit and the continuous fine multiplier feed ONE
  // span inside buildGanttSVG (they compose, never fight); picking a unit snaps the multiplier.
  const setTimeUnit = u => upd({timeUnit:u, zoomMul:1, panFrac:0});
  const bumpScale = f => upd({zoomMul: Math.min(12, Math.max(0.25, (cfg.zoomMul||1) * f))});

  // B361 — "Pan" mode (renamed from "Move"): a hand-cursor drag slides the visible TIME window
  // left/right (horizontal → cfg.panFrac) and scrolls the sheet vertically; the wheel magnifies
  // the page. A transparent overlay captures these only WHILE pan is on, so the in-preview
  // collapse triangles / column drag-handles keep working under a real mouse when it's off.
  const [panMode, setPanMode] = useState(false);
  const panRef = useRef(null);
  const overlayRef = useRef(null);
  const flushRef = useRef(0);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !panMode) return;
    const pane = previewPaneRef.current;
    const PAN_SPAN = 520;   // px of horizontal drag = the full time range
    const onWheel = e => { e.preventDefault(); e.stopPropagation(); setPreviewZoom(z => Math.min(4, Math.max(0.25, z * (e.deltaY < 0 ? 1.1 : 1/1.1)))); };
    const onDown = e => { if (e.button !== 0) return; e.preventDefault(); panRef.current = { x:e.clientX, y:e.clientY, pf:(cfgRef.current.panFrac||0), st:pane?pane.scrollTop:0 }; el.style.cursor = "grabbing"; };
    const onMove = e => {
      const p = panRef.current; if (!p) return;
      if (pane) pane.scrollTop = p.st - (e.clientY - p.y);                            // vertical → scroll the sheet
      const pf = Math.max(-1.2, Math.min(1.2, p.pf - (e.clientX - p.x) / PAN_SPAN));  // horizontal → slide the window (offset from today-center)
      const next = {...cfgRef.current, panFrac: pf};
      setCfg(next);
      const now = Date.now();
      if (now - flushRef.current > 170) { setPreviewCfg(next); flushRef.current = now; }  // throttled live update
    };
    const onUp = () => { if (panRef.current) setPreviewCfg(cfgRef.current); panRef.current = null; if (el) el.style.cursor = "grab"; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('mousedown', onDown); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [panMode]);

  const COL_OPTS = [
    {k:"id",label:"ID"},{k:"name",label:"Task Name"},{k:"start",label:"Start"},
    {k:"end",label:"End"},{k:"duration",label:"Duration"},{k:"health",label:"Status"},
    {k:"percentComplete",label:"% Done"},{k:"responsibleParty",label:"Owner"},
    {k:"predecessors",label:"Predecessors"},{k:"cost",label:"Cost"},
  ];

  const openPrint = () => {
    const html = buildPDFHtml(cfg, data);
    const w = window.open("","_blank","width=1100,height=820");
    w.document.write(html); w.document.close();
  };

  // Toggle / SegBtn / Field / Row hoisted to module scope (above PDFExportModal) — B3/M4.
  const SHdr = ({title,k}) => (
    <div onClick={k ? ()=>setSecOpen(s=>({...s,[k]:!(s[k]!==false)})) : undefined}
      style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",
        padding:"9px 0 5px",borderBottom:"1px solid var(--bd)",marginBottom:5,
        cursor:k?"pointer":"default",userSelect:"none"}}
      onMouseEnter={k ? (e=>e.currentTarget.style.opacity="0.7") : undefined}
      onMouseLeave={k ? (e=>e.currentTarget.style.opacity="1") : undefined}>
      {title}
      {k && <span style={{fontSize:10,color:"var(--mut)",transform:secIsOpen(k)?"rotate(180deg)":"rotate(0deg)",
        transition:"transform .2s",display:"inline-block",lineHeight:1}}>▾</span>}
    </div>
  );

  // Shared styles for the floating preview toolbar (B361).
  const TB_BTN={width:22,height:20,border:"none",borderRadius:4,background:"rgba(255,255,255,0.16)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",lineHeight:1,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"};
  const TB_LBL={height:20,border:"none",borderRadius:4,background:"rgba(255,255,255,0.16)",color:"#fff",fontSize:10,fontWeight:600,padding:"0 8px",cursor:"pointer",fontFamily:"inherit"};
  const TB_TAG={color:"#aab2bd",fontSize:8,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase"};
  const TB_DIV={width:1,height:16,background:"rgba(255,255,255,0.22)",margin:"0 2px"};

  return (
    <div style={{position:"fixed",inset:0,background:"#000000a0",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div style={{background:"var(--surf)",border:"1px solid var(--bd2)",borderRadius:10,
        width:"min(98vw,1700px)",height:"min(96vh,960px)",display:"flex",flexDirection:"column",overflow:"hidden"}}
        onClick={e=>e.stopPropagation()}>

        {/* ── Top bar ── */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          padding:"12px 18px",borderBottom:"1px solid var(--bd)",flexShrink:0,background:"var(--bg)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:"var(--amber)",letterSpacing:".07em",textTransform:"uppercase",lineHeight:1,marginBottom:2}}>EXPORT</div>
              <div style={{fontSize:14,fontWeight:600,color:"var(--txt)"}}>PDF / Print Exhibit</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:10,color:"var(--mut)"}}>Opens print dialog — choose <strong>Save as PDF</strong></span>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={openPrint}
              style={{background:"var(--amber)",color:"#fff",borderColor:"var(--amber)",padding:"5px 16px",fontWeight:600,fontSize:12}}>
              Print / Save as PDF ↗
            </button>
          </div>
        </div>

        {/* ── Body: sidebar + preview ── */}
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>

          {/* Config sidebar */}
          <div style={{width:252,flexShrink:0,borderRight:"1px solid var(--bd)",overflowY:"auto",padding:"0 14px 16px",background:"var(--bg)"}}>

            <SHdr title="Projects" k="projects" />
            {secIsOpen("projects") && (
            <div style={{display:"flex",flexDirection:"column",gap:1,marginBottom:4}}>
              {projs.map(p=>(
                <label key={p.id} style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",padding:"3px 4px",borderRadius:3,transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <input type="checkbox" checked={cfg.selProjects.includes(String(p.id))}
                    onChange={e=>upd({selProjects:e.target.checked?[...cfg.selProjects,String(p.id)]:cfg.selProjects.filter(x=>x!==String(p.id))})}
                    style={{accentColor:"#4f46e5",width:12,height:12,flexShrink:0}} />
                  {/* B1873361 — picking WHICH schedules to export, so the qualified label
                      disambiguates two same-named schedules the same way the export's own
                      per-project header (crossScheduleLabel, buildPDFHtml) now does. */}
                  <span title={crossScheduleLabel(p)} style={{fontSize:11,color:"var(--txt)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{crossScheduleLabel(p)}</span>
                </label>
              ))}
            </div>
            )}

            <SHdr title="Layout" k="layout" />
            {secIsOpen("layout") && (<>
            <Row label="Size">
              <select value={cfg.pageSize} onChange={e=>upd({pageSize:e.target.value})}
                style={{flex:1,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:3,
                  padding:"3px 6px",fontSize:11,color:"var(--txt)",fontFamily:"inherit",outline:"none",cursor:"pointer"}}
                onFocus={e=>e.target.style.borderColor="var(--blue)"}
                onBlur={e=>e.target.style.borderColor="var(--bd2)"}>
                {Object.entries(PAGE_SIZES).map(([k,ps])=>(
                  <option key={k} value={k}>{ps.label}</option>
                ))}
              </select>
            </Row>
            <Row label="Orientation">
              <SegBtn small options={[{l:"Landscape",v:"landscape"},{l:"Portrait",v:"portrait"}]} value={cfg.orientation} onChange={v=>upd({orientation:v})} />
            </Row>
            <Row label="Tasks">
              <SegBtn small options={[{l:"All",v:"all"},{l:"Active",v:"active"},{l:"Done",v:"complete"}]} value={cfg.healthFilter} onChange={v=>upd({healthFilter:v})} />
            </Row>
            <Row label={<span style={{display:"inline-flex",alignItems:"center",gap:5}}>Detail{cfg.detailLevel==="custom" && <span style={{fontSize:8,fontWeight:700,color:"#4f46e5",background:"#eef0fe",padding:"1px 5px",borderRadius:99,letterSpacing:".03em"}}>CUSTOM</span>}</span>}>
              <SegBtn small options={[{l:"All",v:"all"},{l:"L1",v:"1"},{l:"1\u20132",v:"2"},{l:"1\u20133",v:"3"}]} value={cfg.detailLevel} onChange={setDetailLevel} />
            </Row>
            <div style={{display:"flex",gap:6,padding:"3px 0 1px"}}>
              {[["Expand all",expandAll],["Collapse all",collapseAll]].map(([lbl,fn])=>(
                <span key={lbl} onClick={fn} style={{flex:1,textAlign:"center",padding:"3px 0",fontSize:10,cursor:"pointer",borderRadius:4,border:"1px solid var(--bd2)",color:"var(--mut)",userSelect:"none",transition:"background .12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{lbl}</span>
              ))}
            </div>
            <div style={{fontSize:9.5,color:"var(--mut)",lineHeight:1.45,padding:"3px 0 1px"}}>Tip: click \u25BE on a row in the preview to open or collapse that branch. This only affects the exhibit \u2014 your live schedule stays as-is.</div>
            <Row label="Gantt"><Toggle on={cfg.includeGantt} onChange={v=>upd({includeGantt:v})} /></Row>
            {cfg.includeGantt && (
              <Row label="Today line"><Toggle on={cfg.showToday!==false} onChange={v=>upd({showToday:v})} /></Row>
            )}
            {cfg.includeGantt && (
              <Row label="Dep. arrows"><Toggle on={cfg.showArrows!==false} onChange={v=>upd({showArrows:v})} /></Row>
            )}
            {cfg.includeGantt && (
              <Row label="Time scale">
                <SegBtn small options={[{l:"Fit",v:"fit"},{l:"Qtr",v:"quarters"},{l:"Mo",v:"months"},{l:"Wk",v:"weeks"},{l:"Day",v:"days"}]} value={cfg.timeUnit||"fit"} onChange={v=>setTimeUnit(v==="fit"?null:v)} />
              </Row>
            )}
            {cfg.includeGantt && (
              <Row label="Bar names"><Toggle on={cfg.barNames!==false} onChange={v=>upd({barNames:v})} /></Row>
            )}
            {cfg.includeGantt && cfg.barNames!==false && (
              <Row label="Name align">
                <SegBtn small options={[{l:"Left",v:"left"},{l:"Center",v:"center"},{l:"Right",v:"right"}]} value={cfg.labelAlign||"right"} onChange={v=>upd({labelAlign:v})} />
              </Row>
            )}
            </>)}

            <SHdr title="Margins" k="margins" />
            {secIsOpen("margins") && (
            <div style={{marginBottom:6}}>
              <div style={{display:"flex",gap:4,marginBottom:6}}>
                {[{l:"Narrow",v:"0.5"},{l:"Normal",v:"0.75"},{l:"Wide",v:"1.0"}].map(p=>{
                  const isActive=cfg.margins.top===p.v&&cfg.margins.right===p.v&&cfg.margins.bottom===p.v&&cfg.margins.left===p.v;
                  return <span key={p.v} onClick={()=>upd({margins:{top:p.v,right:p.v,bottom:p.v,left:p.v}})}
                    style={{flex:1,textAlign:"center",padding:"3px 0",fontSize:10,cursor:"pointer",borderRadius:3,border:"1px solid var(--bd2)",
                      background:isActive?"var(--amber)":"transparent",color:isActive?"#fff":"var(--mut)",transition:"background .12s,color .12s"}}>{p.l}</span>;
                })}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                {[{k:"top",l:"Top"},{k:"right",l:"Right"},{k:"bottom",l:"Bot."},{k:"left",l:"Left"}].map(({k,l})=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:10,color:"var(--mut)",width:28,flexShrink:0}}>{l}</span>
                    <div style={{position:"relative",flex:1,display:"flex",alignItems:"center"}}>
                      <input type="number" step="0.25" min="0" max="2" value={cfg.margins[k]}
                        onChange={e=>upd({margins:{...cfg.margins,[k]:e.target.value}})}
                        style={{width:"100%",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:3,
                          padding:"3px 22px 3px 6px",fontSize:11,color:"var(--txt)",fontFamily:"inherit",outline:"none"}}
                        onFocus={e=>e.target.style.borderColor="var(--blue)"}
                        onBlur={e=>e.target.style.borderColor="var(--bd2)"} />
                      <span style={{position:"absolute",right:5,fontSize:9,color:"var(--mut)",pointerEvents:"none"}}>in</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* Collapsible Header / Cover section */}
            <div onClick={()=>setHeaderOpen(o=>!o)}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",
                padding:"6px 0 5px",borderBottom:"1px solid var(--bd)",marginBottom:5,userSelect:"none"}}
              onMouseEnter={e=>e.currentTarget.style.opacity="0.7"}
              onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <span style={{fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase"}}>
                Header / Cover
              </span>
              <span style={{fontSize:10,color:"var(--mut)",transform:headerOpen?"rotate(180deg)":"rotate(0deg)",
                transition:"transform .2s",display:"inline-block",lineHeight:1}}>▾</span>
            </div>
            {headerOpen && (
              <div style={{display:"flex",flexDirection:"column",gap:1,marginBottom:4}}>
                <Row label="Exhibit"><Field value={cfg.exhibitLabel} onChange={v=>upd({exhibitLabel:v})} placeholder="Exhibit A" /></Row>
                <Row label="Title"><Field value={cfg.projectTitle} onChange={v=>upd({projectTitle:v})} placeholder="Schedule title" /></Row>
                <Row label="Prep. by"><Field value={cfg.preparedBy} onChange={v=>upd({preparedBy:v})} placeholder="Name / company" /></Row>
                <Row label="Prep. for"><Field value={cfg.preparedFor} onChange={v=>upd({preparedFor:v})} placeholder="Client" /></Row>
                <Row label="Date"><Field value={cfg.docDate} onChange={v=>upd({docDate:v})} /></Row>
                <Row label="Conf. tag"><Field value={cfg.confidential} onChange={v=>upd({confidential:v})} placeholder="Confidential" /></Row>
              </div>
            )}

            <SHdr title="Columns" k="columns" />
            {secIsOpen("columns") && (
            <div style={{display:"flex",flexDirection:"column",gap:1}}>
              {COL_OPTS.map(c=>(
                <label key={c.k} style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",padding:"3px 4px",borderRadius:3,transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <input type="checkbox" checked={cfg.columns.includes(c.k)}
                    onChange={e=>upd({columns:e.target.checked?[...cfg.columns,c.k]:cfg.columns.filter(x=>x!==c.k)})}
                    style={{accentColor:"#4f46e5",width:12,height:12,flexShrink:0}} />
                  <span style={{fontSize:11,color:"var(--txt)"}}>{c.label}</span>
                </label>
              ))}
              {/* B392 — column widths auto-fit to content; drag a header edge in the preview to tune one. */}
              {cfg.includeGantt && (
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,marginTop:6,paddingTop:6,borderTop:"1px solid var(--bd)"}}>
                  <span style={{fontSize:10,color:"var(--mut)",lineHeight:1.3}}>Drag a column's right edge in the preview to resize it.</span>
                  {hasColOverrides && (
                    <span onClick={resetColWidths} title="Reset all columns to auto-fit"
                      style={{fontSize:10,fontWeight:600,color:"#4f46e5",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Reset</span>
                  )}
                </div>
              )}
            </div>
            )}

          </div>

          {/* Preview area = a NON-scrolling relative wrapper holding the scroller + a pinned
              toolbar. The toolbar lives OUTSIDE the scroller as an absolute overlay so it is
              always visible AND clickable (the old float/sticky-inside-flex toolbar was dead +
              intermittently visible — B361 bug fix). */}
          <div style={{flex:1,position:"relative",display:"flex",minWidth:0,background:"#e8eaed"}}>
            <div ref={previewPaneRef}
              style={{flex:1,overflow:"auto",display:"flex",alignItems:"flex-start",
                justifyContent: (pageW*scale > paneW-48) ? "flex-start" : "center", padding:24}}>
              {previewUrl && (
                <div style={{
                  width: pageW * scale, height: iframeH * scale, flexShrink: 0,
                  overflow: "hidden", background: "transparent", position: "relative",
                }}>
                  <iframe
                    ref={iframeRef}
                    key={previewUrl}
                    src={previewUrl}
                    style={{ width: pageW, height: iframeH, border: "none",
                      transformOrigin: "top left", transform: `scale(${scale})`, display: "block" }}
                    title="PDF Preview"
                  />
                  {/* Overlay captures drag-pan + wheel-zoom ONLY in Pan mode; otherwise it is
                      click-through so the preview's own collapse / column-resize controls work. */}
                  <div ref={overlayRef}
                    style={{position:"absolute",inset:0,zIndex:2,background:"transparent",
                      pointerEvents: panMode ? "auto" : "none", cursor: panMode ? "grab" : "default"}} />
                </div>
              )}
              {!previewUrl && (
                <div style={{color:"#888",fontSize:12,marginTop:60}}>Generating preview…</div>
              )}
            </div>

            {/* Floating controls (B361): page Zoom · time-axis Time stretch · Fit · Pan. */}
            {previewUrl && (
              <div style={{position:"absolute",top:12,right:12,zIndex:30,display:"flex",gap:5,alignItems:"center",
                background:"rgba(20,22,26,0.88)",borderRadius:7,padding:"4px 7px",userSelect:"none",fontFamily:"inherit",
                boxShadow:"0 2px 10px rgba(0,0,0,0.30)"}}>
                <span style={TB_TAG}>Zoom</span>
                <button onClick={()=>zoomTo(previewZoom/1.2)} title="Zoom out — magnify the page less" style={TB_BTN}>−</button>
                <span onClick={fitWidth} title="Reset to fit" style={{color:"#fff",fontSize:10,fontWeight:600,padding:"0 2px",cursor:"pointer",minWidth:30,textAlign:"center"}}>{Math.round(previewZoom*fitScale*100)}%</span>
                <button onClick={()=>zoomTo(previewZoom*1.2)} title="Zoom in — magnify the page more" style={TB_BTN}>+</button>
                {cfg.includeGantt && (<>
                  <span style={TB_DIV} />
                  <span style={TB_TAG}>Time</span>
                  <button onClick={()=>bumpScale(1/1.25)} title="Compress the time axis — fit more months across the chart" style={TB_BTN}>−</button>
                  <button onClick={()=>bumpScale(1.25)} title="Expand the time axis — fewer months, stretched wider" style={TB_BTN}>+</button>
                </>)}
                <span style={TB_DIV} />
                <button onClick={fitWidth} title="Fit the whole timeline & reset zoom" style={TB_LBL}>Fit</button>
                {cfg.includeGantt && (
                  <button onClick={()=>setPanMode(m=>!m)} title={panMode?"Stop panning (re-enable clicking in the preview)":"Pan — drag to slide the visible time window left/right"}
                    style={{...TB_LBL, background: panMode?"var(--amber)":"rgba(255,255,255,0.16)"}}>✋ Pan</button>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}


// ── NotesModal — per-task running log (B613 rebuild) ──────────────────
// A clean per-task running log. Each note is a two-column row: a compact M/D date in a fixed
// left rail (plain Schedule-purple text, click to edit) │ hairline divider │ the note body
// (click to edit in place). Newest first, no sort toggle. Add-at-top composer. Inline CRUD that
// never strands you — commit-on-Enter/blur SAVES and stays open; the panel closes ONLY on ✕ or a
// click that both STARTS and LANDS on the backdrop itself (defeats the old "editing dismisses the
// panel" bug + native-picker/portal clicks reaching the backdrop). All CRUD rides
// updateTask → setData, the same autosave/cloudSync path every task edit uses (B210/B212/B566).
const SCHED_ACCENT = "#7F77DD";        // Schedule module accent — chrome / solid fills only
const SCHED_ACCENT_TEXT = "#534AB7";   // AA-safe purple for small accent TEXT (the date) on white
const NOTE_RAIL_W = 54;

// Compact M/D for the rail — DISPLAY ONLY. The stored value stays a real, sortable ISO date
// ("YYYY-MM-DD"); this just trims it so the running log reads cleanly. A bare M/D can't tell the
// same day apart across years — acceptable for now (add a 2-digit year later only if it matters).
const noteShortMD = s => { if (!s) return ""; const [_y, m, d] = String(s).split("-"); return (m && d) ? `${+m}/${+d}` : ""; };
// Normalize any stored note date to the ISO a native <input type=date> needs. Every date the app
// writes is already ISO (parseFlexDate / fdLocal output); this is just defensive for legacy values.
const noteISO = s => parseFlexDate(s) || "";

// Shared inline-editor styles. The native date input pops wider than the compact rail while
// editing — that's fine (spec): the resting display stays compact, only the editor is wide.
const noteDateInputStyle = {
  width: 132, background: "var(--bg)", border: `1px solid ${SCHED_ACCENT}`, borderRadius: 5,
  padding: "3px 6px", fontSize: 12, fontFamily: "inherit", outline: "none",
  color: "var(--txt)", boxSizing: "border-box",
};
const noteDateBtnStyle = {
  background: "transparent", border: "none", padding: "0 2px", cursor: "pointer",
  color: SCHED_ACCENT_TEXT, fontWeight: 600, fontSize: 12, fontFamily: "inherit",
  lineHeight: 1.4, whiteSpace: "nowrap",
};

// One note row — MODULE SCOPE, never defined inside NotesModal: an inner-defined component
// remounts every render and drops the caret/focus (the B247/B258 trap). Fully controlled by the
// parent, so the editable text/date inputs keep focus across the parent's re-renders.
function NoteRow({ note, bodyFs, editingText, editingDate, textValue, dateValue,
                   onTextChange, onDateChange, onStartText, onStartDate, onCommit, onCancel, onDelete }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "flex-start", gap: 10,
        padding: "9px 2px", borderBottom: "1px solid var(--bd)", position: "relative" }}>
      {/* left rail — compact date, click to edit (native picker) */}
      <div style={{ minWidth: NOTE_RAIL_W, flexShrink: 0, paddingTop: 1 }}>
        {editingDate
          ? <input type="date" autoFocus value={dateValue}
              onChange={e => onDateChange(e.target.value)}
              onBlur={onCommit}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onCommit(); }
                                if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
              style={noteDateInputStyle} />
          : <button onClick={() => onStartDate()} style={noteDateBtnStyle}
              title="Click to change the date">{noteShortMD(note.date) || "—"}</button>}
      </div>
      {/* hairline divider */}
      <div style={{ width: 1, alignSelf: "stretch", background: "var(--bd)", flexShrink: 0 }} />
      {/* body — click to edit in place */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
        {editingText
          ? <textarea autoFocus value={textValue}
              onChange={e => onTextChange(e.target.value)}
              onBlur={onCommit}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); onCommit(); }
                                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }}
              style={{ width: "100%", background: "var(--bg)", border: `1px solid ${SCHED_ACCENT}`,
                borderRadius: 5, padding: "6px 8px", color: "var(--txt)", fontSize: bodyFs,
                lineHeight: 1.55, fontFamily: "inherit", resize: "vertical", minHeight: 46, outline: "none" }} />
          : <div onClick={() => onStartText()}
              style={{ color: "var(--txt)", fontSize: bodyFs, lineHeight: 1.55, cursor: "text",
                whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 18 }}>{note.text}</div>}
      </div>
      {/* delete — reveals on row hover */}
      {!editingText && !editingDate && (
        <span onClick={() => onDelete()} title="Delete note"
          style={{ position: "absolute", top: 8, right: 2, cursor: "pointer", fontSize: 13, lineHeight: 1,
            color: hover ? "#dc2626" : "transparent", transition: "color .12s", userSelect: "none" }}>✕</span>
      )}
    </div>
  );
}

// The add-at-top composer — also MODULE SCOPE. Body textarea always live; the date defaults to
// today and is click-to-edit like a row. Enter (no Shift) adds; the note prepends (today = newest
// under the descending sort) and the composer clears for the next entry.
function AddNoteComposer({ text, onText, dateISO, onDate, onAdd, bodyRef }) {
  const [dateEdit, setDateEdit] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 2px 12px" }}>
      <div style={{ minWidth: NOTE_RAIL_W, flexShrink: 0, paddingTop: 6 }}>
        {dateEdit
          ? <input type="date" autoFocus value={dateISO}
              onChange={e => onDate(e.target.value)}
              onBlur={() => setDateEdit(false)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setDateEdit(false); } }}
              style={noteDateInputStyle} />
          : <button onClick={() => setDateEdit(true)} style={noteDateBtnStyle}
              title="Click to change the date">{noteShortMD(dateISO) || "—"}</button>}
      </div>
      <div style={{ width: 1, alignSelf: "stretch", background: "var(--bd)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
        <textarea ref={bodyRef} value={text} onChange={e => onText(e.target.value)}
          placeholder="Add a note…"
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); onAdd(); } }}
          style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--bd2)", borderRadius: 5,
            padding: "7px 9px", color: "var(--txt)", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit",
            resize: "vertical", minHeight: 44, outline: "none", transition: "border-color .15s" }}
          onFocus={e => e.target.style.borderColor = SCHED_ACCENT}
          onBlur={e => e.target.style.borderColor = "var(--bd2)"} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={() => onAdd()}
            style={{ padding: "5px 16px", background: SCHED_ACCENT, color: "#fff", border: "none",
              borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}

function NotesModal({ task, projectId, updateTask, onClose, initChar }) {
  const [draftText, setDraftText] = useState(() => initChar || "");
  const [draftDate, setDraftDate] = useState(() => NOW);   // ISO; defaults to today
  const [edit, setEdit] = useState(null);                  // { id, field:'text'|'date' } | null
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Body text size honors the per-note stamp (set from the Notes column-header control), else the
  // saved default, else Small — so the existing "Text size" preference keeps working.
  const defSize = (() => { try { return localStorage.getItem("planar_noteSize") || "sm"; } catch { return "sm"; } })();
  const noteFs = n => NOTE_SIZES.find(s => s.k === (n.size || defSize))?.px ?? 13;

  const taRef = useRef(null);
  const backdropRef = useRef(null);
  const downOnBackdropRef = useRef(false);
  const editRef = useRef(null);
  useEffect(() => { editRef.current = edit; }, [edit]);

  // Focus the composer on open; caret at end so an initChar keystroke continues seamlessly.
  useEffect(() => {
    const ta = taRef.current;
    if (ta) { const len = ta.value.length; ta.focus(); ta.selectionStart = ta.selectionEnd = len; }
  }, []);

  // Escape cancels an active inline edit; otherwise closes the panel. Capture phase so it wins
  // over the inputs' own handlers — but it only CLOSES when nothing is being edited, so a stray
  // Escape while editing a note can never dismiss the whole panel.
  useEffect(() => {
    const handler = e => {
      if (e.key !== "Escape") return;
      // Escape backs out one level: cancel an active row edit → close a composer date-picker →
      // else dismiss the panel. Never dismiss the panel out from under an open inline editor.
      if (editRef.current) { e.preventDefault(); e.stopPropagation(); editRef.current = null; setEdit(null); return; }
      const ae = document.activeElement;
      if (ae && ae.tagName === "INPUT" && ae.type === "date" && backdropRef.current && backdropRef.current.contains(ae)) return;
      onClose();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const notes = task.notes || [];
  // Descending by parsed date (newest first); stable tiebreak on id so same-day notes hold order.
  const sorted = [...notes].sort((a, b) => {
    const da = noteISO(a.date) || "", db = noteISO(b.date) || "";
    if (da !== db) return da < db ? 1 : -1;
    return (b.id || 0) - (a.id || 0);
  });

  const addDraft = () => {
    const v = (draftText || "").trim();
    if (!v) return;                                   // empty draft → nothing persisted
    const iso = noteISO(draftDate) || NOW;
    updateTask(task.id, { notes: [...notes, { id: Date.now(), date: iso, text: v }] }, projectId);
    setDraftText("");
    setDraftDate(NOW);
    if (taRef.current) taRef.current.focus();
  };

  const startText = n => { editRef.current = { id: n.id, field: "text" }; setEdit({ id: n.id, field: "text" }); setEditText(n.text || ""); };
  const startDate = n => { editRef.current = { id: n.id, field: "date" }; setEdit({ id: n.id, field: "date" }); setEditDate(noteISO(n.date) || NOW); };
  const cancelEdit = () => { editRef.current = null; setEdit(null); };
  const commitEdit = () => {
    const cur = editRef.current;
    if (!cur) return;                                 // guard re-entrant blur (Enter → setEdit(null) → blur)
    editRef.current = null;
    setEdit(null);
    const n = (task.notes || []).find(x => x.id === cur.id);
    if (!n) return;
    if (cur.field === "text") {
      const v = editText.trim();                      // empty edit leaves the note unchanged (never silently wipes)
      if (v && v !== n.text) updateTask(task.id, { notes: notes.map(x => x.id === cur.id ? { ...x, text: v } : x) }, projectId);
    } else {
      const iso = noteISO(editDate);
      if (iso && iso !== n.date) updateTask(task.id, { notes: notes.map(x => x.id === cur.id ? { ...x, date: iso } : x) }, projectId);
    }
  };

  const del = id => { if (editRef.current && editRef.current.id === id) { editRef.current = null; setEdit(null); } updateTask(task.id, { notes: notes.filter(n => n.id !== id) }, projectId); };
  const clearAll = () => { updateTask(task.id, { notes: [] }, projectId); setConfirmClear(false); setMenuOpen(false); };

  return (
    <div ref={backdropRef}
      onMouseDown={e => { downOnBackdropRef.current = (e.target === backdropRef.current); }}
      onClick={e => { const hit = e.target === backdropRef.current && downOnBackdropRef.current; downOnBackdropRef.current = false; if (hit) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "#00000090", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onMouseDown={e => e.stopPropagation()}
        style={{ background: "var(--bg)", border: "1px solid var(--bd2)", borderTop: `2px solid ${SCHED_ACCENT}`,
          borderRadius: 8, width: 560, maxWidth: "94vw", maxHeight: "78vh",
          display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,.22)" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          padding: "16px 18px 12px", borderBottom: "1px solid var(--bd)" }}>
          <div>
            <div style={{ color: SCHED_ACCENT_TEXT, fontWeight: 700, fontSize: 10, letterSpacing: ".08em", marginBottom: 3 }}>NOTES</div>
            <div style={{ color: "var(--txt)", fontSize: 14, fontWeight: 600 }}>{task.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ position: "relative" }}>
              {menuOpen && <div style={{ position: "fixed", inset: 0, zIndex: 998 }} onClick={() => { setMenuOpen(false); setConfirmClear(false); }} />}
              <button onClick={() => { setMenuOpen(o => !o); setConfirmClear(false); }}
                style={{ background: menuOpen ? "var(--surf)" : "transparent", border: "none", cursor: "pointer",
                  borderRadius: 5, padding: "3px 7px", fontSize: 16, lineHeight: 1, color: "var(--mut)", fontFamily: "inherit" }}>···</button>
              {menuOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--bg)",
                  border: "1px solid var(--bd2)", borderRadius: 8, boxShadow: "0 4px 18px rgba(0,0,0,.14)",
                  zIndex: 999, minWidth: 200, padding: 6 }}>
                  {notes.length === 0
                    ? <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--mut)" }}>No notes yet.</div>
                    : confirmClear
                      ? <div style={{ padding: "4px 6px" }}>
                          <div style={{ fontSize: 12, color: "var(--txt)", marginBottom: 8 }}>Delete all {notes.length} notes?</div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={clearAll} style={{ flex: 1, padding: "6px 0", background: "#dc2626", color: "#fff", border: "none", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Delete all</button>
                            <button onClick={() => setConfirmClear(false)} style={{ flex: 1, padding: "6px 0", background: "var(--surf)", color: "var(--txt)", border: "1px solid var(--bd2)", borderRadius: 5, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                          </div>
                        </div>
                      : <div onClick={() => setConfirmClear(true)}
                          style={{ padding: "8px 10px", cursor: "pointer", fontSize: 12, color: "#dc2626", borderRadius: 5 }}
                          onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Clear all notes</div>}
                </div>
              )}
            </div>
            <span onClick={onClose} title="Close"
              style={{ color: "var(--mut)", cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "2px 4px" }}>✕</span>
          </div>
        </div>

        {/* add-at-top composer */}
        <div style={{ padding: "0 18px", borderBottom: "1px solid var(--bd)" }}>
          <AddNoteComposer text={draftText} onText={setDraftText} dateISO={draftDate} onDate={setDraftDate} onAdd={addDraft} bodyRef={taRef} />
        </div>

        {/* running log — newest first */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 6px" }}>
          {sorted.length === 0
            ? <div style={{ color: "var(--mut)", fontSize: 13, textAlign: "center", padding: "28px 0" }}>No notes yet — add one above.</div>
            : sorted.map(n => (
                <NoteRow key={n.id} note={n} bodyFs={noteFs(n)}
                  editingText={!!edit && edit.id === n.id && edit.field === "text"}
                  editingDate={!!edit && edit.id === n.id && edit.field === "date"}
                  textValue={editText} dateValue={editDate}
                  onTextChange={setEditText} onDateChange={setEditDate}
                  onStartText={() => startText(n)} onStartDate={() => startDate(n)}
                  onCommit={commitEdit} onCancel={cancelEdit} onDelete={() => del(n.id)} />
              ))}
        </div>
      </div>
    </div>
  );
}

// ── Supabase cloud storage — syncs across all devices ──
// Layer 1: every save also writes to planar_history (throttled for 'auto' label).
// Layer 2: sanity-check refuses silent overwrite if task count drops drastically.
// Layer 3: RLS policies (server-side) prevent DELETE via anon key — see README.
(function() {
  // B408 consolidation (2026-07-11): scheduler data now lives in the MAIN Planyr project
  // (planyr-production, ref lyeqzkuiwngunutlkkmi) — same planar_* tables, data migrated + verified.
  const SUPABASE_URL = "https://lyeqzkuiwngunutlkkmi.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5ZXF6a3Vpd25ndW51dGxra21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjc0NjMsImV4cCI6MjA5Njk0MzQ2M30.1jyFWeEPWDR4-YYu5azWbWQN8P48cgyZCBqfOwrAnlk";
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  window.__sb = sb;            // exposed for the Suggestions view (planar_suggestions subscribe)
  const TABLE = "planar_data";
  const HISTORY_TABLE = "planar_history";

  // Throttle auto-label history writes — keep at most one per AUTO_HISTORY_MS
  const AUTO_HISTORY_MS = 30 * 1000;
  let lastAutoHistoryAt = 0;

  // Sanity-check: if old data has >20 tasks and new payload has <50%, ask before overwriting
  const SANITY_MIN_TASKS = 20;
  const SANITY_DROP_RATIO = 0.5;

  // -- Concurrency guard -- a per-tab "version stamp" so a stale tab can't
  // silently overwrite newer data another device saved. The stamp (__rev) lives
  // inside the JSON value; this tab remembers the rev it loaded or last wrote
  // (knownRev[k]) and refuses any auto-save once the cloud has moved past it.
  const knownRev = {};
  const baseByKey = {};   // B864(b) — the doc THIS tab last loaded or saved (the 3-way merge ancestor)
  const staleSnapped = {};
  const revOf = (p) => (p && typeof p.__rev === "number") ? p.__rev : 0;

  // B1777120 — THE AUTHORITY FLIP: per-schedule-row primary write path. Parallel to
  // knownRev/baseByKey/staleSnapped above, but keyed per SCHEDULE id (string), since each
  // schedule is now its own CAS row once an account is flipped (schedule_account_index.
  // rows_authoritative — see schedules_authority_flip.sql). indexKnownRev/indexBase play the
  // same role for the one account-wide schedule_account_index row (settings/lastActiveBySite/
  // nPid/nTid/migration flags). Seeded exactly once per load, by readFromScheduleRows below.
  const scheduleKnownRev = {};
  const scheduleBase = {};
  const scheduleStaleSnapped = {};
  let indexKnownRev = 0;
  let indexBase = null;
  let scheduleRowsAuthoritative = false;   // mirrored onto window.storage.scheduleRowsAuthoritative below
  const scheduleLastAutoHistoryAt = {};    // per-schedule throttle, mirrors lastAutoHistoryAt but per id
  const SCHEDULE_SANITY_MIN_TASKS = 20;
  const SCHEDULE_SANITY_DROP_RATIO = 0.5;
  // mergeCloudDoc / _mStripRev / _deepClone are defined at module scope (B864(b)) so both this storage
  // layer AND the App's reconcile listener share one implementation.

  // B1777120 — THE AUTHORITY FLIP, read side. Authority is decided PER ACCOUNT by
  // schedule_account_index.rows_authoritative, set by an operator only after a fresh decompose
  // has been proven to reconstruct the live blob exactly (see schedules_authority_flip.sql) — an
  // account that has never been flipped reads the blob exactly as before this item shipped; this
  // is not a global switch. SCHEDULE_ROWS_FORCE_FLAG is a local dev/test override (force ON even
  // if the account isn't flipped); SCHEDULE_ROWS_DISABLE_FLAG is an emergency kill-switch (force
  // OFF even if flipped) an operator can hand a stuck browser without waiting on a deploy. Both
  // live in localStorage, never a shareable query param.
  const SCHEDULE_ROWS_FORCE_FLAG = "planar:scheduleRowsRead";
  const SCHEDULE_ROWS_DISABLE_FLAG = "planar:scheduleRowsDisable";
  const scheduleRowsForced = () => { try { return localStorage.getItem(SCHEDULE_ROWS_FORCE_FLAG) === "1"; } catch { return false; } };
  const scheduleRowsDisabled = () => { try { return localStorage.getItem(SCHEDULE_ROWS_DISABLE_FLAG) === "1"; } catch { return false; } };
  const setScheduleRowsAuthoritative = (v) => { scheduleRowsAuthoritative = v; try { window.storage.scheduleRowsAuthoritative = v; } catch {} };
  // Reads schedule_account_index + schedules and recomposes the "hs-v1" shape from them. Returns
  // null on ANY absence, disable-override, non-flipped account, or failure (RLS denial, a thrown
  // error) so the caller falls back to the blob unconditionally — never a partial or wrong
  // document. Attaches the REAL current __rev (a cheap separate read, same shape as checkRemote
  // below) so the existing knownRev bookkeeping in `get` stays correct for the returned blob-
  // shaped value. Also seeds the PER-SCHEDULE + index baselines (scheduleKnownRev/scheduleBase/
  // indexKnownRev/indexBase) the write path below diffs every future save against — this is the
  // ONLY place those are seeded, since a real page reads "hs-v1" exactly once per load.
  let rowsReadFailed = false;
  const readFromScheduleRows = async (k) => {
    try {
      if (k !== "hs-v1" || scheduleRowsDisabled()) { setScheduleRowsAuthoritative(false); return null; }
      const { data: userRes } = await sb.auth.getUser();
      const ownerUid = userRes && userRes.user && userRes.user.id;
      if (!ownerUid) { setScheduleRowsAuthoritative(false); return null; }
      const [idxRes, schedRes, revRes] = await Promise.all([
        sb.from("schedule_account_index").select("*").eq("user_id", ownerUid).maybeSingle(),
        sb.from("schedules").select("*").eq("user_id", ownerUid).is("deleted_at", null),
        sb.from(TABLE).select("rev:value->>__rev").eq("key", k).maybeSingle(),
      ]);
      // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — an ERRORED read is not "this account isn't flipped": falling through
      // to the planar_data blob there would show (and let the user edit) a stale pre-flip copy of an account
      // whose real data lives in the rows. Flag it so get() reports a failed read instead.
      if (idxRes.error || schedRes.error) { rowsReadFailed = true; setScheduleRowsAuthoritative(false); return null; }
      if (!idxRes.data) { setScheduleRowsAuthoritative(false); return null; }
      const authoritative = !!idxRes.data.rows_authoritative || scheduleRowsForced();
      setScheduleRowsAuthoritative(authoritative);
      if (!authoritative) return null;
      const recomposed = recomposeFromRows(idxRes.data, schedRes.data);
      if (!recomposed) return null;
      Object.keys(scheduleKnownRev).forEach(kk => delete scheduleKnownRev[kk]);
      Object.keys(scheduleBase).forEach(kk => delete scheduleBase[kk]);
      (Array.isArray(schedRes.data) ? schedRes.data : []).forEach(row => {
        if (!row || row.id == null) return;
        const rk = String(row.id);
        scheduleKnownRev[rk] = typeof row.rev === "number" ? row.rev : 0;
        scheduleBase[rk] = row.data;
      });
      indexKnownRev = typeof idxRes.data.rev === "number" ? idxRes.data.rev : 0;
      indexBase = decomposeForDualWrite(recomposed).index;
      const rev = (revRes.data && revRes.data.rev != null) ? (parseInt(revRes.data.rev, 10) || 0) : 0;
      return { ...recomposed, __rev: rev };
    } catch {
      rowsReadFailed = true;   // a thrown read (network / timeout) — see the note on the errored read above
      setScheduleRowsAuthoritative(false);
      return null;
    }
  };

  // NEW-1 (false "A newer version was saved elsewhere" banner + empty "Merged in changes saved
  // elsewhere" toast on a flipped/rows_authoritative account, owner report 2026-09-25) —
  // readFromScheduleRows above necessarily seeds scheduleBase from the RAW stored row.data (it runs
  // before the App's normalize pipeline exists at all), but the in-app document is NEVER byte-equal
  // to that raw row: normalizeToV8/normalizeIds/ensureContacts/normalizeOwnerLists/
  // recascadeWithDrift rebuild every task object, and stripViewState strips the 13 top-level
  // view-state keys plus each task's own `focused`. So writeScheduleRowsPrimary's
  // `_mEq(s.data, base)` no-op check (below) was comparing apples to oranges on the FIRST save of
  // every load -- every schedule read as "changed" and got rewritten even with zero user edits,
  // which is exactly what made concurrent instances of the same idle account refuse each other's
  // writes (measured: three identical-rev refusals on one schedule inside one second) and raise the
  // banner over content that was never actually in conflict.
  //
  // Called once, right after the App finishes normalizing a freshly loaded/restored/seeded doc (the
  // load effect below, every path that produces a `d` it is about to hand to setData), so storage
  // holds the SAME shape it will actually diff against on the very next save -- making that save a
  // genuine no-op instead of a full rewrite. `doc` is handed in BEFORE stripViewState (same as
  // attemptCloudSave's own caller does) -- this applies the identical strip itself so the baseline
  // matches exactly what a real save would send. Deliberately leaves scheduleKnownRev untouched:
  // revs came from the real rows in readFromScheduleRows, and normalizing the DOCUMENT never moves
  // which rev the DATABASE is at. A no-op (silent return) for an account that isn't flipped, or
  // before readFromScheduleRows has run at all this session.
  const reseedScheduleBaseline = (doc) => {
    try {
      if (!scheduleRowsAuthoritative || !doc || typeof doc !== "object" || !doc.projects) return;
      const decomposed = decomposeForDualWrite(stripViewState(doc));
      if (!decomposed) return;
      decomposed.schedules.forEach(s => { scheduleBase[String(s.id)] = _deepClone(s.data); });
      indexBase = _deepClone(decomposed.index);
    } catch {}
  };

  const countTasks = (parsed) => {
    try {
      if (!parsed || !parsed.projects) return 0;
      return Object.values(parsed.projects).reduce((n, p) => n + (p.tasks?.length || 0), 0);
    } catch { return 0; }
  };
  const countProjects = (parsed) => {
    try { return Object.keys(parsed?.projects || {}).length; } catch { return 0; }
  };

  // Retention: keep the newest KEEP_SNAPSHOTS rows per key; prune the rest.
  // Without this the table grows by a full copy of the dataset every ~30s of
  // editing, forever — which bloats the database and slows everything down.
  const KEEP_SNAPSHOTS = 120;
  let _snapCount = 0;
  const _prune = async (k) => {
    try {
      // Find the timestamp of the (KEEP+1)th-newest snapshot, delete older.
      const { data, error } = await sb.from(HISTORY_TABLE)
        .select("created_at").eq("key", k)
        .order("created_at", { ascending: false })
        .range(KEEP_SNAPSHOTS, KEEP_SNAPSHOTS);
      if (error || !data || !data.length) return;
      const { error: delErr } = await sb.from(HISTORY_TABLE)
        .delete().eq("key", k).lt("created_at", data[0].created_at);
      if (delErr && !_prune._warned) {
        _prune._warned = true;
        console.warn("history prune blocked (RLS?). Run periodically in SQL editor:",
          "delete from planar_history where id not in (select id from planar_history order by created_at desc limit " + KEEP_SNAPSHOTS + ");");
      }
    } catch {}
  };

  // Insert a history row. Best-effort — fails silently if table doesn't exist
  // or RLS blocks the insert. Never blocks the main save.
  const _snapshot = async (k, parsed, label, byteSize) => {
    try {
      const { error } = await sb.from(HISTORY_TABLE).insert({
        key: k,
        value: parsed,
        label: label || "auto",
        task_count: countTasks(parsed),
        project_count: countProjects(parsed),
        byte_size: byteSize,
      });
      if (error) {
        // Only warn on first failure per session — table likely doesn't exist yet
        if (!_snapshot._warned) { _snapshot._warned = true; console.warn("history snapshot failed (run setup SQL?):", error.message); }
      } else if ((++_snapCount % 10) === 1) {
        _prune(k);   // fire-and-forget, every ~10th snapshot
      }
    } catch (e) {
      if (!_snapshot._warned) { _snapshot._warned = true; console.warn("history snapshot exception:", e); }
    }
  };

  // B1777120 — best-effort, non-blocking mirror of a successful "hs-v1" cloud save into the
  // normalized public.schedules / public.schedule_account_index tables. planar_data stays
  // authoritative — this NEVER blocks, retries, or surfaces an error into the primary save
  // path (called fire-and-forget from _rawSet, never awaited); a failure here is reported
  // (LOUD-FAILURE, via console.warn — there is no user-facing surface for a background mirror
  // that changes nothing the user can see) and simply tried again on the next save.
  // Deliberately does NOT tombstone a schedule that disappeared from this save's projects —
  // that reconciliation is schedules_decompose_from_planar_data()'s job (re-run by hand via
  // the Supabase MCP), kept out of the hot client save path on purpose. See
  // schedules_normalization.sql's header for why this is scaffolding, not the authority flip:
  // nothing anywhere in this app reads from these two tables yet except the opt-in dual-read
  // path below, which defaults off.
  const _dualWriteWarned = { flag: false };
  const dualWriteScheduleRows = async (k, doc) => {
    try {
      if (k !== "hs-v1") return;   // only the one real document shape this decomposes
      const decomposed = decomposeForDualWrite(doc);
      if (!decomposed) return;
      const { data: userRes } = await sb.auth.getUser();
      const ownerUid = userRes && userRes.user && userRes.user.id;
      if (!ownerUid) return;   // signed out — nothing to attribute rows to

      await sb.from("schedule_account_index").upsert({
        user_id: ownerUid,
        n_pid: decomposed.index.nPid,
        n_tid: decomposed.index.nTid,
        last_active_by_site: decomposed.index.lastActiveBySite,
        settings: decomposed.index.settings,
        migration_flags: decomposed.index.migrationFlags,
      }, { onConflict: "user_id" });

      if (!decomposed.schedules.length) return;
      const { data: existingRows } = await sb.from("schedules").select("id, rev").eq("user_id", ownerUid);
      const revById = new Map((existingRows || []).map(r => [r.id, r.rev]));
      const rows = decomposed.schedules.map(s => ({
        id: s.id,
        user_id: ownerUid,
        linked_site_id: s.linkedSiteId,
        linked_site_name: s.linkedSiteName,
        name: s.name,
        data: s.data,
        // Strictly-increasing on every dual-write so schedules_enforce_version_monotonic never
        // refuses it. A refusal here (a race with another concurrent dual-write) is harmless —
        // the whole point of this mirror is that it's best-effort; the NEXT save fixes it.
        rev: (revById.has(s.id) ? revById.get(s.id) : -1) + 1,
        deleted_at: null,
      }));
      await sb.from("schedules").upsert(rows, { onConflict: "id" });
    } catch (e) {
      if (!_dualWriteWarned.flag) { _dualWriteWarned.flag = true; console.warn("[schedule dual-write] best-effort decompose failed (planar_data is unaffected):", e); }
    }
  };

  // B1777120 — THE AUTHORITY FLIP, write side. Everything below is reached ONLY when
  // scheduleRowsAuthoritative is true for the signed-in account (readFromScheduleRows already
  // proved a real, migrated schedule_account_index row exists) — an account that has never been
  // flipped never calls any of this and keeps writing the blob exactly as before.

  // Per-schedule history: reuses planar_history (same table, schema, RLS, pruning) with a new
  // key shape ("schedule:<id>") instead of the whole-account "hs-v1" — "write new [snapshots]
  // per schedule" per this item's own acceptance text. Fire-and-forget, matching _snapshot's own
  // non-blocking shape; task_count/project_count are computed for a SINGLE project object, not a
  // whole doc, so this does not reuse _snapshot/countTasks/countProjects directly.
  const writeScheduleHistorySnapshot = (scheduleId, projData, label) => {
    try {
      if ((label || "auto") === "auto") {
        const now = Date.now();
        const last = scheduleLastAutoHistoryAt[scheduleId] || 0;
        if (now - last < AUTO_HISTORY_MS) return;
        scheduleLastAutoHistoryAt[scheduleId] = now;
      }
      const taskCount = (projData && Array.isArray(projData.tasks)) ? projData.tasks.length : 0;
      let byteSize = 0; try { byteSize = JSON.stringify(projData).length; } catch {}
      sb.from(HISTORY_TABLE).insert({
        key: "schedule:" + scheduleId, value: projData, label: label || "auto",
        task_count: taskCount, project_count: 1, byte_size: byteSize,
      }).then(({ error }) => {
        if (error && !writeScheduleHistorySnapshot._warned) {
          writeScheduleHistorySnapshot._warned = true;
          console.warn("per-schedule history snapshot failed (run setup SQL?):", error.message);
        }
      });
    } catch (e) {
      if (!writeScheduleHistorySnapshot._warned) { writeScheduleHistorySnapshot._warned = true; console.warn("per-schedule history snapshot exception:", e); }
    }
  };

  // The guarded write for ONE schedules row. `.select("id")` is required to SEE a refusal —
  // same reasoning as _rawSet's own attemptWrite below (a bare `.update()` with no `.select()`
  // sends `Prefer: return=minimal`, so PostgREST reports success whether
  // schedules_enforce_version_monotonic silently skipped the row or genuinely wrote it).
  const attemptScheduleWrite = async (id, data, baseRev) => {
    const newRev = (typeof baseRev === "number" ? baseRev : 0) + 1;
    const { data: rows, error } = await sb.from("schedules").update({
      data, rev: newRev,
      name: (data && typeof data.name === "string") ? data.name : "",
      linked_site_id: (data && data.linkedSiteId != null) ? data.linkedSiteId : null,
      linked_site_name: (data && data.linkedSiteName != null) ? data.linkedSiteName : null,
    }).eq("id", id).select("id");
    return { error, refused: !error && Array.isArray(rows) && rows.length === 0, newRev };
  };

  // Guarded write for ONE schedule — mirrors _rawSet's own Layer 0/2 + CAS-retry-once shape,
  // scoped to a single row so a stale write to schedule A can never touch schedule B (B1777120
  // acceptance: "a write to one schedule cannot modify another schedule's row").
  const writeOneScheduleRow = async (ownerUid, id, newData, { skipSanity, label }) => {
    const key = String(id);
    const curRev = scheduleKnownRev[key];
    const curData = scheduleBase[key];

    if (curRev === undefined) {
      // Unknown to this tab — a restore/import resurrecting an id (NEVER a race two tabs could
      // hit for a genuinely NEW schedule: addProject/duplicateProject always insert the row
      // FIRST and seed scheduleBase before that id can ever reach this path — see those
      // functions). Try a fresh INSERT; a 23505 conflict means the row already existed (another
      // tab's own insert, or this tab's cache was simply behind), so fall through to the
      // ordinary guarded update below, which re-reads fresh regardless.
      const { error: insErr } = await sb.from("schedules").insert({
        id, user_id: ownerUid, name: (newData && newData.name) || "", data: newData, rev: 0,
        linked_site_id: (newData && newData.linkedSiteId != null) ? newData.linkedSiteId : null,
        linked_site_name: (newData && newData.linkedSiteName != null) ? newData.linkedSiteName : null,
      });
      if (!insErr) {
        scheduleKnownRev[key] = 0; scheduleBase[key] = _deepClone(newData);
        writeScheduleHistorySnapshot(id, newData, label);
        return { merged: null };
      }
      if (insErr.code !== "23505") { console.error("[schedule rows] insert failed for schedule " + id + ":", insErr); return null; }
    } else if (!skipSanity) {
      const oldN = (curData && Array.isArray(curData.tasks)) ? curData.tasks.length : 0;
      const newN = (newData && Array.isArray(newData.tasks)) ? newData.tasks.length : 0;
      if (oldN > SCHEDULE_SANITY_MIN_TASKS && newN < oldN * SCHEDULE_SANITY_DROP_RATIO) {
        writeScheduleHistorySnapshot(id, curData, "safety-block");
        console.error("[schedule guard] Refused save for schedule " + id + ": tasks would drop " + oldN + " -> " + newN + ".");
        if (typeof showToast === "function") showToast("Save blocked for one schedule -- tasks would drop " + oldN + "->" + newN + ". Old state backed up.", { type: "error", duration: 6000 });
        return null;
      }
    }

    const baseRev = scheduleKnownRev[key] || 0;
    let attempt = await attemptScheduleWrite(id, newData, baseRev);
    if (attempt.error) { console.error("[schedule rows] write error for schedule " + id + ":", attempt.error); return null; }

    let payload = newData, mergedResult = null;
    if (attempt.refused) {
      const { data: row2, error: readErr } = await sb.from("schedules").select("data, rev").eq("id", id).maybeSingle();
      if (readErr || !row2) {
        if (!scheduleStaleSnapped[key]) { scheduleStaleSnapped[key] = true; writeScheduleHistorySnapshot(id, newData, "stale-block"); }
        console.error("[schedule guard] Write refused for schedule " + id + " and the current row could not be re-read afterward.");
        return null;
      }
      // NEW-1 (false "newer version"/empty-merge-toast on a flipped account, owner report
      // 2026-09-25) — a refusal whose cloud content is BYTE-IDENTICAL to what this tab tried to
      // write is not a conflict: some OTHER instance of this same account (another keep-alive
      // Scheduler iframe, another open tab) already wrote the identical data and bumped rev first.
      // Adopt its rev/data and stop here — no second CAS write, no stale-block snapshot, no
      // premerge-ours snapshot, no merge dance. Without this, every such race (measured live: three
      // identical-rev refusals on one schedule id inside one second) fell through to a real 3-way
      // merge attempt that could itself lose the race and raise the "saved elsewhere" banner over
      // content that was never actually in conflict.
      if (_mEq(row2.data, newData)) {
        scheduleKnownRev[key] = row2.rev;
        scheduleBase[key] = _deepClone(row2.data);
        scheduleStaleSnapped[key] = false;
        return { merged: null };
      }
      const base = scheduleBase[key];
      let merged = null;
      if (base !== undefined) { try { merged = mergeCloudDoc(base, newData, row2.data); } catch (e) { merged = null; } }
      if (!merged || !_mIsObj(merged)) {
        if (!scheduleStaleSnapped[key]) { scheduleStaleSnapped[key] = true; writeScheduleHistorySnapshot(id, newData, "stale-block"); }
        console.error("[schedule guard] Save blocked for schedule " + id + " (merge unavailable): cloud rev " + row2.rev + " is ahead of this tab.");
        return null;
      }
      // NEW-1 (same item) — the 3-way merge can itself resolve to exactly what the cloud row
      // already holds (this tab's own intended change was already fully present there via someone
      // else's write). Adopt without a second write rather than re-sending an identical payload.
      if (_mEq(merged, row2.data)) {
        scheduleKnownRev[key] = row2.rev;
        scheduleBase[key] = _deepClone(row2.data);
        scheduleStaleSnapped[key] = false;
        return { merged: null };
      }
      writeScheduleHistorySnapshot(id, newData, "premerge-ours");
      attempt = await attemptScheduleWrite(id, merged, row2.rev);
      if (attempt.error || attempt.refused) {
        if (!scheduleStaleSnapped[key]) { scheduleStaleSnapped[key] = true; writeScheduleHistorySnapshot(id, merged, "stale-block"); }
        console.error("[schedule guard] Save blocked for schedule " + id + ": lost the race twice in a row.");
        return null;
      }
      payload = merged; mergedResult = merged;
    }

    scheduleKnownRev[key] = attempt.newRev;
    scheduleBase[key] = _deepClone(payload);
    scheduleStaleSnapped[key] = false;
    writeScheduleHistorySnapshot(id, payload, label);
    return { merged: mergedResult };
  };

  // Guarded write for the ONE schedule_account_index row (settings/lastActiveBySite/nPid/nTid/
  // migration flags) — same CAS-retry-once shape as writeOneScheduleRow, independent of every
  // schedule row so a settings change never contends with a task edit in any schedule.
  const writeIndexRow = async (ownerUid, newIndex) => {
    const baseRev = indexKnownRev || 0;
    const newRev = baseRev + 1;
    const payload = {
      n_pid: newIndex.nPid, n_tid: newIndex.nTid, last_active_by_site: newIndex.lastActiveBySite,
      settings: newIndex.settings, migration_flags: newIndex.migrationFlags,
      rows_authoritative: true, rev: newRev,
    };
    const { data: rows, error } = await sb.from("schedule_account_index").update(payload).eq("user_id", ownerUid).select("user_id");
    if (error) { console.error("[schedule rows] index write error:", error); return null; }
    if (!(Array.isArray(rows) && rows.length === 0)) {
      indexKnownRev = newRev; indexBase = _deepClone(newIndex);
      return { merged: null };
    }
    const { data: row2, error: readErr } = await sb.from("schedule_account_index").select("*").eq("user_id", ownerUid).maybeSingle();
    if (readErr || !row2) { console.error("[schedule rows] index write refused and could not be re-read afterward"); return null; }
    const rowIndex = { nPid: row2.n_pid, nTid: row2.n_tid || {}, lastActiveBySite: row2.last_active_by_site || {}, settings: row2.settings || {}, migrationFlags: row2.migration_flags || {} };
    let merged = null;
    if (indexBase !== null) { try { merged = mergeCloudDoc(indexBase, newIndex, rowIndex); } catch (e) { merged = null; } }
    if (!merged) { console.error("[schedule rows] index write blocked -- merge unavailable"); return null; }
    const { data: rows2, error: err2 } = await sb.from("schedule_account_index").update({
      n_pid: merged.nPid, n_tid: merged.nTid, last_active_by_site: merged.lastActiveBySite,
      settings: merged.settings, migration_flags: merged.migrationFlags,
      rows_authoritative: true, rev: row2.rev + 1,
    }).eq("user_id", ownerUid).select("user_id");
    if (err2 || (Array.isArray(rows2) && rows2.length === 0)) { console.error("[schedule rows] index write blocked -- lost the race twice"); return null; }
    indexKnownRev = row2.rev + 1; indexBase = _deepClone(merged);
    return { merged };
  };

  // THE PRIMARY WRITE PATH for a flipped account — decomposes the whole "hs-v1"-shaped doc into
  // ONLY the pieces that actually changed since this tab's own last-known-good baseline, and
  // writes each independently: a write to one schedule can never modify another's row (B1777120
  // acceptance criterion, proven by construction — each writeOneScheduleRow call targets exactly
  // one `id`). Reassembles a whole-doc `planar:merged` event when anything merged so the App's
  // existing reconcile listener (mergeCloudDoc(ancestor, current, merged)) needs no changes at
  // all — it already treats "everything except a couple of fields is byte-identical to what I
  // sent" as "only those fields changed elsewhere", which is exactly what happened.
  const writeScheduleRowsPrimary = async (parsed, v, { skipSanity, label }) => {
    const { data: userRes } = await sb.auth.getUser();
    const ownerUid = userRes && userRes.user && userRes.user.id;
    if (!ownerUid) { console.error("[schedule rows] no signed-in user -- cannot save"); return null; }

    const decomposed = decomposeForDualWrite(parsed);
    if (!decomposed) return null;

    let mergedForApp = null;
    let anythingMerged = false;
    let anyFailure = false;
    let deleteRefused = false;   // B2429233 — a soft-delete the database refused (not a stale-tab condition: no "reload" banner)
    const ensureMergedForApp = () => { if (!mergedForApp) mergedForApp = _deepClone(parsed); return mergedForApp; };

    if (indexBase === null || !_mEq(decomposed.index, indexBase)) {
      const idxResult = await writeIndexRow(ownerUid, decomposed.index);
      if (idxResult === null) {
        anyFailure = true;
      } else if (idxResult.merged) {
        const m = ensureMergedForApp();
        m.nPid = idxResult.merged.nPid; m.nTid = idxResult.merged.nTid;
        m.lastActiveBySite = idxResult.merged.lastActiveBySite; m.settings = idxResult.merged.settings;
        Object.assign(m, idxResult.merged.migrationFlags);
        anythingMerged = true;
      }
    }

    const currentIds = new Set(decomposed.schedules.map(s => String(s.id)));
    for (const s of decomposed.schedules) {
      const key = String(s.id);
      const base = scheduleBase[key];
      if (base !== undefined && _mEq(s.data, base)) continue;   // unchanged -- nothing to write
      const result = await writeOneScheduleRow(ownerUid, s.id, s.data, { skipSanity, label });
      if (result === null) { anyFailure = true; continue; }
      if (result.merged) {
        const m = ensureMergedForApp();
        m.projects = { ...m.projects, [key]: result.merged };
        anythingMerged = true;
      }
    }

    for (const key of Object.keys(scheduleBase)) {
      if (currentIds.has(key)) continue;   // still present -- nothing to tombstone
      // B2429233 LOUD-FAILURE — supabase-js RETURNS {error} instead of throwing, so the old try/catch
      // never saw a refused soft-delete and the schedule base was dropped as if it had worked: the
      // row stayed in the database and came back on reload with nothing said. Check the result (an
      // error, or zero rows touched = refused by RLS), keep the base so the NEXT save retries it,
      // and say so.
      let softDeleteFailed = null;
      try {
        const sd = await sb.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", Number(key)).select("id");
        if (sd.error) softDeleteFailed = sd.error;
        else if (!Array.isArray(sd.data) || sd.data.length === 0) softDeleteFailed = { message: "no row was updated", code: "0 rows" };
      } catch (e) { softDeleteFailed = e; }
      if (softDeleteFailed) {
        console.error("[schedule rows] soft-delete failed for schedule " + key, softDeleteFailed);
        deleteRefused = true;
        try {
          const now = Date.now();
          if (now - (window.__planarSaveFailToastAt || 0) >= 8000) {
            window.__planarSaveFailToastAt = now;
            if (typeof showToast === "function") showToast("A deleted schedule could NOT be removed from the cloud (" + (softDeleteFailed.code || softDeleteFailed.status || "error") + "). It may come back when you reload — try the delete again.", { type: "error", duration: 10000 });
            window.dispatchEvent(new CustomEvent("planar:cloud-save-failed", { detail: { key: "hs-v1", code: softDeleteFailed.code } }));
          }
        } catch (e) {}
        continue;
      }
      delete scheduleBase[key]; delete scheduleKnownRev[key]; delete scheduleStaleSnapped[key];
    }

    if (anythingMerged) {
      try { window.dispatchEvent(new CustomEvent("planar:merged", { detail: { key: "hs-v1", base: _deepClone(parsed), value: mergedForApp } })); } catch {}
    }
    if (deleteRefused) return null;   // already toasted + planar:cloud-save-failed above; never announce "saved"
    try { window.dispatchEvent(new CustomEvent("planar:cloud-saved", { detail: { key: "hs-v1" } })); } catch {}

    if (anyFailure && !anythingMerged) {
      try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: "hs-v1" } })); } catch {}
      return null;
    }
    return { key: "hs-v1", value: v };
  };

  window.storage = {
    scheduleRowsAuthoritative: false,   // B1777120 — live-updated by setScheduleRowsAuthoritative; read by addProject/duplicateProject
    // NEW-1 (2026-09-25) — see reseedScheduleBaseline's own header above.
    reseedScheduleBaseline,
    // NEW-1 (2026-09-25) — re-reads the real schedule rows + index row and reseeds every baseline
    // from them (readFromScheduleRows already does the reseeding as a side effect; this just gives
    // the App a way to trigger that read on demand). Used by the live-refresh poll below to catch a
    // clean, visible tab up SILENTLY when another instance of the same account wrote first, instead
    // of nagging it with the "reload for the latest" banner over content it has nothing of its own
    // to lose. Returns the recomposed doc (same shape `get` returns) or null for an account that
    // isn't flipped / has no rows yet / hit a read error.
    silentRefresh: async (k) => {
      try {
        if (k !== "hs-v1" || !scheduleRowsAuthoritative) return null;
        return await readFromScheduleRows(k);
      } catch { return null; }
    },
    get: async (k) => {
      try {
        if (k === "hs-v1") { rowsReadFailed = false; window.__planarHs1Read = "pending"; }
        // B1777120 — THE AUTHORITY FLIP: readFromScheduleRows itself decides whether this
        // account is flipped (schedule_account_index.rows_authoritative), the disable
        // kill-switch, and the dev force-on override — this call is unconditional for "hs-v1"
        // and returns null (falling straight through to the blob read below, exactly as before
        // this item shipped) for every account that has not been deliberately flipped.
        if (k === "hs-v1") {
          const fromRows = await readFromScheduleRows(k);
          if (fromRows) {
            const val = JSON.stringify(fromRows);
            knownRev[k] = revOf(fromRows);
            baseByKey[k] = _mStripRev(_deepClone(fromRows));
            window.__planarHs1Read = "ok";
            return { key: k, value: val };
          }
          if (rowsReadFailed) { window.__planarCloudError = true; window.__planarHs1Read = "error"; return null; }
        }
        const { data, error } = await sb.from(TABLE).select("value").eq("key", k).single();
        if (error || !data) {
          // PGRST116 = "no rows" — a clean empty table, not an outage.
          // 42501 = RLS/grant denied this request — signed out or not on the schedule's
          // team, not a connectivity problem (B778/NEW-1: planar_data now requires an
          // authenticated, owner-or-team-scoped request).
          if (error && error.code === "42501") { window.__planarAuthRequired = true; if (k === "hs-v1") window.__planarHs1Read = "auth"; }
          else if (error && error.code !== "PGRST116") { window.__planarCloudError = true; if (k === "hs-v1") window.__planarHs1Read = "error"; }
          else if (k === "hs-v1") window.__planarHs1Read = "empty";
          return null;
        }
        if (k === "hs-v1") window.__planarHs1Read = "ok";
        const val = typeof data.value === "string" ? data.value : JSON.stringify(data.value);
        try { const p = typeof data.value === "string" ? JSON.parse(data.value) : data.value; knownRev[k] = revOf(p); baseByKey[k] = _mStripRev(_deepClone(p)); } catch { knownRev[k] = 0; }
        return { key: k, value: val };
      } catch { window.__planarCloudError = true; if (k === "hs-v1") window.__planarHs1Read = "error"; return null; }
    },
    // The unserialized write — see the `set` wrapper below, which is what callers actually use.
    _rawSet: async (k, v, opts = {}) => {
      try {
        // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — THE WRITE GUARD. No hs-v1 write may leave this page unless the
        // document was really READ first: a read that is still pending or that failed means whatever this
        // page holds (nothing, or the embedded demo copy) is NOT the account's data, and writing it would
        // overwrite the cloud with an empty/partial list. Refused loudly, never queued, never retried here.
        if (k === "hs-v1" && (window.__planarHs1Read === undefined || window.__planarHs1Read === "pending" || window.__planarHs1Read === "error")) {
          console.error("[planar guard] hs-v1 write refused: the schedule document has not been read from the cloud (" + (window.__planarHs1Read || "unread") + "). Nothing was written.");
          try { window.dispatchEvent(new CustomEvent("planar:write-refused-unloaded", { detail: { key: k, read: window.__planarHs1Read || "unread" } })); } catch {}
          return null;
        }
        let parsed;
        try { parsed = JSON.parse(v); } catch { parsed = v; }

        const label = opts.label || "auto";
        const isAuto = label === "auto";
        const skipSanity = !!opts.skipSanity;

        // B1777120 — THE AUTHORITY FLIP, write side. Once this account is flipped, an "hs-v1"
        // save no longer touches planar_data at all -- it decomposes into per-schedule/per-index
        // CAS writes. planar_data_refuse_post_flip_write (schedules_authority_flip.sql) is the
        // database-level backstop for a stale cached tab whose JS predates this branch and still
        // reaches the code below anyway.
        if (k === "hs-v1" && scheduleRowsAuthoritative && parsed && typeof parsed === "object" && parsed.projects) {
          return await writeScheduleRowsPrimary(parsed, v, { skipSanity, label });
        }

        // Read the current cloud row ONCE -- used for both the concurrency guard
        // (Layer 0) and the task-drop sanity check (Layer 2). If the read fails,
        // cloudRev stays null and we fail "open" (let the save proceed).
        let cloudRev = null, oldParsed = null;
        if (parsed && typeof parsed === "object" && parsed.projects) {
          try {
            const cur = await sb.from(TABLE).select("value").eq("key", k).single();
            if (cur.data && cur.data.value) {
              oldParsed = typeof cur.data.value === "string" ? JSON.parse(cur.data.value) : cur.data.value;
              cloudRev = revOf(oldParsed);
            } else if (cur.error && cur.error.code === "PGRST116") {
              cloudRev = 0;
            }
          } catch (e) { /* read failed -- leave cloudRev null (fail open) */ }
        }

        // NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — an autosave whose
        // content is UNCHANGED from what's already on the cloud (ignoring __rev) must never write at
        // all: no upsert, no rev bump, no history snapshot, no merge dance. Without this, a tab whose
        // ONLY "edit" was view-state churn that leaked into core data (a per-task field the
        // stripViewState pass above missed, the measured case being `focused`) still round-trips a
        // save that bumps __rev — which every OTHER open tab then reads as a genuine conflict, purely
        // from a tab that changed nothing a person would call an edit. This tab still converges:
        // knownRev/baseByKey are updated from the read already done, so the next REAL edit compares
        // against the true current cloud state. A miss here (key-order differences JSON.stringify is
        // sensitive to) just falls through to a redundant-but-harmless write — the existing behavior
        // — never the reverse: a genuine content difference can never be mistaken for a no-op.
        if (isAuto && !skipSanity && oldParsed && cloudRev != null && _mEq(_mStripRev(parsed), _mStripRev(oldParsed))) {
          knownRev[k] = cloudRev;
          baseByKey[k] = _mStripRev(_deepClone(oldParsed));
          staleSnapped[k] = false;
          return { key: k, value: v };
        }

        // Layer 0: concurrency guard. Auto-saves only -- explicit actions
        // (restore/import/delete/recascade pass skipSanity) are intentional
        // overwrites and pass through, becoming the newest version.
        // B864(b) — the cloud moved ahead of this tab (a sibling wrote). The old behavior BLOCKED the save
        // and forced a reload, which dropped THIS tab's edits from the cloud (and, when the loser was the
        // tab that had a just-created meeting calendar, orphaned the binding). Now we 3-way MERGE our edits
        // onto the newer cloud so BOTH survive; only if we lack a base ancestor do we fall back to blocking.
        if (isAuto && !skipSanity && cloudRev != null && cloudRev > (knownRev[k] || 0)) {  // treat an unknown base rev as 0 (seed/offline-fallback load never set knownRev) — matches checkRemote
          const base = baseByKey[k];
          const preOurs = _mStripRev(_deepClone(parsed));   // this tab's doc as of save-start (the App reconcile ancestor)
          if (base !== undefined && oldParsed && _mIsObj(parsed)) {
            let merged;
            try { merged = mergeCloudDoc(base, preOurs, _mStripRev(oldParsed)); } catch (e) { merged = null; }
            if (merged && _mIsObj(merged)) {
              // Snapshot the pre-merge doc so a bad merge is always recoverable, then continue with the merge.
              await _snapshot(k, parsed, "premerge-ours", v.length);
              staleSnapped[k] = false;
              // The App must adopt the merged doc so its IN-MEMORY state converges with the cloud (else the
              // next save, seeing the sibling's addition as a "delete" vs its new base, would drop it again).
              // It reconciles the merge against its CURRENT state via mergeCloudDoc(preOurs, current, merged),
              // so any edit made during this save's round-trip is preserved (preOurs is their common ancestor).
              const mergedForApp = _deepClone(merged);
              parsed = merged;   // fall through to Layer 2 + rev-stamp + write; oldParsed/cloudRev already read
              console.info("[planar guard] Cloud rev " + cloudRev + " was ahead of this tab (" + (knownRev[k] || 0) + "); auto-merged our edits onto it (both copies in Version History).");
              try { window.dispatchEvent(new CustomEvent("planar:merged", { detail: { key: k, cloudRev: cloudRev, knownRev: knownRev[k], base: preOurs, value: mergedForApp } })); } catch {}
            } else {
              if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
              console.error("[planar guard] Save blocked (merge unavailable): cloud rev " + cloudRev + " is ahead of this tab (" + knownRev[k] + "). Reload to get the latest; your copy is saved as 'stale-block'.");
              try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: cloudRev, knownRev: knownRev[k] } })); } catch {}
              return null;
            }
          } else {
            if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
            console.error("[planar guard] Save blocked: cloud rev " + cloudRev + " is ahead of this tab (" + knownRev[k] + "). Reload to get the latest; your copy is saved as 'stale-block'.");
            try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: cloudRev, knownRev: knownRev[k] } })); } catch {}
            return null;
          }
        }

        // Layer 2: pre-save sanity check (auto-saves only -- manual labels trusted)
        if (isAuto && !skipSanity && oldParsed) {
          const oldN = countTasks(oldParsed);
          const newN = countTasks(parsed);
          if (oldN > SANITY_MIN_TASKS && newN < oldN * SANITY_DROP_RATIO) {
            await _snapshot(k, oldParsed, "safety-block", JSON.stringify(oldParsed).length);
            console.error("[planar safety] Refused save: tasks would drop " + oldN + " -> " + newN + ". Old data snapshotted as 'safety-block'.");
            if (typeof showToast === "function") {
              showToast("Save blocked -- tasks would drop " + oldN + "->" + newN + ". Old state backed up.", { type: "error", duration: 6000 });
            }
            return null;
          }
        }

        // NEW-1 (B1629618, 2026-09-18) — the actual write is now ALSO guarded server-side, by
        // planar_data_version_monotonic_guard.sql: a BEFORE UPDATE trigger on public.planar_data
        // refuses any UPDATE whose value->>'__rev' does not strictly exceed the row's CURRENT
        // stored rev. That closes the gap Layer 0 above cannot: Layer 0 is a read-then-write check,
        // so two tabs can each pass it (each reading a cloudRev that really was current at the
        // moment it read) and still race each other to the ACTUAL write below -- whichever commits
        // SECOND must lose even though its own pre-write read looked clean. `.select("key")` is
        // required to SEE that a refusal happened at all: a plain `.upsert()` with no `.select()`
        // sends `Prefer: return=minimal`, so PostgREST reports success whether the trigger silently
        // skipped the row (0 rows touched) or genuinely wrote it -- the exact "a refused save tells
        // nobody" defect this repo already hit once for public.sites (B1693264). An empty `data`
        // array with no `error` IS the refusal signal.
        // B2095121 LOUD-FAILURE: a refused cloud write (e.g. 403 RLS 42501 on planar_data for an account whose
        // 'hs-v1' key is owned by another user) used to reach ONLY the console, while the grid still showed the
        // edit as saved and a reload threw it away. Say so, once per burst.
        const reportCloudSaveFailed = (err) => {
          try {
            const now = Date.now();
            if (now - (window.__planarSaveFailToastAt || 0) < 8000) return;
            window.__planarSaveFailToastAt = now;
            // NEW-1 (B2189604) — a permission refusal (42501 / 403) means this schedule document belongs to another
            // account, so the honest word is "view only", not a failed save: say so in amber, and still say the edit
            // is not kept. Every other failure keeps the red LOUD-FAILURE toast.
            if (err && (err.code === "42501" || err.status === 403)) {
              showToast("View only — this schedule belongs to another account, so your change is not saved. Create your own schedule to edit.", { type: "warn", duration: 10000 });
            } else {
              showToast("Your change did NOT save to the cloud (" + ((err && (err.code || err.status)) || "error") + "). It is only on this screen — reloading will lose it.", { type: "error", duration: 10000 });
            }
            window.dispatchEvent(new CustomEvent("planar:cloud-save-failed", { detail: { key: k, code: err && err.code } }));
          } catch (e) {}
        };
        const attemptWrite = async (payload, baseRevForStamp) => {
          const toWrite = _deepClone(payload);
          if (toWrite && typeof toWrite === "object") toWrite.__rev = baseRevForStamp + 1;
          const { data, error } = await sb.from(TABLE).upsert({ key: k, value: toWrite }, { onConflict: "key" }).select("key");
          return { toWrite: toWrite, error: error, refused: !error && Array.isArray(data) && data.length === 0 };
        };
        // Re-derive a merge against whichever cloud row actually won the race, mirroring Layer 0's
        // own merge shape (same base/preOurs/mergeCloudDoc), so a refusal converges the same honest
        // way a pre-write staleness detection already does.
        const mergeOnto = (theirsParsed) => {
          const base = baseByKey[k];
          const preOurs = _mStripRev(_deepClone(parsed));
          if (base === undefined || !_mIsObj(parsed)) return null;
          let merged;
          try { merged = mergeCloudDoc(base, preOurs, _mStripRev(theirsParsed)); } catch (e) { merged = null; }
          return (merged && _mIsObj(merged)) ? { merged: merged, preOurs: preOurs } : null;
        };

        let attempt = await attemptWrite(parsed, cloudRev != null ? cloudRev : (knownRev[k] || 0));
        if (attempt.error) { console.error("Supabase set error:", attempt.error); reportCloudSaveFailed(attempt.error); return null; }

        if (attempt.refused) {
          let freshOld = null, freshRev = null;
          try {
            const cur2 = await sb.from(TABLE).select("value").eq("key", k).single();
            if (cur2.data && cur2.data.value) {
              freshOld = typeof cur2.data.value === "string" ? JSON.parse(cur2.data.value) : cur2.data.value;
              freshRev = revOf(freshOld);
            }
          } catch (e) {}

          if (freshOld == null || freshRev == null) {
            if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
            console.error("[planar guard] Write refused by the server and the current cloud row could not be re-read afterward. Your copy is saved as 'stale-block'.");
            try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: freshRev, knownRev: knownRev[k] } })); } catch {}
            return null;
          } else if (skipSanity) {
            // An explicit checkpoint (pre-delete/pre-import/pre-restore/pre-recascade) means "this
            // exact version becomes newest" -- re-sequence it against whoever actually won the race
            // and retry once. Never silently dropped: a second refusal is a LOUD failure, since these
            // are exactly the moments (about to delete/import/restore) where losing it is worst.
            attempt = await attemptWrite(parsed, freshRev);
            if (attempt.error) { console.error("Supabase set error (explicit retry):", attempt.error); reportCloudSaveFailed(attempt.error); return null; }
            if (attempt.refused) {
              console.error("[planar guard] Explicit save ('" + label + "') was refused twice in a row -- a checkpoint could not be recorded.");
              if (typeof showToast === "function") showToast("Couldn't save a checkpoint before this action -- please try again.", { type: "error", duration: 6000 });
              await _snapshot(k, parsed, "stale-block", v.length);
              return null;
            }
          } else {
            const mergeResult = mergeOnto(freshOld);
            if (!mergeResult) {
              if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
              console.error("[planar guard] Save blocked (merge unavailable after a refused write): cloud rev " + freshRev + " is ahead of this tab. Reload to get the latest; your copy is saved as 'stale-block'.");
              try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: freshRev, knownRev: knownRev[k] } })); } catch {}
              return null;
            }
            await _snapshot(k, parsed, "premerge-ours", v.length);
            staleSnapped[k] = false;
            parsed = mergeResult.merged;
            attempt = await attemptWrite(parsed, freshRev);
            if (attempt.error) { console.error("Supabase set error (merge retry):", attempt.error); reportCloudSaveFailed(attempt.error); return null; }
            if (attempt.refused) {
              // A third writer landed in the retry's own window too -- vanishingly rare in practice,
              // but never loop or silently drop this tab's edits: block honestly instead.
              if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
              console.error("[planar guard] Save blocked: lost the race twice in a row. Reload to get the latest; your copy is saved as 'stale-block'.");
              try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: freshRev, knownRev: knownRev[k] } })); } catch {}
              return null;
            }
            console.info("[planar guard] Write was refused by the server (another save landed first); re-merged our edits onto it and saved (both copies in Version History).");
            try { window.dispatchEvent(new CustomEvent("planar:merged", { detail: { key: k, cloudRev: freshRev, knownRev: knownRev[k], base: mergeResult.preOurs, value: _deepClone(mergeResult.merged) } })); } catch {}
          }
        }

        parsed = attempt.toWrite;
        if (parsed && typeof parsed === "object") { knownRev[k] = parsed.__rev; baseByKey[k] = _mStripRev(_deepClone(parsed)); }   // B864(b): the just-written doc is the new merge ancestor
        staleSnapped[k] = false;

        // Tell the UI a cloud write landed -- drives the green save pulse in the header
        try { window.dispatchEvent(new CustomEvent("planar:cloud-saved", { detail: { key: k } })); } catch {}

        // B1777120 — best-effort, fire-and-forget mirror into the normalized schedule rows.
        // Never awaited: must add zero latency to this save and must never affect its outcome.
        dualWriteScheduleRows(k, parsed);

        // Layer 1: write a history snapshot (throttled for auto)
        const now = Date.now();
        const shouldSnapshot = !isAuto || (now - lastAutoHistoryAt) >= AUTO_HISTORY_MS;
        if (shouldSnapshot) {
          if (isAuto) lastAutoHistoryAt = now;
          _snapshot(k, parsed, label, v.length);
        }
        return { key: k, value: v };
      } catch { return null; }
    },
    // B1777120 — collision-proof schedule creation for a flipped account. Reserves a real
    // Postgres identity value via INSERT (never a client-guessed nPid two tabs could race on —
    // acceptance criterion 5), then patches the row with its own id embedded in `data` (every
    // other read site in this app assumes `proj.id === <its own key>`) and seeds
    // scheduleBase/scheduleKnownRev so the very next autosave for this schedule is an ordinary
    // guarded UPDATE, not a second insert attempt. Returns the new id, or null on any failure
    // (LOUD-FAILURE — the caller must never add an unsaved project to local state on a null).
    insertSchedule: async ({ name, ownerKind, linkedSiteId, linkedSiteName, projectData } = {}) => {
      try {
        const { data: userRes } = await sb.auth.getUser();
        const ownerUid = userRes && userRes.user && userRes.user.id;
        if (!ownerUid) return null;
        const { data: row, error } = await sb.from("schedules").insert({
          user_id: ownerUid,
          linked_site_id: linkedSiteId ?? null,
          linked_site_name: linkedSiteName ?? null,
          name: name || "",
          data: {},
          rev: 0,
        }).select("id").single();
        if (error || !row) { console.error("[schedule rows] insertSchedule failed:", error); return null; }
        const id = row.id;
        const finalName = name || ("Project " + id);
        const proj = projectData ? { ...projectData, id } : { id, name: finalName, tasks: [], ownerKind };
        if (linkedSiteId != null) { proj.linkedSiteId = linkedSiteId; proj.linkedSiteName = linkedSiteName || null; }
        const { error: updErr } = await sb.from("schedules").update({ name: proj.name || finalName, data: proj, rev: 1 }).eq("id", id);
        if (updErr) { console.error("[schedule rows] insertSchedule: could not finalize row", id, updErr); return null; }
        scheduleKnownRev[String(id)] = 1;
        scheduleBase[String(id)] = _deepClone(proj);
        return id;
      } catch (e) { console.error("[schedule rows] insertSchedule exception:", e); return null; }
    },
    // List history snapshots for a key, newest first.
    getHistory: async (k, limit = 100) => {
      try {
        const { data, error } = await sb.from(HISTORY_TABLE)
          .select("id, key, label, task_count, project_count, byte_size, created_at")
          .eq("key", k)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error || !data) return [];
        return data;
      } catch { return []; }
    },
    // Fetch the full value for a single history row.
    getHistoryValue: async (id) => {
      try {
        const { data, error } = await sb.from(HISTORY_TABLE).select("value").eq("id", id).single();
        if (error || !data) return null;
        return typeof data.value === "string" ? data.value : JSON.stringify(data.value);
      } catch { return null; }
    },
    delete: async (k) => {
      try {
        const { error } = await sb.from(TABLE).delete().eq("key", k);
        if (error) return null;
        return { key: k, deleted: true };
      } catch { return null; }
    },
    list: async (prefix) => {
      try {
        let q = sb.from(TABLE).select("key");
        if (prefix) q = q.like("key", prefix + "%");
        const { data, error } = await q;
        if (error || !data) return { keys: [] };
        return { keys: data.map(r => r.key) };
      } catch { return { keys: [] }; }
    },
    // Cheap "has the cloud moved ahead?" check for the live-refresh poll --
    // pulls only the version stamp, not the whole dataset.
    // B1777120 — once flipped, "hs-v1" no longer has a single moving __rev (planar_data is
    // frozen at whatever it held at flip time), so "newer?" is answered by summing every known
    // schedule's rev + the index row's rev and comparing against a fresh sum. Any real write
    // anywhere increases SOME row's rev by >=1, so this can't miss a genuine change; it CAN miss
    // the specific case of a schedule being soft-deleted elsewhere (its rev leaves the sum
    // entirely rather than increasing it) -- a known, accepted gap in this early-warning UI poll
    // only, never in the CAS-write path itself, which still merges/refuses correctly regardless.
    checkRemote: async (k) => {
      try {
        if (k === "hs-v1" && scheduleRowsAuthoritative) {
          const { data: userRes } = await sb.auth.getUser();
          const ownerUid = userRes && userRes.user && userRes.user.id;
          if (!ownerUid) return { ok: false };
          const [schedAgg, idxRes] = await Promise.all([
            sb.from("schedules").select("rev").eq("user_id", ownerUid).is("deleted_at", null),
            sb.from("schedule_account_index").select("rev").eq("user_id", ownerUid).maybeSingle(),
          ]);
          if (schedAgg.error || idxRes.error) return { ok: false };
          const cloudTotal = (schedAgg.data || []).reduce((n, r) => n + (r.rev || 0), 0) + ((idxRes.data && idxRes.data.rev) || 0);
          const knownTotal = Object.values(scheduleKnownRev).reduce((n, r) => n + (r || 0), 0) + (indexKnownRev || 0);
          return { ok: true, cloudRev: cloudTotal, knownRev: knownTotal, newer: cloudTotal > knownTotal };
        }
        const { data, error } = await sb.from(TABLE).select("rev:value->>__rev").eq("key", k).single();
        if (error || !data) return { ok: false };
        const cloudRev = data.rev == null ? 0 : (parseInt(data.rev, 10) || 0);
        const kr = knownRev[k] == null ? 0 : knownRev[k];
        return { ok: true, cloudRev: cloudRev, knownRev: kr, newer: cloudRev > kr };
      } catch { return { ok: false }; }
    },
  };

  // B851 recurrence (route↔grid divergence + false "newer version" banner) — the real cause, per
  // a forced-ordering simulation of this exact read-then-write guard: `_rawSet` above has NO
  // serialization. Every `data` change (a task edit, AND every carry-in re-drive — Scheduler.jsx's
  // carry-in effect posts on every app-wide project switch, even while the Schedule tab isn't
  // visible, B1342/NEW-2) fires its own unconditional `attemptCloudSave`. Browsing a few Site
  // Planner projects in a row before landing on Schedule can therefore have two or more real saves
  // to "hs-v1" in flight at once. `_rawSet`'s `cloudRev > knownRev[k]` guard is a plain client-side
  // read-then-write check with no server-side compare-and-swap: when two overlapping saves from
  // THIS tab complete OUT OF ORDER, whichever one's upsert lands LAST simply overwrites the cloud —
  // even if it was the FIRST one issued and its content is now stale, and even though the rev
  // sequence still looks monotonic to the guard, so NO conflict is ever detected (a silent clobber:
  // the reported wrong-project grid). In other interleavings the same gap makes this tab's OWN
  // in-flight write look like a foreign "newer version" to a LATER save from the same tab, tripping
  // the merge/block path and firing the false "a newer version was saved on another device" banner —
  // exactly B851's own prior diagnosis of that symptom, which its fix (killing REDUNDANT reposts of
  // an already-active schedule) never covered, because these are DIFFERENT, legitimately distinct
  // saves, not duplicates of the same one.
  //
  // The fix: serialize every write to a given key. At most one `_rawSet` call is ever in flight per
  // key. Two adjacent, still-unstarted AUTO saves (the fungible "here is the current `data`" saves
  // attemptCloudSave issues) coalesce into one — only the latest payload is worth writing, nothing
  // an even-newer `data` doesn't already contain is lost. An EXPLICIT save (skipSanity: true — the
  // pre-delete/pre-import/pre-restore/pre-recascade checkpoints, an intentional "persist THIS exact
  // version" call) is never coalesced away and never has a later auto-save coalesce past it — it
  // keeps its own place in line, so those checkpoints still land as their own distinct cloud
  // version. This closes the race at its root for every caller without touching the carry-in/nav
  // logic at all — that logic was never wrong; the storage layer underneath it never guaranteed
  // saves wouldn't overlap. Proven via ui-audit/stress/scheduler-engine.mjs's mergeCloudDoc mirror +
  // a forced-ordering harness: 2 of 3 realistic network-timing interleavings silently clobber the
  // correct value before this fix, 0 of 3 after it (see test/schedulerSaveQueue.test.js).
  const _saveQueue = {};   // key -> array of not-yet-started jobs, FIFO
  const _saveRunning = {}; // key -> true while a _rawSet call is in flight for that key
  const _drainSaveQueue = (k) => {
    if (_saveRunning[k]) return;
    const q = _saveQueue[k];
    if (!q || !q.length) return;
    _saveRunning[k] = true;
    const job = q.shift();
    window.storage._rawSet(k, job.v, job.opts)
      .then((res) => job.waiters.forEach((w) => w.resolve(res)))
      .catch((err) => job.waiters.forEach((w) => w.reject(err)))
      .finally(() => { _saveRunning[k] = false; _drainSaveQueue(k); });
  };
  window.storage.set = (k, v, opts = {}) => new Promise((resolve, reject) => {
    const isAuto = (opts.label || "auto") === "auto" && !opts.skipSanity;
    const q = _saveQueue[k] || (_saveQueue[k] = []);
    const tail = q[q.length - 1];
    if (isAuto && tail && tail.auto) { tail.v = v; tail.opts = opts; tail.waiters.push({ resolve, reject }); }
    else q.push({ v, opts, auto: isAuto, waiters: [{ resolve, reject }] });
    _drainSaveQueue(k);
  });
})();

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary><App /></ErrorBoundary>
);

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  removeScheduleFromDoc: [() => removeScheduleFromDoc],
  logMergeToastEvent: [() => logMergeToastEvent],
  ROW_H: [() => ROW_H, (v) => { ROW_H = v; }],
  GRID_LINE: [() => GRID_LINE],
  GRID_LINE_RANGE: [() => GRID_LINE_RANGE],
  PPD: [() => PPD],
  TL_H: [() => TL_H],
  BUF: [() => BUF],
  WIN_CHUNK: [() => WIN_CHUNK],
  WIN_OVER: [() => WIN_OVER],
  rowWindowTop: [() => rowWindowTop],
  rowWindow: [() => rowWindow],
  GRID_SCROLL_MEMO: [() => GRID_SCROLL_MEMO],
  GANTT_SCROLL_MEMO: [() => GANTT_SCROLL_MEMO],
  ROW_COLORS: [() => ROW_COLORS],
  escapeHtml: [() => escapeHtml],
  pinnedFillLayers: [() => pinnedFillLayers],
  SAFE_COLOR_RE: [() => SAFE_COLOR_RE],
  isValidColor: [() => isValidColor],
  FONT_SIZE_STEPS: [() => FONT_SIZE_STEPS],
  FONT_SIZE_MIN: [() => FONT_SIZE_MIN],
  FONT_SIZE_MAX: [() => FONT_SIZE_MAX],
  isValidFontSize: [() => isValidFontSize],
  stepFontSize: [() => stepFontSize],
  fmtBarDate: [() => fmtBarDate],
  barLabelText: [() => barLabelText],
  askConfirm: [() => askConfirm],
  mkt: [() => mkt],
  postLoadState: [() => postLoadState],
  LOAD_ATTEMPT_TIMEOUT_MS: [() => LOAD_ATTEMPT_TIMEOUT_MS],
  LOAD_RETRY_BASE_MS: [() => LOAD_RETRY_BASE_MS],
  LOAD_RETRY_MAX_MS: [() => LOAD_RETRY_MAX_MS],
  SEED: [() => SEED],
  lastRowPointerType: [() => lastRowPointerType, (v) => { lastRowPointerType = v; }],
  COLS: [() => COLS],
  TOTAL_W: [() => TOTAL_W],
  COL_BY_K: [() => COL_BY_K],
  DEFAULT_GRID_COLS: [() => DEFAULT_GRID_COLS],
  formulaColsOf: [() => formulaColsOf],
  readGridCfg: [() => readGridCfg],
  writeGridCfg: [() => writeGridCfg],
  COL_LABELS: [() => COL_LABELS],
  colLabel: [() => colLabel],
  formulaColToColDef: [() => formulaColToColDef],
  effectiveColsOf: [() => effectiveColsOf],
  activeEffectiveCols: [() => activeEffectiveCols],
  _pfDateRef: [() => _pfDateRef],
  _pfNumOrBlank: [() => _pfNumOrBlank],
  _pfCostRef: [() => _pfCostRef],
  FORMULA_BUILTIN_REFS: [() => FORMULA_BUILTIN_REFS],
  formulaCalendar: [() => formulaCalendar],
  formulaToday: [() => formulaToday],
  _formulaBuiltinMap: [() => _formulaBuiltinMap],
  buildFormulaRowColumns: [() => buildFormulaRowColumns],
  formulaColumnNames: [() => formulaColumnNames],
  isBuiltinFormulaName: [() => isBuiltinFormulaName],
  computeFormulaValues: [() => computeFormulaValues],
  stepVisibleColIdx: [() => stepVisibleColIdx],
  stepGridRow: [() => stepGridRow],
  ctrlJumpIndex: [() => ctrlJumpIndex],
  gridCtrlArrowTarget: [() => gridCtrlArrowTarget],
  gridCellBlank: [() => gridCellBlank],
  focusGroupIds: [() => focusGroupIds],
  rowCanFocus: [() => rowCanFocus],
  focusChipTitle: [() => focusChipTitle],
  focusToggleTarget: [() => focusToggleTarget],
  focusReselectTarget: [() => focusReselectTarget],
  celebrateTaskComplete: [() => celebrateTaskComplete],
  notifyRowsDeleted: [() => notifyRowsDeleted],
  FOOTER_BTN_STYLE: [() => FOOTER_BTN_STYLE],
  SuccessorPromptModal: [() => SuccessorPromptModal],
  DeleteChildrenModal: [() => DeleteChildrenModal],
  MoveToModal: [() => MoveToModal],
  ContactsPanel: [() => ContactsPanel],
  HistoryPanel: [() => HistoryPanel],
  ErrorBoundary: [() => ErrorBoundary],
  SGQ_HEALTH: [() => SGQ_HEALTH],
  SGQ_HKEYS: [() => SGQ_HKEYS],
  SGQ_AV: [() => SGQ_AV],
  SGQ_ALLOWED_PATCH: [() => SGQ_ALLOWED_PATCH],
  SGQ_MONTHS: [() => SGQ_MONTHS],
  sgqAvatarColor: [() => sgqAvatarColor],
  sgqInitials: [() => sgqInitials],
  sgqConfClass: [() => sgqConfClass],
  sgqFmtDate: [() => sgqFmtDate],
  SgqDot: [() => SgqDot],
  sgqChildrenOf: [() => sgqChildrenOf],
  sgqCrumbOf: [() => sgqCrumbOf],
  SgqCrumb: [() => SgqCrumb],
  SgqCascadePicker: [() => SgqCascadePicker],
  SgqChangeRow: [() => SgqChangeRow],
  InlineDate: [() => InlineDate],
  cleanEmailBody: [() => cleanEmailBody],
  SuggestionsView: [() => SuggestionsView],
  VIEW_TAB_KEYS: [() => VIEW_TAB_KEYS],
  VIEW_PREF_KEYS: [() => VIEW_PREF_KEYS],
  VIEW_TRANSIENT_KEYS: [() => VIEW_TRANSIENT_KEYS],
  VIEW_STATE_KEYS: [() => VIEW_STATE_KEYS],
  VIEW_TAB_STORAGE_KEY: [() => VIEW_TAB_STORAGE_KEY],
  VIEW_PREFS_STORAGE_KEY: [() => VIEW_PREFS_STORAGE_KEY],
  loadTabView: [() => loadTabView],
  saveTabView: [() => saveTabView],
  loadViewPrefs: [() => loadViewPrefs],
  saveViewPrefs: [() => saveViewPrefs],
  TASK_FOCUS_STORAGE_KEY: [() => TASK_FOCUS_STORAGE_KEY],
  loadTaskFocus: [() => loadTaskFocus],
  saveTaskFocus: [() => saveTaskFocus],
  applyTaskFocus: [() => applyTaskFocus],
  persistTaskFocus: [() => persistTaskFocus],
  coreChanged: [() => coreChanged],
  TASK_VIEW_FIELDS: [() => TASK_VIEW_FIELDS],
  stripTaskViewFields: [() => stripTaskViewFields],
  stripViewState: [() => stripViewState],
  withLastActiveSite: [() => withLastActiveSite],
  persistViewState: [() => persistViewState],
  pickActivePid: [() => pickActivePid],
  activeProjectOf: [() => activeProjectOf],
  resolveViewState: [() => resolveViewState],
  App: [() => App],
  ProjDropdown: [() => ProjDropdown],
  RenameModal: [() => RenameModal],
  ProjContextMenu: [() => ProjContextMenu],
  SwatchGrid: [() => SwatchGrid],
  CaretPopover: [() => CaretPopover],
  FormatMiniToolbar: [() => FormatMiniToolbar],
  TaskContextMenu: [() => TaskContextMenu],
  HEALTH_COL_STYLES: [() => HEALTH_COL_STYLES],
  HealthColHeaderIcon: [() => HealthColHeaderIcon],
  HealthColHeader: [() => HealthColHeader],
  STATUS_PALETTE: [() => STATUS_PALETTE],
  StatusHeaderDropdown: [() => StatusHeaderDropdown],
  NOTE_SIZES: [() => NOTE_SIZES],
  NotesColHeader: [() => NotesColHeader],
  GridColumnsChooser: [() => GridColumnsChooser],
  GridHeaderMenu: [() => GridHeaderMenu],
  FormulaColumnEditor: [() => FormulaColumnEditor],
  GridView: [() => GridView],
  PICKER_EVENT: [() => PICKER_EVENT],
  HealthPicker: [() => HealthPicker],
  StatusPicker: [() => StatusPicker],
  predLagPlainEnglish: [() => predLagPlainEnglish],
  PredEditor: [() => PredEditor],
  TASK_ICON_PX: [() => TASK_ICON_PX],
  TASK_ICON_GAP: [() => TASK_ICON_GAP],
  TASK_ICON_PAD: [() => TASK_ICON_PAD],
  TASK_ICON_AFTER: [() => TASK_ICON_AFTER],
  taskIconsW: [() => taskIconsW],
  TASK_ICON_UID: [() => TASK_ICON_UID, (v) => { TASK_ICON_UID = v; }],
  TaskIconGlyph: [() => TaskIconGlyph],
  TaskIconPicker: [() => TaskIconPicker],
  TaskIconSlot: [() => TaskIconSlot],
  TaskIconPickerHost: [() => TaskIconPickerHost],
  PhaseIconSummary: [() => PhaseIconSummary],
  Cell: [() => Cell],
  GANTT_INK: [() => GANTT_INK],
  resolveLabelAlign: [() => resolveLabelAlign],
  writeLabelAlign: [() => writeLabelAlign],
  ganttNameWeight: [() => ganttNameWeight],
  estLabelWidth: [() => estLabelWidth],
  placeGanttLabel: [() => placeGanttLabel],
  GANTT_CAPTION_LH: [() => GANTT_CAPTION_LH],
  ganttCaptionNeed: [() => ganttCaptionNeed],
  ganttCaptionHalf: [() => ganttCaptionHalf],
  fitCaptionFs: [() => fitCaptionFs],
  GANTT_PROFILES: [() => GANTT_PROFILES],
  ganttNameSize: [() => ganttNameSize],
  ganttLeafGeom: [() => ganttLeafGeom],
  ganttSummaryGeom: [() => ganttSummaryGeom],
  ganttMilestoneGeom: [() => ganttMilestoneGeom],
  ARROW_REACH: [() => ARROW_REACH],
  depAnchors: [() => depAnchors],
  GanttView: [() => GanttView],
  MB_WD: [() => MB_WD],
  MB_POSITIONS: [() => MB_POSITIONS],
  MB_MONTHS: [() => MB_MONTHS],
  MB_PATTERN_COLORS: [() => MB_PATTERN_COLORS],
  newMeetingBody: [() => newMeetingBody],
  mbFmt: [() => mbFmt],
  MB_ACTIVE_POPOVER_CLOSE: [() => MB_ACTIVE_POPOVER_CLOSE, (v) => { MB_ACTIVE_POPOVER_CLOSE = v; }],
  MBMultiPick: [() => MBMultiPick],
  MeetingImportPicker: [() => MeetingImportPicker],
  MeetingCalendarsModal: [() => MeetingCalendarsModal],
  SettingsPanel: [() => SettingsPanel],
  FormatPanel: [() => FormatPanel],
  RuleColorPicker: [() => RuleColorPicker],
  ConditionRow: [() => ConditionRow],
  ConditionGroup: [() => ConditionGroup],
  AutomationPanel: [() => AutomationPanel],
  SplitView: [() => SplitView],
  PhoneSplitView: [() => PhoneSplitView],
  DesktopSplitView: [() => DesktopSplitView],
  PAGE_SIZES: [() => PAGE_SIZES],
  buildGanttSVG: [() => buildGanttSVG],
  EXHIBIT_MIN_GANTT: [() => EXHIBIT_MIN_GANTT],
  approxTextPx: [() => approxTextPx],
  layoutExhibitCols: [() => layoutExhibitCols],
  buildPDFHtml: [() => buildPDFHtml],
  Toggle: [() => Toggle],
  SegBtn: [() => SegBtn],
  Field: [() => Field],
  Row: [() => Row],
  EXPORT_PREFS_KEY: [() => EXPORT_PREFS_KEY],
  EXPORT_PERSIST_KEYS: [() => EXPORT_PERSIST_KEYS],
  loadExportPrefs: [() => loadExportPrefs],
  saveExportPrefs: [() => saveExportPrefs],
  PDFExportModal: [() => PDFExportModal],
  SCHED_ACCENT: [() => SCHED_ACCENT],
  SCHED_ACCENT_TEXT: [() => SCHED_ACCENT_TEXT],
  NOTE_RAIL_W: [() => NOTE_RAIL_W],
  noteShortMD: [() => noteShortMD],
  noteISO: [() => noteISO],
  noteDateInputStyle: [() => noteDateInputStyle],
  noteDateBtnStyle: [() => noteDateBtnStyle],
  NoteRow: [() => NoteRow],
  AddNoteComposer: [() => AddNoteComposer],
  NotesModal: [() => NotesModal],
});
