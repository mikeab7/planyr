/* B904 — CE roadmap #2, stage 1: the Rational-vs-NRCS method-by-area GUARDRAIL. The engine
 * sizes detention with the Modified Rational method (Q=C·i·A) regardless of tributary area —
 * defensible for a small on-site drainage area, silently wrong once the contributing area
 * outgrows it, with no signal to the user that they've crossed that line.
 *
 * This spec drives the real app LOGGED OUT (no account) on a seeded-blank site, confirming:
 *   (a) a tributary area within the Rational-method screening range (the default 200-ac
 *       ceiling) shows a quiet "Method: Modified Rational" caption, no alarm.
 *   (b) a tributary area OVER the ceiling shows a loud ⚠ watch-out naming the method
 *       transition (NRCS unit-hydrograph indicated) and honestly notes the routed numbers
 *       still ride the Rational proxy (the true NRCS routing wire-up is a follow-on stage). */
import { test, expect } from "@playwright/test";
import { drawAnchoredPond } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

const anchor = (page, drainageAcres) => drawAnchoredPond(page, { drainageAcres });

test.describe("Detention method-by-area guardrail (B904)", () => {
  test("(a) an area within the Rational-method range shows a quiet method caption, no watch-out", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await anchor(page, 15);

    await expect(page.getByText(/Method: Modified Rational/i)).toBeVisible();
    await expect(page.getByText(/NRCS unit-hydrograph indicated/i)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("(b) an area over the ceiling flags the method transition honestly", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await anchor(page, 350); // over the default 200-ac screening ceiling

    const watchOut = page.getByText(/NRCS unit-hydrograph indicated/i).first();
    await watchOut.scrollIntoViewIfNeeded();
    await expect(watchOut).toBeVisible();
    await expect(page.getByText(/Rational method's screening range/i).first()).toBeVisible();
    await expect(page.getByText(/Method: Modified Rational/i)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
