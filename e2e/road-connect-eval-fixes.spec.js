/* B959/B960/B961 — owner-evaluation fixes to the road connect + intersection work. Drives the REAL
 * SVG canvas LOGGED OUT (no account, no GIS) with Snap OFF, reading outcomes from the persisted site
 * model + the rendered overlay. The pure geometry (findRoadConnect edge tolerance, weldCoverPolygon,
 * the teeGeometry feasibility clamp) is unit-tested in test/roadGeometry.test.js; these are the
 * connect + render + paint-order guards.
 *   • B960/NEW-2 — two roads welded end-to-end render a seam-hiding weld cover (no leftover curb line).
 *   • B961/NEW-3 — the connect engages at the target's OUTER CURB EDGE, not only the hidden centerline.
 *   • B959/NEW-1 — a building painted OVER a junction always wins (the overlay renders below buildings).
 * The truck-court sizing (WB-62 ≈50 ft return, feasibility-clamped) shares the parking-drive render
 * path (road-drive-connect.spec.js) and is unit-tested; its live render parks in VERIFICATION.md. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const weldCovers = (p) => p.locator('[data-testid="road-weld-cover"]');

function roadsData(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || [])
      .filter((e) => e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2)
      .map((e) => ({ id: e.id, pts: e.pts, travelW: e.travelW, curb: e.curb }));
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}
// Pick the Road tool at a specific travel-width preset (or the first — 24 ft — when w is omitted).
async function pickRoad(page, w) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  if (w) await page.getByRole("button", { name: new RegExp(`${w}.*travel — click points`, "i") }).click();
  else await page.getByRole("button", { name: /travel — click points/i }).first().click();
}

test.describe("B959/B960/B961 — road connect evaluation fixes", () => {
  test("NEW-2: two different-width roads welded end-to-end render a seam-hiding weld cover (Snap OFF)", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });      // focus — Snap stays OFF (default)
    const box = await canvas(page).boundingBox();

    // A wide (40 ft) road, then a default (24 ft) road ending EXACTLY on its right endpoint. Different
    // widths → they WELD (not merge), both remain, and a weld cover paints over the two butting caps.
    await pickRoad(page, 40);
    await page.mouse.click(box.x + 300, box.y + 320);
    await page.mouse.click(box.x + 560, box.y + 320);
    await page.keyboard.press("Enter");
    await expect.poll(() => roadsData(page).then((r) => r.length)).toBe(1);

    await pickRoad(page);                                          // 24 ft
    await page.mouse.click(box.x + 560, box.y + 180);
    await page.mouse.click(box.x + 560, box.y + 320);             // on the wide road's right endpoint
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    await expect.poll(() => roadsData(page).then((r) => r.length)).toBe(2); // welded (not merged into one)
    await expect(weldCovers(page).first()).toBeAttached();
  });

  test("NEW-3: a road connects at a wide road's CURB EDGE, beyond its centerline tolerance (Snap OFF)", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const box = await canvas(page).boundingBox();

    await pickRoad(page, 40);
    await page.mouse.click(box.x + 300, box.y + 320);
    await page.mouse.click(box.x + 560, box.y + 320);            // 260 px span, endpoint at (560,320)
    await page.keyboard.press("Enter");
    await expect.poll(() => roadsData(page).then((r) => r.length)).toBe(1);

    const r1 = (await roadsData(page))[0];
    const ftLen = Math.hypot(r1.pts[1].x - r1.pts[0].x, r1.pts[1].y - r1.pts[0].y);
    const ppf = 260 / ftLen;                                     // px-per-foot from the known 260 px span
    const halfW = (r1.travelW || 40) / 2 + (r1.curb || 0.5);     // centerline → back-of-curb
    const tolFt = Math.min(12 / ppf, 10);                        // the centerline connect tolerance (connectTolFt)
    const offPx = (tolFt + halfW / 2) * ppf;                     // past the centerline zone, inside the edge zone

    // Road 2 ends offPx ABOVE the wide road's right endpoint — over its curb line, well past the
    // centerline tolerance. It connects ONLY because the tolerance is now measured to the EDGE.
    await pickRoad(page);                                         // 24 ft
    await page.mouse.click(box.x + 560, box.y + 320 - offPx - 150);
    await page.mouse.click(box.x + 560, box.y + 320 - offPx);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    await expect.poll(() => roadsData(page).then((r) => r.length)).toBe(2); // connected at the edge → weld
    await expect(weldCovers(page).first()).toBeAttached();
  });

  test("NEW-3 control: an endpoint BEYOND the curb edge does not connect (Snap OFF)", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const box = await canvas(page).boundingBox();

    await pickRoad(page, 40);
    await page.mouse.click(box.x + 300, box.y + 320);
    await page.mouse.click(box.x + 560, box.y + 320);
    await page.keyboard.press("Enter");
    const r1 = (await roadsData(page))[0];
    const ftLen = Math.hypot(r1.pts[1].x - r1.pts[0].x, r1.pts[1].y - r1.pts[0].y);
    const ppf = 260 / ftLen;
    const halfW = (r1.travelW || 40) / 2 + (r1.curb || 0.5);
    const tolFt = Math.min(12 / ppf, 10);
    const offPx = (tolFt + halfW + 20) * ppf;                    // clearly past the curb edge

    await pickRoad(page);
    await page.mouse.click(box.x + 560, box.y + 320 - offPx - 150);
    await page.mouse.click(box.x + 560, box.y + 320 - offPx);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    await expect.poll(() => roadsData(page).then((r) => r.length)).toBe(2);
    await expect(weldCovers(page)).toHaveCount(0);               // no connect → no weld cover
  });

  test("NEW-1: a building over a road junction paints ON TOP of the connection overlay (building always wins)", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const box = await canvas(page).boundingBox();

    // A road tee → the clean-intersection overlay (road-tee-layer) renders.
    await pickRoad(page);
    await page.mouse.click(box.x + 260, box.y + 340);
    await page.mouse.click(box.x + 720, box.y + 340);
    await page.keyboard.press("Enter");
    await pickRoad(page);
    await page.mouse.click(box.x + 490, box.y + 160);
    await page.mouse.click(box.x + 490, box.y + 340);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="road-tee-layer"]')).toBeVisible();

    // A building dragged over the junction.
    await page.getByRole("button", { name: "Building", exact: true }).click();
    await page.mouse.move(box.x + 430, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 560, box.y + 300, { steps: 4 });
    await page.mouse.move(box.x + 560, box.y + 420, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press("Escape");

    // The building group (unique shadow filter) must come AFTER the overlay in document order, so it
    // paints on top — connection pavement can never overlap a building.
    const buildingPaintsOnTop = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const tee = svg && svg.querySelector('[data-testid="road-tee-layer"]');
      const bldg = svg && svg.querySelector('g[filter="url(#bldgShadow)"]');
      if (!tee || !bldg) return null;
      return !!(tee.compareDocumentPosition(bldg) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(buildingPaintsOnTop).toBe(true);
  });
});
