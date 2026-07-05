/* Deterministic title-block parser (B312) — pure, no LLM, no tokens.
 *
 * The "good old-fashioned code" front-end to auto-filing (owner direction, 2026-06-20): for any
 * drawing that carries a real embedded text layer (most CAD-exported vector PDFs do), read the
 * filing fields straight off the text — FREE and instant, no Claude API call. The AI reader
 * (server/filing/) stays as a FALLBACK only for scanned/image-only sheets that have no text.
 *
 * This module is the pure heart: text string in → { date, discipline, item, sheetNumber, scale, … }
 * out. It does NOT touch pdf.js (that's localRead.js) so it's trivially unit-testable. Project
 * identification is matchProject.js's job (it searches the same text for the known projects).
 *
 * ONE reader (B360): the stated `scale` is now read in the SAME pass (shared/files/sheetScale.js),
 * so filing and Markup auto-calibration consume a single field bundle instead of two parallel
 * reads. The POSITIONAL superset (sheetMeta.readSheetMeta) layers sheet-title + match-line geometry
 * on top of this for grouping/stitching — it calls readTitleBlockText, never re-parses.
 *
 * Honesty: it only reports what it can actually read. A field it can't find is left empty/null (the
 * matcher then routes the file to the "needs filing" tray rather than guess).
 */
import { parseSheetScale } from "./sheetScale.js";

// Disciplines are the fixed library set (the canonical source — reviewStore re-exports THIS, so the
// reader's output vocabulary and the filing UI's folders can't drift). Owner order (2026-06-21):
// building disciplines first, then the site/due-diligence ones, Other last (the catch-all). Fire is
// split into Alarm vs. Sprinkler; Structural/Mechanical/Electrical/Plumbing get their own buckets
// (were lumped under "Other"/"MEP"). We never invent a new one; an unrecognized doc type gets a
// descriptive `item` under the best-fit discipline.
export const DISCIPLINES = [
  "Architectural", "Structural", "Civil", "Mechanical", "Electrical", "Plumbing",
  "Landscape", "Fire Alarm", "Fire Sprinkler", "Survey", "Environmental", "Geotech", "CAD", "Other",
];

/* Document-type rules. Each: [matcher over the (lowercased) sheet text, discipline, item, weight].
 * `item` is the human "what is this" label (middle of "<Project> - <Item> - YYYY.MM.DD"). `weight`
 * is how DEFINITIVE the keyword is for the discipline — the discipline with the highest weighted
 * count wins (see classifyDiscipline). A specific sheet-type ("floor plan", "foundation plan",
 * "grading plan") is strong (weight 4–5); a BARE discipline name ("structural", "architectural",
 * "civil") is weak (weight 1) because it's usually just a cross-reference printed on ANOTHER
 * discipline's sheet (B360 corpus: a Jacintoport ARCH set said "structural" 61× as cross-refs but
 * "floor plan" 22× — the floor-plan signal has to win; the inverse holds for the STRUCTURAL set).
 * ALTA is called out explicitly (owner example). */
const TYPE_RULES = [
  [/\balta\b|alta\s*\/?\s*nsps|alta\/acsm/, "Survey", "ALTA Survey", 5],
  [/\bboundary\s+survey\b/, "Survey", "Boundary Survey", 5],
  [/\btopograph(ic|y)\b|\btopo\s+survey\b/, "Survey", "Topographic Survey", 5],
  [/\btree\s+survey\b/, "Survey", "Tree Survey", 5],
  [/\bas[-\s]?built\b/, "Survey", "As-Built Survey", 4],
  [/\bfinal\s+plat\b|\bpreliminary\s+plat\b|\breplat\b|\bplat\b/, "Survey", "Plat", 4],
  [/\bmetes\s+and\s+bounds\b|\blegal\s+description\b/, "Survey", "Legal Description", 5],
  [/\bsurvey\b/, "Survey", "Survey", 2],
  [/\bgrading(\s+(and|&)\s+drainage)?\s+plan\b/, "Civil", "Grading Plan", 5],
  [/\bpaving\s+plan\b|\bpaving\b/, "Civil", "Paving Plan", 3],
  [/\b(storm|sanitary)\s+sewer\b|\bdrainage\s+plan\b|\butility\s+plan\b|\bwater\s+plan\b/, "Civil", "Utility Plan", 4],
  [/\bdimensional?\s+control\b|\bsite\s+plan\b|\boverall\s+site\b/, "Civil", "Site Plan", 3],
  [/\berosion\s+control\b|\bspcc\b|\bswppp\b/, "Civil", "Erosion Control", 4],
  [/\bgrading\b/, "Civil", "Grading Plan", 2],
  [/\bcivil\b/, "Civil", "Civil", 1],
  // Fire — split into alarm vs. sprinkler (owner taxonomy, 2026-06-21). "fire alarm" first; the
  // generic "fire protection"/"sprinkler"/"suppression" → Fire Sprinkler. (A combined "fire
  // protection & alarm" set reads as Fire Sprinkler — "fire alarm" isn't adjacent there.)
  [/\bfire\s+alarm\b/, "Fire Alarm", "Fire Alarm", 5],
  [/\bfire\s+(sprinkler|protection|suppression)\b|\bsprinkler\s+(plan|system)\b/, "Fire Sprinkler", "Fire Sprinkler", 5],
  // Structural / Mechanical / Electrical / Plumbing now have dedicated buckets (were "Other"/"MEP").
  // Definitive sheet-type ("foundation/framing plan") weighs heavy; the bare name weighs 1.
  [/\bfoundation\s+plan\b|\bframing\s+plan\b/, "Structural", "Structural", 5],
  [/\bstructural\b/, "Structural", "Structural", 1],
  [/\bmechanical\s+plan\b|\bhvac\b/, "Mechanical", "Mechanical", 4],
  [/\bmechanical\b/, "Mechanical", "Mechanical", 1],
  [/\belectrical\s+(plan|power|lighting)\b/, "Electrical", "Electrical", 4],
  [/\belectrical\b/, "Electrical", "Electrical", 1],
  [/\bplumbing\s+plan\b/, "Plumbing", "Plumbing", 4],
  [/\bplumbing\b/, "Plumbing", "Plumbing", 1],
  // NB: bare "elevation(s)" is NOT a keyword — it's an ambiguous word (a structural/civil sheet is
  // full of top-of-steel / spot elevations), which polluted the count (B360). Require a qualified
  // architectural elevation; the bare name "architectural" weighs 1 (cross-reference).
  [/\bfloor\s+plan\b|\broof\s+plan\b|\b(building|exterior|interior)\s+elevations?\b|\bbuilding\s+sections?\b|\breflected\s+ceiling\b/, "Architectural", "Architectural", 4],
  [/\barchitectural\b/, "Architectural", "Architectural", 1],
  [/\bland\s?scape\b|\bplanting\s+plan\b|\birrigation\b/, "Landscape", "Landscape Plan", 4],
  [/\bphase\s+(i|1|ii|2)\s+(environmental|esa)\b|\bwetland\b|\benvironmental\s+site\s+assessment\b|\btceq\b/, "Environmental", "Environmental", 5],
  [/\bgeotechnical\b|\bsoil\s+borings?\b|\bboring\s+logs?\b|\bgeotech\b/, "Geotech", "Geotechnical Report", 5],
];

// Sheet-number prefix → discipline, the tie-breaker when the text alone is ambiguous. Order
// matters: the Survey prefixes (SV/SU) are tested before bare S→Structural, and FA→Fire Alarm
// before FP/FS→Fire Sprinkler, so the more specific prefix wins.
const SHEET_PREFIX_DISC = [
  [/^(v|sv|su|bp)/i, "Survey"], [/^c/i, "Civil"], [/^a/i, "Architectural"],
  [/^s/i, "Structural"], [/^l/i, "Landscape"],
  [/^fa/i, "Fire Alarm"], [/^(fp|fs)/i, "Fire Sprinkler"],
  [/^m/i, "Mechanical"], [/^e/i, "Electrical"], [/^p/i, "Plumbing"], [/^g/i, "Geotech"],
];

/* The discipline implied by a sheet CODE's letter prefix (A-201 → Architectural, M-1 → Mechanical).
 * On a real set this is the engineer's OWN filing code — the single most reliable per-sheet
 * discipline signal — so the multi-discipline splitter (disciplineSplit.js) trusts it over a
 * keyword tally that a stray cross-reference can skew. Returns "" when the code has no recognized
 * alpha prefix (a bare number, or a prefix we don't map) — the caller then falls back to keywords.
 * Tested as the shared source feeding both the sheet-prefix tie-break here and the splitter. */
export function disciplineFromSheetNumber(sheetNumber) {
  const pre = (sheetNumber || "").toString().trim();
  if (!/^[A-Za-z]/.test(pre)) return ""; // must START with a letter (a bare "25" is not a code prefix)
  for (const [re, discipline] of SHEET_PREFIX_DISC) if (re.test(pre)) return discipline;
  return "";
}

const lc = (s) => (s || "").toString().toLowerCase();

// How many times a rule's keywords occur in the text (capped — we only need dominance, not exact).
function countMatches(text, re) {
  const g = re.global ? re : new RegExp(re.source, re.flags + "g");
  let n = 0; g.lastIndex = 0;
  while (g.exec(text)) { if (++n >= 500) break; }
  return n;
}

/* Classify the document's discipline + item from the sheet text (and its sheet number as a
 * tie-break). Returns { discipline, item }. Falls back to Other/Document — never a guess.
 *
 * WEIGHTED DOMINANCE, not first-rule (B360, corpus finding): score each discipline by Σ(keyword
 * count × rule weight) and let the discipline that actually dominates the sheet win — so a deep,
 * stray cross-reference can't steal the classification. A real Jacintoport STRUCTURAL set said
 * "structural" 71× but only "grading" 2× (the old first-rule logic filed it Civil because Civil was
 * listed first); a real ARCH set said "structural" 61× as cross-refs but "floor plan" 22× — the
 * definitive "floor plan" (weight 4) must beat the bare cross-reference "structural" (weight 1).
 * The item label comes from the most DEFINITIVE matched rule (highest weight, then earliest order). */
export function classifyDiscipline(text, sheetNumber = "") {
  const t = lc(text);
  const tally = new Map(); // discipline -> { score, weight, ruleIdx, item }
  for (let i = 0; i < TYPE_RULES.length; i++) {
    const [re, discipline, item, weight = 1] = TYPE_RULES[i];
    const n = countMatches(t, re);
    if (!n) continue;
    const cur = tally.get(discipline);
    if (!cur) tally.set(discipline, { score: n * weight, weight, ruleIdx: i, item });
    else {
      cur.score += n * weight;
      if (weight > cur.weight || (weight === cur.weight && i < cur.ruleIdx)) { cur.weight = weight; cur.ruleIdx = i; cur.item = item; }
    }
  }
  let best = null;
  for (const [discipline, v] of tally) {
    if (!best || v.score > best.score || (v.score === best.score && v.ruleIdx < best.ruleIdx)) {
      best = { discipline, item: v.item, score: v.score, ruleIdx: v.ruleIdx };
    }
  }
  if (best) return { discipline: best.discipline, item: best.item };
  // No keyword hit: lean on the sheet-number prefix if we have one, else Other.
  const pre = disciplineFromSheetNumber(sheetNumber);
  if (pre) return { discipline: pre, item: "Document" };
  return { discipline: "Other", item: "Document" };
}

/* ----------------------------- dates ------------------------------------- */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// B514: reject impossible calendar days (Feb 30, Apr 31, non-leap Feb 29) — a day<=31 cap for
// every month let a garbage date become the auto-named filing date. Real days-in-month + leap rule.
const valid = (y, m, d) => {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
};
const y4 = (y) => (y < 100 ? (y > 70 ? 1900 + y : 2000 + y) : y);

/* Every date we can find on the sheet, with its character offset, as { iso, index }. Drawings carry
 * several (drawn, checked, each revision); the issue/revision date is the one we want. Handles
 * 06/30/2025, 2025-06-30, 6.30.25, and "June 30, 2025". */
function findDatesPos(text) {
  const s = (text || "").toString();
  const out = [];
  let m;
  // Same-separator (\2 backreference) so a mixed-punctuation dimension can't masquerade as a date —
  // e.g. "5-29/32" (5 and 29/32") used to parse as 2032-05-29 and poison "latest date". (B360)
  const num = /\b(\d{1,2})([\/.\-])(\d{1,2})\2(\d{2,4})\b/g;             // MM/DD/YYYY or MM.DD.YY
  while ((m = num.exec(s))) { const mo = +m[1], d = +m[3], y = y4(+m[4]); if (valid(y, mo, d)) out.push({ iso: iso(y, mo, d), index: m.index }); }
  const ymd = /\b(\d{4})([\/.\-])(\d{1,2})\2(\d{1,2})\b/g;              // YYYY-MM-DD
  while ((m = ymd.exec(s))) { const y = +m[1], mo = +m[3], d = +m[4]; if (valid(y, mo, d)) out.push({ iso: iso(y, mo, d), index: m.index }); }
  const txt = /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;          // June 30, 2025
  while ((m = txt.exec(s))) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()], d = +m[2], y = +m[3]; if (mo && valid(y, mo, d)) out.push({ iso: iso(y, mo, d), index: m.index }); }
  const dtxt = /\b(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})\b/gi;           // 30 June 2025
  while ((m = dtxt.exec(s))) { const d = +m[1], mo = MONTHS[m[2].slice(0, 3).toLowerCase()], y = +m[3]; if (mo && valid(y, mo, d)) out.push({ iso: iso(y, mo, d), index: m.index }); }
  return out;
}

/* Every date we can find on the sheet, as unique ISO strings (first-seen order). */
export function findDates(text) {
  return [...new Set(findDatesPos(text).map((d) => d.iso))];
}

// Issue/revision keywords whose NEARBY date is the current issue/revision date. Deliberately
// EXCLUDES a bare "DATE" — in a title block "DATE: 04/07/2023" is usually the base/start date, the
// very one the owner was wrongly getting (B411b); only an issue/rev label promotes a date.
const ISSUE_LABEL = /\b(?:IFC|IFP|IFB|IFA|ISSUE[D]?|RE-?ISSUE[D]?|REVISION|REV)\b/gi;
// A title block / rev row reads label-then-date ("ISSUED FOR PERMIT: 09/17/2025"), so the date
// FOLLOWS the label — a generous forward window. A small backward tolerance still catches a tight
// columnar "09/17/2025 IFC" pair, while staying short enough that an unrelated notes date sitting
// before the label isn't wrongly promoted (B411b — a stray "SEE 11/30/2026 … REV" must not count).
const LABEL_FWD = 64, LABEL_BACK = 12;

/* The document's issue/revision date (ISO), or "" if none readable. Prefers a date that follows an
 * issue/revision label (IFC / ISSUED FOR … / REV) over a bare base date elsewhere on the sheet — so
 * "DATE 04/07/2023 … REV 2 ISSUED FOR PERMIT 09/17/2025" reads 2025-09-17, not the older base date
 * (B411b). Deliberately ignores a bare "DATE" label (that's usually the base/start date). Among
 * label-adjacent dates the LATEST wins (revisions climb). With no labeled date it falls back to the
 * newest date anywhere on the sheet (the prior behavior — no regression on single-date sheets). */
export function issueDate(text) {
  const dated = findDatesPos(text);
  if (!dated.length) return "";
  const s = (text || "").toString();
  const labels = [];
  let m; const re = new RegExp(ISSUE_LABEL.source, "gi");
  while ((m = re.exec(s))) labels.push(m.index);
  if (labels.length) {
    const near = dated.filter((d) => labels.some((k) => { const off = d.index - k; return off >= -LABEL_BACK && off <= LABEL_FWD; }));
    if (near.length) return near.map((d) => d.iso).sort().at(-1);
  }
  return dated.map((d) => d.iso).sort().at(-1);
}

// The newest date on the sheet, ISO, or "" if none readable. (Kept for callers that want pure
// recency; the filing read uses issueDate, which prefers an issue/rev-labeled date — B411b.)
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
  // The captured code must not actually be the start of a DATE or a page-count: in PDF content
  // order a "SHEET NUMBER" label is often followed by the plot timestamp ("SHEET NUMBER 6/23/2026"
  // read "6" as the sheet number — B659), and "SHEET 2 OF 44" is page numbering, not a sheet code.
  const labelled = s.match(/\b(?:sheet|sht|dwg|drawing)\s*(?:no\.?|number|#)?\s*:?\s*([A-Z]{0,3}-?\d{1,3}(?:\.\d{1,2})?[A-Z]?)\b(?!\s*[/:.]\d)(?!\s+of\s+\d)/i);
  if (labelled) return labelled[1].toUpperCase();
  return "";
}

/* ----------------------------- revision ---------------------------------- */
// Revision/issue label: "IFC", "IFP", "Rev 3", "Issued for Construction", etc. Empty if none.
export function parseRevision(text) {
  const s = (text || "").toString();
  const code = s.match(/\b(IFC|IFP|IFB|IFA)\b/i);                       // prefer the short canonical code
  if (code) return code[1].toUpperCase();
  // Map the spelled-out issue phrase → its canonical code. The owner often drops the "D"
  // ("ISSUE FOR CONSTRUCTION"), so accept "issue" or "issued". (B360)
  if (/\bissue[d]?\s+for\s+construction\b/i.test(s)) return "IFC";
  if (/\bissue[d]?\s+for\s+permit\b/i.test(s)) return "IFP";
  if (/\bissue[d]?\s+for\s+bid(?:ding)?\b/i.test(s)) return "IFB";
  if (/\bissue[d]?\s+for\s+approval\b/i.test(s)) return "IFA";
  if (/\bnot\s+for\s+construction\b/i.test(s)) return "NOT FOR CONSTRUCTION";
  // "Rev 3" / "REV: A" / "Revision 10". The rev-word is a WHOLE word (\b) followed by a real
  // separator, so the heading "REVISIONS" can't be read as "Rev S" (B360 — Mesa title blocks
  // print "SUBMITTALS / REVISIONS"), and the value must be a lone number/letter (\b) so
  // "revision label" isn't read as "Rev L".
  // B513: allow an optional NO./NUMBER/# label between the rev-word and the value — the very
  // common "REVISION NO. 3" / "REV. NO. 5" / "REVISION NUMBER 4" forms were dropping their value.
  // The rev-word keeps its \b (so the "REVISIONS" heading still can't read as "Rev S") and the
  // value keeps its trailing \b (so "revision label" can't read as "Rev L").
  const rev = s.match(/\b(?:revision|rev)\b\.?[\s.:#-]*(?:no\.?|number|#)?[\s.:#-]*([0-9]{1,2}|[A-Z])\b/i);
  return rev ? `Rev ${rev[1]}`.toUpperCase() : "";
}

/* Read the deterministic filing fields off the sheet text. `hasText` is false for an empty/
 * scanned page (the caller's cue to fall back to the AI reader). `scale` is the stated-scale
 * read (B267, shared/files/sheetScale.js): { ftPerInch, form, label } | { explicit:'nts' } |
 * null — null when the page has no parseable scale. Project identification is NOT here —
 * matchProject.js searches the same text for the named projects. */
export function readTitleBlockText(text) {
  const hasText = !!(text && text.replace(/\s+/g, "").length > 30);
  const sheetNumber = hasText ? parseSheetNumber(text) : "";
  const { discipline, item } = hasText ? classifyDiscipline(text, sheetNumber) : { discipline: "Other", item: "Document" };
  return {
    hasText,
    date: hasText ? issueDate(text) : "",
    discipline, item,
    sheetNumber,
    revision: hasText ? parseRevision(text) : "",
    scale: hasText ? parseSheetScale(text) : null,
  };
}
