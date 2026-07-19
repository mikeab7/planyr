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

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function drawAndOpenPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
  await page.mouse.dblclick(cx, cy);
}

const fieldInput = (page, labelText) =>
  page.getByText(labelText, { exact: true }).first().locator("xpath=ancestor::div[1]").locator("input").first();

async function fillField(page, labelText, value) {
  const input = fieldInput(page, labelText);
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  await input.press("Tab");
}

async function anchor(page, drainageAcres) {
  await drawAndOpenPond(page);
  await fillField(page, "Top-of-bank elev. (ft)", 100);
  await fillField(page, "Drainage area (ac)", drainageAcres);
}

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
