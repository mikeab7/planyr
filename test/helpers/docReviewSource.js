/* THE DOCUMENT REVIEW COMPONENT AS TEXT — same idea as plannerSource.js / noteEditorSource.js (audit batch L4).
 * DocReview.jsx is being split into hooks under lib/; a source-scan test that read only DocReview.jsx would pass
 * VACUOUSLY on a negative assertion once the code it guards moved. `docReviewSource()` is the main file plus every hook
 * extracted from it. A new extraction costs one line in DOC_REVIEW_EXTRACTED. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DOC_REVIEW_DIR = fileURLToPath(new URL("../../src/workspaces/doc-review/", import.meta.url));
export const DOC_REVIEW_MAIN = "DocReview.jsx";
export const DOC_REVIEW_EXTRACTED = ["lib/useReviewRail.js", "lib/useReviewHistory.js", "lib/useReviewPinch.js"];

export function docReviewSource() {
  return [DOC_REVIEW_MAIN, ...DOC_REVIEW_EXTRACTED].map((f) => readFileSync(DOC_REVIEW_DIR + f, "utf8")).join("\n");
}
