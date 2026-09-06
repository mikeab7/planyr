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

/* NEW-1 (B1204736) — the exact owner-facing labels the two group-scoped writers record their
 * failures under. `inferEntryKind` matches an entry's `what` against these BY EXACT STRING ONLY —
 * never fuzzily — to recover a `kind` for a legacy entry queued by a build that predates `kind`. */
export const WHAT_RENAME = "The project rename";
export const WHAT_STATUS = "The status change";
export const WHAT_DATES = "The deal-date change"; // B1161793 (NEW-2) — feasibility/LOI/closing dates

/* Record one failed write. `what` is a short owner-facing label ("The project rename"); `groupId`/
 * `siteId` name what to retry against (whichever the caller has); `kind` ("rename" | "status" |
 * "row") names WHICH write shape produced it, so a replay can pick the matching write path instead
 * of guessing from shape alone; `error` is the raw message for telemetry-grade detail. Never
 * throws — a failed record of a failure must not itself fail loud. */
export function recordCloudWriteFailure({ what, groupId = null, siteId = null, kind = null, error = "" } = {}, win) {
  const w = winOf(win);
  if (!w) return null;
  const entry = { id: newId(), what: what || "A change", groupId, siteId, kind, error: String(error || ""), at: Date.now() };
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

/* NEW-1 (B1204736) — which write shape a queued entry names. A `kind` stamped at record time
 * (every writer now passes one) wins outright. An entry with no `kind` predates this fix — queued
 * by a build already deployed when it lands — and is inferred from an EXACT match against the
 * owner-facing label the writer used, never a fuzzy guess: guessing "rename" for a status change
 * would replay a name and never write the status. A `siteId` entry (no `groupId`) is always a
 * genuinely single-row action regardless of its label. */
export function inferEntryKind(e) {
  if (!e) return null;
  if (e.kind === "rename" || e.kind === "status" || e.kind === "dates" || e.kind === "row") return e.kind;
  if (!e.groupId) return "row";
  if (e.what === WHAT_RENAME) return "rename";
  if (e.what === WHAT_STATUS) return "status";
  if (e.what === WHAT_DATES) return "dates";
  return "row"; // an unrecognized group-scoped label — never guessed, falls to the generic fan-out
}

/* PRE_FIX_RETRY — the shipped B1048400 fan-out replay, kept byte-for-byte as a regression control
 * (never called by the app). It fixed "replay only the group's own row" but stayed the wrong SHAPE:
 * it fires one cloud write per plan with no await and no per-row confirmation, so a fan-out
 * interrupted partway through (a chunk failure, a tab close, a reload) leaves the group PARTLY
 * written while the caller — which cleared the whole durable log before ever calling this — reports
 * nothing wrong. Production repro: three distinct `updated_at` stamps 2.4s apart on one renamed
 * group. See `test/writeFailureLog.test.js`'s PRE_FIX_RETRY suite for the two control tests this
 * proves, and `replayCloudWriteFailures`/`retryCloudWriteFailures` below for the fix. */
export function PRE_FIX_RETRY(pending, { loadPlansOfGroup, pushLoud }) {
  for (const e of pending || []) {
    if (!e) continue;
    if (e.groupId) {
      for (const p of loadPlansOfGroup(e.groupId) || []) pushLoud(p.id, e.what);
    } else if (e.siteId) {
      pushLoud(e.siteId, e.what);
    }
  }
}

/* NEW-1 (B1204736) — replay every pending failure through the SAME write shape its live path
 * uses, never a generic per-row fan-out for a kind that has an atomic group RPC behind it.
 *
 *   groupWrite(entry, kind) -> Promise<{handled, ok}> | undefined
 *     An adapter the caller supplies (SitePlannerApp's `replayGroupAtomically`) that knows how to
 *     replay ONE kind atomically — a "rename" through the same `renameSiteGroup` RPC the live
 *     rename path uses, one statement, one stamp. It answers `{handled:false}` for any kind it has
 *     no atomic path for (a site-status change has no group RPC — its normal path is row-by-row
 *     too, see siteStatus.js) so the generic fan-out below runs instead; that fan-out is reported
 *     ok ONLY when every live plan confirms — never on the first success, which is exactly how
 *     B1048400 already recurred once inside its own fix. `handled:true` OWNS the outcome even when
 *     `ok` is false: an atomic write that failed must not be retried through the non-atomic shape,
 *     which would reintroduce the partial-write it exists to prevent.
 *
 * A `groupId` entry with no live plans is refused rather than reported as a vacuous success.
 * Returns one `{ entry, ok }` per input entry, in order, so the caller (`retryCloudWriteFailures`)
 * can clear only what actually landed. */
export async function replayCloudWriteFailures(pending, { loadPlansOfGroup, pushLoud, groupWrite } = {}) {
  const results = [];
  for (const e of pending || []) {
    if (!e) { results.push({ entry: e, ok: false }); continue; }
    const kind = inferEntryKind(e);
    if (groupWrite) {
      const r = await groupWrite(e, kind);
      if (r && r.handled) { results.push({ entry: e, ok: r.ok === true }); continue; }
    }
    if (e.groupId) {
      const plans = (loadPlansOfGroup && loadPlansOfGroup(e.groupId)) || [];
      if (!plans.length) { results.push({ entry: e, ok: false }); continue; }
      const oks = await Promise.all(plans.map((p) => pushLoud(p.id, e.what)));
      results.push({ entry: e, ok: oks.length > 0 && oks.every((ok) => ok === true) });
    } else if (e.siteId) {
      const ok = await pushLoud(e.siteId, e.what);
      results.push({ entry: e, ok: ok === true });
    } else {
      results.push({ entry: e, ok: false });
    }
  }
  return results;
}

/* NEW-1 (B1204736) — THE LOG OUTLIVES THE WRITE: replay, then clear ONLY the entries that are
 * actually confirmed, and hand the caller back what's still pending so it can re-raise the banner
 * over exactly that. The bug this replaces cleared the WHOLE log, unconditionally, before a single
 * row had even been attempted — an interrupted retry then had nothing left to re-surface on the
 * next boot. Splitting "did the write land" from "what does the log now say" is the whole fix. */
export async function retryCloudWriteFailures(pending, opts, win) {
  const results = await replayCloudWriteFailures(pending, opts);
  let cleared = 0;
  const remaining = [];
  for (const r of results) {
    if (r.ok) { clearCloudWriteFailure(r.entry.id, win); cleared += 1; }
    else remaining.push(r.entry);
  }
  return { cleared, remaining };
}
