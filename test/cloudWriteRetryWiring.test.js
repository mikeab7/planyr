/* B1204736 (NEW-1) — a Retry click must not forget the durable write-failure log before a single
 * row has been attempted. The old wiring routed every retry button through `dismissPushError()`
 * FIRST (which calls `clearAllCloudWriteFailures()`) and only THEN invoked the retry closure — so
 * an interrupted retry had nothing left in the durable log to re-surface on the next boot. The fix
 * is `beginPushRetry()`, which clears only the in-memory banner. This is a SOURCE guard (mirrors
 * routeMissingCloudRetry.test.js) because standing up the full signed-in boot sequence to click a
 * real banner button is a live-verify concern; the WIRING is a real, checkable property of the
 * source, and it is exactly the shape that regressed once already (B1048400's own fix still
 * cleared the log before replaying, just one call later).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlannerApp.jsx"), "utf8");

// Every occurrence of "retry?.();" is a place a stored write-failure retry closure gets invoked —
// collect the statement immediately before each one so we can assert what precedes it.
const RETRY_INVOKE = "retry?.();";
function precedingCall(source, idx) {
  const stmtStart = source.lastIndexOf("{ const retry = pushErrorRetryRef.current;", idx);
  if (stmtStart < 0) return null;
  return source.slice(stmtStart, idx + RETRY_INVOKE.length);
}

describe("NEW-1: every 'Retry now' click clears only the in-memory banner, never the durable log", () => {
  it("both retry click handlers exist and are wired through beginPushRetry()", () => {
    const sites = [];
    let idx = SP.indexOf(RETRY_INVOKE);
    while (idx !== -1) {
      const stmt = precedingCall(SP, idx);
      if (stmt) sites.push(stmt);
      idx = SP.indexOf(RETRY_INVOKE, idx + 1);
    }
    expect(sites.length).toBeGreaterThanOrEqual(2); // the header badge's onRetryBackgroundPush + the banner's own button
    for (const stmt of sites) {
      expect(stmt.includes("beginPushRetry()")).toBe(true);
      expect(stmt.includes("dismissPushError()")).toBe(false); // the exact pre-fix regression shape
    }
  });

  it("beginPushRetry is defined and does NOT touch the durable log (unlike dismissPushError)", () => {
    const beginIdx = SP.indexOf("const beginPushRetry = () => {");
    expect(beginIdx).toBeGreaterThan(-1);
    const beginLine = SP.slice(beginIdx, SP.indexOf("\n", beginIdx));
    expect(beginLine.includes("clearAllCloudWriteFailures")).toBe(false);

    const dismissIdx = SP.indexOf("const dismissPushError = () => {");
    expect(dismissIdx).toBeGreaterThan(-1);
    const dismissLine = SP.slice(dismissIdx, SP.indexOf("\n", dismissIdx));
    expect(dismissLine.includes("clearAllCloudWriteFailures")).toBe(true); // the X button still forgets the log, deliberately
  });

  it("the boot-drain replay path uses the atomic-first retryCloudWriteFailures, not the old fan-out", () => {
    expect(SP.includes("retryCloudWriteFailures(")).toBe(true);
    expect(SP.includes("groupWrite: replayGroupAtomically")).toBe(true);
    // The old shape cleared everything before calling the generic replay — must not reappear.
    expect(/clearAllCloudWriteFailures\(\);\s*\n\s*replayCloudWriteFailures\(/.test(SP)).toBe(false);
  });
});
