/* B875 (edit-path recurrence) — right-clicking a pond opens the POND element menu ("Detention
 * pond" → ⚙ Pond settings / 📐 Sizing assistant / Set purpose), NEVER the generic canvas map menu
 * (Zoom to fit / Paste / Export to Google Earth…).
 *
 * The regression: #656 made a pond's map LABEL a pointer target (single-click reveals its inspector)
 * but gave the label an onPointerDown WITHOUT an onContextMenu. The label renders on top of the
 * basin, so a right-click on the visible pond hit the label <g>, whose contextmenu event had no
 * handler and bubbled up to the canvas → the empty-map menu. The fix routes the label's right-click
 * to the same onElContext the pond body uses. This spec drives the real SVG canvas LOGGED OUT
 * (no account) on a seeded-blank site and asserts the acceptance outcome: right-click a pond → its
 * "Detention pond" section shows, and the map menu does not. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

function pondCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "pond").length;
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Drag a detention-pond rectangle; return its approximate CENTER (where the carto label sits).
async function drawPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pondCount(page)).toBeGreaterThanOrEqual(1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

test.describe("pond right-click → the pond menu, never the map menu (logged out)", () => {
  test("right-click a pond shows the Detention pond section, not the empty-map menu", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawPond(page);
    await page.keyboard.press("Escape"); // Select tool + deselect (the pond label is a pointer target only in Select)

    await page.mouse.click(cx, cy, { button: "right" });

    // The pond's dedicated element-menu section appears…
    await expect(page.getByRole("button", { name: /Pond settings/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sizing assistant/i })).toBeVisible();
    // …and the generic empty-map menu (its unique "Export to Google Earth" row) does NOT.
    await expect(page.getByText(/Export to Google Earth/i)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
