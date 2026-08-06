/* Honest status + a deferred-add queue for the stitcher's saved-set load (NEW-1 / NEW-2).
 *
 * What went wrong. `loadStitch` fetched every source PDF and then rasterised every placed sheet
 * ONE AT A TIME before committing a single one, and for that whole window it held two globals:
 *   • `loadingRef.current` — every `addSheet` / `addGroup` began `if (loadingRef.current) return;`,
 *     a bare early return. Clicking a sheet row did nothing, said nothing, logged nothing and
 *     issued no request — the handler died before it could ever try. (NEW-1.)
 *   • `busy` — whose only rendering was the fixed string "Rendering…", which therefore sat on the
 *     status bar unchanged for the entire load over an empty canvas, with no count, no name and no
 *     way to tell "working" from "wedged". (NEW-2.)
 * Both are the same defect wearing two faces: a long critical section with no progress and no
 * failure surface. This module holds the two decisions that make it honest, pure so they can be
 * asserted directly:
 *   • `loadStatusLine` — what the status bar actually says, per phase, with real counts.
 *   • `mergeAddQueue` — a click during a load is REMEMBERED and replayed, never dropped. A user
 *     action that cannot run yet is deferred; it is never silently discarded.
 */

export const PHASE = { IDLE: "idle", OPENING: "opening", FETCHING: "fetching", RENDERING: "rendering", ADDING: "adding" };

/**
 * The status-bar line for a load in progress. "" means "say nothing" — never a placeholder that
 * outlives the work it describes.
 * @param {?{phase: string, done?: number, total?: number, name?: string}} prog
 * @returns {string}
 */
export function loadStatusLine(prog) {
  if (!prog || !prog.phase || prog.phase === PHASE.IDLE) return "";
  const total = Number(prog.total) || 0;
  const done = Math.min(Number(prog.done) || 0, total || Infinity);
  const of = total > 0 ? ` ${done + 1} of ${total}` : "";
  if (prog.phase === PHASE.OPENING) return prog.name ? `Opening ${prog.name}…` : "Opening…";
  if (prog.phase === PHASE.FETCHING) return `Fetching saved drawings${of}…${prog.name ? ` (${prog.name})` : ""}`;
  if (prog.phase === PHASE.RENDERING) return total > 0 ? `Drawing the saved set — sheet${of}…` : "Drawing the saved set…";
  if (prog.phase === PHASE.ADDING) return prog.name ? `Adding ${prog.name}…` : "Adding sheet…";
  return "";
}

/** True while a load owns the canvas — the window in which a user add has to be deferred. */
export function isLoading(prog) {
  return !!prog && (prog.phase === PHASE.FETCHING || prog.phase === PHASE.RENDERING);
}

/** Stable identity for a queued add, so a double-click can't enqueue the same work twice. */
export function queueKey(req) {
  if (!req) return "";
  if (req.kind === "group") return `group:${req.srcId}:${req.groupKey}`;
  return `sheet:${req.srcId}:${req.pageNum}`;
}

/**
 * Remember an add that arrived while a load held the canvas. Returns a NEW array (never mutates)
 * and drops an exact duplicate rather than stacking it.
 */
export function mergeAddQueue(queue, req) {
  const list = Array.isArray(queue) ? queue : [];
  if (!req) return list;
  const k = queueKey(req);
  if (!k || list.some((q) => queueKey(q) === k)) return list;
  return [...list, req];
}

/**
 * The message shown when a click has been deferred. Never silence: the user pressed something and
 * is owed an answer in the same beat.
 */
export function deferredAddNotice(queue) {
  const n = Array.isArray(queue) ? queue.length : 0;
  if (!n) return "";
  return n === 1
    ? "Still loading the saved set — that sheet goes on as soon as it finishes."
    : `Still loading the saved set — those ${n} sheets go on as soon as it finishes.`;
}
