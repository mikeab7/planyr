/* readoutDash — ROUND 10 (NEW-2b): the owner read "Prop —" in the cursor chip with the whole view inside the graded limit and the harness
 * could not reproduce it (200 random points inside the limit, both modes: all value). STANDING RULE #2 — an owner-reported symptom is
 * never closed on a null — so this instruments it: when the chip would say "—" for a point that lies INSIDE the surface's own limit
 * regions (or when it is reading a kept, older surface), one telemetry row names the reason, the mode and whether the surface was the
 * current one. Once per distinct (reason, inside, stale) per page load. Read-only; touches nothing. Pure decision + a tiny sender. */
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { pointInRegions } from "./gradingLimit.js";

const sent = new Set();
export function readoutDashFacts(grid, pt, r, usedKeptGrid) {
  const regions = grid && grid.limit && Array.isArray(grid.limit.limitRegions) ? grid.limit.limitRegions : [];
  const inLimit = regions.length ? pointInRegions(pt, regions) : false;
  return { reason: (r && r.reason) || "none", inLimit, mode: grid && grid.limit ? grid.limit.mode : null, keptGrid: !!usedKeptGrid };
}
export function noteReadoutDash(grid, pt, r, usedKeptGrid) {
  try {
    const f = readoutDashFacts(grid, pt, r, usedKeptGrid);
    if (!f.inLimit && !f.keptGrid) return;              // a "—" outside the limit is the correct answer; only the surprising ones are worth a row
    const k = `${f.reason}|${f.inLimit}|${f.mode}|${f.keptGrid}`;
    if (sent.has(k)) return;
    sent.add(k);
    reportClientEvent("grading-readout-dash", `Prop — at a point ${f.inLimit ? "INSIDE" : "outside"} the limit (${f.reason})`, f);
  } catch { /* instrumentation never breaks the chip */ }
}
export function clearReadoutDashMemo() { sent.clear(); }
