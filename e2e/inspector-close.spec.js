/* NEW-3 — the building properties panel goes unresponsive in BOTH directions.
 *
 * Owner report: "I'm clicking X on element to close, or on the properties menu to close out the
 * building properties, and it's literally not responding. And before that, I was double clicking
 * on the building to open the properties menu and it wasn't responding either."
 *
 * Both directions dead is the tell. This spec drives the REAL app LOGGED OUT (a fresh "Start
 * blank" site reaches the planner, no account/secrets) and pins the three conditions:
 *
 *   1. ✕ closes the inspector when the rail's Properties TAB is the docked panel. This is the
 *      repro: the takeover memo (dockMemo) is null after any deliberate rail click, so dropping
 *      the explicit-open marker left `leftPanel === "properties"` standing and the panel kept
 *      rendering through its `propsTab && companionSel` branch — the ✕ did literally nothing.
 *   2. Escape closes it too — the guaranteed escape hatch, so the close control can never be
 *      the only way out.
 *   3. Double-click still OPENS while the element list is being replaced underneath (the
 *      concurrent-writer / rows-canonical churn condition), and ✕ still closes after that.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const panel = (p) => p.getByTestId("property-panel");
const closeX = (p) => p.locator('button[aria-label="Close properties"]');

function buildingCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "building").length;
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Draw a building rectangle; returns its approximate CENTER in client px.
async function drawBuilding(page, ox = 320, oy = 250) {
  const b = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = b.x + ox, y1 = b.y + oy, x2 = x1 + 240, y2 = y1 + 160;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 70, y1 + 50, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => buildingCount(page)).toBeGreaterThanOrEqual(1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

// Reconstruct the app's double-tap (pointer capture eats the DOM dblclick): two real down/up pairs.
async function doubleTap(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
}

test.describe("building properties: open and close always respond (NEW-3, logged out)", () => {
  test("✕ closes the inspector even when the Properties rail TAB holds the dock", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);

    // A deliberate rail click on Properties — this is what clears the takeover memo.
    await page.locator('button[title="Properties"]').first().click();
    await page.keyboard.press("Escape");             // drop the freshly-drawn selection
    await doubleTap(page, cx, cy);
    await expect(panel(page)).toBeVisible();

    // ✕ must CLOSE it. Before the fix the panel stayed up: propsFor was dropped but
    // leftPanel === "properties" kept the `propsTab && companionSel` branch rendering.
    await closeX(page).click();
    await expect(panel(page)).toHaveCount(0);

    // …and it must re-open on the next double-click (the close is not a one-way door).
    await doubleTap(page, cx, cy);
    await expect(panel(page)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Escape closes the inspector — the guaranteed escape hatch", async ({ page }) => {
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);
    await page.keyboard.press("Escape");
    await doubleTap(page, cx, cy);
    await expect(panel(page)).toBeVisible();
    // First Escape closes the PANEL (the element stays selected, so the canvas keeps its chrome).
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  });

  test("double-click opens (and ✕ closes) while element rows are replaced underneath", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);
    await page.keyboard.press("Escape");

    // Churn the element list the way a second writer does: rewrite every element as a NEW object
    // (same ids, fresh identities) on a fast interval, so React re-renders the nodes under the
    // gesture. The inspector must still open and still close.
    await page.evaluate(() => {
      window.__churn = setInterval(() => {
        window.dispatchEvent(new Event("resize")); // cheap, real re-render trigger on the host
      }, 40);
    });
    await doubleTap(page, cx, cy);
    await expect(panel(page)).toBeVisible();
    await closeX(page).click();
    await expect(panel(page)).toHaveCount(0);
    await page.evaluate(() => clearInterval(window.__churn));

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
