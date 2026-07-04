/* Two-writer concurrency regression against the versioned fixture (B278/B280 harness —
 * concurrency/multi-writer LIVE-VERIFY class, deterministic CAS half in the sandbox). Drives the
 * optimistic compare-and-swap interpreters with a synthetic base/writerA/writerB race and asserts the
 * stale writer is rejected as a conflict (no silent clobber) and the un-migrated DB degrades — the
 * genuine two-signed-in-tabs race is auth/live-only and tracked as VERIFICATION.md V204. */
import { describe, it, expect } from "vitest";
import { loadFixture, loadGolden } from "../e2e/fixtures/index.js";
import { interpretCas, interpretInsert, isMissingVersionColumn } from "../src/shared/cloud/optimisticUpsert.js";

const fx = loadFixture("cloud/two-writer.fixture.json");
const golden = loadGolden("cloud/two-writer.golden.json");

describe("two-writer optimistic-CAS fixture", () => {
  for (let i = 0; i < fx.scenarios.length; i++) {
    const s = fx.scenarios[i];
    const g = golden.outcomes[i];
    it(`${s.name}: CAS outcome matches the golden`, () => {
      const result = s.kind === "insert" ? interpretInsert(s.rows, s.error) : interpretCas(s.rows, s.error);
      expect(result).toEqual(g.result);
      expect(isMissingVersionColumn(s.error)).toBe(g.missingVersionColumn);
    });
  }

  it("the stale writer never silently clobbers (conflict, not ok)", () => {
    const stale = fx.scenarios.find((s) => s.name.includes("stale"));
    expect(interpretCas(stale.rows, stale.error)).toEqual({ ok: false, conflict: true });
  });
});
