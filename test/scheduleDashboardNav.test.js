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

/* NEW-3 — amendment to B1128272. At ORG scope the wordmark and the crumb legitimately fire the
 * SAME handler (`onDashboard={onGoDashboard}`, no split — there is no in-module dashboard for the
 * crumb to point at, matching Library's/Notes' own wiring). That part was never wrong. What WAS
 * wrong: with neither `logoDashboardTitle` nor `dashboardTitle` supplied, the two controls fell
 * back to dashboardNav.js's two DIFFERENT default strings ("Dashboard: all projects" for the
 * wordmark vs. "All projects: Dashboard" for the crumb) — the exact near-identical, confusing
 * wording B1128272's own body named when it fixed the PROJECT-scope case. Since both controls at
 * org scope provably do the identical thing, both must say the identical thing.
 */
function orgScopeAppHeaderBlock() {
  const at = SRC.indexOf("if (org) {");
  expect(at, "the org-scope early-return branch was not found").toBeGreaterThan(-1);
  const closeAt = SRC.indexOf("<AgendaView", at);
  expect(closeAt, "the org-scope <AgendaView> render was not found").toBeGreaterThan(-1);
  return SRC.slice(at, closeAt);
}

describe("NEW-3 — Schedule's org-scope Dashboard tooltips no longer carry pre-B1128272 wording", () => {
  it("the org-scope AppHeader still wires a single onDashboard={onGoDashboard} — no split, matching Library/Notes", () => {
    const block = orgScopeAppHeaderBlock();
    expect(block).toMatch(/onDashboard=\{onGoDashboard\}/);
    // No per-control split at org scope — there is nothing for the crumb to do differently.
    expect(block).not.toMatch(/onLogoDashboard=/);
  });

  it("both tooltips are explicitly overridden, and they say the SAME thing", () => {
    const block = orgScopeAppHeaderBlock();
    const logoMatch = block.match(/logoDashboardTitle="([^"]+)"/);
    const crumbMatch = block.match(/dashboardTitle="([^"]+)"/);
    expect(logoMatch, "logoDashboardTitle override missing from the org-scope AppHeader call").not.toBeNull();
    expect(crumbMatch, "dashboardTitle override missing from the org-scope AppHeader call").not.toBeNull();
    expect(logoMatch[1]).toBe(crumbMatch[1]);
  });

  it("the stale pre-B1128272 default wording is not relied on at org scope", () => {
    const block = orgScopeAppHeaderBlock();
    // The two OLD default strings this item exists to remove (dashboardNav.js's own defaults) —
    // neither literal string may appear verbatim in the org-scope block.
    expect(block).not.toMatch(/Dashboard: all projects/);
    expect(block).not.toMatch(/All projects: Dashboard/);
  });

  it("MUTATION CHECK — stripping the two overrides restores the stale mismatched wording", () => {
    // Without an explicit override neither prop is passed, so dashboardNav.js's own defaults
    // apply — proving these two assertions actually depend on the fix rather than passing blind.
    const preFix = SRC.replace(
      /\s*logoDashboardTitle="Leave Schedule — go to the Site Planner map"\n\s*dashboardTitle="Leave Schedule — go to the Site Planner map"\n/,
      "\n",
    );
    expect(preFix).not.toBe(SRC);
    const at = preFix.indexOf("if (org) {");
    const closeAt = preFix.indexOf("<AgendaView", at);
    const block = preFix.slice(at, closeAt);
    expect(block).not.toMatch(/logoDashboardTitle=/);
    expect(block).not.toMatch(/dashboardTitle=/);
  });
});
