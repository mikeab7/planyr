/* The on-device safety copy of a Library spreadsheet file's UNSAVED edits (NEW-1).
 *
 * The Library file is the one source of truth; this is not a second document. It exists for one
 * moment only: the seconds between a keystroke and the file's new version landing in the Library
 * (debounced upload), so a reload or a closed tab in that gap loses nothing — the same
 * write-through-then-cloud shape every other Spreadsheet save path here uses. It is deleted the
 * moment the save lands, and it records WHICH stored version it sits on top of (`baseSrcId`) so a
 * stale one can never be applied over a file that has since changed.
 *
 * TIER-BY-REBUILDABILITY: unsaved edits are irreplaceable user work, so they belong in the small
 * tier — and for exactly that reason a very large workbook is NOT mirrored here (it would crowd out
 * every other saved plan); it relies on the fast debounced upload instead.
 */
export const MAX_DRAFT_CHARS = 1_500_000;

const keyFor = (userId, fileId) => `planyr:model:fileDraft:v1:${userId || "local"}:${fileId}`;

export function readFileDraft(userId, fileId) {
  try {
    const raw = localStorage.getItem(keyFor(userId, fileId));
    const v = raw ? JSON.parse(raw) : null;
    return v && v.workbook && typeof v.baseSrcId === "string" ? v : null;
  } catch (_) { return null; }
}

/** Returns "written" | "skipped-large" | "failed". Never throws. */
export function writeFileDraft(userId, fileId, baseSrcId, workbook) {
  try {
    const json = JSON.stringify({ baseSrcId, savedAt: Date.now(), workbook });
    if (json.length > MAX_DRAFT_CHARS) { localStorage.removeItem(keyFor(userId, fileId)); return "skipped-large"; }
    localStorage.setItem(keyFor(userId, fileId), json);
    return "written";
  } catch (_) { return "failed"; }
}

export function clearFileDraft(userId, fileId) {
  try { localStorage.removeItem(keyFor(userId, fileId)); } catch (_) { /* nothing to clear */ }
}

/** A draft that can no longer be applied is moved aside, never deleted — the user's typing stays recoverable. */
export function setAsideFileDraft(userId, fileId) {
  try {
    const raw = localStorage.getItem(keyFor(userId, fileId));
    if (raw == null) return;
    localStorage.setItem(`${keyFor(userId, fileId)}:aside`, raw);
    localStorage.removeItem(keyFor(userId, fileId));
  } catch (_) { /* best effort */ }
}

/** PURE: what to do with a stored draft when the file is opened at stored version `openedSrcId`.
 *  "none" · "restore" (the draft sits on exactly this version — its edits never reached the Library) ·
 *  "stale" (the file moved on since — keep the file's version, set the draft aside, say so). */
export function decideDraft(draft, openedSrcId) {
  if (!draft) return "none";
  return draft.baseSrcId === openedSrcId ? "restore" : "stale";
}
