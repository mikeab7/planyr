/* Repair OCR'd deed text — pure, Node-testable, no DOM.
 *
 * Applies ONLY to text that came out of the OCR path (`deedOcr.js`); every other deed-text source
 * (paste, .docx, .doc, a real-text-layer PDF) is untouched, per the CLAUDE.md rule that OCR is a
 * fallback that never changes an existing path's behaviour. Tesseract reads real characters off a
 * degraded scan, but it reliably mangles the exact glyphs that carry a bearing's meaning — a survey
 * is nearly pure structural keywords (THENCE/COMMENCING/BEGINNING), punctuation (° ′ ″), and
 * quadrant letters (N/S/E/W), all of which OCR confuses with common look-alikes. This module fixes
 * the SAFE, high-confidence classes of that damage:
 *
 *   1. fixSurveyKeywords  — fuzzy-repairs THENCE / COMMENCING / BEGINNING (edit distance ≤ 2), the
 *      words deedParse.js's `coursesOf`/`parseTracts` split on. A single misread "THENGE" merges two
 *      courses into one blob neither can parse, so this is the single highest-value repair here.
 *   2. normalizeOcrPunctuation — smart quotes / angle quotes / a doubled straight quote / the
 *      registered-trademark and masculine-ordinal glyphs → the plain °, ′ (') and ″ (") deedParse.js
 *      already reads. Global and unconditional: none of these characters mean anything else in a
 *      legal description, so there is no false-positive case to weigh.
 *   3. fixQuadrantGlyphs — repairs "VV" → "W" and a stray "F" → "E" ONLY inside a bearing-shaped
 *      token (a quadrant letter, a DMS run, a second quadrant letter) — never as a blind global
 *      substitution, because both letters appear constantly in ordinary deed prose ("feet", "of",
 *      "record", …) where "fixing" them would corrupt the text instead of repairing it.
 *
 * What this module deliberately does NOT try to silently fix: S/5, B/8, O/0, l/1, Z/2 digit-letter
 * swaps inside a bearing's DEGREE value, and a lost decimal point in a distance ("150.00" → "15000").
 * Both would require guessing the TRUE value from a corrupted one with no independent check — exactly
 * the "confidently wrong boundary" the owner asked not to ship. Those are surfaced instead: low-OCR-
 * confidence tokens are highlighted in the editable textarea (`deedOcr.js` returns per-word
 * confidence) and `flagSuspectDistances` below marks a distance run that LOOKS like it lost a decimal
 * point, so a human eye and the plotted closure error (the real safety net) catch what this module
 * correctly declines to guess at.
 */

// Levenshtein edit distance, small strings only (survey keywords are ≤12 chars) — no need for a
// dependency for this.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,        // deletion
        prev[j - 1] + 1,    // insertion
        diag + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
      diag = tmp;
    }
  }
  return prev[n];
}

// Keywords `deedParse.js` splits/matches on. Distance budget scales a little with word length so
// "BEGINNING" (9 chars) tolerates a couple more mangled characters than "THENCE" (6) without ever
// getting loose enough to rewrite an unrelated word — a 4-char-min word within budget-1 of a
// 6-9 char keyword essentially never happens in running English prose.
const SURVEY_KEYWORDS = [
  { word: "THENCE", budget: 2 },
  { word: "COMMENCING", budget: 3 },
  { word: "BEGINNING", budget: 2 },
];

/** Fuzzy-repair mangled THENCE / COMMENCING / BEGINNING tokens (case-insensitive; canonical
 *  replacement is upper-case, matching how surveys conventionally set these words and how
 *  deedParse.js's own regexes are written). Returns { text, count }. */
export function fixSurveyKeywords(text) {
  if (!text) return { text: text || "", count: 0 };
  let count = 0;
  const out = text.replace(/\b[A-Za-z]{4,12}\b/g, (word) => {
    const upper = word.toUpperCase();
    for (const { word: kw, budget } of SURVEY_KEYWORDS) {
      if (upper === kw) return upper === word ? word : (count++, kw); // exact already — just canonicalize case
      if (Math.abs(word.length - kw.length) > budget) continue;
      if (editDistance(upper, kw) <= budget) { count++; return kw; }
    }
    return word;
  });
  return { text: out, count };
}

/** Normalize unicode punctuation OCR commonly substitutes for the ASCII degree/minute/second marks
 *  deedParse.js's BEARING_SRC reads. Unconditional — none of these glyphs carry another meaning in a
 *  legal description. Returns { text, count }. */
export function normalizeOcrPunctuation(text) {
  if (!text) return { text: text || "", count: 0 };
  let count = 0;
  const bump = (s) => { count++; return s; };
  let out = text
    // curly/smart single quotes + backtick → straight minutes mark
    .replace(/[‘’ʼ´`]/g, () => bump("'"))
    // two adjacent straight/curly single quotes, or curly/angle doubles → straight seconds mark
    .replace(/(?:''|[“”«»])/g, () => bump('"'))
    // registered-trademark / masculine-ordinal-indicator glyphs a degree sign is often misread as
    .replace(/[®º]/g, () => bump("°"));
  return { text: out, count };
}

// A DMS run with TWO degree signs — digits, °, digits, °, digits, then a seconds mark — is a
// misread MINUTES PRIME, not a second degree value: a central angle can't have two degree
// components. Measured on a real recorded deed (Chambers County correction SWD): "a central angle
// of 07°18°59"" where the true call was 07°18'59" — Tesseract read the minutes tick as a second
// degree glyph in exactly one call out of nineteen. The fix is unconditional on the SHAPE (a degree
// value can be 1-3 digits, so this pattern cannot arise from a genuine "X degrees Y minutes" run
// misread the other way) rather than needing bearing/curve context.
const DOUBLED_DEGREE = /([0-9]{1,3})\s*°\s*([0-9]{1,2})\s*°\s*([0-9]{1,2}(?:\.[0-9]+)?)\s*(["”″])/g;

/** Repair a doubled degree sign standing in for the minutes prime in a DMS run (see above). Returns
 *  { text, count }. */
export function fixDoubledDegreeSign(text) {
  if (!text) return { text: text || "", count: 0 };
  let count = 0;
  const out = text.replace(DOUBLED_DEGREE, (_, dd, mm, ss, sec) => { count++; return `${dd}°${mm}'${ss}${sec}`; });
  return { text: out, count };
}

/** Repair two more OCR-specific word-merge/substitution slips measured on the same real deed,
 *  neither of which touches a number: "to a" run together as "toa" (harmless to closure — the
 *  parser's leg-end sniff for "to" degrades gracefully to its plain-distance fallback either way,
 *  but a merged word is never intentional), and "arc" misread as "are" specifically in the
 *  "along the ___" idiom that's one of `isCurveCourse`'s two curve-detection signals (the OTHER
 *  signal, "radius of", is usually present too on a real curve call, but a deed that states a curve
 *  ONLY via "along the arc" — no explicit radius mention before it — would otherwise be silently
 *  read as a straight course). Scoped narrowly (a bare word boundary "toa", and "are" ONLY inside
 *  "along the ___" ) rather than a blind global substitution — "are" is an ordinary English word. */
export function fixWordMerges(text) {
  if (!text) return { text: text || "", count: 0 };
  let count = 0;
  const out = text
    .replace(/\btoa\b/gi, (m) => { count++; return m[0] === m[0].toUpperCase() ? "To a" : "to a"; })
    .replace(/\balong\s+the\s+are\b/gi, (m) => { count++; return m.replace(/are\b/i, "arc"); });
  return { text: out, count };
}

// A loose bearing-shaped token: a first quadrant letter (compact "N"/"S" or spelled "North"/
// "South" — deedParse.js reads both), a run of DMS-ish characters, a second-quadrant token — which
// is where "VV" ↔ "W" and "F" ↔ "E" get repaired. Deliberately permissive on the middle run (this
// only needs to bracket where the SECOND quadrant letter sits, not itself parse the bearing —
// deedParse.js's own BEARING_RE does the real parsing afterward).
const BEARING_TOKEN = /\b(N(?:orth)?|S(?:outh)?)\s*([0-9][0-9°ºo*:d\-'’′."″\s]{1,24}?)\s*(East|Fast|VVest|West|VV|F|E|W)\b/gi;

/** Repair quadrant-letter glyphs ONLY inside a bearing-shaped token — "VV" → "W" ("W"/"West" misread
 *  as "VV"/"VVest"), a stray "F" → "E" ("E"/"East" misread as "F"/"Fast") — never as a global
 *  substitution (both letters are common in ordinary deed prose: "feet", "found", "west county
 *  road", …). An already-correct second quadrant token is returned byte-for-byte, so nothing here
 *  can perturb text that didn't need fixing. Returns { text, count }. */
export function fixQuadrantGlyphs(text) {
  if (!text) return { text: text || "", count: 0 };
  let count = 0;
  const fixLetter = (q) => {
    const lower = q.toLowerCase();
    if (lower === "vv") { count++; return "W"; }
    if (lower === "vvest") { count++; return "West"; }
    if (lower === "f") { count++; return "E"; }
    if (lower === "fast") { count++; return "East"; }
    return q; // already E / East / W / West — leave verbatim, including case
  };
  const out = text.replace(BEARING_TOKEN, (m, q1, mid, q2) => {
    const fixed = fixLetter(q2);
    return fixed === q2 ? m : `${q1}${mid}${fixed}`;
  });
  return { text: out, count };
}

/** Best-effort SINGLE-WORD canonicalization — used only to re-locate a Tesseract word's per-word
 *  confidence inside the REPAIRED text when the word itself was one `repairOcrDeedText` rewrote
 *  (`ocrConfidence.js`'s span locator falls back to this when an exact search for the raw OCR word
 *  comes up empty). Standalone, no surrounding context, so it only recognizes a word that IS one of
 *  the known keywords/quadrant tokens outright — never guesses. Returns the canonical form, or null
 *  if `word` isn't a recognizable case of either repair class. */
export function canonicalizeOcrWord(word) {
  const w = String(word || "").trim();
  if (!w) return null;
  const upper = w.toUpperCase();
  for (const { word: kw, budget } of SURVEY_KEYWORDS) {
    if (Math.abs(w.length - kw.length) <= budget && editDistance(upper, kw) <= budget) return kw;
  }
  const lower = w.toLowerCase();
  if (lower === "vv") return "W";
  if (lower === "vvest") return "West";
  if (lower === "f") return "E";
  if (lower === "fast") return "East";
  return null;
}

/** Run every safe repair, in order (keywords first — punctuation/glyph fixes inside a course don't
 *  matter if the course boundary itself is unreadable). Returns { text, changes } where `changes` is
 *  a small object naming how many of each class fired, for the OCR review UI + tests. */
export function repairOcrDeedText(text) {
  const a = fixSurveyKeywords(text || "");
  const w = fixWordMerges(a.text);
  const b = normalizeOcrPunctuation(w.text);
  const d = fixDoubledDegreeSign(b.text);
  const c = fixQuadrantGlyphs(d.text);
  return {
    text: c.text,
    changes: {
      keywords: a.count, wordMerges: w.count, punctuation: b.count,
      doubledDegreeSign: d.count, quadrantGlyphs: c.count,
    },
  };
}

// A bare run of 4+ digits, immediately followed by a distance unit, with no decimal point anywhere
// in the run — the shape "150.00 feet" or "1773.49 feet" leaves when OCR drops the decimal point (a
// hairline stroke, the single easiest mark to lose on a low-contrast scan): "15000 feet" / "177349
// feet". Deliberately NOT auto-corrected (there is no way to know where the point belongs from the
// digits alone — "1773" could just as well be a genuine whole-number distance) — flagged instead, so
// the review step and the closure check are what catch it, per LOUD-FAILURE.
const SUSPECT_DIST = /\b([0-9]{4,})\s*(feet|foot|ft\.?|varas?|vrs?\.?|vr\.?)\b/gi;

/** Find distance-shaped digit runs that look like they lost a decimal point. Returns
 *  [{ index, length, raw }] in text order. Pure/Node-testable. */
export function flagSuspectDistances(text) {
  if (!text) return [];
  const out = [];
  let m;
  const re = new RegExp(SUSPECT_DIST.source, "gi");
  while ((m = re.exec(text))) out.push({ index: m.index, length: m[0].length, raw: m[0] });
  return out;
}
