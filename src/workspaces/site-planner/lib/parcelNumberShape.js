/* NEW-1 (Meriwether GA, 2026-11-24) — a LEAF (no imports) so the Map's search box can ask "is this typed text a parcel number?" without loading the county tables or the lookup
 * code (those load lazily, only when it is). Used by `viewParcelId.js` and `MapFinder.jsx`. */

/** Typed text that reads as a parcel number: only letters/digits and the separators a number carries (space - . / _), at most 3 letters in a row (so "Roosevelt" and "Main St" are
 *  words), a digit in every part, and either two or more parts or one long run (6+ digits — a house number is never that long, "023012" is a number). Pure. */
export function looksLikeParcelNumber(text) {
  const t = String(text ?? "").trim();
  if (!t || t.length > 28 || !/^[A-Za-z0-9][A-Za-z0-9 ._\-/]*$/.test(t)) return false;
  if (/[A-Za-z]{4,}/.test(t)) return false;                       // a word: an address or a place
  const parts = t.split(/[ ._\-/]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !/\d/.test(p))) return false; // "N Main" / "Main 5": a part with no digit is not a number's part
  if (parts.length >= 2) return true;
  return /^\d{6,}$/.test(parts[0]) || /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{4,}$/.test(parts[0]); // 023012, 069A009
}
