import { NOW, addD, dif, fd, pd } from "../../../../shared/schedule/engine/calendar.js";
import { normPreds } from "../../../../shared/schedule/engine/predecessors.js";
import { computeDisplayHealth } from "../../../../shared/schedule/engine/health.js";
import { HEALTH } from "../common.jsx";
import { isCompleteTask, leafPercent } from "../../../../shared/schedule/healthEngine.js";
import { GANTT_SCROLL_MEMO, ROW_H, TL_H, barLabelText, rowWindow, rowWindowTop } from "../layout.js";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef, useMemo } = React;


// ── B393/B394/B395 — shared Gantt label + dependency-connector geometry ──────────────
// Pure helpers used by BOTH render paths — the on-screen <GanttView> and the print
// <buildGanttSVG> — so the two can never drift (the recurring "both paths" rule of
// B210/B211/B222). No React/DOM here.

// One uniform near-black ink for EVERY in-chart Gantt label (leaf bar, summary bracket,
// milestone), both paths. B320 eye-comfort: hierarchy comes from WEIGHT, never from
// fading text toward the background — so the B210 depth-navy is removed from label TEXT
// (it stays on the bracket GRAPHIC, which is not text). (B393)
export const GANTT_INK = "#1a1a1a";

// Per-project label alignment (view-level, one choice per chart), persisted on the
// project record and riding the existing cloud-save path — same shape as the B212
// column config. Default "right" (name trailing just after the bar end). (B393)
export const resolveLabelAlign = proj => {
  const a = proj && proj.labelAlign;
  return (a === "left" || a === "center" || a === "right") ? a : "right";
};
export const writeLabelAlign = (setData, pid, align) => setData(d =>
  (d.projects && d.projects[pid]) ? {...d, projects: {...d.projects, [pid]: {...d.projects[pid], labelAlign: align}}} : d);

// Weight ramp: top-level summary boldest → child summaries medium → leaf/milestone
// regular. Color is uniform (GANTT_INK); only the weight steps. An explicit per-task
// bold lifts to at least 700. (B393)
export const ganttNameWeight = (depth, kind, bold) => {
  const d = Math.min(depth || 0, 3);
  let w;
  if (kind === "summary") w = [800, 700, 600, 600][d];
  else if (kind === "milestone") w = 600;
  else w = 500;                       // leaf — regular
  return bold ? Math.max(w, 700) : w;
};

// Estimated label width (px) from char count × per-char width (~0.6·fontSize, a slight
// over-estimate so a flip/lift triggers before a real clip, never after). (B393)
export const estLabelWidth = (s, fs) => Math.max(1, String(s == null ? "" : s).length) * fs * 0.6 + 4;

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
export const placeGanttLabel = ({align, bx, bw, rowTop, barTopY, labelW,
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
export const ganttCaptionHalf = fs => fs * GANTT_CAPTION_LH / 2;      // its half-height (placeGanttLabel's capHalf)
// Cap a caption's font size so the whole caption fits in the HEADROOM above its own glyph — now only
// the LAST-RESORT safety (the glyph helpers below already leave every ranked size its full room);
// floored so it stays legible.
export const fitCaptionFs = (baseFs, headroom) => Math.max(6.5, Math.min(baseFs, (headroom + 1e-6) / GANTT_CAPTION_LH));   // +1e-6: float dust must not turn 9 into 8.999999
export const GANTT_PROFILES = {
  screen: { names:[10,9.25,8.5,8], span:[6,5,4,4], leg:[0.16,0.12,0.09,0.07], minSpan:2, minLeg:2,
            leafFrac:0.25, mileHalf:3*Math.SQRT2, mileMin:2.5, leafBase:1, summaryBase:2, mileBase:1 },
  print:  { names:[9,8.5,8,7.5],   span:[4,3.5,3,3], leg:[0.14,0.10,0.08,0.06],  minSpan:2, minLeg:1.5,
            leafFrac:0.30, mileHalf:4,            mileMin:2.5, leafBase:2, summaryBase:2, mileBase:2 },
};
export const ganttNameSize = (P, level) => P.names[Math.min(Math.max(level || 0, 0), 3)];
// Leaf bar: bottom-aligned; as tall as the profile asks unless that would crowd the LARGEST leaf
// name (level 0) — a bar's height never depends on depth, so it is bounded by the biggest name.
export const ganttLeafGeom = (P, rowH) => {
  const bot = rowH - P.leafBase;
  const h = Math.max(3, Math.min(P.leafFrac * rowH, bot - ganttCaptionNeed(P.names[0])));
  return { top: bot - h, bot, h };
};
// Summary bracket (span + legs). Nominal thickness steps down with depth (darkest/thickest on top —
// B210). The room above it is whatever the level's FULL-SIZE name leaves; the binding level is 0
// (biggest name, thickest bracket), so ONE scale factor — taken from level 0 — shrinks every level
// together. That keeps the ramp strictly ordered (a level is never thinner than the level below it)
// while a short row makes the whole bracket family slimmer, never the text smaller.
export const ganttSummaryGeom = (P, rowH, level) => {
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
export const ganttMilestoneGeom = (P, rowH, level) => {
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
export const depAnchors = ({ type, src, tgt, fanIndex = 0, fanCount = 1, tgtLabelRightX = null }) => {
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
export function GanttView({tasks, updateTask, pxPerDay, onZoomChange, scrollRef, onScroll, rolledHealthMap, proj, onMouseEnter, selectedId, setSelectedId, settings, rowZoom=1}) {
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
      fontStyle:(task.italic || task.cellFmt?.name?.italic)?"italic":"normal", textDecoration:(task.underline || task.cellFmt?.name?.underline)?"underline":"none", color:"var(--gantt-ink)",
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
            const rowBg = task.rowColor || (isExpandedParent ? (ri%2?"var(--row-alt)":"var(--bg)") : (displayHealth==="red"?"var(--row-red)":displayHealth==="yellow"?"var(--row-yellow)":displayHealth==="green"?"var(--row-green)":displayHealth==="paused"?"var(--row-paused)":ri%2?"var(--row-alt)":"var(--bg)"));
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
                  background:isGanttSel?(task.rowColor||"var(--row-focus)"):rowBg}}>
                <span style={{position:"sticky",left:8,display:"inline-flex",alignItems:"center",
                  height:14,padding:"0 6px",fontSize:8,fontWeight:600,letterSpacing:".05em",
                  textTransform:"uppercase",color:"#6b7280",background:"var(--bg)",
                  border:"1px dashed #cbd5e1",borderRadius:7,whiteSpace:"nowrap",
                  pointerEvents:"none",fontFamily:"'Inter',system-ui,sans-serif"}}>Unscheduled</span>
              </div>;
            }

            return (
              <div key={task.id} data-gantt-row={task.id} onClick={()=>setSelectedId?.(task.id)} style={{position:"absolute",top:ri*ROW_H,left:0,right:0,height:ROW_H,borderBottom:"1px solid rgba(0,0,0,0.1)",borderLeft:isGanttSel?"3px solid var(--blue)":"3px solid transparent",background:isGanttSel?(task.rowColor||"var(--row-focus)"):rowBg}}>

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

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
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
});
