/* THE PLANNER AS TEXT — one reader for every source-scan test that asks "does the Site Planner contain X".
 *
 * ~225 tests read `SitePlanner.jsx` as a string (the repo's vitest config is DOM-free, so render wiring is guarded by
 * scanning the source). B1064 is moving whole regions OUT of that file into sibling modules (the Yield/Drainage panels,
 * `NumInput`, the element renderer, and the helpers both sides share). A test that keeps reading only `SitePlanner.jsx`
 * would then fail LOUDLY on a positive assertion (fine — it gets repointed) — but a NEGATIVE one (`not.toMatch`,
 * `toBe(-1)`, "this copy is gone", "no raw hex here") would PASS VACUOUSLY, because the code it guards is no longer in the
 * text it reads. That is the failure this helper exists to close.
 *
 * `plannerSource()` returns `SitePlanner.jsx` plus every module extracted from it, concatenated in the order the code used to
 * sit in the one file (constants and helpers that lived above the component, the component, the element renderer that
 * followed it, then `NumInput` and the panels at the tail). So an assertion sees the SAME text it saw before the move —
 * positive, negative and count-based alike — and a future extraction costs one line in PLANNER_EXTRACTED, not a hunt through
 * 225 tests.
 *
 * ⛔ A module extracted from SitePlanner.jsx MUST carry the `@planner-extract` marker in its header AND be listed below;
 * `test/plannerSource.test.js` fails if either half is missing, if a listed file is gone, or if an extracted module imports
 * back from SitePlanner.jsx (a circular edge). Use `plannerParts()` when a test needs to know WHICH file a thing lives in.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PLANNER_DIR = fileURLToPath(new URL("../../src/workspaces/site-planner/", import.meta.url));
export const PLANNER_MAIN = "SitePlanner.jsx";

/* Extracted modules, split by where their code used to sit relative to the component: ABOVE it, or AFTER it. */
export const PLANNER_EXTRACTED_ABOVE = ["lib/plannerShared.js", "lib/planRenderHelpers.jsx"];
export const PLANNER_EXTRACTED_BELOW = ["components/elementRender.jsx", "components/NumInput.jsx", "components/YieldDrainagePanels.jsx"];
export const PLANNER_EXTRACTED = [...PLANNER_EXTRACTED_ABOVE, ...PLANNER_EXTRACTED_BELOW];

const read = (rel) => readFileSync(PLANNER_DIR + rel, "utf8");

/** [{ file, text }] in concatenation order — the main file sits between the two groups. */
export function plannerParts() {
  return [...PLANNER_EXTRACTED_ABOVE, PLANNER_MAIN, ...PLANNER_EXTRACTED_BELOW].map((file) => ({ file, text: read(file) }));
}

/** The planner's source as ONE string (see the header). */
export function plannerSource() {
  return plannerParts().map((p) => p.text).join("\n");
}
