/* NEW-1 (2026-11-10) — a road's control point, dragged and dropped, STAYS where it was dropped, on a road whose OTHER end is connected to a parking field
 * (the drive-follow rule recomputes such a road from the gesture's base; before the fix any write that left the dragged road's points alone put the base
 * geometry back over the owner's drop). Driven with the REAL tools: draw a building + parking, draw a road into the field (stamps the drive record), select
 * the road, drag its FREE end by a big amount and by a couple of feet, read the persisted model, reload and read it again.
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/road-end-drop-stays.spec.js --project=chromium */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, roadNetwork, addWallLayer } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const PPF = 1.5;                                   // px per foot of the fixed view (world 0,0 is the canvas centre)
const SITE = "e2e-road-end-drop-stays";

async function open(page) {
  await armPlannerHooks(page);
  const site = { id: SITE, groupId: SITE, site: "Follow", name: "A", origin: null, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
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
async function at(page, fx, fy) {
  const box = await canvas(page).boundingBox();
  const v = await page.evaluate(() => window.__plannerView.get());
  return { x: box.x + v.offX + fx * v.ppf, y: box.y + v.offY + fy * v.ppf };
}
const click = async (page, fx, fy) => { const p = await at(page, fx, fy); await page.mouse.click(p.x, p.y); };
const els = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return (map[Object.keys(map)[0]] || {}).els || [];
});
const settle = (page) => page.waitForTimeout(900);          // let the device mirror write settle
const roadOf = async (page) => (await els(page)).find((e) => e.type === "road" && e.driveTee);
const fieldOf = async (page) => (await els(page)).find((e) => e.type === "parking" && e.attachedTo);
const last = (r) => r.pts[r.pts.length - 1];

/** the face of the bonded field that points AWAY from its building, as { point just inside it, outward unit } */
function outwardFace(field, building) {
  const rad = ((field.rot || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const ex = Math.abs(c) * field.w / 2 + Math.abs(s) * field.h / 2, ey = Math.abs(s) * field.w / 2 + Math.abs(c) * field.h / 2;
  const dx = field.cx - building.cx, dy = field.cy - building.cy;
  return Math.abs(dy) >= Math.abs(dx)
    ? { n: { x: 0, y: Math.sign(dy) }, inside: { x: field.cx, y: field.cy + Math.sign(dy) * (ey - 3) } }
    : { n: { x: Math.sign(dx), y: 0 }, inside: { x: field.cx + Math.sign(dx) * (ex - 3), y: field.cy } };
}

async function setup(page) {
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const a = await at(page, -120, -45), b = await at(page, 120, 45);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: /^Properties$/ }).click();
  // one wall: Add → Sidewalk, then Add → Parking (the field rides the sidewalk, which rides the building)
  const row = page.locator('[data-testid="wall-row"]:not([data-role="dock"])').first();
  await addWallLayer(row, "sidewalk");
  await page.waitForTimeout(300);
  await addWallLayer(row, "parking");
  await settle(page);
  const all = await els(page);
  const building = all.find((e) => e.type === "building" && !e.attachedTo), field = all.find((e) => e.type === "parking" && e.attachedTo === building.id);
  expect(field, "the building should carry a bonded parking field: " + JSON.stringify(all.map((e) => [e.type, e.attachedTo || null, e.cx, e.cy, e.w, e.h]))).toBeTruthy();
  // the Road tool, ending 3 ft inside the field's outward face: the connect gesture welds it there and stamps the record
  const f = outwardFace(field, building), far = { x: f.inside.x + f.n.x * 90, y: f.inside.y + f.n.y * 90 };
  await page.keyboard.press("Escape");
  await page.evaluate(([x, y, ppf]) => window.__plannerView.centerOn(x, y, ppf), [(far.x + f.inside.x) / 2, (far.y + f.inside.y) / 2, PPF]);   // both points well inside the canvas
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await click(page, far.x, far.y);
  await click(page, f.inside.x, f.inside.y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Select V$/ }).click();
  await settle(page);
  const road = await roadOf(page);
  expect(road, "the road should be drawn").toBeTruthy();
  expect(road.driveTee && road.driveTee.targetId, "the Road tool should have connected it to the parking field").toBe(field.id);
  await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
  return { building, field, road, mid: { x: building.cx + 90, y: building.cy + 10 }   /* clear of the "Connected" toast, which sits over the middle */ };
}
async function dragBy(page, from, dxFt, dyFt, { release = true, steps = 12 } = {}) {
  const p = await at(page, from.x, from.y), q = await at(page, from.x + dxFt, from.y + dyFt);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps });
  await page.mouse.move(q.x, q.y, { steps });
  if (release) await page.mouse.up();
}


async function dragHandle(page, idx, dxFt, dyFt) {
  const h = page.getByTestId(`road-vtx-${idx}`);
  const b = await h.boundingBox();
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 }, q = { x: p.x + dxFt * PPF, y: p.y + dyFt * PPF };
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 8 });
  await page.mouse.move(q.x, q.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

/** a main road across the drive's free end's side: `gap` ft out from the free end, 400 ft long, as the Road tool draws it */
async function drawMainRoad(page, road, field, building) {
  const f = outwardFace(field, building), n = f.n, t = { x: -n.y, y: n.x };
  const far = road.pts[0], gap = 70;
  const a = { x: far.x + n.x * gap - t.x * 200, y: far.y + n.y * gap - t.y * 200 }, b = { x: far.x + n.x * gap + t.x * 200, y: far.y + n.y * gap + t.y * 200 };
  await page.keyboard.press("Escape");
  await page.evaluate(([x, y, ppf]) => window.__plannerView.centerOn(x, y, ppf), [(a.x + b.x) / 2, (a.y + b.y) / 2, 1.0]);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await click(page, a.x, a.y);
  await click(page, b.x, b.y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Select V$/ }).click();
  await settle(page);
  const main = (await els(page)).filter((e) => e.type === "road").find((e) => e.id !== road.id);
  expect(main, "the main road should be drawn").toBeTruthy();
  return { main, n, t, a, b };
}
const distToLine = (p, a, b) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);

test.describe("a dropped road control point stays where it was dropped (the real tools)", () => {
  test.beforeEach(async ({ page }) => { await open(page); });

  test("the free end dragged onto a main road lands there and STAYS; a few-foot nudge of that junction stays too; reload keeps both", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const s = await setup(page);
    const { main, n, t } = await drawMainRoad(page, s.road, s.field, s.building);
    await page.evaluate(([x, y, ppf]) => window.__plannerView.centerOn(x, y, ppf), [s.road.pts[0].x + n.x * 30, s.road.pts[0].y + n.y * 30, PPF]);
    await page.waitForTimeout(300);
    const mid = { x: (s.road.pts[0].x + s.road.pts[1].x) / 2, y: (s.road.pts[0].y + s.road.pts[1].y) / 2 };
    await page.keyboard.press("Escape");
    await click(page, mid.x, mid.y);
    await expect.poll(() => page.locator('[data-testid^="road-vtx-"]').count(), { timeout: 10_000 }).toBe(2);

    // 1 · drag the free end 70 ft out and 25 ft along, onto the main road (a skewed drive made square-ish)
    await dragHandle(page, 0, n.x * 70 + t.x * 25, n.y * 70 + t.y * 25);
    const r1 = await roadOf(page), main1 = (await els(page)).find((e) => e.id === main.id);
    const onMain = (p) => distToLine(p, main.pts[0], main.pts[main.pts.length - 1]);
    expect(onMain(r1.pts[0]), `the dropped end should sit on the main road, not snapped back (got ${JSON.stringify(r1.pts[0])}, started ${JSON.stringify(s.road.pts[0])})`).toBeLessThan(2);
    expect(Math.hypot(r1.pts[0].x - s.road.pts[0].x, r1.pts[0].y - s.road.pts[0].y), "it really left its old spot").toBeGreaterThan(50);
    expect(main1.pts.length, "the main road took the tee").toBeGreaterThan(main.pts.length);
    expect(r1.driveTee && r1.driveTee.targetId, "the other end is still connected to its field").toBe(s.field.id);

    // 2 · nudge that junction a few feet along the main road
    await page.keyboard.press("Escape");
    await click(page, (r1.pts[0].x + r1.pts[1].x) / 2, (r1.pts[0].y + r1.pts[1].y) / 2);
    await expect.poll(() => page.locator('[data-testid^="road-vtx-"]').count(), { timeout: 10_000 }).toBe(2);
    await dragHandle(page, 0, t.x * 4, t.y * 4);
    const r2 = await roadOf(page);
    expect(Math.hypot(r2.pts[0].x - r1.pts[0].x, r2.pts[0].y - r1.pts[0].y), `a 4 ft nudge of the junction should hold (got ${JSON.stringify(r2.pts[0])} from ${JSON.stringify(r1.pts[0])})`).toBeGreaterThan(2);

    await page.waitForTimeout(1500);
    expect((await roadOf(page)).pts[0]).toEqual(r2.pts[0]);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await page.waitForTimeout(600);
    expect((await roadOf(page)).pts[0]).toEqual(r2.pts[0]);
    expect(errors).toEqual([]);
  });
});
