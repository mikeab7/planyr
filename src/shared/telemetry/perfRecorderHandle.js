/* The tiny ALWAYS-LOADED half of the performance recorder (NEW-1).
 *
 * ⛔ WHY THIS IS ITS OWN MODULE — the same tier split `perfSampling.js` records, for the same
 * measured reason. `main.jsx` and `AppHeader` are on the critical path of EVERY route, so a
 * static edge from either into the recorder would hoist the whole diagnostic into the chunk that
 * every route downloads. (`StoragePanel`'s header records the last time that was tried by
 * accident: an 11.3 KB chunk landed on a plain Site load and breached three bundle budgets.) The
 * recorder proper is fetched by a dynamic `import()` from `main.jsx`, so it is its own lazy chunk
 * and counts against no route budget — the bundle audit's route closure is over STATIC imports.
 *
 * What lives here is only what must exist BEFORE the recorder does, or independently of whether
 * it loaded at all:
 *   • the bind seam, so the UI can ask for a capture without importing the recorder;
 *   • three context setters the app calls (plan, zoom, edit-adjacent activity), each a single
 *     store to a module-level variable — the whole cost an unrecorded page pays.
 *
 * Nothing here throws, and every function is safe to call before (or without) the recorder
 * arriving: `requestPerfCapture` returns false and the UI says so, rather than pretending.
 */

/* The field kill switch, answered by the ALWAYS-LOADED tier so that a page with the recorder
 * turned off never even downloads it. `installPerfRecorder` re-checks the same flag, so the
 * switch holds whichever way the module is reached. */
export function perfRecorderEnabled(win = typeof window !== "undefined" ? window : undefined) {
  try { return !win || String(win.location.search || "").indexOf("perfrec=off") === -1; } catch (_) { return true; }
}

let _capture = null;          // bound by the recorder once it installs
let _planId = null;
let _planSwitches = 0;
let _ppf = NaN;

/** Called by the recorder when it is live. `fn(reason) => boolean`. */
export function bindPerfRecorder(fn) { _capture = typeof fn === "function" ? fn : null; }

/** Is a recorder listening? Drives whether the manual control is offered at all. */
export function perfRecorderArmed() { return !!_capture; }

/** "That felt slow just now." Returns true if a capture was taken. */
export function requestPerfCapture(reason) {
  try { return _capture ? !!_capture(reason || "manual") : false; } catch (_) { return false; }
}

/* THE PLAN CONTEXT. One string compare and, on a real change, one increment. Called from an
 * effect keyed on the loaded plan's id — never per render, never per frame. The id is SANITISED
 * downstream (perfCapture.safePlanId): a plan id in this app can be a name the owner typed, and
 * the recorder is never allowed to carry one off the machine. */
export function notePlanContext(id) {
  const next = id == null ? null : String(id);
  if (next === _planId) return;
  if (_planId !== null && next) _planSwitches++;
  _planId = next;
}

/* THE ZOOM. Keyed on the SCALAR `view.ppf`, never on the view object — VIEW-INDEPENDENT-ONCE:
 * a value that is genuinely view-derived keys on the term it actually uses. */
export function noteViewScale(ppf) { _ppf = Number.isFinite(ppf) ? ppf : NaN; }

/** Everything the always-loaded half knows. Read at capture time only. */
export function perfContext() { return { planId: _planId, planSwitches: _planSwitches, ppf: _ppf }; }

/** Test-only reset. */
export function __resetPerfHandle() { _capture = null; _planId = null; _planSwitches = 0; _ppf = NaN; }
