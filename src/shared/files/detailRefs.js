/* Detail / section reference reader (B350) — the data behind Bluebeam-style "click a detail
 * callout → pull up that detail without leaving the sheet."
 *
 * PURE + browser-free: it takes the POSITIONED text of one page
 * ({ items:[{ str,x,y,w,h }], width, height } from doc-review/lib/pdf.js `extractPageItems`,
 * plus the reconstructed text LINES from sheetMeta) and returns:
 *   • detailRefs   — the callout BUBBLES that point at a detail elsewhere ("5 / A-3"),
 *                    with their position so the Stitcher can drop a clickable hotspot there.
 *   • detailAnchors — where a detail is DEFINED on a sheet ("DETAIL 5", "SECTION A-A"), so a
 *                    popup can center on the right spot of the referenced sheet.
 *
 * Conservative on purpose (the project's "never auto-guess" rule): a slash callout only counts
 * when the target looks like a real sheet code (has a letter prefix — so a plain fraction "1/2"
 * is ignored), and an anchor only counts when the word DETAIL/SECTION actually labels it. A
 * wrong hotspot that flings you to the wrong place is worse than a missing one.
 *
 * Unit-tested with hand-built item lists (no pdf.js), mirroring sheetMeta's DI test style.
 */

// A sheet code in a detail bubble: 1–3 letter prefix, 1–3 digit major, optional .minor, optional
// trailing letter — e.g. A-3, A301, C5, S2.1, A-3A. Must carry a letter so "5/3" can't match.
const SHEET_CODE = /^[A-Za-z]{1,3}-?\d{1,3}(?:\.\d{1,2})?[A-Za-z]?$/;
// A detail id: a 1–2 digit number or a single letter (a section letter). Bubbles read "5", "12", "A".
const DETAIL_ID = /^(?:\d{1,2}|[A-Za-z])$/;

const clean = (s) => (s || "").toString().trim();
// Normalize a sheet code for matching a callout target against a loaded sheet's number:
// strip everything but letters/digits and uppercase, so "A-3" === "A3" === "a 3".
export const normSheet = (s) => clean(s).toUpperCase().replace(/[^A-Z0-9.]/g, "");

const isDetailId = (s) => DETAIL_ID.test(clean(s));
const isSheetCode = (s) => SHEET_CODE.test(clean(s));

/* Detail-callout BUBBLES on the page. The classic CAD bubble stacks the detail id over the
 * sheet code with a divider line between (the line is graphic, so the two are separate text
 * runs at different y). We pair a detail-id item with a sheet-code item sitting directly below
 * it (same column, within ~2.4 line-heights). We ALSO read inline "5/A-3" and the keyword forms
 * ("SEE DETAIL 5 ON SHEET A-3") off the reconstructed lines. Returns
 *   [{ detail, sheet, raw, x, y }]   (x,y = bubble center, page units; sheet = normalized code)
 * deduped by (detail|sheet|cell). */
export function parseDetailRefs(items = [], lines = [], dims = {}) {
  const out = [];
  const seen = new Set();
  const push = (detail, sheet, raw, x, y) => {
    const d = clean(detail).toUpperCase(), s = normSheet(sheet);
    if (!d || !s) return;
    const key = `${d}|${s}|${Math.round(x / 12)}|${Math.round(y / 12)}`;
    if (seen.has(key)) return;
    seen.add(key);
    // `sheet` is normalized for matching a target sheet number; `sheetRaw` keeps the code as
    // printed (e.g. "A-3") for display in the popup title.
    out.push({ detail: d, sheet: s, sheetRaw: clean(sheet).toUpperCase() || s, raw: clean(raw) || `${d}/${s}`, x, y });
  };

  // 1) Stacked bubbles: pre-filter to the two small candidate sets, then pair (cheap, not O(n²)).
  const tops = items.filter((it) => it && isDetailId(it.str));
  const bots = items.filter((it) => it && isSheetCode(it.str));
  for (const top of tops) {
    const h = top.h || 8;
    const topCx = top.x + (top.w || 0) / 2;
    for (const bot of bots) {
      if (bot === top) continue;
      const dy = (bot.y || 0) - (top.y || 0);
      if (dy <= 0 || dy > 2.4 * Math.max(h, bot.h || 8)) continue; // below, within a couple lines
      const botCx = bot.x + (bot.w || 0) / 2;
      if (Math.abs(topCx - botCx) > Math.max(top.w || 0, bot.w || 0, 16)) continue; // same column
      push(top.str, bot.str, `${clean(top.str)}/${clean(bot.str)}`, (topCx + botCx) / 2, (top.y + bot.y) / 2 + h / 2);
    }
  }

  // 2) Inline forms on a single reconstructed line.
  const SHEET = "([A-Za-z]{1,3}-?\\d{1,3}(?:\\.\\d{1,2})?[A-Za-z]?)";
  const DET = "(\\d{1,2}|[A-Za-z])";
  const slash = new RegExp(`\\b${DET}\\s*/\\s*${SHEET}\\b`, "g");        // "5/A-3" (lettered target only)
  const kw = new RegExp(`\\b(?:detail|section|sect\\.?|sim\\.?|see)\\s+(?:detail\\s+|section\\s+)?${DET}\\s*(?:/|,?\\s*(?:on\\s+)?(?:sheet|sht|dwg|drawing)\\s*(?:no\\.?|#)?\\s*)${SHEET}\\b`, "gi");
  for (const ln of lines || []) {
    const t = ln.text || "";
    const cx = ln.x + ln.w / 2, cy = ln.y + ln.h / 2;
    let m;
    while ((m = kw.exec(t))) push(m[1], m[2], m[0], cx, cy);
    while ((m = slash.exec(t))) push(m[1], m[2], m[0], cx, cy);
  }
  return out.slice(0, 400); // safety cap — a sheet never has this many real callouts
}

/* Where details are DEFINED on this sheet. A detail/section is titled "DETAIL 5", "SECTION A-A",
 * "DETAIL NO. 12" — the word anchors it, which keeps this conservative. Returns
 *   [{ detail, raw, x, y }]   (x,y = title center, page units; detail uppercased)
 * Used only to CENTER a popup on the right spot — never to crop destructively, so a soft match is
 * safe (the popup stays pannable). Deduped by detail id. */
export function parseDetailAnchors(lines = [], dims = {}) {
  const out = [];
  const seen = new Set();
  const re = /\b(?:detail|section)\s+(?:no\.?\s*)?(\d{1,2}|[A-Za-z])(?:\s*[-–]\s*[A-Za-z0-9])?\b/i;
  for (const ln of lines || []) {
    const t = ln.text || "";
    const m = t.match(re);
    if (!m) continue;
    const d = clean(m[1]).toUpperCase();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push({ detail: d, raw: clean(m[0]), x: ln.x + ln.w / 2, y: ln.y + ln.h / 2 });
  }
  return out;
}
