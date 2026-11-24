#!/usr/bin/env node
// scripts/build-sequence-page.mjs — bundles the Schedule page (src/workspaces/scheduler/page/*, audit batch J3)
// into ONE plain script, public/sequence/page.js, that public/sequence/index.html loads at the end of <body>.
//
// The page is real ES modules now. It used to be ~16,700 lines of JSX inside a <script type="text/babel"> block that
// was transpiled in the browser (then, from B1167200, by a post-build step). The bundle also contains the Schedule's
// engine (src/shared/schedule/engine/*, formula, ownership, range selection, health rules): the entry imports
// engine/pageEntry.js first, which still publishes the engine's names as globals for the ui-audit harnesses, and the
// page's own modules import the same engine modules by name, so there is exactly ONE copy of each engine function.
//
// Like the engine bundle before it, the output is committed: the ~70 ui-audit harnesses and the e2e specs serve
// public/ directly, so they run the same bytes. test/sequencePageBundle.test.js and a CI step fail when it is stale.
// Vite's build minifies it in dist/ (see vite.config.js `minifySequencePage`); the committed file stays readable.
//
// Usage:  node scripts/build-sequence-page.mjs            (writes public/sequence/page.js)
//         node scripts/build-sequence-page.mjs --check    (exit 1 if the committed file is stale)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildPage, OUT } from "./sequence-page-bundle.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const next = buildPage();
  if (process.argv.includes("--check")) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (cur !== next) { console.error("✗ public/sequence/page.js is STALE — run: npm run build:sequence-page"); process.exit(1); }
    console.log("✓ public/sequence/page.js is up to date");
  } else {
    writeFileSync(OUT, next);
    console.log(`✓ wrote public/sequence/page.js (${(next.length / 1024).toFixed(0)} KB)`);
  }
}
