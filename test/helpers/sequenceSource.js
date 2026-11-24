// Source text of the Schedule page for tests that assert on its code.
//
// Since audit batch J1 the Schedule's pure engine (dates, cascade, merge, drop rules, load migrations,
// health rules, ownership, range selection, formula engine) lives in real modules under
// src/shared/schedule/engine/ (+ healthEngine, scheduleOwnership, selection, formula). Since audit batch J3 the page's
// own application code is ES modules under src/workspaces/scheduler/page/ (bundled into public/sequence/page.js);
// index.html keeps only the markup, the CSS tokens and a few boot scripts. A source-text assertion therefore has to
// read the module that holds the code. These helpers give a test the HTML, the page's modules, the engine modules,
// or all of them.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p) => fileURLToPath(new URL("../../" + p, import.meta.url));
const read = (p) => readFileSync(root(p), "utf8");

export const SEQUENCE_PAGE_PATH = root("public/sequence/index.html");
export const SEQUENCE_PAGE_DIR = root("src/workspaces/scheduler/page");
export const SEQUENCE_ENGINE_PATHS = [
  ...readdirSync(root("src/shared/schedule/engine")).filter((f) => f.endsWith(".js") && f !== "index.js" && f !== "pageEntry.js").sort().map((f) => "src/shared/schedule/engine/" + f),
  "src/shared/schedule/healthEngine.js",
  "src/shared/schedule/scheduleOwnership.js",
  "src/shared/selection/rangeSelection.js",
  "src/shared/selection/edgeScroll.js",
  "src/shared/formula/formula.js",
];

/** Every .js/.jsx file under the page's module folder (absolute paths, sorted, main.jsx first). */
export const sequencePageModulePaths = () => {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = dir + "/" + name;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.jsx?$/.test(name)) out.push(p);
    }
  };
  walk(SEQUENCE_PAGE_DIR);
  return out.sort((a, b) => (a.endsWith("/main.jsx") ? -1 : b.endsWith("/main.jsx") ? 1 : 0));
};

/** index.html only: the markup, CSS tokens and boot scripts (no application code). */
export const sequenceHtmlSource = () => readFileSync(SEQUENCE_PAGE_PATH, "utf8");
/** The page's own application modules (src/workspaces/scheduler/page/**), concatenated, with the `export ` keyword stripped so a test sees the declarations as they read in one script. */
export const sequenceModulesSource = () => sequencePageModulePaths().map((p) => readFileSync(p, "utf8").replace(/^export (?=(?:async )?(?:const|let|function|class) )/gm, "")).join("\n");
/** The page: index.html plus its application modules (what "index.html" used to mean to a source-text test). */
export const sequencePageSource = () => sequenceHtmlSource() + "\n" + sequenceModulesSource();
/** The engine modules the page's bundle is built from, concatenated. */
export const sequenceEngineSource = () => SEQUENCE_ENGINE_PATHS.map(read).join("\n");
/** The page plus every module it runs (what "the Schedule's source" used to mean). */
export const sequenceSource = () => sequencePageSource() + "\n" + sequenceEngineSource();
