/* B643105-b — THE MUTATION PROOF, MADE PERMANENT.
 *
 * B643105 wired `ui-audit/stress/check-babel.mjs` into the required CI gate so a syntax error in
 * `public/sequence/index.html` fails the build instead of shipping silently. The proof that the
 * GATE actually catches a real break — not just that the script exists and happens to pass —
 * was done BY HAND: inject an unbalanced paren, run the CLI, watch it exit 1, revert. That proof
 * lived only in a chat transcript. Nothing stopped a future edit turning `checkBabelBlocks` into
 * an unconditional pass, and CI would stay green forever while reporting a working gate — this
 * repo's signature defect, a check that EXISTS wearing the costume of a check that WORKS, one
 * level up from the exact thing B643105 was filed to fix.
 *
 * This test is that proof, permanent and CI-enforced. It never writes a broken file to disk —
 * the mutation happens on a string held in memory, so a crashed run can never leave a broken
 * copy of the real file behind. It drives `checkBabelBlocks`, the function CI itself calls.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkBabelBlocks } from "../ui-audit/stress/check-babel.mjs";

const REAL_HTML = readFileSync(
  fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)),
  "utf8"
);
const MARKER = '<script type="text/babel">';

describe("check-babel gate (B643105)", () => {
  it("passes on the real, unmutated public/sequence/index.html", () => {
    const blocks = checkBabelBlocks(REAL_HTML);
    // A vacuous 0-block run would pass trivially and prove nothing — the file must genuinely
    // carry both <script type="text/babel"> blocks for this assertion to mean anything.
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) {
      expect(b.ok, `block ${b.blockNum} failed to transform: ${JSON.stringify(b.error)}`).toBe(true);
    }
  });

  it("⛔ MUTATION PROOF — fails when a real syntax error is injected into the main app block, in memory only", () => {
    // Target the SECOND <script type="text/babel"> block — the ~13,000-line main app, the one
    // the original (pre-B643105) checker silently never reached. Mirrors the exact injection
    // proven by hand before B643105 shipped: an unbalanced paren right after the block opens.
    const firstStart = REAL_HTML.indexOf(MARKER);
    const secondStart = REAL_HTML.indexOf(MARKER, firstStart + 1);
    expect(secondStart, "the real file must carry a second <script type=\"text/babel\"> block to mutate — this proof needs a real target, not an assumed one").toBeGreaterThan(-1);
    const openTag = REAL_HTML.indexOf(">", secondStart) + 1;
    const mutated =
      REAL_HTML.slice(0, openTag) +
      "\nconst __MUTATION_TEST__ = (;\n" +
      REAL_HTML.slice(openTag);

    // Never written to disk — `mutated` lives only in this process's memory and is discarded
    // when the test ends, so a crash mid-test can never leave the real file broken.
    const blocks = checkBabelBlocks(mutated);
    const mutatedBlock = blocks[1];
    expect(mutatedBlock, "the mutated second block must still be found by the walker").toBeTruthy();
    expect(mutatedBlock.ok, "the injected syntax error was not caught — the gate would have shipped this clean").toBe(false);
    expect(JSON.stringify(mutatedBlock.error)).toMatch(/Unexpected/);

    // The FIRST block was never touched by the mutation — it must still transform clean, so this
    // proof is specifically about catching a break in the block it targeted, not a global failure.
    expect(blocks[0].ok).toBe(true);
  });
});
