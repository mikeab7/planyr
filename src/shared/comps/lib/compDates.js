/* compDates — B986096-HARDENING-8 (owner rule, "change the date formatting to something people
 * would normally see"). ONE place that crosses between the ISO date this app ALWAYS stores
 * (comp_date, lease_commencement_date — never touched here) and the format a person actually
 * reads and types: mm/dd/yy, the same convention the Schedule task report already uses
 * (08/20/26, 06/15/26). A raw ISO string reaching the screen is the same class of defect the
 * food module's past-visit list had — display is a rendering concern, and this is the only
 * place it happens for a comp date.
 *
 * Parsing is deliberately liberal, because a broker's paste or a hand-typed edit never comes in
 * one spelling: ISO (2027-06-01), slash- or dash-numeric with a 2- or 4-digit year (6/1/27,
 * 06/01/2027, 6-1-27), or a month name in nearly any punctuation (June 1, 2027 / June 1 2027 /
 * Jun-1-27). Month-first, matching this app's existing PASTE-time date reader
 * (`compParse.js`'s `findDateToken`) — a 2-digit year pivots at 50 the same way that reader
 * already does, so a hand-typed date and a pasted one land on the same year for the same two
 * digits. Never guesses: a string that doesn't read as a date returns null rather than some
 * default, the same "refuse, don't guess" rule the rest of this parser family follows.
 */

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function fullYear(y) {
  if (y.length >= 4) return Number(y);
  const n = Number(y);
  return n > 50 ? 1900 + n : 2000 + n;
}

// Round-trips through a real Date to reject a calendar-impossible day (Feb 31, Apr 31, ...)
// rather than silently storing it.
function isoFrom(y, mo, d) {
  if (!Number.isFinite(y) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Whatever a person typed or pasted into a date cell -> the canonical ISO value, or null if it
 * doesn't read as a date at all — never a guessed/partial value. */
export function parseTypedDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoFrom(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return isoFrom(fullYear(m[3]), +m[1], +m[2]);

  m = s.match(/^([A-Za-z]+)\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2,4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return isoFrom(fullYear(m[3]), MONTHS[m[1].toLowerCase()], +m[2]);

  return null;
}

/** ISO -> mm/dd/yy, this app's own display convention (never the raw ISO string). Built from the
 * string parts, not `new Date(iso)` directly — a bare ISO date carries no time, so parsing it as
 * UTC and displaying in a behind-UTC local zone can print the wrong day (the same reason
 * `comps.js`'s `fmtCompDate` avoids it). Empty/unparseable input renders as "" — never a
 * fabricated date. */
export function formatDateDisplay(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return String(iso);
  const [, y, mo, d] = m;
  return `${mo.padStart(2, "0")}/${d.padStart(2, "0")}/${y.slice(-2)}`;
}
