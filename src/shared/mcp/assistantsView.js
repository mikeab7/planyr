/* Settings → AI assistants: plain words for one connection row (pure, unit-tested). */

const DAY = 24 * 60 * 60 * 1000;

/** "today" / "yesterday" / "3 days ago" / "on Nov 2" — a calendar-day reading in the viewer's own time zone. */
export function dayWords(iso, now = new Date()) {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return null;
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(t)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return "on " + t.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(t.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** "used a few minutes ago" / "used 2 hours ago" / "used yesterday" / "not used yet". */
export function usedWords(iso, now = new Date()) {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return "not used yet";
  const ms = now.getTime() - t.getTime();
  if (ms < 2 * 60 * 1000) return "used just now";
  if (ms < 60 * 60 * 1000) return "used a few minutes ago";
  if (ms < 6 * 60 * 60 * 1000) return `used ${Math.max(1, Math.round(ms / (60 * 60 * 1000)))} hour${Math.round(ms / (60 * 60 * 1000)) === 1 ? "" : "s"} ago`;
  return "used " + dayWords(iso, now);
}

export function grantLine(g, now = new Date()) {
  return `Connected ${dayWords(g.created_at, now) || "recently"} · ${usedWords(g.last_used_at, now)}`;
}
