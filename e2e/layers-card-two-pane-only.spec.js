/* B2391216 ×2 — the planner's Imagery & Layers card is the approved two-pane card and NOTHING else.
 *
 * Owner report 2026-10-21 (screenshot of the PLANNER, located plan): "see how this doesnt look like what you mocked up."
 * The redesign had only rebuilt LayerPanel, so the planner host kept four things stacked UNDER the two panes — an
 * "Evidence tools" block, an "Easement rules" disclosure, a greyed "AI corridor scan — coming soon" placeholder and a footer
 * sentence — and passed no City Names row. The map finder host had none of them, which is why the finder looked right.
 *
 * What this pins, on the REAL app (a located plan):
 *   1. the card holds exactly the header row and the two panes — none of the four old texts anywhere inside it, and Map Base › Labels
 *      lists Road Names AND City Names (both on the same row anatomy as every other layer row: checkbox · swatch slot · name · ▾);
 *   2. the five evidence tools did NOT vanish — they are a "Utility Evidence" section on the right rail, each arms;
 *   3. Easement rules is reachable from the Easement tool's ▾, and the route tools' no-rule path opens it THERE and says where;
 *   4. an UNLOCATED plan shows no Utility Evidence section (they read the aerial / GIS around the site).
 * Red-proof: on c542ffc every assertion in 1–3 fails.
 */
import { test, expect } from "@playwright/test";
import { panelSel, openPlannerLayers } from "./lib/layersPanel.js";

const LAT = 29.77938, LON = -95.89503;
const site = (over = {}) => ({
  schemaVersion: 12, id: "lc1", groupId: "lc1", site: "Layers Card Guard", name: "Layers Card Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], ...over,
});

async function open(page, s, { width = 1280, height = 860 } = {}) {
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); } catch (_) {} }, JSON.stringify({ [s.id]: s }));
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.setViewportSize({ width, height });
  await page.goto(`/#/project/${s.id}/site`, { waitUntil: "load" });
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1200);
}

const OLD_TEXTS = [/Evidence tools/i, /Easement rules/i, /AI corridor scan/i, /Layers sit beneath/i];

test("the layers card is the header row + the two panes, with Road Names AND City Names on Map Base", async ({ page }) => {
  await open(page, site());
  await openPlannerLayers(page);
  const panel = page.locator(panelSel("planner")).first();

  // The card = the element holding the panel; its whole text is the panel's own text, so nothing rides under the panes.
  const card = panel.locator("xpath=ancestor::div[@data-wheelscroll='1'][1]");
  await expect(card).toHaveCount(1);
  for (const re of OLD_TEXTS) await expect(card, `the card must not carry ${re}`).not.toContainText(re);

  // Header row + the two panes, and nothing after them: the panel's children are exactly [header, (nav + pane row)].
  await expect(panel.getByTestId("layers-header")).toBeVisible();
  await expect(panel.getByTestId("layer-group-nav")).toBeVisible();
  await expect(panel.getByTestId("layer-pane")).toBeVisible();
  const kids = await panel.evaluate((el) => [...el.children].map((c) => c.getAttribute("data-testid") || (c.querySelector('[data-testid="layer-pane"]') ? "panes" : "other")));
  expect(kids, "the panel is the header row and the pane row — no third section").toEqual(["layers-header", "panes"]);
  // …and no sibling content after the panel inside the card's scroll body.
  const after = await card.evaluate((c, sel) => {
    const p = c.querySelector(sel);
    let body = p; while (body && body.parentElement && body.parentElement !== c && getComputedStyle(body.parentElement).overflowY !== "auto") body = body.parentElement;
    const scroller = body && body.parentElement && getComputedStyle(body.parentElement).overflowY === "auto" ? body.parentElement : null;
    return scroller ? [...scroller.children].map((x) => x.textContent.trim().slice(0, 40)).filter(Boolean).length : -1;
  }, panelSel("planner"));
  expect(after, "the card's scroll body holds only the panel").toBeLessThanOrEqual(1);

  // Map Base › Labels: both rows, each on the standard row anatomy.
  await panel.getByTestId("layer-group-base").click();
  for (const id of ["road_names", "city_names"]) {
    const row = panel.getByTestId(`layer-row-${id}`);
    await expect(row, `Map Base lists ${id}`).toBeVisible();
    await expect(row.locator('input[type="checkbox"]')).toHaveCount(1);
    await expect(row.getByTestId(`layer-caret-${id}`), "the standard ▾ button").toBeVisible();
    await expect(row.locator('[data-swatch]'), "the swatch slot every row reserves").toHaveCount(1);
  }
  // City Names is a real switch: off → on persists as a device pref.
  const city = panel.getByTestId("layer-row-city_names").locator('input[type="checkbox"]');
  await city.uncheck({ force: true });
  expect(await page.evaluate(() => localStorage.getItem("planyr:cityNames"))).toContain('"on":false');
  await city.check({ force: true });
  expect(await page.evaluate(() => localStorage.getItem("planyr:cityNames"))).toContain('"on":true');
  // The standard ▾ opens the standard inline dropdown (info, no opacity slider for City Names — it is gated by the layer itself).
  await panel.getByTestId("layer-caret-road_names").click();
  await expect(panel.getByTestId("layer-row-road_names-menu")).toBeVisible();
});

test("the five evidence tools live on the right rail under Utility Evidence, and each arms", async ({ page }) => {
  await open(page, site());
  const rail = page.locator(".rail-hdr", { hasText: "Utility Evidence" });
  await expect(rail, "a Utility Evidence heading on the rail").toHaveCount(1);
  for (const [id, label] of [["rail-ev-trace", /Trace overhead electric/], ["rail-ev-route-elec", /Route electric service/], ["rail-ev-route-water", /Route water service/], ["rail-ev-infer-main", /Infer water main/], ["rail-ev-xsec", /Cross-section \(ditch\)/]]) {
    await expect(page.getByTestId(id), id).toContainText(label);
  }
  // Trace arms (aria-pressed) and disarms.
  const trace = page.getByTestId("rail-ev-trace");
  await trace.click();
  await expect(trace).toHaveAttribute("aria-pressed", "true");
  await trace.click();
  await expect(trace).toHaveAttribute("aria-pressed", "false");
  // Cross-section arms and says what to do.
  const xsec = page.getByTestId("rail-ev-xsec");
  await xsec.click();
  await expect(xsec).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Click one bank of the ditch/)).toBeVisible();
  await xsec.click();
  await expect(xsec).toHaveAttribute("aria-pressed", "false");
  // Route electric with no traced line declines with its own existing message (the handler is the same one).
  await page.getByTestId("rail-ev-route-elec").click();
  await expect(page.getByText(/Trace an overhead pole line first/)).toBeVisible();
});

test("Easement rules opens from the Easement ▾, and the route tools' no-rule path opens it there and says where", async ({ page }) => {
  // No county on file → no easement criteria, so Route water service declines and points at the rules.
  await open(page, site({ county: null }));
  await page.getByRole("button", { name: "Easement options" }).click();
  const toggle = page.getByTestId("easement-rules-toggle");
  await expect(toggle).toBeVisible();
  await expect(page.getByTestId("easement-rules")).toHaveCount(0);
  await toggle.click();
  await expect(page.getByTestId("easement-rules")).toBeVisible();
  await expect(page.getByTestId("easement-rules").locator("select")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("easement-rules")).toHaveCount(0);

  // The no-rule path: Route water service → the flash names the NEW place, and the menu opens with the rules showing.
  await page.getByTestId("rail-ev-route-water").click();
  await expect(page.getByText(/pick one in the Easement ▾ menu/)).toBeVisible();
  await expect(page.getByTestId("easement-rules")).toBeVisible();
  // The old home is gone: no rules disclosure anywhere in the layers card.
  await openPlannerLayers(page);
  await expect(page.locator(panelSel("planner")).first()).not.toContainText(/Easement rules/i);
});

test("on a phone the card sits fully on screen between the two edge tabs, with the View chip reachable above it", async ({ page }) => {
  await open(page, site(), { width: 390, height: 844 });
  await openPlannerLayers(page);
  const panel = page.locator(panelSel("planner")).first();
  const card = panel.locator("xpath=ancestor::div[@data-wheelscroll='1'][1]");
  const b = await card.boundingBox();
  expect(b.x, "the card's left edge is on screen, clear of the Panels tab (40px)").toBeGreaterThanOrEqual(40);
  expect(b.x + b.width, "…and its right edge is clear of the Tools tab").toBeLessThanOrEqual(390 - 40);
  const view = await page.getByTestId("view-menu-btn").boundingBox();
  expect(view.x, "the View chip is on screen").toBeGreaterThanOrEqual(0);
  expect(view.x + view.width).toBeLessThanOrEqual(390);
  expect(view.y + view.height, "the View chip sits above the card, not beside it").toBeLessThanOrEqual(b.y + 1);
  for (const re of OLD_TEXTS) await expect(card).not.toContainText(re);
});

test("an unlocated plan has no Utility Evidence section and no extra rows under its card", async ({ page }) => {
  await open(page, site({ origin: null }));
  await expect(page.locator(".rail-hdr", { hasText: "Utility Evidence" })).toHaveCount(0);
  await openPlannerLayers(page);
  const card = page.locator(panelSel("planner")).first().locator("xpath=ancestor::div[@data-wheelscroll='1'][1]");
  for (const re of OLD_TEXTS) await expect(card).not.toContainText(re);
});
