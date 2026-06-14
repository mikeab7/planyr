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
export async function renderPageToCanvas(pdf, pageNum, canvas, scale) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const base = page.getViewport({ scale: 1 });
  const ctx = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const task = page.render({ canvasContext: ctx, viewport });
  await task.promise;
  return { w: canvas.width, h: canvas.height, baseW: base.width, baseH: base.height };
}
