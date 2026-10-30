/* NEW-1…NEW-3 (2026-10-30, owner: "add drive-in ramps … just add another little plus button close by") — driven with the REAL tools: draw a building, press the
 * small ramp "+" beside a dock wall's buttons, and watch the model, the canvas, the door belt and Properties agree.
 *
 *   1  select the building             → a small ramp "+" sits beside each dock wall's "+ / −" pair and beside each purple corner "+"; none overlap
 *   2  press the wall's ramp "+"       → ONE driveInRamp child (16 ft, 8 %, straight-in, 50 ft long), its Properties open, the belt loses the doors under it,
 *                                        the building reads "· 1 drive-in"
 *   3  layout → along the wall         → the footprint hugs the face (50 ft along × 16 ft out)
 *   4  grade 12 %                      → the amber flag; 8 % clears it
 *   5  delete (button, then Ctrl+Z)    → the doors come back; undo brings the ramp back; undo again removes it
 *   6  a corner ramp "+" (along)       → the ramp sits at the END of the belt by that corner
 *   7  two PNGs at the close-in (≈50 ft) view under ui-audit/screenshots/drive-in-ramp/ — the picture is the check the numbers cannot make
 *
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/drive-in-ramp.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE = "e2e-drive-in-ramp";
const SHOTS = "ui-audit/screenshots/drive-in-ramp";

async function open(page, ppf = 3) {
  await armPlannerHooks(page);
  const site = { id: SITE, groupId: SITE, site: "Ramp", name: "A", origin: null, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
    localStorage.setItem("planarfit:startHintDismissed", "1");
  }, [SITE, site]);
  await page.goto("/");
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
  await expect(canvas(page)).toBeVisible();
  await page.evaluate((z) => window.__plannerView.centerOn(0, 0, z), ppf);
  await page.waitForTimeout(400);
}
async function at(page, fx, fy) {
  const box = await canvas(page).boundingBox();
  const v = await page.evaluate(() => window.__plannerView.get());
  return { x: box.x + v.offX + fx * v.ppf, y: box.y + v.offY + fy * v.ppf };
}
const els = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return (map[Object.keys(map)[0]] || {}).els || [];
});
const settle = (page) => page.waitForTimeout(900);
const rampsOf = async (page) => (await els(page)).filter((e) => e.type === "driveInRamp");
const buildingOf = async (page) => (await els(page)).find((e) => e.type === "building" && !e.attachedTo);

async function drawAndSelectBuilding(page) {
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const a = await at(page, -120, -45), b = await at(page, 120, 45);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Select V$/ }).click();
  await settle(page);
  const bl = await buildingOf(page);
  expect(bl, "the building should exist").toBeTruthy();
  // the app may re-frame after the first element lands (boot framing); pin the view where the buttons are legible before pressing anything
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 3), [bl.cx, bl.cy]);
  await page.waitForTimeout(500);
  const p = await at(page, bl.cx, bl.cy);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("feature-edit-nodes")).toBeVisible();
  return bl;
}
/** every ramp "+" on screen as { x, y, title } (centre of its disc) */
const rampButtons = (page) => page.evaluate(() => [...document.querySelectorAll('[data-ramp-add="1"]')].map((g) => {
  const r = g.querySelector("circle").getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2, title: (g.querySelector("title") || {}).textContent || "" };
}));
const allButtonDiscs = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="feature-edit-nodes"] g[data-el-action="1"]')].map((g) => {
  const r = g.querySelector("circle").getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 };
}));
const doorLeaves = (page, id) => page.evaluate((i) => document.querySelectorAll(`[data-el-id="${i}"] rect[fill="#c2c9d2"]`).length, id);

test.describe("drive-in ramps on dock walls", () => {
  test("the small ramp '+' beside the dock-wall buttons adds, edits, flags, deletes and undoes a ramp", async ({ page }) => {
    await open(page);
    const bl = await drawAndSelectBuilding(page);
    const leavesBefore = await doorLeaves(page, bl.id);
    expect(leavesBefore, "the belt should show dock doors").toBeGreaterThan(4);

    // 1 — the buttons: ramp "+" glyphs exist (wall + corner), and no two on-building discs overlap
    const btns = await rampButtons(page);
    expect(btns.length).toBeGreaterThanOrEqual(2);
    expect(btns.some((b) => b.title === "Add drive-in ramp")).toBe(true);
    const discs = await allButtonDiscs(page);
    for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
      expect(Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y), `buttons ${i} and ${j} overlap`).toBeGreaterThanOrEqual(discs[i].r + discs[j].r - 0.5);
    }

    // 2 — press the SOUTH-most wall button that sits near the wall's middle (a wall button, not a corner one)
    const mid = await at(page, bl.cx, bl.cy);
    const wallBtn = btns.filter((b) => Math.abs(b.x - mid.x) < 60).sort((a, b) => b.y - a.y)[0];
    expect(wallBtn, "a wall-middle ramp button").toBeTruthy();
    await page.mouse.click(wallBtn.x, wallBtn.y);
    await settle(page);
    const ramps = await rampsOf(page);
    expect(ramps).toHaveLength(1);
    const r = ramps[0];
    expect(r.attachedTo).toBe(bl.id);
    expect(r.ramp).toMatchObject({ width: 16, gradePct: 8, layout: "straight", door: "12x14", wings: true, bollards: true });
    expect(r.ramp.riseIn).toBeUndefined();
    const horiz = r.ramp.side === "top" || r.ramp.side === "bottom";
    expect(Math.round(horiz ? r.h : r.w)).toBe(50);
    expect(Math.round(horiz ? r.w : r.h)).toBe(16);
    await expect(page.getByTestId("ramp-panel")).toBeVisible();
    await expect(page.getByTestId("ramp-length")).toHaveText("50 ft");
    expect(await doorLeaves(page, bl.id)).toBeLessThan(leavesBefore);                       // the belt lost the doors under it
    expect(await doorLeaves(page, bl.id)).toBeGreaterThanOrEqual(leavesBefore - 3);
    await expect(page.locator(`[data-el-id="${r.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-el-id="${r.id}"] [data-ramp-label]`)).toContainText("RAMP 8%");

    // 3 — along the wall: 50 along × 16 out
    await page.getByTestId("ramp-layout-along").click();
    await settle(page);
    const along = (await rampsOf(page))[0];
    expect(along.ramp.layout).toBe("along");
    expect(Math.round(horiz ? along.w : along.h)).toBe(50);
    expect(Math.round(horiz ? along.h : along.w)).toBe(16);
    await page.getByTestId("ramp-layout-straight").click();

    // 4 — grade 12 % raises the amber flag, 8 % clears it
    const grade = page.getByTestId("ramp-grade").locator("input").first().or(page.getByLabel("Ramp grade"));
    await page.getByLabel("Ramp grade").fill("12"); await page.getByLabel("Ramp grade").press("Enter");
    await expect(page.getByTestId("ramp-flag-grade")).toBeVisible();
    await expect(page.getByTestId("ramp-flag-grade")).toContainText("10%");
    await expect.poll(async () => { const q = (await rampsOf(page))[0]; return Math.round(horiz ? q.h : q.w); }).toBe(33);   // 4 ft ÷ 12 % = 33 ft
    await page.getByLabel("Ramp grade").fill("8"); await page.getByLabel("Ramp grade").press("Enter");
    await expect(page.getByTestId("ramp-flag-grade")).toHaveCount(0);
    expect(grade).toBeTruthy();

    // 5 — delete → the doors come back; undo → the ramp is back; undo again → gone
    await page.getByTestId("ramp-delete").click();
    await settle(page);
    expect(await rampsOf(page)).toHaveLength(0);
    expect(await doorLeaves(page, bl.id)).toBe(leavesBefore);
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("Control+z");
    await settle(page);
    expect(await rampsOf(page)).toHaveLength(1);
    expect(await doorLeaves(page, bl.id)).toBeLessThan(leavesBefore);
    // keep undoing: each step is one edit (grade, layout…), and the add itself is the last one — the ramp is gone, nothing else is
    let steps = 0;
    while ((await rampsOf(page)).length && steps < 10) { await page.keyboard.press("Control+z"); steps++; await page.waitForTimeout(250); }
    await settle(page);
    expect(await rampsOf(page)).toHaveLength(0);
    expect(steps).toBeGreaterThanOrEqual(2);
    expect(await doorLeaves(page, bl.id)).toBe(leavesBefore);
    for (let i = 0; i < steps; i++) { await page.keyboard.press("Control+y"); await page.waitForTimeout(250); }
    await settle(page);
    expect(await rampsOf(page)).toHaveLength(1);

    // the Delete key removes a selected ramp, as for any element
    const rr = (await rampsOf(page))[0];
    const rp = await at(page, rr.cx, rr.cy);
    await page.mouse.click(rp.x, rp.y);
    await page.keyboard.press("Delete");
    await settle(page);
    expect(await rampsOf(page)).toHaveLength(0);
  });

  test("it moves with its building, and a corner ramp '+' puts the ramp at the end of the belt by that corner", async ({ page }) => {
    await open(page);
    const bl = await drawAndSelectBuilding(page);
    const mid = await at(page, bl.cx, bl.cy);
    const btns = await rampButtons(page);
    const corner = btns.filter((b) => Math.abs(b.x - mid.x) > 100).sort((a, b) => b.y - a.y || a.x - b.x)[0];
    expect(corner, "a corner ramp button").toBeTruthy();
    await page.mouse.click(corner.x, corner.y);
    await settle(page);
    const r = (await rampsOf(page))[0];
    expect(r).toBeTruthy();
    const horiz = r.ramp.side === "top" || r.ramp.side === "bottom";
    // at the END of the belt: the ramp's centre is within a door module or two of a wall end
    const L = horiz ? bl.w : bl.h;
    expect(Math.min(r.ramp.at, L - r.ramp.at)).toBeLessThan(30);
    // a building move carries it (one undo step reverses both)
    const before = { cx: r.cx, cy: r.cy };
    // drag the building 40 ft east with the real pointer
    const bp = await at(page, bl.cx, bl.cy - 20);
    await page.mouse.move(bp.x, bp.y); await page.mouse.down();
    const bp2 = await at(page, bl.cx + 40, bl.cy - 20);
    await page.mouse.move(bp2.x, bp2.y, { steps: 8 }); await page.mouse.up();
    await settle(page);
    const moved = (await rampsOf(page))[0], nb = await buildingOf(page);
    expect(Math.abs((moved.cx - nb.cx) - (before.cx - bl.cx)) + Math.abs((moved.cy - nb.cy) - (before.cy - bl.cy))).toBeLessThan(0.01 + (nb.rot === bl.rot ? 0 : 1e6)); // same offset from its building
  });

  test("pictures: a straight-in ramp mid-wall and an along-the-wall ramp at a corner, at the close-in view", async ({ page }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await open(page);
    const bl = await drawAndSelectBuilding(page);
    const mid = await at(page, bl.cx, bl.cy);
    let btns = await rampButtons(page);
    const wallBtn = btns.filter((b) => Math.abs(b.x - mid.x) < 60).sort((a, b) => b.y - a.y)[0];
    await page.mouse.click(wallBtn.x, wallBtn.y);
    await settle(page);
    const r = (await rampsOf(page))[0];
    // frame the ramp at ≈8 px per ft (the 50-ft view): the whole ramp plus the wall around it
    await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 8), [r.cx, r.cy]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/straight-in-mid-wall.png` });
    // second picture: delete it, add a corner ramp and turn it along the wall
    await page.getByTestId("ramp-delete").click();
    await page.evaluate(() => window.__plannerView.centerOn(0, 0, 3));
    await page.waitForTimeout(300);
    const p = await at(page, bl.cx, bl.cy);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("feature-edit-nodes")).toBeVisible();
    btns = await rampButtons(page);
    const m2 = await at(page, bl.cx, bl.cy);
    const corner = btns.filter((b) => Math.abs(b.x - m2.x) > 100).sort((a, b) => b.y - a.y || a.x - b.x)[0];
    await page.mouse.click(corner.x, corner.y);
    await settle(page);
    await page.getByTestId("ramp-layout-along").click();
    await page.getByTestId("ramp-dir-start").click().catch(() => {});
    await settle(page);
    const r2 = (await rampsOf(page))[0];
    expect(r2.ramp.layout).toBe("along");
    // turning it along the wall slid the door in so the whole ramp lies ON the wall — no "runs past the end" flag
    await expect(page.getByTestId("ramp-flag-off-wall")).toHaveCount(0);
    const L = bl.w, half = (r2.ramp.layout === "along" ? 25 : 8);
    expect(r2.ramp.at - half).toBeGreaterThanOrEqual(-1);
    expect(r2.ramp.at + half).toBeLessThanOrEqual(L + 1);
    await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 8), [r2.cx, r2.cy]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/along-the-wall-at-corner.png` });
    expect(fs.statSync(`${SHOTS}/straight-in-mid-wall.png`).size).toBeGreaterThan(5000);
  });
});
