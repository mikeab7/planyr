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
/* global __BUILD_ID__ */
import { flushAll } from "./flushRegistry.js";
import { reportClientEvent } from "../shared/telemetry/clientErrors.js";

export const RELOAD_GUARD_KEY = "planyr:chunkReloadAt";
export const RELOAD_COOLDOWN_MS = 10_000;
export const RELOAD_PARAM = "_r"; // throwaway cache-busting query key

/* ── NEW-1: THE OUTCOME THIS GUARD CHOSE, RECORDED ────────────────────────────────────────────
 *
 * ⛔ THE DEFECT, MEASURED IN PRODUCTION RATHER THAN REASONED ABOUT. `public.client_errors` held
 * 361 rows of source `vite:preloadError` and NOT ONE of them recorded which of the three branches
 * below was taken. So "82 rows on a deploy day" was unreadable in the most dangerous way: 82
 * silent successful rescues and 82 users left staring at a dead page produce byte-identical
 * evidence, and the honest reading of the table was "these are dead ends" — which is what was
 * reported to the owner, from data that could not support it either way. This is the eighth
 * appearance of the blind-instrument class in this repo, and it is the same shape every time: the
 * decision is made, the decision is acted on, and the decision is never written down.
 *
 * ⛔ AND THE RECOVERY ROW IS NOT THE FAILURE ROW, WHICH IS WHY THIS IS A PAIRED EVENT AND NOT AN
 * EXTRA COLUMN. A rescue's whole point is that the page NAVIGATES — the tab that would report
 * "it worked" is destroyed by the very act of the fix. So the outcome has to survive the reload,
 * and the only thing that does is `sessionStorage`. The EPISODE record below is that survivor: it
 * carries the attempt count and the failing chunk across the navigation, so the page that comes
 * back can say "I am the one that came back, on attempt N" — a claim no single page-load could
 * ever make about itself.
 *
 * FOUR OUTCOMES GO ON THE WIRE, and the last two are the pair that was missing:
 *   • `reload`   — a cache-busting reload was fired (the normal stale-after-deploy rescue).
 *   • `stuck`    — this page ALREADY arrived via a fresh reload and a chunk failed anyway.
 *   • `cooldown` — suppressed to avoid a tight loop.
 *   • `landed`   — a page that arrived via `?_r=` booted. The rescue delivered a working document.
 *   • `recovered`— `landed`, and nothing failed in the settle window that followed. THE RESCUE WORKED.
 *   • `left`     — an episode was open and the tab moved on some other way (a manual reload, a
 *                  navigation). The user rescued themselves; the guard did not.
 * `landed` + `recovered` is a success. `landed` + `stuck` is a user at a wall. Those two were
 * indistinguishable before this, and telling them apart is the entire deliverable. */
export const RECOVERY_KEY = "planyr:chunkRecovery";
/* How long a landed page must go without another chunk failure before the rescue is called a
 * success. Deliberately longer than a boot: the lazy chunk that fails is usually fetched by a
 * route mount or a first interaction, not by the entry script, so a 2-second window would call
 * every episode recovered before the failing import was even attempted. */
export const RECOVERY_SETTLE_MS = 15_000;
/* An episode record older than this describes a session that ended long ago; a chunk failure now
 * is a NEW incident, not attempt N+1 of that one. Without this the attempt counter would ratchet
 * up forever inside one long-lived tab and every count after the first would be a lie. */
export const RECOVERY_EPISODE_MAX_MS = 30 * 60_000;

const BUILD = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

/* The failing chunk's filename, out of whatever the preloadError carried. Reported instead of the
 * full URL because the FILENAME is the identity (`terrainLayers-aE2wQGtV.js` — module + content
 * hash), and it is what makes two rows the same episode or different ones. Never throws. */
export function chunkNameOf(error) {
  try {
    const m = String((error && (error.message || error.name)) || error || "");
    const hit = m.match(/[^/\s"']+\.(?:js|mjs|css)\b/);
    return hit ? hit[0] : "";
  } catch { return ""; }
}

/* Pure: fold one chunk failure into the episode record. Returns the NEXT record.
 *
 * `n` counts RELOAD ATTEMPTS, not failures — the owner's question is "how many reloads did it
 * take", and a `cooldown` or `stuck` decision fires no reload, so neither may advance it. `f`
 * counts failures, so a storm (one wedged tab re-attempting the same import) is legible as one
 * episode with many failures rather than as many episodes. */
export function noteRecoveryAttempt(prev, { now, stage, chunk = "", build = BUILD, episodeMaxMs = RECOVERY_EPISODE_MAX_MS } = {}) {
  const stale = !prev || !Number.isFinite(Number(prev.t0)) || now - Number(prev.t0) > episodeMaxMs;
  const base = stale ? { t0: now, n: 0, f: 0, b: build } : prev;
  return {
    t0: Number(base.t0) || now,
    n: (Number(base.n) || 0) + (stage === "reload" ? 1 : 0),
    f: (Number(base.f) || 0) + 1,
    b: base.b || build,
    c: chunk || base.c || "",
    at: now,
  };
}

/* Pure: what a booting page should report about an episode it inherited.
 *
 * `landed` when this page-load arrived via the cache-buster — the reload produced a document that
 * runs, which is a strictly stronger fact than "we called location.replace". `left` when a record
 * is open but we did NOT arrive that way, i.e. the tab escaped without the guard. Null when there
 * is nothing to say, so a normal boot puts nothing on the wire. */
export function landingReport(arrivedFresh, rec, { now, build = BUILD, episodeMaxMs = RECOVERY_EPISODE_MAX_MS } = {}) {
  if (!rec || !Number.isFinite(Number(rec.t0))) return null;
  if (now - Number(rec.t0) > episodeMaxMs) return null;   // an ancient record explains nothing
  return {
    outcome: arrivedFresh ? "landed" : "left",
    n: Number(rec.n) || 0,
    f: Number(rec.f) || 0,
    ms: Math.max(0, Math.round(now - Number(rec.t0))),
    chunk: rec.c || "",
    from: rec.b || "",
    to: build,
  };
}

/* ⛔ Pure: does failure number `f` of this episode get a row?
 *
 * IT MUST NOT BE "EVERY ONE", AND THE REASON IS THE VERY DATA THIS ITEM WAS FILED OVER. The
 * production table's worst episode — build 53d1bac, `terrainLayers-aE2wQGtV.js`, 2026-08-06 — ran
 * for TWO HOURS AND TWENTY MINUTES at one row every ten seconds, and it was one wedged tab
 * re-attempting one import, not 81 incidents. Ten seconds is exactly `DUP_MS` in clientErrors, so
 * that cadence was the DEDUPE window, not the failure rate: the true rate was higher and unknown.
 * A paired event that carries a rising counter has a DIFFERENT signature every time, so it would
 * slip that dedupe entirely and turn a storm into a row per cursor move — an instrument that
 * makes the noise it was built to explain.
 *
 * So rows are spaced on a 1-2-5 ladder: every one of the first three, then 5, 10, 25, 50, 100, 250…
 * The count RIDES each row, so the last row of a storm still states its true size — which is the
 * fact that was missing — while a two-hour episode costs about ten rows instead of eight hundred. */
export function shouldReportFailure(f) {
  const n = Number(f);
  if (!Number.isInteger(n) || n < 1) return false;
  if (n <= 3) return true;
  for (let mag = 1; mag <= 1e9; mag *= 10) {
    for (const m of [5, 10, 25, 50]) {
      const v = m * mag;
      if (v === n) return true;
      if (v > n) return false;   // the ladder is non-decreasing, so we have passed it
    }
  }
  return false;
}

/* The one line that goes on the wire. Short keys, same reason `buildPerfRow` uses them: this rides
 * in `client_errors.message`, which truncates. */
export function recoveryLine(outcome, extra = {}) {
  const row = { o: outcome, ...extra };
  for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === "") delete row[k];
  try { return JSON.stringify(row); } catch { return `{"o":"${outcome}"}`; }
}

/* ── episode record I/O (sessionStorage; every path fails safe) ───────────────────────────────── */
export function readRecovery(win) {
  try { return JSON.parse(win.sessionStorage.getItem(RECOVERY_KEY) || "null"); } catch { return null; }
}
export function writeRecovery(win, rec) {
  try { win.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(rec)); } catch { /* storage blocked */ }
}
export function clearRecovery(win) {
  try { win.sessionStorage.removeItem(RECOVERY_KEY); } catch { /* storage blocked */ }
}

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

  /* NEW-1 — close out the episode this page-load inherited, BEFORE anything can fail again. A
   * `landed` row is the reload's receipt; the settle timer below turns it into a verdict. */
  let _failedSinceLanding = false;
  try {
    const landing = landingReport(_arrivedViaFreshReload, readRecovery(win), { now: Date.now() });
    if (landing) {
      reportClientEvent("chunk-recovery", recoveryLine(landing.outcome, {
        n: landing.n, f: landing.f, ms: landing.ms, c: landing.chunk, from: landing.from, to: landing.to,
      }));
      if (!_arrivedViaFreshReload) clearRecovery(win);   // the tab escaped on its own; episode over
      else win.setTimeout(() => {
        /* ⛔ THE VERDICT ROW, and the reason it is a TIMER rather than an immediate claim. The
         * chunk that failed is fetched by a route mount or a first interaction, not by the entry
         * script — so a page that has merely booted has not yet re-attempted the import it died
         * on, and calling that a recovery would make this instrument agree with itself instead of
         * with reality. Silence for the settle window is the weakest claim the data supports and
         * it is the one made here. */
        if (_failedSinceLanding) return;                  // a `stuck` row already told the truth
        try {
          reportClientEvent("chunk-recovery", recoveryLine("recovered", { n: landing.n, f: landing.f, c: landing.chunk, to: landing.to }));
          clearRecovery(win);
        } catch { /* telemetry must never throw into the app */ }
      }, RECOVERY_SETTLE_MS);
    }
  } catch { /* telemetry must never throw into the app */ }

  win.addEventListener("vite:preloadError", (e) => {
    let lastReloadAt = 0;
    try { lastReloadAt = Number(win.sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0; }
    catch { /* storage blocked (private mode / sandbox) — treat as no prior reload */ }
    const now = Date.now();
    const stage = recoveryStage(_arrivedViaFreshReload, now, lastReloadAt);
    /* Record the branch BEFORE acting on it — `reload` navigates, and a row written after the
     * navigation has started is a row that may never leave the machine. */
    try {
      _failedSinceLanding = true;
      const chunk = chunkNameOf((e && e.payload) || e);
      const rec = noteRecoveryAttempt(readRecovery(win), { now, stage, chunk });
      writeRecovery(win, rec);
      /* A `reload` always reports — the cooldown already bounds it to a handful, and it is the
       * branch whose absence would leave a rescue invisible. A `stuck`/`cooldown` storm reports on
       * the ladder, carrying its own true count. */
      if (stage === "reload" || shouldReportFailure(rec.f)) {
        reportClientEvent("chunk-recovery", recoveryLine(stage, { n: rec.n, f: rec.f, c: chunk, b: BUILD }));
      }
    } catch { /* telemetry must never throw into the app */ }
    // Only "reload" auto-recovers; "stuck" (still failing after a fresh reload) and
    // "cooldown" (just reloaded) fall through to the ErrorBoundary instead of looping.
    if (stage !== "reload") return;
    try { win.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now)); }
    catch { /* storage blocked — reload anyway; worst case we can't suppress a loop */ }
    reloadFresh(win);
  });
}
