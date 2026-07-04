/* Graphic scale-bar reading (B340 tail #1 / B339's CV remainder) — PURE + browser-free.
 *
 * WHY. `parseSheetScale` (sheetScale.js) reads a STATED scale from TEXT ("1"=40'"). Many sheets —
 * especially scanned surveys and details — print no scale text, only a DRAWN scale bar: a ruler
 * graphic with tick labels ("0  20  40  60  FEET"). This engine turns that graphic into a
 * feet-per-unit calibration, so a text-less-but-bar-bearing sheet can auto-calibrate instead of
 * dropping to a manual Calibrate.
 *
 * CONTRACT. It consumes geometry the browser extracts from the PDF (vector segments) or from the
 * raster (detected bar), plus the positioned text near it — NOT a canvas. So it is unit-tested in
 * Node against synthetic bars, exactly like the other pure parsers here. The heavy extraction (a
 * vector-op / raster pass that FINDS the bar + tick labels on a real sheet) is the browser glue and
 * is left as an INJECTABLE, DORMANT seam — the same pattern as the OCR reader and the APS
 * converter: absent an extractor, the caller gets null and keeps today's behavior (fail open).
 *
 * UNIT-AGNOSTIC BY DESIGN. Segments/labels are passed in whatever coordinate space the caller
 * measures in (page points, or the Stitcher's rendered-pixel world units). The engine returns
 * `drawnLenPx` and `realLenFt` in that same space, so `feetPerUnit = realLenFt / drawnLenPx` is
 * correct by construction — the space conversion never lives here (that's the wiring's job, and the
 * exact conversion is part of what the live V-item verifies).
 *
 * NEVER OVERWRITE A TRUSTED SCALE. The caller applies this ONLY when there's no stated/manual
 * scale and ONLY on a high-confidence read (geometry-beats-printed-scale still holds: a hand
 * calibration always wins). A wrong auto-scale silently poisons every measurement, so the bar must
 * clear real evidence — a long bar, uniform ticks, a feet unit keyword — or we return present:false.
 */

import { calibrateFromDimension } from "../placement/verifyPlacement.js";

const FEET_UNIT = /\b(feet|foot|ft|')\b|['′]/i;
const METRIC_UNIT = /\b(meter|metre|metres|meters|m|mm|cm)\b/i;
// A label that is (mostly) a number — a tick value. Allow a trailing unit mark on the last tick.
const NUM = /^-?\d{1,4}(?:\.\d{1,2})?$/;

const isHorizontal = (s) => Math.abs(s.y2 - s.y1) <= Math.max(2, Math.abs(s.x2 - s.x1) * 0.08);
const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const segMidY = (s) => (s.y1 + s.y2) / 2;
const segX0 = (s) => Math.min(s.x1, s.x2);
const segX1 = (s) => Math.max(s.x1, s.x2);

/* Group near-collinear horizontal segments (a scale bar is often a row of alternating filled/open
 * boxes = several short colinear segments) into candidate bars. Each bar = the union span of a
 * cluster of horizontal segments at ~the same y. Returns [{ x0, x1, y, len, count }] sorted longest
 * first. `yTol` clusters by baseline; `gapTol` allows the small gaps between bar boxes. */
export function clusterBars(segments = [], { minLen = 40, yTol = 6, gapTol = 24 } = {}) {
  const horiz = (segments || [])
    .filter((s) => s && [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite) && isHorizontal(s) && segLen(s) >= 2)
    .map((s) => ({ x0: segX0(s), x1: segX1(s), y: segMidY(s) }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const rows = [];
  for (const s of horiz) {
    const row = rows.find((r) => Math.abs(r.y - s.y) <= yTol);
    if (row) { row.parts.push(s); row.y = (r_avg(row.parts.map((p) => p.y))); }
    else rows.push({ y: s.y, parts: [s] });
  }
  const bars = [];
  for (const row of rows) {
    const parts = row.parts.slice().sort((a, b) => a.x0 - b.x0);
    // Merge parts into a contiguous run, breaking where a gap exceeds gapTol.
    let runX0 = parts[0].x0, runX1 = parts[0].x1, count = 1;
    const flush = () => { const len = runX1 - runX0; if (len >= minLen) bars.push({ x0: runX0, x1: runX1, y: row.y, len, count }); };
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].x0 - runX1 <= gapTol) { runX1 = Math.max(runX1, parts[i].x1); count++; }
      else { flush(); runX0 = parts[i].x0; runX1 = parts[i].x1; count = 1; }
    }
    flush();
  }
  return bars.sort((a, b) => b.len - a.len);
}

const r_avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

/* Numeric tick labels sitting near a bar (within `band` px of its baseline, roughly spanning its
 * width). Returns [{ value, x }] sorted left→right, plus whether a feet unit keyword appears near
 * the bar. A metric unit near the bar disqualifies the read (we calibrate in feet only). */
export function ticksNearBar(labels = [], bar, { band = 40 } = {}) {
  const near = (labels || []).filter((l) => {
    if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return false;
    const cx = l.x + (l.w || 0) / 2;
    return Math.abs((l.y + (l.h || 0) / 2) - bar.y) <= band && cx >= bar.x0 - band && cx <= bar.x1 + band;
  });
  const text = near.map((l) => (l.str || "").trim()).join(" ");
  const metric = METRIC_UNIT.test(text) && !FEET_UNIT.test(text);
  const feet = FEET_UNIT.test(text);
  const ticks = [];
  for (const l of near) {
    const raw = (l.str || "").trim().replace(/[′'"]|feet|foot|ft/gi, "").trim();
    if (NUM.test(raw)) ticks.push({ value: +raw, x: l.x + (l.w || 0) / 2 });
  }
  ticks.sort((a, b) => a.x - b.x);
  return { ticks, feet, metric, text };
}

/* Are the tick values consistent with a linear ruler — evenly spaced values at evenly spaced x?
 * Returns a 0..1 score (1 = perfectly linear). Robust to a missing "0" or a trailing unit tick. */
export function tickLinearity(ticks = []) {
  const t = ticks.filter((k) => Number.isFinite(k.value) && Number.isFinite(k.x));
  if (t.length < 3) return t.length === 2 ? 0.5 : 0;
  // Fit value = m·x + b by least squares; score = 1 - normalized residual.
  let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = t.length;
  for (const k of t) { sx += k.x; sy += k.value; sxx += k.x * k.x; sxy += k.x * k.value; }
  const denom = n * sxx - sx * sx || 1;
  const m = (n * sxy - sx * sy) / denom, b = (sy - m * sx) / n;
  const span = Math.max(...t.map((k) => k.value)) - Math.min(...t.map((k) => k.value)) || 1;
  let res = 0; for (const k of t) res += Math.abs(k.value - (m * k.x + b));
  const meanRes = res / n;
  return Math.max(0, 1 - meanRes / (span * 0.15)); // >~15% mean deviation ⇒ 0
}

/* Read a scale bar. Input: { segments, labels } in ONE coordinate space (see module header).
 * Returns { present:true, drawnLenPx, realLenFt, feetPerUnit, label, confidence } on a confident
 * read, else { present:false, reason }. Options gate confidence:
 *   minBarLen   – ignore bars shorter than this (px)
 *   minConf     – required confidence to report present:true
 *   requireFeet – require a feet unit keyword near the bar (default true; a metric bar is rejected) */
export function readScaleBar({ segments = [], labels = [] } = {}, opts = {}) {
  const { minBarLen = 40, minConf = 0.6, requireFeet = true } = opts;
  const bars = clusterBars(segments, { minLen: minBarLen });
  if (!bars.length) return { present: false, reason: "no-bar" };
  // Try the longest bars first; take the first that yields a confident, feet-based read.
  for (const bar of bars.slice(0, 3)) {
    const { ticks, feet, metric } = ticksNearBar(labels, bar);
    if (metric) continue;                              // metric ruler — we calibrate feet only
    if (requireFeet && !feet && ticks.length < 3) continue; // need a unit keyword OR ≥3 linear ticks
    const values = ticks.map((t) => t.value).filter((v) => v > 0);
    if (!values.length) continue;
    const realLenFt = Math.max(...values);             // the far tick = the bar's full real length
    if (!(realLenFt > 0)) continue;
    const drawnLenPx = bar.len;
    const cal = calibrateFromDimension(drawnLenPx, realLenFt);
    if (!cal) continue;
    const linearity = tickLinearity(ticks);
    // Confidence: a real bar is LONG, its ticks are LINEAR, and it carries a feet unit. Blend.
    let confidence = 0.35;
    if (feet) confidence += 0.2;
    if (ticks.length >= 3) confidence += 0.2;
    confidence += 0.25 * linearity;
    if (bar.len < minBarLen * 1.5) confidence -= 0.15;  // a short bar is easy to confuse with linework
    confidence = Math.max(0, Math.min(1, confidence));
    if (confidence < minConf) continue;
    const label = `scale bar · ${realLenFt} ft`;
    return { present: true, drawnLenPx, realLenFt, feetPerUnit: cal.feetPerUnit, confidence, label, ticks: ticks.length };
  }
  return { present: false, reason: "low-confidence" };
}
