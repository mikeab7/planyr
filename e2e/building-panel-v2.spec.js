/* Building panel v2 (NEW-1…NEW-6) — drives the REAL inspector, logged out, no GIS.
 * One compact row per wall (rear and each end SEPARATE), per-side edits, a linked/split dock pair, bump-outs
 * drawn on the picker and edited from a chip, multi-row trailer parking, the folded-in bottom block, and
 * "Line weight" with no unit. Measured on the canvas, not just the panel.
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=<chrome> npx playwright test e2e/building-panel-v2.spec.js --project=chromium --no-deps */
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
const rotate = async (page, deg) => {
  const f = page.getByLabel("Rotation in degrees");
  await f.fill(String(deg)); await f.press("Enter");
};
const row = (page, key) => page.locator(`[data-testid="wall-row"][data-row="${key}"]`);
const rowByRole = (page, role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const wall = (page, side) => page.locator(`[data-testid="loading-wall-picker"] [data-wall="${side}"]`);
async function boot(page, bump = {}) {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(async () => !!(await hostOf(page))).toBe(true);
  const b = await hostOf(page);
  await openProps(page, b.id);
  return b;
}
const addLayer = async (r, key) => { await r.getByTestId("wall-add").click(); await r.page().getByTestId(`wall-add-${key}`).click(); };

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

test("single-load at 315°: rows dock · rear · ends · ends — rear and each end are SEPARATE; parking on the rear only", async ({ page }) => {
  const b = await boot(page);
  await rotate(page, 315);
  await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(315);
  const rows = page.getByTestId("wall-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveAttribute("data-role", "dock");
  await expect(rows.nth(1)).toHaveAttribute("data-role", "rear");
  await expect(rows.nth(2)).toHaveAttribute("data-role", "ends");
  await expect(rows.nth(3)).toHaveAttribute("data-role", "ends");
  // badge letters come from the same compass derivation as the picker; the role word sits BESIDE the badge
  const badges = await page.getByTestId("wall-row-badge").allInnerTexts();
  const picker = await page.locator('[data-testid="loading-wall-picker"] [data-wall]').evaluateAll((n) => n.map((g) => g.getAttribute("data-compass")));
  for (const t of badges) expect(picker).toContain(t);
  // rear: add car parking, then type 8 rows
  const rear = rowByRole(page, "rear");
  await addLayer(rear, "parking");
  await expect(page.getByTestId("wall-layer-editor")).toBeVisible();     // adding opens the new layer's editor
  const rows8 = page.getByLabel("Parking rows");
  await rows8.fill("8"); await rows8.press("Enter");
  const park = async () => (await kidsOf(page, b.id)).filter((k) => k.type === "parking" && k.sideParkSide);
  await expect.poll(async () => (await park()).length).toBe(1);
  const rearSide = await rear.getAttribute("data-sides");
  expect((await park())[0].sideParkSide).toBe(rearSide);
  // the typed 8 really laid out 8 rows (8 stall rows + 4 aisles), not the one the "+" added
  const std = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const s = m[Object.keys(m)[0]] || {}; return s.settings || {}; });
  await expect.poll(async () => Math.round((await park())[0].h)).toBe(8 * (std.stallDepth ?? 18) + 4 * (std.aisle ?? 24));
  // the two end walls carry nothing
  for (const r of [rows.nth(2), rows.nth(3)]) await expect(r.getByTestId("wall-chip")).toHaveCount(0);
  // one commit: a single undo takes all the typed rows back at once (to the single row the + added), the next removes it
  await rows8.evaluate((el) => el.blur());
  await page.keyboard.press("Control+z");
  await expect.poll(async () => Math.round((await park())[0].h)).toBe((std.stallDepth ?? 18) + (std.aisle ?? 24));
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await park()).length).toBe(0);
});

test("cross-dock: one 'same' row; split it, give one side a buffer, only that side changes; chain links it back", async ({ page }) => {
  const b = await boot(page);
  await wall(page, "top").click();                                  // load the opposite wall too
  await expect.poll(async () => (await hostOf(page)).dock).toBe("cross");
  await expect(rowByRole(page, "dock")).toHaveCount(1);
  await expect(rowByRole(page, "rear")).toHaveCount(0);
  const toggle = page.getByTestId("dock-link-toggle");
  await expect(toggle).toContainText("same");
  // linked: a court goes on BOTH walls
  await addLayer(rowByRole(page, "dock").first(), "court");
  await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.truckCourt).length).toBe(2);
  await toggle.click();
  await expect(toggle).toContainText("split");
  await expect(rowByRole(page, "dock")).toHaveCount(2);
  const [first, second] = [rowByRole(page, "dock").nth(0), rowByRole(page, "dock").nth(1)];
  await addLayer(first, "buffer");
  await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.buffer).length).toBe(1);
  await expect(first.getByTestId("wall-chip")).toHaveCount(2);
  await expect(second.getByTestId("wall-chip")).toHaveCount(1);
  // chain again: the second wall now matches the first (buffer included), one frame
  await toggle.click();
  await expect(toggle).toContainText("same");
  await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.buffer).length).toBe(2);
  await expect(rowByRole(page, "dock")).toHaveCount(1);
});

test("bump-outs: a dashed picker corner adds one at that corner; the dock line stops at it; SF and doors change; size 70 × 60", async ({ page }) => {
  const b = await boot(page);
  await addLayer(rowByRole(page, "dock").first(), "court");
  const doors0 = Number((await page.getByTestId("building-summary").innerText()).match(/(\d+) doors?/)[1]);
  const sf0 = Number((await page.getByTestId("building-summary").innerText()).match(/([\d,]+) SF/)[1].replace(/,/g, ""));
  const corners = page.getByTestId("picker-corner-add");
  await expect(corners).toHaveCount(2);                              // one dashed square per empty end of the loaded wall
  await corners.first().click({ force: true });
  await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.dogEar).length).toBe(1);
  await expect(page.getByTestId("picker-bump")).toHaveCount(1);
  await expect(corners).toHaveCount(1);
  const de = (await kidsOf(page, b.id)).find((k) => k.dogEar);
  expect(de.dogEar.side).toBe((await hostOf(page)).dockSide || "bottom");
  // the orange dock line is clipped to the clear face: shorter than the whole wall, ending exactly at the bump-out
  const lens = await page.getByTestId("picker-wall-line").evaluateAll((n) => n.map((l) => Math.hypot(l.x2.baseVal.value - l.x1.baseVal.value, l.y2.baseVal.value - l.y1.baseVal.value)));
  expect(lens.sort((a, c) => a - c)[0]).toBeLessThan(lens.sort((a, c) => a - c)[3]);
  await expect(page.getByTestId("picker-wall-line").first()).toHaveAttribute("stroke-linecap", "butt");
  // header SF grows by the bump-out's area; the door count drops by the doors it displaces
  const txt = await page.getByTestId("building-summary").innerText();
  expect(Number(txt.match(/([\d,]+) SF/)[1].replace(/,/g, ""))).toBeGreaterThan(sf0);
  expect(Number(txt.match(/(\d+) doors?/)[1])).toBeLessThan(doors0);
  // chip → editor: size 70 × 60 lands on the canvas model
  await page.getByTestId("bump-chip").click();
  await expect(page.getByTestId("bump-chip")).toContainText("Bump-outs 1");
  const along = page.getByLabel("Bump-out size along the dock wall"), out = page.getByLabel("Bump-out size out from the dock face");
  await along.fill("70"); await along.press("Enter");
  await out.fill("60"); await out.press("Enter");
  await expect.poll(async () => { const d = (await kidsOf(page, b.id)).find((k) => k.dogEar); return d && [Math.round(d.dogEar.along), Math.round(d.dogEar.proj)].join("x"); }).toBe("70x60");
  // both end toggles are labelled with a compass letter ONLY
  for (const t of await page.locator('[data-testid^="bump-end-"]').allInnerTexts()) expect(t).toMatch(/^[NSEW]{1,2}$/);
  // a second corner via the toggle, then Remove all
  await page.locator('[data-testid^="bump-end-"][aria-pressed="false"]').click();
  await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.dogEar).length).toBe(2);
  await page.getByTestId("bump-remove-all").click();
  await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.dogEar).length).toBe(0);
});

test("trailer parking: rows 2 → two stall bands with an aisle, total = 2 × row + aisle; one undo", async ({ page }) => {
  const b = await boot(page);
  const dock = rowByRole(page, "dock").first();
  await addLayer(dock, "court");
  await addLayer(dock, "trailer");
  await expect(page.getByTestId("wall-layer-editor")).toHaveAttribute("data-kind", "trailer");
  await expect(page.getByTestId("wall-trailer-total")).toHaveText("");
  await page.getByTestId("wall-trailer-rows-plus").click();
  const tz = async () => (await kidsOf(page, b.id)).find((k) => k.type === "trailer");
  await expect.poll(async () => (await tz()).trailerRows).toBe(2);
  const t = await tz();
  expect(t.zd).toBe(2 * 50 + 60);
  expect(t.cfg.single).toBe(false);
  expect(t.cfg.trailerAisle).toBe(60);
  expect(t.cfg.trailerL).toBe(50);
  expect(Math.round(t.h)).toBe(160);
  await expect(page.getByTestId("wall-trailer-total")).toHaveText("= 160′ deep");
  await expect(dock.getByTestId("wall-chip").filter({ hasText: "Trailer ×2" })).toHaveCount(1);
  await expect(page.getByLabel("Aisle between trailer rows")).toHaveValue("60");
  // the canvas label reads the stall count of BOTH rows
  await expect(canvas(page)).toContainText(/\d+ trailers/);
  const stalls = Number((await canvas(page).textContent()).match(/(\d+) trailers/)[1]);
  expect(stalls % 2).toBe(0);                                          // two full bands of the same column count
  const aisle = page.getByLabel("Aisle between trailer rows");
  await aisle.fill("50"); await aisle.press("Enter");
  await expect.poll(async () => (await tz()).zd).toBe(150);
  await page.keyboard.press("Escape");
});

test("the bottom readout block is gone for a building; Pad elev. lives in Structure; Line weight carries no unit", async ({ page }) => {
  await boot(page);
  const panel = page.getByTestId("property-panel");
  await expect(panel).not.toContainText("Footprint:");
  await expect(panel).not.toContainText("Dock doors:");
  await expect(panel).not.toContainText("Column grid:");
  await expect(panel).not.toContainText("Pad elev. (ft NAVD88)");
  await expect(panel).not.toContainText("Single-load 1");
  await expect(page.getByTestId("building-summary")).not.toContainText("clear");
  await expect(page.getByTestId("loading-type")).toHaveText("Single-load");
  await expect(page.getByTestId("loading-doors")).toContainText(/\d+ dock doors?/);
  const structure = page.getByRole("button", { name: /Structure/ });
  await expect(structure).toContainText(/pad auto/);
  await structure.click();
  await expect(page.getByLabel("Pad elevation (ft NAVD88)")).toBeVisible();
  await expect(page.getByTestId("pad-elev-note")).toHaveCount(0);
  await page.getByTestId("pad-elev-info").click();
  await expect(page.getByTestId("pad-elev-note")).toBeVisible();
  await expect(page.getByTestId("grid-line")).toContainText(/Grid .*typ · .* bays · Standards ↗/);
  // Line weight: a label, a stepper, a live sample — and nowhere a "px"
  await expect(panel.getByText("Line weight")).toBeVisible();
  await expect(page.getByTestId("line-weight-sample")).toBeVisible();
  expect(await panel.innerText()).not.toMatch(/\bpx\b/);
  await expect(panel.getByRole("button", { name: "Standards ↗" })).toHaveCount(1);   // ONE link, in Structure
  const w = page.getByLabel("Line weight"); await w.fill("4"); await w.press("Enter");
  await expect.poll(async () => (await hostOf(page)).strokeWidth).toBe(4);
  await expect.poll(() => page.getByTestId("line-weight-sample").locator("line").getAttribute("stroke-width")).toBe("4");
});

test("rotation field is wide enough for three digits plus a decimal", async ({ page }) => {
  await boot(page);
  const f = page.getByLabel("Rotation in degrees");
  await f.fill("359.25"); await f.press("Enter");
  const fits = await f.evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});
