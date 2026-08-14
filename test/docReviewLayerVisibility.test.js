/* B503184 — the CI-runnable half of the Doc Review hidden-content audit.
 *
 * ⛔ THE DEFECT, and why a unit test can catch it at all. `renderDetail` opens with a cache check —
 * "does the tile I already have cover this view at this scale" — that knows nothing about the
 * drawing's CONTENT changing underneath it. So toggling a PDF layer off re-entered it and it
 * returned immediately, leaving the previous tile on screen; and the detail tile paints OVER the
 * backdrop, so the layer the user just switched off was still what they were looking at.
 *
 * The pixels are proven by `ui-audit/verify-pdf-layer-hiding.mjs`. What is asserted HERE is the one
 * thing a source guard can hold: that the toggle still invalidates the retained tile. That is worth
 * pinning because the fix is a single line whose absence is invisible to every other test — the
 * feature's own unit tests (ocg.js) pass either way, since the config really is mutated correctly
 * and only the raster is stale.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RENDER_PATHS, MARKUP_PAGE_SCOPING, VERDICT } from "../src/workspaces/doc-review/lib/layerVisibilityReads.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_REVIEW = resolve(ROOT, "src/workspaces/doc-review/DocReview.jsx");
const PDF_LIB = resolve(ROOT, "src/workspaces/doc-review/lib/pdf.js");

/** The body of `const toggleLayer = (…) => { … };` */
function toggleLayerBody(src) {
  const i = src.indexOf("const toggleLayer =");
  if (i < 0) return null;
  const end = src.indexOf("\n  };", i);
  return end < 0 ? null : src.slice(i, end);
}

describe("B503184 — a layer toggle invalidates the cached detail tile", () => {
  const src = readFileSync(DOC_REVIEW, "utf8");

  it("toggleLayer exists and is found by the guard (a guard that scans nothing is a permanent green)", () => {
    expect(toggleLayerBody(src)).toBeTruthy();
  });

  it("⛔ it drops the retained tile — otherwise the toggle hides nothing you can see", () => {
    const body = toggleLayerBody(src);
    expect(body, "toggleLayer must clear detailTileRef, or renderDetail's cover check short-circuits")
      .toMatch(/detailTileRef\.current\s*=\s*null/);
  });

  it("…and still asks for both renders", () => {
    const body = toggleLayerBody(src);
    expect(body).toMatch(/setBackdropReq/);
    expect(body).toMatch(/setDetailReq/);
  });

  /* The cover check is the mechanism the fix relies on: a null tile MUST fail it. */
  it("the cover check treats a dropped tile as not covering", async () => {
    const { tileCovers } = await import("../src/workspaces/doc-review/lib/renderBudget.js");
    expect(tileCovers(null, { rx: 0, ry: 0, rw: 10, rh: 10 }, 1)).toBe(false);
  });

  it("⛔ MUTATION CHECK — the pre-fix toggleLayer FAILS this guard, and the current one passes", () => {
    /* Pinned to the SHA that shipped the defect, not to `origin/main` — once this fix merges, main
     * carries the invalidation and a floating reference would quietly stop discriminating. The body
     * is the real one from the tree, never a paraphrase: a paraphrase tests the paraphrase. */
    const PRE_FIX = "09d9cf9d";
    const before = execFileSync("git", ["show", `${PRE_FIX}:src/workspaces/doc-review/DocReview.jsx`],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const hasInvalidation = (body) => /detailTileRef\.current\s*=\s*null/.test(body || "");
    expect(toggleLayerBody(before), "no toggleLayer at the pinned pre-fix commit").toBeTruthy();
    expect(hasInvalidation(toggleLayerBody(before)), "the pre-fix toggle must NOT invalidate").toBe(false);
    expect(hasInvalidation(toggleLayerBody(src)), "the current toggle must invalidate").toBe(true);
  });
});

describe("every PDF render path is judged", () => {
  const pdfSrc = readFileSync(PDF_LIB, "utf8");

  it("the declaration table covers every page.render call site in the workspace", () => {
    const renders = (pdfSrc.match(/page\.render\(/g) || []).length;
    expect(renders, "a new render path shipped without a verdict").toBe(RENDER_PATHS.length);
  });

  it("the one must-honour path forwards the config", () => {
    const must = RENDER_PATHS.filter((r) => r.verdict === VERDICT.MUST_HONOUR);
    expect(must.length).toBeGreaterThan(0);
    expect(pdfSrc).toMatch(/optionalContentConfigPromise\s*=\s*Promise\.resolve\(optionalContentConfig\)/);
  });

  it("both verdicts are represented, and every one states a reason", () => {
    const kinds = new Set(RENDER_PATHS.map((r) => r.verdict));
    expect(kinds.has(VERDICT.MUST_HONOUR)).toBe(true);
    expect(kinds.has(VERDICT.CORRECT_WITHOUT)).toBe(true);
    for (const r of [...RENDER_PATHS, ...MARKUP_PAGE_SCOPING]) {
      expect(r.why.trim().length, r.name).toBeGreaterThan(40);
    }
  });

  it("the markup page-scoping table records BOTH answers — scoped and correctly unscoped", () => {
    expect(MARKUP_PAGE_SCOPING.some((m) => m.scoped)).toBe(true);
    expect(MARKUP_PAGE_SCOPING.some((m) => !m.scoped)).toBe(true);
  });

  it("the scoped markup paths really are scoped in the source", () => {
    const src = readFileSync(DOC_REVIEW, "utf8");
    expect(src).toMatch(/markups\.filter\(\(m\) => m\.page === page\)/);   // pageMarks
    expect(src).toMatch(/if \(m\.page !== page\) return true;/);            // eraseInBox
  });
});
