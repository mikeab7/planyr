/* B566 — map the embedded scheduler's reported toolbar save-state into the shared
 * CloudSyncBadge's normalized vocabulary, so the Schedule workspace shows the SAME
 * top-right cloud sync indicator as the Site Planner (instead of a separate floppy-disk
 * "Save" button). Pure + unit-locked (test/schedulerSaveState.test.js): the crash-severity
 * guardrail is that a failed cloud write must read as a LOUD error and must NEVER fall
 * through to a false-green "synced".
 *
 * Important context (why this is a presentation change, not a data-loss risk): the embedded
 * Gantt app (public/sequence/index.html) ALREADY auto-saves to its own cloud — a debounced
 * first-edit write, version-guarded, retry-on-error, a synchronous mirror + a flush on tab
 * close, and "Cloud auto-save is always on". It reports its live status up over the
 * postMessage bridge as toolbar.saveStatus ∈ {saved, saving, error} plus an offlineFallback
 * flag (a failed initial cloud READ — the app is on its offline/seed copy and is NOT
 * confirmed-synced). We only re-skin that status as the unified cloud badge; the persistence
 * engine underneath is untouched.
 */

// toolbar = the bridged toolbar-state object (see Scheduler.jsx's planar:toolbar-state
// handler). Returns a CloudSyncBadge `state`:
//   "saving" | "error" | "offline" | "synced" | null  (null ⇒ the badge renders nothing).
export function scheduleSaveState(toolbar) {
  // The iframe hasn't reported its toolbar yet → there's no save context to show. This is
  // legitimately empty (the badge renders nothing), NOT a hidden error.
  if (!toolbar || !toolbar.ready) return null;
  // An in-flight or failed WRITE is the most specific live state — surface it first.
  if (toolbar.saveStatus === "saving") return "saving"; // a write is in flight — amber, pulsing
  if (toolbar.saveStatus === "error")  return "error";  // a change did NOT reach the cloud — LOUD red + retry
  // The cloud READ failed → the app is showing its offline/fallback copy and is NOT
  // confirmed-synced, even though saveStatus still reads its initial "saved" (no write has
  // been attempted yet). Show the honest amber "offline" state, NEVER a false-green "synced"
  // — that "looks-saved-but-isn't" green is exactly the crash-severity lie the badge exists
  // to prevent. (The embedded app simultaneously shows its own red "working offline" banner.)
  if (toolbar.offlineFallback) return "offline";
  if (toolbar.saveStatus === "saved") return "synced"; // resting: saved + synced — calm green
  // Defensive default: an unexpected/missing status shows NOTHING rather than a fabricated green.
  return null;
}
