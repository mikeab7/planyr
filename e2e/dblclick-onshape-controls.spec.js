/* B1342704 — a double-click on an on-shape "+ / −" add/remove control (dock-zone extend/pull-in,
 * the dog-ear bump-out toggle, the employee-side sidewalk/parking add/remove, and the car-parking
 * row add/remove) must do ONLY what the control does — it must never fall through and open
 * Properties for the building or parking field it sits on.
 *
 * OWNER'S REPORT, verbatim: "it seems to open even if I'm double clicking the + signs to expand
 * parking and that's not when it's supposed to open the properties." Reported on Goose Creek,
 * "Plan II - 220K, 440K, 700K", on a trailer-parking strip beside Building 5.
 *
 * ROOT CAUSE. These "+"/"−" glyphs (`featNode` / `glyphPlus` / `glyphMinus` in SitePlanner.jsx —
 * the ONE shared trio every on-building and on-parking-field add/remove control renders from) live
 * inside the shared `data-handle-layer` group alongside every DRAG grip (resize, rotate, vertex).
 * `resolveDoubleClickTarget` (featureTarget.js, B233153) treats anything in that group as
 * identification-transparent chrome and falls through to the feature underneath — the right rule
 * for a drag grip, which performs no action of its own, and the WRONG rule for these glyphs, whose
 * `onPointerDown` already performs a complete action (grow/shrink a row, add/remove a zone) on
 * every single press. A double-click therefore fired the action twice AND opened Properties for
 * the feature underneath — exactly the reported collision. Fixed by giving each glyph its own
 * `onDoubleClick` that stops propagation, so the native `dblclick` the browser synthesises from the
 * gesture never reaches the canvas root's `onBgDouble` resolver at all. `onPointerDown`'s existing
 * `stopPropagation()` cannot do this on its own — `dblclick` is a separate, later event.
 *
 * ADJACENT CASES CHECKED, one test each below: the car-parking row "+" (the reported case) · a
 * building's dock-zone "+" (same shared primitive, general rather than parking-specific fix) · the
 * two elements' own BODIES (unaffected — a double-click there must still open Properties) · a
 * building's resize corner grip (unaffected BY DESIGN — it is a drag handle with no action of its
 * own, so CHROME-NEVER-EATS-A-PRESS's handle-transparency rule is the correct one for it and a
 * double-click there correctly still opens Properties for the building underneath).
 *
 * Runs logged out on a freshly drawn blank site: no auth, no external GIS, no real project data
 * (ATTEMPT-BEFORE-YOU-PARK). The live check against the owner's actual Goose Creek plan is V979424.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const panel = (p) => p.getByTestId("property-panel");
const editNodes = (p) => p.getByTestId("feature-edit-nodes");

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

async function wheelZoomIn(page, steps) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16); }
}

/* Zoom in, a batch at a time, until the on-shape edit controls actually render — the zoom floor is
 * a function of the live canvas width (featureEditZoom.js), not a fixed step count (see
 * e2e/feature-edit-zoom.spec.js, which this borrows the wheel idiom from). */
async function zoomUntilEditNodes(page) {
  for (let i = 0; i < 6; i++) {
    if ((await editNodes(page).count()) > 0) return;
    await wheelZoomIn(page, 6);
  }
  await expect.poll(() => editNodes(page).count(), { timeout: 5_000 }).toBeGreaterThan(0);
}

async function readEls(page) {
  return page.evaluate(() => {
    const map = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return site.els || [];
  });
}

async function drawBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 200, y1 = box.y + 160, x2 = box.x + 700, y2 = box.y + 460;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 80, y1 + 50, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

async function drawParking(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  const x1 = box.x + 250, y1 = box.y + 420, x2 = box.x + 780, y2 = box.y + 620;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 100, y1 + 60, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

/* Screen centre of the first ADD ("+") glyph inside the edit-node group. Every remove ("−") glyph
 * renders at the same fixed fill (#b91c1c); anything else is an add control — which one doesn't
 * matter for these tests, since every add action grows the field or adds a new bonded element. */
async function firstAddControlCentre(page) {
  return page.evaluate(() => {
    const group = document.querySelector('[data-testid="feature-edit-nodes"]');
    if (!group) return null;
    const circles = [...group.querySelectorAll("circle")];
    const add = circles.find((c) => c.getAttribute("fill") !== "#b91c1c") || circles[0];
    if (!add) return null;
    const r = add.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
}

test.describe("B1342704 — an on-shape add/remove control swallows its own double-click", () => {
  test("car-parking row '+' (the reported case): double-click grows the field, never opens Properties", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const p = await drawParking(page);
    await page.mouse.click(p.cx, p.cy); // select
    // el-tier: the subject IS the drawn parking-field element, and this only waits for it to render.
    await expect(page.locator("[data-el-id]").first()).toBeVisible();
    await page.waitForTimeout(450); // clear any pending tap pairing from the draw/select gesture
    await zoomUntilEditNodes(page);
    await page.waitForTimeout(450);

    const before = await readEls(page);
    const field = before.find((e) => e.type === "parking" && !e.points);
    expect(field, "no plain-rect parking field on the plan").toBeTruthy();

    const c = await firstAddControlCentre(page);
    expect(c, "the parking field's own edit control did not render").toBeTruthy();

    await page.mouse.dblclick(c.x, c.y);
    await page.waitForTimeout(200);

    await expect(panel(page), "double-clicking the parking field's own '+' control opened Properties").toHaveCount(0);
    const after = await readEls(page);
    const grown = after.find((e) => e.id === field.id);
    expect(grown, "the parking field disappeared").toBeTruthy();
    expect(Math.abs(grown.h), "double-clicking '+' should still grow the field — that is the control's own action").toBeGreaterThan(Math.abs(field.h));
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the parking field's own BODY is unaffected: double-click still opens Properties", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const p = await drawParking(page);
    await page.waitForTimeout(450);
    await page.mouse.dblclick(p.cx, p.cy);
    await expect(panel(page), "double-clicking the parking field's body did not open Properties").toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a building's dock-zone '+' (same shared primitive, general fix): double-click adds the zone, never opens Properties", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const b = await drawBuilding(page);
    await page.mouse.click(b.cx, b.cy); // select
    // el-tier: the subject IS the drawn building element, and this only waits for it to render.
    await expect(page.locator("[data-el-id]").first()).toBeVisible();
    await page.waitForTimeout(450);
    await zoomUntilEditNodes(page);
    await page.waitForTimeout(450);

    const before = await readEls(page);
    const c = await firstAddControlCentre(page);
    expect(c, "the building's on-shape edit controls did not render").toBeTruthy();

    await page.mouse.dblclick(c.x, c.y);
    await page.waitForTimeout(200);

    await expect(panel(page), "double-clicking the building's '+' control opened Properties").toHaveCount(0);
    const after = await readEls(page);
    expect(after.length, "the control's own add action did not fire").toBeGreaterThan(before.length);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a building's resize corner grip is unaffected (it is a drag handle, not an action button): double-click still opens Properties", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const b = await drawBuilding(page);
    await page.mouse.click(b.cx, b.cy); // select — mounts the resize corner grips
    const grip = page.locator('rect[data-handle="corner"]').first();
    await expect(grip).toBeVisible();
    await page.waitForTimeout(450);
    const r = await grip.boundingBox();
    await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2);
    await expect(panel(page), "double-clicking a resize corner grip should still open Properties for the building underneath").toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
