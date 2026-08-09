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
 */
import { supabase } from "./supabase.js";
import { setAccountStyleDefaults } from "./planStyle.js";
import { setAccountMeasureDefaults } from "./measureStyle.js";
import { DEFAULT_SHARE_PREF, normalizeSharePref } from "./newProjectSharing.js";

const MIRROR_KEY = "planyr:userPrefs:v1";

/** The shape we care about today. Additive: a new preference is a new key, never a migration. */
export const EMPTY_PREFS = {
  planStandards: { parcelStyle: {}, typeStyles: {}, measureStyle: {} },
  // B326418 — whether a NEW project is born shared with your team, and which team. Absent means
  // default-ON (see newProjectSharing.js), so an account that has never opened the switch behaves
  // as the owner asked. It only ever affects projects created from here on.
  newProjectSharing: DEFAULT_SHARE_PREF,
};

const normalize = (p) => ({
  ...EMPTY_PREFS,
  ...(p && typeof p === "object" ? p : {}),
  newProjectSharing: normalizeSharePref(p && p.newProjectSharing),
  planStandards: {
    parcelStyle: { ...((p && p.planStandards && p.planStandards.parcelStyle) || {}) },
    typeStyles: { ...((p && p.planStandards && p.planStandards.typeStyles) || {}) },
    // NEW-1 — measurement defaults joined the account scope. Additive: an older prefs row simply
    // has no bag here and normalizes to an empty one, so nothing needs migrating.
    measureStyle: { ...((p && p.planStandards && p.planStandards.measureStyle) || {}) },
  },
});

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

export function readMirror() {
  if (!hasLS()) return normalize(null);
  try { return normalize(JSON.parse(localStorage.getItem(MIRROR_KEY) || "null")); } catch { return normalize(null); }
}
function writeMirror(prefs) {
  if (!hasLS()) return;
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(prefs)); } catch { /* quota / private mode */ }
}

/** Publish the plan-style half into the style resolver so every surface picks it up at once. */
export function applyPrefs(prefs) {
  const p = normalize(prefs);
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
  const mirror = readMirror();
  if (!supabase || !uid) return { prefs: applyPrefs(mirror), source: "local" };
  try {
    const { data, error } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
    if (error) return { prefs: applyPrefs(mirror), source: "local", error: error.message };
    const prefs = applyPrefs(data?.prefs);
    writeMirror(prefs);
    return { prefs, source: "cloud" };
  } catch (e) {
    return { prefs: applyPrefs(mirror), source: "local", error: e?.message || "prefs load failed" };
  }
}

/**
 * Merge a patch into the account prefs and persist it.
 * The mirror is written first so the UI is instant, then the cloud row is upserted; a cloud
 * failure is REPORTED (LOUD-FAILURE), not swallowed — the caller shows "saved on this computer
 * only" rather than a false "saved everywhere".
 */
export async function saveUserPrefs(uid, prefs) {
  const next = applyPrefs(prefs);
  writeMirror(next);
  if (!supabase || !uid) return { ok: false, prefs: next, error: "not signed in" };
  const { error } = await supabase.from("profiles").upsert({ id: uid, prefs: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return { ok: false, prefs: next, error: error.message };
  return { ok: true, prefs: next };
}

/* ---------------------------------------------------------------- pure edits */

/**
 * Set one plan-standard key at account scope. `value === null` REMOVES it (back to built-in).
 * `group` is "typeStyles" (a nested per-type bag) or any FLAT bag — "parcelStyle",
 * "measureStyle". The flat branch is keyed by the group name rather than hardcoding parcelStyle,
 * so adding a family (NEW-1's measurements) is a one-word change, not a new code path.
 */
export function setStandardPref(prefs, group, key, value, type) {
  const p = normalize(prefs);
  if (group === "typeStyles") {
    const bag = { ...(p.planStandards.typeStyles[type] || {}) };
    if (value === null || value === undefined) delete bag[key]; else bag[key] = value;
    const all = { ...p.planStandards.typeStyles };
    if (Object.keys(bag).length) all[type] = bag; else delete all[type];
    return { ...p, planStandards: { ...p.planStandards, typeStyles: all } };
  }
  const bag = { ...(p.planStandards[group] || {}) };
  if (value === null || value === undefined) delete bag[key]; else bag[key] = value;
  return { ...p, planStandards: { ...p.planStandards, [group]: bag } };
}

/** Read one plan-standard key at account scope (undefined = not set here). */
export function getStandardPref(prefs, group, key, type) {
  const p = normalize(prefs);
  return group === "typeStyles" ? (p.planStandards.typeStyles[type] || {})[key] : (p.planStandards[group] || {})[key];
}

export const _normalizePrefs = normalize;
