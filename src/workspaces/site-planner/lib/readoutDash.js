/* readoutDash — ROUND 10 (NEW-2b): the owner read "Prop —" in the cursor chip with the whole view inside the graded limit and the harness
 * could not reproduce it (200 random points inside the limit, both modes: all value). STANDING RULE #2 — an owner-reported symptom is
 * never closed on a null — so this instruments it: when the chip would say "—" for a point that lies INSIDE the surface's own limit
 * regions (or when it is reading a kept, older surface), one telemetry row names the reason, the mode and whether the surface was the
 * current one. Once per distinct (reason, inside, stale) per page load. Read-only; touches nothing. Pure decision + a tiny sender.
 *
 * NEW-1 (B2585313 ×2, 2026-10-31) — the recurrence produced NO row, and the reason is now measured: the owner's three points sat past
 * the daylight line in "Around the layout" mode, outside the limit's regions, so this returned before reporting. Two gaps closed:
 *   • a point inside the limit's BOUNDING BOX but outside its regions is reported too (`inBbox`) — a bbox hit with a regions miss is
 *     either a concave gap (expected, once per page load) or a coordinate-space bug (the theory this row exists to settle);
 *   • the NO-SURFACE path (the chip had no grid at all) is reported once per page load with the build's state (`noteReadoutNoSurface`).
 * Every row carries the cursor and the limit bbox, so the next recurrence names its cause from the row alone. */
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { pointInRegions } from "./gradingLimit.js";

const sent = new Set();
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/* The limit's bounding box, feet: [x0, y0, x1, y1] — null with no regions. */
export function regionsBbox(regions) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of regions || []) for (const p of (r && r.outer) || []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return x0 <= x1 ? [x0, y0, x1, y1] : null;
}
export function readoutDashFacts(grid, pt, r, usedKeptGrid) {
  const regions = grid && grid.limit && Array.isArray(grid.limit.limitRegions) ? grid.limit.limitRegions : [];
  const inLimit = regions.length ? pointInRegions(pt, regions) : false;
  const bb = regionsBbox(regions);
  const inBbox = !!(bb && pt && pt.x >= bb[0] && pt.x <= bb[2] && pt.y >= bb[1] && pt.y <= bb[3]);
  return {
    reason: (r && r.reason) || "none", inLimit, inBbox, mode: grid && grid.limit ? grid.limit.mode : null, keptGrid: !!usedKeptGrid,
    limitRegionCount: regions.length, limitBbox: bb ? bb.map(r1) : null, cursor: pt ? { x: r1(pt.x), y: r1(pt.y) } : null,
  };
}
/* Whether a "—" is worth a row: inside the limit, inside its bbox (the units check), or read off a kept, older surface. */
export const dashWorthReporting = (f) => !!(f && (f.inLimit || f.inBbox || f.keptGrid));
export function noteReadoutDash(grid, pt, r, usedKeptGrid) {
  try {
    const f = readoutDashFacts(grid, pt, r, usedKeptGrid);
    if (!dashWorthReporting(f)) return null;          // a "—" well outside the limit is the correct answer; only the surprising ones are worth a row
    const k = `${f.reason}|${f.inLimit}|${f.inBbox}|${f.mode}|${f.keptGrid}`;
    if (sent.has(k)) return null;
    sent.add(k);
    const where = f.inLimit ? "INSIDE" : f.inBbox ? "inside the BOUNDING BOX of (but outside)" : "outside";
    reportClientEvent("grading-readout-dash", `Prop — at a point ${where} the limit (${f.reason})`, f);
    return f;
  } catch { return null; /* instrumentation never breaks the chip */ }
}
/* The chip had NO surface to read (grading on, nothing built and nothing kept). Once per page load. `state` = what the build says
 * about itself: { enabled, grOn, hasKept, lastBuildOutcome, buildSeq, isDragging }. */
export function noteReadoutNoSurface(state, pt) {
  try {
    if (!state || !state.grOn) return null;            // grading off: there is no proposed surface by design
    if (sent.has("nosurface")) return null;
    sent.add("nosurface");
    const f = { reason: "nosurface", ...state, cursor: pt ? { x: r1(pt.x), y: r1(pt.y) } : null };
    reportClientEvent("grading-readout-dash", `Prop — with no proposed surface (build ${state.lastBuildOutcome || "unknown"})`, f);
    return f;
  } catch { return null; }
}
export function clearReadoutDashMemo() { sent.clear(); }
