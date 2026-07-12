/* Pending-edit journal (NEW-F4) — closes the last silent-overwrite window in element sync.
 *
 * The gap: an edit to an ALREADY-SYNCED element whose `commit_elements` call failed (8s RPC
 * timeout, transient error) lives only in the canvas + local mirror. Reload, and the
 * rows-canonical refetch (`refetchReplace`, B672) rebuilds the canvas from the server's OLDER
 * row — `foldNeverSyncedLocal` (B756) only protects elements with ZERO rows — and the autosave
 * then rewrites the mirror with the reverted data. The newer edit silently vanishes (it was
 * still recoverable from the version ring, but nothing said so).
 *
 * The fix: while the sync engine has pending/failed ops, their entries (with the shadow rev
 * each op targets — `baseRev`) are persisted here, keyed per site. After a reload, the refetch
 * folds journaled edits whose row hasn't advanced (`row.rev <= baseRev`) back over the rebuilt
 * canvas (foldJournal in elementRows.js) and the normal reconcile re-enqueues the commit. When
 * the engine drains to idle the journal is cleared — steady state writes nothing.
 *
 * Storage: localStorage (same durability class as the site mirror the edit already lives in),
 * one key per site, size-capped and age-capped so an abandoned journal can't grow stale or eat
 * quota. Quota-safe: a failed write degrades to "no journal" (the version ring remains the
 * recovery), never a throw. Single-writer per site is guaranteed by the existing editor lock.
 */

const KEY = (siteId) => `planyr:elements:pending:${siteId}`;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;   // a week-old journal is stale context, not a fix
const MAX_BYTES = 512 * 1024;              // cap: a journal is a handful of elements, not a site

// Persist the engine's pending entries (dirtyEntries() shape: { kind, id, cls, el, baseRev }).
// `at` = caller-supplied timestamp (Date.now at the call site — injected, not read here, to
// keep this module pure enough to unit test without clock hacks).
export function writeJournal(siteId, entries, at, storage = globalThis.localStorage) {
  if (!siteId || !storage) return false;
  try {
    if (!Array.isArray(entries) || entries.length === 0) { storage.removeItem(KEY(siteId)); return true; }
    const s = JSON.stringify({ at: at || 0, entries });
    // A write we can't make must also DROP any previous journal: a stale snapshot left behind
    // would later fold OLDER geometry over the user's newer edits (adversarial-review finding)
    // — no journal is strictly safer than a stale one (mirror + version ring still hold data).
    if (s.length > MAX_BYTES) { try { storage.removeItem(KEY(siteId)); } catch (_) {} return false; }
    storage.setItem(KEY(siteId), s);
    return true;
  } catch (_) {
    try { storage.removeItem(KEY(siteId)); } catch (_) {} // quota/privacy: never leave a stale journal
    return false;
  }
}

// Read a site's journal entries, or [] — an expired journal reads empty AND is removed.
export function readJournal(siteId, now, storage = globalThis.localStorage) {
  if (!siteId || !storage) return [];
  try {
    const s = storage.getItem(KEY(siteId));
    if (!s) return [];
    const j = JSON.parse(s);
    if (!j || !Array.isArray(j.entries)) return [];
    if (now != null && j.at != null && now - j.at > MAX_AGE_MS) { storage.removeItem(KEY(siteId)); return []; }
    return j.entries.filter((e) => e && typeof e.id === "string" && typeof e.kind === "string");
  } catch (_) { return []; }
}

export function clearJournal(siteId, storage = globalThis.localStorage) {
  if (!siteId || !storage) return;
  try { storage.removeItem(KEY(siteId)); } catch (_) { /* best-effort */ }
}
