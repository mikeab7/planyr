// Element-level sync, phase 5 (B674) — the "N here" presence summary, pure.
//
// Presence rides the SAME per-site realtime channel the element rows stream on (Supabase Realtime
// Presence: each connected client announces itself; the channel keeps a live roster). The pill
// shows only when another SESSION is here too — working alone in one window stays chrome-quiet.
//
// presenceState() shape (supabase-js): { [presenceKey]: [meta, meta, ...] } — one key per tracked
// identity (we key by uid), one meta per connected SESSION (window/tab/device) under that key.
//
// B674 recurrence (V231 #13) — the count is SESSIONS, not people: two windows of ONE account are
// two concurrent editors and must read "2 here" (the original people-count showed nothing, which
// hid the multi-writer state exactly when it mattered). Names still group by person, with a
// window count when one person has several sessions open.

// → null when this window is alone (≤1 session total), else { count, label, names } where
//   count = total connected sessions (self included), label = "N here", names = display names
//   for the hover title (self first as "You", "(k windows)" suffixed on multi-session entries).
export function presenceSummary(state, selfUid) {
  const entries = Object.entries(state || {});
  const total = entries.reduce((n, [, metas]) => n + Math.max(1, (metas || []).length), 0);
  if (total <= 1) return null; // just this window → no pill
  const names = [];
  let selfLabel = null;
  for (const [key, metas] of entries) {
    const m = (metas && metas[0]) || {};
    const k = Math.max(1, (metas || []).length);
    const windows = k > 1 ? ` (${k} windows)` : "";
    if (key === selfUid) selfLabel = `You${windows}`;
    else names.push((m.name || "Someone") + windows);
  }
  names.sort((a, b) => a.localeCompare(b));
  if (selfLabel) names.unshift(selfLabel);
  return { count: total, label: `${total} here`, names };
}
