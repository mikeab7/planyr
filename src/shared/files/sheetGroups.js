/* Auto-group pages into logical sheets (B335) — the collapsed sheet list.
 *
 * PURE. Input: per-page metadata records (from sheetMeta.readSheetMeta, in page order).
 * Output: the LOGICAL sheet list — consecutive pages that share a plan type AND form a
 * contiguous sheet-number run collapse into one "group" (a stitched composite, e.g.
 * "Grading Plan · C-5–C-9 · 5 sheets"); everything else (cover, general notes, a lone
 * detail sheet) stays a standalone "single". This is what kills the per-page "add sheet"
 * step as the default (the page tray becomes ~13 logical entries from a 20-page set).
 *
 * Conservative on purpose: when the sheet number or plan type can't be read, the page stays
 * standalone rather than being force-merged — under-grouping is recoverable (add the sheet by
 * hand), a wrong merge is not. Mirrors the "never auto-guess" rule.
 */
const norm = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();

/* Parse a sheet code into { prefix, major, minor, ordinal }. "C5"→C/5, "C-2.01"→C/2/1,
 * "A7.10"→A/7/10. ordinal is a single comparable number so contiguity is one subtraction:
 * with a minor it's major*100+minor (so C-2.01→201), without it's the major (C5→5). */
export function parseSheetCode(s) {
  const m = (s || "").toString().trim().match(/^([A-Za-z]{0,3})[-\s.]?(\d{1,3})(?:\.(\d{1,3}))?/);
  if (!m) return null;
  const prefix = (m[1] || "").toUpperCase();
  const major = +m[2];
  const minor = m[3] != null ? +m[3] : null;
  const ordinal = minor != null ? major * 100 + minor : major;
  return { prefix, major, minor, ordinal, raw: (s || "").toString().trim() };
}

// Two codes are consecutive when they share a prefix and step by exactly 1 IN THE SAME NUMBERING
// LEVEL: plain majors (C-5→C-6) or sub-sheets within one major (C-2.01→C-2.02). Different prefixes,
// a gap, or a level/major change start a new logical sheet.
// B350 — base this on the parsed major/minor, NOT the packed `ordinal` (major*100+minor). The
// ordinal hack made codes consecutive ACROSS a major boundary (C-1.99 ordinal 199 → C-2.00 ordinal
// 200) and could even collide two different codes onto the same ordinal — both wrong merges. Plan
// sets don't run sub-sheet numbers past a major rollover, so compare the levels explicitly.
export function consecutiveCodes(a, b) {
  if (!a || !b || a.prefix !== b.prefix) return false;
  if (a.minor == null && b.minor == null) return b.major === a.major + 1;          // C-5 → C-6
  if (a.minor != null && b.minor != null && a.major === b.major) return b.minor === a.minor + 1; // C-2.01 → C-2.02
  return false; // mixed levels or a major rollover — don't chain
}

/* The grouping key — what makes two consecutive sheets "the same plan." Prefer the
 * deterministic discipline `item` (e.g. "Grading Plan", stable across the run); fall back to
 * the read sheet title; "" when neither is usable (→ never groups, stays standalone). */
export function groupKey(meta = {}) {
  const item = (meta.item || "").trim();
  const disc = (meta.discipline || "").trim();
  if (item && item.toLowerCase() !== "document") return ("type|" + disc + "|" + item).toLowerCase();
  const t = norm(meta.sheetTitle);
  return t ? "title|" + t : "";
}

// A clean human label for the logical sheet: the discipline item ("Grading Plan") when we
// have it, else the read title, else "Sheet".
function displayTitle(meta = {}) {
  const item = (meta.item || "").trim();
  if (item && item.toLowerCase() !== "document") return item;
  const t = (meta.sheetTitle || "").trim();
  return t || "Sheet";
}

function toLogical(run) {
  const pages = run.pages;
  const head = pages[0];
  const title = displayTitle(head);
  if (pages.length < 2) {
    const num = head.sheetNumber ? ` · ${head.sheetNumber}` : "";
    return { kind: "single", title, label: `${title}${num}`, discipline: head.discipline || "Other", pages, sheetRange: head.sheetNumber || "" };
  }
  const first = pages[0].sheetNumber, last = pages[pages.length - 1].sheetNumber;
  const range = first && last ? `${first}–${last}` : "";
  return {
    kind: "group", title,
    label: `${title} · ${range} · ${pages.length} sheets`,
    discipline: head.discipline || "Other",
    pages, sheetRange: range,
  };
}

/* A sheet number that repeats on an ADJACENT page is almost always a cross-reference misread —
 * a real plan set never prints the same sheet # on two pages in a row (B378). When the band-scoped
 * read can't isolate the number (a no-title-block notes sheet), the whole-page read can still grab
 * the same body cross-reference ("SEE DWG S202") on several sheets at once, producing identical
 * duplicate rows. Clear such numbers (and lower confidence) so each page falls back to a clean
 * "Sheet N" instead of showing the same wrong number repeatedly. Pure: returns a new array, with
 * fresh objects only for the pages it changed. */
export function markAdjacentDuplicateNumbers(pages = []) {
  const dup = new Array(pages.length).fill(false);
  const codeOf = (p) => (p && p.sheetNumber ? p.sheetNumber.toString().trim().toUpperCase() : "");
  for (let i = 1; i < pages.length; i++) {
    const a = codeOf(pages[i - 1]), b = codeOf(pages[i]);
    if (a && b && a === b) { dup[i - 1] = true; dup[i] = true; }
  }
  return pages.map((p, i) =>
    dup[i] ? { ...p, sheetNumber: "", confidence: Math.min(p.confidence ?? 0, 0.3), dupNumber: true } : p
  );
}

/* Collapse per-page metadata into the logical sheet list. `pages` = [{ sheetNumber, sheetTitle,
 * discipline, item, ... }] in page order (each typically carries a `pageNum`/`srcId` the caller
 * added so it can map a logical entry back to real pages). Returns
 *   [{ kind:'group'|'single', title, label, discipline, sheetRange, pages:[...] }]. */
export function groupSheets(pages = []) {
  const runs = [];
  let cur = null;
  for (const p of pages) {
    const key = groupKey(p);
    const code = parseSheetCode(p.sheetNumber);
    const chains = cur && key && key === cur.key && code && consecutiveCodes(cur.lastCode, code);
    if (chains) { cur.pages.push(p); cur.lastCode = code; }
    else { cur = { key, pages: [p], lastCode: code }; runs.push(cur); }
  }
  return runs.map(toLogical);
}
