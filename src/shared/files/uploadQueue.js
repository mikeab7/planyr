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
  REJECTED: "rejected",         // empty / unreadable file — never entered the pipeline
};

// How long a freshly-filed item stays in the active group before it demotes into the
// "recently filed" trail. ~3s: long enough to register (the convention that <1s feels
// instant and anything longer needs a visible state), short enough to stay quiet.
export const RECENT_BEAT_MS = 3000;

// The recently-filed trail collapses by default once it grows past this many entries.
export const RECENT_COLLAPSE_AT = 3;

// We accept ANY file type into the pipeline (B685 — owner: "I should be able to upload any
// file type"). The Library is a general document store, not a PDF-only inbox: DWG, images,
// spreadsheets, Word docs, ZIPs — all belong. The only thing we reject is an empty / unreadable
// file, which is a genuine mistake rather than a "type" (never silently discarded — it still
// gets a clear per-file row). PDFs keep their special powers (title-block auto-filing, sheet
// stitching); other types are simply stored, indexed, shareable, and downloadable.
export function isAcceptedFile(file) {
  return !!(file && file.size > 0);
}

// True when a file is (or names) a PDF — the only type the markup canvas can render and the
// only type the title-block auto-filer reads. Callers use it to branch (open-in-Review vs.
// download, read-title-block vs. skip) without re-implementing the check.
export function isPdfName(nameOrFile) {
  if (!nameOrFile) return false;
  if (typeof nameOrFile === "string") return /\.pdf$/i.test(nameOrFile);
  return nameOrFile.type === "application/pdf" || /\.pdf$/i.test(nameOrFile.name || "");
}

// OS / application junk a folder sweep drags along that the user never meant to file: hidden
// dotfiles (.DS_Store, .git…), Windows thumbnail caches, Office lock files, and zero-byte
// entries. Loose hand-picked files are always honoured (the user chose them); only FOLDER
// drops filter these out, with one honest "skipped N system files" summary.
export function isJunkFile(file) {
  if (!file) return true;
  const base = String(file.name || "").split("/").pop();
  if (!base) return true;
  if (base.startsWith(".")) return true;                 // .DS_Store, .gitignore, dotfiles
  if (/^~\$/.test(base)) return true;                    // Office lock files (~$Report.docx)
  if (/^(Thumbs\.db|desktop\.ini)$/i.test(base)) return true;
  return !(file.size > 0);                               // zero-byte / unreadable
}

let _seq = 0;
// A stable, unique id per upload. crypto.randomUUID when available; a monotonic fallback
// otherwise (tests / older runtimes) so two same-name files never collide on the same row.
export function makeUploadId() {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* fall through */ }
  _seq += 1;
  return `up_${Date.now().toString(36)}_${_seq}`;
}

// One independent queue item per file. Real files start PROCESSING; an empty / unreadable
// file starts REJECTED with a plain reason (so the row explains itself rather than vanishing).
export function makeQueueItem(file, { uploadId } = {}) {
  const accepted = isAcceptedFile(file);
  return {
    uploadId: uploadId || makeUploadId(),
    name: (file && file.name) || "file",
    sizeMB: file && file.size ? file.size / (1024 * 1024) : 0,
    file: file || null,
    status: accepted ? QUEUE_STATUS.PROCESSING : QUEUE_STATUS.REJECTED,
    error: accepted ? null : "This file is empty or couldn’t be read.",
    warn: null,    // non-fatal note on an otherwise-filed item (e.g. upload / Drive degraded)
    progress: null, // 0..1 upload progress while PROCESSING (B409 chunked uploads); null = not uploading yet
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

// ── Folder-aware drops (B664) ───────────────────────────────────────────────
// Dragging a FOLDER onto a drop zone does NOT populate dataTransfer.files — that
// list stays EMPTY. The browser instead exposes the folder as a directory ENTRY on
// each dropped DataTransferItem (item.webkitGetAsEntry()). To file a dropped project
// folder (often with nested discipline subfolders) we must walk that entry tree and
// collect every leaf File. Two steps by necessity: the DataTransferItemList is dead
// the moment the drop handler returns, so the ENTRIES are pulled out SYNCHRONOUSLY in
// the handler (dropItemsToEntries), then walked ASYNCHRONOUSLY (flattenEntries).

// Read a directory reader to exhaustion. readEntries hands back results in CHUNKS and
// signals "done" with an EMPTY batch — you must keep calling until it returns nothing,
// or a folder with many files silently loses everything past the first chunk.
function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (!batch || batch.length === 0) { resolve(all); return; }
        for (const e of batch) all.push(e);
        pump();
      }, reject);
    };
    pump();
  });
}

// Recursively flatten ONE FileSystemEntry into the File objects beneath it. A file
// entry yields its single File; a directory entry yields every leaf below it (any
// depth). Unknown entries yield nothing. Never throws — one unreadable entry resolves
// to [] rather than aborting the whole drop (LOUD-FAILURE: a bad file is skipped, not
// a silent total loss; the caller's per-file rows still account for what landed).
export async function entryToFiles(entry, prefix = "") {
  if (!entry) return [];
  try {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      if (!file) return [];
      // Stamp WHERE inside the dropped folder this file sat (B699 — structure-preserving
      // folder drops read it via fileRelDirs). Expando on the File; a host object that
      // refuses the write just degrades that file to the auto-file path, never an error.
      try { file.relPath = prefix + (file.name || entry.name || ""); } catch (_) { /* degrade */ }
      return [file];
    }
    if (entry.isDirectory) {
      const children = await readAllDirectoryEntries(entry.createReader());
      const dirPrefix = `${prefix}${entry.name || ""}/`;
      const nested = await Promise.all(children.map((c) => entryToFiles(c, dirPrefix)));
      return nested.flat();
    }
  } catch (_) { /* an unreadable entry contributes nothing instead of failing the drop */ }
  return [];
}

// Flatten a list of dropped entries (files and/or folders) into one flat File[].
export async function flattenEntries(entries) {
  const nested = await Promise.all([...(entries || [])].map((e) => entryToFiles(e)));
  return nested.flat();
}

/* The directory chain a picked/dropped file arrived under, ["dir", "subdir", ...] —
 * either capture path: an <input webkitdirectory> pick populates webkitRelativePath
 * natively; the entry-API drop walk above stamps relPath. Loose files → []. */
export function fileRelDirs(file) {
  const p = String((file && (file.relPath || file.webkitRelativePath)) || "");
  const parts = p.split("/").filter(Boolean);
  return parts.slice(0, -1);
}

// SYNC — pull the folder-aware entries out of a drop event's dataTransfer BEFORE any
// await (the item list is neutered once the handler returns). Returns:
//   entries      — the file/dir entries when the browser supports the entry API
//   files        — the plain flat file list (fallback for browsers without the API)
//   hasEntryApi  — did any item expose webkitGetAsEntry (walk `entries`, not `files`)
//   hasDirectory — was any dropped entry an actual FOLDER (drives the filter+summary)
export function dropItemsToEntries(dataTransfer) {
  const out = { entries: [], files: [], hasEntryApi: false, hasDirectory: false };
  if (!dataTransfer) return out;
  out.files = [...(dataTransfer.files || [])];
  const items = dataTransfer.items;
  for (const it of Array.from(items || [])) {
    if (it && it.kind && it.kind !== "file") continue; // skip dragged text/URLs
    const getEntry = it && (it.webkitGetAsEntry || it.getAsEntry);
    if (typeof getEntry !== "function") continue;
    out.hasEntryApi = true;
    let entry = null;
    try { entry = getEntry.call(it); } catch (_) { entry = null; }
    if (!entry) continue;
    out.entries.push(entry);
    if (entry.isDirectory) out.hasDirectory = true;
  }
  return out;
}

// Split a flat file list into the files we'll file and the OS/app junk we'll skip. Used for
// FOLDER drops/picks, where sweeping a real project folder drags along hidden dotfiles,
// thumbnail caches and lock files the user never meant to upload: we file every real file
// (of ANY type — B685) and report ONE honest "skipped N system files" summary instead of a
// row per stray. (Loose hand-picked files bypass this — the user chose exactly those.)
export function partitionAccepted(files) {
  const accepted = [], skipped = [];
  for (const f of [...(files || [])]) (isJunkFile(f) ? skipped : accepted).push(f);
  return { accepted, skipped };
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
