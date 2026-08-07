/* The "Opening <sheet>…" chip's state, as a decision rather than a side effect (NEW-6).
 *
 * The bug this replaces: the chip rendered on `renderedPage !== page` and the ONLY thing that ever
 * moved `renderedPage` was the success line at the bottom of the backdrop rasteriser. Every other
 * way out of that function — the `if (!pdf || !canvas || !base) return` early bail, and a
 * `catch` that swallowed any non-cancellation throw — left `renderedPage` behind forever. So the
 * chip sat on screen long after the drawing had finished, and (worse, and silently) the sheet
 * stayed pinned at 0.35 opacity because the same comparison drives the dim.
 *
 * A permanent "Opening…" is a LOUD-FAILURE violation twice over: it reports work that isn't
 * happening, and it hides a real render failure behind a progress message. So the chip now has
 * exactly three honest outcomes and no fourth:
 *   • the sheet arrived            → chip gone, full opacity
 *   • the render genuinely FAILED  → chip gone, a visible error naming the sheet
 *   • neither, past the backstop   → chip gone, full opacity (we stop CLAIMING to be opening; the
 *                                    pixels on screen are whatever they are, and a stale label over
 *                                    a finished sheet is a lie either way)
 *
 * Pure so the three-way decision is unit-tested away from pdf.js, a canvas and a clock.
 */

/* How long a sheet switch may claim to be "opening" before the chip stops asserting it. Generous
 * enough to cover a genuine large-sheet raster on a slow machine, short enough that a stuck state
 * is visibly over rather than permanent. */
export const OPEN_CHIP_TIMEOUT_MS = 8000;

/**
 * @param {object} s
 * @param {number} s.requestedPage  the sheet the user asked for
 * @param {number} s.renderedPage   the sheet whose pixels are actually on the canvas (0 = none yet)
 * @param {number} s.requestedAt    ms timestamp of the request
 * @param {number} s.now            ms now
 * @param {?{page:number, message:string}} [s.failed]  a render failure, if one was reported
 * @param {number} [s.timeoutMs]
 * @returns {{opening: boolean, dimmed: boolean, error: ?string, timedOut: boolean}}
 */
export function sheetOpenState({ requestedPage, renderedPage, requestedAt, now, failed = null, timeoutMs = OPEN_CHIP_TIMEOUT_MS }) {
  const settled = { opening: false, dimmed: false, error: null, timedOut: false };
  // Nothing open yet (no page requested) — there is nothing to say.
  if (!requestedPage) return settled;
  // The pixels on the canvas ARE this sheet.
  if (renderedPage === requestedPage) return settled;
  // A real failure for the sheet being asked for: say so, stop claiming progress.
  if (failed && failed.page === requestedPage) return { ...settled, error: failed.message || "That sheet couldn’t be drawn." };
  // Backstop: past the budget we stop asserting "opening" rather than assert it forever.
  if (requestedAt != null && now != null && now - requestedAt >= timeoutMs) return { ...settled, timedOut: true };
  return { opening: true, dimmed: true, error: null, timedOut: false };
}
