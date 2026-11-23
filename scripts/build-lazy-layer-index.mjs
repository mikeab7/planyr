/* Regenerates src/workspaces/site-planner/lib/lazyLayerIndex.generated.js — the slim eager index of every lazy layer file's ids.
 * Run with `npm run layer-index` (vite-node, because the layer files are ESM sources with extensionless-friendly imports).
 * test/lazyLayerRegistry.test.js recomputes the same index and fails when this file is stale. */
import { writeFileSync } from "node:fs";
import { buildLazyLayerIndex, renderIndexModule } from "../src/workspaces/site-planner/lib/lazyLayerIndexBuild.js";

const index = await buildLazyLayerIndex();
const out = new URL("../src/workspaces/site-planner/lib/lazyLayerIndex.generated.js", import.meta.url);
writeFileSync(out, renderIndexModule(index));
console.log(`layer-index: ${Object.keys(index).length} files, ${Object.values(index).reduce((n, f) => n + f.ids.length, 0)} layer ids → ${out.pathname}`);
