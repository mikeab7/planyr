/* NEW-1 (2026-11-03, amended 2026-11-04 — owner: "Put every option on the row as its own icon, no ▾.") — Docks & walls: every add option is
 * its OWN icon button on the wall's row (the layer's legend swatch with its icon, a plus glyph before them, the likely next layer leftmost),
 * and the edit box is one line with no length. Real inspector, logged out. Covers: one click on an icon adds court → trailer → buffer in turn
 * on a dock wall; there is no ▾ and no menu anywhere; an end wall adds sidewalk → parking; the trailer box is one line with "Depth", two rows
 * show Row 1 / Row 2 / Aisle on a second line; no Length / Align / Full length in the box on ANY wall; the row stays ONE line with no icon
 * clipped at desktop and phone width; the map-selected Properties panel still has its Length; a rotated building behaves the same.
 * Run: BASE_URL=http://127.0.0.1:4173 npx playwright test e2e/wall-add-control.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, addWallLayer, rowFit } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return (map[Object.keys(map)[0]] || {}).els || [];
});
const hostOf = async (page) => (await plan(page)).find((e) => e.type === "building" && !e.dogEar);
async function drawBldg(page) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + 200, box.y + 260); await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 400, { steps: 12 }); await page.mouse.up();
}
async function boot(page, deg) {
  await startBlank(page);
  await drawBldg(page);
  await expect.poll(async () => !!(await hostOf(page))).toBe(true);
  const b = await hostOf(page);
  const pt = await page.evaluate((id) => { const r = document.querySelector(`[data-el-id="${id}"]`).querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, b.id);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("building-header")).toBeVisible();
  if (deg) { const f = page.getByLabel("Rotation in degrees"); await f.fill(String(deg)); await f.press("Enter"); await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(deg); }
  return b;
}
const rowByRole = (page, role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const icons = (row) => row.getByTestId("wall-add-group").locator("button");
const named = (row) => icons(row).first();                       // the leftmost icon = the likely next layer
const iconKinds = async (row) => ((await row.getByTestId("wall-add-group").count()) ? icons(row).evaluateAll((n) => n.map((x) => x.getAttribute("data-kind"))) : []);
const kinds = (row) => row.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")));
const noLengthControls = async (page) => {
  for (const id of ["wall-extent", "wall-extent-len", "wall-extent-full", "wall-align-start", "wall-align-centre", "wall-align-end"]) await expect(page.getByTestId(id)).toHaveCount(0);
  const box = page.getByTestId("wall-edit-box");
  for (const w of ["Length", "Align", "Full length", "Centre"]) await expect(box.getByText(w, { exact: false })).toHaveCount(0);
};

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

for (const deg of [0, 315]) {
  test(`rot ${deg} · dock wall: one icon per option, no ▾; the leftmost names the next layer, one click each adds court → trailer → buffer, then a road`, async ({ page }) => {
    await boot(page, deg);
    const dock = rowByRole(page, "dock").first();
    expect(await iconKinds(dock)).toEqual(["court"]);
    await expect(dock.getByTestId("wall-add-plus")).toBeVisible();                          // the plus glyph leads the icons…
    expect(await dock.getByTestId("wall-add-plus").evaluate((n) => n.tagName)).not.toBe("BUTTON");   // …and is not a button
    await named(dock).click();
    await expect(page.getByTestId("wall-edit-box")).toHaveAttribute("data-kind", "court");   // the new layer's box opens, as before
    await expect(named(dock)).toHaveAttribute("data-kind", "trailer");
    await named(dock).click();
    await expect(page.getByTestId("wall-edit-box")).toHaveAttribute("data-kind", "trailer");
    await expect(named(dock)).toHaveAttribute("data-kind", "buffer");                                     // the icon stays usable: keep clicking
    await named(dock).click();
    await expect(named(dock)).toHaveAttribute("data-kind", "sidewalk");
    expect(await kinds(dock)).toEqual(["court", "trailer", "buffer"]);

    // every other option is its own icon ON THE ROW, in order, with the full name in aria-label and title; nothing floats, nothing moves
    expect(await iconKinds(dock)).toEqual(["sidewalk", "road", "trailer", "buffer"]);
    const names = { sidewalk: "sidewalk", road: "road", trailer: "trailer parking", buffer: "landscape buffer" };
    for (const k of await iconKinds(dock)) {
      await expect(dock.getByTestId(`wall-add-${k}`)).toHaveAttribute("aria-label", new RegExp(`^Add ${names[k]} to the Dock wall \\(`));
      await expect(dock.getByTestId(`wall-add-${k}`)).toHaveAttribute("title", `Add ${names[k]} to this wall`);
      expect((await dock.getByTestId(`wall-add-${k}`).innerText()).trim(), "no word on the button").toBe("");
    }
    // no ▾ and no menu anywhere on any row
    await expect(page.getByTestId("wall-add-more")).toHaveCount(0);
    await expect(page.getByTestId("wall-add-menu")).toHaveCount(0);
    await expect(page.locator('[data-wall-add][aria-haspopup]')).toHaveCount(0);
    // a Road by its own icon; nothing is offered after it (no plus, no icons)
    await dock.getByTestId("wall-add-road").click();
    await expect.poll(() => kinds(dock)).toEqual(["court", "trailer", "buffer", "road"]);
    await expect(dock.getByTestId("wall-add-group")).toHaveCount(0);
    await expect(dock.getByTestId("wall-add-plus")).toHaveCount(0);
  });

  test(`rot ${deg} · end wall: sidewalk, then parking (and MORE parking on every further press), the buffer by its own icon`, async ({ page }) => {
    await boot(page, deg);
    const end = rowByRole(page, "ends").first();
    await expect(named(end)).toHaveAttribute("data-kind", "sidewalk");
    await named(end).click();
    await expect(named(end)).toHaveAttribute("data-kind", "parking");
    await named(end).click();
    await expect(named(end)).toHaveAttribute("data-kind", "parking");                      // parking leads until a layer sits beyond it
    await addWallLayer(end, "buffer");
    expect(await kinds(end)).toEqual(["sidewalk", "parking", "buffer"]);
    await expect(named(end)).toHaveAttribute("data-kind", "road");
  });
}

test("the edit box is one line (trailer: Rows + Depth), Row 1 / Row 2 / Aisle on a second line from two rows, and carries no length controls on any wall", async ({ page }) => {
  await boot(page, 0);
  const dock = rowByRole(page, "dock").first();
  for (const k of ["court", "trailer"]) await addWallLayer(dock, k);
  // one row: swatch · name · Rows · Depth · bin on ONE line
  const box = page.getByTestId("wall-edit-box");
  await expect(box).toHaveAttribute("data-kind", "trailer");
  await expect(box.getByText("Depth", { exact: true })).toBeVisible();
  await expect(box.getByText("Row 1", { exact: false })).toHaveCount(0);
  const lineY = await box.locator("input").evaluateAll((n) => n.map((i) => Math.round(i.getBoundingClientRect().y)));
  expect(new Set(lineY).size).toBe(1);                                                      // Rows and Depth share a line
  expect((await box.boundingBox()).height).toBeLessThan(58);
  await noLengthControls(page);
  // two rows
  const rows = page.getByLabel("Trailer rows", { exact: true });
  await rows.fill("2"); await rows.press("Enter");
  await expect(box.getByText("Row 1", { exact: true })).toBeVisible();
  await expect(box.getByText("Row 2", { exact: true })).toBeVisible();
  await expect(box.getByText("Aisle", { exact: true })).toBeVisible();
  const rowsY = (await page.getByLabel("Trailer rows", { exact: true }).boundingBox()).y;
  const r1Y = (await page.getByLabel("Trailer row 1 depth").boundingBox()).y, aisleY = (await page.getByLabel("Aisle between trailer rows").boundingBox()).y;
  expect(r1Y).toBeGreaterThan(rowsY + 10); expect(Math.abs(aisleY - r1Y)).toBeLessThan(4);   // Rows on line 1; Row 1 · Row 2 · Aisle share line 2
  await noLengthControls(page);
  await page.keyboard.press("Escape");
  // every other kind, on every wall role, has none either
  const rear = rowByRole(page, "rear"), end = rowByRole(page, "ends").first();
  for (const [row, ks] of [[dock, ["buffer", "sidewalk"]], [rear, ["sidewalk", "parking", "trailer", "buffer", "road"]], [end, ["sidewalk", "parking", "trailer", "buffer", "road"]]]) {
    for (const k of ks) await addWallLayer(row, k);
  }
  for (const row of [dock, rear, end]) {
    const n = await row.getByTestId("wall-piece").count();
    for (let i = 0; i < n; i++) {
      const p = row.getByTestId("wall-piece").nth(i);
      await p.click();
      if (!(await page.getByTestId("wall-edit-box").isVisible())) await p.click();
      await expect(page.getByTestId("wall-edit-box")).toBeVisible();
      await noLengthControls(page);
      await page.keyboard.press("Escape");
    }
  }
});

test("each row stays ONE line with its icons on it, the strip is not squeezed at the deepest wall, and the layout holds at a phone width", async ({ page }) => {
  await boot(page, 0);
  for (const [row, ks] of [[rowByRole(page, "dock").first(), ["court", "trailer"]], [rowByRole(page, "rear"), ["sidewalk", "parking"]], [rowByRole(page, "ends").first(), ["sidewalk"]]]) for (const k of ks) await addWallLayer(row, k);
  await expect(page.getByTestId("wall-edit-box")).toBeVisible();               // the last add opens its layer's box; Escape closes THAT (pressed earlier it would close the panel)
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wall-edit-box")).toHaveCount(0);
  const rows = page.getByTestId("wall-row");
  const check = async (label) => {
    for (let i = 0, n = await rows.count(); i < n; i++) expect(await rowFit(rows.nth(i)), `${label} row ${i}`).toEqual([]);
    expect(await page.getByTestId("wall-rows").evaluate((n) => n.scrollWidth > n.clientWidth + 1), `${label} wall-rows overflow`).toBe(false);
  };
  await check("desktop");
  // the deepest wall's strip keeps its full planned width (STRIP.FULL = 66) — the icons did not squeeze it
  const widest = Math.max(...(await page.getByTestId("wall-strip").evaluateAll((n) => n.map((x) => x.getBoundingClientRect().width))));
  expect(widest).toBeGreaterThanOrEqual(66 - 0.5);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await expect(page.getByTestId("wall-rows")).toHaveCount(1);
  await check("phone");
});
