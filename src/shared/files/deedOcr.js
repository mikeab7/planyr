/* OCR a scanned deed PDF into editable legal-description text — client-side only (Tesseract.js WASM
 * runs locally in the browser; the deed image never leaves the machine — only the generic, public
 * English language model is fetched over the network, exactly like any other client-side OCR tool).
 *
 * Reached ONLY from the "This PDF looks scanned" branch (`pdfText.js` / `readDeedFile` in
 * SitePlanner.jsx) via a dynamic `import()` — never a static import, so Tesseract's WASM engine (a
 * multi-megabyte download) and pdf.js's canvas render path never ride the boot bundle, and every
 * OTHER deed-text path (paste, .docx, .doc, a real-text-layer PDF) is completely untouched.
 *
 * THE CENTRAL DESIGN DECISION (owner spec): this returns text for the CALLER to pre-fill an
 * EDITABLE box — it never plots anything itself. OCR reliably mangles exactly the characters that
 * carry a bearing's meaning, so the output is always a draft for a human to review, never a
 * plot-ready result. Two things ride alongside the text for that review: per-word confidence
 * (`ocrConfidence.locateWordSpans`, so the caller can highlight what to look at first) and the
 * closure error the caller computes after parsing (the real safety net — CLAUDE.md item (f)).
 */
import {
  flagSuspectDistances, canonicalizeOcrWord,
  fixSurveyKeywords, fixWordMerges, normalizeOcrPunctuation, fixDoubledDegreeSign, fixQuadrantGlyphs,
} from "./deedOcrRepair.js";
import { locateWordSpans, lowConfidenceSpans, culpritCalls } from "./ocrConfidence.js";
import { preprocessPage } from "./imagePreprocess.js";
import { reflowLines } from "./deedTextReflow.js";

const DEFAULT_TARGET_DPI = 300; // CLAUDE.md item (c) — screen-scale rendering measurably hurts OCR
const DEFAULT_MAX_PAGES = 40;   // well above "twenty pages of boilerplate" (item d), a sane hard cap

/* Repair a page's raw OCR text AND reflow its wrapped visual lines back into one line per course —
 * the same problem `pdfText.js` solves for a text-layer PDF (deedTextReflow.js's header explains
 * why), which a scanned page needs just as much: Tesseract's line breaks follow the PRINTED layout,
 * so a long course that wraps across several lines splits into unparseable fragments unless rejoined
 * first. Order matters: `fixSurveyKeywords` runs BEFORE the reflow so a mangled "THENGE" is already
 * canonical THENCE when `reflowLines`' COURSE_START heuristic looks for it — reflowing first would
 * fail to recognize a misread course-starting keyword and wrongly fold it into the previous line. */
function repairAndReflow(rawText) {
  const kw = fixSurveyKeywords(rawText || "");
  const reflowed = reflowLines(kw.text.split(/\r?\n/));
  const w = fixWordMerges(reflowed);
  const p = normalizeOcrPunctuation(w.text);
  const d = fixDoubledDegreeSign(p.text);
  const q = fixQuadrantGlyphs(d.text);
  return {
    text: q.text,
    changes: { keywords: kw.count, wordMerges: w.count, punctuation: p.count, doubledDegreeSign: d.count, quadrantGlyphs: q.count },
  };
}

// Tesseract's ImageLike type doesn't include a bare ImageData — hand it a real canvas instead.
function binaryToCanvas(binary, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  for (let i = 0, j = 0; i < binary.length; i++, j += 4) {
    const v = binary[i];
    img.data[j] = v; img.data[j + 1] = v; img.data[j + 2] = v; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Tesseract's word data nests block > paragraph > line > word — flatten to reading order.
function flattenWords(blocks) {
  const out = [];
  for (const b of blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        for (const w of l.words || []) out.push(w);
      }
    }
  }
  return out;
}

function meanConfidence(words) {
  if (!words || !words.length) return null;
  let sum = 0;
  for (const w of words) sum += (typeof w.confidence === "number" ? w.confidence : 0);
  return sum / words.length;
}

/** Race a promise against an AbortSignal; on abort, call `onAbort` (e.g. terminate the worker) and
 *  resolve with `{ aborted: true }` instead of hanging or throwing. */
function withAbort(promise, signal, onAbort) {
  if (!signal) return promise.then((value) => ({ aborted: false, value }));
  return new Promise((resolve) => {
    if (signal.aborted) { onAbort && onAbort(); resolve({ aborted: true }); return; }
    const onSignal = () => { onAbort && onAbort(); resolve({ aborted: true }); };
    signal.addEventListener("abort", onSignal, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onSignal); resolve({ aborted: false, value }); },
      () => { signal.removeEventListener("abort", onSignal); resolve({ aborted: true }); }, // a killed worker rejects the in-flight job — that IS the cancellation, not a failure to report
    );
  });
}

/** OCR a (scanned) PDF File/Blob into deed text.
 *
 *  opts:
 *    pages       — 1-based page numbers to read (default: every page, up to maxPages)
 *    maxPages    — hard cap on pages read when `pages` isn't given (default 40)
 *    targetDpi   — render resolution (default 300 — CLAUDE.md item (c))
 *    onProgress  — ({ page, index, of, pct, status }) => void, called as each page advances
 *    signal      — AbortSignal; cancels between (and, best-effort, during) pages
 *
 *  Returns:
 *    { text, pages: [{ pageNum, text, rawText, changes, meanConfidence }], wordSpans, cancelled,
 *      pageCount, pagesRead }
 *  `wordSpans` is every word's { start, end, confidence } in the FINAL concatenated `text`'s
 *  coordinate space (pages joined with a blank line) — feed it to `ocrConfidence.lowConfidenceSpans`
 *  for highlighting, and `flagSuspectDistances(text)` alongside it for the closure safety net. */
export async function ocrScannedDeedPdf(file, opts = {}) {
  const { pdfPageCount, renderPdfPageToImageData } = await import("./pdfRaster.js");
  const { createWorker } = await import("tesseract.js");
  // opts.tesseractOptions is a plain passthrough (workerPath/corePath/langPath/…) — undefined in
  // production, so Tesseract's own default (fetch its worker/WASM core/English language data from
  // the jsdelivr CDN) is untouched. It exists so a test harness can point these at same-origin
  // fixtures instead of a real CDN (ui-audit/verify-ocr-scanned-deed.mjs — the sandbox this repo's
  // tests run in intercepts external TLS in a way that breaks a Worker's `importScripts` load of a
  // remote script specifically; same-origin/loopback traffic isn't intercepted at all).
  const tesseractOptions = opts.tesseractOptions || {};

  const pageCount = await pdfPageCount(file);
  const pageList = (opts.pages && opts.pages.length)
    ? opts.pages.filter((n) => n >= 1 && n <= pageCount)
    : Array.from({ length: Math.min(pageCount, opts.maxPages ?? DEFAULT_MAX_PAGES) }, (_, i) => i + 1);

  let currentPageLoggerBase = 0;
  const report = (pageIdx, status, pct) => {
    if (!opts.onProgress) return;
    opts.onProgress({ page: pageList[pageIdx], index: pageIdx + 1, of: pageList.length, status, pct: pct ?? 0 });
  };

  const worker = await createWorker("eng", 1, {
    ...tesseractOptions,
    logger: (m) => {
      if (m && m.status === "recognizing text") report(currentPageLoggerBase, m.status, m.progress);
    },
  });

  const pageResults = [];
  let cancelled = false;
  try {
    for (let i = 0; i < pageList.length; i++) {
      if (opts.signal && opts.signal.aborted) { cancelled = true; break; }
      currentPageLoggerBase = i;
      report(i, "rendering", 0);
      const { imageData } = await renderPdfPageToImageData(file, pageList[i], { targetDpi: opts.targetDpi ?? DEFAULT_TARGET_DPI });
      const pre = preprocessPage(imageData);
      const canvas = binaryToCanvas(pre.data, pre.width, pre.height);
      report(i, "recognizing text", 0);
      const raced = await withAbort(
        worker.recognize(canvas, {}, { text: true, blocks: true }),
        opts.signal,
        () => { worker.terminate().catch(() => {}); },
      );
      canvas.width = 0; canvas.height = 0; // release the backing store — releaseCanvas.js precedent
      if (raced.aborted) { cancelled = true; break; }
      const page = raced.value.data;
      pageResults.push({ pageNum: pageList[i], rawText: page.text || "", words: flattenWords(page.blocks) });
      report(i, "recognizing text", 1);
    }
  } finally {
    if (!cancelled) { try { await worker.terminate(); } catch (_) { /* best-effort */ } }
  }

  let text = "";
  const pages = [];
  const wordSpans = [];
  for (const pr of pageResults) {
    const { text: repaired, changes } = repairAndReflow(pr.rawText);
    if (text) text += "\n\n";
    const baseOffset = text.length;
    text += repaired;
    // localWordSpans is offset 0 (this page's own text) — the page picker loads just this page's
    // text into the box, so it needs spans in THAT string's coordinates, not the full-text ones.
    const localWordSpans = locateWordSpans(repaired, pr.words, { lookupAlt: canonicalizeOcrWord });
    wordSpans.push(...localWordSpans.map((s) => ({ ...s, start: s.start + baseOffset, end: s.end + baseOffset })));
    pages.push({ pageNum: pr.pageNum, text: repaired, rawText: pr.rawText, changes, meanConfidence: meanConfidence(pr.words), wordSpans: localWordSpans });
  }

  return { text, pages, wordSpans, cancelled, pageCount, pagesRead: pageResults.map((p) => p.pageNum) };
}

/** The rest of the OCR review surface, re-exported here so a caller (SitePlanner.jsx) needs only
 *  ONE dynamic import to reach everything it needs — the moment `ocrScannedDeedPdf` resolves, these
 *  are already in memory, so there's no reason to ALSO statically import `ocrConfidence.js` /
 *  `deedOcrRepair.js` into the boot bundle (which would duplicate their code into the always-loaded
 *  Site route chunk for functions only ever called once OCR data exists).
 *  `flagSuspectDistances` — the closure safety net's other half (CLAUDE.md item (f)): a lost decimal
 *  point, which per-character confidence alone won't catch (Tesseract can be perfectly confident
 *  about digits it read correctly while the POINT itself vanished off the scan).
 *  `lowConfidenceSpans` / `culpritCalls` — filter word spans by confidence, and correlate a bad
 *  closure with the specific calls most likely to blame. */
export { flagSuspectDistances, lowConfidenceSpans, culpritCalls };
