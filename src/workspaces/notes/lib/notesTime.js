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

/** "Edited 5h ago" / "Edited just now" / "Edited 2 Jul 2025" / "" — the page header's one sentence.
 *
 * ⛔ THE "ago" GOES ONLY ON AN ELAPSED FORM, AND THIS FUNCTION USED TO SKIP THAT TEST (B421491).
 * `relativeTime` switches to a CALENDAR DATE past sixty days, so every note the owner has not
 * touched in two months rendered **"Edited 2 Jul 2025 ago"** at the top of the page. `stampLabel`
 * below has always had the guard, and its comment states the rule in as many words — the rule was
 * written down once and applied in one of the two places that needed it, which is the shape of
 * mistake a sweep exists to find. Invisible to every test in this module because every fixture in
 * it uses a recent timestamp; found by a harness whose fixture happened to carry an old one. */
export function editedLabel(ms, { now = Date.now() } = {}) {
  const rel = relativeTime(ms, { now });
  if (!rel) return "";
  if (rel === "just now") return "Edited just now";
  return /^\d+[mhdw]$/.test(rel) ? `Edited ${rel} ago` : `Edited ${rel}`;
}

/** A moment, as a version-history row says it: "just now" · "12m ago" · "2 Jul".
 *  The "ago" is added only to the ELAPSED forms — a calendar date does not take one, and
 *  "2 Jul ago" is exactly the sort of small wrongness that makes a list look unreliable. */
export function stampLabel(ms, { now = Date.now() } = {}) {
  const rel = relativeTime(ms, { now });
  if (!rel || rel === "just now") return rel || "";
  return /^\d+[mhdw]$/.test(rel) ? `${rel} ago` : rel;
}

/** How long a binned item has left. "" once it is due. */
export function daysLeft(expiresAt, { now = Date.now() } = {}) {
  if (!Number.isFinite(expiresAt)) return "";
  const d = Math.ceil((expiresAt - now) / DAY);
  if (d <= 0) return "due to be cleared";
  return d === 1 ? "1 day left" : `${d} days left`;
}
