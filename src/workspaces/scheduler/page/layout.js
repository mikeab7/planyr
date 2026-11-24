import { ownerDisplayParts, ownerListOf } from "../../../shared/schedule/engine/owners.js";
import { exposeToHarness } from "./harnessGlobals.js";




// ── Constants ─────────────────────────────────────────────
export let ROW_H = 24;
export const setRowH = v => { ROW_H = v; };
export const PPD = 22, TL_H = 30, BUF = 6;
// NEW-1 (2026-11-03) — "scrolling on the schedule module is kinda shakey vertically". The row window (which rows are
// mounted) used to be re-derived from the RAW scrollTop on every scroll event: one React commit per 24px of travel, with
// only ~100px of spare rows below the fold, so a wheel notch routinely out-ran the commit and the bottom row of each pane
// was blank for a frame (measured: ~40% of frames during a notch scroll, ui-audit/verify-schedule-scroll-smooth.mjs).
// Now the window moves in CHUNKS of whole rows and carries a generous overscan on both sides: the state only changes when
// the scroll crosses a chunk boundary (so most scroll events re-render nothing), and the rows that will be needed next
// are already mounted when it does.
const WIN_CHUNK = 8, WIN_OVER = 12;
export const rowWindowTop = st => Math.floor(Math.max(0, st) / ROW_H / WIN_CHUNK) * WIN_CHUNK;
export const rowWindow = (winTop, viewH, total) => ({
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
export const GRID_SCROLL_MEMO = new Map();
export const GANTT_SCROLL_MEMO = new Map();

// ── XSS sanitization ─────────────────────────────────────
// escapeHtml: use whenever user data is interpolated into HTML/SVG string templates.
// React JSX auto-escapes rendered content, but buildPDFHtml/buildGanttSVG build
// raw HTML strings via template literals that go into document.write — must escape manually.
export const escapeHtml = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");   // task-name alignment is per-project (proj.labelAlign), not here (B393)
// Gantt bar-label helpers — one source of truth for the on-screen chart and the PDF exhibit
const fmtBarDate = (s, withYear) => { if(!s) return ""; const d = new Date(s+"T12:00:00"); return isNaN(d) ? "" : `${d.getMonth()+1}/${d.getDate()}` + (withYear===false ? "" : `/${String(d.getFullYear()).slice(2)}`); };
export const barLabelText = (t, field, withYear) => {
  if(!field || field==="none") return "";
  if(field==="start") return fmtBarDate(t.start, withYear);
  if(field==="end")   return fmtBarDate(t.end, withYear);
  if(field==="owner") return ownerDisplayParts(ownerListOf(t)).label;
  if(field==="pct")   return `${t.percentComplete||0}%`;
  return "";
};

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  ROW_H: [() => ROW_H, (v) => { ROW_H = v; }],
  setRowH: [() => setRowH],
  PPD: [() => PPD],
  TL_H: [() => TL_H],
  BUF: [() => BUF],
  WIN_CHUNK: [() => WIN_CHUNK],
  WIN_OVER: [() => WIN_OVER],
  rowWindowTop: [() => rowWindowTop],
  rowWindow: [() => rowWindow],
  GRID_SCROLL_MEMO: [() => GRID_SCROLL_MEMO],
  GANTT_SCROLL_MEMO: [() => GANTT_SCROLL_MEMO],
  escapeHtml: [() => escapeHtml],
  fmtBarDate: [() => fmtBarDate],
  barLabelText: [() => barLabelText],
});
