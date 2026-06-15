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

/* Render one page into `canvas` at `scale`. Returns the canvas px size and the
 * page's base (scale-1) size — markups are stored in base/page units so they
 * survive zoom (multiply by scale to draw). */
export async function renderPageToCanvas(pdf, pageNum, canvas, scale, onTask) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const base = page.getViewport({ scale: 1 });
  const ctx = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const task = page.render({ canvasContext: ctx, viewport });
  if (onTask) onTask(task); // expose the RenderTask so the caller can cancel a superseded render (B40)
  await task.promise;
  return { w: canvas.width, h: canvas.height, baseW: base.width, baseH: base.height };
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
