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
let _delivery = null;         // bound by the recorder after each capture (B265536)
let _planId = null;
let _planSwitches = 0;
let _ppf = NaN;
let _layers = "";             // which GIS layers are ON, by registry key (B265539)

/** Called by the recorder when it is live. `fn(reason) => boolean`. */
export function bindPerfRecorder(fn) { _capture = typeof fn === "function" ? fn : null; }

/* ⛔ B265536 — TAKEN AND DELIVERED ARE DIFFERENT FACTS, and conflating them is what let the whole
 * recorder be able to fail in silence. `requestPerfCapture` answers "did the recorder build a
 * capture" — which is what the button used to show a ✓ for. `perfCaptureDelivery` answers "did the
 * server take it", which is what the owner actually needs to be true when he presses the button.
 * The recorder rebinds this after every capture; before the first one it is null and the caller
 * must treat that as UNKNOWN, never as success. */
export function bindPerfDelivery(fn) { _delivery = typeof fn === "function" ? fn : null; }

/** Promise of the last capture's delivery outcome (`{ ok, reason, error }`), or null if the
 *  recorder has not taken one. Never throws. */
export function perfCaptureDelivery() {
  try { return _delivery ? _delivery() : null; } catch (_) { return null; }
}

/** Is a recorder listening? Drives whether the manual control is offered at all. */
export function perfRecorderArmed() { return !!_capture; }

/** "That felt slow just now." Returns true if a capture was TAKEN — see `perfCaptureDelivery`
 *  for whether it then reached the server. */
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

/* ⛔ WHICH LAYERS, NOT JUST HOW MANY (B265539). The telemetry has always carried `ly`, a COUNT —
 * and on 2026-08-07 that count was 4 on the tab the owner reports the symptom in, while every
 * fixture and every standing battery in this repo ran at 0. B1435 measured per-frame cost as
 * elements × panels × LAYERS, so knowing WHICH four is the difference between a fixture arm that
 * reproduces his scene and one that guesses at it. A count cannot be turned into a fixture; a key
 * list can. The alternative was asking him, which is homework he should not have to do.
 *
 * PRIVACY: these are GIS layer registry keys — `fema`, `contours`, `jur_county` — public service
 * names from this app's own table, carrying nothing about him, his sites or his data. They are
 * sanitised to `[a-z0-9_]` anyway, sorted for stability, and BOUNDED: past the cap the list ends
 * in `+` so a reader knows it was cut rather than believing it complete. */
const LAYER_KEYS_MAX = 44;
export function noteLayerContext(overlays) {
  try {
    const on = [];
    for (const [k, st] of Object.entries(overlays || {})) if (st && st.on) on.push(String(k).replace(/[^a-z0-9_]/gi, "").slice(0, 24));
    on.sort();
    let s = "";
    for (const k of on) {
      const next = s ? `${s},${k}` : k;
      if (next.length > LAYER_KEYS_MAX) { s = `${s}+`; break; }
      s = next;
    }
    _layers = s;
  } catch (_) { /* a context setter must never throw into the app */ }
}

/** Everything the always-loaded half knows. Read at capture time only. */
export function perfContext() { return { planId: _planId, planSwitches: _planSwitches, ppf: _ppf, layers: _layers }; }

/** Test-only reset. */
export function __resetPerfHandle() { _capture = null; _delivery = null; _planId = null; _planSwitches = 0; _ppf = NaN; _layers = ""; }
