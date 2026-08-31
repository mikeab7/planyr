/* Browser-only PDF page → raster image, for OCR (`deedOcr.js`) only.
 *
 * Deliberately a SEPARATE pdf.js setup from `pdfText.js`: that module is text-extraction only and
 * says so in its own header — "no rendering, no OCR — so it needs none of the font/CMap render
 * assets". A scanned deed PDF's page content is (almost always) one big embedded raster image, not
 * vector text, so rendering it needs pdf.js's CANVAS render path, which text extraction doesn't
 * touch. Keeping the two setups apart means the common (non-OCR) PDF path never pays for canvas
 * rendering, and this module — only reached once OCR is actually needed — never pays for anything
 * extra either.
 *
 * Both this module and `deedOcr.js` are reached ONLY via a dynamic `import()` from the "This PDF
 * looks scanned" branch (see `pdfText.js` / `readDeedFile`) — never a static import, so pdf.js's
 * canvas render path and Tesseract's WASM engine never ride the boot bundle.
 */
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Same v6 ESM polyfill pdfText.js installs (Map.prototype.getOrInsertComputed) — idempotent, so
// installing it twice (once from each module, whichever loads first) is harmless.
for (const Ctor of [Map, WeakMap]) {
  if (typeof Ctor.prototype.getOrInsertComputed !== "function") {
    Object.defineProperty(Ctor.prototype, "getOrInsertComputed", {
      value: function getOrInsertComputed(key, cb) {
        if (this.has(key)) return this.get(key);
        const v = cb(key);
        this.set(key, v);
        return v;
      },
      writable: true, configurable: true, enumerable: false,
    });
  }
}

const PDF_BASE_DPI = 72; // pdf.js viewport scale of 1.0 == 72 dpi, by PDF spec

/** Open a PDF (File/Blob/ArrayBuffer) and return its page count, without rendering anything — used
 *  to build the OCR page picker before committing to a (possibly slow) full recognition pass. */
export async function pdfPageCount(fileOrBuffer) {
  const data = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  try { return pdf.numPages || 1; } finally { try { pdf.destroy(); } catch (_) { /* best-effort */ } }
}

/** Render one page of a PDF to a canvas ImageData, at roughly `targetDpi` (default ~300, the
 *  resolution OCR engines are tuned for — screen-scale renders measurably hurt recognition on a
 *  degraded scan, CLAUDE.md item (c)). Returns { imageData, widthPt, heightPt } (page size in PDF
 *  points, for callers that want to relate pixels back to the original page). Caller owns the
 *  transient <canvas> — this creates and discards its own.
 *
 *  `opts.maxLongEdgePx` — optional, additive, unused by the OCR caller: caps the RENDER DPI down
 *  (never up) so the rendered page's long edge never exceeds this many pixels — a large sheet
 *  (e.g. a 24x36" civil site plan) renders at a lower effective DPI instead of an oversized
 *  raster nobody's screen can show. See shared/sitePlans/lib/overlayRasterSize.js, whose
 *  `effectiveRasterDpi` this mirrors — kept separate rather than imported, because this module
 *  must not import anything outside `shared/files/` (see its own OCR-only header). */
export async function renderPdfPageToImageData(fileOrBuffer, pageNum, opts = {}) {
  const targetDpi = opts.targetDpi ?? 300;
  const data = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  try {
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    let dpi = targetDpi;
    if (opts.maxLongEdgePx) {
      const longEdgePt = Math.max(base.width, base.height);
      const capDpi = (opts.maxLongEdgePx / longEdgePt) * PDF_BASE_DPI;
      dpi = Math.min(targetDpi, capDpi);
    }
    const scale = dpi / PDF_BASE_DPI;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // white background — a scanned page's margin, and what adaptiveThreshold expects outside ink
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // release the canvas's backing store now that its pixels are copied out (releaseCanvas.js
    // precedent, site-planner lib) — this module is called once per page across a whole PDF, so a
    // multi-page scan would otherwise hold several megapixel canvases alive at once.
    canvas.width = 0; canvas.height = 0;
    return { imageData, widthPt: base.width, heightPt: base.height };
  } finally {
    try { pdf.destroy(); } catch (_) { /* best-effort */ }
  }
}
