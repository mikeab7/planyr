/* Verification-queue ceiling guard (B825233). Mirrors test/backlogIndex.test.js's pattern: pure-logic
 * unit cases against a small fixture (so the classification/date/blocker rules are pinned regardless
 * of how VERIFICATION.md happens to read today), plus a live check that the real file currently
 * passes its own recorded ceiling. Regenerate the ceiling with
 * `node scripts/verification-queue-audit.mjs --write-ceiling` after a session genuinely improves the
 * queue — a failure here means the queue got WORSE, not that this test is stale. */
import { describe, it, expect } from "vitest";
import { auditQueue, parseQueue, checkCeiling, STALE_THRESHOLD_DAYS } from "../scripts/verification-queue-audit.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE = `# VERIFICATION.md — fixture

## How to use this — read on every run

Some preamble that must never be parsed as a queue item.

## 🔲 Needs verification

### V100 — no Blocker at all, dated recently \`Blocker: \`
Not really a blocker tag (trailing colon only, no kind) — should still count as no-Blocker.
**Result:** ⏳ pending — filed 2026-08-20, nothing owed yet.

### V200 — carries a real Blocker, dated recently
**Result:** ⏳ pending — needs a live pass. \`Blocker: auth\`

### V300 — no Blocker, very old
Opened 2026-01-01 and never touched since.
**Result:** ⏳ pending — still nobody has run this.

### V400 — explicitly failed, should never count as open
**Result:** ❌ **FAILED — run 2026-08-01**, root cause still unfixed.

### V500 — no date anywhere, no Blocker
**Result:** ⏳ pending — no date ever recorded on this one.

## ✅ Verified / ❌ Failed — history

### V999 — this is PAST the boundary and must not be parsed as pending
This item is fully passed and archived elsewhere; it must never appear in the queue.
`;

const NOW = new Date("2026-08-28T00:00:00Z");

describe("verification-queue-audit — pure parsing", () => {
  it("only collects V# headings inside the 🔲 Needs verification section", () => {
    const items = parseQueue(FIXTURE);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(["V100", "V200", "V300", "V400", "V500"]);
    expect(ids).not.toContain("V999");
  });

  it("classifies a no-Blocker item, a Blocker-tagged item, and an explicitly-failed item correctly", () => {
    const report = auditQueue(FIXTURE, { now: NOW });
    expect(report.total).toBe(5);
    expect(report.failedCount).toBe(1);
    expect(report.openCount).toBe(4);
    expect(report.noBlockerIds).toEqual(expect.arrayContaining(["V100", "V300", "V500"]));
    expect(report.noBlockerIds).not.toContain("V200");
    expect(report.noBlockerIds).not.toContain("V400"); // failed items are never counted as no-Blocker
  });

  it("computes staleness from the newest ISO date mentioned in the block, against the given `now`", () => {
    const report = auditQueue(FIXTURE, { now: NOW, staleThresholdDays: 60 });
    // V100/V200 dated 2026-08-20 → 8 days old → not stale.
    expect(report.staleIds).not.toContain("V100");
    expect(report.staleIds).not.toContain("V200");
    // V300 dated 2026-01-01 → far past 60 days → stale.
    expect(report.staleIds).toContain("V300");
    // V500 has no date at all → reported as noDate, never guessed into either bucket.
    // (V200 also carries no date in this fixture — its own staleness is untestable, which IS
    // the point: an item with no self-declared date is reported, not silently assumed fresh.)
    expect(report.staleIds).not.toContain("V500");
    expect(report.noDateCount).toBe(2);
  });

  it("STALE_THRESHOLD_DAYS is the documented 60-day break in the measured distribution", () => {
    expect(STALE_THRESHOLD_DAYS).toBe(60);
  });
});

describe("verification-queue-audit — ceiling gate", () => {
  it("fails when a count exceeds the ceiling, and reports the new offender", () => {
    const report = auditQueue(FIXTURE, { now: NOW });
    const tightCeiling = { noBlockerCeiling: report.noBlockerCount - 1, staleCeiling: report.staleCount, staleThresholdDays: 60 };
    const { ok, problems } = checkCeiling(report, tightCeiling);
    expect(ok).toBe(false);
    expect(problems.join("\n")).toMatch(/No-Blocker pending V# count grew/);
  });

  it("passes when counts are at or under the ceiling", () => {
    const report = auditQueue(FIXTURE, { now: NOW });
    const looseCeiling = { noBlockerCeiling: report.noBlockerCount, staleCeiling: report.staleCount, staleThresholdDays: 60 };
    const { ok, problems } = checkCeiling(report, looseCeiling);
    expect(ok, problems.join("\n")).toBe(true);
  });

  it("reports missing-ceiling-file honestly rather than passing vacuously", () => {
    const report = auditQueue(FIXTURE, { now: NOW });
    const { ok, problems } = checkCeiling(report, null);
    expect(ok).toBe(false);
    expect(problems.join("\n")).toMatch(/--write-ceiling/);
  });
});

describe("verification-queue-audit — the real repo file, right now", () => {
  it("VERIFICATION.md currently passes its own recorded ceiling", () => {
    const text = readFileSync(join(REPO, "VERIFICATION.md"), "utf8");
    const ceiling = JSON.parse(readFileSync(join(REPO, "scripts", "verification-queue-ceiling.json"), "utf8"));
    const report = auditQueue(text, { staleThresholdDays: ceiling.staleThresholdDays });
    const { ok, problems } = checkCeiling(report, ceiling);
    expect(ok, problems.join("\n") + `\n(regenerate with: node scripts/verification-queue-audit.mjs --write-ceiling)`).toBe(true);
  });
});
