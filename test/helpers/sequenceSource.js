// Source text of the Schedule page for tests that assert on its code.
//
// Since audit batch J1 the Schedule's pure engine (dates, cascade, merge, drop rules, load migrations,
// health rules, ownership, range selection, formula engine) lives in real modules under
// src/shared/schedule/engine/ (+ healthEngine, scheduleOwnership, selection, formula) and reaches the page
// through the generated public/sequence/engine.js. A source-text assertion about a moved function therefore
// has to read the module, not index.html. These helpers give a test the page, the engine modules, or both.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p) => fileURLToPath(new URL("../../" + p, import.meta.url));
const read = (p) => readFileSync(root(p), "utf8");

export const SEQUENCE_PAGE_PATH = root("public/sequence/index.html");
export const SEQUENCE_ENGINE_PATHS = [
  ...readdirSync(root("src/shared/schedule/engine")).filter((f) => f.endsWith(".js") && f !== "index.js" && f !== "pageEntry.js").sort().map((f) => "src/shared/schedule/engine/" + f),
  "src/shared/schedule/healthEngine.js",
  "src/shared/schedule/scheduleOwnership.js",
  "src/shared/selection/rangeSelection.js",
  "src/shared/selection/edgeScroll.js",
  "src/shared/formula/formula.js",
];

/** index.html only. */
export const sequencePageSource = () => readFileSync(SEQUENCE_PAGE_PATH, "utf8");
/** The engine modules the page's bundle is built from, concatenated. */
export const sequenceEngineSource = () => SEQUENCE_ENGINE_PATHS.map(read).join("\n");
/** The page plus every module it runs (what "the Schedule's source" used to mean). */
export const sequenceSource = () => sequencePageSource() + "\n" + sequenceEngineSource();
