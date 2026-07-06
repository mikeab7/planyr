/* persistedSet — a tiny localStorage-backed Set-of-ids store, for remembering per-surface
 * UI state like "which tree folders are expanded" across reloads. Generic version of the
 * MapFinder `planarfit:sitesGroups:v1` collapse-map pattern so new surfaces stop hand-rolling it.
 *
 * Storage format: a JSON array of string ids. Corrupt or non-array payloads are treated as
 * "nothing stored" AND the bad key is cleared, so one garbled write can't wedge a surface
 * forever (LOUD in effect: state visibly resets to default rather than half-working).
 */

export function loadIdSet(key) {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("not an array");
    return new Set(arr.filter((x) => typeof x === "string"));
  } catch (_) {
    try { localStorage.removeItem(key); } catch (_) { /* storage unavailable */ }
    return new Set();
  }
}

export function saveIdSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch (_) { /* quota/unavailable — UI state only */ }
}

/* Drop ids that are no longer valid (e.g. deleted folders) so stale entries can't
 * accumulate in storage or silently re-expand a recreated id. */
export function pruneSet(set, validIds) {
  const out = new Set();
  for (const id of set) if (validIds.has(id)) out.add(id);
  return out;
}
