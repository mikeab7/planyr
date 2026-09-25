/* notesSaveState — WHERE THE SAVE INDICATOR LIVES, AND THERE IS ONLY ONE OF THEM
 * (NEW-SAVE-BADGE, owner report 2026-08-14).
 *
 * ⛔ HIS REPORT, with a screenshot showing TWO: *"it should just mimic the Site Planning module
 * exactly. Literally, all the modules should show that save icon in the exact same place."*
 *
 * ⛔ AND HE IS DESCRIBING A CONVENTION THIS REPO ALREADY HAS — Notes was the one module that
 * never adopted it. The app-wide `CloudSyncBadge` sits in `AppHeader`'s Row-1 top-right zone, and
 * the Site Planner, the Scheduler and Doc Review all RETIRED their local save chips in its
 * favour, each recording that they did. Notes kept rendering its own pill inside the note header,
 * so a signed-out note showed "SAVED" there AND "Saved on this device" in the shared badge — two
 * indicators, different words, for one fact.
 *
 * So this file is not a new mechanism. It is the same NORMALISER the other modules have
 * (`docSaveState` in doc-review/lib/usePersistence.js is the direct model), mapping this
 * module's own status vocabulary onto the shared badge's, so the ONE badge can speak for Notes
 * too.
 *
 * ⛔ THE ONE RULE THAT SURVIVES FROM THE OLD CHIP, because it is a LOUD-FAILURE obligation and
 * not a style choice: **a write that did not land never reads as saved.** `error` maps to the
 * badge's `error`, which is the state that offers a retry.
 *
 * ⛔ AND `unsaved` DOES NOT MEAN "FAILED" — IT MEANT "A KEYSTROKE JUST LANDED" (NEW-5, owner
 * report 2026-09-25: a false "the cloud is unreachable" triangle appearing while the cloud icon
 * itself read "Saved and synced"). `NoteEditor.jsx`'s `onUpdate` fires `"unsaved"` the INSTANT any
 * edit lands, before the 600ms debounced local write even starts — it is the pending-write state,
 * not a report that anything went wrong. Mapping it through the same branch as a genuine `error`
 * meant every single keystroke in every note showed the badge/triangle's loud "cloud unreachable"
 * state for the length of that debounce, whether or not the cloud was reachable at all. `unsaved`
 * now maps to `saving` (a write is in flight); only a real `error` — the write actually failing —
 * still reads as the LOUD-FAILURE state.
 */

/** This module's status → the shared badge's state.
 *
 *  `null` means "say nothing", which is the honest answer before anything has been written —
 *  a badge that claims "saved" for a note nobody has touched is a small, confident lie. */
export function notesSaveState(status, { signedIn = false, idle = false } = {}) {
  if (idle) return null;
  // A pending write — including the instant-on-keystroke "unsaved" — is IN PROGRESS, not failed.
  if (status === "saving" || status === "unsaved") return "saving";
  // LOUD-FAILURE: a write that actually failed is never dressed up as success.
  if (status === "error") return "error";
  if (status === "saved" || status === "synced") return signedIn ? "synced" : "local";
  return signedIn ? "synced" : "local";
}
