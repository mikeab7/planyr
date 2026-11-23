/* Regenerates src/shared/gis/sourcePackIndex.generated.js — the slim eager index of which source pack holds which registry key, plus the canonical key order
 * (the order the rows had when sources.js was one literal; registerSourcePack re-sorts the live registry into it after every load).
 * Run with `npm run source-pack-index` (vite-node). test/sourcePacks.test.js recomputes it and fails when the file is stale.
 * Order is STABLE: keys already in the committed order keep their place; a new key is appended (core rows first, then packs in file order). */
import { writeFileSync } from "node:fs";
import { buildSourcePackIndex, renderSourcePackIndex } from "../src/shared/gis/sourcePackIndexBuild.js";

const index = await buildSourcePackIndex();
const out = new URL("../src/shared/gis/sourcePackIndex.generated.js", import.meta.url);
writeFileSync(out, renderSourcePackIndex(index));
console.log(`source-pack-index: ${Object.keys(index.packs).length} packs, ${Object.values(index.packs).reduce((n, k) => n + k.length, 0)} pack keys, ${index.order.length} keys in order → ${out.pathname}`);
