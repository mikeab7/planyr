/* B909/B910 — the Yield panel's one-click "⚡ Design detention" / "⚡ Design mitigation"
 * cures. Both only render once a live drainage/floodplain check has resolved a real
 * required-vs-provided shortfall (the `drainage` object needs a geocoded `origin`, which a
 * logged-out "Start blank" site never has — the same reason B907's own land-take-advisory
 * check was left untested here: "needs a live drainage-criteria check — GIS-gated, blocked
 * in this sandbox"). That live SHORT → click → pond-appears path is filed as a LIVE-VERIFY
 * item (VERIFICATION.md) for a signed-in, real-address session instead of faked here.
 *
 * What THIS spec confirms, logged out, with zero network dependency: the buttons are
 * correctly ABSENT when there's nothing to design against (no live check has run) — a
 * regression guard against them ever rendering ungated — and that opening the Yield panel
 * with a drawn pond still renders with zero console/page errors (the panel's det/mit
 * verdict-group code path this PR touches runs cleanly even off the "Detention storage"
 * always-visible row). The underlying sizing math (solvePondExpansion / sizePondForTargets
 * / pondPlacementCandidates reuse) is unit-tested directly — see test/pondGeom.test.js.
 *
 * Drives the real app LOGGED OUT (no account) on a seeded-blank site. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function drawParcel(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Parcel ▾", exact: true }).click();
  await page.getByText("Draw new parcel", { exact: true }).click();
  const pts = [
    [box.x + 80, box.y + 80],
    [box.x + 700, box.y + 80],
    [box.x + 700, box.y + 500],
    [box.x + 80, box.y + 500],
  ];
  for (const [x, y] of pts) await page.mouse.click(x, y);
  await page.getByRole("button", { name: "Finish", exact: false }).first().click();
  const doneBtn = page.getByRole("button", { name: "Done", exact: true });
  if (await doneBtn.count()) await doneBtn.click();
  await page.keyboard.press("Escape");
}

async function drawPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

test.describe("Yield panel — ⚡ Design detention / ⚡ Design mitigation gating (B909/B910)", () => {
  test("neither button renders on a blank (ungeocoded) site — no drainage check is possible without a live GIS pull", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawParcel(page);
    await drawPond(page);
    await page.getByRole("button", { name: "Yield", exact: true }).click();

    await expect(page.getByText("Detention storage", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /⚡ Design detention/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /⚡ Design mitigation/i })).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("Detention Pond draw-tool hint (B909 §2b)", () => {
  test("arming the tool shows a transient hint naming both the manual draw and the ⚡ Design detention shortcut; it clears once drawing starts", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawParcel(page);

    await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
    const hint = page.getByText(/Click on the map to place the detention pond/i);
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("⚡ Design detention");

    // Once a drag starts, the hint gets out of the way.
    const box = await canvas(page).boundingBox();
    await page.mouse.move(box.x + 320, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 350, { steps: 5 });
    await expect(hint).toBeHidden();
    await page.mouse.up();
    await page.keyboard.press("Escape");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
