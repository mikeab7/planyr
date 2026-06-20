/* Project Files — upload queue / persistent drop-zone tray (B260, arrived as "NEW-1").
 *
 * The pure, browser-free heart of the drop-zone processing queue. Dropping (or pasting,
 * or picking) N files creates N INDEPENDENT queue items — one per file, each with its own
 * uploadId and its own pipeline (the component runs them through a small concurrency
 * pool, so 8 files = 8 concurrent rows, not one batch row and not a serialized chain).
 *
 * This module owns the data shape + the DERIVED two-group view the tray renders:
 *
 *   active group   — in-flight + exceptions (processing / needs-filing / failed /
 *                    rejected), plus a just-finished item during a short confirmation
 *                    beat. This is the user's live to-do list.
 *   recently-filed — the calm, accountable trail of done items past the beat. Collapsible.
 *
 * Per the upload-tray convention (Drive / Dropbox / Slack): a filed item does NOT vanish
 * from under the user. It transitions to a muted "done" state, lingers for the beat, then
 * demotes into the recently-filed trail — never an abrupt removal. The two groups are a
 * derived view over ONE array (filter by status + a filedAt timestamp), never two lists.
 */

export const QUEUE_STATUS = {
  PROCESSING: "processing",     // pipeline running
  DONE: "done",                 // filed under a project — demotes to the trail after the beat
  NEEDS_FILING: "needs_filing", // filed but unrouted (no / low-confidence match) — stays until triaged
  FAILED: "failed",             // pipeline error — stays until retried
  REJECTED: "rejected",         // unsupported file type — never entered the pipeline
};

// How long a freshly-filed item stays in the active group before it demotes into the
// "recently filed" trail. ~3s: long enough to register (the convention that <1s feels
// instant and anything longer needs a visible state), short enough to stay quiet.
export const RECENT_BEAT_MS = 3000;

// The recently-filed trail collapses by default once it grows past this many entries.
export const RECENT_COLLAPSE_AT = 3;

// We accept PDFs into the pipeline. Anything else gets a clear per-file rejection row
// (never silently discarded), so a mixed drop is honest about what it took and what it didn't.
export function isAcceptedFile(file) {
  if (!file) return false;
  const name = (file.name || "").toLowerCase();
  return file.type === "application/pdf" || /\.pdf$/.test(name);
}

let _seq = 0;
// A stable, unique id per upload. crypto.randomUUID when available; a monotonic fallback
// otherwise (tests / older runtimes) so two same-name files never collide on the same row.
export function makeUploadId() {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* fall through */ }
  _seq += 1;
  return `up_${Date.now().toString(36)}_${_seq}`;
}

// One independent queue item per file. Accepted files start PROCESSING; unsupported types
// start REJECTED with a plain reason (so the row explains itself rather than vanishing).
export function makeQueueItem(file, { uploadId } = {}) {
  const accepted = isAcceptedFile(file);
  return {
    uploadId: uploadId || makeUploadId(),
    name: (file && file.name) || "file",
    sizeMB: file && file.size ? file.size / (1024 * 1024) : 0,
    file: file || null,
    status: accepted ? QUEUE_STATUS.PROCESSING : QUEUE_STATUS.REJECTED,
    error: accepted ? null : "Not a PDF — only PDFs can be filed.",
    warn: null,    // non-fatal note on an otherwise-filed item (e.g. upload / Drive degraded)
    filedAt: null, // set when it reaches a terminal "filed" state; drives the demote beat
    reviewId: null,
    target: null,  // human label of where it filed (project name / holding area)
  };
}

// Build one item per file in a list — drop / picker / paste all funnel through here, so
// "multiple files in a single action" is first-class on every entry path (Amendment A).
export function makeQueueItems(files, makeId = makeUploadId) {
  return [...(files || [])].map((f) => makeQueueItem(f, { uploadId: makeId() }));
}

const ACTIVE_ALWAYS = new Set([
  QUEUE_STATUS.PROCESSING, QUEUE_STATUS.NEEDS_FILING, QUEUE_STATUS.FAILED, QUEUE_STATUS.REJECTED,
]);

// A DONE item that just landed and is still inside its confirmation beat.
function withinBeat(item, now, beatMs) {
  return item.status === QUEUE_STATUS.DONE && item.filedAt != null && (now - item.filedAt) < beatMs;
}

// The DERIVED two-group view over the single queue array. No mutation, no second list:
// the active/recent split is purely a function of each item's status + filedAt vs. `now`.
export function splitQueue(queue, now = Date.now(), { beatMs = RECENT_BEAT_MS } = {}) {
  const active = [];
  const recent = [];
  for (const it of queue || []) {
    if (ACTIVE_ALWAYS.has(it.status) || withinBeat(it, now, beatMs)) active.push(it);
    else if (it.status === QUEUE_STATUS.DONE) recent.push(it);
  }
  // Recently-filed newest-first (the most recently demoted sits at the top of the trail).
  recent.sort((a, b) => (b.filedAt || 0) - (a.filedAt || 0));
  return { active, recent };
}

// True while at least one freshly-filed item is still inside its beat — i.e. the tray
// needs to keep ticking so the demote happens on time even with no further user action.
export function hasPendingDemote(queue, now = Date.now(), beatMs = RECENT_BEAT_MS) {
  return (queue || []).some((it) => withinBeat(it, now, beatMs));
}

// Run an async worker over items with at most `limit` in flight at once. Each file gets
// its own concurrent pipeline; this just caps how many run simultaneously (so dropping 8
// files doesn't fire 8 uploads at once, and doesn't serialize them into a slow chain).
// The worker is expected to handle its own errors (mark the item FAILED) — it should not
// throw, so one bad file can't take the pool down.
export async function runPool(items, worker, limit = 3) {
  const list = [...(items || [])];
  const lanes = Math.max(1, limit | 0);
  let i = 0;
  async function lane() {
    while (i < list.length) {
      const idx = i++;
      await worker(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(lanes, list.length) }, lane));
}
