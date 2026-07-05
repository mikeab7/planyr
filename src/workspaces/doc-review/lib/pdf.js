/* PDF.js setup + load/render helpers for the Document Review workspace.
 * Browser-only; the worker is bundled as an asset URL (Vite ?url). This whole
 * module rides in the lazy doc-review chunk, so PDF.js never loads until the
 * Document Review workspace is opened. */
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { deviceRect } from "./renderBudget.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/* pdf.js v6's modern ESM build calls `Map.prototype.getOrInsertComputed` (a TC39 "upsert" proposal
 * method browsers don't ship yet) in several paths — notably getOptionalContentConfig, which the
 * PDF-layer toggle (B490) needs. Unlike the legacy build, the modern build does NOT bundle the
 * polyfill, so main-thread construction throws "getOrInsertComputed is not a function". Install a
 * minimal, standard-semantics polyfill (idempotent, non-enumerable) before any pdf.js call hits it.
 * Only runs when the lazy doc-review chunk loads. */
for (const Ctor of [Map, WeakMap]) {
  if (typeof Ctor.prototype.getOrInsertComputed !== "function") {
    Object.defineProperty(Ctor.prototype, "getOrInsertComputed", {
      value: function getOrInsertComputed(key, callbackfn) {
        if (this.has(key)) return this.get(key);
        const value = callbackfn(key);
        this.set(key, value);
        return value;
      },
      writable: true, configurable: true, enumerable: false,
    });
  }
}

/* PDF.js v6 ships the support assets it needs to render correctly — substitute fonts for
 * non-embedded text, CMap tables for CID/CJK fonts, an ICC profile for colour-managed
 * (CMYK) images, and the WASM image decoders (JBIG2 for scanned B&W sheets, OpenJPEG for
 * JPEG2000/JPX scans & aerials) — as on-disk folders under pdfjs-dist/. They are NOT bundled
 * into the worker: getDocument must be told where to fetch them, or pdf.js silently degrades
 * (missing glyphs, wrong colours, and — for JBIG2/JPX — images that don't decode AT ALL, since
 * both the WASM and the JS-fallback decoder paths build their URL from `wasmUrl`). The vite
 * `pdfjs-assets` plugin copies these folders to `<base>pdfjs/…` (dev-served + build-emitted), so
 * a root-absolute base (BASE_URL ends in "/") resolves identically on the main thread, inside the
 * worker, and under any deploy subpath. Construction surveys lean on exactly these paths. */
const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL || "/"}pdfjs/`;
const PDFJS_ASSETS = {
  cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
  cMapPacked: true, // the shipped .bcmap files are packed
  standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
  iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
};

const deviceDpr = () => (typeof window !== "undefined" && window.devicePixelRatio) || 1;

export async function loadPdf(fileOrBuffer) {
  const data = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
  // useSystemFonts:false — render non-embedded fonts from the shipped standardFontDataUrl substitutes
  // instead of the viewer's local system fonts, so a construction sheet renders identically on every
  // machine (B489c). Harmless to the text-extraction callers below (they never rasterize).
  return pdfjsLib.getDocument({ data, useSystemFonts: false, ...PDFJS_ASSETS }).promise;
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
    // Map every run through the VIEWPORT transform (B653). pdf.js reports text transforms in raw
    // PDF user space, but real CAD exports routinely store the sheet ROTATED (/Rotate 90/180/270 —
    // the owner's GPL set is saved upside-down, Mesa at 270°) and/or with a shifted MediaBox
    // origin (Jacintoport starts at −1296,−864). Every viewer displays through the viewport, so
    // reading raw coordinates put the title block on the wrong edge and broke band/zone/title
    // logic on MOST real files. Composing with vp.transform yields coordinates that match what a
    // human sees: top-left origin, y down — for any rotation and origin.
    const V = vp.transform; // [a,b,c,d,e,f]: user space → viewport (y-down) space
    const items = [];
    for (const it of tc.items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      // M = V · t (pdf.js matrix convention: apply([a,b,c,d,e,f],(x,y)) = (ax+cy+e, bx+dy+f)).
      const M = [
        V[0] * t[0] + V[2] * t[1], V[1] * t[0] + V[3] * t[1],
        V[0] * t[2] + V[2] * t[3], V[1] * t[2] + V[3] * t[3],
        V[0] * t[4] + V[2] * t[5] + V[4], V[1] * t[4] + V[3] * t[5] + V[5],
      ];
      const bl = Math.hypot(M[0], M[1]) || 1;                 // baseline scale (1 at scale-1 viewports)
      const fontH = Math.hypot(M[2], M[3]) || it.height || 0; // visual type size
      const len = (it.width || 0) * (bl / (Math.hypot(t[0], t[1]) || 1)); // run length on screen
      const ux = M[0] / bl, uy = M[1] / bl;                   // baseline direction (viewport)
      const vx = fontH ? M[2] / fontH : 0, vy = fontH ? M[3] / fontH : -1; // glyph-up direction
      // The run's axis-aligned box from its 4 corners: baseline start, +len along the baseline,
      // +fontH along glyph-up, and both.
      const xs = [M[4], M[4] + len * ux, M[4] + vx * fontH, M[4] + len * ux + vx * fontH];
      const ys = [M[5], M[5] + len * uy, M[5] + vy * fontH, M[5] + len * uy + vy * fontH];
      const x = Math.min(...xs), y = Math.min(...ys);
      const box = { str, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      if (Math.abs(uy) > Math.abs(ux)) {
        // VERTICAL run (rotated ±90° relative to the VIEW — e.g. a title running up the block's
        // edge). `up` = reads bottom→top on screen; `fontH` = the visual type size, since for a
        // vertical run `h` is its LENGTH. The line reconstruction joins multi-run vertical titles
        // in true reading order using these.
        items.push({ ...box, vert: true, up: uy < 0, fontH });
      } else {
        items.push(box);
      }
    }
    return { items, width: vp.width, height: vp.height };
  } catch (_) {
    return { items: [], width: 0, height: 0 };
  }
}

/* Render a page — or just a sub-rectangle of it — into `canvas`, DOUBLE-BUFFERED (B414/B415).
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
export async function renderInto(pdf, pageNum, canvas, { scale = 1, density = 1, region = null, optionalContentConfig, onTask, isStale } = {}) {
  const page = await pdf.getPage(pageNum);
  if (isStale && isStale()) return null; // superseded during getPage — don't touch the canvas (B40)
  const base = page.getViewport({ scale: 1 });
  const S = scale * density;                                   // device-px per page-unit
  const rx = region ? region.rx : 0, ry = region ? region.ry : 0;
  const rw = region ? region.rw : base.width, rh = region ? region.rh : base.height;
  const { ox, oy, bw, bh } = deviceRect({ rx, ry, rw, rh }, S); // exact integer region in device px (B489a)
  const off = document.createElement("canvas");              // off-screen buffer (never shown blank)
  off.width = bw; off.height = bh;
  const viewport = page.getViewport({ scale: S });
  const params = { canvasContext: off.getContext("2d"), viewport };
  if (region) params.transform = [1, 0, 0, 1, -ox, -oy];     // bring the region's top-left to (0,0); canvas clips the rest
  // B490: apply the retained OptionalContentConfig so hidden PDF layers stay hidden in this raster.
  // Omitted (undefined) → pdf.js uses the doc's authored default, identical to the pre-B490 behaviour.
  if (optionalContentConfig) params.optionalContentConfigPromise = Promise.resolve(optionalContentConfig);
  const task = page.render(params);
  if (onTask) onTask(task); // expose the RenderTask so the caller can cancel a superseded render (B40)
  await task.promise;
  if (isStale && isStale()) return null; // a newer render won while we rasterised — don't blit a stale frame
  if (canvas.width !== bw) canvas.width = bw;   // guard skips a needless clear when dims are unchanged
  if (canvas.height !== bh) canvas.height = bh;
  canvas.getContext("2d").drawImage(off, 0, 0); // same synchronous tick as the resize → no visible blank (B414)
  // B489a: return the DEVICE-ROUNDED region (back in page units) so the caller sizes/places the detail
  // tile on exact device-pixel edges — the detail canvas then aligns to the backdrop with no sub-pixel seam.
  return { baseW: base.width, baseH: base.height, w: bw, h: bh, region: { rx: ox / S, ry: oy / S, rw: bw / S, rh: bh / S }, density: S };
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

/* Render a page to raw ImageData at `scale` for the match-line refiner (B413). Returns
 * { data:ImageData, baseW, baseH, scale }. The canvas is discarded; the caller binarizes the
 * ImageData and drops it. Scale ~2 keeps the dashed match line legible to the pixel fitter. */
export async function renderPageToImageData(pdf, pageNum, scale = 2) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: ctx, viewport }).promise;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, baseW: base.width, baseH: base.height, scale };
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
