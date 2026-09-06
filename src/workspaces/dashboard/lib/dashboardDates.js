/* dashboardDates — tiny shared date-formatting helpers for the Needs-attention and Pursuits
 * cards (B1161792/B1161793, NEW-1/NEW-2). Split out because both cards need to print a
 * plain-date field ("YYYY-MM-DD", as the Scheduler and the site model both store dates) as a
 * short label without a timezone-shift bug — `new Date("2026-09-10")` parses as UTC midnight,
 * which prints as the PREVIOUS day in any timezone west of UTC. Parsing the three numeric parts
 * and constructing a local `Date` avoids that entirely.
 */

/** "2026-09-10" → "Sep 10" (or null for anything unparseable/empty). */
export function formatShortDate(isoDate) {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whole calendar days from `nowMs` to `isoDate` (negative = in the past). Null when unparseable. */
export function daysUntil(isoDate, nowMs = Date.now()) {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate));
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  if (Number.isNaN(target)) return null;
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  return Math.round((target - startOfToday.getTime()) / 86400000);
}
