/* NEW-1 (B2382272) — Ctrl+C on a selected element puts a Planyr payload on the SYSTEM clipboard, so
 * Ctrl+V pastes the element even when an older screenshot sat on the OS clipboard.
 * RED on the pre-fix build: the copy was in-memory only, and the paste event's image won, so the
 * stale screenshot became an overlay and no duplicate appeared. Real keystrokes, real clipboard. */
import { test, expect } from "@playwright/test";
import { canvas, plans, selectTool, startBlank, drawBuilding, drawPolygonMarkup } from "./drawKinds.js";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const overlays = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return Object.values(map).flatMap((r) => (r && r.sheetOverlays) || []).length;
});
const putImageOnClipboard = (page) => page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 40; c.height = 40; c.getContext("2d").fillRect(0, 0, 40, 40);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
});
const selectMarkupEdge = async (page) => {
  await selectTool(page);
  const bb = await page.locator('[data-feature^="markup:"]').first().boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + 1); // an unfilled polygon is selected by its outline
  await page.waitForTimeout(250);
};
const total = async (page) => { const p = Object.values(await plans(page))[0]; return p.els + p.markups; };

test.describe("Ctrl+C / Ctrl+V beats a stale clipboard image", () => {
  test("building: image first, then select + Ctrl+C + Ctrl+V → a duplicate, not the image", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box);
    await selectTool(page);
    await page.mouse.click(box.x + box.width * 0.67, box.y + box.height * 0.36);
    await putImageOnClipboard(page);
    await page.mouse.click(box.x + box.width * 0.67, box.y + box.height * 0.36);
    const before = await total(page);
    await page.keyboard.press("Control+c");
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.7);
    await page.keyboard.press("Control+v");
    await expect.poll(() => total(page), { timeout: 15_000 }).toBeGreaterThan(before);
    expect(await overlays(page)).toBe(0);
  });

  test("polygon markup: same sequence", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPolygonMarkup(page, box);
    await selectMarkupEdge(page);
    await putImageOnClipboard(page);
    await selectMarkupEdge(page);
    await page.keyboard.press("Control+c");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7);
    await page.keyboard.press("Control+v");
    await expect.poll(() => plans(page).then((p) => Object.values(p)[0].markups), { timeout: 15_000 }).toBe(2);
    expect(await overlays(page)).toBe(0);
  });

  test("a non-Planyr image on the clipboard (no element copy) still pastes as an overlay", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await selectTool(page);
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
    await putImageOnClipboard(page);
    await page.keyboard.press("Control+v");
    await expect.poll(() => overlays(page), { timeout: 15_000 }).toBe(1);
  });

  test("Ctrl+C / Ctrl+V inside a text field is not intercepted", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box);
    await selectTool(page);
    await page.mouse.click(box.x + box.width * 0.67, box.y + box.height * 0.36);
    await page.evaluate(() => { const i = document.createElement("input"); i.id = "e2e-f"; i.value = "hello"; document.body.appendChild(i); i.focus(); i.select(); });
    const before = await total(page);
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(500);
    expect(await total(page)).toBe(before);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("hello");
  });
});
