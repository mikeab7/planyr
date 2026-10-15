/* NEW-1 (wall layers) — what the Docks & walls strip lists, the canvas must draw. Drives the REAL inspector, logged out.
 * The owner's plan: single-load, docks E, rear W = Walk + Buffer, both ends = Walk + Parking, court + trailer on the dock,
 * two bump-outs. Judged on the persisted model (no two layers of one wall overlap; each starts where the one inboard
 * ends) AND on the painted SVG (every layer has a node with area), before and after a reload, at two rotations.
 * Red on main: the rear buffer sat on top of the rear walk.
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=<chrome> npx playwright test e2e/wall-layers-render.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
});
const hostOf = async (page) => (await plan(page)).find((e) => e.type === "building" && !e.dogEar);
const kidsOf = async (page, id) => (await plan(page)).filter((e) => e.attachedTo === id);
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
const rowBy = (page, sel) => page.locator(`[data-testid="wall-row"]${sel}`);
const addLayer = async (r, key) => { await r.getByTestId("wall-add").click(); await r.page().getByTestId(`wall-add-${key}`).click(); };

const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
// [inner, outer] feet from the wall face, along the wall's outward normal, for a kid on `side`.
function spanOf(b, side, k) {
  const r = ((b.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = k.cx - b.cx, dy = k.cy - b.cy;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const kr = (((k.rot || 0) - (b.rot || 0)) * Math.PI) / 180;
  const kw = Math.abs(k.w * Math.cos(kr)) + Math.abs(k.h * Math.sin(kr)), kh = Math.abs(k.w * Math.sin(kr)) + Math.abs(k.h * Math.cos(kr));
  const vert = side === "left" || side === "right";
  const [nx, ny] = SIDE_N[side];
  const perp = (vert ? nx : ny) * (vert ? lx : ly) - (vert ? b.w : b.h) / 2;
  const d = vert ? kw : kh;
  return [perp - d / 2, perp + d / 2];
}
const sideOfKid = (b, k) => {
  const r = ((b.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = k.cx - b.cx, dy = k.cy - b.cy;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const ox = Math.abs(lx) - b.w / 2, oy = Math.abs(ly) - b.h / 2;
  return oy >= ox ? (ly >= 0 ? "bottom" : "top") : (lx >= 0 ? "right" : "left");
};
// Every non-dock wall's layers never overlap: each starts at or beyond the end of the one inboard of it.
async function expectWallsAgree(page, b) {
  const kids = (await kidsOf(page, b.id)).filter((k) => !k.dogEar && !k.truckCourt && !k.forCourt && !k.forTrailer && !k.prevZone && k.type !== "trailer" && !k.noFit && k.type !== "paving");
  for (const side of ["left", "top", "bottom"]) {
    const layers = kids.filter((k) => sideOfKid(b, k) === side).map((k) => ({ k, sp: spanOf(b, side, k) })).sort((a, c) => a.sp[0] - c.sp[0]);
    let reach = 0;
    for (const { k, sp } of layers) {
      expect(sp[0], `${k.type} on ${side} starts inside the layer before it`).toBeGreaterThanOrEqual(reach - 0.5);
      reach = Math.max(reach, sp[1]);
    }
  }
}
async function expectPainted(page, ids) {
  const dom = await page.evaluate((list) => list.map((id) => {
    const g = document.querySelector(`[data-el-id="${id}"]`);
    if (!g) return { id, found: false };
    const r = g.getBoundingClientRect();
    return { id, found: true, area: r.width * r.height };
  }), ids);
  for (const d of dom) { expect(d.found, `${d.id} is on the canvas`).toBe(true); expect(d.area).toBeGreaterThan(0); }
}

for (const rot of [0, 315]) {
  test(`rear Walk + Buffer, ends Walk + Parking, dock court + trailer, 2 bump-outs — drawn at rot ${rot}`, async ({ page }) => {
    await armPlannerHooks(page);
    await startBlank(page);
    await drawBldg(page, 200, 260, 620, 400);
    await expect.poll(async () => !!(await hostOf(page))).toBe(true);
    const b0 = await hostOf(page);
    await openProps(page, b0.id);
    if (rot) { const f = page.getByLabel("Rotation in degrees"); await f.fill(String(rot)); await f.press("Enter"); await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(rot); }
    await page.locator('[data-testid="loading-wall-picker"] [data-wall="right"]').click();          // single-load, docks E
    await expect.poll(async () => { const h = await hostOf(page); return `${h.dock}/${h.dockSide}`; }).toBe("single/right");

    const rear = rowBy(page, '[data-role="rear"]');
    await addLayer(rear, "sidewalk");
    await addLayer(rear, "buffer");
    const depth = page.getByTestId("wall-depth"); await depth.fill("10"); await depth.press("Enter");
    const dock = rowBy(page, '[data-role="dock"]').first();
    await addLayer(dock, "court"); await addLayer(dock, "trailer");
    for (let i = 0; i < 2; i++) await page.locator('[data-testid="picker-corner-add"]').first().click({ force: true });
    const ends = rowBy(page, '[data-role="ends"]');
    for (let i = 0; i < await ends.count(); i++) { await addLayer(ends.nth(i), "sidewalk"); await addLayer(ends.nth(i), "parking"); }
    await page.waitForTimeout(700);

    const check = async (tag) => {
      const b = await hostOf(page);
      const kids = await kidsOf(page, b.id);
      const rearKids = kids.filter((k) => !k.dogEar && (k.type === "sidewalk" || k.type === "landscape") && sideOfKid(b, k) === "left");
      expect(rearKids.map((k) => k.type).sort(), `${tag}: the rear has a sidewalk and a buffer`).toEqual(["landscape", "sidewalk"]);
      const walk = rearKids.find((k) => k.type === "sidewalk"), buf = rearKids.find((k) => k.type === "landscape");
      const [wi, wo] = spanOf(b, "left", walk), [bi, bo] = spanOf(b, "left", buf);
      expect(wi).toBeCloseTo(0, 0); expect(wo).toBeCloseTo(5, 0);                 // Walk 5′ against the wall
      expect(bi).toBeCloseTo(5, 0); expect(bo - bi).toBeCloseTo(10, 0);           // Buffer 10′ beyond it
      for (const side of ["top", "bottom"]) {
        const types = kids.filter((k) => !k.dogEar && sideOfKid(b, k) === side && (k.type === "sidewalk" || k.type === "parking")).map((k) => k.type).sort();
        expect(types, `${tag}: ${side} end has Walk + Parking`).toEqual(["parking", "sidewalk"]);
      }
      await expectWallsAgree(page, b);
      await expectPainted(page, kids.map((k) => k.id));
    };
    await check("after building");
    await page.reload();
    await expect.poll(async () => (await kidsOf(page, b0.id)).length).toBeGreaterThan(8);
    await page.waitForTimeout(1200);
    await check("after reload");
  });
}

test("a plan saved by the old code (rear buffer on top of the rear walk) heals on open", async ({ page }) => {
  await armPlannerHooks(page);
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(async () => !!(await hostOf(page))).toBe(true);
  const b = await hostOf(page);
  await openProps(page, b.id);
  await page.locator('[data-testid="loading-wall-picker"] [data-wall="right"]').click();
  await expect.poll(async () => (await hostOf(page)).dock).toBe("single");
  const rear = rowBy(page, '[data-role="rear"]');
  await addLayer(rear, "sidewalk");
  await addLayer(rear, "buffer");
  await expect.poll(async () => (await kidsOf(page, b.id)).length).toBe(2);
  // rewrite the stored plan the way the old code left it: the buffer flush against the wall, over the walk
  await page.evaluate((hostId) => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1"));
    const key = Object.keys(map)[0];
    const els = map[key].els;
    const host = els.find((e) => e.id === hostId);
    const buf = els.find((e) => e.type === "landscape");
    buf.cx = host.cx - host.w / 2 - buf.w / 2;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify(map));
  }, b.id);
  await page.reload();
  await page.waitForTimeout(1500);
  const host = await hostOf(page);
  const kids = await kidsOf(page, b.id);
  const walk = kids.find((k) => k.type === "sidewalk"), buf = kids.find((k) => k.type === "landscape");
  expect(spanOf(host, "left", buf)[0]).toBeGreaterThanOrEqual(spanOf(host, "left", walk)[1] - 0.5);
});
