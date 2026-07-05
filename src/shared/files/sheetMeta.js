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
import { readTitleBlockText, classifyDiscipline, parseSheetNumber, disciplineFromSheetNumber } from "./titleBlockParse.js";
import { parseDetailRefs, parseDetailAnchors } from "./detailRefs.js";
import { parseNotes } from "./sheetNotes.js";

const norm = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
const wordCount = (s) => (s || "").toString().trim().split(/\s+/).filter(Boolean).length;
// A reconstructed line whose center sits inside a rect (page units). Used to scope reads to the
// title-block band vs. the drawing area (B378 — keep body cross-refs out of the title reads).
const lineInRect = (ln, r) => {
  const cx = ln.x + ln.w / 2, cy = ln.y + ln.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
};
// A raw item whose center sits inside the title-block band.
const itemInBand = (it, band) => {
  if (!band) return true;
  const cx = it.x + (it.w || 0) / 2, cy = it.y + (it.h || 0) / 2;
  if (band.side === "right") return cx >= band.x;
  if (band.side === "bottom") return cy >= band.y;
  if (band.side === "left") return cx <= band.x + band.w;
  return true;
};

/* Join GLYPH-STACKED pseudo-vertical strings (B659): some CAD exporters draw a vertical label as
 * a stack of UNROTATED single-character items sharing an x-center ("1","1","9","6","4","1" top to
 * bottom). Row-bucketing reads one glyph per stack per row — the "O I C I 119641 T E" gibberish
 * lines that used to poison the title pick. Detect ≥3 single-char items on one x-center with a
 * tight, consistent y pitch and fuse them into ONE synthetic item (top→bottom reading order).
 * Conservative: only single-char items, tight pitch — a normal text row never qualifies. */
function joinGlyphStacks(list) {
  const singles = list.filter((it) => !it.vert && it.str.trim().length === 1 && (it.h || 0) > 0);
  if (singles.length < 3) return list;
  const rest = list.filter((it) => !singles.includes(it));
  const byX = new Map(); // x-center bucket -> items
  for (const it of singles) {
    const cx = it.x + (it.w || 0) / 2;
    let key = null;
    for (const k of byX.keys()) if (Math.abs(k - cx) <= Math.max(2, (it.h || 8) * 0.4)) { key = k; break; }
    if (key == null) { key = cx; byX.set(key, []); }
    byX.get(key).push(it);
  }
  const out = rest;
  for (const group of byX.values()) {
    group.sort((a, b) => a.y - b.y);
    let run = [group[0]];
    const flush = () => {
      if (run.length >= 3) {
        const top = run[0], bot = run[run.length - 1];
        out.push({
          str: run.map((g) => g.str.trim()).join(""),
          x: Math.min(...run.map((g) => g.x)), y: top.y,
          w: Math.max(...run.map((g) => g.w || 0)), h: bot.y + (bot.h || 0) - top.y,
          vert: true, up: false, stack: true, fontH: median(run.map((g) => g.h || 0)) || run[0].h || 0,
        });
      } else out.push(...run);
    };
    for (let i = 1; i < group.length; i++) {
      const prev = run[run.length - 1];
      const pitch = group[i].y - prev.y;
      if (pitch > 0.5 * (prev.h || 8) && pitch <= 2.2 * (prev.h || 8)) run.push(group[i]);
      else { flush(); run = [group[i]]; }
    }
    flush();
  }
  return out;
}

/* Reconstruct text LINES from positioned items. CAD PDFs fragment a label across many runs
 * ("MATCH", "LINE", "SEE", "SHEET", "C-5"); grouping items that share a baseline (close y) and
 * joining them left-to-right rebuilds the human-readable line so a regex can see the whole
 * phrase. ROTATED (vertical) runs — a left-edge title block's sheet title — are bucketed into
 * COLUMNS (close x) instead and joined in reading order: bottom→top for the standard CCW
 * rotation, top→bottom for CW/glyph-stacks; their `lineH` is the FONT height (the visual type
 * size), so the title scorer compares them fairly against horizontal lines. Returns
 * [{ text, x, y, w, h, lineH, vert?, items }] (bbox in page units). */
export function reconstructLines(items, { yTol } = {}) {
  const list = joinGlyphStacks((items || []).filter((it) => it && it.str && it.str.trim()));
  if (!list.length) return [];
  const horiz = list.filter((it) => !it.vert);
  const verts = list.filter((it) => it.vert);
  const medH = median(horiz.map((it) => it.h || 0)) || median(verts.map((it) => it.fontH || it.w || 0)) || 8;
  const tol = yTol || Math.max(3, medH * 0.6);
  // Group by row: sort by y (top), then greedily bucket items whose y-center is within tol.
  const withCenter = horiz.map((it) => ({ ...it, cy: (it.y || 0) + (it.h || 0) / 2 }));
  withCenter.sort((a, b) => a.cy - b.cy || a.x - b.x);
  const rows = [];
  for (const it of withCenter) {
    const row = rows.find((r) => Math.abs(r.cy - it.cy) <= tol);
    if (row) { row.items.push(it); row.cy = (row.cy * (row.items.length - 1) + it.cy) / row.items.length; }
    else rows.push({ cy: it.cy, items: [it] });
  }
  // Vertical runs → COLUMN lines: bucket by x-center, join in reading order (CCW reads bottom→top,
  // CW and glyph-stacks read top→bottom). A column line's `lineH` is its FONT height.
  const vertLines = [];
  {
    const cols = [];
    const sorted = verts.map((it) => ({ ...it, cx: (it.x || 0) + (it.w || 0) / 2 })).sort((a, b) => a.cx - b.cx || a.y - b.y);
    for (const it of sorted) {
      const fh = it.fontH || it.w || 8;
      const col = cols.find((c) => Math.abs(c.cx - it.cx) <= Math.max(3, fh * 0.6) && c.up === !!it.up);
      if (col) { col.items.push(it); col.cx = (col.cx * (col.items.length - 1) + it.cx) / col.items.length; }
      else cols.push({ cx: it.cx, up: !!it.up, items: [it] });
    }
    for (const col of cols) {
      // Split a column where the gap between runs is large (two unrelated vertical labels sharing
      // an x line), mirroring the horizontal gap split below.
      const its = col.items.slice().sort((a, b) => a.y - b.y);
      const fh = Math.max(...its.map((i) => i.fontH || i.w || 8));
      const gapTolV = Math.max(72, fh * 10);
      let seg = [its[0]];
      const flush = () => {
        const ordered = col.up ? seg.slice().sort((a, b) => b.y - a.y) : seg; // CCW: bottom run first
        const x = Math.min(...seg.map((i) => i.x));
        const y = Math.min(...seg.map((i) => i.y));
        const maxX = Math.max(...seg.map((i) => i.x + (i.w || 0)));
        const maxY = Math.max(...seg.map((i) => i.y + (i.h || 0)));
        vertLines.push({
          text: ordered.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
          x, y, w: maxX - x, h: maxY - y, lineH: fh, vert: true, up: col.up, items: seg,
        });
      };
      for (let k = 1; k < its.length; k++) {
        const prev = seg[seg.length - 1];
        const gap = its[k].y - (prev.y + (prev.h || 0));
        if (gap > gapTolV) { flush(); seg = [its[k]]; }
        else seg.push(its[k]);
      }
      flush();
    }
  }
  // A shared baseline alone is NOT one line: a title-block label and a far-left body note can sit at
  // the same y yet belong to different columns. Split a row wherever the horizontal gap between
  // consecutive items is large (a title-block-to-body jump), so the title-block title can't merge
  // into a body line and get rejected as "too wordy" (B378). The threshold is generous — far larger
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
      // A sharp TYPE-SIZE jump across a real gap is a cell boundary even under the gap
      // tolerance — a 9.6pt note ending just before an 18.9pt title on the same baseline is two
      // cells, not one label (B659: "SLAB ON GRADE" + "WALL SECTIONS AND" read as one line).
      const sizeJump = Math.min(prev.h || 1, its[k].h || 1) / Math.max(prev.h || 1, its[k].h || 1) < 0.72 && gap > 8;
      if (gap > gapTol || sizeJump) { out.push(mkLine(seg)); seg = [its[k]]; }
      else seg.push(its[k]);
    }
    out.push(mkLine(seg));
  }
  return out.concat(vertLines);
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
/* The title block is a dense strip of text against the RIGHT edge (vertical title block), the
 * BOTTOM edge (horizontal), or the LEFT edge (B659 — the Powers-Brown-style block on the owner's
 * GPL arch sheets, running down the left with a vertical sheet title). Find it by text density:
 * compare how much text mass sits in each edge band vs. the rest. Return the winning band rect
 * (the strip to crop, B338) — or null when no edge is clearly denser (fail open: don't crop). */
export function detectTitleBlock(items, dims = {}) {
  const width = dims.width || 0, height = dims.height || 0;
  if (!width || !height || !(items || []).length) return null;
  const RIGHT = 0.78, BOTTOM = 0.82, LEFT = 0.22; // band edges (fraction of page)
  const rightX = width * RIGHT, bottomY = height * BOTTOM, leftX = width * LEFT;
  let total = 0, right = 0, bottom = 0, left = 0;
  for (const it of items) {
    const mass = (it.w || 1) * (it.h || 1);
    total += mass;
    const cx = it.x + (it.w || 0) / 2, cy = it.y + (it.h || 0) / 2;
    if (cx >= rightX) right += mass;
    if (cy >= bottomY) bottom += mass;
    if (cx <= leftX) left += mass;
  }
  if (total <= 0) return null;
  // A real title block holds a large share of the page's text in a thin band. Require the
  // band to be disproportionately dense (≥ ~2.5× its area share) before trusting it.
  const scores = [
    { side: "right", score: (right / total) / (1 - RIGHT), rect: { side: "right", x: rightX, y: 0, w: width - rightX, h: height } },
    { side: "bottom", score: (bottom / total) / (1 - BOTTOM), rect: { side: "bottom", x: 0, y: bottomY, w: width, h: height - bottomY } },
    { side: "left", score: (left / total) / LEFT, rect: { side: "left", x: 0, y: 0, w: leftX, h: height } },
  ].sort((a, b) => b.score - a.score);
  const THRESH = 2.5;
  if (scores[0].score < THRESH) return null;
  return scores[0].rect;
}

// The drawing area = the page minus the title-block band (what B338 keeps when it crops).
export function drawingAreaOf(dims, band) {
  const width = dims.width || 0, height = dims.height || 0;
  if (!band) return { x: 0, y: 0, w: width, h: height };
  if (band.side === "right") return { x: 0, y: 0, w: band.x, h: height };
  if (band.side === "bottom") return { x: 0, y: 0, w: width, h: band.y };
  if (band.side === "left") return { x: band.w, y: 0, w: width - band.w, h: height };
  return { x: 0, y: 0, w: width, h: height };
}

/* ----------------------------- sheet title ------------------------------------- */
const TITLE_SKIP = /^\s*(scale|sheet|date|drawn|checked|designed|approved|project|job|rev(ision)?|no\.?|of|©|copyright|drawing|file|plot|issued|for)\b/i;
const looksLikeData = (t) =>
  /^\s*[\d.,:/'"\-\s]+$/.test(t) ||                  // pure numbers/dates/scales
  /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/.test(t) || // a date
  /^\s*\d{1,2}\s+[a-z]{3,9}\.?,?\s+\d{4}\s*$/i.test(t) || // "07 APRIL 2023"
  /^\s*[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}\s*$/i.test(t) || // "April 7, 2023"
  /^\s*1\s*"?\s*=/.test(t) ||                          // a scale callout
  /:\s*[\d$]/.test(t) ||                               // a data field ("SITE AREA : 29.17 AC")
  /^\s*(texas|tx)\b[\s\d.-]*$/i.test(t) ||             // state + job number cell
  t.replace(/[^a-z]/gi, "").length < 4;               // not enough letters to be a title
// Body boilerplate / legend prose that a long-line scorer used to pick AS the title (B378): the
// copyright/ownership block ("…may not be reproduced…property of…written permission") and legend
// rows ("CJ DENOTES CONTROL JOINT", "…CONTINUED"). These are never a sheet title.
const looksLikeBoilerplate = (t) =>
  /\b(property of|all rights reserved|copyright|reproduced|reproduction|written (consent|permission|authoriz)|may not be (copied|used|reproduced|altered)|shall not be (used|copied|reproduced)|without (the )?(prior )?written|denotes|continued|hereon|instrument of service)\b/i.test(t) ||
  // The TX interim-review stamp ("PRELIMINARY — NOT FOR CONSTRUCTION, PERMIT, OR REGULATORY
  // APPROVAL / CURRENT AS OF … / REGISTRATION #…") prints HUGE on every IFR sheet and outscored
  // the real title once page rotation was honored (B659). Never a title.
  /\bnot\s+for\s+(construction|permit|regulatory)\b|\bregulatory\s+approval\b|\bcurrent\s+as\s+of\b|\binterim\s+review\b|\bregistration\s*#?\s*\d/i.test(t);
// Title-block IDENTITY rows — the project/client/firm stamp lines that share the title block with
// the real title and usually print LARGER than it, so a pure tallest-line pick grabs them on every
// sheet (B659 — the "GRAND PORT LOGISTICS on all 44 sheets" misread). A sheet title never contains:
// a corporate suffix, a phone/web/email, a street "suite"/registration line, a "(A) PROJECT FOR …" /
// "PREPARED FOR/BY …" credit, or a "CITY, TEXAS 77xxx" location row. Firm-word endings (…ARCHITECTS,
// …ENGINEERING, …ASSOCIATES at the END of the line) are the firm's own name, not a drawing title.
const looksLikeIdentityRow = (t) =>
  /\b(incorporated|inc|l\.?l\.?c|l\.?l\.?p|pllc|ltd|company|corp(oration)?)\b\.?/i.test(t) ||
  /\(\d{3}\)\s*\d{3}[-. ]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b/.test(t) ||        // phone
  /\bwww\.|\.com\b|@[a-z0-9]/i.test(t) ||                                     // web / email
  /\b(suite|ste)\.?\s*#?\s*\d/i.test(t) ||                                    // street address, suite
  /\b(tbpe|tbpls|tbae)\b|\bfirm\s*(no|#|reg)/i.test(t) ||                     // TX firm registration
  /\bproject\s+(for|of|no\.?|number)\b/i.test(t) ||                           // "A PROJECT FOR HILLWOOD"
  /\bprepared\s+(for|by)\b/i.test(t) ||                                       // "PREPARED FOR …"
  /,\s*(tx|texas)\b/i.test(t) || /\b\d{5}(-\d{4})?\s*$/.test(t) ||            // "KATY, TEXAS 77494"
  /^\s*(texas|tx|houston|dallas|austin|san antonio)\s*[,.]?\s*$/i.test(t) ||  // a lone city/state cell
  /^\s*\d{2,6}\s+\S+.*\b(street|st|avenue|ave|boulevard|blvd|drive|dr|lane|ln|road|rd|parkway|pkwy|highway|hwy|freeway|fwy)\b/i.test(t) || // "2100 Travis Street,"
  /\b(architects?|architecture|engineers?|engineering|associates|consultants?|surveyors?|surveying|platting)\s*[,.]?\s*$/i.test(t) ||
  /\bland\s+surveying\b/i.test(t);
// A title-block FIELD-LABEL row — the printed label of a title-block field, sometimes merged with its
// value when both sit on one baseline ("C-14 SHEET NUMBER", "SCALE 1\"=40'", "DRAWN BY JS"). TITLE_SKIP
// only catches a label at the START of the line (^), so a line that LEADS with the value slips past it
// and used to be taken as the title (B412 — the GPL "C-14 SHEET NUMBER" mislabels). Match the label
// ANYWHERE in the line. (B412)
const looksLikeFieldRow = (t) =>
  /\bsheet\s*(no\.?|number|#)\b|\bscale\b|\b(drawn|checked|designed|approved|reviewed)\s*by\b|\b(project|job)\s*(no\.?|number|#)\b|\brev(ision)?\s*(no\.?|#)?\b|\bdrawing\s*(no\.?|number|#)\b/i.test(t);

/* Ranked sheet-title CANDIDATES — every short, large-type, non-label line in the title-block
 * zone, tallest first. The per-page pick (readSheetTitle) takes the top one; the SET-level pass
 * (sheetTitleSet.refineSheetTitles, B659) re-ranks them with cross-page frequency — the signal a
 * single page can never see (the project-name stamp repeats on EVERY sheet; the real title is
 * per-sheet unique). Wrapped two-line titles ("BUILDING ELEVATIONS -" / "SOUTH (-5)") are joined
 * into one candidate: same type size, horizontally overlapping, one line-gap apart. */
export function titleCandidates(lines, band, dims = {}, { numStrip = null } = {}) {
  // Scope to the TITLE-BLOCK ZONE — the same discipline readSheetNumberInZone uses for the
  // number (B378/B412). With a detected band, that band; WITHOUT one, the right/bottom edge strip —
  // NOT the whole page. A whole-page scan let a large drawing-area annotation ("MATCH LINE …") or a
  // big project-name banner outscore the real title (the GPL-civil mislabels). Falls fully open only
  // when we have neither a band nor page dims (older callers): then every line is eligible, as before.
  const W = dims.width || 0, H = dims.height || 0;
  const inZone = band
    ? (ln) => lineInRect(ln, band)
    : (W && H)
      ? (ln) => (ln.x + ln.w / 2 >= W * 0.78) || (ln.y + ln.h / 2 >= H * 0.82) || (ln.x + ln.w / 2 <= W * 0.22)
      : () => true;
  // Mostly single-letter tokens = shredded vertical text the stack-joiner couldn't fuse
  // ("O I C I 119641 T E") — never a title.
  const mostlySingles = (t) => {
    const toks = t.split(/\s+/).filter(Boolean);
    return toks.length >= 3 && toks.filter((x) => x.length === 1).length / toks.length > 0.5;
  };
  const isTitleish = (ln) => {
    const t = ln.text;
    if (!t || TITLE_SKIP.test(t) || looksLikeData(t) || looksLikeBoilerplate(t) || looksLikeFieldRow(t) || looksLikeIdentityRow(t)) return false;
    if (/match\s*-?\s*line|for\s+continuation/i.test(t)) return false; // a seam annotation, not a title
    if (mostlySingles(t)) return false;
    if (wordCount(t) > 7) return false;                       // a title is a few words, not a sentence
    return t.replace(/[^a-z]/gi, "").length <= 48;            // nor a long run-on line
  };
  // When the title-block zone holds NO eligible line at all, fall back to the whole page — a
  // one-off exhibit (the Mesa site plan) prints its big title over the drawing, not in a block.
  // Zone candidates always take precedence when they exist (the B412 banner guard).
  let zoned = lines.filter(inZone).filter(isTitleish);
  if (!zoned.length) zoned = lines.filter(isTitleish);
  // A title never BEGINS with the sheet's own code — a big bare number cell flush against the
  // title cell reads as one line ("C-2 TOPO SURVEY I"). Shed a leading code-shaped token when a
  // real title remains after it.
  const shedCode = (t) => {
    const m = t.match(/^([A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?(?:-?[A-Z])?)\s+(.+)$/i);
    return m && disciplineFromSheetNumber(m[1]) && m[2].replace(/[^a-z]/gi, "").length >= 4 ? m[2] : t;
  };
  const pick = zoned
    .map((ln) => ({ text: shedCode(ln.text.replace(/\s+/g, " ").trim()), x: ln.x, y: ln.y, w: ln.w, h: ln.h, lineH: ln.lineH || ln.h || 0, vert: !!ln.vert, up: !!ln.up }));
  // Join a WRAPPED title: consecutive eligible lines of the same type size whose columns overlap
  // and that sit about one line apart — a two/three-line title cell, not two fields. Horizontal
  // titles stack DOWN the page; VERTICAL (rotated, bottom→top) titles stack across it — the next
  // line of a CCW vertical title is the column to its LEFT, so those merge right→left with the
  // overlap tested on the y span. Vertical blocks tolerate looser leading (drawn title cells).
  // Look back through the last few merged entries, not just the immediately previous one — the
  // global sort interleaves lines from OTHER title-block cells between the two halves of a
  // wrapped title ("TAS NOTES AND" … project cell … "DETAILS"), and a one-step chain broke there.
  const mergeRun = (cands, sameAxisGap, crossOverlap) => {
    const merged = [];
    for (const c of cands) {
      let prev = null;
      for (let k = merged.length - 1; k >= 0 && k >= merged.length - 10; k--) {
        const m = merged[k];
        const sameSize = Math.min(m.lineH, c.lineH) / Math.max(m.lineH || 1, c.lineH || 1) >= 0.72;
        if (sameSize && crossOverlap(m, c) && sameAxisGap(m, c) && wordCount(m.text) + wordCount(c.text) <= 10 && (m.parts || 1) < 3) { prev = m; break; }
      }
      if (prev) {
        prev.text = `${prev.text} ${c.text}`;
        const x0 = Math.min(prev.x, c.x), y0 = Math.min(prev.y, c.y);
        prev.w = Math.max(prev.x + prev.w, c.x + c.w) - x0;
        prev.h = Math.max(prev.y + prev.h, c.y + c.h) - y0;
        prev.x = x0; prev.y = y0;
        prev.lineH = Math.max(prev.lineH, c.lineH);
        prev.parts = (prev.parts || 1) + 1;
      } else merged.push({ ...c });
    }
    return merged;
  };
  const yOverlapFrac = (a, b) => {
    const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return ov / Math.max(1, Math.min(a.h, b.h));
  };
  const merged = [
    ...mergeRun(
      pick.filter((c) => !c.vert).sort((a, b) => a.y - b.y),
      (p, c) => { const g = c.y - (p.y + p.h); return g >= -2 && g <= 1.2 * Math.max(p.lineH, c.lineH); },
      (p, c) => (Math.min(p.x + p.w, c.x + c.w) - Math.max(p.x, c.x)) > 0.4 * Math.min(p.w || 1, c.w || 1)
    ),
    ...mergeRun(
      pick.filter((c) => c.vert && c.up).sort((a, b) => b.x - a.x), // CCW: next line is LEFT of the previous
      (p, c) => { const g = p.x - (c.x + c.w); return g >= -2 && g <= 2.4 * Math.max(p.lineH, c.lineH); },
      (p, c) => yOverlapFrac(p, c) >= 0.5
    ),
    ...pick.filter((c) => c.vert && !c.up),
  ];
  // Height dominates (×100 so a taller line always wins); letters only break ties between equal-
  // height lines (prefer a real title over a stray 3-letter token), capped so they can't override
  // a clearly larger-type line. A candidate in the SAME edge strip as the printed sheet number
  // gets a half-size-class boost — the sheet-name cell lives beside the number cell, so it beats
  // an equally-tall detail caption on another edge without overriding genuinely larger type.
  const W2 = dims.width || 0, H2 = dims.height || 0;
  const inNumStrip = (c) => {
    if (!numStrip || !W2 || !H2) return false;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    return numStrip === "right" ? cx >= W2 * 0.78 : numStrip === "left" ? cx <= W2 * 0.22 : cy >= H2 * 0.82;
  };
  return merged
    .map((c) => ({ ...c, score: c.lineH * (100 + (inNumStrip(c) ? 45 : 0)) + Math.min(24, c.text.replace(/[^a-z]/gi, "").length) }))
    .sort((a, b) => b.score - a.score);
}

/* The sheet title — the human "what is this sheet" line (e.g. "GRADING & DRAINAGE PLAN" or
 * "GENERAL NOTES"). A real title is SHORT and LARGE-TYPE, not a long sentence — so we keep only
 * short candidate lines (a few words) and pick the TALLEST, breaking ties toward more letters.
 * The old scorer multiplied height × letter-count, which rewarded long copyright/legend prose over
 * the actual title (B378). Skips label/data/boilerplate/identity rows; falls back to the
 * deterministic discipline `item` (titleBlockParse) when nothing readable stands out, so grouping
 * always has a key. Returns "". (The cross-page correction — the project-name stamp outprinting
 * the title INSIDE the block — is the set pass, sheetTitleSet.refineSheetTitles.) */
export function readSheetTitle(lines, band, fallback = "", dims = {}) {
  const cand = titleCandidates(lines, band, dims);
  return (cand[0] && cand[0].text) || fallback || "";
}

/* Read the label-anchored sheet number from the TITLE-BLOCK ZONE only, so a body cross-reference
 * ("SEE DWG S202") can't masquerade as the sheet's own number (B378). Prefer a detected band;
 * otherwise fall back to the right edge strip, then the bottom edge strip — where title blocks live
 * — because a dense notes sheet often defeats the density-based band detector yet still keeps its
 * number in that strip. Returns the code or "". */
// A token shaped exactly like a sheet code and nothing else ("C-2", "A101", "C-2.01", "M201-A").
// Used for the BARE-code read below — anchored ^…$ so it matches a standalone token, not a code
// buried in prose. The visual TYPE SIZE of an item is its font height — for a vertical run the
// bbox `h` is its LENGTH, so the prominence compares use typeH, not raw h (B659).
const SHEET_CODE = /^[A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?(?:-?[A-Z])?$/i;
const typeH = (it) => (it && it.vert ? (it.fontH || it.w || 0) : (it && it.h) || 0);
/* The most PROMINENT bare sheet code in a zone (no "SHEET NO." label) — for a scanned/reference
 * sheet whose title block prints the number as a big standalone "C-2" with the label drawn as
 * graphics, not text. Stays conservative ("never auto-guess"): the token must be a lone sheet-code
 * shape AND carry a real discipline letter-prefix (so a page count like "46" — no letter — can't
 * win), and we take the TALLEST such token (the sheet number is the title block's largest text).
 * Returns the code or "". */
function prominentSheetCode(items, pred) {
  const cands = items.filter(pred).filter((it) => {
    const s = (it.str || "").trim();
    return SHEET_CODE.test(s) && disciplineFromSheetNumber(s);
  });
  if (!cands.length) return "";
  cands.sort((a, b) => typeH(b) - typeH(a));
  return cands[0].str.trim().toUpperCase();
}

/* SPATIAL label-anchored number read (B659): find a title-block "SHEET NUMBER / SHEET NO. /
 * DWG NO." caption ITEM and take the nearest code-shaped item around it. The joined-string
 * labeled read depends on PDF CONTENT order, where the item after the label is often the plot
 * timestamp ("SHEET NUMBER" → "6/23/2026" read a sheet number of "6"); position is what a human
 * uses. The caption must be a whole item on its own (a body "SEE SHEET C-5" run never matches),
 * and only zone items anchor. Bare 1–3-digit codes are allowed HERE (the caption vouches for
 * them) — everywhere else a code still needs a discipline letter prefix. */
const NUM_LABEL = /^\s*(?:sheet|sht|dwg|drawing)\s*(?:no\.?|number|#)\s*:?\s*$/i;
function labeledCodeNear(items, zoneP) {
  const labels = items.filter((it) => NUM_LABEL.test(it.str || "") && zoneP(it));
  let best = null;
  for (const L of labels) {
    const lh = typeH(L) || 8, lcx = L.x + (L.w || 0) / 2, lcy = L.y + (L.h || 0) / 2;
    for (const it of items) {
      const s = (it.str || "").trim();
      if (!(SHEET_CODE.test(s) || /^\d{1,3}$/.test(s))) continue;
      const cx = it.x + (it.w || 0) / 2, cy = it.y + (it.h || 0) / 2;
      const dx = Math.abs(cx - lcx), dy = Math.abs(cy - lcy);
      if (dx > 18 * lh || dy > 14 * lh) continue;
      const d = dx + dy - 4 * typeH(it); // nearest wins; large type breaks ties (the printed number is big)
      if (!best || d < best.d) best = { d, code: s.toUpperCase() };
    }
  }
  return best ? best.code : "";
}

function readSheetNumberInZone(items, dims, band) {
  const W = dims.width || 0, H = dims.height || 0;
  const rightP = (it) => it.x + (it.w || 0) / 2 >= W * 0.78;
  const bottomP = (it) => it.y + (it.h || 0) / 2 >= H * 0.82;
  const leftP = (it) => it.x + (it.w || 0) / 2 <= W * 0.22;
  const zoneP = band ? (it) => itemInBand(it, band) : (it) => rightP(it) || bottomP(it) || leftP(it);
  const spatial = labeledCodeNear(items, zoneP);
  if (spatial) return spatial;
  const join = (pred) => parseSheetNumber(items.filter(pred).map((i) => i.str).join(" "));
  // 1) The labeled read ("SHEET NO. C-2") — the most reliable, scoped to the title-block zone.
  if (band) {
    const labeled = join((it) => itemInBand(it, band));
    if (labeled) return labeled;
    // 2) No label, but the number is printed as a prominent bare code in the title-block band.
    const bare = prominentSheetCode(items, (it) => itemInBand(it, band));
    if (bare) return bare;
  } else {
    const labeled = join(rightP) || join(bottomP) || join(leftP);
    if (labeled) return labeled;
    const bare = prominentSheetCode(items, (it) => rightP(it) || bottomP(it) || leftP(it));
    if (bare) return bare;
  }
  // 3) Whole-page LAST resort (B659): some blocks print the number as the page's single largest
  // text OUTSIDE every canonical strip (the GPL arch "A303" prints at ~2× any other type).
  // Still conservative — prominentSheetCode only accepts a lone sheet-code-shaped token with a
  // real discipline prefix, and we additionally require it to CLEARLY out-print everything else
  // (≥1.5× the tallest other text), so a body grid-ref can never win by accident.
  const maxH = Math.max(0, ...items.filter((it) => SHEET_CODE.test((it.str || "").trim())).map(typeH));
  const tallestOther = Math.max(0, ...items.filter((it) => !SHEET_CODE.test((it.str || "").trim())).map(typeH));
  if (maxH >= 1.5 * tallestOther) return prominentSheetCode(items, () => true);
  return "";
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
  // The zone sheet-number read runs FIRST: the strip its printed number sits in tells the title
  // scorer which edge holds the title block — the sheet-name cell sits beside the number cell,
  // while equally-large detail CAPTIONS line the bottom of a details sheet (B659).
  const zoneNumber = readSheetNumberInZone(items, dims, band);
  let numStrip = null;
  if (zoneNumber && dims.width && dims.height) {
    const numItems = items.filter((it) => (it.str || "").trim().toUpperCase() === zoneNumber);
    const ni = numItems.sort((a, b) => typeH(b) - typeH(a))[0];
    if (ni) {
      const cx = ni.x + (ni.w || 0) / 2, cy = ni.y + (ni.h || 0) / 2;
      numStrip = cx >= dims.width * 0.78 ? "right" : cx <= dims.width * 0.22 ? "left" : cy >= dims.height * 0.82 ? "bottom" : null;
    }
  }
  // Ranked candidates travel WITH the record so the set-level pass (refineSheetTitles, B659) can
  // demote cross-page boilerplate — a correction only visible with the whole file in hand.
  const titleCands = titleCandidates(lines, band, dims, { numStrip }).slice(0, 8)
    .map((c) => ({ text: c.text, h: c.lineH, score: c.score }));
  const sheetTitle = (titleCands[0] && titleCands[0].text) || item || "";
  // Is this a pure-text sheet (general notes / specifications / legend), not a drawing? Such a
  // sheet has no plan scale — auto-calibration must NOT fire on it (B379). Signals: a notes/specs
  // title, or a drawing area saturated with sentence-like prose (plans carry only short labels).
  const proseLines = lines.filter((ln) => lineInRect(ln, drawingArea) && wordCount(ln.text) >= 6).length;
  const NOTES_TITLE = /general\s+notes|^notes\b|abbreviations|legend|specifications?|sheet\s+index|^index\b/i;
  const textDense = proseLines >= 10 || NOTES_TITLE.test(sheetTitle || "") || NOTES_TITLE.test(item || "");
  // Sheet number, read from the TITLE-BLOCK ZONE only — never the drawing body (B378). The body of
  // a text-dense sheet is full of cross-references ("SEE DWG S202") that the whole-page read grabs
  // as the number (the same wrong code on several sheets). We read from the detected band, or — when
  // a dense notes sheet defeats the density-based band detector — from the right/bottom edge strip
  // where title blocks live. Only a NON-dense sheet may fall back to the whole-page read.
  let sheetNumber = zoneNumber;
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
    sheetNumber: sheetNumber || "", sheetTitle, titleCandidates: titleCands,
    discipline, item, revision: fields.revision || "", date: fields.date || "",
    scale, titleBlock: band, drawingArea, matchLines,
    detailRefs, detailAnchors, notes, textDense,
  };
}
