/* PDF.js setup + load/render helpers for the Document Review workspace.
 * Browser-only; the worker is bundled as an asset URL (Vite ?url). This whole
 * module rides in the lazy doc-review chunk, so PDF.js never loads until the
 * Document Review workspace is opened. */
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { backingScale } from "./renderBudget.js";

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

/* Render one page into `canvas` at `scale`. Returns the canvas's ON-SCREEN (CSS) px
 * size and the page's base (scale-1) size — markups are stored in base/page units so
 * they survive zoom (multiply by scale to draw). Returns null if `isStale()` reports the
 * render was superseded while we awaited the page (see below).
 *
 * The backing store is rendered `dpr×` the CSS size (capped to a pixel budget — see
 * renderBudget.js) and then sampled by the browser, so text stays sharp at the same
 * on-screen size while a huge sheet at high zoom can't blow up canvas memory. The returned
 * w/h (and the canvas's CSS size) stay at the logical scale× size, so the markup SVG
 * overlay — which positions in page-units × scale — lines up exactly as before. (B247)
 *
 * `isStale` (optional) closes the B40 same-canvas race: `onTask` only hands the cancellable
 * RenderTask back AFTER `getPage` resolves, so two renders that are both still awaiting
 * getPage each find nothing to cancel and would both call page.render() on the one canvas
 * (PDF.js throws "Cannot use the same canvas during multiple render operations"). Checking
 * `isStale()` right before page.render() makes a superseded render bail before it touches
 * the canvas, so only the newest render draws. */
export async function renderPageToCanvas(pdf, pageNum, canvas, scale, onTask, isStale) {
  const page = await pdf.getPage(pageNum);
  if (isStale && isStale()) return null; // a newer render superseded this during getPage — don't touch the canvas (B40)
  const base = page.getViewport({ scale: 1 });
  const dpr = backingScale(base.width, base.height, scale, deviceDpr());
  const viewport = page.getViewport({ scale: scale * dpr });
  const ctx = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);   // dense backing store (scale × dpr, budget-capped)
  canvas.height = Math.floor(viewport.height);
  const cssW = Math.floor(base.width * scale), cssH = Math.floor(base.height * scale); // on-screen size (scale only)
  canvas.style.width = cssW + "px";            // map the dense bitmap into the logical box → crisp
  canvas.style.height = cssH + "px";
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
