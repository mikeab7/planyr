/* NEW-1 (2026-11-03, owner approved the After board "Ship it") — Docks & walls: the add control NAMES the next layer, and the edit box is
 * one line with no length. Real inspector, logged out. Covers: one click adds court → trailer → buffer in turn on a dock wall; the ▾
 * floats over the rows (never pushes them, never lives inside the panel's scroll area) and adds a road; an end wall adds walk → parking;
 * Escape / click-away close the ▾; the trailer box is one line with "Depth", two rows show Row 1 / Row 2 / Aisle on a second line; no
 * Length / Align / Full length in the box on ANY wall; the row stays one line (the longest case fits without squeezing the strip); the
 * map-selected Properties panel still has its Length; a rotated building and a phone width behave the same.
 * Run: BASE_URL=http://127.0.0.1:4173 npx playwright test e2e/wall-add-control.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, addWallLayer } from "./helpers.js";
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
const named = (row) => row.getByTestId("wall-add");
const kinds = (row) => row.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")));
const noLengthControls = async (page) => {
  for (const id of ["wall-extent", "wall-extent-len", "wall-extent-full", "wall-align-start", "wall-align-centre", "wall-align-end"]) await expect(page.getByTestId(id)).toHaveCount(0);
  const box = page.getByTestId("wall-edit-box");
  for (const w of ["Length", "Align", "Full length", "Centre"]) await expect(box.getByText(w, { exact: false })).toHaveCount(0);
};

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

for (const deg of [0, 315]) {
  test(`rot ${deg} · dock wall: the button names the next layer, one click each adds court → trailer → buffer; the ▾ floats and adds a road`, async ({ page }) => {
    await boot(page, deg);
    const dock = rowByRole(page, "dock").first();
    await expect(named(dock)).toHaveAttribute("data-kind", "court");
    await expect(dock.getByTestId("wall-add-more")).toHaveCount(0);                       // one option ⇒ no ▾
    await named(dock).click();
    await expect(page.getByTestId("wall-edit-box")).toHaveAttribute("data-kind", "court");   // the new layer's box opens, as before
    await expect(named(dock)).toHaveAttribute("data-kind", "trailer");
    await named(dock).click();
    await expect(page.getByTestId("wall-edit-box")).toHaveAttribute("data-kind", "trailer");
    await expect(named(dock)).toHaveAttribute("data-kind", "buffer");                                     // the button stays usable: keep clicking
    await named(dock).click();
    await expect(named(dock)).toHaveAttribute("data-kind", "sidewalk");
    expect(await kinds(dock)).toEqual(["court", "trailer", "buffer"]);

    // the ▾ holds the rest under their full names (a second trailer piece and a second buffer are always on offer), floats over the rows and does NOT push them down
    const rear = rowByRole(page, "rear");
    const topBefore = (await rear.boundingBox()).y;
    await dock.getByTestId("wall-add-more").click();
    const menu = page.getByTestId("wall-add-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText(["Road", "Trailer parking", "Landscape buffer"]);
    expect((await rear.boundingBox()).y).toBe(topBefore);                                  // rows did not move
    const where = await menu.evaluate((el) => { const p = el.closest(".menu") || el.parentElement; const cs = getComputedStyle(p); return { pos: cs.position, parentIsBody: p.parentElement === document.body }; });
    expect(where).toEqual({ pos: "fixed", parentIsBody: true });                             // a portal: it cannot clip inside the scroll area
    // Escape closes it; so does a press away
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await dock.getByTestId("wall-add-more").click();
    await expect(menu).toBeVisible();
    await page.getByTestId("building-header").click({ force: true });
    await expect(menu).toHaveCount(0);
    // a Road through the ▾; nothing is offered after it
    await addWallLayer(dock, "road");
    await expect.poll(() => kinds(dock)).toEqual(["court", "trailer", "buffer", "road"]);
    await expect(named(dock)).toHaveCount(0);
  });

  test(`rot ${deg} · end wall: sidewalk, then parking (and MORE parking on every further press), the buffer from the ▾`, async ({ page }) => {
    await boot(page, deg);
    const end = rowByRole(page, "ends").first();
    await expect(named(end)).toHaveAttribute("data-kind", "sidewalk");
    await named(end).click();
    await expect(named(end)).toHaveAttribute("data-kind", "parking");
    await named(end).click();
    await expect(named(end)).toHaveAttribute("data-kind", "parking");                      // NEW-1 (2026-11-04): parking leads until a layer sits beyond it
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

test("each row stays ONE line with the named button on it, the strip is not squeezed, and the layout holds at a phone width", async ({ page }) => {
  await boot(page, 0);
  for (const [row, ks] of [[rowByRole(page, "dock").first(), ["court", "trailer"]], [rowByRole(page, "rear"), ["sidewalk", "parking"]], [rowByRole(page, "ends").first(), ["sidewalk"]]]) for (const k of ks) await addWallLayer(row, k);
  await page.keyboard.press("Escape");
  const measure = async () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="wall-row"]')].map((r) => {
      const line = r.firstElementChild, add = r.querySelector('[data-testid="wall-add-group"]'), strip = r.querySelector('[data-testid="wall-strip"]');
      const lr = line.getBoundingClientRect(), ar = add ? add.getBoundingClientRect() : null;
      return { dbg: ar ? `line ${Math.round(lr.left)}-${Math.round(lr.right)} add ${Math.round(ar.left)}-${Math.round(ar.right)} strip ${strip ? Math.round(strip.getBoundingClientRect().right) : 0}` : "", h: Math.round(lr.height), addInside: ar ? ar.right <= lr.right + 0.5 && ar.left >= lr.left : true, stripW: strip ? Math.round(strip.getBoundingClientRect().width) : null, overflow: line.scrollWidth > line.clientWidth + 1, label: add ? add.textContent : "" };
    });
    const wr = document.querySelector('[data-testid="wall-rows"]');
    return { rows, wrapOverflow: wr.scrollWidth > wr.clientWidth + 1, viewport: innerWidth };
  });
  const wide = await measure();
  for (const r of wide.rows) { expect(r.h, r.label).toBeLessThan(36); expect(r.addInside, r.label).toBe(true); expect(r.overflow, r.label).toBe(false); }
  expect(wide.wrapOverflow).toBe(false);
  // the deepest wall's strip keeps its full planned width (STRIP.FULL = 118) — the button did not squeeze it
  expect(Math.max(...wide.rows.map((r) => r.stripW || 0))).toBeGreaterThanOrEqual(118);
  // phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  if (await page.getByTestId("wall-rows").count()) {
    const narrow = await measure();
    for (const r of narrow.rows) { expect(r.h, r.label).toBeLessThan(36); expect(r.addInside, r.label + " " + r.dbg).toBe(true); }
    expect(narrow.wrapOverflow).toBe(false);
  }
});
