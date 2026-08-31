/* B900 (hotfix) — proposing a detention-pond outlet crashed the whole Site workspace with
 * "ReferenceError: React is not defined", caught by the workspace error boundary ("Site Planyr
 * hit an error and couldn't load"). Reproduced live on a signed-in deployed project (Tsakiris):
 * pond inspector → REQUIRED DETENTION → enter an allowable release → RATE CONTROL · POST ≤ PRE
 * → click "Propose outlet" → crash. Because the outlet is written to the pond's `det` and
 * persisted, a saved plan then crashed on every reload until the outlet was removed.
 *
 * Root cause: `SitePlanner.jsx` imports only named hooks from "react" (no default `React`
 * import), but the routed per-storm table — rendered ONLY once an outlet exists AND routing
 * succeeds (`routed.kind === "routed"`, `lib/pondRouting.js` assessRoutedDetention) — mapped
 * over `routed.perStorm` using `<React.Fragment key={...}>`, an explicit reference to the bare
 * `React` global. Under the automatic JSX runtime that global is never defined, so it throws
 * only on this specific render path — which is why ordinary pond/detention rendering worked
 * fine and only proposing/adding an outlet (with a nonzero drainage area, so routing actually
 * resolves) crashed. Fixed by importing `Fragment` as a named import (matching the rest of the
 * file's fragment-shorthand convention) and using `<Fragment key={...}>` instead.
 *
 * This spec drives the real SVG canvas LOGGED OUT (no account) on a seeded-blank site — the
 * exact crashing render path needs zero auth or live GIS data, just a drawn pond + a few typed
 * numbers, so it's fully reproducible here. Covers both outlet kinds named in the report
 * ("Propose outlet" → orifice, and switching to Restrictor). */
import { test, expect } from "@playwright/test";
import { drawAnchoredPond, fillPondField } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

// The rate-control section heading. It reads "Rate control · Post ≤ Pre (screening)" in the DOM
// and is CSS-uppercased on screen; a bare "rate control" substring is no longer unique, because
// B950 (4e882190, PR #761, 2026-07-22) added an "Outlet sizing check (rate control)" summary row
// to the same group. Match the heading itself.
const rateControlHead = (p) => p.getByText("Rate control · Post ≤ Pre", { exact: false });

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

test.describe("Pond outlet render — proposing an outlet must never crash the workspace (B900)", () => {
  test("Propose outlet: orifice, with a routed storm table, renders with no throw", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    // Anchor the pond (required for the Rate control section to render at all) and give it a
    // nonzero drainage area so routing actually resolves (routed.kind === "routed") — the
    // EXACT branch that maps over routed.perStorm with the fragment that crashed.
    await drawAnchoredPond(page, { drainageAcres: 10 });
    await fillPondField(page, "Allowable release (cfs)", 15);

    const proposeBtn = page.getByRole("button", { name: /Propose outlet/i });
    await expect(proposeBtn).toBeEnabled();
    await proposeBtn.click();

    // The routed per-storm table (the crashing render path) must appear, not the error boundary.
    await expect(rateControlHead(page)).toBeVisible();
    await expect(page.getByText("Site Planyr hit an error", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/PASS|SHORT|OVERTOPS/)).not.toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Restrictor outlet also renders the routed table with no throw", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAnchoredPond(page, { drainageAcres: 10 });
    await fillPondField(page, "Allowable release (cfs)", 15);

    // B903 — the outlet is now a genuine editable STAGE LIST (no more in-place "switch this
    // stage's kind" toggle), so the report's Restrictor path is exercised via the "+ Restrictor"
    // manual-start button directly — still the same routed.perStorm.map(...) Fragment block
    // that originally crashed, now rendered against a restrictor-kind outlet.
    await page.getByRole("button", { name: "+ Restrictor", exact: true }).click();
    await expect(rateControlHead(page)).toBeVisible();
    await page.waitForTimeout(150);

    await expect(page.getByText("Site Planyr hit an error", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/PASS|SHORT|OVERTOPS/)).not.toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a proposed outlet survives a reload without crashing (the persisted-crash half of the report)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAnchoredPond(page, { drainageAcres: 10 });
    await fillPondField(page, "Allowable release (cfs)", 15);
    await page.getByRole("button", { name: /Propose outlet/i }).click();
    await expect(rateControlHead(page)).toBeVisible();

    await page.reload({ waitUntil: "load" });
    await expect(canvas(page)).toBeVisible();
    await expect(page.getByText("Site Planyr hit an error", { exact: false })).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
