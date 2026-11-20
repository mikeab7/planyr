/* Live-ledger sanity floor for next-id (moved out of test/nextId.test.js, NEW-1): the real ledger's maxes are plausibly large,
 * i.e. the done entries are scanned and not just the open ones. Needs the real ledger -> runs in ledger-health (npm run test:ledger). */
import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeNextIds } from "../../scripts/next-id.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("computeNextIds — the real ledger", () => {
  it("finds real, plausibly-large maxes (the done entries are scanned, not just the open ones)", () => {
    const { maxB, maxV } = computeNextIds(REPO);
    expect(maxB).toBeGreaterThan(700); // sanity floor as of B755
    expect(maxV).toBeGreaterThan(200);
  });
});
