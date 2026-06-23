/* PDF.js setup + load/render helpers for the Document Review workspace.
 * Browser-only; the worker is bundled as an asset URL (Vite ?url). This whole
 * module rides in the lazy doc-review chunk, so PDF.js never loads until the
 * Document Review workspace is opened. */
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const deviceDpr = () => (typeof window !== "undefined" && window.devicePixelRatio) || 1;

export async function loadPdf(fileOrBuffer) {
  const data = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
  return pdfjsLib.getDocument({ data }).promise;
}

/* Pull a page's embedded text as one string (for stated-scale / title-block reads, B267).
 * CAD-origin PDFs carry real vector text, so this is exact + cheap. Returns "" if the page
 * has no embedded text (a scanned/raster sheet) — the caller's cue to fall back to OCR. */
export async function extractPageText(pdf, pageNum) {
  try {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    return tc.items.map((i) => i.str).join(" ");
  } catch (_) {
    return "";
  }
}

/* Pull the first `maxPages` pages' embedded text as one joined string — the title block / cover
 * identifies the project & set (the filing read, B312). The ONE embedded-text reader (B360):
 * localRead's own first-pages loop folded into here so the doc-review workspace has a single
 * extractor. Accepts a File/Blob/ArrayBuffer (loads + destroys its own pdf) OR an already-loaded
 * pdf (reads it, leaves the caller's pdf open). Returns "" for a scanned/no-text set. */
export async function firstPagesText(fileOrPdf, maxPages = 2) {
  const owned = !(fileOrPdf && typeof fileOrPdf.getPage === "function");
  const pdf = owned ? await loadPdf(fileOrPdf) : fileOrPdf;
  try {
    const n = Math.min(maxPages, pdf.numPages || 1);
    const parts = [];
    for (let p = 1; p <= n; p++) parts.push(await extractPageText(pdf, p));
    return parts.join(" ");
  } finally {
    if (owned) { try { pdf.destroy(); } catch (_) { /* best-effort */ } }
  }
}

/* Pull EVERY page's embedded text as an array of per-page strings — the multi-discipline filing
 * read (2026-06-23) classifies each page on its own so a combined PDF (a make-ready package, a full
 * IFC binding C-/A-/S-/M-/E-/P- sheets together) files into the right discipline(s) instead of being
 * stamped with whatever its first page showed. Text-only (no rendering), so even a long set is cheap.
 * Accepts a File/Blob/ArrayBuffer (loads + destroys its own pdf) OR an already-loaded pdf. A page
 * with no embedded text contributes "" (its `hasText:false` flows through to the splitter). */
export async function extractAllPagesText(fileOrPdf, maxPages = Infinity) {
  const owned = !(fileOrPdf && typeof fileOrPdf.getPage === "function");
  const pdf = owned ? await loadPdf(fileOrPdf) : fileOrPdf;
  try {
    const n = Math.min(maxPages, pdf.numPages || 1);
    const out = [];
    for (let p = 1; p <= n; p++) out.push(await extractPageText(pdf, p));
    return out;
  } finally {
    if (owned) { try { pdf.destroy(); } catch (_) { /* best-effort */ } }
  }
}

/* Pull a page's embedded text WITH per-item positions (B336) — the sheet-metadata reader
 * needs to know WHERE each string sits to find the title-block band, the sheet title, and
 * the match-line labels (a plain joined string can't). pdf.js gives each text run a
 * transform [a,b,c,d,e,f] (e,f = baseline x,y in PDF user space, origin BOTTOM-left) plus a
 * width/height; we convert to a TOP-left origin so the coordinates line up with the rendered
 * canvas / SVG (y grows downward there). Returns { items:[{ str,x,y,w,h }], width, height }
 * in page units (scale-1 points). Empty items[] for a scanned/raster page (no text layer). */
export async function extractPageItems(pdf, pageNum) {
  try {
    const page = await pdf.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      const h = it.height || Math.hypot(t[2], t[3]) || 0;
      const w = it.width || 0;
      // f = baseline from the bottom; the glyph box top in top-left coords is height − (f + h).
      items.push({ str, x: t[4], y: Math.max(0, vp.height - t[5] - h), w, h });
    }
    return { items, width: vp.width, height: vp.height };
  } catch (_) {
    return { items: [], width: 0, height: 0 };
  }
}

/* Render a page — or just a sub-rectangle of it — into `canvas`, DOUBLE-BUFFERED (B412/B413).
 *
 * Reassigning a visible canvas's width/height clears it to transparent, which (with a white
 * page box behind) flashes white for the async gap until pdf.js refills it. So we rasterise
 * into an OFF-SCREEN canvas and blit the finished frame onto the visible canvas in one
 * synchronous step — the compositor never sees the cleared canvas, so a zoom/pan settle
 * re-raster never flashes. Off-screen rendering also sidesteps the B40 "same canvas during
 * multiple render operations" throw (each render owns a fresh off-screen canvas), but we
 * still bail on `isStale()` so a superseded render neither blits a stale frame nor fights
 * the newest one.
 *
 * Two layers drive this (see renderBudget.js):
 *   • backdrop — whole page (region=null), a fixed zoom-independent `density`, once per page.
 *   • detail   — a `region` (page-unit rect) at full device `density`, re-rastered on settle.
 * `scale` × `density` = device-px per page-unit. For a region we render the full-page viewport
 * but translate so the region's top-left lands at the canvas origin; the canvas bounds clip the
 * rest. The visible canvas's CSS box is driven by the caller (page box × view.scale), so the
 * markup SVG overlay — page-units × scale — lines up exactly as before. Returns the rastered
 * region + base size, or null if superseded. */
export async function renderInto(pdf, pageNum, canvas, { scale = 1, density = 1, region = null, onTask, isStale } = {}) {
  const page = await pdf.getPage(pageNum);
  if (isStale && isStale()) return null; // superseded during getPage — don't touch the canvas (B40)
  const base = page.getViewport({ scale: 1 });
  const S = scale * density;                                   // device-px per page-unit
  const rx = region ? region.rx : 0, ry = region ? region.ry : 0;
  const rw = region ? region.rw : base.width, rh = region ? region.rh : base.height;
  const ox = Math.round(rx * S), oy = Math.round(ry * S);
  const bw = Math.max(1, Math.round((rx + rw) * S) - ox);     // exact integer region in device px
  const bh = Math.max(1, Math.round((ry + rh) * S) - oy);
  const off = document.createElement("canvas");              // off-screen buffer (never shown blank)
  off.width = bw; off.height = bh;
  const viewport = page.getViewport({ scale: S });
  const params = { canvasContext: off.getContext("2d"), viewport };
  if (region) params.transform = [1, 0, 0, 1, -ox, -oy];     // bring the region's top-left to (0,0); canvas clips the rest
  const task = page.render(params);
  if (onTask) onTask(task); // expose the RenderTask so the caller can cancel a superseded render (B40)
  await task.promise;
  if (isStale && isStale()) return null; // a newer render won while we rasterised — don't blit a stale frame
  if (canvas.width !== bw) canvas.width = bw;   // guard skips a needless clear when dims are unchanged
  if (canvas.height !== bh) canvas.height = bh;
  canvas.getContext("2d").drawImage(off, 0, 0); // same synchronous tick as the resize → no visible blank (B412)
  return { baseW: base.width, baseH: base.height, w: bw, h: bh, region: { rx, ry, rw, rh }, density: S };
}

/* Rasterize a page to a PNG data URL (for the stitcher — placed as an <image> and
 * transformed on a shared canvas). `baseW/baseH` are the page units the markup/
 * transform math uses; the image is rendered at `scale`× for crispness. */
export async function renderPageToImage(pdf, pageNum, scale = 2) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const base = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  // Object URL (revocable) instead of a multi-MB base64 data URL held in state (B45);
  // the stitcher revokes it on remove/replace/unmount. Fall back to a data URL if the
  // browser can't produce a blob.
  const href = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : canvas.toDataURL("image/png")), "image/png")
  );
  return { href, baseW: base.width, baseH: base.height };
}

/* Render a page to an offscreen <canvas> at EXACTLY `scale` (no devicePixelRatio fiddling) for
 * OCR (B340). The returned canvas's pixel coords are page-points × scale, so a word's pixel
 * bbox ÷ scale maps straight back to scale-1 page units — the same frame `extractPageItems`
 * uses, so an OCR'd scanned page feeds the metadata reader identically to a text page.
 * `willReadFrequently` hints the 2D context for the pixel reads Tesseract does. */
export async function renderPageToOcrCanvas(pdf, pageNum, scale) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d", { willReadFrequently: true }), viewport }).promise;
  return { canvas, baseW: base.width, baseH: base.height, scale };
}
