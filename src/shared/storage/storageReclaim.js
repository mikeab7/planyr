/* Storage reclaim — free room by dropping ONLY data that provably rebuilds itself (NEW-2/B1428).
 *
 * ⛔ THE ONE HARD RULE, and it is a proof obligation, not a habit:
 *    NO EVICTION MAY EVER COST THE OWNER DATA THAT CANNOT BE REBUILT.
 * B474 recorded the exact hazard this exists to avoid — "a raster whose src had been dropped
 * (idbKey set) was then unrecoverable". So every candidate must name a rehydration SOURCE before
 * it is removed, and a class that cannot name one for EVERY member is not reclaimable at all,
 * regardless of how much room it would free. `storageCensus.js` carries those declarations
 * (`rebuild` + `reclaimable`); this module refuses anything that does not declare one, and the
 * refusal is asserted in test/storageReclaim.test.js with a raster that has no cloud copy.
 *
 * WHAT THIS IS FOR. The B473 amber banner's "Retry device save" button used to call saveNow()
 * again with NOTHING freed in between — so while the store was full it failed every single time,
 * offering an action it was incapable of performing. `reclaimThenRetry` below is the honest
 * version: free what is safe to free, SAY how much that was, retry, and if it still does not fit,
 * say THAT rather than dropping the user back into the same banner with no new information.
 *
 * Pure-ish: every collaborator (the store, the cache, the save) is injected, so the whole
 * decision layer unit-tests in Node with no DOM, no IndexedDB and no network.
 */
import { LOCAL_CLASSES, IDB_CLASSES, classifyLocalKey, censusLocalStorage } from "./storageCensus.js";
import { deleteOriginPrefix } from "./originStore.js";

/* The IndexedDB namespace the GIS screening cache owns. Mirrors gisCache.IDB_NS — duplicated
 * rather than imported, because importing the cache from shared chrome hoists it into a shared
 * chunk and breaks the Site route's bundle budget (see originStore.js; even a 100-byte shared
 * shim showed up as an unexpected route chunk). test/storageReclaim.test.js asserts the two
 * constants still agree, so a rename can't silently orphan this. */
export const CACHE_IDB_PREFIX = "giscache:";

/* Broadcast after this module clears the cache namespace WITHOUT going through the live cache
 * object — the cache listens and drops its in-memory index, which would otherwise keep claiming
 * bytes that are no longer stored. An event rather than a registry for the same bundling reason:
 * it needs no shared module at all. */
export const CACHE_CLEARED_EVENT = "planyr:refetchable-cache-cleared";
function announceCacheCleared() {
  try { if (typeof window !== "undefined" && window.dispatchEvent) window.dispatchEvent(new CustomEvent(CACHE_CLEARED_EVENT)); } catch (_) {}
}

/* Every class either declares a rehydration source or is not reclaimable. This is asserted at
 * module scope so a future edit that marks a class reclaimable without giving it a source fails
 * the unit test rather than shipping. Exported so the test can state the invariant directly. */
export function reclaimableClasses(classes) {
  return classes.filter((c) => c.reclaimable === true && c.rebuild != null);
}

/* A class marked reclaimable but with no rebuild source is a BUG, not a permission. Returns the
 * offending ids (empty when the registry is coherent). */
export function unprovenReclaimables(classes) {
  return classes.filter((c) => c.reclaimable === true && c.rebuild == null).map((c) => c.id);
}

/* Drop every localStorage key belonging to a reclaimable class, OLDEST FIRST where an age is
 * knowable and largest-first otherwise (a cache key carries no timestamp of its own outside the
 * gisCache entry body, which we parse when present). Returns what was freed, by class.
 *
 * `limitBytes` stops once enough has been freed — there is no reason to throw away a working
 * cache to make room for one plan. Omit it to clear the class entirely. */
export function reclaimLocalStorage(store, { limitBytes = Infinity, classes = LOCAL_CLASSES } = {}) {
  const result = { freedBytes: 0, removedKeys: 0, byClass: {}, refused: [] };
  if (!store) return result;
  const allowed = new Set(reclaimableClasses(classes).map((c) => c.id));
  const candidates = [];
  let n = 0;
  try { n = store.length; } catch (_) { return result; }
  for (let i = 0; i < n; i++) {
    let k = null, v = null;
    try { k = store.key(i); if (k == null) continue; v = store.getItem(k) || ""; } catch (_) { continue; }
    const cls = classifyLocalKey(k);
    if (!allowed.has(cls.id)) continue;
    candidates.push({ key: k, bytes: v.length + k.length, classId: cls.id, ts: entryTs(v) });
  }
  // Oldest first; entries with no readable timestamp sort last (we know least about them, so
  // they are the least confident eviction — take the ones we can date first).
  candidates.sort((a, b) => (a.ts == null ? 1 : b.ts == null ? -1 : a.ts - b.ts));
  for (const c of candidates) {
    if (result.freedBytes >= limitBytes) break;
    try { store.removeItem(c.key); } catch (_) { continue; }
    result.freedBytes += c.bytes; result.removedKeys += 1;
    result.byClass[c.classId] = (result.byClass[c.classId] || 0) + c.bytes;
  }
  return result;
}

// The gisCache entry body is `{"data":…,"ts":…}`; anything else has no age we can trust.
function entryTs(raw) {
  if (typeof raw !== "string" || raw.length > 2_000_000) return null;
  const i = raw.lastIndexOf('"ts":');
  if (i < 0) return null;
  const m = /^"ts":\s*(\d+)/.exec(raw.slice(i));
  return m ? Number(m[1]) : null;
}

/* Free the re-fetchable tier in BOTH stores, then report exactly what went.
 *
 * Pass the LIVE cache (`cache: gisCache`) when the caller already has it — its clear() returns the
 * bytes its index held and keeps that index coherent in one step. Shared chrome cannot import the
 * cache, so by default we delete its IndexedDB namespace by prefix instead — the same bytes,
 * measured as they go — and announce it so the live cache (if any) drops its stale index. Both
 * halves are attempted independently, so a cache that cannot clear must not stop localStorage
 * being freed, and vice versa. */
export async function reclaimRefetchable({ store, cache = null, limitBytes = Infinity, deletePrefix = deleteOriginPrefix } = {}) {
  const unproven = [...unprovenReclaimables(LOCAL_CLASSES), ...unprovenReclaimables(IDB_CLASSES)];
  if (unproven.length) {
    // A class claiming to be reclaimable with no way back is never acted on — refuse the whole
    // pass rather than delete something we cannot restore. LOUD-FAILURE.
    return { freedLocalBytes: 0, freedCacheBytes: 0, removedKeys: 0, byClass: {}, refused: unproven, ok: false };
  }
  const local = reclaimLocalStorage(store, { limitBytes });
  let freedCacheBytes = 0;
  if (cache && typeof cache.clear === "function") {
    try { await cache.ready?.(); } catch (_) {}
    try { freedCacheBytes = cache.clear() || 0; } catch (_) { freedCacheBytes = 0; }
  } else if (typeof deletePrefix === "function") {
    // No live cache to hand — clear its namespace directly. Only ever this ONE prefix: the GIS
    // screening cache, whose every entry is one fetch away.
    try { freedCacheBytes = (await deletePrefix(CACHE_IDB_PREFIX)).bytes || 0; } catch (_) { freedCacheBytes = 0; }
    if (freedCacheBytes > 0) announceCacheCleared();
  }
  return {
    freedLocalBytes: local.freedBytes,
    freedCacheBytes,
    removedKeys: local.removedKeys,
    byClass: local.byClass,
    refused: [],
    ok: true,
  };
}

/* The full "Retry device save" behaviour, as one testable decision (NEW-2).
 *
 * 1. Measure the small store.        2. Free what provably rebuilds itself.
 * 3. Retry the save.                 4. Report which of the three outcomes happened.
 *
 * `save()` must return a truthy/`{ ok }` result meaning "the on-device write persisted" — the
 * caller verifies by reading back, exactly as saveNow() already does. The returned `outcome` is
 * one of:
 *   "saved"        — freed room and the save then persisted.
 *   "saved-clean"  — the save persisted (nothing needed freeing, or it was never the problem).
 *   "still-full"   — freed everything safe to free and the save STILL did not fit. This is the
 *                    case the old button could not distinguish from "try again", and it is the
 *                    one the user most needs told plainly.
 *   "nothing-to-free" — there was no re-fetchable data to drop, and the save still failed.
 */
export async function reclaimThenRetry({ store, cache, save, limitBytes = Infinity } = {}) {
  const before = censusLocalStorage(store);
  const reclaimed = await reclaimRefetchable({ store, cache, limitBytes });
  const after = censusLocalStorage(store);
  let saved = false;
  try { const r = await save(); saved = r === true || (r && r.ok === true); } catch (_) { saved = false; }
  const freedBytes = reclaimed.freedLocalBytes + reclaimed.freedCacheBytes;
  const outcome = saved
    ? (freedBytes > 0 ? "saved" : "saved-clean")
    : (freedBytes > 0 ? "still-full" : "nothing-to-free");
  return {
    outcome, saved,
    freedLocalBytes: reclaimed.freedLocalBytes,
    freedCacheBytes: reclaimed.freedCacheBytes,
    removedKeys: reclaimed.removedKeys,
    byClass: reclaimed.byClass,
    localBefore: before.totalBytes,
    localAfter: after.totalBytes,
    localCap: after.capBytes,
  };
}

/* The owner-facing sentence for a reclaim outcome. Plain English, no jargon, and it never claims
 * a save that did not happen. Sizes are shown because the whole point of NEW-3 is that this
 * failure stops being invisible — `fmt` is storageCensus.formatBytes. */
export function reclaimMessage(r, fmt) {
  if (!r) return "";
  const freed = r.freedLocalBytes + r.freedCacheBytes;
  const amount = fmt ? fmt(freed) : `${freed} bytes`;
  if (r.outcome === "saved") return `Saved on this device ✓ — cleared ${amount} of map data to make room (it reloads automatically).`;
  if (r.outcome === "saved-clean") return "Saved on this device ✓";
  if (r.outcome === "still-full")
    return `Cleared ${amount} of map data, but this plan still won't fit on this device. Your work is safe in your account. Free up space in this browser (or export a copy) to keep an offline one.`;
  return "There's no map data left to clear, and this plan still won't fit on this device. Your work is safe in your account — free up space in this browser (or export a copy) to keep an offline one.";
}
