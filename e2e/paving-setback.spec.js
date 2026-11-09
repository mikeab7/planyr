/* NEW-1 (owner-approved 2026-11-09) — the PAVING setback, driven in the REAL planner (signed out, device storage).
 *
 * The seeded plan is one 800 × 500 ft lot with an explicit building setback (25 ft) and: a parking field crossing the west
 * line, a field safely inside, a SIDEWALK across the east line, a driveway coming in from OUTSIDE the lot, and a road stub that
 * dead-ends inside the line. Nothing is flagged until paving is added — that is the first arm.
 *
 *   1  before "Add paving setback": no paving row, no paving line, no flags, no stored key
 *   2  Add → a Paving row appears AT 0 (not 25), still no line / flags, key stored as zeros
 *   3  type 10 → the dotted line + exactly the parking field and the dead-end stub are flagged (sidewalk, driveway, inside field are not)
 *   4  Building | Paving switch relabels the sketch; the building setback is untouched
 *   5  Show line off hides the line (flags stay — the constraint exists whether or not it is drawn)
 *   6  reload keeps it; Remove deletes the key, the line and every flag, the building setback unchanged; Undo restores it
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/paving-setback.spec.js --project=chromium */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule } from "./helpers.js";

const SITE = "e2e-paving-setback";
const canvas = (p) => p.getByTestId("planner-canvas");
const T = (page, id) => page.getByTestId(id);
const PPF = 0.9;

const plan = () => ({
  id: SITE, groupId: SITE, site: "Paving", name: "A", origin: null, county: "harris",
  parcels: [{ id: "pc-1", active: true, points: [{ x: -400, y: -250 }, { x: 400, y: -250 }, { x: 400, y: 250 }, { x: -400, y: 250 }], setbacks: [25, 25, 25, 25] }],
  els: [
    { id: "pk-west", type: "parking", cx: -392, cy: 0, w: 40, h: 80, rot: 0, z: 10 },
    { id: "pk-inside", type: "parking", cx: 0, cy: 0, w: 120, h: 80, rot: 0, z: 11 },
    { id: "sw-east", type: "sidewalk", cx: 392, cy: 0, w: 40, h: 80, rot: 0, z: 12 },
    { id: "drive", type: "road", pts: [{ x: -460, y: -150 }, { x: -200, y: -150 }], vtx: [null, null], travelW: 24, curb: 0.5, z: 13 },
    { id: "stub", type: "road", pts: [{ x: 100, y: 150 }, { x: 395, y: 150 }], vtx: [null, null], travelW: 24, curb: 0.5, z: 14 },
  ],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
});

async function open(page) {
  await armPlannerHooks(page);
  await page.addInitScript(([id, rec]) => {
    if (!(globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1")) localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
    localStorage.setItem("planarfit:startHintDismissed", "1");
  }, [SITE, plan()]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible();
  await centre(page);
}
// The view is only readable once the planner has framed itself — keep asking until it answers a real scale (a bare centerOn can land before that).
async function centre(page) {
  await expect.poll(async () => { await page.evaluate((ppf) => window.__plannerView.centerOn(0, 0, ppf), PPF); return page.evaluate(() => window.__plannerView.get().ppf); }, { timeout: 15000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
}
const parcel = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return ((map[Object.keys(map)[0]] || {}).parcels || [])[0] || null;
});
async function openPage(page) {
  if (await T(page, "parcel-page").count()) return;
  const box = await canvas(page).boundingBox();
  const v = await page.evaluate(() => window.__plannerView.get());
  const p = { x: box.x + v.offX + -400 * v.ppf, y: box.y + v.offY + 120 * v.ppf }; // on the west boundary line, clear of the parking field
  await page.mouse.dblclick(p.x, p.y);
  await expect(T(page, "parcel-page")).toBeVisible();
}
const flagged = async (page) => (await page.locator("[data-paving-flag]").evaluateAll((n) => n.map((x) => x.getAttribute("data-paving-flag")))).sort();
const settle = (page) => page.waitForTimeout(700);

test.describe("paving setback", () => {
  test("off until added; starts at 0; dotted line + conflict marks; sidewalk and driveway exempt; remove clears it all", async ({ page }) => {
    await open(page);
    await openPage(page);

    // 1 — nothing paving-shaped exists yet
    await expect(T(page, "paving-add")).toBeVisible();
    await expect(T(page, "paving-all")).toHaveCount(0);
    await expect(T(page, "setback-all")).toContainText("Building");
    await expect(page.locator('[data-testid="paving-ring"]')).toHaveCount(0);
    await settle(page);
    expect(await flagged(page)).toEqual([]);
    expect((await parcel(page)).pavingSetbacks).toBeUndefined();
    await expect(T(page, "setback-ring")).toHaveCount(1);                                  // the building line is there, as before

    // 2 — add: a Paving row at 0, never the building 25; nothing drawn yet
    await T(page, "paving-add").click();
    await expect(T(page, "paving-all").locator("input")).toBeVisible();
    await expect(T(page, "paving-all").locator("input")).toHaveValue("0");
    await expect(T(page, "paving-add")).toHaveCount(0);
    await settle(page);
    expect((await parcel(page)).pavingSetbacks).toEqual([0, 0, 0, 0]);
    await expect(page.locator('[data-testid="paving-ring"]')).toHaveCount(0);
    expect(await flagged(page)).toEqual([]);

    // 3 — type 10: the dotted line appears, the right two things are flagged
    const all = T(page, "paving-all").locator("input");
    await all.fill("10"); await all.press("Enter");
    await expect(page.locator('[data-testid="paving-ring"]')).toHaveCount(1);
    await expect.poll(() => flagged(page), { timeout: 8000 }).toEqual(["pk-west", "stub"]);
    expect((await parcel(page)).pavingSetbacks).toEqual([10, 10, 10, 10]);
    expect((await parcel(page)).setbacks).toEqual([25, 25, 25, 25]);                       // building untouched
    const dash = await page.locator('[data-testid="paving-ring"]').getAttribute("stroke-dasharray");
    const bdash = await T(page, "setback-ring").getAttribute("stroke-dasharray");
    expect(dash).not.toEqual(bdash);                                                       // dotted vs dashed
    expect(await page.locator('[data-testid="paving-ring"]').getAttribute("stroke")).not.toEqual(await T(page, "setback-ring").getAttribute("stroke"));

    // 4 — the switch relabels the sketch
    await T(page, "setback-mode-paving").click();
    await expect(T(page, "setback-sketch").locator("text").first()).toHaveText("10′");
    await T(page, "setback-mode-building").click();
    await expect(T(page, "setback-sketch").locator("text").first()).toHaveText("25′");

    // 5 — Show line off hides the line only
    await T(page, "paving-show-line").uncheck();
    await expect(page.locator('[data-testid="paving-ring"]')).toHaveCount(0);
    expect(await flagged(page)).toEqual(["pk-west", "stub"]);
    await T(page, "paving-show-line").check();
    await expect(page.locator('[data-testid="paving-ring"]')).toHaveCount(1);

    // 6 — survives a reload; remove clears the key, the line and the flags; Undo brings it back
    await page.reload();
    await openModule(page, "site-planner");
    await expect(canvas(page)).toBeVisible();
    await centre(page);
    await expect(page.locator('[data-testid="paving-ring"]')).toHaveCount(1);
    await expect.poll(() => flagged(page), { timeout: 8000 }).toEqual(["pk-west", "stub"]);
    await openPage(page);
    await T(page, "paving-remove").click();
    await expect(T(page, "paving-all")).toHaveCount(0);
    await expect(page.locator('[data-testid="paving-ring"]')).toHaveCount(0);
    await expect.poll(() => flagged(page), { timeout: 8000 }).toEqual([]);
    await settle(page);
    const after = await parcel(page);
    expect("pavingSetbacks" in after).toBe(false);
    expect(after.setbacks).toEqual([25, 25, 25, 25]);
    await page.getByRole("button", { name: "Undo" }).first().click();
    await expect(T(page, "paving-all").locator("input")).toBeVisible();
    await expect(page.locator('[data-testid="paving-ring"]')).toHaveCount(1);
  });

  test("per-section value: both numbers are shown, each under its own heading", async ({ page }) => {
    await open(page);
    await openPage(page);
    await T(page, "paving-add").click();
    const all = T(page, "paving-all").locator("input");
    await all.fill("10"); await all.press("Enter");
    // select the first section from the sketch; its row has a labelled box per setback
    await T(page, "setback-sketch").locator('[data-testid^="setback-sketch-section-"]').first().click();
    const row = T(page, "setback-section-row").first();
    await expect(row.getByTestId("setback-box-building")).toBeVisible();
    await expect(row.getByTestId("setback-box-paving")).toBeVisible();
    await expect(T(page, "setback-col-heads")).toContainText("Building");
    await expect(T(page, "setback-col-heads")).toContainText("Paving");
    const pv = row.getByTestId("setback-box-paving").locator("input");
    await pv.fill("30"); await pv.press("Enter");
    await settle(page);
    const stored = (await parcel(page)).pavingSetbacks;
    expect(stored.some((v) => v === 30)).toBe(true);
    expect(stored.some((v) => v === 10)).toBe(true);
    expect((await parcel(page)).setbacks).toEqual([25, 25, 25, 25]);
  });
});
