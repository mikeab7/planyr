/* Shared fixture loader for both test tiers (B278/B280 amendment). vitest (`test/*.test.js`) and
 * Playwright (`e2e/*.spec.js`) both import this so they consume identical bytes. Asserts each
 * fixture's `fixtureVersion` so a schema/engine bump that regenerates fixtures can't be read by a
 * stale spec. Regenerate the fixtures + goldens with `node scripts/build-fixtures.mjs`. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_VERSION = 1;

export function loadFixture(rel) {
  const o = JSON.parse(readFileSync(join(HERE, rel), "utf8"));
  if (o.fixtureVersion !== FIXTURE_VERSION) {
    throw new Error(`fixture ${rel} is version ${o.fixtureVersion}, expected ${FIXTURE_VERSION} — regenerate with \`node scripts/build-fixtures.mjs\` and update specs.`);
  }
  return o;
}

export function loadGolden(rel) {
  return JSON.parse(readFileSync(join(HERE, rel), "utf8"));
}

export function loadManifest() {
  return JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
}
