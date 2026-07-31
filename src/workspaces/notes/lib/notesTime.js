/* notesTime — how a note's age is written, in one place (B1312).
 *
 * A page node now carries `createdAt` / `updatedAt`, and those numbers show up in three
 * places (the rail row, the page header, the printed sheet). One formatter means they can
 * never disagree about what "yesterday" means.
 *
 * TWO RULES.
 * 1. `null` IS A REAL ANSWER and it renders as NOTHING. Every page written before
 *    timestamps existed honestly has no time; inventing "just now" for it at upgrade would
 *    be a lie the rail then repeats forever, and sorting by recency would put the oldest
 *    notes on top. So an unknown time is silent, not guessed.
 * 2. The relative form is COARSE on purpose — "3d", not "3 days, 4 hours". The rail is a
 *    scanning surface; the exact moment lives in the hover title, which is where someone
 *    who actually needs it will look.
 */

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now" · "12m" · "5h" · "3d" · "6w" · "2 Jul" · "2 Jul 2025" — or "" when unknown. */
export function relativeTime(ms, { now = Date.now() } = {}) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = now - ms;
  if (d < 0) return "just now";              // a clock that ran backwards is not a future note
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  if (d < 60 * DAY) return `${Math.floor(d / (7 * DAY))}w`;
  try {
    const then = new Date(ms);
    const sameYear = then.getFullYear() === new Date(now).getFullYear();
    return then.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  } catch (_) { return ""; }
}

/** The full moment, for a hover title and the printed sheet. "" when unknown. */
export function absoluteStamp(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  try {
    return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); }
}

/** "Edited 5h ago" / "Edited just now" / "" — the one sentence the page header shows. */
export function editedLabel(ms, { now = Date.now() } = {}) {
  const rel = relativeTime(ms, { now });
  if (!rel) return "";
  return rel === "just now" ? "Edited just now" : `Edited ${rel} ago`;
}

/** How long a binned item has left. "" once it is due. */
export function daysLeft(expiresAt, { now = Date.now() } = {}) {
  if (!Number.isFinite(expiresAt)) return "";
  const d = Math.ceil((expiresAt - now) / DAY);
  if (d <= 0) return "due to be cleared";
  return d === 1 ? "1 day left" : `${d} days left`;
}
