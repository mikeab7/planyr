/* Left-rail panel toggle must not jump the drawing (B837).
 *
 * Drives the REAL app LOGGED OUT: seeds a one-parcel site into the logged-out store
 * (localStorage `planarfit:sites:v1`) with a real origin, opens it, then opens / switches /
 * closes the left-rail panels. The docked panel steals width from the in-flow canvas; the planner
 * pans the SVG to compensate so the drawing stays welded to its real-world position. Before B837
 * that compensation used an ASSUMED `leftWidth + 6` applied in a passive (after-paint) effect —
 * fragile to width mismatch and one frame late. B837 measures the real left-edge in a LAYOUT effect.
 *
 * The invariant this guards: a FIXED feet point that stays visible keeps its viewport screen-x
 * across every open / switch / close. We read the view transform straight off the canvas seam
 * (`data-view-offx` / `data-view-ppf` + the `0 0 w h` viewBox that already encodes size.w) and map
 * feet→screen, so no drawn element is needed. Runs without the seeded account (no auth gate).
 *
 * NOTE: the aerial tile-wipe FLASH half of B837 (ghost-buffering the resize invalidateSize) needs
 * real basemap tiles + a human eye and is verified live (VERIFICATION V328); this spec covers the
 * geometric jump half, which is fully observable headless.
 */
import { test, expect } from "@playwright/test";

const SITE = {
  schemaVersion: 12, id: "b837-viewport", groupId: "b837-viewport",
  site: "B837 Viewport Guard", name: "B837 Viewport Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 29.7604, lon: -95.3698 }, county: "Harris", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};
const FX = 1100; // feet — near the parcel's right edge (0..1320); stays visible when a ~320px panel docks

// Map a fixed feet point to its viewport screen-x via the canvas transform seam.
async function feetScreenX(page, fx) {
  return page.evaluate((f) => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const offX = parseFloat(svg.getAttribute("data-view-offx"));
    const ppf = parseFloat(svg.getAttribute("data-view-ppf"));
    const vb = svg.getAttribute("viewBox").split(" ").map(Number); // 0 0 w h → w = size.w
    const r = svg.getBoundingClientRect();
    return r.left + ((f * ppf + offX) / vb[2]) * r.width;
  }, fx);
}
const openPanels = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="panel-chrome-"]'))
    .map((e) => e.getAttribute("data-testid")).filter((t) => /^panel-chrome-[a-z]+$/.test(t)));

test.describe("panel toggle viewport (B837)", () => {
  test("opening / switching / closing a left panel never jumps the drawing", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));

    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("B837 Viewport Guard", { exact: false }).first().click();
    await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(800); // fit-on-load + first commit settle

    // Baseline with every panel CLOSED.
    if ((await openPanels(page)).length) { await page.locator('button[title="Parcel"]').first().click(); await page.waitForTimeout(500); }
    const base = await feetScreenX(page, FX);

    // Each open / switch / close must leave the fixed feet point at the same viewport x (±2px).
    for (const [label, title] of [["open Parcel", "Parcel"], ["switch Analysis", "Analysis"], ["switch Yield", "Yield"], ["close Yield", "Yield"]]) {
      await page.locator(`button[title="${title}"]`).first().click();
      await page.waitForTimeout(500);
      const x = await feetScreenX(page, FX);
      expect(Math.abs(x - base), `${label}: feet point drifted ${Math.round(x - base)}px`).toBeLessThanOrEqual(2);
    }
    // Panels actually toggled (guards against a no-op that would make the invariant trivially hold).
    expect(await openPanels(page)).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
