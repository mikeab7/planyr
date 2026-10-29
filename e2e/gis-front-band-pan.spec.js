/* NEW-1 — a GIS layer LIFTED above the plan ("Draw above plan") stays glued to the basemap WHILE the map is dragged.
 *
 * The owner's report: the FEMA flood zones "move separately from the basemap" while he drags. Measured on the real planner: the lifted
 * area band is hosted INSIDE the plan SVG (a foreignObject under `<g transform={panT}>`), and during a pan that group carries the live
 * pan delta — while the host ALSO carries the basemap wrapper's mirrored gesture transform. Both moved it, so a lifted layer slid at
 * TWICE the pan speed until release (up to 9.5 px on a 60 px drag, unbounded on a long one), then snapped back.
 *
 * THE ORACLE, in a spec: the line-role band (hosted OUTSIDE the SVG, only ever moved by the mirrored transform) is glued by
 * construction, so during a held drag the lifted band's image must have moved by the SAME vector as the line band's image. Both are
 * FEMA exports from the same service, so one stubbed export serves both. Main-thread geometry is the right instrument HERE (a CSS
 * transform difference shows in getBoundingClientRect exactly) — the composited-frame proof is ui-audit/measure-layer-pan-slide.mjs --above.
 * Red on the pre-fix build (the lifted band moves 2× the line band), green after. */
import { test, expect } from "@playwright/test";
import { openPlannerLayers, setLayer, openRowMenu } from "./lib/layersPanel.js";

const SITE = {
  schemaVersion: 12, id: "gis-front-pan", groupId: "gis-front-pan", site: "Front Band Pan Guard", name: "Front Band Pan Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null, origin: { lat: 29.6232, lon: -95.624 }, county: "fortbend", status: "active",
  parcels: [], underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};
// a 1×1 transparent PNG — the export only has to LOAD; its geometry is the layer's, not the picture's
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("a lifted FEMA band follows the pan at the basemap's speed, not twice it", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (/\/export$/.test(u.pathname)) return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "image/png", body: PNG });
    if (/NFHL/i.test(u.href) || /\/(MapServer|FeatureServer)\//i.test(u.href)) return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ name: "NFHL", layers: [{ id: 27 }, { id: 28 }] }) });
    if (/\.(jpg|jpeg)(\?|$)/i.test(u.pathname)) return r.abort();
    return r.continue();
  });
  await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Front Band Pan Guard", { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1200);

  await openPlannerLayers(page);
  await setLayer(page, "fema", true);
  const menu = await openRowMenu(page, "fema");
  await menu.locator('[data-part="above"] input[type="checkbox"]').check({ force: true });
  await page.waitForTimeout(2500);

  // where the two bands' images sit, by pane — the lifted fill band and the (never lifted) boundary band
  const sample = () => page.evaluate(() => {
    // scoped to the PLANNER's hosts: the map finder keeps its own copy of every pane behind it
    const svg = document.querySelector('[data-testid="planner-canvas"]'); const wrap = svg.parentElement;
    const front = svg.querySelector(".leaflet-gisAreaFront-pane img.leaflet-image-layer"), line = [...wrap.children].map((c) => c.querySelector(".leaflet-gisLine-pane img.leaflet-image-layer")).find(Boolean);
    const pos = (i) => { if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.left, y: r.top }; };
    return { front: pos(front), line: pos(line) };
  });
  const before = await sample();
  expect(before.front, "the lifted band's image is not on the page — the fixture proves nothing").not.toBeNull();
  expect(before.line, "the line band's image is not on the page — the fixture proves nothing").not.toBeNull();

  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.mouse.move(box.x + 160, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160 + 120, box.y + box.height / 2 + 40, { steps: 12 });
  await page.waitForTimeout(60); // one gesture frame, button STILL DOWN — the settle commit (160 ms) has not fired
  const mid = await sample();
  await page.mouse.up();

  const d = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const moveFront = d(mid.front, before.front), moveLine = d(mid.line, before.line);
  expect(Math.abs(moveLine.x), "the drag did not move the basemap's band — the fixture proves nothing").toBeGreaterThan(40);
  expect(Math.abs(moveFront.x - moveLine.x), `lifted band moved ${moveFront.x.toFixed(1)} px, the basemap ${moveLine.x.toFixed(1)} px`).toBeLessThan(1.5);
  expect(Math.abs(moveFront.y - moveLine.y), `lifted band moved ${moveFront.y.toFixed(1)} px, the basemap ${moveLine.y.toFixed(1)} px`).toBeLessThan(1.5);
  expect(errors, errors.join(" | ")).toHaveLength(0);
});
