/* B1933584 — owner report 2026-09-28, verbatim: "the fema floodplain layer is showing up on
 * map view when I zoom in even though its not selected."
 *
 * ROOT CAUSE (see lib/layers.js's `releaseOverlayRef` header + test/mapFinderOverlayLeak.test.js
 * for the full derivation): MapFinder.jsx keeps its Leaflet map alive while the Map view is
 * hidden (`display:none`, never unmounted — the Plan view is its sibling), and used to hand
 * overlay memory back while hidden by calling `tileLifecycle.releaseLayer` DIRECTLY on
 * `overlayRefs.current[key]`. For a ROLE-SPLIT layer (FEMA's `roleLayers`) that ref is a plain
 * `{__pfParts, setOpacity}` composite object, never itself added to the Leaflet map — so
 * `releaseLayer` was a silent no-op on it, and FEMA's TWO real esri-leaflet layers stayed fully
 * attached, still wired to `moveend`, with nothing left anywhere that referenced them once
 * `overlayRefs.current.fema` was deleted. They keep painting the next time the map is
 * interacted with, checkbox unchecked or not.
 *
 * This drives the REAL app, logged out, with FEMA's `?f=json` metadata probe + its `/export`
 * image stubbed at the network boundary (the sandbox cannot reach `hazards.fema.gov`, and a spec
 * that depends on a live federal service is a flaky spec anyway — same pattern as
 * e2e/layer-point-hover-identify.spec.js's B1490144 describe block). The scenario exactly
 * reproduces the sequence that leaks the layer:
 *   1. turn FEMA on while on the MAP view (an export request fires — the layer paints);
 *   2. open a project's PLANNER (the Map view becomes hidden — display:none, not unmounted);
 *   3. turn FEMA OFF from the planner's OWN Layers panel (the shared `overlays` state this
 *      surface's checkbox lives in);
 *   4. return to the MAP view and interact with it (zoom in — the real UI control, not a
 *      synthetic event) — a further export request firing here, with the checkbox reading
 *      UNCHECKED, IS the reported symptom.
 *
 * Two independent proofs, either one of which is enough to convict the pre-fix build:
 *   (a) network — no FURTHER `/export` request to hazards.fema.gov fires after the return-to-map
 *       interaction;
 *   (b) the read-only diagnostic this item also ships (`window.__mapOverlayAudit()`,
 *       MapFinder.jsx, gated by isDiagArmed/`window.__PLANYR_E2E`) reports zero orphaned layers.
 */
import { test, expect } from "@playwright/test";

// Katy / west Houston — the same real, FEMA-covered fixture point layer-point-hover-identify.spec.js uses.
const LAT = 29.7858, LON = -95.8244;
const SITE = {
  schemaVersion: 12, id: "bpending-fema-leak", groupId: "bpending-fema-leak",
  site: "FEMA Overlay Leak", name: "FEMA Overlay Leak",
  updatedAt: 1787000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "harris", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};

// A minimal, valid 1x1 transparent PNG — enough for esri-leaflet's <img> to fire a real 'load'.
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

/* Stubs BOTH of FEMA's live legs (the `?f=json` health probe `probeService` reads, and the
 * `/export` image `f:"image"` mode requests directly with no XHR in between). Returns the array
 * of export request timestamps the test polls — its LENGTH is the whole assertion. */
async function stubFema(page) {
  const exportHits = [];
  const answer = async (route) => {
    const url = route.request().url();
    if (/\/export\b/i.test(url)) {
      exportHits.push(Date.now());
      // esri-leaflet requests the export <img> with crossOrigin="anonymous" (Support.js `cors`),
      // matching layers.js's own documented note that the real FEMA host is CORS-clean on both
      // /export and ?f=json — without this header the browser fires the <img>'s onerror instead
      // of onload even though the bytes arrived fine, which is a stub-fidelity gap, not the bug.
      await route.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: PNG_1PX });
    } else if (/\?f=json|\/\?f=json/i.test(url)) {
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ currentVersion: 11.1, mapName: "NFHL", capabilities: "Map,Query,Identify" }) });
    } else {
      await route.abort();
    }
  };
  await page.route("**hazards.fema.gov/**", answer);
  /* B445's same-origin cache proxy (`gisProxyEnabled()` defaults ON) fronts the direct URL above —
   * this app's real deploy runs it as a Cloudflare Pages Function, which this local `vite preview`
   * server does not serve, so an unstubbed `/api/gis-cache/**` request would hit the SPA's own
   * catch-all and come back as `index.html` (200, but not an image or JSON) — a test-environment
   * artefact that has nothing to do with the bug under test, and that trips a genuine but SEPARATE,
   * pre-existing esri-leaflet defect (`RasterLayer._renderImage`'s `onOverlayError` dereferences
   * `this._map` with no null-check, unlike its own `onOverlayLoad` beside it) once the proxy→direct
   * fallback swap this app's own metadata health-check triggers removes the still-in-flight proxy
   * layer. Answering the proxy path exactly like the direct one keeps this spec about the ONE thing
   * it is testing. */
  await page.route("**/api/gis-cache/**", answer);
  return exportHits;
}

async function openMapWithSeededSite(page) {
  await page.route(/\.(jpg|jpeg|webp)(\?|$)/, (route) => route.abort()); // no aerial tiles in the sandbox
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript((s) => {
    try {
      localStorage.removeItem("planarfit:currentSite:v1");
      localStorage.setItem("planarfit:sites:v1", s);
    } catch (_) {}
  }, JSON.stringify({ [SITE.id]: SITE }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200); // let the Leaflet map + initial layer probes settle
}

async function openFloodGroup(page) {
  const groupHead = page.getByRole("button", { name: /(Show|Hide) Flood & drainage layers/ }).filter({ visible: true }).first();
  await expect(groupHead).toBeVisible({ timeout: 10_000 });
  if ((await groupHead.getAttribute("aria-expanded")) === "false") await groupHead.click();
}

/* The Map view's own Layers panel is titled "Imagery & layers" — a different control from the
 * planner's "Layers" button (both render the SAME shared LayerPanel component; only the
 * disclosure trigger's own label differs between the two surfaces). */
async function toggleFemaOnMap(page) {
  const btn = page.getByRole("button", { name: /Imagery.{0,3}layers/i }).filter({ visible: true }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  if ((await btn.getAttribute("title")) === "Collapse layers") { /* already open */ } else { await btn.click(); }
  await openFloodGroup(page);
  const cb = page.getByRole("checkbox", { name: "FEMA flood zones", exact: true }).filter({ visible: true }).first();
  await expect(cb).toBeVisible({ timeout: 10_000 });
  await cb.click();
  return cb;
}

/* Read the planner's OWN FEMA checkbox, opening its Layers panel + the Flood group first. Used
 * only to CONFIRM the state, never to toggle it here — see the note at the call site below for
 * why opening a fresh project already turns FEMA off without any click of ours. */
async function readFemaCheckedOnPlanner(page) {
  const btn = page.getByRole("button", { name: /^Layers/ }).filter({ visible: true }).first();
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await openFloodGroup(page);
  const cb = page.getByRole("checkbox", { name: "FEMA flood zones", exact: true }).filter({ visible: true }).first();
  await expect(cb).toBeVisible({ timeout: 10_000 });
  return cb.isChecked();
}

test.describe("B1933584 — a role-split layer (FEMA) turned off does not keep painting on the Map view", () => {
  test("toggle FEMA on the Map view, turn it off from the Plan view, return to Map, zoom — no further FEMA paint, no orphan", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const exportHits = await stubFema(page);

    await openMapWithSeededSite(page);
    await toggleFemaOnMap(page);
    await expect.poll(() => exportHits.length, { timeout: 8_000, message: "FEMA never painted on the Map view after being turned on" }).toBeGreaterThan(0);
    const paintedOnMap = exportHits.length;

    // Step 2 — open the seeded project's planner. MapFinder becomes hidden (display:none) AND
    // SitePlanner's own per-site "restore Layers-panel state on mount" effect (SitePlanner.jsx,
    // documented in this workspace's CLAUDE.md under "Per-site GIS Layers-panel toggle memory")
    // REPLACES the shared `overlays` with this site's own saved set — this seeded site never
    // saved a FEMA override, so the shared state's `fema.on` becomes false right here, with NO
    // click of ours needed. That is itself the "turn FEMA off" step: from the shared state's own
    // point of view it is indistinguishable from the user unchecking it, and it is what most
    // directly matches how a session opening ANY project after leaving FEMA on the Map view would
    // trip this — no explicit uncheck required.
    await page.getByText("FEMA Overlay Leak", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(900);
    expect(await readFemaCheckedOnPlanner(page), "the freshly-opened project's Layers panel still shows FEMA on — the restore-on-mount reset this test relies on did not happen").toBe(false);
    await page.waitForTimeout(600); // let the hidden-view teardown effect (MapFinder) run

    // Step 4 — return to the Map view and interact with it for real (zoom in via the map's own
    // control — never a synthetic event; the leaked layers are wired to Leaflet's real moveend).
    const crumb = page.locator('[data-testid="dashboard-crumb"]:visible');
    await expect(crumb).toBeVisible({ timeout: 15_000 });
    await crumb.click();
    await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    const beforeInteract = exportHits.length;
    const zoomIn = page.locator(".leaflet-control-zoom-in:visible").first();
    await expect(zoomIn).toBeVisible({ timeout: 10_000 });
    await zoomIn.click();
    await page.waitForTimeout(400);
    await zoomIn.click();
    await page.waitForTimeout(1500); // let any leaked layer's moveend → _update() → export settle

    // PROOF (a) — network: nothing further painted from FEMA after the toggle-off + return.
    expect(exportHits.length, "a FURTHER FEMA export request fired after the layer was toggled " +
      "off and the Map view revisited — the orphaned role-split layer is still wired to moveend").toBe(beforeInteract);
    expect(paintedOnMap, "FEMA never painted in the first place — the setup itself is broken").toBeGreaterThan(0);

    // The checkbox itself must read unchecked on the (now visible again) Map Layers panel.
    const mapCb = page.getByRole("checkbox", { name: "FEMA flood zones", exact: true }).filter({ visible: true }).first();
    await expect(mapCb).not.toBeChecked();

    // PROOF (b) — the read-only diagnostic this item ships: no tracked-nothing orphan remains.
    const audit = await page.evaluate(() => (window.__mapOverlayAudit ? window.__mapOverlayAudit() : null));
    expect(audit, "window.__mapOverlayAudit is not installed on the Map view").not.toBeNull();
    expect(audit.orphans, JSON.stringify(audit.orphans)).toEqual([]);
    expect(audit.orphanCount).toBe(0);

    expect(errors, errors.join(" | ")).toHaveLength(0);
  });
});
