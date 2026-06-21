/* PDF.js setup + load/render helpers for the Document Review workspace.
 * Browser-only; the worker is bundled as an asset URL (Vite ?url). This whole
 * module rides in the lazy doc-review chunk, so PDF.js never loads until the
 * Document Review workspace is opened. */
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

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

/* Pick how dense to render the canvas backing store. We draw at the device's pixel
 * ratio (so note text is crisp on HiDPI / Retina screens instead of a blurry upscale),
 * but cap it to a pixel budget so a big E-size sheet at high zoom can't blow up canvas
 * memory. Never below 1× — i.e. never worse than a plain render. (B247) */
function backingScale(baseW, baseH, scale) {
  const cssW = Math.max(1, baseW * scale), cssH = Math.max(1, baseH * scale);
  const want = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
  const budget = Math.sqrt(24e6 / (cssW * cssH)); // ≤ ~24 MP backing store (~96 MB RGBA)
  return Math.max(1, Math.min(want, budget));
}

/* Render one page into `canvas` at `scale`. Returns the canvas's ON-SCREEN (CSS) px
 * size and the page's base (scale-1) size — markups are stored in base/page units so
 * they survive zoom (multiply by scale to draw).
 *
 * The backing store is rendered `dpr×` denser than the CSS size and then sampled down by
 * the browser, so text stays sharp at the same on-screen size. The returned w/h (and the
 * canvas's CSS size) stay at the logical scale× size, so the markup SVG overlay — which
 * positions in page-units × scale — lines up exactly as before. (B247) */
export async function renderPageToCanvas(pdf, pageNum, canvas, scale, onTask, setCssSize = true) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const dpr = backingScale(base.width, base.height, scale);
  const viewport = page.getViewport({ scale: scale * dpr });
  const ctx = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);   // dense backing store (scale × dpr)
  canvas.height = Math.floor(viewport.height);
  const cssW = Math.floor(base.width * scale), cssH = Math.floor(base.height * scale); // on-screen size (scale only)
  // When the caller drives display size itself (the Markup transform viewport sizes the
  // canvas to 100% of a CSS-scaled page box so a zoom gesture can rescale the already-
  // rendered bitmap without re-rasterising), skip setting the canvas's own CSS box. (B326)
  if (setCssSize) {
    canvas.style.width = cssW + "px";          // map the dense bitmap into the logical box → crisp
    canvas.style.height = cssH + "px";
  }
  const task = page.render({ canvasContext: ctx, viewport });
  if (onTask) onTask(task); // expose the RenderTask so the caller can cancel a superseded render (B40)
  await task.promise;
  return { w: cssW, h: cssH, baseW: base.width, baseH: base.height };
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
