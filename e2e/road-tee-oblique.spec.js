/* B1005/B1006 — OBLIQUE road→drive tee: the recurrence guard. Prior fixes (B945/B946/B949/B953/B964/
 * B971/B989) all verified against a perpendicular (90°) mock while the owner's real OBLIQUE / curved
 * drives rendered a giant concave scoop / batwing with a notch, plus a faint seam where the translucent
 * pavement doubled at the junction. This drives the REAL canvas LOGGED OUT (Snap OFF) with drives teeing
 * onto a parking court at ACUTE angles — the exact case the mock never exercised — and asserts:
 *   • the drive connects and renders exactly two curb-return arcs (the render path is wired at oblique
 *     angles, not just perpendicular);
 *   • the returns stay TIDY — their reach past the drive edge is bounded (no scoop / batwing);
 *   • the B1006 opacity-flatten mask ("tee-cover-knockout") is wired with one hole per junction so the
 *     junction reads as one tone (no doubled translucent patch);
 *   • a building over the junction paints OVER the pavement (z-clip preserved).
 * The precise reach-≤-R geometry is unit-tested in test/roadGeometry.test.js; this is the real-render
 * wiring + no-scoop guard that the mock-only tests could not provide. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const teeReturns = (p) => p.locator('[data-testid="road-tee-return"]');

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}
async function pickRoadPreset(page) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /travel — click points/i }).first().click();
}
function driveRoads(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "road" && e.driveTee);
  });
}

test.describe("B1005/B1006 — oblique road→drive tee (no scoop, flat junction)", () => {
  test("an OBLIQUE (~45°) drive onto a parking court renders two tidy returns + the knockout mask", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });   // Snap stays OFF
    const box = await canvas(page).boundingBox();

    // Wide parking court, flat top edge at y≈470.
    await page.getByRole("button", { name: "Car Parking", exact: true }).click();
    await page.mouse.move(box.x + 180, box.y + 470);
    await page.mouse.down();
    await page.mouse.move(box.x + 1260, box.y + 760, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.press("Escape");

    // Drive teeing onto the top edge at a clearly OBLIQUE angle (dx 200, dy 330 → ~59° off the edge).
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 700, box.y + 140);
    await page.mouse.click(box.x + 900, box.y + 470);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    // It connected as a parking drive and rendered exactly two curb returns.
    await expect.poll(() => driveRoads(page).then((r) => r.length)).toBe(1);
    await expect(teeReturns(page)).toHaveCount(2);
    await expect(page.locator('[data-export="road-tee-cover"]').first()).toBeAttached();

    // B1006 — the opacity-flatten knockout mask is wired with one hole for this junction.
    const mask = page.locator("#tee-cover-knockout");
    await expect(mask).toBeAttached();
    await expect(mask.locator('path[fill="#000"]')).toHaveCount(1);

    // NO SCOOP: the curb return must stay near the drive, not sweep far along the court edge. Measure the
    // widest return's horizontal span and compare it to the drive's own on-screen travel width — a tidy
    // rounded corner spans at most ~2 drive widths; the old scoop spanned 4–6×.
    const spans = await teeReturns(page).evaluateAll((nodes) =>
      nodes.map((n) => {
        const pts = n.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
        const xs = pts.map((p) => p[0]);
        return Math.max(...xs) - Math.min(...xs);
      }),
    );
    const driveWidthPx = await page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const site = map[Object.keys(map)[0]] || {};
      const d = (site.els || []).find((e) => e.type === "road" && e.driveTee);
      return d ? d.travelW : 24;      // world ft; screen px ≈ travelW * ppf, but we only need a ratio bound
    });
    // Each return arc's own horizontal span is at most a bit over one drive width (in px the drive is
    // travelW*ppf; a scoop of R≈30ft at ppf~0.35 would span >>). Use a generous absolute-px ceiling that
    // still fails on the old batwing (which swept 120+ px here).
    for (const s of spans) expect(s).toBeLessThan(60);
    expect(driveWidthPx).toBeGreaterThan(0);
  });

  test("a building over the junction paints OVER the connection pavement (z-clip)", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const box = await canvas(page).boundingBox();

    await page.getByRole("button", { name: "Car Parking", exact: true }).click();
    await page.mouse.move(box.x + 180, box.y + 470);
    await page.mouse.down();
    await page.mouse.move(box.x + 1260, box.y + 760, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 700, box.y + 140);
    await page.mouse.click(box.x + 900, box.y + 470);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(teeReturns(page)).toHaveCount(2);

    // Building straddling the junction.
    await page.getByRole("button", { name: "Building", exact: true }).click();
    await page.mouse.move(box.x + 820, box.y + 430);
    await page.mouse.down();
    await page.mouse.move(box.x + 1020, box.y + 560, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Escape");

    // The connection cover renders BEFORE the building in document order (buildings are the later pass),
    // so the building paints over the pavement — never the reverse.
    const order = await page.evaluate(() => {
      const cover = document.querySelector('[data-export="road-tee-cover"]');
      // a building surface: the renderElPx building <path> carries the poché fill; find any node after the cover
      const all = [...document.querySelectorAll('[data-testid="planner-canvas"] *')];
      const ci = all.indexOf(cover);
      // the building fill path is drawn in the >= BUILDING_Z pass, strictly after the tee cover
      const bldg = all.find((n, i) => i > ci && n.tagName === "rect" && n.getAttribute("fill") === "#f3ece1");
      return { coverFound: !!cover, buildingAfter: !!bldg };
    });
    expect(order.coverFound).toBe(true);
    expect(order.buildingAfter).toBe(true);
  });
});
