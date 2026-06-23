/* OCR-recovered match-lines (B413) — read "MATCH LINE … SHEET N" labels that live in the RASTER
 * image, not the text layer, so a scanned survey set auto-stitches through the EXISTING seam graph.
 *
 * Why this exists: a vector CAD sheet carries its match-line labels as real text, which
 * sheetMeta.parseMatchLines reads for free → autoStitch (B337) places the set. A SCANNED / reference
 * survey sheet (the owner's GPL topo: a 9-item text layer = just the title block; the drawing,
 * contours, and the "MATCH LINE ~ SHEET 2" labels are all pixels) yields ZERO match-lines, so the
 * set can't auto-stitch. This module OCRs the page at several ORIENTATIONS — a match-line on the
 * left/right edge is printed ROTATED 90°, which a 0° pass reads as a scrambled vertical column — then
 * runs the SAME parseMatchLines in EACH pass's own (upright) frame and maps the found label's centre
 * back to page space to decide which edge it sits on. Output is the identical match-line shape
 * autoStitch already consumes.
 *
 * PURE + engine-free: the OCR passes (per-orientation Tesseract word lists) are passed IN, so the
 * frame math and the merge/dedupe are unit-tested without WASM. ocr.js supplies the real passes
 * (render rotated canvas → recognize); the browser pixels never leave the device.
 */
import { reconstructLines, parseMatchLines, edgeOf } from "./sheetMeta.js";

export const OCR_ORIENTATIONS = [0, 90, 270];

// In-frame page-unit dims for a pass: a 90°/270° pass swaps width/height (the page is on its side).
function frameDims(deg, W, H) {
  return (deg === 90 || deg === 270) ? { fw: H, fh: W } : { fw: W, fh: H };
}

/* Map a point given in a rotated PASS's frame (page-units of the on-its-side image) back to the
 * upright page frame. `W`/`H` are the upright page's scale-1 size (points); `deg` is how the page was
 * rotated for the pass. Pure (the inverse of rendering the page rotated by `deg`).
 *   deg 90  — page rendered 90° CW: page point (px,py) → frame (H-py, px); invert → (ry, H-rx).
 *   deg 270 — page rendered 90° CCW: page point → frame (py, W-px); invert → (W-ry, rx).
 */
export function framePointToPage(rx, ry, deg, W, H) {
  if (deg === 90) return { x: ry, y: H - rx };
  if (deg === 270) return { x: W - ry, y: rx };
  return { x: rx, y: ry };
}

/* Tesseract words (pixel bboxes on a `scale`× canvas of the rotated image) → page-unit items in the
 * pass's OWN frame (just divide by scale; no rotation yet — we parse the label upright here). */
function wordsToFrameItems(words, scale) {
  const s = (Number.isFinite(scale) && scale > 0) ? scale : 1;
  const items = [];
  for (const w of words || []) {
    if (!w) continue;
    const str = (w.text != null ? String(w.text) : "").trim();
    if (!str) continue;
    const b = w.bbox || {};
    const { x0, y0, x1, y1 } = b;
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) continue;
    items.push({ str, x: x0 / s, y: y0 / s, w: (x1 - x0) / s, h: (y1 - y0) / s, ocr: true });
  }
  return items;
}

/* Given OCR passes [{ deg, words, scale }] over one page, recover its match-line labels in page
 * units. For each pass we reconstruct lines + parseMatchLines IN THAT pass's upright frame (so a
 * left/right-edge label, horizontal once the page is turned, is read correctly), then map the
 * label's centre back to the page frame and recompute its edge there. Merged + deduped by
 * (target|side) — parseMatchLines's own key — so a label caught in two passes counts once. `dims` =
 * { width, height } (page points). Returns the [{ raw, target, side, orientation, x, y }] autoStitch
 * consumes. */
export function recoverMatchLines(passes = [], dims = {}) {
  const W = dims.width || 0, H = dims.height || 0;
  const seen = new Set();
  const out = [];
  for (const pass of passes) {
    if (!pass) continue;
    const deg = pass.deg || 0;
    const { fw, fh } = frameDims(deg, W, H);
    const items = wordsToFrameItems(pass.words, pass.scale);
    if (!items.length) continue;
    const lines = reconstructLines(items);
    for (const ml of parseMatchLines(lines, { width: fw, height: fh })) {
      const c = framePointToPage(ml.x, ml.y, deg, W, H);          // label centre → page frame
      const edge = edgeOf(c.x, c.y, W, H);                         // which page edge it sits against
      const key = ml.target + "|" + edge.side;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ raw: ml.raw, target: ml.target, side: edge.side, orientation: edge.orientation, x: c.x, y: c.y });
    }
  }
  return out;
}
