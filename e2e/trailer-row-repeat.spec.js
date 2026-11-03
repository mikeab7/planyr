/* NEW-1 — a wall takes a second (and further) row of trailer parking. Drives the REAL inspector, logged out:
 * Court + shortened Trailer → the "+" still offers Trailer parking → the new row and a buffer take the trailer's length and
 * position at their own default depths → each layer's length is editable alone → survives a reload.
 * Run: BASE_URL=http://localhost:4173 npx playwright test e2e/trailer-row-repeat.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, addWallLayer, dragWallLayerEnd, reopenBuildingPanel } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
});
const hostOf = async (page) => (await plan(page)).find((e) => e.type === "building" && !e.dogEar);
const trailersOf = async (page, id) => (await plan(page)).filter((e) => e.attachedTo === id && e.type === "trailer");
async function drawBldg(page, x1, y1, x2, y2) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 12 });
  await page.mouse.up();
}
async function openProps(page, id) {
  const pt = await page.evaluate((elId) => {
    const r = document.querySelector(`[data-el-id="${elId}"]`).querySelector("rect, path").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("building-header")).toBeVisible();
}
const rotate = async (page, deg) => { const f = page.getByLabel("Rotation in degrees"); await f.fill(String(deg)); await f.press("Enter"); };
const rowByRole = (page, role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const addLayer = addWallLayer;
async function boot(page, deg) {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(async () => !!(await hostOf(page))).toBe(true);
  const b = await hostOf(page);
  await openProps(page, b.id);
  if (deg) { await rotate(page, deg); await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(deg); }
  return b;
}
// distance between two trailer centres measured ALONG the building's outward normal for the dock wall
const sorted = (host, side, ts) => {
  const sg = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
  const r = (host.rot * Math.PI) / 180, u = { x: sg[0] * Math.cos(r) - sg[1] * Math.sin(r), y: sg[0] * Math.sin(r) + sg[1] * Math.cos(r) };
  return ts.map((t) => ({ ...t, out: (t.cx - host.cx) * u.x + (t.cy - host.cy) * u.y })).sort((a, b) => a.out - b.out);
};

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

// a layer's along-wall extent read off the model: its length and its centre along the wall (host frame)
const alongOf = (host, side, z) => {
  const horiz = side === "top" || side === "bottom", r = (host.rot * Math.PI) / 180;
  const t = horiz ? { x: Math.cos(r), y: Math.sin(r) } : { x: -Math.sin(r), y: Math.cos(r) };
  const centre = (z.cx - host.cx) * t.x + (z.cy - host.cy) * t.y;
  // a trailer's w IS its along length; a strip's is w on a top/bottom wall, h on a side wall
  const len = z.type === "trailer" ? z.w : (horiz ? z.w : z.h);
  return { len, centre };
};

for (const deg of [0, 315]) {
  test(`rot ${deg}: the + menu repeats Trailer parking; a new layer takes the length + position of the one before it, at its own default depth`, async ({ page }) => {
    const b = await boot(page, deg);
    const dock = rowByRole(page, "dock").first();
    await addLayer(dock, "court");
    await addLayer(dock, "trailer");
    await expect(dock.getByTestId("wall-piece")).toHaveCount(2);
    const side = (await plan(page)).find((e) => e.attachedTo === b.id && e.truckCourt).truckCourt.side;

    // NEW-1 (2026-11-03): the edit box carries NO length controls at all — length is changed by the handles on the map
    await dock.getByTestId("wall-piece").nth(0).click();
    await expect(page.getByTestId("wall-extent")).toHaveCount(0);
    await dock.getByTestId("wall-piece").nth(1).click();
    await expect(page.getByTestId("wall-edit-box")).toBeVisible();
    for (const id of ["wall-extent", "wall-extent-len", "wall-extent-full", "wall-align-start", "wall-align-centre", "wall-align-end"]) await expect(page.getByTestId(id)).toHaveCount(0);
    await page.keyboard.press("Escape");
    // a layer straight after the court runs the full court length
    const host0 = await hostOf(page);
    const fullLen = alongOf(host0, side, sorted(host0, side, await trailersOf(page, b.id))[0]).len;
    expect(fullLen).toBeGreaterThan(100);

    // shorten trailer row 1 by its handle: the dragged (far) end moves in, the near end holds
    await dragWallLayerEnd(page, host0, side, sorted(host0, side, await trailersOf(page, b.id))[0], "plus", 40);
    await expect.poll(async () => { const h = await hostOf(page); return Math.round(alongOf(h, side, sorted(h, side, await trailersOf(page, b.id))[0]).len); }).toBeLessThan(Math.round(fullLen) - 20);
    await page.keyboard.press("Escape");
    const host = await hostOf(page);
    const t1 = sorted(host, side, await trailersOf(page, b.id))[0];
    const a1 = alongOf(host, side, t1);
    expect(a1.len).toBeGreaterThan(fullLen - 80);                 // (the drag snaps to the grid, so not exactly 40)
    expect(a1.centre).toBeCloseTo(-(fullLen - a1.len) / 2, 0);    // the start end held, the far end pulled in
    await reopenBuildingPanel(page, host);

    // the named button is Buffer now; a second trailer row is in the ▾ list under its full name
    await expect(dock.getByTestId("wall-add")).toHaveAttribute("data-kind", "buffer");
    await dock.getByTestId("wall-add-more").click();
    await expect(page.getByTestId("wall-add-trailer")).toContainText("Trailer parking");
    await page.getByTestId("wall-add-trailer").click();
    await addLayer(dock, "buffer");
    await expect(dock.getByTestId("wall-piece")).toHaveCount(4);
    expect(await dock.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")))).toEqual(["court", "trailer", "trailer", "buffer"]);

    const h2 = await hostOf(page);
    const all = await plan(page);
    const ts = sorted(h2, side, await trailersOf(page, b.id));
    const buf = all.find((e) => e.attachedTo === b.id && e.buffer);
    for (const z of [ts[1], buf]) {
      const a = alongOf(h2, side, z);
      expect(a.len).toBeCloseTo(a1.len, 0);                     // same length …
      expect(a.centre).toBeCloseTo(a1.centre, 0);               // … same position
    }
    expect(ts.map((t) => Math.round(t.zd))).toEqual([50, 50]);  // default depth, nothing copied
    expect(ts[1].out - ts[0].out).toBeCloseTo(50, 0);           // adjacent rows
    await expect(dock.getByTestId("wall-piece").nth(2)).toContainText("50′");

    // dragging the new row's handle leaves row 1 alone
    const h2b = await hostOf(page);
    await dragWallLayerEnd(page, h2b, side, sorted(h2b, side, await trailersOf(page, b.id))[1], "plus", 30);
    await expect.poll(async () => { const h = await hostOf(page); return Math.round(alongOf(h, side, sorted(h, side, await trailersOf(page, b.id))[1]).len); }).toBeLessThan(Math.round(a1.len) - 10);
    const h3 = await hostOf(page);
    expect(alongOf(h3, side, sorted(h3, side, await trailersOf(page, b.id))[0]).len).toBeCloseTo(a1.len, 0);
    await page.keyboard.press("Escape");
    await reopenBuildingPanel(page, h3);

    // still one line per wall; every row draws; survives a reload
    expect(await dock.getByTestId("wall-strip").evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(40);
    for (const t of await trailersOf(page, b.id)) await expect(page.locator(`[data-el-id="${t.id}"]`)).toHaveCount(1);
    await page.reload();
    await expect.poll(async () => (await trailersOf(page, b.id)).length).toBe(2);
    const h4 = await hostOf(page);
    expect(alongOf(h4, side, sorted(h4, side, await trailersOf(page, b.id))[1]).len).toBeLessThan(a1.len - 10);
  });
}

test("removing the middle trailer row closes the gap; removing the court takes every trailer row", async ({ page }) => {
  const b = await boot(page, 0);
  const dock = rowByRole(page, "dock").first();
  await addLayer(dock, "court"); await addLayer(dock, "trailer"); await addLayer(dock, "trailer");
  await expect(dock.getByTestId("wall-piece")).toHaveCount(3);
  const mid = dock.getByTestId("wall-piece").nth(1);
  await mid.click();
  if (!(await page.getByTestId("wall-piece-remove").isVisible())) await mid.click();   // the first press may only dismiss the add menu
  await page.getByTestId("wall-piece-remove").click();
  await expect(dock.getByTestId("wall-piece")).toHaveCount(2);
  expect((await trailersOf(page, b.id)).length).toBe(1);
  await addLayer(dock, "trailer");
  await expect(dock.getByTestId("wall-piece")).toHaveCount(3);
  const court = dock.getByTestId("wall-piece").nth(0);
  await court.click();
  if (!(await page.getByTestId("wall-piece-remove").isVisible())) await court.click();   // the first press may only dismiss the add menu
  await page.getByTestId("wall-piece-remove").click();
  await expect(dock.getByTestId("wall-piece")).toHaveCount(0);
  expect((await trailersOf(page, b.id)).length).toBe(0);
});
