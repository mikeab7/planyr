/* modelSaveState — this module's status -> the shared CloudSyncBadge's vocabulary, the same
 * normalizer shape as notesSaveState.js (src/workspaces/notes/lib/notesSaveState.js), which is
 * itself the direct model doc-review's own docSaveState follows. One shared badge, one place
 * that decides what it shows, so every module says the same thing the same way.
 *
 * ⛔ B891184-FOLLOWUP (live production finding, 2026-08-31): this used to have NO branch for
 * "not-provisioned" — the state every Model user is actually in until db/model_sheets.sql is
 * applied — so it fell through to `signedIn ? "synced" : "local"` and a SIGNED-IN user saw the
 * badge's GREEN "Synced" checkmark for a cloud table that does not exist. `saveDetail` (in
 * ModelApp.jsx) carried the honest caveat, but only as a hover tooltip on a glyph that visibly
 * claimed the opposite. Measured, verbatim: "a save indicator that shows 'Synced' while the
 * Model saves nowhere is worse than no indicator." Extracted into its own file (previously
 * inline in ModelApp.jsx) so this exact regression has a direct unit test, the same way
 * notesSaveState.js does for its own module.
 *
 * ⛔ B891184-FOLLOWUP-2 (live production finding, 2026-08-31): the migration DID land and the
 * table DID work, and this still lied — every non-special status (including the plain "idle" a
 * fresh load starts in, before ANY cloud round trip has happened) fell through to `signedIn ?
 * "synced" : "local"`, so a signed-in user saw a confident green "Synced" checkmark the instant
 * the page painted, whether or not a single byte had ever reached the cloud. `cloudConfirmed`
 * is the caller's own proof that a round trip actually happened THIS session for THIS project
 * (a successful cloud load, or a successful cloud save) — see ModelApp.jsx. Without it, "synced"
 * is never shown; the Notes precedent for the identical lie (notesSaveState.js's `idle` param)
 * returns `null` (say nothing) rather than a false positive, and this follows the same shape.
 */
export function modelSaveState(status, signedIn, cloudConfirmed) {
  if (status === "saving") return "saving";
  // LOUD-FAILURE: a failed or pending write is never dressed up as success.
  if (status === "error" || status === "conflict" || status === "diverged") return "error";
  // The cloud table doesn't exist (migration not yet run) — this is LOCAL-ONLY regardless of
  // sign-in state, never "synced". The one line this whole file exists to guarantee.
  if (status === "not-provisioned") return "local";
  if (!signedIn) return "local";
  // Signed in, nothing currently failing — but "synced" is a claim about the CLOUD, and it may
  // only be made once a real round trip has confirmed it. Before that, say nothing rather than
  // guess (the same choice notesSaveState.js already made for this exact defect class).
  return cloudConfirmed ? "synced" : null;
}
