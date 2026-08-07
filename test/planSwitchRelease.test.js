/* B1439 — the plan-switch release guard's decision table.
 *
 * The browser half (ui-audit/verify-plan-switch-release.mjs) cannot run in this repo's CI, so the
 * half that CAN runs here: the verdict logic, and in particular the two ways this guard is allowed
 * to fail that are NOT "the product regressed" — the positive control coming back clean, and the
 * plan switch never having happened. Those are the cases that would otherwise turn the guard into a
 * permanent green, which is the failure mode B1439 most deserves to be protected from.
 */
import { describe, it, expect } from "vitest";
import { releaseVerdict, DEFAULTS } from "../ui-audit/lib/planSwitchRelease.mjs";

const clean = { detachedBefore: 0, detachedAfter: 0, rendererBefore: 2378, rendererAfter: 2379 };
const dirtyControl = { detachedBefore: 0, detachedAfter: 2342 };

describe("releaseVerdict", () => {
  it("passes when the switch releases the previous plan and the control proves the instrument works", () => {
    const v = releaseVerdict(clean, dirtyControl, true);
    expect(v.ok).toBe(true);
    expect(v.failures).toEqual([]);
    expect(v.detachedLeft).toBe(0);
  });

  it("fails on B1439's actual signature — ~2,342 detached nodes left per round trip", () => {
    const v = releaseVerdict(
      { detachedBefore: 0, detachedAfter: 2342, rendererBefore: 2378, rendererAfter: 4964 },
      dirtyControl, true,
    );
    expect(v.ok).toBe(false);
    expect(v.failures.join(" ")).toMatch(/2342 detached DOM node/);
  });

  it("fails when rendererNodes does not return even if detached is clean", () => {
    const v = releaseVerdict({ ...clean, rendererAfter: 4964 }, dirtyControl, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(" ")).toMatch(/rendererNodes did not return/);
  });

  /* ⛔ THE ANTI-ROT CASES. Both of these look like a pass to a naive guard. */
  it("fails when the positive control comes back CLEAN — the instrument is not observing", () => {
    const v = releaseVerdict(clean, { detachedBefore: 0, detachedAfter: 0 }, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(" ")).toMatch(/NOT OBSERVING/);
  });

  it("fails when the positive control did not run at all", () => {
    const v = releaseVerdict(clean, null, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(" ")).toMatch(/positive control did not run/);
  });

  it("fails when the plan switch was never proven, however clean the numbers are", () => {
    const v = releaseVerdict(clean, dirtyControl, false);
    expect(v.ok).toBe(false);
    expect(v.failures.join(" ")).toMatch(/never proven/);
  });

  it("reports every applicable failure at once rather than stopping at the first", () => {
    const v = releaseVerdict(
      { detachedBefore: 0, detachedAfter: 5000, rendererBefore: 2378, rendererAfter: 9000 },
      { detachedBefore: 0, detachedAfter: 0 }, false,
    );
    expect(v.failures).toHaveLength(4);
  });

  it("allows a small stray without letting a whole shell tree through", () => {
    // one unmounted planner shell is ~1,200 nodes; the allowance is far below that
    expect(DEFAULTS.maxDetached).toBeLessThan(200);
    expect(releaseVerdict({ ...clean, detachedAfter: DEFAULTS.maxDetached }, dirtyControl, true).ok).toBe(true);
    expect(releaseVerdict({ ...clean, detachedAfter: DEFAULTS.maxDetached + 1 }, dirtyControl, true).ok).toBe(false);
  });
});
