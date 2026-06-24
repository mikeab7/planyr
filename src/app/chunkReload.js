/* Stale-chunk-after-deploy recovery (B221, hardened in B239).
 *
 * The app is code-split: each workspace (Site Planner, Document Review, Sequence)
 * loads as its own content-hashed chunk, e.g. /assets/Scheduler-a1b2c3.js — the hash
 * in the filename changes every build. When a new version is deployed while a tab is
 * still open on the old one, that tab is still holding the OLD index.html, whose
 * script references the OLD hashed filenames. The new deploy has replaced them (the
 * old files are gone), so switching to a not-yet-loaded workspace fails with:
 *   "Failed to fetch dynamically imported module: …/Scheduler-<oldhash>.js"
 * A reload that re-fetches the fresh index.html (and its new hashes) fixes it. This
 * module makes that reload automatic.
 *
 * Vite dispatches a `vite:preloadError` window event whenever a dynamic import (a
 * code-split chunk) fails to load. We listen for it and reload ONCE. Because the
 * listener is global, this covers EVERY lazy workspace, not just one.
 *
 * WHY A CACHE-BUSTING RELOAD (B239): a plain location.reload() re-requests the SAME
 * URL and the browser may answer it from its own cached copy of index.html. If that
 * cached HTML is the stale build, the reload lands right back on the deleted chunk and
 * dead-ends (preloadError → cooldown → ErrorBoundary). This is the real-world failure
 * the no-cache `_headers` can't retro-fix for a tab that already cached the old HTML.
 * reloadFresh() navigates to the same path with a throwaway ?_r=<ts> query — a new
 * cache key — so the browser is FORCED to fetch index.html fresh and pick up the
 * current chunk names. The param means nothing to the app and is stripped on the next
 * load by stripReloadParam().
 *
 * Loop guard: we stamp the time of our last auto-reload into sessionStorage. If a
 * preloadError fires again within the cooldown window, we do NOT reload — the chunk
 * is genuinely missing (a broken/partial deploy), not merely stale, so we let the
 * error fall through to the workspace ErrorBoundary instead of reload-looping. The
 * timestamp self-expires after the cooldown, which (a) lets a user actually read a
 * genuine error instead of the page reloading out from under them on every click,
 * and (b) re-arms a fresh one-time recovery for a *later, separate* deploy in the
 * same long-lived tab.
 */
import { flushAll } from "./flushRegistry.js";

export const RELOAD_GUARD_KEY = "planyr:chunkReloadAt";
export const RELOAD_COOLDOWN_MS = 10_000;
export const RELOAD_PARAM = "_r"; // throwaway cache-busting query key

/* Pure decision: given the current time and the timestamp of our last auto-reload
 * (0 / NaN / null if none), should we reload now? Reload unless we just reloaded
 * within the cooldown. Extracted from the DOM wiring so it's unit-testable in Node. */
export function shouldReloadAfterPreloadError(now, lastReloadAt, cooldownMs = RELOAD_COOLDOWN_MS) {
  const last = Number(lastReloadAt) || 0;
  return !(last > 0 && now - last < cooldownMs);
}

/* Which recovery action fits a chunk-load failure right now (B447)? Three outcomes:
 *  - "reload": no fresh reload tried yet (or the cooldown elapsed) → cache-bust to the
 *    freshest build. This is the normal stale-after-deploy recovery.
 *  - "stuck":  this very page-load ARRIVED via a fresh reload (the ?_r= cache-buster was
 *    on the URL) and a chunk STILL failed → the fresh build is ALSO missing it (the
 *    server is mid-deploy / an edge node is skewed). Reloading again just dead-ends, so
 *    we stop auto-reloading and let the ErrorBoundary show an honest "finishing a
 *    deploy" message with a manual escape.
 *  - "cooldown": we auto-reloaded very recently (within the window) on a load that did
 *    NOT arrive via _r → suppress to avoid a tight loop; let the error surface.
 * Pure + unit-testable; the DOM wiring lives in installChunkReloadGuard. */
export function recoveryStage(arrivedViaFreshReload, now, lastReloadAt, cooldownMs = RELOAD_COOLDOWN_MS) {
  if (arrivedViaFreshReload) return "stuck";
  return shouldReloadAfterPreloadError(now, lastReloadAt, cooldownMs) ? "reload" : "cooldown";
}

/* Was the cache-busting ?_r= param present on the current URL? Read BEFORE
 * stripReloadParam tidies it away, this tells us the page arrived via a fresh reload —
 * the signal recoveryStage() uses to detect a still-failing-after-fresh-reload deploy. */
export function hasReloadParam(win = typeof window !== "undefined" ? window : undefined) {
  if (!win || !win.location) return false;
  try { return new URL(win.location.href).searchParams.has(RELOAD_PARAM); } catch { return false; }
}

/* Forget the last-auto-reload timestamp so the very next preloadError (or a manual
 * retry button) is allowed to reload immediately instead of being suppressed by the
 * cooldown. Used by the ErrorBoundary "Try again" escape on a stuck (mid-deploy) page. */
export function clearReloadGuard(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return;
  try { win.sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* storage blocked — nothing to clear */ }
}

// Captured once at guard install (before the URL is tidied): did THIS page-load arrive
// via a fresh cache-busting reload? The ErrorBoundary reads it to pick its message.
let _arrivedViaFreshReload = false;
export function arrivedViaFreshReload() { return _arrivedViaFreshReload; }

/* Does this error look like a failed code-split/dynamic-import load (a stale or
 * missing chunk) rather than an ordinary render crash? Matches the phrasings Chrome,
 * Firefox and Safari use, plus the "served HTML where JS was expected" MIME error you
 * get when an SPA catch-all answers a missing /assets/* request with index.html. Used
 * by the ErrorBoundary to pick the right recovery action. Never throws. */
const CHUNK_ERROR_RE =
  /dynamically imported module|importing a module script failed|error loading dynamically imported|failed to fetch dynamically|ChunkLoadError|Loading chunk\b|Expected a JavaScript module script|valid JavaScript MIME type|module script failed/i;

export function isChunkLoadError(error) {
  const msg = String((error && (error.message || error.name)) || error || "");
  return CHUNK_ERROR_RE.test(msg);
}

/* Reload to the freshest build by navigating to the same path with a throwaway query
 * param — a distinct cache key the browser must fetch from the server, defeating a
 * hard-cached stale index.html. location.replace (not assign) so the dead-end page
 * leaves no back-button trap. Falls back to a plain reload if URL building fails. */
export function reloadFresh(win = typeof window !== "undefined" ? window : undefined) {
  if (!win || !win.location) return;
  // Give every live workspace one last synchronous chance to flush (local save +
  // keepalive cloud push) before we navigate away (B452) — a forced reload must not
  // strand the last edits in memory. Best-effort: never let a flush block the reload.
  try { flushAll(); } catch { /* flush is best-effort */ }
  try {
    const url = new URL(win.location.href);
    url.searchParams.set(RELOAD_PARAM, String(Date.now()));
    win.location.replace(url.toString());
  } catch {
    try { win.location.reload(); } catch { /* last resort — nothing else to try */ }
  }
}

/* Cosmetic cleanup: once the fresh build has loaded, drop the throwaway ?_r= param
 * from the address bar (no navigation, no history entry). Safe no-op when absent. */
export function stripReloadParam(win = typeof window !== "undefined" ? window : undefined) {
  if (!win || !win.location || !win.history || typeof win.history.replaceState !== "function") return;
  try {
    const url = new URL(win.location.href);
    if (!url.searchParams.has(RELOAD_PARAM)) return;
    url.searchParams.delete(RELOAD_PARAM);
    const qs = url.searchParams.toString();
    win.history.replaceState(win.history.state, "", url.pathname + (qs ? `?${qs}` : "") + url.hash);
  } catch { /* best-effort cosmetic cleanup */ }
}

/* Wire the guard to a browser window — thin IO around the pure decision above:
 * read/write the sessionStorage timestamp and trigger the cache-busting reload. Safe
 * to call once at startup; no-ops where there is no window (e.g. tests/SSR). */
export function installChunkReloadGuard(win = typeof window !== "undefined" ? window : undefined) {
  if (!win || typeof win.addEventListener !== "function") return;
  // Capture the "arrived via fresh reload" signal from the ?_r= param BEFORE we strip it
  // — a chunk failure on such a load means even the fresh build is missing the chunk.
  _arrivedViaFreshReload = hasReloadParam(win);
  stripReloadParam(win); // we may have just recovered via reloadFresh — tidy the URL
  win.addEventListener("vite:preloadError", () => {
    let lastReloadAt = 0;
    try { lastReloadAt = Number(win.sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0; }
    catch { /* storage blocked (private mode / sandbox) — treat as no prior reload */ }
    // Only "reload" auto-recovers; "stuck" (still failing after a fresh reload) and
    // "cooldown" (just reloaded) fall through to the ErrorBoundary instead of looping.
    if (recoveryStage(_arrivedViaFreshReload, Date.now(), lastReloadAt) !== "reload") return;
    try { win.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); }
    catch { /* storage blocked — reload anyway; worst case we can't suppress a loop */ }
    reloadFresh(win);
  });
}
