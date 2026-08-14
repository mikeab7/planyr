/* layerVisibilityReads — WHICH PDF RENDERS MUST HONOUR THE LAYER TOGGLE, AND WHICH MUST NOT.
 *
 * ⛔ THE SHAPE OF "HIDDEN" IN THIS WORKSPACE, established before anything was built, because the
 * site planner's model does NOT transfer and assuming it would have produced the wrong audit.
 *
 * The planner's question was: which reads of a collection WE own forget to ask a visibility
 * predicate (B3296, B494048–B494051). **That question is degenerate in Doc Review.** Markups carry
 * no visibility flag at all — the shared markup engine has no `hidden`, no per-object filter, no
 * layer assignment — so there is no predicate for a read to forget. What scoping markups DO have is
 * the PAGE, and the paths that matter are already page-scoped deliberately, each with its reason
 * written where it lives: `pageMarks` is the draw set, `eraseInBox` guards `m.page !== page`, the
 * B569 multi-selection net drops off-page ids, and `arrange.js` derives same-page peers internally.
 * Those are correct and are named here so a later session can tell "checked" from "nobody looked".
 *
 * The ONE real hide is the PDF optional-content ("layer") toggle (B490), and it is a different
 * mechanism entirely:
 *   · it hides part of the immutable PDF BACKDROP, never anything in our model;
 *   · pdf.js performs the hiding, through the `OptionalContentConfig` passed to `page.render`;
 *   · it is ephemeral — the group ids are per-load refs, so no visibility state is persisted.
 *
 * So the only way our code can get it wrong is to render a page without that config — or to serve a
 * CACHED raster made before the toggle, which is what B503184 turned out to be.
 *
 * ── ⛔ THE HONEST LIMIT ON ALL OF THIS ──────────────────────────────────────────────────────────
 * Whether the owner's own drawings carry optional content is UNKNOWN from the sandbox: his source
 * PDFs live in Supabase Storage / Drive and the bytes are not reachable (SQL reaches the metadata
 * rows, never the objects). If none of them has layers, the Layers control never appears for him and
 * this whole surface is empty in practice. That is the first question of the hand-check, not
 * something any code here can answer.
 */

export const VERDICT = Object.freeze({
  MUST_HONOUR: "must-honour-layer-visibility",
  CORRECT_WITHOUT: "correct-without-layer-config",
});

const H = VERDICT.MUST_HONOUR;
const C = VERDICT.CORRECT_WITHOUT;

/** Every `page.render(...)` in the workspace, judged. */
export const RENDER_PATHS = Object.freeze([
  { name: "renderInto", file: "lib/pdf.js", verdict: H,
    why: "The one parameterised renderer. Both Review-mode canvases go through it, and it forwards `optionalContentConfig` as `optionalContentConfigPromise` when the caller supplies one." },
  { name: "renderPageToImage", file: "lib/pdf.js", verdict: C,
    why: "The STITCHER's sheet raster. Stitch mode is a separate component with its own separately-loaded documents and no Layers control, so there is no visibility state for it to honour — the Review-mode config belongs to a different pdf.js document object entirely." },
  { name: "renderPageToImageData", file: "lib/pdf.js", verdict: C,
    why: "Raw pixels for the match-line refiner (B413) and the compare register. A geometric fitter reading the drawing to locate a seam must see the sheet as authored; a view filter set in another mode must not move stitch geometry." },
  { name: "renderPageToOcrCanvas", file: "lib/pdf.js", verdict: C,
    why: "OCR for sheet-metadata extraction. Extraction must read everything the document contains — hiding a layer is about what you are looking at, never about what the document says." },
]);

/** The markup paths whose PAGE scoping was checked, and the verdict for each. */
export const MARKUP_PAGE_SCOPING = Object.freeze([
  { name: "pageMarks", scoped: true, why: "The draw set — markups filtered to the sheet on screen. This is the seam the page scope is applied at." },
  { name: "eraseInBox", scoped: true, why: "Guards `m.page !== page` before erasing, so an eraser stroke cannot reach a markup on another sheet at the same page coordinates." },
  { name: "multiSelectNet", scoped: true, why: "B569 — drops multi-selection ids that are not on the current page, so a group operation cannot act on an off-screen sheet." },
  { name: "arrangeFlags", scoped: true, why: "Takes the GLOBAL array on purpose and derives same-page peers internally (arrange.js), because it must splice the permuted group back without disturbing other sheets' slots." },
  { name: "rollup", scoped: false, why: "CORRECT unscoped — the takeoff total is a whole-document number. Scoping it to the visible sheet would make the quantity a person reads as truth depend on which page they happen to be on." },
  { name: "buildSnapshot", scoped: false, why: "CORRECT unscoped — the saved record must hold every sheet's markups." },
  { name: "docStateRef", scoped: false, why: "CORRECT unscoped — the undo/history snapshot covers the whole document." },
]);
