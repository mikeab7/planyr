/* B1128272 — "when I'm on schedule and click dashboard, it often takes me back to the
 * map." Root cause: pressing the Schedule module's Dashboard crumb fired TWO
 * navigations at once — Scheduler.jsx's own `goDashboard` did the in-module nav
 * (goDashboardWithinModule) AND called the Shell's `onGoDashboard` (leave the
 * workspace) — and the second usually won the race. There is no jsdom/component
 * render environment in this repo's vitest config (see vitest.config.js — Node-only,
 * pure-logic tests), so the guard here is a SOURCE assertion on the exact shape of
 * `goDashboard`'s definition and its wiring, mirroring this repo's other header
 * source-guards (e.g. headerNavPriority.test.js). Red-proof: restoring
 * `onGoDashboard?.()` inside goDashboard, or rewiring the crumb's AppHeader call to
 * `onDashboard={onGoDashboard}`, must fail this file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url)),
  "utf8",
);

describe("Schedule's Dashboard crumb fires exactly ONE navigation (B1128272)", () => {
  it("goDashboard performs the in-module navigation only — never also onGoDashboard", () => {
    const m = SRC.match(/const goDashboard = \(\) => \{[^}]*\};/);
    expect(m, "goDashboard's definition must match the expected one-line arrow-function shape").not.toBeNull();
    expect(m[0]).toContain("goDashboardWithinModule()");
    expect(m[0]).not.toMatch(/onGoDashboard/);
  });

  it("the crumb-facing AppHeader is wired to goDashboard, and the wordmark separately to onGoDashboard", () => {
    // Two DIFFERENT handlers on two DIFFERENT props — this is what makes the wordmark still
    // leave the workspace while the crumb stays in Schedule's own reports view. (The
    // ORG-scope AppHeader call further down legitimately wires onDashboard={onGoDashboard}
    // directly — AgendaView has no dashboard of its own — so this only asserts the pairing
    // exists, not that onDashboard={onGoDashboard} never appears anywhere in the file.)
    expect(SRC).toMatch(/onDashboard=\{goDashboard\}/);
    expect(SRC).toMatch(/onLogoDashboard=\{onGoDashboard\}/);
  });
});
