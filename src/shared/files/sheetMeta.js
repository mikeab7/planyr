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
 * scale parser (overlayScale.parseSheetScale, B267) over the joined text, and adds the spatial
 * layer on top. Honest: a field it can't read is left empty / null and `confidence` is lowered —
 * never a guess ("never auto-guess").
 *
 * Unit-tested with hand-built item lists (no pdf.js), mirroring the project's DI test style.
 */
import { readTitleBlockText, classifyDiscipline } from "./titleBlockParse.js";
import { parseSheetScale } from "../../workspaces/site-planner/lib/overlayScale.js";

const norm = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();

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
  return rows.map((r) => {
    const its = r.items.slice().sort((a, b) => a.x - b.x);
    const text = its.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    const x = Math.min(...its.map((i) => i.x));
    const y = Math.min(...its.map((i) => i.y));
    const maxX = Math.max(...its.map((i) => i.x + (i.w || 0)));
    const maxY = Math.max(...its.map((i) => i.y + (i.h || 0)));
    const h = Math.max(...its.map((i) => i.h || 0));
    return { text, x, y, w: maxX - x, h: maxY - y, lineH: h, items: its };
  });
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

/* The sheet title — the human "what is this sheet" line (e.g. "GRADING & DRAINAGE PLAN"). The
 * largest, wordiest line inside the title-block band, skipping label/data rows. Falls back to
 * the deterministic discipline `item` (titleBlockParse) when nothing readable stands out, so
 * grouping always has a key. Returns "". */
export function readSheetTitle(lines, band, fallback = "") {
  const inBand = (ln) => {
    if (!band) return true;
    const cx = ln.x + ln.w / 2, cy = ln.y + ln.h / 2;
    return band.side === "right" ? cx >= band.x : band.side === "bottom" ? cy >= band.y : true;
  };
  const cand = lines
    .filter(inBand)
    .filter((ln) => ln.text && !TITLE_SKIP.test(ln.text) && !looksLikeData(ln.text))
    .map((ln) => ({ ln, score: (ln.lineH || ln.h || 0) * Math.min(40, ln.text.replace(/[^a-z]/gi, "").length) }))
    .sort((a, b) => b.score - a.score);
  const top = cand[0] && cand[0].ln.text.replace(/\s+/g, " ").trim();
  return top || fallback || "";
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
    };
  }
  const lines = reconstructLines(items);
  const band = detectTitleBlock(items, dims);
  const scale = parseSheetScale(joined);
  const matchLines = parseMatchLines(lines, dims);
  const { discipline, item } = classifyDiscipline(joined, fields.sheetNumber);
  const sheetTitle = readSheetTitle(lines, band, item);

  // Confidence: a blend of the spatial reads we actually got — used to surface low-confidence
  // sheets to the user rather than silently mis-group/mis-stitch them ("never auto-guess").
  let confidence = 0.3;
  if (fields.sheetNumber) confidence += 0.25;
  if (band) confidence += 0.2;
  if (sheetTitle && sheetTitle !== "Document") confidence += 0.15;
  if (scale && (scale.ftPerInch || scale.explicit)) confidence += 0.1;
  confidence = Math.min(1, confidence);

  return {
    hasText: true, confidence,
    sheetNumber: fields.sheetNumber || "", sheetTitle,
    discipline, item, revision: fields.revision || "", date: fields.date || "",
    scale, titleBlock: band, drawingArea: drawingAreaOf(dims, band), matchLines,
  };
}
