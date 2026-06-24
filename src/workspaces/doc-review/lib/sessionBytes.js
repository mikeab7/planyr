/* sessionBytes — an in-memory, session-lifetime cache of the raw dropped File for a
 * Document Review source, keyed by srcId (B448).
 *
 * Why this exists: when you drop a PDF, its bytes start uploading to Drive/Supabase in the
 * background, and the source stays KEYLESS (no storageKey/driveKey) until that resolves. If you
 * switch files — or reload the viewer — before the upload lands, the backdrop can't be re-fetched
 * (there's no key yet), so the canvas went blank / showed the "re-drop" banner with orphaned
 * markups. Keeping the dropped File here means `fetchSourceBytes` can always re-open the backdrop
 * from memory regardless of upload state, for the rest of the session.
 *
 * Only a File (or Blob) is held — never a raw ArrayBuffer: pdf.js transfers a buffer to its worker
 * (detaching it), so a cached ArrayBuffer would be unreadable on the second open, whereas a File
 * re-reads cleanly every time.
 *
 * Module-scoped so it survives the lazy DocReview workspace unmounting/remounting (a tab switch
 * during an upload). Capped FIFO so a long session of large PDFs can't grow memory without bound.
 */

const CAP = 8;
const store = new Map();

// Cache the dropped bytes for a source. Re-setting an existing key refreshes its recency so the
// most-recently-used files survive eviction.
export function cacheSourceBytes(srcId, file) {
  if (!srcId || !file) return;
  if (store.has(srcId)) store.delete(srcId);
  store.set(srcId, file);
  while (store.size > CAP) store.delete(store.keys().next().value);
}

// The cached File/Blob for a source, or undefined if it isn't held (never dropped this session,
// or evicted). undefined → the caller falls back to Drive/Supabase.
export function getSourceBytes(srcId) {
  if (!srcId) return undefined;
  return store.get(srcId);
}

export function hasSourceBytes(srcId) {
  return !!srcId && store.has(srcId);
}

// Test/teardown only.
export function _clearSessionBytes() {
  store.clear();
}

export const SESSION_BYTES_CAP = CAP;
