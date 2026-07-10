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

// B749 — base raster cap raised 2600 → 4500 px so a 36×24 sheet has headroom to zoom into a
// truck court before it softens; MAX_RASTER_SCALE lets a small sheet sharpen too (the old 2×
// scale cap left ANSI-B/A pages under-rendered). Both raster edges stay ≤ MAX_RASTER_DIM.
const MAX_RASTER_DIM = 4500;
const MAX_RASTER_SCALE = 4;
// B749 Tier 2 — the zoom-aware re-raster tops out here (a common GPU max-texture edge).
export const MAX_RERASTER_DIM = 8192;
// Re-raster to hi-res once the base raster is being upscaled past this on-screen magnification.
const RERASTER_UPGRADE_AT = 1.5;

export const isPdfFile = (file) =>
  !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));

// B747 — DXF sniff. Extension is the reliable signal (MIME is unset/inconsistent for CAD);
// the header is confirmed after read in the DXF branch. Kept sync so the dropzone guard can use it.
export const isDxfFile = (file) =>
  !!file && (/\.dxf$/i.test(file.name || "") || file.type === "image/vnd.dxf" || file.type === "application/dxf");

/* The white-knockout pixel pass, factored pure for unit tests (B654): near-white
 * (all channels ≥ 247) → fully transparent, in place. Returns the same array. */
export function knockoutNearWhite(d) {
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= 247 && d[i + 1] >= 247 && d[i + 2] >= 247) d[i + 3] = 0; // near-white → transparent
  }
  return d;
}

/* The device scale (raster-px per PDF point) the BASE raster renders at for a page of the
 * given max intrinsic dimension. Pure + exported so the re-raster math (below) and tests can
 * reason about it without a live pdf. */
export function baseRasterScale(pageMaxPts) {
  return Math.max(0.5, Math.min(MAX_RASTER_SCALE, MAX_RASTER_DIM / Math.max(1, pageMaxPts)));
}

/* Knock near-white to transparent IN BANDS (B749) so the getImageData transient stays bounded
 * at (width × BAND) px even for a 4500-px raster — the whole-canvas read of a big page is a
 * large one-shot allocation. Tainted-canvas safe (skips rather than throws). */
function knockoutCanvas(ctx, w, h) {
  const BAND = 512;
  try {
    for (let y = 0; y < h; y += BAND) {
      const bh = Math.min(BAND, h - y);
      const img = ctx.getImageData(0, y, w, bh);
      knockoutNearWhite(img.data);
      ctx.putImageData(img, 0, y);
    }
  } catch (_) { /* getImageData blocked — leave the white in, the opacity slider still applies */ }
}

// Render a page to an offscreen canvas at an explicit device `scale`; returns { canvas, base }.
async function renderPageCanvas(pdf, n, scale, knockout) {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  if (knockout) knockoutCanvas(ctx, canvas.width, canvas.height);
  return { canvas, base };
}

/* Render one page of an already-open PDF to a PNG data URL, knocking near-white paper
 * to transparent so the map shows through the linework (pass { knockout:false } to keep
 * the paper — the References panel's per-reference toggle, B654; absent = knocked out,
 * today's behavior). `scale` overrides the auto base scale (B749 re-raster). Returns the
 * device `scale` used so the caller knows the base magnification. */
export async function rasterizePage(pdf, pageNum = 1, { knockout = true, scale } = {}) {
  const n = Math.min(Math.max(1, pageNum | 0), pdf.numPages);
  const page0 = await pdf.getPage(n);
  const base = page0.getViewport({ scale: 1 });
  const s = scale || baseRasterScale(Math.max(base.width, base.height));
  const { canvas } = await renderPageCanvas(pdf, n, s, knockout);
  return { src: canvas.toDataURL("image/png"), imgW: Math.round(base.width), imgH: Math.round(base.height), page: n, scale: s };
}

/* B749 Tier 2 — re-render a page at a higher device `scale` to a TRANSIENT, revocable object
 * URL (the B45 precedent) rather than a multi-MB base64 data URL: the hi-res raster is a
 * session-only detail layer, never persisted, so it must not bloat state / undo / the cloud
 * row. Caller revokes the URL on zoom-out / replace / unmount. Falls back to a data URL if the
 * browser can't produce a blob. Returns { src, imgW, imgH, scale, revoke }. */
export async function rasterizePageHiRes(pdf, pageNum = 1, scale = 2, { knockout = true } = {}) {
  const n = Math.min(Math.max(1, pageNum | 0), pdf.numPages);
  const { canvas, base } = await renderPageCanvas(pdf, n, scale, knockout);
  const src = await new Promise((resolve) =>
    canvas.toBlob
      ? canvas.toBlob((b) => resolve(b && URL.createObjectURL ? URL.createObjectURL(b) : canvas.toDataURL("image/png")), "image/png")
      : resolve(canvas.toDataURL("image/png"))
  );
  const revoke = () => { try { if (typeof src === "string" && src.startsWith("blob:")) URL.revokeObjectURL(src); } catch (_) {} };
  return { src, imgW: Math.round(base.width), imgH: Math.round(base.height), scale, revoke };
}

/* Pure re-raster decision (B749) — given the overlay's current on-screen magnification, pick
 * the device scale to render at. Returns { scale, isHires, magAtBase, capped }. The caller
 * re-rasters only when the ideal scale differs meaningfully from what's loaded, and drops back
 * to the base raster (isHires:false) when zoomed out. Unit-tested; no DOM.
 *   ftPerPx     overlay feet per intrinsic unit (feet per PDF point)
 *   ppf         view pixels per foot
 *   pageMaxPts  the page's longest intrinsic dimension in points
 *   baseScale   the device scale the base raster was rendered at (baseRasterScale)
 */
export function chooseOverlayRasterScale({ ftPerPx, ppf, pageMaxPts, baseScale, maxDim = MAX_RERASTER_DIM, upgradeAt = RERASTER_UPGRADE_AT }) {
  const want = Math.max(1e-9, ftPerPx * ppf);         // raster-px per point to render 1:1 at this zoom
  const bScale = Math.max(1e-9, baseScale);
  const magAtBase = want / bScale;                    // how hard the base raster is being upscaled
  if (!(magAtBase > upgradeAt)) return { scale: bScale, isHires: false, magAtBase, capped: false };
  const cap = maxDim / Math.max(1, pageMaxPts);       // device scale that fills maxDim on the long edge
  const scale = Math.max(bScale, Math.min(want, cap));
  return { scale, isHires: scale > bScale * 1.05, magAtBase, capped: want > cap };
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
 * its sheet size for B73), parse a DXF (B747), or decode an image. */
export async function openOverlayFile(file) {
  if (isPdfFile(file)) {
    const { loadPdf } = await import("../../doc-review/lib/pdf.js"); // shared PDF engine, lazily
    const pdf = await loadPdf(file);
    const r = await rasterizePage(pdf, 1);
    const detectedScale = await readScaleNote(pdf, 1);
    return { ...r, pageCount: pdf.numPages, pdf, detectedScale, sheet: detectSheet(r.imgW, r.imgH) };
  }
  if (isDxfFile(file)) {
    const { openDxfFile } = await import("./dxf/dxfOverlay.js"); // CAD parser lazily (own chunk + worker)
    return openDxfFile(file);
  }
  const { src, w, h } = await loadAndDownscaleImage(file); // PNG/JPG path (reuses the aerial loader)
  return { src, imgW: w, imgH: h, page: 1, pageCount: 1, pdf: null, detectedScale: null, sheet: null };
}

/* Rebuild an overlay's raster from stored PDF bytes (cross-device reload, B72): rasterize
 * the stored page (honouring the reference's knockout choice, B654).
 * Returns { src, imgW, imgH, pageCount } or null. */
export async function rasterizeStoredPdf(bytes, page = 1, opts = {}) {
  try {
    const { loadPdf } = await import("../../doc-review/lib/pdf.js");
    const pdf = await loadPdf(bytes);
    const r = await rasterizePage(pdf, page, opts);
    const out = { src: r.src, imgW: r.imgW, imgH: r.imgH, pageCount: pdf.numPages };
    try { pdf.destroy(); } catch (_) {}
    return out;
  } catch (_) { return null; }
}

/* Rebuild a DXF overlay's raster from stored bytes on reload (B747) — re-renders at the SAME
 * imgW/imgH the record carries so the on-map size is exact. Returns { src, imgW, imgH } or null.
 * Thin wrapper so SitePlanner imports one overlay-raster module. */
export async function rasterizeStoredDxf(bytes, dims) {
  try {
    const { rasterizeStoredDxf: raster } = await import("./dxf/dxfOverlay.js");
    return await raster(bytes, dims);
  } catch (_) { return null; }
}
