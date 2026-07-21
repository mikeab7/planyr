/* A docked-panel / left-rail toggle must NOT disturb the aerial backdrop (B933).
 *
 * Owner report (after B821 + B837 shipped and were live): "clicking between elements and parcels
 * and menus makes the screen flash a ton." Root cause traced in code:
 *
 *   click → a docked panel / left-rail column docks as an in-flow flex sibling → the canvas shrinks
 *   → ResizeObserver → the basemap view-sync effect's `sizeChanged` branch ran, which B837 had made
 *   ALWAYS `spawnGhost()` (a full `wrap.cloneNode(true)` of the Leaflet tile layer) before re-syncing.
 *   That ghost freezes the aerial at its PRE-shift position on top of the real map, then drops it up
 *   to 5 s later — so on every click the aerial visibly sits off-position and then snaps back. (The
 *   `setView` itself does NOT wipe here: Leaflet converts a same-zoom, in-viewport re-center into an
 *   internal panBy, so `viewprereset` never fires on a toggle — the flash is the ghost, not a wipe.)
 *
 * B933 fixes it at the source: a same-zoom re-center now moves with `map.panBy` and spawns NO ghost.
 * The ghost is reserved for a genuine ZOOM change (where `setView` really does wipe and the B65 ghost
 * is the right mask). This spec proves the fix headlessly — no real tiles needed — by counting the
 * ghost clones appended to the map's clip during a full open / switch / switch / close cycle: it must
 * be ZERO. (Pre-B933 each resize appended one.) The map is exposed on `window.__geoMap` only under
 * `window.__PLANYR_E2E`, a hook that never runs in production.
 */
import { test, expect } from "@playwright/test";

const SITE = {
  schemaVersion: 12, id: "b933-flash", groupId: "b933-flash",
  site: "B933 Flash Guard", name: "B933 Flash Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 29.7604, lon: -95.3698 }, county: "Harris", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};

const openPanels = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="panel-chrome-"]'))
    .map((e) => e.getAttribute("data-testid")).filter((t) => /^panel-chrome-[a-z]+$/.test(t)));

// Watch the map's clip (parent of the Leaflet container) for appended nodes. Every B65 `spawnGhost`
// clones the tile layer and appends it there; a panBy appends nothing. Returns a getter for the count.
async function armGhostWatch(page) {
  await page.waitForFunction(() => !!(window.__geoMap && window.__geoMap._container && window.__geoMap._container.parentElement), null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__ghosts = 0;
    const clip = window.__geoMap._container.parentElement;
    const base = window.__geoMap._container;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n !== base) window.__ghosts += 1; // any appended element = a ghost clone
      }
    }).observe(clip, { childList: true });
  });
}
const ghostCount = (page) => page.evaluate(() => window.__ghosts | 0);

test.describe("panel toggle aerial flash (B933)", () => {
  test("opening / switching / closing a left panel spawns no aerial ghost", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => { window.__PLANYR_E2E = true; });
    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));

    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("B933 Flash Guard", { exact: false }).first().click();
    await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1000); // fit-on-load + first crisp commit settle

    // Begin with every panel CLOSED, THEN arm the watcher — so first-paint commits aren't counted.
    if ((await openPanels(page)).length) { await page.locator('button[title="Parcel"]').first().click(); await page.waitForTimeout(600); }
    await armGhostWatch(page);

    // A full open / switch / switch / close cycle. Each step resizes the in-flow canvas. Post-B933
    // a same-zoom re-center pans (no ghost); the whole cycle must append ZERO ghost clones.
    for (const title of ["Parcel", "Analysis", "Yield", "Yield"]) {
      await page.locator(`button[title="${title}"]`).first().click();
      await page.waitForTimeout(500); // let the debounced (~160ms) commit fire too
    }
    await page.waitForTimeout(400);

    const ghosts = await ghostCount(page);
    expect(await openPanels(page)).toEqual([]); // panels really toggled (guards a trivially-passing no-op)
    expect(ghosts, `aerial ghost clone spawned ${ghosts}× during the panel cycle (expected 0 — a same-zoom re-center must panBy, not ghost+setView)`).toBe(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
