/* Scanned-sheet OCR (B352 — was B340's OCR tail) — fills the dormant OCR seam B336/B337 left wired.
 *
 * Most CAD drawings carry a real text layer (handled free + instant by the deterministic
 * reader). A SCANNED / image-only sheet has none — `extractPageItems` returns [], the page reads
 * hasText:false, and `sheetRead.readSheets` calls this OCR hook. We render the page to a canvas
 * and run Tesseract.js (WASM, in its own worker) to recover the text WITH per-word bounding
 * boxes, then convert those boxes into the SAME `{ str, x, y, w, h }` page-unit items the
 * positional reader (sheetMeta, B336) already consumes — so a scanned page groups, stitches,
 * crops, and calibrates through the identical pipeline as a vector page. Low-confidence words are
 * dropped (consistent with "never auto-guess" — a bad read shouldn't mis-group a set).
 *
 * Browser-only + LAZY: Tesseract is dynamic-imported only when a no-text page is actually hit, so
 * the common (vector) path never loads the ~MB WASM/worker. The model assets are pinned to a CDN
 * (jsDelivr — reachable from Cloudflare Pages; the drawing pixels never leave the browser, only
 * the WASM core + English model are fetched, then browser-cached). All of render / recognize /
 * worker-creation are injectable so the conversion + orchestration are unit-tested without WASM.
 */

// Pinned model/engine assets (jsDelivr). Overridable via createOcrRunner({ cdnBase, version }).
const CDN = "https://cdn.jsdelivr.net/npm";
const TJS_VERSION = "5.1.1";
const ENG_DATA = "@tesseract.js-data/eng@1.0.0/4.0.0"; // dir holding eng.traineddata.gz

// Render-density budget: keep the OCR canvas ≤ ~24 MP (so a big E-size sheet can't blow up
// memory) but at least 1.5× so small title-block text is legible to the recognizer.
const OCR_BUDGET_PX = 24e6, OCR_MIN_SCALE = 1.5, OCR_MAX_SCALE = 4;

/* The page→canvas render scale for OCR, from the page's scale-1 size (points). Bigger pages get
 * a smaller multiplier (memory cap); small pages get the 4× ceiling for crisp text. Pure. */
export function ocrScaleFor(pageW, pageH, budget = OCR_BUDGET_PX) {
  const area = Math.max(1, (pageW || 1) * (pageH || 1));
  return Math.min(OCR_MAX_SCALE, Math.max(OCR_MIN_SCALE, Math.sqrt(budget / area)));
}

/* Flatten a Tesseract result into a flat word list, tolerant of the v5 shape (words may be
 * top-level, or nested blocks→paragraphs→lines→words when recognize is asked for blocks). */
export function extractWords(data) {
  if (!data) return [];
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out = [];
  for (const blk of data.blocks || [])
    for (const par of blk.paragraphs || [])
      for (const ln of par.lines || [])
        for (const wd of ln.words || []) out.push(wd);
  return out;
}

/* Convert Tesseract words (pixel bboxes on a `scale`× canvas) into positioned page-unit items —
 * the exact shape `extractPageItems` returns, so `readSheetMeta` treats them identically. Drops
 * blank, low-confidence, NON-FINITE, and inverted/zero boxes (OCR can emit any of these on a noisy
 * scan; a single NaN coordinate would otherwise poison the whole reader — cf. B348). Pure. */
export function wordsToItems(words, scale, pageW, pageH, minConfidence = 45) {
  const s = (Number.isFinite(scale) && scale > 0) ? scale : 1; // guard 0 / NaN / negative scale
  const items = [];
  for (const w of words || []) {
    if (!w) continue;
    const str = (w.text != null ? String(w.text) : "").trim();
    if (!str) continue;
    const conf = w.confidence;
    if (Number.isFinite(conf) && conf < minConfidence) continue; // a finite low score → drop (missing/NaN conf is kept)
    const b = w.bbox || {};
    const { x0, y0, x1, y1 } = b;
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue; // NaN/Infinity box → drop (never a NaN item)
    if (x1 <= x0 || y1 <= y0) continue;                      // inverted / zero-area box → drop
    items.push({ str, x: x0 / s, y: y0 / s, w: (x1 - x0) / s, h: (y1 - y0) / s, ocr: true });
  }
  return { items, width: Number.isFinite(pageW) ? pageW : 0, height: Number.isFinite(pageH) ? pageH : 0 };
}

// Lazily render a PDF page to an OCR canvas (real pdf.js, imported only when OCR actually runs).
async function defaultRenderPage(doc, pageNum) {
  const { renderPageToOcrCanvas } = await import("./pdf.js");
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = ocrScaleFor(base.width, base.height);
  return renderPageToOcrCanvas(doc, pageNum, scale); // { canvas, baseW, baseH, scale }
}

// Lazily create a Tesseract worker pinned to the CDN assets (drawing pixels stay in the browser;
// only the WASM core + English model are fetched). SPARSE_TEXT suits scattered drawing labels.
async function defaultMakeWorker({ cdnBase = CDN, version = TJS_VERSION, data = ENG_DATA, logger } = {}) {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: `${cdnBase}/tesseract.js@${version}/dist/worker.min.js`,
    corePath: `${cdnBase}/tesseract.js-core@${version}`,
    langPath: `${cdnBase}/${data}`,
    gzip: true,
    logger,
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  return worker;
}

/* An OCR session: `run(doc, pageNum) → { items, width, height }` matching the sheetRead `ocr`
 * seam, and `dispose()` to terminate the worker. The worker is created on the FIRST run only
 * (so a set with no scanned pages never spins one up), then reused across pages. Everything is
 * injectable (`renderPage`, `makeWorker`/`recognize`) so the orchestration is unit-tested without
 * WASM. Fails soft: any error → null, and sheetRead keeps the page as a graceful no-text record. */
export function createOcrRunner(opts = {}) {
  const { renderPage = defaultRenderPage, makeWorker = defaultMakeWorker, recognize, minConfidence, onOcrStart, ...workerCfg } = opts;
  let workerP = null;
  const getRecognizer = async () => {
    if (recognize) return recognize; // injected (tests / a custom engine)
    if (!workerP) { if (onOcrStart) try { onOcrStart(); } catch (_) {} workerP = makeWorker(workerCfg); } // first scanned page → spin up the worker
    const worker = await workerP;
    return (canvas) => worker.recognize(canvas, {}, { blocks: true }).then((r) => r.data);
  };
  const run = async (doc, pageNum) => {
    try {
      const { canvas, baseW, baseH, scale } = await renderPage(doc, pageNum);
      const rec = await getRecognizer();
      const data = await rec(canvas);
      const words = extractWords(data);
      if (!words.length) return null;
      return wordsToItems(words, scale, baseW, baseH, minConfidence);
    } catch (_) { return null; }
  };
  const dispose = async () => {
    if (!workerP) return;
    try { const w = await workerP; if (w && w.terminate) await w.terminate(); } catch (_) { /* best-effort */ }
    workerP = null;
  };
  return { run, dispose };
}
