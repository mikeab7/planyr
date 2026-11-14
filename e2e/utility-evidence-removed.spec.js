/* NEW-1 (owner decision 2026-11-14) — the five "Utility Evidence" tools are REMOVED from the Site Planner.
 *
 * Trace overhead electric · Route electric service · Route water service · Infer water main · Cross-section (ditch)
 * used to be a right-rail section (`rail-ev-*`) on every LOCATED plan. Nobody used them and they were never really tested.
 *
 * What this pins, on the REAL app:
 *   1. RED-PROOF — on a located plan the right rail has NO "Utility Evidence" heading and NO `rail-ev-*` control
 *      (on the pre-removal build the heading count is 1 and all five buttons exist, so every assertion here fails);
 *   2. KEPT — the Easement tool still draws a centerline easement, and its rules editor still opens from the Easement ▾;
 *   3. LOADER TOLERANCE — a plan that still carries an old utilRoute / traced / infwater markup opens cleanly (no crash) and
 *      the retired records are dropped, while an easement and a plain polyline beside them survive.
 */
import { test, expect } from "@playwright/test";

const LAT = 29.77938, LON = -95.89503;
const SITE_ID = "e2e-utility-evidence-removed";
const site = (over = {}) => ({
  schemaVersion: 12, id: SITE_ID, groupId: SITE_ID, site: "Utility Evidence Removed", name: "Utility Evidence Removed",
  updatedAt: 1783000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], ...over,
});

async function open(page, s) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); } catch (_) {} }, JSON.stringify({ [s.id]: s }));
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`/#/project/${s.id}/site`, { waitUntil: "load" });
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1200);
  return errors;
}

test("a located plan's right rail has no Utility Evidence heading and no rail-ev-* control", async ({ page }) => {
  await open(page, site());
  // Known-good arm: the rail itself is there (a missing rail would make "no Utility Evidence" vacuously true).
  await expect(page.locator(".rail-hdr", { hasText: "Site elements" }), "the rail renders its other headings").toHaveCount(1);
  await expect(page.getByRole("button", { name: /Easement/ }).first(), "the Easement tool is still on the rail").toBeVisible();
  await expect(page.locator(".rail-hdr", { hasText: "Utility Evidence" })).toHaveCount(0);
  await expect(page.locator('[data-testid^="rail-ev-"]')).toHaveCount(0);
  for (const re of [/Trace overhead electric/, /Route electric service/, /Route water service/, /Infer water main/, /Cross-section \(ditch\)/]) {
    await expect(page.getByText(re), `${re} must not be on the page`).toHaveCount(0);
  }
});

test("the Easement tool still draws, and its rules editor still opens from the Easement ▾", async ({ page }) => {
  await open(page, site());
  const canvas = page.getByTestId("planner-canvas");
  const box = await canvas.boundingBox();
  // one markup can stamp `data-markup` on more than one node (body + grab layer), so count DISTINCT ids
  const markupIds = () => page.evaluate(() => [...new Set([...document.querySelectorAll("[data-markup]")].map((n) => n.getAttribute("data-markup")))]);
  expect(await markupIds(), "no markup yet").toEqual([]);

  await page.getByRole("button", { name: /^Easement$/ }).first().click();
  await expect(page.getByRole("button", { name: /^Easement$/ }).first()).toHaveAttribute("aria-pressed", "true");
  const x0 = box.x + box.width * 0.35, y0 = box.y + box.height * 0.45;
  await page.mouse.click(x0, y0);
  await page.mouse.click(x0 + 220, y0 + 10);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await markupIds()).length, { message: "the easement was drawn" }).toBe(1);

  // the rules editor: Easement ▾ → "Easement rules" disclosure
  await page.getByRole("button", { name: "Easement options" }).click();
  const toggle = page.getByTestId("easement-rules-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("easement-rules")).toBeVisible();
  await expect(page.getByTestId("easement-rules").locator("select")).toBeVisible();
});

test("a plan that still carries retired utilRoute / traced / infwater markups opens cleanly and drops them", async ({ page }) => {
  const pts = [{ x: 200, y: 200 }, { x: 600, y: 200 }];
  const ring = [{ x: 100, y: 500 }, { x: 400, y: 500 }, { x: 400, y: 560 }, { x: 100, y: 560 }];
  const errors = await open(page, site({
    markups: [
      { id: "u1", kind: "utilRoute", util: "water", pts, corridor: ring, pad: ring, width: 15, fitting: "TAP", label: "Water service", stroke: "#0891b2" },
      { id: "t1", kind: "traced", pts, label: "Overhead electric (traced)", stroke: "#b45309", weight: 2.6, dash: "solid" },
      { id: "w1", kind: "infwater", pts, label: "Inferred water main", stroke: "#0891b2", weight: 2, dash: "dashed" },
      { id: "pl1", kind: "polyline", pts: [{ x: 300, y: 700 }, { x: 700, y: 760 }], stroke: "#222222", weight: 2, dash: "solid" },
    ],
  }));
  await expect(page.locator('[data-markup="u1"], [data-markup="t1"], [data-markup="w1"]'), "the retired kinds are not drawn").toHaveCount(0);
  expect(await page.locator('[data-markup="pl1"]').count(), "an ordinary markup beside them survives").toBeGreaterThan(0);
  expect(errors, "no page error while loading").toEqual([]);
});
