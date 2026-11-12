/* NEW-2 (2026-11-12) — "Cannot read properties of undefined (reading '_leaflet_pos')", stack
 * `getPosition → _getMapPanePos → layerPointToContainerPoint → latLngToContainerPoint ← zoomTracker frame ← adminBoundaryLayer`
 * (2 users, 2026-10-28 / 10-30; not seen in the 7 days to 2026-11-12).
 *
 * Leaflet's map.remove() DELETES `map._mapPane`. The state-outline layer draws from a queued animation frame, so a frame that
 * was already queued when the map was torn down (a plan switch, the map unmounting under a keep-alive host) projected through
 * a map with no pane and threw. The zoom tracker now says whether the map is alive (`tracker.alive`) and the frame detaches
 * the layer instead of projecting. This reproduces the order directly: let the layer attach on the wide map, draw once (the
 * known-good arm — the layer DOES draw while the map is alive), tear the map down, then run the queued frame.
 * Red on 2b1e4b7 (the frame threw `_leaflet_pos`). */
import { test, expect } from "@playwright/test";

test("a state-outline frame that runs after its map was removed detaches quietly instead of throwing", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  await page.addInitScript(() => { try { window.__PLANYR_E2E = true; } catch (_) {} });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
  await page.evaluate(() => window.__mapFinderMap.setView([31, -97], 6, { animate: false }));
  await page.waitForFunction(() => { const p = document.querySelector(".leaflet-adminboundaries-pane"); return !!(p && p.__adminBoundaries); }, null, { timeout: 30000 });

  // known-good arm: while the map is alive the layer draws and nothing throws
  const drew = await page.evaluate(async () => {
    const pane = document.querySelector(".leaflet-adminboundaries-pane");
    await new Promise((r) => setTimeout(r, 1500));            // geometry assets load
    pane.__adminBoundaries.drawSync(performance.now());
    return pane.dataset.levels || "";
  });
  expect(drew, "the layer draws on a live map (else the run is VOID)").not.toBe("");
  expect(errors, `errors while the map was alive: ${errors.join(" | ")}`).toEqual([]);

  // the race: the frame is queued, THEN the map goes away
  const stillThere = await page.evaluate(async () => {
    const map = window.__mapFinderMap;
    const pane = document.querySelector(".leaflet-adminboundaries-pane");
    const ctl = pane.__adminBoundaries;
    ctl.sync();                   // queue a frame
    map.remove();                 // Leaflet deletes map._mapPane
    await new Promise((r) => setTimeout(r, 400));   // the queued frame runs
    return typeof map._mapPane;
  });
  expect(stillThere, "the map really lost its pane (the precondition of the race)").toBe("undefined");
  expect(errors.filter((m) => /_leaflet_pos/.test(m)), `page errors: ${errors.join(" | ")}`).toEqual([]);
});
