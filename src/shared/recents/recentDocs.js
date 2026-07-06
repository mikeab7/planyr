/* recentDocs — the "Recent" list on the Library Home: drawings recently OPENED in Review.
 *
 * Recency source is a local opened-list, deliberately NOT doc_reviews.updated_at — that
 * column moves on every autosave/edit, so it answers "recently changed", not "recently
 * opened". Per-device (same trade-off as pins, owner decision 2026-07-05), uid-keyed with
 * a "local" bucket signed-out.
 *
 * Entries: { id (doc_reviews row id), projectId, openedAt } — newest first, deduped by id,
 * capped so the list stays a quick-access shelf, not a history log.
 */

const keyFor = (uid) => `planyr:recentDocs:v1:${uid || "local"}`;
export const RECENTS_CAP = 15;

export function listRecents(uid) {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(keyFor(uid)) : null;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("not an array");
    return arr.filter((r) => r && typeof r.id === "string" && r.id)
      .map((r) => ({ id: r.id, projectId: typeof r.projectId === "string" && r.projectId ? r.projectId : null, openedAt: +r.openedAt || 0 }));
  } catch (_) {
    try { localStorage.removeItem(keyFor(uid)); } catch (_) { /* storage unavailable */ }
    return [];
  }
}

export function recordOpen(uid, { id, projectId }, now = Date.now()) {
  if (typeof id !== "string" || !id) return listRecents(uid);
  const list = [{ id, projectId: projectId || null, openedAt: now }, ...listRecents(uid).filter((r) => r.id !== id)].slice(0, RECENTS_CAP);
  try { localStorage.setItem(keyFor(uid), JSON.stringify(list)); } catch (_) { /* quota — recents are a convenience */ }
  return list;
}

export function removeRecent(uid, id) {
  const list = listRecents(uid).filter((r) => r.id !== id);
  try { localStorage.setItem(keyFor(uid), JSON.stringify(list)); } catch (_) { /* quota */ }
  return list;
}
