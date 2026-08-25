/* Browser-only PDF → deed text (embedded text layer, via pdf.js).
 *
 * Survey/legal-description PDFs from CAD & survey software (Bluebeam, Carlson, AutoCAD…) carry a
 * REAL vector text layer, so we can pull the metes-and-bounds text out exactly — no OCR, no API,
 * no cloud — using pdf.js, the same engine the Document Review workspace already uses. This
 * module is loaded LAZILY (a dynamic import from readDeedFile) only when a PDF is actually
 * dropped, so pdf.js never enters the Site Planner bundle for the common .docx / .txt / .doc drop.
 *
 * It mirrors the minimal pdf.js setup from doc-review/lib/pdf.js (worker URL + the v6
 * getOrInsertComputed polyfill) but is self-contained in shared/ so it doesn't reach across into
 * a workspace. Text-extraction only — no rendering, no OCR — so it needs none of the font/CMap
 * render assets. A scanned / image-only PDF (no text layer) yields ~nothing and we throw a
 * friendly error rather than return an empty string (LOUD-FAILURE) — that error carries a
 * `.scanned = true` marker so `readDeeds` (SitePlanner.jsx) can offer `deedOcr.js`'s OCR fallback
 * instead of just showing the refusal (a county-recorded deed is almost always a scanned image, so
 * this is the common case for that document class, not an edge case). A survey EXHIBIT drawing (a
 * plat sheet with only a title block, no written description) extracts fine but yields no courses
 * — the deed intake then honestly reports "no bearing/distance calls", which is correct. */
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js v6's modern ESM build calls Map.prototype.getOrInsertComputed (a not-yet-shipped TC39
// method) on some paths; unlike the legacy build it doesn't bundle the polyfill. Install a
// minimal, standard-semantics one (idempotent, non-enumerable) so construction can't throw.
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

/* One page → its VISUAL lines. pdf.js flags each run's end-of-line (`hasEOL`); a space is inserted
 * between same-line runs so words never jam. */
async function pageLines(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const tc = await page.getTextContent();
  const lines = [];
  let cur = "";
  for (const it of tc.items) {
    if (typeof it.str === "string" && it.str) {
      cur += it.str;
      if (!it.hasEOL && !/\s$/.test(it.str)) cur += " ";
    }
    if (it.hasEOL) { lines.push(cur); cur = ""; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Split out to deedTextReflow.js (B747, then generalized for OCR) so deedOcr.js can reuse the same
// wrapped-line rejoin without pulling in this module's pdf.js text-extraction setup. Imported (not
// a bare `export … from`, which would leave no LOCAL binding for the call below to reach — the
// `screeningBfe.js` trap) then re-exported, so nothing that already imports `reflowLines` from this
// module needs to change.
import { reflowLines } from "./deedTextReflow.js";
export { reflowLines };

/* Read a PDF (File / Blob / ArrayBuffer) into deed text. Throws a friendly error for a scanned
 * (no-text-layer) PDF. Async; used by readDeedFile via a lazy import. */
export async function pdfToDeedText(fileOrBuffer) {
  const data = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
  let pdf;
  try {
    // useSystemFonts:false keeps extraction deterministic; no render assets are needed for text.
    pdf = await pdfjsLib.getDocument({ data, useSystemFonts: false }).promise;
  } catch (_) {
    throw new Error("Couldn't open that PDF — it may be corrupt or password-protected. Paste the description, or drop the Word (.doc/.docx) file.");
  }
  try {
    let lines = [];
    for (let p = 1; p <= (pdf.numPages || 1); p++) lines = lines.concat(await pageLines(pdf, p));
    const text = reflowLines(lines).replace(/\n{3,}/g, "\n\n").trim();
    if (text.replace(/\s+/g, "").length < 20) {
      const err = new Error("This PDF looks scanned (no selectable text) — paste the description, or drop the Word (.doc/.docx) file.");
      err.scanned = true; // lets a caller offer OCR instead of just showing the refusal (deedOcr.js)
      throw err;
    }
    return text;
  } finally {
    try { pdf.destroy(); } catch (_) { /* best-effort */ }
  }
}
