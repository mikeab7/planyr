/* Site Planner cursors — owner-approved convention (2026-10-20), measured on the REAL canvas.
 *
 * Every check reads `getComputedStyle(document.elementFromPoint(x, y)).cursor` — what the browser would actually show under the
 * pointer — never the source. States covered: idle · hover an object · locked · armed tool · every grip kind (corner on a wide and
 * on a rotated building, edge, rotate) · MID-DRAG with the pointer far from the grip · disabled · and "no not-allowed anywhere".
 *
 * Known-good arm (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the tool rail's own button must read `pointer`, or the instrument is void.
 * Expected values for the rotated-building corners are worked out by hand from the geometry, not by calling the app's function.
 *
 * Red on main: corners of a 600×140 building read ew/ns (centre→corner angle), the rotate grip reads `grab`, an armed tool leaves a
 * building's `move`, mid-drag the cursor falls back to the open hand, a locked callout shows `move` AND drags.
 *
 * Run: npx playwright test e2e/planner-cursors.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const BASE_EL = FIXTURE.els.find((e) => e.id === "e1454729ykduhm");
const SITE_ID = "e2e-planner-cursors";

const bld = (id, o) => ({ ...BASE_EL, id, dock: undefined, dockSide: undefined, z: 0, rot: 0, ...o });
const EL_WIDE = bld("cuWide", { cx: 0, cy: 0, w: 600, h: 140 });
const EL_LOCKED = bld("cuLocked", { cx: 0, cy: 380, w: 420, h: 120, locked: true });
const EL_ROT = bld("cuRot", { cx: 0, cy: -380, w: 500, h: 130, rot: 30 });
const CALLOUT = { id: "cuCo", text: "Locked note", box: { x: 800, y: 0 }, tip: { x: 640, y: 0 }, z: 1, locked: true };

async function load(page, { callouts = [CALLOUT] } = {}) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Cursor check", name: "ZZ planner cursors",
    origin: null, county: "harris", parcels: [], els: [EL_WIDE, EL_LOCKED, EL_ROT], measures: [], callouts, markups: [],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Cursor check", { exact: false }).first().click(); // the Map view lists the seeded site; opening it enters the planner
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  /* el-tier: this fixture seeds exactly three buildings and one callout; the element tier IS the readiness gate here. */
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(1200); // fit / label / declutter settle
  // FOREGROUND-OR-VOID: a hidden tab does not repaint — measure nothing unless this one is visible and its frame loop is live.
  const live = await page.evaluate(async () => {
    const raf = await Promise.race([new Promise((r) => requestAnimationFrame(() => r("raf"))), new Promise((r) => setTimeout(() => r("timeout"), 1500))]);
    return { vis: document.visibilityState, raf };
  });
  expect(live).toEqual({ vis: "visible", raf: "raf" });
}

const cursorAt = (page, x, y) => page.evaluate(([px, py]) => {
  const n = document.elementFromPoint(px, py);
  return n ? getComputedStyle(n).cursor : null;
}, [x, y]);
const centre = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const gripCursors = (page, kind) => page.evaluate((k) => [...document.querySelectorAll(`[data-handle="${k}"]`)].map((n) => getComputedStyle(n).cursor), kind);
const bodyPoint = async (page, id) => {
  // a point on an UNROTATED building clear of its label and of the dimension numbers (which sit on the edges and read `text`)
  const r = await page.locator(`[data-el-id="${id}"]`).first().boundingBox();
  return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.68 };
};
const emptyPoint = async (page) => {
  const b = await canvas(page).boundingBox();
  return { x: b.x + 14, y: b.y + b.height - 40 };
};
async function select(page, id) {
  const p = id === "cuRot" ? await centre(page, `[data-el-id="${id}"]`) : await bodyPoint(page, id);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
}

test.describe("Site Planner cursors follow the convention", () => {
  test("known-good arm + idle surface + no not-allowed anywhere", async ({ page }) => {
    await load(page);
    const tool = await centre(page, '[data-testid="tool-marquee"]');
    expect(await cursorAt(page, tool.x, tool.y), "instrument arm: a rail button must read pointer").toBe("pointer");
    const e = await emptyPoint(page);
    expect(await cursorAt(page, e.x, e.y)).toBe("grab");
    const bad = await page.evaluate(() => [...document.querySelectorAll("*")].filter((n) => getComputedStyle(n).cursor === "not-allowed").map((n) => n.tagName + (n.getAttribute("aria-label") ? `[${n.getAttribute("aria-label")}]` : "")).slice(0, 8));
    expect(bad, "nothing in the idle planner may show not-allowed").toEqual([]);
  });

  test("hover: an unlocked building is move, a LOCKED one is pointer, a locked callout is pointer", async ({ page }) => {
    await load(page);
    const w = await bodyPoint(page, "cuWide");
    expect(await cursorAt(page, w.x, w.y)).toBe("move");
    const l = await bodyPoint(page, "cuLocked");
    expect(await cursorAt(page, l.x, l.y)).toBe("pointer");
    const c = await centre(page, '[data-testid="callout-box-cuCo"]');
    expect(await cursorAt(page, c.x, c.y)).toBe("pointer");
  });

  test("grips: corners use the grip's own axes (wide AND rotated), edges are ew/ns, rotate is the rotate cursor", async ({ page }) => {
    await load(page);
    await select(page, "cuWide");
    // 600×140 is 4.3:1 — the old centre→corner angle gave ew/ns on every corner.
    expect(await gripCursors(page, "corner")).toEqual(["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"]);
    const rot = await gripCursors(page, "rotate");
    expect(rot.length).toBe(1);
    expect(rot[0]).toMatch(/^url\(/);
    expect(rot[0]).not.toMatch(/^grab/);
    const edges = await page.evaluate(() => [...document.querySelectorAll('[data-handle="edge"]')].map((n) => [n.getAttribute("data-edge"), getComputedStyle(n).cursor]));
    for (const [edge, cur] of edges) expect(cur, `edge ${edge}`).toBe(edge.startsWith("0,") ? "ns-resize" : "ew-resize");
    // rotated 30°: worked out by hand — (−1,−1)→75° ns · (1,−1)→165° ew · (1,1)→75° ns · (−1,1)→165° ew
    await select(page, "cuRot");
    expect(await gripCursors(page, "corner")).toEqual(["ns-resize", "ew-resize", "ns-resize", "ew-resize"]);
  });

  test("an armed tool owns the cursor over everything it can be clicked on", async ({ page }) => {
    await load(page);
    await page.getByTestId("tool-marquee").click();
    await page.waitForTimeout(200);
    for (const [what, pt] of [["building", await bodyPoint(page, "cuWide")], ["locked building", await bodyPoint(page, "cuLocked")], ["empty", await emptyPoint(page)], ["locked callout", await centre(page, '[data-testid="callout-box-cuCo"]')]]) {
      expect(await cursorAt(page, pt.x, pt.y), what).toBe("crosshair");
    }
  });

  test("MID-DRAG the cursor stays the drag's cursor with the pointer far from the grip, and clears on release", async ({ page }) => {
    await load(page);
    const far = await emptyPoint(page);
    const pinned = () => page.evaluate(() => !!document.getElementById("planyr-drag-cursor-pin"));

    // pan: grabbing
    await page.mouse.move(far.x, far.y); await page.mouse.down(); await page.mouse.move(far.x + 60, far.y - 30, { steps: 6 }); await page.waitForTimeout(100);
    expect(await cursorAt(page, far.x + 60, far.y - 30), "pan").toBe("grabbing");
    await page.mouse.up(); await page.waitForTimeout(150);
    expect(await pinned(), "pan pin cleared").toBe(false);

    // resize from a corner grip, pointer taken well away from the grip
    await select(page, "cuWide");
    const g = await centre(page, '[data-handle="corner"] >> nth=2');
    await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 140, g.y + 90, { steps: 8 }); await page.waitForTimeout(100);
    expect(await cursorAt(page, g.x + 140, g.y + 90), "resize").toBe("nwse-resize");
    expect(await cursorAt(page, far.x, far.y), "resize, over the empty canvas").toBe("nwse-resize");
    await page.mouse.up(); await page.waitForTimeout(150);
    expect(await pinned(), "resize pin cleared").toBe(false);
    expect(await cursorAt(page, far.x, far.y)).toBe("grab");

    // rotate
    await select(page, "cuWide");
    const r = await centre(page, '[data-handle="rotate"]');
    await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.move(r.x + 120, r.y + 60, { steps: 8 }); await page.waitForTimeout(100);
    expect(await cursorAt(page, far.x, far.y), "rotate").toMatch(/^url\(/);
    await page.mouse.up(); await page.waitForTimeout(150);

  });

  test("MID-DRAG: moving a building keeps move for the whole gesture; Escape / release never leave it stuck", async ({ page }) => {
    await load(page);
    const far = await emptyPoint(page);
    const pinned = () => page.evaluate(() => !!document.getElementById("planyr-drag-cursor-pin"));
    const b = await bodyPoint(page, "cuWide");
    await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + 80, b.y + 50, { steps: 8 }); await page.waitForTimeout(100);
    expect(await cursorAt(page, far.x, far.y), "move").toBe("move");
    await page.keyboard.press("Escape"); await page.mouse.up(); await page.waitForTimeout(150);
    expect(await pinned(), "move pin cleared").toBe(false);
    // a LOCKED building's press never starts a move drag, so the pointer never claims one
    const l = await bodyPoint(page, "cuLocked");
    await page.mouse.move(l.x, l.y); await page.mouse.down(); await page.mouse.move(l.x + 40, l.y + 20, { steps: 5 }); await page.waitForTimeout(100);
    expect(await cursorAt(page, far.x, far.y), "locked building press").not.toBe("move");
    await page.mouse.up();
  });

  test("a LOCKED callout cannot be dragged", async ({ page }) => {
    await load(page);
    const before = await page.evaluate((id) => JSON.parse(localStorage.getItem("planarfit:sites:v1"))[id].callouts[0].box, SITE_ID);
    const c = await centre(page, '[data-testid="callout-box-cuCo"]');
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 120, c.y + 90, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(1200);
    const after = await page.evaluate((id) => JSON.parse(localStorage.getItem("planarfit:sites:v1"))[id].callouts[0].box, SITE_ID);
    expect(after).toEqual(before);
  });

  test("disabled controls show the default arrow — Undo/Redo with nothing to undo", async ({ page }) => {
    await load(page);
    const undo = page.locator('button[aria-label="Undo"]').first();
    await expect(undo).toBeDisabled();
    const c = await undo.boundingBox();
    expect(await undo.evaluate((n) => getComputedStyle(n).cursor), "the button itself").toBe("default");
    // a disabled button does not take the hit test, so the pointer is over its wrapper — which must also read as the plain arrow
    expect(["default", "auto"]).toContain(await cursorAt(page, c.x + c.width / 2, c.y + c.height / 2));
  });
});
