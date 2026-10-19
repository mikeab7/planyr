/* Dock-layer Properties panel (NEW-1, owner-approved mockup 2026-10-19) — drives the REAL inspector, logged out, no GIS.
 * One panel for the truck court / trailer parking / buffer: Size · Grade · Style · Actions, the Auto pills, the amber
 * band notice, the editable Length with "Full wall", and the ONE remove path (inline confirm → Removed note → Undo).
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=<chrome> npx playwright test e2e/dock-layer-panel.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return map[Object.keys(map)[0]] || {};
});
const zones = async (page) => {
  const els = (await plan(page)).els || [];
  const b = els.find((e) => e.type === "building" && !e.dogEar);
  const mine = els.filter((e) => e.attachedTo === b?.id && !e.dogEar);
  return { b, court: mine.filter((e) => e.truckCourt), trailer: mine.filter((e) => e.forCourt), buffer: mine.filter((e) => e.buffer), all: mine };
};
async function drawBldg(page) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + 200, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 400, { steps: 12 });
  await page.mouse.up();
}
async function dbl(page, id) {
  // the stack can run past the visible canvas: double-click the middle of the part that IS on screen
  const box = await canvas(page).boundingBox();
  const pt = await page.evaluate(({ elId, box }) => {
    const r = document.querySelector(`[data-el-id="${elId}"]`).querySelector("rect, path").getBoundingClientRect();
    const x0 = Math.max(r.left, box.x + 8), x1 = Math.min(r.right, box.x + box.width - 8), y0 = Math.max(r.top, box.y + 8), y1 = Math.min(r.bottom, box.y + box.height - 8);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }, { elId: id, box });
  await page.mouse.dblclick(pt.x, pt.y);
}
const T = (page, id) => page.getByTestId(id);
const stepper = (page, id, which) => T(page, id).locator("xpath=ancestor::*[@data-numbox][1]").getByRole("button", { name: which });
async function build(page) {
  await startBlank(page);
  await drawBldg(page);
  await expect.poll(async () => (await zones(page)).b?.id).toBeTruthy();
  const { b } = await zones(page);
  await dbl(page, b.id);
  await expect(T(page, "building-header")).toBeVisible();
  await T(page, "loading-wall-picker").locator('[data-wall="top"]').click();       // cross-dock: two independent stacks
  await expect.poll(async () => (await zones(page)).b.dock).toBe("cross");
  // each dock wall is its own row in "Docks & walls": give BOTH a court → trailer parking → buffer
  for (const row of [0, 1]) for (const key of ["court", "trailer", "buffer"]) {
    await page.locator('[data-testid="wall-row"][data-role="dock"]').nth(row).getByTestId("wall-add").click();
    await page.getByTestId(`wall-add-${key}`).click();
    await page.waitForTimeout(200);
  }
  await expect.poll(async () => { const z = await zones(page); return [z.court.length, z.trailer.length, z.buffer.length].join(","); }).toBe("2,2,2");
  return b.id;
}

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

test("layout: sub-line, Size · Grade · Style, one Remove, none of the old copy", async ({ page }) => {
  await build(page);
  const z = await zones(page);
  await dbl(page, z.court[0].id);
  await expect(T(page, "dock-layer-panel")).toBeVisible();
  await expect(T(page, "dock-host-link")).toContainText("Building 1 ›");
  await expect(T(page, "dock-subline")).toContainText("Dock layer 1 of 3");
  for (const id of ["dock-depth", "dock-length", "dock-area", "dock-elevation", "dock-slope", "dock-weight", "dock-outline-opacity", "dock-fill-opacity", "dock-pin", "dock-remove"]) await expect(T(page, id)).toBeVisible();
  const text = await T(page, "property-panel").innerText();
  for (const gone of ["Dock zone 1 of", "Or select the building to grow", "Dock zone: auto prices", "Feeds the auto-graded surface", "Pad elev.", "Footprint:", "Delete element", "(+ outer)", "never silently"]) expect(text, gone).not.toContain(gone);
  await expect(page.getByRole("button", { name: /Remove truck court/ })).toHaveCount(1);
  expect(await T(page, "dock-area").innerText()).toMatch(/^[\d,]+ SF$/);
  // no px, no hex anywhere in the panel text
  expect(text).not.toMatch(/\bpx\b/); expect(text).not.toMatch(/#[0-9a-f]{6}/i);
  // steppers are spin controls inside the box, not loose triangles
  await expect(stepper(page, "dock-depth", "Increase")).toBeVisible();
});

test("length: stepper shortens, trailer follows, 'Full wall' restores; the other side is untouched", async ({ page }) => {
  await build(page);
  const z0 = await zones(page);
  const [c1, c2] = z0.court;
  const other0 = { w: c2.w, h: c2.h, zd: c2.zd };
  await dbl(page, c1.id);
  await expect(T(page, "dock-full-wall")).toBeVisible();                         // muted text while full
  await expect(T(page, "dock-full-wall-link")).toHaveCount(0);
  const full = Number(await T(page, "dock-length").inputValue());
  await stepper(page, "dock-length", "Decrease").click();
  await expect(T(page, "dock-length")).toHaveValue(String(full - 10));
  await expect(T(page, "dock-full-wall-link")).toBeVisible();
  const c1Id = c1.id;
  await expect.poll(async () => { const z = await zones(page); const c = z.court.find((e) => e.id === c1Id); const t = z.trailer.find((e) => e.forCourt === c1Id); return t && c ? Math.round(Math.max(t.w, t.h)) === Math.round(Math.max(c.w, c.h)) && Math.round(Math.max(c.w, c.h)) === full - 10 : false; }).toBe(true);
  await T(page, "dock-full-wall-link").click();
  await expect(T(page, "dock-length")).toHaveValue(String(full));
  await expect(T(page, "dock-full-wall")).toBeVisible();
  // depth edit on this side leaves the other side alone
  await T(page, "dock-depth").fill("90"); await T(page, "dock-depth").press("Enter");
  await expect.poll(async () => (await zones(page)).court.find((e) => e.id === c1Id).zd).toBe(90);
  const o = (await zones(page)).court.find((e) => e.id === c2.id);
  expect({ w: o.w, h: o.h, zd: o.zd }).toEqual(other0);
});

test("grade: Auto shows a real number muted; typing/stepping turns Auto off; 3.5% shows the band notice; Auto clears it", async ({ page }) => {
  await build(page);
  const z = await zones(page);
  await dbl(page, z.court[0].id);
  const id = z.court[0].id;
  const pill = (n) => T(page, `dock-auto-${n}`);
  await expect(pill("slope")).toHaveAttribute("aria-pressed", "true");
  await expect(T(page, "dock-slope")).toHaveValue("1");
  await expect(T(page, "dock-slope")).toHaveAttribute("data-muted", "1");
  await expect(T(page, "dock-band-notice")).toHaveCount(0);
  await T(page, "dock-slope").fill("3.5"); await T(page, "dock-slope").press("Enter");
  await expect(pill("slope")).toHaveAttribute("aria-pressed", "false");
  await expect(T(page, "dock-slope")).not.toHaveAttribute("data-muted", "1");
  await expect(T(page, "dock-band-notice")).toHaveText(/Outside the 1\.0–2\.0% truck court band\. Kept as typed\./);
  await expect.poll(async () => (await zones(page)).court.find((e) => e.id === id).grading?.slopePct).toBe(3.5);   // kept as typed
  await pill("slope").click();
  await expect(pill("slope")).toHaveAttribute("aria-pressed", "true");
  await expect(T(page, "dock-band-notice")).toHaveCount(0);
  await expect(T(page, "dock-slope")).toHaveValue("1");
  // elevation: stepping flips Auto off and keeps the stepped number; Auto returns
  await stepper(page, "dock-elevation", "Increase").click();
  await expect(pill("elevation")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await zones(page)).court.find((e) => e.id === id).padElevFt).toBeCloseTo(0.5, 5);
  await pill("elevation").click();
  await expect(pill("elevation")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await zones(page)).court.find((e) => e.id === id).padElevFt ?? null).toBeNull();
});

test("remove: confirm lists the three layers; Cancel keeps all; confirm removes all, selects the building, Undo restores them with the same depths", async ({ page }) => {
  await build(page);
  const before = await zones(page);
  const c1 = before.court[0];
  const depthsBefore = (z) => z.all.map((e) => `${e.id}:${e.zd}`).sort().join("|");
  const snap = depthsBefore(before);
  await dbl(page, c1.id);
  await T(page, "dock-remove").click();
  await expect(T(page, "dock-remove-confirm")).toBeVisible();
  await expect(T(page, "dock-confirm-now")).toContainText("truck court → trailer parking → buffer");
  await expect(T(page, "dock-confirm-after")).toContainText("no dock layers");
  await expect(T(page, "dock-confirm-remove")).toHaveText("Remove all three");
  await T(page, "dock-confirm-cancel").click();
  await expect(T(page, "dock-remove-confirm")).toHaveCount(0);
  expect(depthsBefore(await zones(page))).toBe(snap);
  await T(page, "dock-remove").click();
  await T(page, "dock-confirm-remove").click();
  await expect(T(page, "building-header")).toBeVisible();                               // selection moved to the host
  await expect(T(page, "dock-removed-note")).toContainText(/Removed\. .* wall has no dock layers\./);
  await expect.poll(async () => { const z = await zones(page); return z.all.filter((e) => e.truckCourt || e.forCourt || e.forTrailer || e.buffer).length; }).toBe(3); // the OTHER side's three remain
  await T(page, "dock-removed-undo").click();
  await expect(T(page, "dock-removed-note")).toHaveCount(0);
  await expect.poll(async () => depthsBefore(await zones(page))).toBe(snap);
});

test("buffer alone: 'Remove buffer', plain 'Remove', one-layer card", async ({ page }) => {
  await build(page);
  const z = await zones(page);
  await dbl(page, z.buffer[0].id);
  await expect(T(page, "dock-subline")).toContainText("Dock layer 3 of 3");
  await expect(T(page, "dock-layer-panel").getByText("Grade", { exact: true })).toHaveCount(0);   // a buffer has no Grade section
  await expect(T(page, "dock-remove")).toHaveText("Remove buffer");
  await T(page, "dock-remove").click();
  await expect(T(page, "dock-confirm-remove")).toHaveText("Remove");
  await expect(T(page, "dock-remove-confirm")).not.toContainText("go with it");
  await expect(T(page, "dock-confirm-after")).toContainText("truck court → trailer parking");
  await T(page, "dock-confirm-remove").click();
  await expect.poll(async () => (await zones(page)).buffer.length).toBe(1);
});
