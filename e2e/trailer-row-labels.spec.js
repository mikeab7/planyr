/* NEW-1 / NEW-2 / NEW-3 (owner chat block 2026-10-06) — trailer parking, one object, three defects:
 *
 *   NEW-1  every row shows its OWN count. Reproduced on a real canvas with the real Trailer tool: two rows
 *          stacked, the upper one shallower. Zoomed out, the shallow row lost its COUNT first ("53′ Trailer
 *          Parking" alone) and then the whole label, while the deeper row under it kept both.
 *   NEW-2  the label has a per-row Hide / Show control (right-click menu + Properties), persisted per row.
 *   NEW-3  stall depth is an editable per-row field; a 50′ row draws and counts (it used to hold zero stalls
 *          at the 53′ standard, which read as the tool refusing 50′).
 *
 * Logged out, no cloud, no GIS. Each test is red on the pre-change build (NEW-1: count missing when zoomed out;
 * NEW-2: no menu row / no checkbox; NEW-3: no Stall depth field and a zero count).
 * Verify: sandbox here; the signed-in live pass is the V-item filed with this change in VERIFICATION. */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_KEY = "planarfit:sites:v1";

const readEls = (page) => page.evaluate((key) => {
  const map = JSON.parse(localStorage.getItem(key) || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
}, SITE_KEY);
const readTrailers = async (page) => (await readEls(page)).filter((e) => e.type === "trailer");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

/* Arm the Trailer tool through the merged Parking row's caret, drag a rectangle, drop back to Select. */
async function drawTrailerRow(page, from, to) {
  await page.getByRole("button", { name: /parking type/i }).first().click();
  await page.getByRole("button", { name: "Trailer parking", exact: true }).click();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

const labelFor = (page, id) => page.locator(`[data-label-for="${id}"]`);
const labelText = async (page, id) => (await labelFor(page, id).allTextContents()).join("|");

/* Two stacked rows: the upper ~50′ deep, the lower ~143′ (drag px → feet is whatever the blank canvas gives). */
async function drawStackedRows(page) {
  const box = await canvas(page).boundingBox();
  await drawTrailerRow(page, { x: box.x + 200, y: box.y + 200 }, { x: box.x + 700, y: box.y + 218 });
  await drawTrailerRow(page, { x: box.x + 200, y: box.y + 230 }, { x: box.x + 700, y: box.y + 280 });
  const els = (await readTrailers(page)).sort((a, b) => a.cy - b.cy);
  expect(els, "two trailer rows drawn").toHaveLength(2);
  return { box, upper: els[0], lower: els[1] };
}

async function zoomOut(page, box, notches) {
  await page.mouse.move(box.x + 450, box.y + 250);
  for (let i = 0; i < notches; i++) { await page.mouse.wheel(0, 250); await page.waitForTimeout(250); }
  await page.waitForTimeout(300);
}

async function rightClickRow(page, id) {
  const b = await page.locator(`[data-el-id="${id}"]`).first().boundingBox();
  // 85% along the row: with the docked Properties panel open the row's left end sits under it
  await page.mouse.click(b.x + b.width * 0.85, b.y + b.height / 2, { button: "right" });
}

async function openProperties(page, id) {
  await rightClickRow(page, id);
  await page.getByText("Properties…", { exact: true }).click();
  await page.waitForTimeout(250);
}

test.describe("Trailer parking rows — count on every row, label switch, editable stall depth", () => {
  test("NEW-1 — the shallow upper row keeps its COUNT at every zoom the deeper row does", async ({ page }) => {
    await startBlank(page);
    const { box, upper, lower } = await drawStackedRows(page);
    expect(upper.h, "the upper row really is the shallower one").toBeLessThan(lower.h);
    for (let z = 0; z < 5; z++) {
      // Known-good arm: the deeper row shows its count at every step, so a vacuous run cannot pass.
      expect(await labelText(page, lower.id), `lower row, zoom step ${z}`).toMatch(/trailers/);
      expect(await labelText(page, upper.id), `upper row, zoom step ${z}`).toMatch(/\d+ trailers/);
      await zoomOut(page, box, 1);
    }
  });

  test("NEW-1 — side-by-side rows each carry their own count", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawTrailerRow(page, { x: box.x + 150, y: box.y + 200 }, { x: box.x + 420, y: box.y + 220 });
    await drawTrailerRow(page, { x: box.x + 470, y: box.y + 200 }, { x: box.x + 740, y: box.y + 220 });
    const side = await readTrailers(page);
    expect(side).toHaveLength(2);
    await zoomOut(page, box, 2);
    for (const e of side) expect(await labelText(page, e.id), `side-by-side ${e.id}`).toMatch(/\d+ trailers/);
  });

  test("NEW-2 — Hide label / Show label per row: menu row, Properties switch, persisted, count untouched", async ({ page }) => {
    await startBlank(page);
    const { upper, lower } = await drawStackedRows(page);
    expect(await labelFor(page, upper.id).count()).toBe(1);

    // 1. right-click menu → Hide label (ONE row's label goes; its neighbour's stays)
    await rightClickRow(page, upper.id);
    const row = page.getByTestId("el-menu-label-toggle");
    await expect(row).toHaveText(/Hide label/);
    await row.click();
    await expect(labelFor(page, upper.id)).toHaveCount(0);
    await expect(labelFor(page, lower.id)).toHaveCount(1);
    await expect.poll(async () => (await readTrailers(page)).find((e) => e.id === upper.id)?.labelHidden, { message: "persisted on the row" }).toBe(true);
    expect((await readTrailers(page)).find((e) => e.id === lower.id)?.labelHidden, "the other row is untouched").toBeFalsy();

    // 2. the same switch in Properties reads "Hidden"; the count readout is unaffected by hiding
    await openProperties(page, upper.id);
    const toggle = page.getByTestId("trailer-label-toggle");
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(/Trailer stalls:/).first()).toBeVisible();

    // 3. tick it → the label returns, the flag clears (an untouched row stays byte-identical: key removed)
    await toggle.check();
    await expect(labelFor(page, upper.id)).toHaveCount(1);
    await expect.poll(async () => (await readTrailers(page)).find((e) => e.id === upper.id)?.labelHidden ?? null).toBeNull();

    // 4. the menu row now offers Hide again
    await rightClickRow(page, upper.id);
    await expect(page.getByTestId("el-menu-label-toggle")).toHaveText(/Hide label/);
  });

  test("PDF-PARITY — the exported sheet carries each row's count, and omits a hidden row's label", async ({ page }) => {
    await startBlank(page);
    const { upper, lower } = await drawStackedRows(page);
    const labelsIn = (svg, id) => (svg.match(new RegExp(`data-label-for="${id}"[^>]*>([\\s\\S]*?)</g>`)) || [null, ""])[1].replace(/<[^>]+>/g, "|");
    const shown = await page.evaluate(() => window.__plannerExportSvg());
    expect(labelsIn(shown, lower.id), "lower row on the sheet").toMatch(/trailers/);
    expect(labelsIn(shown, upper.id), "upper row on the sheet").toMatch(/\d+ trailers/);
    await rightClickRow(page, upper.id);
    await page.getByTestId("el-menu-label-toggle").click();
    const hidden = await page.evaluate(() => window.__plannerExportSvg());
    expect(hidden).not.toContain(`data-label-for="${upper.id}"`);
    expect(labelsIn(hidden, lower.id), "the other row keeps its label on the sheet").toMatch(/trailers/);
  });

  test("NEW-3 — Stall depth is editable; a 50′ row draws with the right count (and 53′ still works)", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawTrailerRow(page, { x: box.x + 200, y: box.y + 220 }, { x: box.x + 700, y: box.y + 238 }); // ~50′ deep
    const [row] = await readTrailers(page);
    expect(row.h, "drawn about 50′ deep").toBeLessThan(53);

    // The Properties field exists (a row drawn under the standard adopts the drawn depth as its stall depth).
    await openProperties(page, row.id);
    const depth = page.locator('input[aria-label="Trailer Stall depth (ft)"]');
    await expect(depth).toBeVisible();
    await depth.fill("50");
    await depth.press("Enter");
    await page.waitForTimeout(250);

    const after = (await readTrailers(page))[0];
    expect(after.cfg?.trailerL).toBe(50);
    const perRow = Math.floor(after.w / (after.cfg?.trailerW ?? 12));
    expect(perRow).toBeGreaterThan(10);
    await expect(page.getByText(new RegExp(`Trailer stalls:\\s*${perRow.toLocaleString()}\\b`)).first()).toBeVisible();
    expect(await labelText(page, after.id)).toContain("50′ Trailer Parking");
    expect(await labelText(page, after.id)).toContain(`${perRow.toLocaleString()} trailers`);

    // Other real values are accepted too — 53′ is a value, not a floor.
    await depth.fill("53");
    await depth.press("Enter");
    await page.waitForTimeout(250);
    expect((await readTrailers(page))[0].cfg?.trailerL).toBe(53);
    await depth.fill("45");
    await depth.press("Enter");
    await page.waitForTimeout(250);
    expect((await readTrailers(page))[0].cfg?.trailerL).toBe(45);
  });
});
