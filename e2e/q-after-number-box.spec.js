/* B-Q-FIRST-PRESS — Q (Callout) and every other tool letter work on the FIRST press after a number box
 * is committed with Enter. Owner: "sometimes for the first time it doesn't … I have to double tap it".
 * Cause: NumInput keeps the caret on Enter, FIELD scope refused the letter and typed it into the box.
 * Adjacent cases covered: typed-but-uncommitted text stays text; Tab out; click map; Escape; Q twice;
 * mid-draw of another tool. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const armed = (p, re) => p.evaluate((src) => {
  const r = new RegExp(src);
  return String([...document.querySelectorAll('button[aria-pressed="true"]')].some((x) => r.test((x.textContent || "").trim())));
}, re.source);
const calloutArmed = (p) => armed(p, /^Callout/);

async function withBuildingSelected(page) {
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  await page.mouse.move(box.x + 200, box.y + 200); await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 }); await page.mouse.up();
  await page.keyboard.press("v");
  await page.mouse.click(box.x + 300, box.y + 275);
  await page.getByText("Properties", { exact: true }).first().click();
  const field = page.getByLabel("Length", { exact: true }).first();
  await expect(field).toBeVisible();
  return { box, field };
}

test.describe("Q arms Callout on the first press around number boxes", () => {
  test("after typing a value and pressing Enter: the box is left and Q arms Callout on the first press", async ({ page }) => {
    const { field } = await withBuildingSelected(page);
    await field.click(); await field.fill("300"); await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe("INPUT");
    await page.keyboard.press("q");
    await expect.poll(() => calloutArmed(page)).toBe("true");
  });
  for (const [k, name] of [["m", /^Select multiple/], ["t", /^Text/], ["l", /^Line/], ["r", /^Rectangle/], ["e", /^Ellipse/], ["c", /^Cloud/], ["v", /^Select/]]) {
    test(`tool letter "${k}" from a committed box`, async ({ page }) => {
      const { field } = await withBuildingSelected(page);
      await field.click(); await field.fill("300"); await page.keyboard.press("Enter");
      await page.keyboard.press(k);
      await expect.poll(() => armed(page, name), { message: k }).toBe("true");
    });
  }
  test("text typed but NOT committed stays text (the box keeps the keyboard)", async ({ page }) => {
    const { field } = await withBuildingSelected(page);
    await field.click(); await field.fill("12"); await page.keyboard.press("q");
    expect(await calloutArmed(page)).not.toBe("true");
    await expect(field).toHaveValue("12q");
  });
  test("Escape in a box abandons the typed text, leaves the box, and Q still works", async ({ page }) => {
    const { field } = await withBuildingSelected(page);
    const before = await field.inputValue();
    await field.click(); await field.fill("999"); await page.keyboard.press("Escape");
    // Escape also closes the inspector (the field may be gone): what matters is the typed 999 was never committed.
    if (await field.count()) expect(await field.inputValue()).not.toBe("999");
    await page.keyboard.press("q");
    await expect.poll(() => calloutArmed(page)).toBe("true");
  });
  test("after Tab, after clicking the map, after Escape, and pressing Q twice", async ({ page }) => {
    const { box, field } = await withBuildingSelected(page);
    await field.click(); await field.fill("300"); await page.keyboard.press("Tab");
    await page.keyboard.press("q");
    await expect.poll(() => calloutArmed(page)).toBe("true");
    await page.keyboard.press("q"); // second press must not toggle it off
    expect(await calloutArmed(page)).toBe("true");
    await page.keyboard.press("v");
    await page.mouse.click(box.x + 900, box.y + 600); await page.keyboard.press("q");
    expect(await calloutArmed(page)).toBe("true");
    await page.keyboard.press("Escape"); await page.keyboard.press("q");
    expect(await calloutArmed(page)).toBe("true");
  });
  test("Q mid-draw of another tool switches to Callout", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("map-toolbar-draw").click();
    const box = await canvas(page).boundingBox();
    await page.keyboard.press("l");
    await page.mouse.click(box.x + 300, box.y + 300);
    await page.mouse.move(box.x + 400, box.y + 350);
    await page.keyboard.press("q");
    expect(await calloutArmed(page)).toBe("true");
  });
});
