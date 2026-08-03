/* LANDING COVERAGE DRIFT — the county list and state plane zones on the marketing page
 * must match the app's own sources. (B1385 / NEW-2a.)
 *
 * The page shipped claiming "Harris · Fort Bend · Chambers" long after Waller and nine
 * Colorado counties went live, and kept a Texas-only state-plane footer after Colorado's
 * two zones shipped — because a static file in public/ is invisible to whoever adds a
 * county endpoint. scripts/build-landing-coverage.mjs derives that copy from
 * counties.js + statePlane.js; this fails the build the moment the two disagree.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/build-landing-coverage.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("landing coverage copy tracks the repo", () => {
  it("is not stale (regenerate with `node scripts/build-landing-coverage.mjs`)", () => {
    let out = "";
    try {
      out = execFileSync(process.execPath, [SCRIPT, "--check"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      throw new Error(`${e.stdout || ""}${e.stderr || ""}`.trim() || String(e));
    }
    expect(out).toMatch(/✓ landing coverage copy matches the repo/);
  });
});
