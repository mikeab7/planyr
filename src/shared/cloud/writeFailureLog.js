/* writeFailureLog.js — a durable record of a cloud WRITE that failed, surviving the SAME event
 * that caused the failure.
 *
 * B### (2026-09-02) — production repro: renaming a project while its lazy `cloudRename.js` chunk
 * failed to load (a tab left open across a deploy) fired `chunkReload.js`'s global
 * `vite:preloadError` listener, which — on the FIRST such failure — navigates the page
 * (`reloadFresh()` → `location.replace`) to recover the stale build. That navigation can win the
 * race against the in-memory LOUD-FAILURE banner (`SitePlannerApp`'s `pushError`, a plain React
 * state): the write's own `.catch()` still runs and still calls `setPushError(...)`, but the
 * commit never gets a chance to PAINT before the document unloads, so the user never saw it — the
 * only record left behind was one `event:cloud-push-failed` row in `client_errors`, which the
 * user never sees either.
 *
 * `localStorage.setItem` is synchronous, so a write here completes in full the instant the
 * failure handler runs, regardless of whether the tab then reloads, closes, or keeps going. Boot
 * drains this log and re-surfaces anything still unresolved — so a failure that got navigated
 * away from before it could paint is not lost, it is deferred to the next load. */

const KEY = "planyr:cloudWriteFailures";
const MAX_ENTRIES = 12;

function readRaw(win) {
  try {
    const raw = win.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeRaw(win, list) {
  try { win.localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES))); } catch { /* storage blocked */ }
}
const winOf = (win) => win || (typeof window !== "undefined" ? window : undefined);
const newId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/* Record one failed write. `what` is a short owner-facing label ("The project rename"); `groupId`/
 * `siteId` name what to retry against (whichever the caller has); `error` is the raw message for
 * telemetry-grade detail. Never throws — a failed record of a failure must not itself fail loud. */
export function recordCloudWriteFailure({ what, groupId = null, siteId = null, error = "" } = {}, win) {
  const w = winOf(win);
  if (!w) return null;
  const entry = { id: newId(), what: what || "A change", groupId, siteId, error: String(error || ""), at: Date.now() };
  const list = readRaw(w);
  list.push(entry);
  writeRaw(w, list);
  return entry;
}

export function readCloudWriteFailures(win) {
  const w = winOf(win);
  return w ? readRaw(w) : [];
}

export function clearCloudWriteFailure(id, win) {
  const w = winOf(win);
  if (!w) return;
  writeRaw(w, readRaw(w).filter((e) => e.id !== id));
}

export function clearAllCloudWriteFailures(win) {
  const w = winOf(win);
  if (!w) return;
  try { w.localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
