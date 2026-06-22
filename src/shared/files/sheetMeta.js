/* Sheet-metadata reader (B336) — the shared engine behind auto-grouping (B335), automatic
 * match-line stitching (B337), per-group auto-calibration (B339), and (the roadmap's)
 * auto-filing. PURE + browser-free: it takes the POSITIONED text of one page —
 * { items:[{ str,x,y,w,h }], width, height } in top-left page units (from
 * doc-review/lib/pdf.js `extractPageItems`) — and returns what a human reads off the sheet:
 * the title-block band, the sheet title, discipline/item, the stated scale, and every
 * "MATCH LINE … SEE SHEET X" label with its position + orientation.
 *
 * Why positional (vs. the existing JOINED-string filing reader, titleBlockParse.js): grouping
 * needs the sheet TITLE; stitching needs each match line's ENDPOINTS; cropping (B338) needs the
 * title-block BAND. None of that survives `items.map(i=>i.str).join(" ")`. So this REUSES the
 * deterministic field parsers (titleBlockParse: discipline/item/sheet#/revision/date) and the
 * scale parser (sheetScale.parseSheetScale, B267) over the joined text, and adds the spatial
 * layer on top. Honest: a field it can't read is left empty / null and `confidence` is lowered —
 * never a guess ("never auto-guess").
 *
 * Unit-tested with hand-built item lists (no pdf.js), mirroring the project's DI test style.
 */
import { readTitleBlockText, classifyDiscipline, parseSheetNumber } from "./titleBlockParse.js";
import { parseDetailRefs, parseDetailAnchors } from "./detailRefs.js";
import { parseNotes } from "./sheetNotes.js";

const norm = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
const wordCount = (s) => (s || "").toString().trim().split(/\s+/).filter(Boolean).length;
// A reconstructed line whose center sits inside a rect (page units). Used to scope reads to the
// title-block band vs. the drawing area (B374 — keep body cross-refs out of the title reads).
const lineInRect = (ln, r) => {
  const cx = ln.x + ln.w / 2, cy = ln.y + ln.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
};
// A raw item whose center sits inside the title-block band.
const itemInBand = (it, band) => {
  if (!band) return true;
  const cx = it.x + (it.w || 0) / 2, cy = it.y + (it.h || 0) / 2;
  return band.side === "right" ? cx >= band.x : band.side === "bottom" ? cy >= band.y : true;
};

/* Reconstruct text LINES from positioned items. CAD PDFs fragment a label across many runs
 * ("MATCH", "LINE", "SEE", "SHEET", "C-5"); grouping items that share a baseline (close y) and
 * joining them left-to-right rebuilds the human-readable line so a regex can see the whole
 * phrase. Returns [{ text, x, y, w, h, items }] (bbox in page units). */
export function reconstructLines(items, { yTol } = {}) {
  const list = (items || []).filter((it) => it && it.str && it.str.trim());
  if (!list.length) return [];
  const medH = median(list.map((it) => it.h || 0)) || 8;
  const tol = yTol || Math.max(3, medH * 0.6);
  // Group by row: sort by y (top), then greedily bucket items whose y-center is within tol.
  const withCenter = list.map((it) => ({ ...it, cy: (it.y || 0) + (it.h || 0) / 2 }));
  withCenter.sort((a, b) => a.cy - b.cy || a.x - b.x);
  const rows = [];
  for (const it of withCenter) {
    const row = rows.find((r) => Math.abs(r.cy - it.cy) <= tol);
    if (row) { row.items.push(it); row.cy = (row.cy * (row.items.length - 1) + it.cy) / row.items.length; }
    else rows.push({ cy: it.cy, items: [it] });
  }
  // A shared baseline alone is NOT one line: a title-block label and a far-left body note can sit at
  // the same y yet belong to different columns. Split a row wherever the horizontal gap between
  // consecutive items is large (a title-block-to-body jump), so the title-block title can't merge
  // into a body line and get rejected as "too wordy" (B374). The threshold is generous — far larger
  // than any intra-phrase word gap, so "MATCH LINE SEE SHEET C-6" still joins. */
  const gapTol = Math.max(72, medH * 10);
  const mkLine = (its) => {
    const x = Math.min(...its.map((i) => i.x));
    const y = Math.min(...its.map((i) => i.y));
    const maxX = Math.max(...its.map((i) => i.x + (i.w || 0)));
    const maxY = Math.max(...its.map((i) => i.y + (i.h || 0)));
    const h = Math.max(...its.map((i) => i.h || 0));
    return { text: its.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(), x, y, w: maxX - x, h: maxY - y, lineH: h, items: its };
  };
  const out = [];
  for (const r of rows) {
    const its = r.items.slice().sort((a, b) => a.x - b.x);
    let seg = [its[0]];
    for (let k = 1; k < its.length; k++) {
      const prev = seg[seg.length - 1];
      const gap = its[k].x - (prev.x + (prev.w || 0));
      if (gap > gapTol) { out.push(mkLine(seg)); seg = [its[k]]; }
      else seg.push(its[k]);
    }
    out.push(mkLine(seg));
  }
  return out;
}

function median(nums) {
  const a = nums.filter((n) => n > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* ----------------------------- match-line labels ------------------------------- */
// "MATCH LINE - SEE SHEET C-5", "MATCHLINE SEE DWG C5", "SEE SHEET C5 FOR CONTINUATION",
// "CONTINUED ON SHEET C-5". Captures the referenced sheet code. Conservative sheet token so a
// stray number in the phrase isn't mistaken for a sheet id.
const SHEET_REF = "([A-Z]{0,3}-?\\d{1,3}(?:\\.\\d{1,2})?[A-Z]?)";
const MATCH_PATTERNS = [
  new RegExp(`match\\s*-?\\s*line[\\s\\S]{0,40}?(?:see\\s+)?(?:sheet|sht|dwg|drawing)\\s*(?:no\\.?|#)?\\s*${SHEET_REF}`, "i"),
  new RegExp(`(?:see|continued\\s+on)\\s+(?:sheet|sht|dwg|drawing)\\s*(?:no\\.?|#)?\\s*${SHEET_REF}\\s+for\\s+continuation`, "i"),
  new RegExp(`match\\s*-?\\s*line`, "i"), // bare match line (target unknown) — still a real seam
];

/* Which page edge a label sits against, and therefore the cut's orientation. A match line on
 * the LEFT/RIGHT edge is a VERTICAL cut (the sheet continues left/right); TOP/BOTTOM is a
 * HORIZONTAL cut. We read the side from the label's center vs. the page center. */
export function edgeOf(cx, cy, width, height) {
  const fx = cx / Math.max(1, width), fy = cy / Math.max(1, height);
  const dl = fx, dr = 1 - fx, dt = fy, db = 1 - fy;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return { side: "left", orientation: "vertical" };
  if (m === dr) return { side: "right", orientation: "vertical" };
  if (m === dt) return { side: "top", orientation: "horizontal" };
  return { side: "bottom", orientation: "horizontal" };
}

/* Find every match-line label on the page. Returns
 *   [{ raw, target, side, orientation, x, y }]
 * where (x,y) is the label's center in page units and `target` is the referenced sheet code
 * (uppercased) or "" if the label didn't name one. Deduped by (target+side). */
export function parseMatchLines(lines, dims = {}) {
  const width = dims.width || 0, height = dims.height || 0;
  const out = [];
  const seen = new Set();
  for (const ln of lines) {
    const t = ln.text;
    if (!/match\s*-?\s*line|for\s+continuation/i.test(t)) continue;
    let target = "", raw = t;
    for (const re of MATCH_PATTERNS) {
      const m = t.match(re);
      if (m) { target = (m[1] || "").toUpperCase(); raw = m[0]; break; }
    }
    if (!/match\s*-?\s*line/i.test(raw) && !/for\s+continuation/i.test(raw)) continue;
    const cx = ln.x + ln.w / 2, cy = ln.y + ln.h / 2;
    const { side, orientation } = edgeOf(cx, cy, width, height);
    const key = target + "|" + side;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: raw.replace(/\s+/g, " ").trim(), target, side, orientation, x: cx, y: cy });
  }
  return out;
}

/* ----------------------------- title-block band -------------------------------- */
/* The title block is a dense strip of text against the RIGHT edge (vertical title block) or
 * the BOTTOM edge (horizontal). Find it by text density: compare how much text mass sits in a
 * right-edge band vs. a bottom-edge band vs. the rest. Return the winning band rect (the strip
 * to crop, B338) — or null when neither edge is clearly denser (fail open: don't crop). */
export function detectTitleBlock(items, dims = {}) {
  const width = dims.width || 0, height = dims.height || 0;
  if (!width || !height || !(items || []).length) return null;
  const RIGHT = 0.78, BOTTOM = 0.82; // band starts (fraction of page)
  const rightX = width * RIGHT, bottomY = height * BOTTOM;
  let total = 0, right = 0, bottom = 0;
  for (const it of items) {
    const mass = (it.w || 1) * (it.h || 1);
    total += mass;
    const cx = it.x + (it.w || 0) / 2, cy = it.y + (it.h || 0) / 2;
    if (cx >= rightX) right += mass;
    if (cy >= bottomY) bottom += mass;
  }
  if (total <= 0) return null;
  const rightFrac = right / total, bottomFrac = bottom / total;
  // A real title block holds a large share of the page's text in a thin band. Require the
  // band to be disproportionately dense (≥ ~2.5× its area share) before trusting it.
  const rightAreaShare = 1 - RIGHT, bottomAreaShare = 1 - BOTTOM;
  const rightScore = rightFrac / rightAreaShare, bottomScore = bottomFrac / bottomAreaShare;
  const THRESH = 2.5;
  if (rightScore < THRESH && bottomScore < THRESH) return null;
  if (rightScore >= bottomScore) return { side: "right", x: rightX, y: 0, w: width - rightX, h: height };
  return { side: "bottom", x: 0, y: bottomY, w: width, h: height - bottomY };
}

// The drawing area = the page minus the title-block band (what B338 keeps when it crops).
export function drawingAreaOf(dims, band) {
  const width = dims.width || 0, height = dims.height || 0;
  if (!band) return { x: 0, y: 0, w: width, h: height };
  if (band.side === "right") return { x: 0, y: 0, w: band.x, h: height };
  if (band.side === "bottom") return { x: 0, y: 0, w: width, h: band.y };
  return { x: 0, y: 0, w: width, h: height };
}

/* ----------------------------- sheet title ------------------------------------- */
const TITLE_SKIP = /^\s*(scale|sheet|date|drawn|checked|designed|approved|project|job|rev(ision)?|no\.?|of|©|copyright|drawing|file|plot|issued|for)\b/i;
const looksLikeData = (t) =>
  /^\s*[\d.,:/'"\-\s]+$/.test(t) ||                  // pure numbers/dates/scales
  /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/.test(t) || // a date
  /^\s*1\s*"?\s*=/.test(t) ||                          // a scale callout
  t.replace(/[^a-z]/gi, "").length < 3;               // not enough letters to be a title
// Body boilerplate / legend prose that a long-line scorer used to pick AS the title (B374): the
// copyright/ownership block ("…may not be reproduced…property of…written permission") and legend
// rows ("CJ DENOTES CONTROL JOINT", "…CONTINUED"). These are never a sheet title.
const looksLikeBoilerplate = (t) =>
  /\b(property of|all rights reserved|copyright|reproduced|reproduction|written (consent|permission|authoriz)|may not be (copied|used|reproduced|altered)|shall not be (used|copied|reproduced)|without (the )?(prior )?written|denotes|continued|hereon|instrument of service)\b/i.test(t);

/* The sheet title — the human "what is this sheet" line (e.g. "GRADING & DRAINAGE PLAN" or
 * "GENERAL NOTES"). A real title is SHORT and LARGE-TYPE, not a long sentence — so we keep only
 * short candidate lines (a few words) and pick the TALLEST, breaking ties toward more letters.
 * The old scorer multiplied height × letter-count, which rewarded long copyright/legend prose over
 * the actual title (B374). Skips label/data/boilerplate rows; falls back to the deterministic
 * discipline `item` (titleBlockParse) when nothing readable stands out, so grouping always has a
 * key. Returns "". */
export function readSheetTitle(lines, band, fallback = "") {
  const inBand = (ln) => (band ? itemInBand(ln, band) : true);
  const isTitleish = (ln) => {
    const t = ln.text;
    if (!t || TITLE_SKIP.test(t) || looksLikeData(t) || looksLikeBoilerplate(t)) return false;
    if (wordCount(t) > 7) return false;                       // a title is a few words, not a sentence
    return t.replace(/[^a-z]/gi, "").length <= 48;            // nor a long run-on line
  };
  const cand = lines
    .filter(inBand)
    .filter(isTitleish)
    // Height dominates (×100 so a taller line always wins); letters only break ties between equal-
    // height lines (prefer a real title over a stray 3-letter token), capped so they can't override
    // a clearly larger-type line.
    .map((ln) => ({ ln, score: (ln.lineH || ln.h || 0) * 100 + Math.min(24, ln.text.replace(/[^a-z]/gi, "").length) }))
    .sort((a, b) => b.score - a.score);
  const top = cand[0] && cand[0].ln.text.replace(/\s+/g, " ").trim();
  return top || fallback || "";
}

/* Read the label-anchored sheet number from the TITLE-BLOCK ZONE only, so a body cross-reference
 * ("SEE DWG S202") can't masquerade as the sheet's own number (B374). Prefer a detected band;
 * otherwise fall back to the right edge strip, then the bottom edge strip — where title blocks live
 * — because a dense notes sheet often defeats the density-based band detector yet still keeps its
 * number in that strip. Returns the code or "". */
function readSheetNumberInZone(items, dims, band) {
  const join = (pred) => parseSheetNumber(items.filter(pred).map((i) => i.str).join(" "));
  if (band) return join((it) => itemInBand(it, band));
  const W = dims.width || 0, H = dims.height || 0;
  return join((it) => it.x + (it.w || 0) / 2 >= W * 0.78) || join((it) => it.y + (it.h || 0) / 2 >= H * 0.82);
}

/* ----------------------------- the reader -------------------------------------- */
/* Read one page's metadata from its positioned text. `page` = { items, width, height }.
 * Returns a flat record used by grouping / stitching / calibration:
 *   { hasText, confidence, sheetNumber, sheetTitle, discipline, item, revision, date,
 *     scale, titleBlock, drawingArea, matchLines } */
export function readSheetMeta(page = {}) {
  const items = page.items || [];
  const dims = { width: page.width || 0, height: page.height || 0 };
  const joined = items.map((i) => i.str).join(" ");
  const fields = readTitleBlockText(joined);
  if (!fields.hasText) {
    return {
      hasText: false, confidence: 0,
      sheetNumber: "", sheetTitle: "", discipline: "Other", item: "Document", revision: "", date: "",
      scale: null, titleBlock: null, drawingArea: drawingAreaOf(dims, null), matchLines: [],
      detailRefs: [], detailAnchors: [], notes: [], textDense: false,
    };
  }
  const lines = reconstructLines(items);
  const band = detectTitleBlock(items, dims);
  const drawingArea = drawingAreaOf(dims, band);
  const scale = fields.scale; // one parse pass — readTitleBlockText already read the stated scale (B360)
  const matchLines = parseMatchLines(lines, dims);
  const { discipline, item } = classifyDiscipline(joined, fields.sheetNumber);
  const sheetTitle = readSheetTitle(lines, band, item);
  // Is this a pure-text sheet (general notes / specifications / legend), not a drawing? Such a
  // sheet has no plan scale — auto-calibration must NOT fire on it (B375). Signals: a notes/specs
  // title, or a drawing area saturated with sentence-like prose (plans carry only short labels).
  const proseLines = lines.filter((ln) => lineInRect(ln, drawingArea) && wordCount(ln.text) >= 6).length;
  const NOTES_TITLE = /general\s+notes|^notes\b|abbreviations|legend|specifications?|sheet\s+index|^index\b/i;
  const textDense = proseLines >= 10 || NOTES_TITLE.test(sheetTitle || "") || NOTES_TITLE.test(item || "");
  // Sheet number, read from the TITLE-BLOCK ZONE only — never the drawing body (B374). The body of
  // a text-dense sheet is full of cross-references ("SEE DWG S202") that the whole-page read grabs
  // as the number (the same wrong code on several sheets). We read from the detected band, or — when
  // a dense notes sheet defeats the density-based band detector — from the right/bottom edge strip
  // where title blocks live. Only a NON-dense sheet may fall back to the whole-page read.
  let sheetNumber = readSheetNumberInZone(items, dims, band);
  if (!sheetNumber && !textDense) sheetNumber = fields.sheetNumber || "";
  // Detail-callout bubbles + where details are defined (B350, Bluebeam click-to-detail) and the
  // notes/legend blocks (B350, keep every sheet's notes through the crop).
  const detailRefs = parseDetailRefs(items, lines, dims);
  const detailAnchors = parseDetailAnchors(lines, dims);
  const notes = parseNotes(lines, dims);

  // Confidence: a blend of the spatial reads we actually got — used to surface low-confidence
  // sheets to the user rather than silently mis-group/mis-stitch them ("never auto-guess").
  let confidence = 0.3;
  if (sheetNumber) confidence += 0.25;
  if (band) confidence += 0.2;
  if (sheetTitle && sheetTitle !== "Document") confidence += 0.15;
  if (scale && (scale.ftPerInch || scale.explicit)) confidence += 0.1;
  confidence = Math.min(1, confidence);

  return {
    hasText: true, confidence,
    sheetNumber: sheetNumber || "", sheetTitle,
    discipline, item, revision: fields.revision || "", date: fields.date || "",
    scale, titleBlock: band, drawingArea, matchLines,
    detailRefs, detailAnchors, notes, textDense,
  };
}
