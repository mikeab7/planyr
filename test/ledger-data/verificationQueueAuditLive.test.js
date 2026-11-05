/* The live half of verification-queue-audit's tests: the REAL verification queue against its recorded ceiling.
 * Runs in the ledger-health job (npm run test:ledger), not in main's build — the ledger lives on its own branch
 * and its content must never be able to fail an unrelated code PR (NEW-1, 2026-11-05). */
import { readText } from "../../scripts/lib/ledger.mjs";
import { describe, it, expect } from "vitest";
import { auditQueue, checkCeiling } from "../../scripts/verification-queue-audit.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("verification-queue-audit — the real repo file, right now", () => {
  it("VERIFICATION.md currently passes its own recorded ceiling", () => {
    const text = readText(REPO, "VERIFICATION.md");
    const ceiling = JSON.parse(readFileSync(join(REPO, "scripts", "verification-queue-ceiling.json"), "utf8"));
    const report = auditQueue(text, { staleThresholdDays: ceiling.staleThresholdDays });
    const { ok, problems } = checkCeiling(report, ceiling);
    expect(ok, problems.join("\n") + `\n(regenerate with: node scripts/verification-queue-audit.mjs --write-ceiling)`).toBe(true);
  });
});
