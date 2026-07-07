// Element-level sync, phase 5 (B674) — the "N here" presence summary, pure.
//
// Presence rides the SAME per-site realtime channel the element rows stream on (Supabase Realtime
// Presence: each connected client announces itself; the channel keeps a live roster). The pill
// shows only when someone ELSE is here too — working alone stays chrome-quiet.
//
// presenceState() shape (supabase-js): { [presenceKey]: [meta, meta, ...] } — one key per tracked
// identity (we key by uid, so two windows of one account collapse into one PERSON with two metas).

// → null when alone (or empty), else { count, label, names } where count = distinct PEOPLE here
//   (self included), label = "N here", names = display names for the hover title (self first as
//   "You", with a window count when self has several).
export function presenceSummary(state, selfUid) {
  const entries = Object.entries(state || {});
  if (entries.length <= 1) return null; // alone (or just self) → no pill
  const names = [];
  let selfLabel = null;
  for (const [key, metas] of entries) {
    const m = (metas && metas[0]) || {};
    const name = m.name || "Someone";
    if (key === selfUid) selfLabel = (metas && metas.length > 1) ? `You (${metas.length} windows)` : "You";
    else names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));
  if (selfLabel) names.unshift(selfLabel);
  return { count: entries.length, label: `${entries.length} here`, names };
}
