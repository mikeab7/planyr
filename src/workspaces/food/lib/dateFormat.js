/* dateFormat — display-only date formatting for the place detail panel (NEW-2, owner: "a raw ISO
 * date '2026-08-18'... never a raw ISO string"). Every visit date is a Postgres `date` column,
 * serialized "YYYY-MM-DD" with no time/zone component — parsed as a LOCAL calendar date (not
 * `new Date("YYYY-MM-DD")`, which parses as UTC midnight and can print the WRONG DAY in a
 * negative-UTC-offset zone) via an explicit y/m/d constructor.
 *
 * No new dependency (no date-fns/dayjs) — the formats needed are small and fixed: "Aug 18,
 * 2026" / "Aug 18" (current year) / "Date unknown" (null), a short relative string ("4 days
 * ago"), and "Aug 2024" for a first-visit month/year.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" -> a local-midnight Date, or null for anything else (nullish, malformed). */
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/** "Aug 18, 2026", or "Aug 18" when dateStr falls in the year `now` is in (no need to repeat
 *  the current year), or "Date unknown" for a null/unparseable date. */
export function formatVisitDate(dateStr, now = new Date()) {
  const d = parseLocalDate(dateStr);
  if (!d) return "Date unknown";
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

/** "Aug 2024" — the first-visit summary in the score strip's facts line. Null for an
 *  unparseable/missing date (caller decides whether to render anything at all). */
export function formatMonthYear(dateStr) {
  const d = parseLocalDate(dateStr);
  return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : null;
}

/** "today" / "yesterday" / "N days/weeks/months/years ago". A future date (clock skew, or a
 *  date entered ahead of today) clamps to "today" rather than printing a nonsense negative
 *  count. Null for an unparseable/missing date. */
export function formatRelativeDate(dateStr, now = new Date()) {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.max(0, Math.round((startOfNow - d) / 86400000));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(diffDays / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
