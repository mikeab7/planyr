/* Multi-discipline split (owner request, 2026-06-23) — "if a drawing has multiple disciplines
 * in it, figure out how to split it up properly."
 *
 * PURE + browser-free. Input: per-page metadata records (from titleBlockParse.readTitleBlockText
 * or sheetMeta.readSheetMeta, each with a `pageNum`), in page order. Output: the discipline
 * SEGMENTS (contiguous page runs that belong to one discipline) and, merged by discipline, the
 * filing SETS — so a combined PDF (a "make-ready" package, or a full IFC with C-/A-/S-/M-/E-/P-
 * sheets bound together) files into the right discipline folders instead of being stamped with the
 * single discipline its first page happened to show.
 *
 * Two reliability moves the real-file corpus forced (Drive test, 2026-06-23):
 *  1. PREFIX-FIRST per-page discipline. A sheet CODE's letter prefix (A-201 → Architectural,
 *     M-1 → Mechanical) is the engineer's own filing code — far more reliable than a keyword tally
 *     a stray cross-reference skews. The Jacintoport make-ready's page 10 ("A5.00") read as
 *     Structural from cross-refs; its own code says Architectural. The prefix wins.
 *  2. STICKY smoothing. A cover / general-notes / unreadable page (no code, no clear keyword) does
 *     NOT start a new discipline — it joins the surrounding block; and a lone page whose discipline
 *     differs from two agreeing neighbors (a cross-ref misread) is pulled back to them. Conservative
 *     by design: under-splitting is recoverable, a wrong split is the misfile we must avoid.
 *
 * The single-discipline answer is a MAJORITY vote (`dominant`), which also fixes the old "read the
 * first 2 pages → label the whole file" misfile (a Mechanical set whose cover referenced the
 * architect filed as Architectural).
 */
import { disciplineFromSheetNumber } from "./titleBlockParse.js";

const UNKNOWN = ""; // a page we can't confidently place — sticky (absorbed by its neighbors)

/* The discipline of ONE page, prefix-first. Returns a discipline name, or UNKNOWN ("") when the
 * page carries neither a recognized sheet-code prefix nor a confident keyword discipline. */
export function resolvePageDiscipline(page = {}) {
  const byCode = disciplineFromSheetNumber(page.sheetNumber);
  if (byCode) return byCode; // the engineer's own sheet code — authoritative
  const kw = (page.discipline || "").trim();
  if (page.hasText !== false && kw && kw !== "Other") return kw;
  return UNKNOWN;
}

// Does this page carry its OWN authoritative discipline code? (Such a page is never overridden by
// the lone-page smoothing — its code is ground truth even if it sits between two other disciplines.)
const hasOwnCode = (page) => !!disciplineFromSheetNumber(page && page.sheetNumber);

/* Smooth the per-page disciplines so covers / notes / unreadable pages don't fragment the split.
 *  - Carry-forward: an UNKNOWN page inherits the previous placed discipline (or the next, at the
 *    head of the file) — a cover/notes/scanned page joins the block it sits in.
 *  - Lone-page denoise: a single page flanked by two pages that AGREE with each other, and that has
 *    no own sheet code, is pulled to the neighbors' discipline (a stray cross-ref misread).
 * Returns a new array of discipline strings aligned to `pages`. */
export function smoothDisciplines(pages, raw) {
  const d = raw.slice();
  // Carry-forward (then fill any leading UNKNOWNs from the first known, backward).
  let last = UNKNOWN;
  for (let i = 0; i < d.length; i++) { if (d[i] === UNKNOWN) d[i] = last; else last = d[i]; }
  let next = UNKNOWN;
  for (let i = d.length - 1; i >= 0; i--) { if (d[i] === UNKNOWN) d[i] = next; else next = d[i]; }
  // Lone-page denoise (one pass) — only for a page without its own authoritative code.
  for (let i = 1; i < d.length - 1; i++) {
    if (d[i] && d[i] !== d[i - 1] && d[i - 1] === d[i + 1] && !hasOwnCode(pages[i])) d[i] = d[i - 1];
  }
  return d;
}

// The most representative item label for a run (most frequent non-generic item, else the discipline).
function dominantItem(run, discipline) {
  const tally = new Map();
  for (const p of run) {
    const it = (p.item || "").trim();
    if (!it || it.toLowerCase() === "document") continue;
    tally.set(it, (tally.get(it) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [it, n] of tally) if (n > bestN) { best = it; bestN = n; }
  return best || discipline;
}

// First→last readable sheet code across a run, as "C-5–C-9" (or "" when none readable).
function sheetRangeOf(run) {
  const codes = run.map((p) => (p.sheetNumber || "").toString().trim()).filter(Boolean);
  if (!codes.length) return "";
  return codes.length === 1 ? codes[0] : `${codes[0]}–${codes[codes.length - 1]}`;
}

/* Split a multi-page file into discipline segments + sets.
 * `pages` = [{ pageNum, discipline, item, sheetNumber, hasText, confidence }] in page order.
 * Returns:
 *   { multiDiscipline, dominant:{discipline,item}, segments:[…], sets:[…], scannedPages:[…] }
 * where a SEGMENT is a contiguous page run of one discipline and a SET merges all segments of the
 * same discipline (a discipline can appear in two blocks). Empty/single-page input degrades cleanly. */
export function splitByDiscipline(pages = []) {
  const list = (pages || []).map((p, i) => ({ pageNum: p.pageNum ?? i + 1, ...p }));
  const scannedPages = list.filter((p) => p.hasText === false).map((p) => p.pageNum);
  if (!list.length) return { multiDiscipline: false, dominant: { discipline: "Other", item: "Document" }, segments: [], sets: [], scannedPages };

  const raw = list.map(resolvePageDiscipline);
  const smooth = smoothDisciplines(list, raw);

  // Contiguous runs of equal smoothed discipline → segments.
  const segments = [];
  let cur = null;
  for (let i = 0; i < list.length; i++) {
    const disc = smooth[i] || "Other";
    if (cur && cur.discipline === disc) cur.pages.push(list[i]);
    else { cur = { discipline: disc, pages: [list[i]] }; segments.push(cur); }
  }
  const segOut = segments.map((s) => ({
    discipline: s.discipline,
    item: dominantItem(s.pages, s.discipline),
    startPage: s.pages[0].pageNum,
    endPage: s.pages[s.pages.length - 1].pageNum,
    pageNums: s.pages.map((p) => p.pageNum),
    sheetRange: sheetRangeOf(s.pages),
    pages: s.pages.length,
  }));

  // Merge segments by discipline → filing sets.
  const byDisc = new Map();
  for (const s of segOut) {
    const k = s.discipline;
    if (!byDisc.has(k)) byDisc.set(k, { discipline: k, pageNums: [], sheetRanges: [], items: [], pages: 0 });
    const set = byDisc.get(k);
    set.pageNums.push(...s.pageNums);
    if (s.sheetRange) set.sheetRanges.push(s.sheetRange);
    set.items.push(s.item);
    set.pages += s.pages;
  }
  const sets = [...byDisc.values()]
    .map((s) => ({
      discipline: s.discipline,
      item: mostCommon(s.items) || s.discipline,
      pageNums: s.pageNums,
      sheetRanges: s.sheetRanges,
      pages: s.pages,
      // A real, fileable discipline set has a substantive footprint — ≥2 pages OR its own readable
      // sheet code. A lone, codeless page of another discipline (a cover that names the architect, a
      // single cross-ref/notes/index sheet) is NOT its own set: splitting it out would manufacture a
      // junk 1-page filing, the "misfile worse than unfiled" trap. Such pages fold into `dominant`.
      standalone: s.discipline !== "Other" && (s.pages >= 2 || s.sheetRanges.length > 0),
    }))
    .sort((a, b) => b.pages - a.pages);

  // Majority discipline = the single-set filing answer (ignores Other unless it's all there is).
  const real = sets.filter((s) => s.discipline !== "Other");
  const dominant = real[0] || sets[0];
  const standalone = sets.filter((s) => s.standalone);

  return {
    multiDiscipline: standalone.length >= 2,
    dominant: { discipline: dominant.discipline, item: dominant.item },
    segments: segOut,
    sets,
    standaloneSets: standalone,
    scannedPages,
  };
}

function mostCommon(arr) {
  const t = new Map();
  for (const v of arr) if (v) t.set(v, (t.get(v) || 0) + 1);
  let best = "";
  let bestN = 0;
  for (const [v, n] of t) if (n > bestN) { best = v; bestN = n; }
  return best;
}

/* Turn a split into a COMPLETE filing plan — a partition of ALL pages into the PDFs to create, so
 * the byte-splitter (pdfSplit.js) can carve one clean per-discipline PDF and never drop a page.
 *   • Single-discipline file → one plan entry covering every page.
 *   • Multi-discipline file → one entry per STANDALONE discipline set; every leftover page (a cover,
 *     a lone notes/cross-ref sheet that wasn't its own set) rides with the DOMINANT entry, so the
 *     dominant PDF is "its sheets + everything not claimed by another trade" and nothing is lost.
 * `totalPages` defaults to the highest page seen. Entries are page-ordered; the dominant is first. */
export function buildFilingPlan(split, totalPages) {
  const sets = (split && split.standaloneSets) || [];
  const dominantDisc = split && split.dominant && split.dominant.discipline;
  const allSeen = ((split && split.sets) || []).reduce((m, s) => Math.max(m, ...s.pageNums), 0);
  const total = totalPages || allSeen || 0;

  if (!split || !split.multiDiscipline || sets.length < 2) {
    const pages = [];
    for (let p = 1; p <= total; p++) pages.push(p);
    const d = (split && split.dominant) || { discipline: "Other", item: "Document" };
    return [{ discipline: d.discipline || "Other", item: d.item || d.discipline || "Document", pageNums: pages, primary: true }];
  }

  const claimed = new Set();
  for (const s of sets) for (const n of s.pageNums) claimed.add(n);
  const entries = sets.map((s) => ({ discipline: s.discipline, item: s.item || s.discipline, pageNums: [...s.pageNums], primary: s.discipline === dominantDisc }));
  // Leftover pages → the dominant (or the first) entry.
  const home = entries.find((e) => e.primary) || entries[0];
  for (let p = 1; p <= total; p++) if (!claimed.has(p)) home.pageNums.push(p);
  for (const e of entries) e.pageNums.sort((a, b) => a - b);
  // Dominant first, then by size.
  return entries.sort((a, b) => (b.primary - a.primary) || (b.pageNums.length - a.pageNums.length));
}
