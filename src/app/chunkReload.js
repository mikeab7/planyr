/* Stale-chunk-after-deploy recovery (B218).
 *
 * The app is code-split: each workspace (Site Planner, Document Review, Sequence)
 * loads as its own content-hashed chunk, e.g. /assets/DocReview-a1b2c3.js — the hash
 * in the filename changes every build. When a new version is deployed while a tab is
 * still open on the old one, that tab is still holding the OLD index.html, whose
 * script references the OLD hashed filenames. The new deploy has replaced them (the
 * old files are gone), so switching to a not-yet-loaded workspace fails with:
 *   "Failed to fetch dynamically imported module: …/DocReview-<oldhash>.js"
 * A hard reload fixes it because it re-fetches the fresh index.html (and its new
 * hashes). This module makes that reload automatic.
 *
 * Vite dispatches a `vite:preloadError` window event whenever a dynamic import (a
 * code-split chunk) fails to load. We listen for it and reload ONCE. Because the
 * listener is global, this covers EVERY lazy workspace, not just Document Review.
 *
 * Loop guard: we stamp the time of our last auto-reload into sessionStorage. If a
 * preloadError fires again within the cooldown window, we do NOT reload — the chunk
 * is genuinely missing (a broken/partial deploy), not merely stale, so we let the
 * error fall through to the workspace ErrorBoundary instead of reload-looping. The
 * timestamp self-expires after the cooldown, which (a) lets a user actually read a
 * genuine error instead of the page reloading out from under them on every click,
 * and (b) re-arms a fresh one-time recovery for a *later, separate* deploy in the
 * same long-lived tab. This is deliberately more robust than a plain boolean flag
 * cleared on mount, which would either race the reload (auto-loop if the default
 * workspace's chunk is the missing one) or reload on every click of a truly-broken
 * module (never letting its error show).
 */

export const RELOAD_GUARD_KEY = "planyr:chunkReloadAt";
export const RELOAD_COOLDOWN_MS = 10_000;

/* Pure decision: given the current time and the timestamp of our last auto-reload
 * (0 / NaN / null if none), should we reload now? Reload unless we just reloaded
 * within the cooldown. Extracted from the DOM wiring so it's unit-testable in Node. */
export function shouldReloadAfterPreloadError(now, lastReloadAt, cooldownMs = RELOAD_COOLDOWN_MS) {
  const last = Number(lastReloadAt) || 0;
  return !(last > 0 && now - last < cooldownMs);
}

/* Wire the guard to a browser window — thin IO around the pure decision above:
 * read/write the sessionStorage timestamp and call location.reload(). Safe to call
 * once at startup; no-ops where there is no window (e.g. tests/SSR). */
export function installChunkReloadGuard(win = typeof window !== "undefined" ? window : undefined) {
  if (!win || typeof win.addEventListener !== "function") return;
  win.addEventListener("vite:preloadError", () => {
    let lastReloadAt = 0;
    try { lastReloadAt = Number(win.sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0; }
    catch { /* storage blocked (private mode / sandbox) — treat as no prior reload */ }
    if (!shouldReloadAfterPreloadError(Date.now(), lastReloadAt)) return; // already tried — let it surface
    try { win.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); }
    catch { /* storage blocked — reload anyway; worst case we can't suppress a loop */ }
    win.location.reload();
  });
}
