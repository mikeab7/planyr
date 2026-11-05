/* lib/roadRadiusFeature.js — the ONE switch for the road minimum-radius review feature
 * (NEW-3, owner 2026-10-16: "it should just let me be wrong; it's not good enough yet, keep it in the
 * background, don't show it").
 *
 * HIDE, NEVER DELETE. While this is OFF (the default) the app does not SHOW or ACT ON the feature:
 *   · the Properties panel's "Curve at vertex" section (sharp / arc / smooth + arc radius),
 *   · the panel's "radius below min" warning and its Fix radius button,
 *   · the on-canvas review flags (`roadRadiusFlags` — the corner dot + label pill),
 *   · the toasts about tight corners (after a vertex drag, after drawing a road) and the automatic
 *     corner re-cut a class change used to apply.
 * Everything else about roads is untouched: roads that already carry stored vertex treatments / radii
 * render exactly as before, and vertex dragging, branching, tees and drive connects behave as before.
 * No data is migrated or rewritten — the stored `vtx` treatments simply keep rendering.
 *
 * Turning it back on needs no code change: set `VITE_ROAD_RADIUS_REVIEW=1` at build time, or (for a
 * developer looking at the finished-so-far feature) `localStorage["planyr:flag:roadRadiusReview"] = "1"`
 * in the console and reload. Both read at CALL time; there is no other switch (one flag, not several). */

export const ROAD_RADIUS_REVIEW_KEY = "planyr:flag:roadRadiusReview";

const truthy = (v) => {
  const s = String(v == null ? "" : v).toLowerCase();
  return s === "1" || s === "true" || s === "on";
};

/* `env` / `storage` are injectable so the decision is testable without a browser. */
export function roadRadiusReviewOn(env, storage) {
  try {
    const src = env || (typeof import.meta !== "undefined" && import.meta.env) || {};
    if (truthy(src.VITE_ROAD_RADIUS_REVIEW)) return true;
  } catch (_) { /* no env — fall through to the storage opt-in */ }
  try {
    const ls = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    return !!ls && truthy(ls.getItem(ROAD_RADIUS_REVIEW_KEY));
  } catch (_) { return false; }
}
