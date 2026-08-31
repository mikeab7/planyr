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
 */
export function modelSaveState(status, signedIn) {
  if (status === "saving") return "saving";
  // LOUD-FAILURE: a failed or pending write is never dressed up as success.
  if (status === "error" || status === "conflict") return "error";
  // The cloud table doesn't exist (migration not yet run) — this is LOCAL-ONLY regardless of
  // sign-in state, never "synced". The one line this whole file exists to guarantee.
  if (status === "not-provisioned") return "local";
  return signedIn ? "synced" : "local";
}
