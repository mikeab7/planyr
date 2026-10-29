/* B2498961 (owner 2026-10-29) — a road connected to a building's parking FOLLOWS it on a small move and LETS GO on a big one, driven with the REAL tools:
 * draw a building, give it Car parking from the Properties panel, draw a road into that parking field with the Road tool (the connect gesture stamps the
 * record), then drag the building. Read off the persisted model (on-disk truth) and the app's own read-only junction hook, never a re-implementation.
 *
 *   1  drag the building a little (≈ 40 ft)  → the road's last point travels with the field; every other control point stays; the junction stays
 *   2  drag it far (≈ 300 ft)                 → the road stays exactly where it was drawn and its connection is cleared (no junction)
 *   3  Ctrl+Z after each                      → ONE undo reverses the move AND the road together; Ctrl+Y replays both
 *   4  mid-drag preview                       → while the pointer is still DOWN the road already follows (live), and shows let go past the threshold
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/drive-follows-parking.spec.js --project=chromium */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, roadNetwork } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const PPF = 1.5;                                   // px per foot of the fixed view (world 0,0 is the canvas centre)
const SITE = "e2e-drive-follows-parking";

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
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return (map[Object.keys(map)[0]] || {}).els || [];
});
const settle = (page) => page.waitForTimeout(900);          // let the device mirror write settle
const roadOf = async (page) => (await els(page)).find((e) => e.type === "road");
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
  await row.getByTestId("wall-add").click();
  await page.getByTestId("wall-add-sidewalk").click();
  await page.waitForTimeout(300);
  await row.getByTestId("wall-add").click();
  await page.getByTestId("wall-add-parking").click();
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

test.describe("a drive follows its parking field (the real tools)", () => {
  test.beforeEach(async ({ page }) => { await open(page); });

  test("a small drag carries the road's end with the field; a big one lets go; one Ctrl+Z each", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const s = await setup(page);
    const dx = 40, dy = 25;

    // 1 · small: the field rides the building; the road's LAST point follows by the same offset, nothing else moves
    await dragBy(page, s.mid, dx, dy);
    await settle(page);
    const f1 = await fieldOf(page), r1 = await roadOf(page);
    const fdx = f1.cx - s.field.cx, fdy = f1.cy - s.field.cy;
    expect(Math.hypot(fdx, fdy), "the building drag really moved the field").toBeGreaterThan(30);
    expect(last(r1).x - last(s.road).x).toBeCloseTo(fdx, 0);
    expect(last(r1).y - last(s.road).y).toBeCloseTo(fdy, 0);
    expect(r1.pts.slice(0, -1)).toEqual(s.road.pts.slice(0, -1));
    expect(r1.driveTee && r1.driveTee.targetId).toBe(s.field.id);
    expect((await roadNetwork(page)).drives.length, "the junction is still drawn").toBe(1);

    // Ctrl+Z: ONE step reverses the building, the field AND the road's follow
    await page.keyboard.press("Control+z");
    await settle(page);
    const u = await roadOf(page), uf = await fieldOf(page);
    expect(u.pts).toEqual(s.road.pts);
    expect(uf.cx).toBeCloseTo(s.field.cx, 1);
    // Ctrl+Y replays both
    await page.keyboard.press("Control+y");
    await settle(page);
    const re = await roadOf(page);
    expect(last(re).x).toBeCloseTo(last(r1).x, 1);
    expect(last(re).y).toBeCloseTo(last(r1).y, 1);
    await page.keyboard.press("Control+z");
    await settle(page);

    // 2 · big: past the let-go distance the road stays where it was drawn and the connection is cleared
    await dragBy(page, s.mid, 300, 0);
    await settle(page);
    const f2 = await fieldOf(page), r2 = await roadOf(page);
    expect(Math.hypot(f2.cx - s.field.cx, f2.cy - s.field.cy), "the field really went far").toBeGreaterThan(200);
    expect(r2.pts, "the road stays exactly where it was drawn").toEqual(s.road.pts);
    expect(r2.driveTee, "its connection to the field is cleared").toBeUndefined();
    expect((await roadNetwork(page)).drives.length, "no junction is drawn to a field it left").toBe(0);
    await page.keyboard.press("Control+z");
    await settle(page);
    const u2 = await roadOf(page);
    expect(u2.pts).toEqual(s.road.pts);
    expect(u2.driveTee && u2.driveTee.targetId, "undo brings the connection back").toBe(s.field.id);
    expect((await roadNetwork(page)).drives.length).toBe(1);
    expect(errors).toEqual([]);
  });

  test("the preview follows LIVE while the pointer is still down, and shows the road let go before the drop", async ({ page }) => {
    const s = await setup(page);
    // hold the drag at 40 ft: the road is already following on screen (the canvas state), before any release
    await dragBy(page, s.mid, 40, 0, { release: false });
    const live = await page.evaluate(() => window.__plannerRoadNet && window.__plannerRoadNet());
    expect(live.drives.length, "the junction is drawn to the moved field mid-drag").toBe(1);
    // carry on past the threshold WITHOUT releasing: the preview lets go
    const p = await at(page, s.mid.x + 40, s.mid.y), q = await at(page, s.mid.x + 300, s.mid.y);
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 8 });
    await page.mouse.move(q.x, q.y, { steps: 8 });
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? -1, { message: "mid-drag, past the threshold, the junction is gone" }).toBe(0);
    // …and dragging back inside it brings the connection back, still without a release
    const back = await at(page, s.mid.x + 30, s.mid.y);
    await page.mouse.move(back.x, back.y, { steps: 12 });
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? -1, { message: "dragged back inside, the junction returns" }).toBe(1);
    await page.mouse.up();
    await settle(page);
    const r = await roadOf(page);
    expect(r.driveTee && r.driveTee.targetId).toBe(s.field.id);
    expect(Math.hypot(last(r).x - last(s.road).x, last(r).y - last(s.road).y)).toBeGreaterThan(20);
  });
});
