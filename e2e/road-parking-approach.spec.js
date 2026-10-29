/* NEW-1 (road → employee parking, every approach) — drives the REAL tools: the Parking tool draws a field, the Road tool draws the drives, a right-click on the field's
 * edge offers "Add a road from here". Each case asserts the FINISHED result through the app's own read-only hooks (`__plannerRoadNet`: junctions, stall clips, mouths;
 * `__plannerExportSvg`: the exported clone) — never a re-implementation of the solver.
 *
 *   1  a drive crossing a stall ROW to reach the aisle  → the stalls under it are gone from the picture AND the count; the Properties "Stalls" number agrees
 *   2  a drive landing a few feet off an aisle's centre → the endpoint is centred on the aisle (the connect snap)
 *   3  a drive running ALONG the aisle-mouth face     → one outline opening per aisle
 *   4  right-click the field's edge → "Add a road from here" → the new road is welded there
 *   5  Delete the road → the field is whole again; Ctrl+Z brings the junction back exactly; Ctrl+Y removes it again
 *   6  the export clone (the flattened PDF's source) carries the same stall rows as the canvas
 *
 * The cross-approach matrix (every angle × rotation × rect/polygon × free/bonded) is the pure suite test/driveParkingMatrix.test.js.
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/road-parking-approach.spec.js --project=chromium */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, roadNetwork } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const PPF = 3;                                   // px per foot of the fixed view (world 0,0 is the canvas centre)
const SITE = "e2e-road-parking-approach";

async function open(page) {
  await armPlannerHooks(page);
  const site = { id: SITE, groupId: SITE, site: "Approach", name: "A", origin: null, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
    localStorage.setItem("planarfit:startHintDismissed", "1");
  }, [SITE, site]);
  await page.goto("/");
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
  await expect(canvas(page)).toBeVisible();
  await page.evaluate((ppf) => window.__plannerView.centerOn(0, 0, ppf), PPF);
  await page.waitForTimeout(400);
}
/** screen point of a world-feet point under the fixed view */
async function at(page, fx, fy) {
  const box = await canvas(page).boundingBox();
  const v = await page.evaluate(() => window.__plannerView.get());
  return { x: box.x + v.offX + fx * v.ppf, y: box.y + v.offY + fy * v.ppf };
}
const click = async (page, fx, fy, o) => { const p = await at(page, fx, fy); await page.mouse.click(p.x, p.y, o); };

async function drawField(page, x0, y0, x1, y1) {
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  const a = await at(page, x0, y0), b = await at(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}
async function drawRoad(page, pts) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  for (const [x, y] of pts) await click(page, x, y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}
const planEls = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return (map[Object.keys(map)[0]] || {}).els || [];
});
const clipOf = async (page, id) => ((await roadNetwork(page))?.stallClips || []).find((c) => c.id === id) || null;

test.describe("road → parking field, the real tools", () => {
  test.beforeEach(async ({ page }) => { await open(page); });

  test("1 · a drive crossing a stall row: the stalls under it leave the picture and the count", async ({ page }) => {
    await drawField(page, -100, -31, 100, 31);
    const field = (await planEls(page)).find((e) => e.type === "parking");
    expect(field.h).toBeGreaterThan(60);                         // one full module (two rows + the aisle)
    await drawRoad(page, [[0, -100], [0, -28]]);                 // ends 3 ft INSIDE the field's top edge: the connect welds it at the face
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
    const net = await roadNetwork(page);
    expect(net.drives[0].kind).toBe("parking");
    expect(net.drives[0].wedges).toBe(2);
    const clip = await clipOf(page, field.id);
    expect(clip).toBeTruthy();
    expect(clip.removed.length).toBeGreaterThanOrEqual(3);
    expect(clip.removed.length).toBeLessThanOrEqual(4);
    expect(clip.removed.every((k) => k.startsWith("0:"))).toBe(true);   // only the row the drive crosses
    expect(clip.count).toBe(clip.base - clip.removed.length);
    // the band outlines are RUNS now (each an interrupted-outline group): the crossed row is two pieces, one each side of the gap, plus the far row
    const rects = await page.locator(`[data-testid="band-outline-cut"][data-el-id="${field.id}"]`).count();
    expect(rects).toBeGreaterThanOrEqual(3);
    // and the Properties card reads the same count
    const dc = await at(page, 60, 0);
    await page.mouse.dblclick(dc.x, dc.y);
    await expect(page.getByTestId("property-panel")).toBeVisible();
    await expect(page.getByTestId("property-panel")).toContainText(String(clip.count));
  });

  test("2 · a landing a few feet off the aisle's centre is centred on the aisle", async ({ page }) => {
    await drawField(page, -100, -31, 100, 31);
    const field = (await planEls(page)).find((e) => e.type === "parking");
    // local aisle centre = 30 ft down from the field's top edge: world y = field top + 30
    const top = field.cy - field.h / 2, aisleY = top + 30;
    await drawRoad(page, [[-170, aisleY + 5], [-98, aisleY + 5]]);   // 5 ft off, 2 ft inside the left face
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
    const road = (await planEls(page)).find((e) => e.type === "road");
    const end = road.pts[road.pts.length - 1];
    expect(Math.abs(end.y - aisleY)).toBeLessThan(0.5);               // centred on the aisle (it was 5 ft off)
    expect(Math.abs(end.x - (field.cx - field.w / 2))).toBeLessThan(0.5);   // welded ON the face
    const clip = await clipOf(page, field.id);
    expect(clip ? clip.removed.length : 0).toBe(0);                   // a drive down the aisle removes nothing
  });

  test("3 · a drive running along the aisle-mouth face opens every aisle", async ({ page }) => {
    await drawField(page, -100, -61, 100, 61);                        // two modules → two aisles
    const field = (await planEls(page)).find((e) => e.type === "parking");
    await drawRoad(page, [[-114, -100], [-114, 100]]);                // 26 ft road, near curb on the left face
    await expect.poll(async () => ((await roadNetwork(page))?.mouths || []).find((m) => m.id === field.id)?.mouths.length ?? 0).toBe(2);
    expect((await roadNetwork(page)).drives.length).toBe(0);          // no endpoint junction — it runs along
    expect(await clipOf(page, field.id)).toBeNull();
  });

  test("4 · right-click the field's edge → Add a road from here → the new road is welded there", async ({ page }) => {
    await drawField(page, -100, -31, 100, 31);
    const field = (await planEls(page)).find((e) => e.type === "parking");
    const p = await at(page, -40, -31);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await page.getByTestId("parking-road-from-here").click();
    await click(page, -40, -100);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
    const road = (await planEls(page)).find((e) => e.type === "road");
    expect(road.driveTee.targetId).toBe(field.id);
    const start = road.pts[0], top = field.cy - field.h / 2;
    expect(Math.abs(start.y - top)).toBeLessThan(0.5);
    expect(Math.abs(start.x - -40)).toBeLessThan(3);
  });

  test("4b · the menu row is withheld on a LOCKED field", async ({ page }) => {
    await drawField(page, -100, -31, 100, 31);
    const c = await at(page, 0, 0);
    await page.mouse.click(c.x, c.y, { button: "right" });
    await page.getByRole("button", { name: /^Lock/ }).first().click();
    const p = await at(page, -40, -31);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(page.getByTestId("parking-road-from-here")).toHaveCount(0);
  });

  test("5 · delete the road → the field is whole; undo brings the junction back exactly; redo removes it again", async ({ page }) => {
    await drawField(page, -100, -31, 100, 31);
    const field = (await planEls(page)).find((e) => e.type === "parking");
    await drawRoad(page, [[0, -100], [0, -28]]);
    await expect.poll(async () => (await clipOf(page, field.id))?.removed.length ?? 0).toBeGreaterThan(0);
    const before = await clipOf(page, field.id);
    await click(page, 0, -70);                                        // select the road by its body
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await clipOf(page, field.id)) === null).toBe(true);
    expect((await roadNetwork(page)).drives.length).toBe(0);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await clipOf(page, field.id))?.removed.length ?? 0).toBe(before.removed.length);
    expect((await clipOf(page, field.id)).removed).toEqual(before.removed);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await clipOf(page, field.id)) === null).toBe(true);
  });

  test("6 · the export clone carries the same stall rows as the canvas (PDF-PARITY)", async ({ page }) => {
    await drawField(page, -100, -31, 100, 31);
    const field = (await planEls(page)).find((e) => e.type === "parking");
    await drawRoad(page, [[0, -100], [0, -28]]);
    await expect.poll(async () => (await clipOf(page, field.id))?.removed.length ?? 0).toBeGreaterThan(0);
    const live = await page.locator(`[data-testid="band-outline-cut"][data-el-id="${field.id}"]`).count();
    const clone = await page.evaluate(async (id) => {
      const svg = await window.__plannerExportSvg();
      if (!svg) return -1;
      return new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll(`[data-testid="band-outline-cut"][data-el-id="${id}"]`).length;
    }, field.id);
    expect(clone).toBe(live);
    expect(live).toBeGreaterThanOrEqual(3);                           // 2 rows + the second run of the crossed one
  });
});
