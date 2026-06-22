/* Sheet reading + grouping glue (B335/B336/B339) — the thin browser-only bridge between
 * pdf.js and the pure engines. Pulls each page's POSITIONED text (extractPageItems), runs the
 * pure sheet-metadata reader (sheetMeta, B336), and collapses the set into logical sheets
 * (sheetGroups, B335). Also derives a per-group calibration from the stated scale (B339).
 *
 * OCR seam (B336): a scanned/image-only page comes back with hasText:false. `ocr` is an
 * injectable hook that, when provided, fills in positioned items for such a page (the intended
 * fill-in is a Tesseract.js Web Worker). It's left as a dormant seam — exactly like the app's
 * other not-yet-provisioned heavy compute (the AI title-block reader, the APS converter): the
 * common case (CAD vector PDFs with a real text layer) is fully handled with no OCR, and a
 * scanned page degrades gracefully (low confidence, stays standalone) instead of guessing.
 *
 * Pure-testable: `extractItems` and `ocr` are injectable, so the read→group pipeline is unit-
 * tested without pdf.js (mirrors the project's DI test style).
 */
import { readSheetMeta } from "../../../shared/files/sheetMeta.js";
import { groupSheets, markAdjacentDuplicateNumbers } from "../../../shared/files/sheetGroups.js";
import { detectSheet, ftPerPointForScale } from "../../site-planner/lib/overlayScale.js";

// pdf.js is imported LAZILY (it pulls a browser-only worker + DOMMatrix) so this module loads
// in Node/tests; pdf.js only spins up when a real read runs. Mirrors localRead.js's pattern.
async function defaultExtractItems(doc, p) {
  const { extractPageItems } = await import("./pdf.js");
  return extractPageItems(doc, p);
}

/* Read every page's metadata. Returns [{ pageNum, width, height, ...meta }] in page order.
 * `extractItems(doc, p) → { items, width, height }` and `ocr(doc, p) → { items, width, height }`
 * are injectable. A page with no text layer (and no OCR) keeps hasText:false. */
export async function readSheets(doc, { extractItems = defaultExtractItems, ocr = null, maxPages = 0 } = {}) {
  const total = doc && doc.numPages ? doc.numPages : 0;
  const n = maxPages ? Math.min(maxPages, total) : total;
  const out = [];
  for (let p = 1; p <= n; p++) {
    let page = await extractItems(doc, p);
    let meta = readSheetMeta(page);
    if (!meta.hasText && ocr) {
      try {
        const o = await ocr(doc, p);
        if (o && (o.items || []).length) { page = o; meta = { ...readSheetMeta(o), ocr: true }; }
      } catch (_) { /* OCR best-effort; fall through to the no-text record */ }
    }
    out.push({ pageNum: p, width: page.width || 0, height: page.height || 0, ...meta });
  }
  // Drop duplicate adjacent sheet numbers (cross-reference misreads) so they don't read as a run
  // of identical sheets (B374).
  return markAdjacentDuplicateNumbers(out);
}

/* Read a PDF and collapse it into the logical sheet list (B335). Each logical entry's `pages`
 * carry { pageNum, ...meta } so the caller maps a group back to real PDF pages. */
export async function readAndGroup(doc, opts = {}) {
  const pages = await readSheets(doc, opts);
  return { pages, groups: groupSheets(pages) };
}

/* Feet per page-POINT implied by a page's STATED scale (B339) — the value the Stitcher uses as
 * `ftPerUnit` (its world units are page points). Trust the printed scale ONLY when the page is a
 * standard plot size (a misread/half-size sheet would mis-scale the whole group); else 0. */
export function statedCalibration(meta = {}) {
  const sc = meta.scale;
  if (!sc || !sc.ftPerInch) return 0;
  // A general-notes / specifications / legend sheet has no plan scale — a scale-looking string in
  // its body text must NOT auto-calibrate it (B375). Leave it uncalibrated (the user calibrates by
  // hand if needed) rather than silently mis-scale a non-drawing sheet.
  if (meta.textDense) return 0;
  if (!detectSheet(meta.width || 0, meta.height || 0).std) return 0;
  return ftPerPointForScale(sc.ftPerInch);
}

/* The calibration to auto-apply to a whole grouped composite: the first page in the group that
 * carries a trustworthy stated scale. Returns { ftPerUnit, label } or null (→ stay manual).
 * One scale for the group is correct — a stitched plan set shares a single scale. */
export function groupCalibration(pages = []) {
  for (const meta of pages) {
    const ftPerUnit = statedCalibration(meta);
    if (ftPerUnit) return { ftPerUnit, label: (meta.scale && meta.scale.label) || "" };
  }
  return null;
}
