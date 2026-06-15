/* Site-plan overlay rasterizer (B72).
 *
 * Turns a dropped site-plan PDF (or an image file) into a persistable raster for the
 * Site Planner's "site-plan overlay" layer — a placed backdrop the user positions on
 * the map by hand. Reuses the Document Review PDF engine (PDF.js + its bundled
 * worker) via a DYNAMIC import, so PDF.js never loads in the planner until the first
 * PDF is dropped here, and the parse stays off the main thread (PDF.js's own worker).
 *
 * Returns { src, imgW, imgH, page, pageCount, pdf }:
 *   - src       PNG data URL (persists with the plan, like the aerial underlay)
 *   - imgW/imgH the page's intrinsic size in PDF points (scale-1) — the on-map size
 *               is imgW*ftPerPx wide, so this stays stable across raster scale
 *   - pdf       the live PDFDocumentProxy for the in-session page picker (null for an
 *               image); the caller destroys it on remove/unmount (cf. B39)
 */
import { loadAndDownscaleImage } from "./image.js";
import { detectSheet, parseScaleNote } from "./overlayScale.js";

const MAX_RASTER_DIM = 2600; // cap the rendered raster so memory / the white-knockout pass stay cheap

export const isPdfFile = (file) =>
  !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));

/* Render one page of an already-open PDF to a PNG data URL, knocking near-white paper
 * to transparent so the map shows through the linework. Tainted-canvas safe (skips the
 * knockout rather than throwing). */
export async function rasterizePage(pdf, pageNum = 1) {
  const n = Math.min(Math.max(1, pageNum | 0), pdf.numPages);
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(0.5, Math.min(2, MAX_RASTER_DIM / Math.max(1, base.width, base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  try {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] >= 247 && d[i + 1] >= 247 && d[i + 2] >= 247) d[i + 3] = 0; // near-white → transparent
    }
    ctx.putImageData(img, 0, 0);
  } catch (_) { /* getImageData blocked — leave the white in, the opacity slider still applies */ }
  return { src: canvas.toDataURL("image/png"), imgW: Math.round(base.width), imgH: Math.round(base.height), page: n };
}

/* Read an engineer's scale note off a page's text (PDF.js getTextContent) → feet per
 * inch, or null. Tolerant: a scanned / text-less PDF just yields null. */
async function readScaleNote(pdf, pageNum = 1) {
  try {
    const page = await pdf.getPage(Math.min(Math.max(1, pageNum | 0), pdf.numPages));
    const tc = await page.getTextContent();
    return parseScaleNote(tc.items.map((i) => i.str || "").join(" "));
  } catch (_) { return null; }
}

/* Open a dropped file: rasterize page 1 of a PDF (plus read its scale note + classify
 * its sheet size for B73), or decode an image. */
export async function openOverlayFile(file) {
  if (isPdfFile(file)) {
    const { loadPdf } = await import("../../doc-review/lib/pdf.js"); // shared PDF engine, lazily
    const pdf = await loadPdf(file);
    const r = await rasterizePage(pdf, 1);
    const detectedScale = await readScaleNote(pdf, 1);
    return { ...r, pageCount: pdf.numPages, pdf, detectedScale, sheet: detectSheet(r.imgW, r.imgH) };
  }
  const { src, w, h } = await loadAndDownscaleImage(file); // PNG/JPG path (reuses the aerial loader)
  return { src, imgW: w, imgH: h, page: 1, pageCount: 1, pdf: null, detectedScale: null, sheet: null };
}
