/* Deterministic title-block parser (B312) — pure, no LLM, no tokens.
 *
 * The "good old-fashioned code" front-end to auto-filing (owner direction, 2026-06-20): for any
 * drawing that carries a real embedded text layer (most CAD-exported vector PDFs do), read the
 * filing fields straight off the text — FREE and instant, no Claude API call. The AI reader
 * (server/filing/) stays as a FALLBACK only for scanned/image-only sheets that have no text.
 *
 * This module is the pure heart: text string in → { date, discipline, item, sheetNumber, … }
 * out. It does NOT touch pdf.js (that's localRead.js) so it's trivially unit-testable. Project
 * identification is matchProject.js's job (it searches the same text for the known projects).
 *
 * Honesty: it only reports what it can actually read. A field it can't find is left empty (the
 * matcher then routes the file to the "needs filing" tray rather than guess).
 */

// Disciplines are the fixed library set (mirrors reviewStore.DISCIPLINES). We never invent a
// new one; an unrecognized doc type gets a descriptive `item` under the best-fit discipline.
export const DISCIPLINES = ["Survey", "Civil", "Architectural", "Landscape", "Environmental", "CAD", "Geotech", "Other"];

/* Document-type rules, most specific first. Each: a matcher over the (lowercased) sheet text →
 * { discipline, item }. `item` is the human "what is this" label that becomes the middle of
 * "<Project> - <Item> - YYYY.MM.DD". ALTA is called out explicitly (owner example). */
const TYPE_RULES = [
  [/\balta\b|alta\s*\/?\s*nsps|alta\/acsm/, "Survey", "ALTA Survey"],
  [/\bboundary\s+survey\b/, "Survey", "Boundary Survey"],
  [/\btopograph(ic|y)\b|\btopo\s+survey\b/, "Survey", "Topographic Survey"],
  [/\btree\s+survey\b/, "Survey", "Tree Survey"],
  [/\bas[-\s]?built\b/, "Survey", "As-Built Survey"],
  [/\bfinal\s+plat\b|\bpreliminary\s+plat\b|\breplat\b|\bplat\b/, "Survey", "Plat"],
  [/\bmetes\s+and\s+bounds\b|\blegal\s+description\b/, "Survey", "Legal Description"],
  [/\bsurvey\b/, "Survey", "Survey"],
  [/\bgrading(\s+(and|&)\s+drainage)?\s+plan\b|\bgrading\b/, "Civil", "Grading Plan"],
  [/\bpaving\b/, "Civil", "Paving Plan"],
  [/\b(storm|sanitary)\s+sewer\b|\bdrainage\s+plan\b|\butility\s+plan\b|\bwater\s+plan\b/, "Civil", "Utility Plan"],
  [/\bdimensional?\s+control\b|\bsite\s+plan\b|\boverall\s+site\b/, "Civil", "Site Plan"],
  [/\berosion\s+control\b|\bspcc\b|\bswppp\b/, "Civil", "Erosion Control"],
  [/\bcivil\b/, "Civil", "Civil"],
  [/\bfire\s+(sprinkler|protection)\b|\bsprinkler\s+plan\b/, "Other", "Fire Sprinkler"],
  [/\bmechanical\b|\belectrical\b|\bplumbing\b|\bm\.?e\.?p\.?\b/, "Other", "MEP"],
  [/\bfloor\s+plan\b|\broof\s+plan\b|\belevations?\b|\bbuilding\s+sections?\b|\barchitectural\b/, "Architectural", "Architectural"],
  [/\bland\s?scape\b|\bplanting\s+plan\b|\birrigation\b/, "Landscape", "Landscape Plan"],
  [/\bphase\s+(i|1|ii|2)\s+(environmental|esa)\b|\bwetland\b|\benvironmental\s+site\s+assessment\b|\btceq\b/, "Environmental", "Environmental"],
  [/\bgeotechnical\b|\bsoil\s+borings?\b|\bboring\s+logs?\b|\bgeotech\b/, "Geotech", "Geotechnical Report"],
];

// Sheet-number prefix → discipline, the tie-breaker when the text alone is ambiguous.
const SHEET_PREFIX_DISC = [
  [/^(v|sv|su|bp)/i, "Survey"], [/^c/i, "Civil"], [/^a/i, "Architectural"],
  [/^l/i, "Landscape"], [/^(fp|m|e|p)/i, "Other"], [/^g/i, "Geotech"],
];

const lc = (s) => (s || "").toString().toLowerCase();

/* Classify the document's discipline + item from the sheet text (and its sheet number as a
 * tie-break). Returns { discipline, item }. Falls back to Other/Document — never a guess. */
export function classifyDiscipline(text, sheetNumber = "") {
  const t = lc(text);
  for (const [re, discipline, item] of TYPE_RULES) if (re.test(t)) return { discipline, item };
  // No keyword hit: lean on the sheet-number prefix if we have one, else Other.
  const pre = (sheetNumber || "").trim();
  for (const [re, discipline] of SHEET_PREFIX_DISC) if (re.test(pre)) return { discipline, item: "Document" };
  return { discipline: "Other", item: "Document" };
}

/* ----------------------------- dates ------------------------------------- */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y, m, d) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
const y4 = (y) => (y < 100 ? (y > 70 ? 1900 + y : 2000 + y) : y);

/* Every date we can find on the sheet, as ISO strings. Drawings carry several (drawn, checked,
 * each revision); the latest is the issue/revision date — exactly the owner's "search all dates
 * and date itself". Handles 06/30/2025, 2025-06-30, 6.30.25, and "June 30, 2025". */
export function findDates(text) {
  const s = (text || "").toString();
  const out = [];
  let m;
  const num = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;          // MM/DD/YYYY or MM.DD.YY
  while ((m = num.exec(s))) { const mo = +m[1], d = +m[2], y = y4(+m[3]); if (valid(y, mo, d)) out.push(iso(y, mo, d)); }
  const ymd = /\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g;            // YYYY-MM-DD
  while ((m = ymd.exec(s))) { const y = +m[1], mo = +m[2], d = +m[3]; if (valid(y, mo, d)) out.push(iso(y, mo, d)); }
  const txt = /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;          // June 30, 2025
  while ((m = txt.exec(s))) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()], d = +m[2], y = +m[3]; if (mo && valid(y, mo, d)) out.push(iso(y, mo, d)); }
  const dtxt = /\b(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})\b/gi;           // 30 June 2025
  while ((m = dtxt.exec(s))) { const d = +m[1], mo = MONTHS[m[2].slice(0, 3).toLowerCase()], y = +m[3]; if (mo && valid(y, mo, d)) out.push(iso(y, mo, d)); }
  return [...new Set(out)];
}

// The newest date on the sheet (the issue/revision date), ISO, or "" if none readable.
export function latestDate(text) {
  const all = findDates(text);
  if (!all.length) return "";
  return all.sort().at(-1);
}

/* ----------------------------- sheet number ------------------------------ */
/* A conservative sheet-id read: prefer a token right after a "SHEET/SHT/DWG NO." label (the
 * authoritative spot); else a single clean alphanumeric sheet code (C-2.01 / A7.10 / V1). Kept
 * cautious because a page is full of grid refs ("A195") that look like sheet numbers — when in
 * doubt we return "" and let the sheet stay generically labeled (never fabricate). */
export function parseSheetNumber(text) {
  const s = (text || "").toString();
  // B350 — accept a 3-digit major (C-100, A101) to match parseSheetCode (sheetGroups) and the
  // match-line SHEET_REF (sheetMeta). The cap was \d{1,2}, so a set numbered past 99 read its
  // sheet number as "" — and a sheet with no number can't be grouped OR auto-stitched (its
  // match-line neighbors never find it in the byNumber index). Still LABEL-anchored ("SHEET NO."),
  // so a 3-digit grid ref like "A195" without that label is still ignored (stays conservative).
  const labelled = s.match(/\b(?:sheet|sht|dwg|drawing)\s*(?:no\.?|number|#)?\s*:?\s*([A-Z]{0,3}-?\d{1,3}(?:\.\d{1,2})?[A-Z]?)\b/i);
  if (labelled) return labelled[1].toUpperCase();
  return "";
}

/* ----------------------------- revision ---------------------------------- */
// Revision/issue label: "IFC", "IFP", "Rev 3", "Issued for Construction", etc. Empty if none.
export function parseRevision(text) {
  const s = (text || "").toString();
  const code = s.match(/\b(IFC|IFP|IFB|IFA)\b/i);                       // prefer the short canonical code
  if (code) return code[1].toUpperCase();
  const phrase = s.match(/\b(NOT FOR CONSTRUCTION|ISSUED FOR [A-Z]+)\b/i);
  if (phrase) return phrase[1].toUpperCase().replace(/\s+/g, " ").trim();
  const rev = s.match(/\brev(?:ision)?\.?\s*[:#]?\s*([0-9]{1,2}|[A-Z])\b/i);
  return rev ? `Rev ${rev[1]}`.toUpperCase() : "";
}

/* Read the deterministic filing fields off the sheet text. `hasText` is false for an empty/
 * scanned page (the caller's cue to fall back to the AI reader). Project identification is NOT
 * here — matchProject.js searches the same text for the named projects. */
export function readTitleBlockText(text) {
  const hasText = !!(text && text.replace(/\s+/g, "").length > 30);
  const sheetNumber = hasText ? parseSheetNumber(text) : "";
  const { discipline, item } = hasText ? classifyDiscipline(text, sheetNumber) : { discipline: "Other", item: "Document" };
  return {
    hasText,
    date: hasText ? latestDate(text) : "",
    discipline, item,
    sheetNumber,
    revision: hasText ? parseRevision(text) : "",
  };
}
