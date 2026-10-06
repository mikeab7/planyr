/* Building panel rethink (NEW-1…NEW-9) — drives the REAL inspector, logged out, no GIS.
 * Header (number · lock · ⋯ · ✕ · summary), the conflict dialog wording, the Loading wall picker at a
 * non-zero rotation (picker labels vs the painted aprons), the dock-wall stack, end-wall Parking rows
 * typed in bulk, Structure folding, and the new outline width/opacity (drawn, persisted, exported).
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=<chrome> npx playwright test e2e/building-panel-rethink.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const buildings = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).filter((e) => e.type === "building" && !e.dogEar);
});
const kids = (page, id) => page.evaluate((hid) => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).filter((e) => e.attachedTo === hid);
}, id);

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
const wall = (page, side) => page.locator(`[data-testid="loading-wall-picker"] [data-wall="${side}"]`);
const rotate = async (page, deg) => {
  const f = page.getByText("Rotation", { exact: true }).locator("xpath=..").locator("input").first();
  await f.fill(String(deg)); await f.press("Enter");
};
/* which compass point each painted apron lies toward, read off the live canvas */
const paintedApronCompass = (page, id) => page.evaluate((elId) => {
  const g = document.querySelector(`[data-el-id="${elId}"]`);
  const b = g.querySelector("rect").getBoundingClientRect();
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const L = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return [...g.querySelectorAll("[data-dock-apron]")].map((n) => {
    const r = n.getBoundingClientRect();
    const dx = r.x + r.width / 2 - c.x, dy = r.y + r.height / 2 - c.y;
    const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    return L[Math.round(deg / 45) % 8];
  }).sort();
}, id);

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

test("header: inline number, lock, ⋯ menu, summary line, no Pin/Delete-element row", async ({ page }) => {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(1);
  const [b] = await buildings(page);
  await openProps(page, b.id);
  await expect(page.getByTestId("building-header").getByRole("textbox", { name: "Building number" })).toHaveValue("1");
  await expect(page.getByTestId("building-summary")).toContainText(/SF · Single-load .* · \d+′ clear/);
  await expect(page.getByRole("button", { name: /Pin|Delete element/ })).toHaveCount(0);
  await page.getByTestId("building-lock").click();
  await expect.poll(() => buildings(page).then((x) => !!x[0].locked)).toBe(true);
  await expect(page.getByTestId("building-summary")).toContainText("locked");
  await page.getByTestId("building-lock").click();
  await expect.poll(() => buildings(page).then((x) => !!x[0].locked)).toBe(false);
  await page.getByTestId("building-more").click();
  await page.getByTestId("building-delete").click();
  await expect.poll(() => buildings(page).then((x) => x.length)).toBe(0);
});

test("conflict dialog: two stacked options with outcomes, no 'Shift N and up by one'", async ({ page }) => {
  await startBlank(page);
  await drawBldg(page, 100, 100, 300, 200);
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(1);
  await drawBldg(page, 100, 330, 300, 430);
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(2);
  const [b1] = await buildings(page);
  await openProps(page, b1.id);
  const f = page.getByRole("textbox", { name: "Building number" });
  await f.fill("2"); await f.press("Enter");
  const d = page.getByTestId("bldg-num-conflict");
  await expect(d).toContainText("That number belongs to Building 2 — what should happen?");
  await expect(d).toContainText("Swap with Building 2");
  await expect(d).toContainText("This becomes 2 · Building 2 becomes 1");
  await expect(d).toContainText("Insert at 2, shift the rest up");
  await expect(d).toContainText("2→3, 3→4 … · this building becomes 2");
  await expect(page.getByText(/Shift \d+ and up by one/)).toHaveCount(0);
  await page.getByTestId("bldg-num-cancel").click();
  await expect(d).toHaveCount(0);
});

test("wall picker at a non-zero rotation: labels, clicks and the painted aprons agree", async ({ page }) => {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(1);
  const [b] = await buildings(page);
  await openProps(page, b.id);
  await rotate(page, 45);
  await expect.poll(() => buildings(page).then((x) => Math.round(x[0].rot))).toBe(45);
  // labels follow the rotation
  await expect(wall(page, "top")).toHaveAttribute("data-compass", "NE");
  await expect(wall(page, "bottom")).toHaveAttribute("data-compass", "SW");
  // single on the bottom wall → SW; the canvas paints the apron toward SW
  await expect(page.getByTestId("loading-walls-label")).toHaveText("SW wall");
  await expect.poll(() => paintedApronCompass(page, b.id)).toEqual(["SW"]);
  // click the opposite wall → cross-dock NE & SW
  await wall(page, "top").click();
  await expect.poll(() => buildings(page).then((x) => x[0].dock)).toBe("cross");
  await expect(page.getByTestId("loading-type")).toHaveText("Cross-dock");
  // add a truck court so the canvas has something to paint on both walls, then move the loading
  await page.getByTestId("add-dock-zone").click();
  await expect.poll(() => paintedApronCompass(page, b.id)).toEqual(["NE", "SW"]);
  // click a wall on the OTHER axis → the whole pair moves, still cross (never an L)
  await wall(page, "left").click();
  await expect.poll(() => buildings(page).then((x) => x[0].dockAxis)).toBe("y");
  await expect(page.getByTestId("loading-walls-label")).toHaveText("NW & SE walls");
  // unload one wall → single on the other; unload that → none
  await wall(page, "left").click();
  await expect.poll(() => buildings(page).then((x) => x[0].dock)).toBe("single");
  await wall(page, "right").click();
  await expect.poll(() => buildings(page).then((x) => x[0].dock)).toBe("none");
  await expect(page.getByTestId("loading-type")).toHaveText("No docks");
  // one undo frame per click
  await page.keyboard.press("Control+z");
  await expect.poll(() => buildings(page).then((x) => x[0].dock)).toBe("single");
});

test("dock stack: add zones, edit a depth, ✕ removes that zone and everything beyond", async ({ page }) => {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(1);
  const [b] = await buildings(page);
  await openProps(page, b.id);
  for (let i = 0; i < 3; i++) await page.getByTestId("add-dock-zone").click({ trial: false }).catch(() => {});
  await expect(page.getByTestId("dock-zone-row-2")).toBeVisible();
  const depth = page.getByTestId("dock-zone-row-1").locator("input").first();
  await depth.fill("70"); await depth.press("Enter");
  await expect.poll(async () => (await kids(page, b.id)).find((k) => k.type === "trailer")?.zd).toBe(70);
  await page.getByTestId("dock-zone-row-1-remove").click();
  await expect(page.getByTestId("dock-zone-row-1")).toHaveCount(0);
  await expect(page.getByTestId("dock-zone-row-0")).toBeVisible();
  expect((await kids(page, b.id)).filter((k) => k.truckCourt || k.forCourt || k.forTrailer).length).toBe(1);
});

test("end walls: typing 8 parking rows lays out 8 rows in one commit; ✕ clears; Structure folds", async ({ page }) => {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(1);
  const [b] = await buildings(page);
  await openProps(page, b.id);
  const rows = page.getByTestId("end-parking-row").locator("input").first();
  await rows.fill("8"); await rows.press("Enter");
  await expect(rows).toHaveValue("8");
  const park = async () => (await kids(page, b.id)).filter((k) => k.type === "parking" && k.sideParkSide);
  await expect.poll(async () => (await park()).length).toBeGreaterThan(0);
  const p0 = (await park())[0];
  // 8 rows: 8 stall rows + ceil(8/2) aisles
  const cfg = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const s = m[Object.keys(m)[0]] || {}; return s.settings || {}; });
  const sd = cfg.stallDepth ?? 18, ai = cfg.aisle ?? 24;
  expect(Math.round(p0.h)).toBe(8 * sd + 4 * ai);
  // one commit: a single undo takes all of it back (blur the field first — Enter keeps focus, and a focused field owns Ctrl+Z)
  await rows.evaluate((el) => el.blur());
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await park()).length).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await park()).length).toBeGreaterThan(0);
  await page.getByTestId("end-parking-row-remove").click();
  await expect.poll(async () => (await park()).length).toBe(0);
  // Structure is closed by default and summarises; opening shows the rows and the Standards pointer
  const structure = page.getByRole("button", { name: /Structure/ });
  await expect(structure).toHaveAttribute("aria-expanded", "false");
  await expect(structure).toContainText(/′ clear · \d+″ slab · auto/);
  await structure.click();
  await expect(page.getByText("Column grid lives in")).toBeVisible();
  await expect(page.getByText("Speed bay (ft)")).toHaveCount(0);
});

test("outline width / opacity: drawn, survives reload, carried by the export", async ({ page }) => {
  await startBlank(page);
  await drawBldg(page, 100, 120, 300, 220);
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(1);
  await drawBldg(page, 400, 120, 600, 220);
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(2);
  const [b1, b2] = await buildings(page);
  await openProps(page, b1.id);
  const w = page.getByLabel("Outline width"); await w.fill("4"); await w.press("Enter");
  const o = page.getByLabel("Outline opacity"); await o.fill("50"); await o.press("Enter");
  await expect.poll(() => buildings(page).then((x) => x.find((e) => e.id === b1.id).strokeWidth)).toBe(4);
  await expect.poll(() => buildings(page).then((x) => x.find((e) => e.id === b1.id).strokeOpacity)).toBe(0.5);
  // deselect (click empty canvas), then read the painted outline
  const box = await canvas(page).boundingBox();
  await page.keyboard.press("Escape");
  await page.mouse.click(box.x + 20, box.y + box.height - 20);
  const outline = (id) => page.evaluate((elId) => { const r = document.querySelector(`[data-el-id="${elId}"] rect`); return { w: r.getAttribute("stroke-width"), o: r.getAttribute("stroke-opacity") }; }, id);
  await expect.poll(() => outline(b1.id)).toEqual({ w: "4", o: "0.5" });
  expect((await outline(b2.id)).o).toBe("1");
  // export: the clone carries the opacity, and the 4px outline prints heavier than the default
  const svg = await page.evaluate(() => window.__plannerExportSvg());
  expect(svg).toContain('stroke-opacity="0.5"');
  const widths = (id) => { const m = new RegExp(`data-el-id="${id}"[\\s\\S]*?<rect[^>]*stroke-width="([\\d.]+)"`).exec(svg); return m ? Number(m[1]) : null; };
  expect(widths(b1.id)).toBeGreaterThan(widths(b2.id));
  // reload keeps it
  await page.reload();
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  const again = await buildings(page);
  expect(again.find((e) => e.id === b1.id).strokeWidth).toBe(4);
  await expect.poll(() => outline(b1.id)).toEqual({ w: "4", o: "0.5" });
});
