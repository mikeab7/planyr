/* Locate Tesseract word-confidence data inside the (possibly repaired) OCR text — pure, Node-
 * testable. Tesseract reports confidence per RECOGNIZED word, not per character offset in a joined
 * string, so this reconstructs offsets by walking the words in reading order and searching forward
 * from a moving cursor (words never go backward on a page, so a monotonic cursor is exact for an
 * unmodified match and a safe approximation for a repaired one).
 *
 * Used for two things downstream: (1) `deedOcr.js`/the OCR review UI highlights a low-confidence
 * span so the user's eye goes straight to the character most likely wrong (CLAUDE.md item (e)),
 * rather than proofreading a whole page; (2) `culpritCallsFor` below is the closure safety net
 * (item (f)) — when a plotted traverse doesn't close, point at the specific COURSE whose text
 * overlaps the least-confident OCR, rather than just drawing a wrong polygon and saying nothing.
 */

/** Walk `words` (Tesseract's per-word `{text, confidence}` list, in reading order) and find each
 *  one's [start,end) span inside `text`. A word `repairOcrDeedText` rewrote (e.g. "THENGE" ->
 *  "THENCE") won't exact-match anymore; pass `lookupAlt(rawWord) -> canonicalOrNull` (see
 *  `deedOcrRepair.canonicalizeOcrWord`) to recover those too. A word that still can't be found
 *  (rare — e.g. it fell inside a multi-word quadrant-glyph fix) is skipped rather than mis-located,
 *  so a span is never wrong, only occasionally absent. Returns [{ start, end, confidence, text }],
 *  in the same order as `words`, offset by `baseOffset` (for concatenating several pages' spans into
 *  one full-text coordinate space). */
export function locateWordSpans(text, words, opts = {}) {
  const lookupAlt = opts.lookupAlt || (() => null);
  const baseOffset = opts.baseOffset || 0;
  let cursor = 0;
  const spans = [];
  for (const w of words || []) {
    const raw = String((w && w.text) || "").trim();
    if (!raw) continue;
    let matchStr = raw;
    let idx = text.indexOf(raw, cursor);
    if (idx < 0) {
      const alt = lookupAlt(raw);
      if (alt) { const i2 = text.indexOf(alt, cursor); if (i2 >= 0) { idx = i2; matchStr = alt; } }
    }
    if (idx < 0) continue;
    const end = idx + matchStr.length;
    spans.push({ start: baseOffset + idx, end: baseOffset + end, confidence: w.confidence, text: matchStr });
    cursor = end;
  }
  return spans;
}

/** Filter to spans below `threshold` (Tesseract confidence is 0-100; default 70 — a word Tesseract
 *  itself is materially unsure of). */
export function lowConfidenceSpans(spans, threshold = 70) {
  return (spans || []).filter((s) => typeof s.confidence === "number" && s.confidence < threshold);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// deedParse.js's `raw` is the literal source segment MINUS parenthetical offset notes (replaced
// with a space) and with whitespace collapsed — so it is close to, but not guaranteed to be, a
// byte-for-byte substring of mbText. Anchor on its first several WORD TOKENS (escaped) joined by a
// bounded "anything in between" gap, rather than the whole string verbatim — tolerant of the
// original's real whitespace/parenthetical content without needing to reconstruct it exactly.
function looseNeedleRegex(raw) {
  const tokens = String(raw || "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!tokens.length) return null;
  try { return new RegExp(tokens.map(escapeRe).join("[\\s\\S]{0,40}?"), "i"); } catch (_) { return null; }
}

/** Given the parsed calls (deedParse.js's `mkCall` output — each carries a trimmed `raw` course
 *  string) and the full mbText they were parsed from, locate each call's approximate span in mbText
 *  (sequential search, same monotonic-cursor idea as `locateWordSpans` — courses appear in the same
 *  order in the text as in `calls`) and report which ones overlap a low-confidence span or a suspect
 *  (decimal-point-lost) distance flag. This is the closure safety net: when a traverse doesn't
 *  close, these are the calls to check FIRST, rather than a bare "gap: N feet". Returns
 *  [{ call, index, suspect: boolean, minConfidence: number|null }] — only calls with something to
 *  flag — in call order; `index` is the call's position in the original `calls` array. */
export function culpritCalls(mbText, calls, lcSpans, suspectDistances) {
  const text = mbText || "";
  // Pass 1 — locate every call's start position, in order (a monotonic cursor is exact here:
  // courses appear in the same order in the text as in `calls`).
  let cursor = 0;
  const located = [];
  (calls || []).forEach((call, index) => {
    const re = looseNeedleRegex(call && call.raw);
    const m = re ? text.slice(cursor).match(re) : null;
    if (!m) { located.push(null); return; } // best-effort: un-locatable call is simply not correlated
    const idx = cursor + m.index;
    cursor = idx + m[0].length;
    located.push({ call, index, idx });
  });
  // Pass 2 — each located call's window runs to the NEXT located call's start (never past it, so
  // one course's OCR trouble can't spill onto its neighbour), or to the end of the text for the
  // last one.
  const out = [];
  located.forEach((loc, i) => {
    if (!loc) return;
    let windowEnd = text.length;
    for (let j = i + 1; j < located.length; j++) { if (located[j]) { windowEnd = located[j].idx; break; } }
    const overlapping = (lcSpans || []).filter((s) => s.start < windowEnd && s.end > loc.idx);
    const suspect = (suspectDistances || []).some((d) => d.index < windowEnd && d.index + d.length > loc.idx);
    const minConfidence = overlapping.length ? Math.min(...overlapping.map((s) => s.confidence)) : null;
    if (suspect || minConfidence != null) out.push({ call: loc.call, index: loc.index, suspect, minConfidence });
  });
  return out;
}
