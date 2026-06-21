/* Lettered concept naming for new site plans (NEW-1/NEW-2 → B355).
 *
 * A site's plans default to "Concept A", "Concept B", … instead of "Plan 1",
 * "Plan 2". Pure + per-site: the caller passes the existing plan names within a
 * single site (group); the sequence resets per site (every site's first concept
 * is "Concept A"). Past Z it goes spreadsheet-style — AA, AB, … — so the 27th
 * concept never crashes or collides.
 *
 * The sequence continues PAST the highest existing letter rather than reusing a
 * gap: if "Concept B" exists but "Concept A" was deleted, the next is "Concept C"
 * — so a teammate's remembered name is never silently re-pointed at a new layout.
 *
 * This only sets the DEFAULT name; the label stays user-editable. Existing
 * "Plan N" names are left untouched (they don't parse as concepts, so a site that
 * already has "Plan 1" simply gets "Concept A" as its next new plan).
 */

// 1 → "A", 26 → "Z", 27 → "AA", 28 → "AB", 702 → "ZZ", 703 → "AAA".
// Bijective base-26 (spreadsheet column lettering): there is no "zero" digit.
export function numberToConcept(n) {
  let v = Math.floor(n);
  if (!(v >= 1)) return ""; // guard non-positive / NaN
  let s = "";
  while (v > 0) {
    const rem = (v - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}

// "A" → 1, "Z" → 26, "AA" → 27. Inverse of numberToConcept. Null for non-letters.
export function conceptLettersToNumber(letters) {
  if (typeof letters !== "string" || !/^[A-Za-z]+$/.test(letters)) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

// Parse "Concept AB" (case-insensitive, tolerant of extra inner spaces) → its
// 1-based index, else null. Anything that isn't exactly a concept label — incl.
// "Plan 1", "Concept A (copy)", "Concept 3" — returns null and is ignored.
export function parseConceptIndex(name) {
  if (typeof name !== "string") return null;
  const m = name.trim().match(/^concept\s+([a-z]+)$/i);
  return m ? conceptLettersToNumber(m[1]) : null;
}

// The next default concept name for a site, given the names already in use within
// that site. Continues one past the highest existing concept index; "Concept A"
// when no plan in the site is a concept yet.
export function nextConceptName(existingNames = []) {
  let max = 0;
  for (const name of existingNames) {
    const idx = parseConceptIndex(name);
    if (idx != null && idx > max) max = idx;
  }
  return `Concept ${numberToConcept(max + 1)}`;
}
