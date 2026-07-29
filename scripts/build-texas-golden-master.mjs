#!/usr/bin/env node
/* NEW-1 — regenerate the Texas golden-master snapshot.
 *
 * ⛔ Running this is NOT how you fix a failing goldenMasterTexas test. A diff there means a Texas
 * output MOVED; the fix is to stop moving it. Regenerate ONLY for a deliberate, owner-approved
 * change to a Texas rule — and then commit the regenerated fixture on its own, with the moved
 * values named in the commit message.
 *
 *   node scripts/build-texas-golden-master.mjs           # write test/fixtures/texasGoldenMaster.json
 *   node scripts/build-texas-golden-master.mjs --check   # exit 1 if the fixture is stale (CI use)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTexasGoldenMaster } from "../test/support/texasGoldenMaster.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../test/fixtures/texasGoldenMaster.json");
const json = JSON.stringify(buildTexasGoldenMaster(), null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (!existsSync(target)) { console.error("✗ texasGoldenMaster.json missing — run without --check"); process.exit(1); }
  if (readFileSync(target, "utf8") !== json) {
    console.error("✗ Texas golden master is STALE — a Texas output moved. Do NOT regenerate to make this pass.");
    process.exit(1);
  }
  console.log("✓ Texas golden master matches");
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, json);
console.log(`✓ wrote ${target} (${json.length} bytes)`);
