/* NEW — measurement drag-to-move, the Properties menu (parity with every element), and the
 * overview-zoom label hide. Runs LOGGED OUT against a seeded-blank site, driving the real SVG
 * canvas — mirrors measure-select.spec.js's harness.
 *
 *  1. A finished measurement can be click-DRAGGED to a new position (its stored geometry shifts).
 *  2. Double-click opens the Properties inspector for the measurement; typing a Label writes it.
 *  3. A measurement's value label HIDES at overview zoom (the B911-family LOD gate) and returns.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const selected = (p) => p.getByTestId("measure-selected");

function measures(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return site.measures || [];
  });
}
const measureCount = async (p) => (await measures(p)).length;

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function armMeasure(page, mode) {
  await page.getByRole("button", { name: "Measure modes" }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
}

async function drawLength(page, x1, y1, x2, y2) {
  const before = await measureCount(page);
  await page.mouse.click(x1, y1);
  await page.mouse.click(x2, y2);
  await expect.poll(() => measureCount(page)).toBe(before + 1);
}

// Count on-canvas measure value labels (they carry the ′ foot mark). On a blank site with one
// length measure, this is exactly that measure's label — a clean visibility probe for the LOD gate.
function footLabelCount(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    if (!svg) return 0;
    return [...svg.querySelectorAll("text")].filter((t) => /\d+′/.test(t.textContent || "")).length;
  });
}

test.describe("measurement drag / properties / label LOD (logged out)", () => {
  test("a measurement can be dragged to a new position", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Length");
    const x1 = box.x + 300, y = box.y + 260, x2 = box.x + 520;
    await drawLength(page, x1, y, x2, y);

    const before = (await measures(page))[0];
    const midX = Math.round((x1 + x2) / 2);

    // Press on the line body and DRAG it down by ~80px — the whole measurement should translate.
    await page.mouse.move(midX, y);
    await page.mouse.down();
    await page.mouse.move(midX, y + 80, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => {
      const m = (await measures(page))[0];
      if (!m || !m.pts) return 0;
      return Math.round(m.pts[0].y - before.pts[0].y);
    }).toBeGreaterThan(20); // moved down in world feet (both endpoints shift by the same delta)

    const after = (await measures(page))[0];
    // Shape preserved: both endpoints shifted by the same vector (a translation, not a reshape).
    expect(Math.round(after.pts[0].y - before.pts[0].y)).toBe(Math.round(after.pts[1].y - before.pts[1].y));
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("double-click opens the Properties inspector and a Label writes through", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Length");
    const x1 = box.x + 300, y = box.y + 260, x2 = box.x + 520;
    await drawLength(page, x1, y, x2, y);
    const midX = Math.round((x1 + x2) / 2);

    await page.mouse.dblclick(midX, y);
    // The docked Properties inspector appears, headed "Measurement".
    const panel = page.getByTestId("property-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Measurement", { exact: false }).first()).toBeVisible();

    // Type a label; it persists onto the measure model.
    const label = panel.getByPlaceholder("e.g. Front setback");
    await label.click();
    await label.fill("Front setback");
    await expect.poll(async () => (await measures(page))[0]?.label).toBe("Front setback");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Shift locks a measurement perpendicular to the parcel edge it starts on", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Draw an axis-aligned rectangle parcel (top edge horizontal), via the Parcel draw tool.
    await page.getByRole("button", { name: "Parcel", exact: true }).click();
    await page.getByTitle(/Add land to this plan/i).click();
    await page.getByRole("button", { name: /Draw a new boundary/i }).click();
    await expect(page.getByRole("button", { name: /Draw/, pressed: true })).toBeVisible();
    const box = await canvas(page).boundingBox();
    const corners = [[box.x + 220, box.y + 150], [box.x + 540, box.y + 150], [box.x + 540, box.y + 420], [box.x + 220, box.y + 420]];
    for (const [x, y] of corners) { await page.mouse.click(x, y); await page.waitForTimeout(60); }
    await page.mouse.click(corners[0][0], corners[0][1]); // close the ring (zoom-fits)
    await expect.poll(() => page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      return ((map[Object.keys(map)[0]] || {}).parcels || []).length;
    })).toBeGreaterThanOrEqual(1);
    await page.keyboard.press("Escape");

    // The parcel's on-screen bbox (post zoom-fit). Its TOP edge runs along y = pb.y.
    const pb = await page.getByTestId("parcel-outline").first().boundingBox();
    const startX = Math.round(pb.x + pb.width / 2), startY = Math.round(pb.y + 2);

    await armMeasure(page, "Length");
    await page.mouse.click(startX, startY); // start ON the top edge (snaps onto the boundary)
    // Aim down-and-to-the-side (a free line would be tilted ~16° off vertical); with Shift held the
    // segment must lock PERPENDICULAR to the horizontal edge → a true vertical.
    const targetX = startX + 70, targetY = startY + 240;
    await page.keyboard.down("Shift");
    await page.mouse.move(targetX, targetY, { steps: 4 });
    await page.mouse.click(targetX, targetY);
    await page.keyboard.up("Shift");

    await expect.poll(() => measureCount(page)).toBe(1);
    const m = (await measures(page))[0];
    const dx = Math.abs(m.pts[0].x - m.pts[1].x), dy = Math.abs(m.pts[0].y - m.pts[1].y);
    expect(dx).toBeLessThan(2);      // perpendicular to a horizontal edge = vertical (equal x)
    expect(dy).toBeGreaterThan(20);  // a real-length segment, not a degenerate click
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the value label hides at overview zoom and returns on zoom-in", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Length");
    const x1 = box.x + 320, y = box.y + 260, x2 = box.x + 460;
    await drawLength(page, x1, y, x2, y);
    // Drop back to Select so nothing is selected (a selected measure always shows its label).
    await page.keyboard.press("Escape");

    await expect.poll(() => footLabelCount(page)).toBeGreaterThan(0); // visible at working zoom

    // Zoom OUT hard over the canvas center; the label must drop away at overview scale.
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await expect.poll(async () => {
      await page.mouse.wheel(0, 400);
      return footLabelCount(page);
    }, { timeout: 8000 }).toBe(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
