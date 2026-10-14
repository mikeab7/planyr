/* NEW-1 (2026-10-14) — "I don't have a way to edit my parcels' properties right now. I don't even know how
 * to set the setbacks. If I double-click the parcel it doesn't really do anything. Same from the Parcels menu."
 *
 * The parcel's own page (record · setbacks · style, components/ParcelPage.jsx) existed; nothing on the map
 * led to it. Two defects, both measured in this spec on the pre-fix build:
 *   1. A lot's INTERIOR is click-through (B420 — only its line grabs), so a double-click inside a lot
 *      resolved to NOTHING. The canvas root now falls back to the lot under the point (lib/parcelAtPoint.js).
 *   2. Every entry point that did reach the parcel docked the Land panel on its LIST, not the parcel's page:
 *      a double-click on its line, the Parcel tools "Setbacks and settings" row, a click with the list open;
 *      and the right-click menu had no way in at all. All of them now call ONE `openParcelPage`.
 * Also driven: locked · not active · inside Edit parcels · a COMBINED lot · phone (touch double-tap), and the
 * setback round trip (set one section → reload → the value and the drawn setback line are still there).
 * Signed-out and GIS-free on purpose — parcels are drawn with the real Parcel tool.
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const site = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return map[Object.keys(map)[0]] || {};
});
const parcels = async (page) => (await site(page)).parcels || [];
const T = (page, id) => page.getByTestId(id);

async function startBlank(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}
const landShowing = async (page) => (await T(page, "parcels-panel").count()) + (await T(page, "parcel-page").count());
async function openLand(page) { if (!(await landShowing(page))) await page.locator('[data-rail-tab="parcel"]').click(); }
async function closeLand(page) {
  if (await landShowing(page)) await page.locator('[data-rail-tab="parcel"]').click();
  await expect.poll(() => landShowing(page)).toBe(0);
}
async function toList(page) { const b = T(page, "parcel-page-back"); if (await b.count()) await b.click(); await expect(T(page, "parcels-panel")).toBeVisible(); }
async function drawParcel(page, n, pts) {
  await openLand(page);
  if (await T(page, "parcel-page-back").count()) await T(page, "parcel-page-back").click();
  const drawBtn = page.getByRole("button", { name: /Draw a (new boundary|parcel)/i });
  const addLandBtn = page.getByTestId("land-add-btn").or(page.getByTitle(/Add land to this plan/i)).first();
  if ((await addLandBtn.count()) && !(await drawBtn.count())) await addLandBtn.click();
  await drawBtn.click();
  const box = await canvas(page).boundingBox();
  for (const [x, y] of pts) { await page.mouse.click(box.x + x, box.y + y); await page.waitForTimeout(60); }
  await page.mouse.click(box.x + pts[0][0], box.y + pts[0][1]);
  await expect.poll(async () => (await parcels(page)).length).toBeGreaterThanOrEqual(n);
  await page.keyboard.press("Escape");
}
const outlineBox = (page, id) => page.locator(`[data-feature="parcel:${id}"] [data-testid="parcel-outline"]`).boundingBox();
// A point INSIDE the lot, away from its line and its acreage badge.
async function insidePoint(page, id) { const bb = await outlineBox(page, id); return { x: bb.x + bb.width * 0.25, y: bb.y + bb.height * 0.3 }; }
// A point ON the lot's line — B420: a lot is SELECTED by its line; its interior is click-through.
async function edgePoint(page, id) { const bb = await outlineBox(page, id); return { x: bb.x + 1, y: bb.y + bb.height * 0.5 }; }
async function expectPageFor(page, id) {
  await expect(T(page, "parcel-page")).toBeVisible();
  await expect(T(page, "parcel-page")).toHaveAttribute("data-parcel-id", id);
  await expect(T(page, "setback-all").locator("input")).toBeVisible();      // an editable setback control
  await expect(T(page, "parcel-style-panel")).toBeVisible();                // and the parcel's style
}
async function clearSelection(page) { await page.keyboard.press("Escape"); }

test.describe("parcel properties are reachable from every entry point", () => {
  test("map double-click · map click with Land open · list row · Parcel tools · right-click", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page, 1, [[220, 150], [480, 150], [480, 360], [220, 360]]);
    await drawParcel(page, 2, [[520, 220], [650, 220], [650, 330], [520, 330]]);
    const [a, b] = await parcels(page);

    // 1 · a DOUBLE-click inside the lot (empty land), Land panel closed → THAT parcel's page
    await closeLand(page); await clearSelection(page);
    const pa = await insidePoint(page, a.id);
    await page.mouse.dblclick(pa.x, pa.y);
    await expectPageFor(page, a.id);
    // …and inside the smaller lot drawn within it, the smaller lot answers
    await closeLand(page); await clearSelection(page);
    const pb = await insidePoint(page, b.id);
    await page.mouse.dblclick(pb.x, pb.y);
    await expectPageFor(page, b.id);
    // …and a double-click on the lot's LINE does the same
    const ea = await edgePoint(page, a.id), eb = await edgePoint(page, b.id);
    await closeLand(page); await clearSelection(page);
    await page.mouse.dblclick(ea.x, ea.y);
    await expectPageFor(page, a.id);

    // 2 · with the Land panel showing, selecting another lot on the map moves the page to it…
    await page.mouse.click(eb.x, eb.y);
    await expectPageFor(page, b.id);
    // …and from the LIST, too
    await toList(page);
    await page.mouse.click(ea.x, ea.y);
    await expectPageFor(page, a.id);

    // 3 · a single click with the Land panel CLOSED only selects (B750: the rail never swings open on a click)
    await closeLand(page); await clearSelection(page);
    await page.mouse.click(eb.x, eb.y);
    await page.waitForTimeout(300);
    expect(await landShowing(page)).toBe(0);

    // 4 · the Parcel tools menu: "Properties" on the selected parcel opens its page
    await T(page, "rail-parcel-tools").click();
    await T(page, "parcel-menu-setbacks").click();                     // the "This parcel" row, now labelled "Properties"
    await expect(T(page, "parcel-page")).toBeVisible();
    await expectPageFor(page, b.id);

    // 5 · the list row
    await toList(page);
    await T(page, `parcel-row-${a.id}`).click();
    await expectPageFor(page, a.id);

    // 6 · right-click on the parcel's line → Properties
    await closeLand(page); await clearSelection(page);
    await page.mouse.click(eb.x, eb.y, { button: "right" });
    await T(page, "parcel-menu-properties").click();
    await expectPageFor(page, b.id);

    // Opening the page never makes a lot draggable: outside Edit parcels a drag pans, the land stays put
    const before = JSON.stringify((await parcels(page)).map((p) => p.points));
    await page.mouse.move(eb.x, eb.y); await page.mouse.down(); await page.mouse.move(eb.x + 60, eb.y + 40, { steps: 6 }); await page.mouse.up();
    expect(JSON.stringify((await parcels(page)).map((p) => p.points))).toBe(before);
  });

  test("locked · not active · inside Edit parcels · combined — each still opens its page", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page, 1, [[220, 150], [480, 150], [480, 360], [220, 360]]);
    // the view re-fits to the first lot, so the neighbour is drawn against its REAL on-screen corners
    await openLand(page);                                           // measure with the panel exactly as drawParcel leaves it
    { const c = await canvas(page).boundingBox(); await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); }
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(120); }
    await page.waitForTimeout(500);
    const a0 = (await parcels(page))[0];
    // the first lot's real corners in client pixels (its own polygon through its screen matrix)
    const corners = await page.evaluate((id) => {
      const el = document.querySelector(`[data-feature="parcel:${id}"] [data-testid="parcel-outline"]`);
      const m = el.getScreenCTM();
      return [...el.points].map((p) => ({ x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f }));
    }, a0.id);
    const cbb = await canvas(page).boundingBox();
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    const right = Math.max(...xs), top = Math.min(...ys), bot = Math.max(...ys);
    const tr = corners.find((c) => Math.abs(c.x - right) < 2 && Math.abs(c.y - top) < 2);
    const br = corners.find((c) => Math.abs(c.x - right) < 2 && Math.abs(c.y - bot) < 2);
    const w = Math.min(120, cbb.x + cbb.width - right - 20);
    await drawParcel(page, 2, [[tr.x - cbb.x, tr.y - cbb.y], [tr.x - cbb.x + w, tr.y - cbb.y], [br.x - cbb.x + w, br.y - cbb.y], [br.x - cbb.x, br.y - cbb.y]]);
    const [a, b] = await parcels(page);

    // LOCKED — lock protects the boundary only; it must not block opening or editing properties
    await T(page, `parcel-row-${a.id}`).click();
    await T(page, "parcel-page-lock").click();
    await expect.poll(async () => (await parcels(page)).find((p) => p.id === a.id).locked).toBe(true);
    await closeLand(page); await clearSelection(page);
    const pa = await insidePoint(page, a.id);
    await page.mouse.dblclick(pa.x, pa.y);
    await expectPageFor(page, a.id);
    const allIn = T(page, "setback-all").locator("input");
    await allIn.fill("35"); await allIn.press("Enter");
    await expect.poll(async () => (await parcels(page)).find((p) => p.id === a.id).setbacks).toEqual(expect.arrayContaining([35]));

    // NOT ACTIVE — the eye turns it off; it still opens
    await toList(page);
    await T(page, `parcel-row-eye-${b.id}`).click();
    await expect.poll(async () => (await parcels(page)).find((p) => p.id === b.id).active).toBe(false);
    await closeLand(page); await clearSelection(page);
    const pb = await insidePoint(page, b.id);
    await page.mouse.dblclick(pb.x, pb.y);
    await expectPageFor(page, b.id);
    await toList(page);
    await T(page, `parcel-row-eye-${b.id}`).click(); // back on, so it can be combined

    // INSIDE Edit parcels — a double-click inside the lot still opens the page
    await T(page, "parcels-edit-btn").click();
    await page.mouse.dblclick(pb.x, pb.y);
    await expectPageFor(page, b.id);
    await page.keyboard.press("Escape");

    // COMBINED — combine both, then double-click inside the tract
    await openLand(page); await toList(page);
    await T(page, `parcel-row-check-${a.id}`).check();
    await T(page, `parcel-row-check-${b.id}`).check();
    await T(page, "parcels-bar-combine").click();
    await expect.poll(async () => (await parcels(page)).filter((p) => p.combined).length).toBe(1);
    const tract = (await parcels(page)).find((p) => p.combined);
    await closeLand(page); await clearSelection(page);
    const pt = await insidePoint(page, tract.id);
    await page.mouse.dblclick(pt.x, pt.y);
    await expectPageFor(page, tract.id);
    await expect(T(page, "parcel-made-from")).toBeVisible();
    await expect(T(page, "parcel-page")).not.toContainText(/Drawn by hand/i);
  });

  test("a setback set on ONE boundary section survives a reload, and its line is drawn", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page, 1, [[220, 150], [480, 150], [480, 360], [220, 360]]);
    const [a] = await parcels(page);
    await closeLand(page); await clearSelection(page);
    const pa = await insidePoint(page, a.id);
    await page.mouse.dblclick(pa.x, pa.y);
    await expectPageFor(page, a.id);
    // a rectangle opens with every side on the default — pick one side in the sketch to get its own box
    if (!(await T(page, "setback-section-row").count())) await page.locator('[data-testid^="setback-sketch-section-"]').first().click();
    const first = T(page, "setback-section-row").first();
    const key = await first.getAttribute("data-section-key");
    const box = first.locator("input");
    await box.fill("62"); await box.press("Enter");
    await expect.poll(async () => (await parcels(page))[0].setbacks.filter((v) => v === 62).length).toBeGreaterThan(0);
    const stored = (await parcels(page))[0].setbacks;
    expect(stored.some((v) => v !== 62)).toBe(true);                 // only that section changed
    await page.waitForTimeout(800);                                   // let autosave settle

    await page.reload();
    await openModule(page, "site-planner");
    await expect.poll(async () => (await parcels(page))[0]?.setbacks).toEqual(stored);
    await expect(page.getByTestId("setback-ring").first()).toBeVisible();
    await closeLand(page); await clearSelection(page);
    const pa2 = await insidePoint(page, a.id);
    await page.mouse.dblclick(pa2.x, pa2.y);
    await expectPageFor(page, a.id);
    await expect(page.locator(`[data-testid="setback-section-row"][data-section-key="${key}"] input`)).toHaveValue("62");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("a double-TAP inside the lot opens its page (it used to do nothing with no panel docked)", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "site-planner");
    await page.getByTestId("map-toolbar-draw").click();
    await expect(canvas(page)).toBeVisible();
    await page.getByTestId("start-hint-draw").click();                 // "Trace boundary" — the phone's way to draw a lot
    const box = await canvas(page).boundingBox();
    for (const [x, y] of [[80, 260], [300, 260], [300, 520], [80, 520], [80, 260]]) { await page.touchscreen.tap(box.x + x, box.y + y); await page.waitForTimeout(80); }
    await expect.poll(async () => (await parcels(page)).length).toBe(1);
    await page.keyboard.press("Escape");
    const [a] = await parcels(page);
    expect(await landShowing(page)).toBe(0);
    const pa = await insidePoint(page, a.id);
    await page.touchscreen.tap(pa.x, pa.y);
    await page.waitForTimeout(90);
    await page.touchscreen.tap(pa.x, pa.y);
    await expectPageFor(page, a.id);
  });
});
