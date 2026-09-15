/* Account-level user preferences (NEW-3) — the store behind Standards' "All projects" scope.
 *
 * WHY THIS EXISTS: the Standards panel could only ever set a default for the CURRENT plan. Making
 * a default follow the user everywhere needs somewhere account-scoped to keep it. localStorage
 * would have made it per-machine — a default set on one computer would silently not exist on
 * another, which is worse than not shipping the scope at all. So the source of truth is the
 * signed-in user's own row in `public.profiles` (`prefs` jsonb, own-row RLS — db/user_prefs.sql).
 *
 * localStorage is used ONLY as a mirror, for two honest reasons: instant first paint (so a plan
 * doesn't flash built-in colors while the profile loads) and a signed-out fallback. The UI says
 * which one is in force — it never presents a machine-local value as a cross-machine default.
 *
 * LOUD-FAILURE: a failed cloud write returns { ok:false, error } and the caller surfaces it; it
 * is never swallowed into a silent "saved".
 *
 * ⛔ THIS FILE IS THE CANVAS-FACING WRAPPER — its `applyPrefs` publishes the plan-standards half
 * into the style resolvers (`planStyle.js` / `measureStyle.js`), which is why it (and, through
 * `planStyle.js`, `metesAndBounds.js`) may only ever be reached from the Site Planner's own static
 * import graph (SitePlanner.jsx / MapFinder.jsx). A caller that doesn't touch the canvas — the
 * header project switcher's pin store, for instance — wants `userPrefsStore.js` instead, which
 * holds the exact same read/normalize/persist logic with none of the style-resolver weight. See
 * that file's header for the CI regression (PR #1714) this split fixes.
 */
import { setAccountStyleDefaults } from "./planStyle.js";
import { setAccountMeasureDefaults } from "./measureStyle.js";
import {
  EMPTY_PREFS,
  readMirror,
  loadPrefsRaw,
  savePrefsRaw,
  setStandardPref,
  getStandardPref,
  setSitesPanelPref,
  _normalizePrefs,
} from "./userPrefsStore.js";

export { EMPTY_PREFS, readMirror, setStandardPref, getStandardPref, setSitesPanelPref, _normalizePrefs };

/** Publish the plan-style half into the style resolver so every surface picks it up at once. */
export function applyPrefs(prefs) {
  const p = _normalizePrefs(prefs);
  setAccountStyleDefaults(p.planStandards);
  setAccountMeasureDefaults(p.planStandards.measureStyle);
  return p;
}

/**
 * Load the signed-in user's prefs. Returns { prefs, source } where source is:
 *   "cloud"  — the account row (the real cross-machine default)
 *   "local"  — the mirror only (signed out, or the read failed) — the UI must say so
 * Never throws: a preferences read can't be allowed to block opening a plan.
 */
export async function loadUserPrefs(uid) {
  const { prefs, source, error } = await loadPrefsRaw(uid);
  return error === undefined
    ? { prefs: applyPrefs(prefs), source }
    : { prefs: applyPrefs(prefs), source, error };
}

/**
 * Merge a patch into the account prefs and persist it.
 * The mirror is written first so the UI is instant, then the cloud row is upserted; a cloud
 * failure is REPORTED (LOUD-FAILURE), not swallowed — the caller shows "saved on this computer
 * only" rather than a false "saved everywhere".
 */
export async function saveUserPrefs(uid, prefs) {
  const result = await savePrefsRaw(uid, prefs);
  return { ...result, prefs: applyPrefs(result.prefs) };
}
