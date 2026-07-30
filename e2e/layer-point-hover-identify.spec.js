/* NEW-1 + NEW-2 — "the electric layer paints real symbols, and hovering one says what it is."
 *
 * THE REPORT. The owner turned the Electric layer on (overhead lines, substations, poles) over an
 * aerial and got two things wrong at once:
 *   1. broken-image icons labelled "Mark" standing where the substations should be, and
 *   2. no way to hover a line or a substation to find out what it is.
 *
 * (1) was Leaflet's documented default for a GeoJSON POINT with no `pointToLayer`: `L.marker`
 * wearing `L.Icon.Default`, whose PNG never resolved under the bundler, so the browser painted its
 * broken-image glyph plus the marker's alt text — the string "Marker", clipped by the icon box to
 * read "Mark". (2) was `interactive: false` and no tooltip on the esri feature layers.
 *
 * This spec drives the REAL planner LOGGED OUT with the HIFLD services STUBBED at the network
 * boundary — the sandbox's egress proxy blocks the agency hosts, and a spec that depends on a live
 * federal service is a flaky spec anyway. What it proves is exactly what the report is about:
 * a point paints as a circleMarker (never a marker image), no broken-image glyph or "Marker" alt
 * text exists anywhere on the map, and hovering a substation or a transmission line opens a readout
 * that NAMES it — for the vector path AND the raster path — which clears when the cursor moves off.
 *
 * The planner (not the map finder) is the surface under test on purpose: its backdrop Leaflet map is
 * pointer-events:none, so a Leaflet mouseover can never fire there. It is the harder of the two
 * surfaces and the one a site is actually worked on.
 */
import { test, expect } from "@playwright/test";

// Katy / west Houston — real transmission-and-substation country.
const LAT = 29.7858, LON = -95.8244;
const SITE = {
  schemaVersion: 12, id: "new1-point-symbols", groupId: "new1-point-symbols",
  site: "NEW-1 Point Symbols", name: "NEW-1 Point Symbols",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "harris", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};

/* esri-leaflet asks a FeatureServer layer for its metadata first (to learn the geometry type and
 * whether geoJSON is supported), then issues /query. `probeService` also reads `?f=json`. One route
 * serves all three by branching on the path. */
const metadata = (geometryType, name) => ({
  currentVersion: 11.1, id: 0, name, type: "Feature Layer",
  geometryType, objectIdField: "OBJECTID",
  supportedQueryFormats: "JSON, geoJSON",
  capabilities: "Query",
  extent: { xmin: -130, ymin: 20, xmax: -60, ymax: 55, spatialReference: { wkid: 4326, latestWkid: 4326 } },
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  advancedQueryCapabilities: { supportsPagination: true },
});

/* Every fixture sits INSIDE the planner's fitted view (the 1320 ft parcel ≈ 0.0042° of longitude
 * here), because esri-leaflet queries a FeatureServer by the map's current bbox — a feature outside
 * the view is never fetched, so it could never be hovered.
 *
 * The transmission line runs NORTH-SOUTH at its own longitude, rather than east-west through the
 * substations' latitude: the hover identify returns the FIRST layer that hits, so overlapping
 * targets would make "which feature answered" the variable under test instead of the wording. */
/* The parcel runs EAST and SOUTH from the origin (0.00416° of longitude × 0.00361° of latitude for
 * its 1320 ft sides at this latitude). Fixtures go in its INTERIOR, not along its northern edge:
 * the planner's floating panels overlay the top strip of the canvas, and a hover point underneath
 * one never reaches the SVG at all — which is a fixture-placement artefact, not a product defect. */
const SUB_B_DLAT = -0.0018; // ≈ 650 ft south of the origin — clear of the top-edge panel overlay
const SUB_B_DLON = 0.0030;  // ≈ 950 ft east, and ~140 px clear of the transmission line
const TX_DLON = 0.0012;     // ≈ 380 ft east — its own longitude, so it never overlaps a substation
const TX_LON = LON + TX_DLON;

const SUBSTATION_FC = {
  type: "FeatureCollection",
  features: [{
    type: "Feature", id: 1,
    geometry: { type: "Point", coordinates: [LON, LAT] },
    // NAME real, MAX_VOLTAG real — plus a second point whose attributes are REDACTED the way
    // HIFLD actually redacts them, to prove a withheld record still names its KIND.
    properties: { OBJECTID: 1, NAME: "Addicks", MAX_VOLTAG: 138, CITY: "Houston" },
  }, {
    type: "Feature", id: 2,
    geometry: { type: "Point", coordinates: [LON + SUB_B_DLON, LAT + SUB_B_DLAT] },
    properties: { OBJECTID: 2, NAME: "UNKNOWN30271", MAX_VOLTAG: 0, CITY: "NOT AVAILABLE" },
  }],
};

/* Only a REDACTED record, placed at the origin. Its own collection rather than a second point in
 * SUBSTATION_FC, so the hover target is the coordinate already proven to be open canvas — which
 * keeps this test about the WORDING of a withheld record, not about panel geometry. */
const REDACTED_ONLY_FC = {
  type: "FeatureCollection",
  features: [{
    type: "Feature", id: 1,
    geometry: { type: "Point", coordinates: [LON, LAT] },
    properties: { OBJECTID: 1, NAME: "UNKNOWN30271", MAX_VOLTAG: 0, CITY: "NOT AVAILABLE" },
  }],
};

const TRANSMISSION_FC = {
  type: "FeatureCollection",
  features: [{
    type: "Feature", id: 1,
    geometry: { type: "LineString", coordinates: [[TX_LON, LAT - 0.02], [TX_LON, LAT + 0.02]] },
    properties: { OBJECTID: 1, VOLTAGE: 138, OWNER: "CenterPoint Energy" },
  }],
};

/* GeoJSON → Esri JSON. esri-leaflet issues its FIRST queries with `f=json`, before the layer's
 * metadata (which is what tells it geoJSON is supported) has landed — so a stub that only ever
 * answers GeoJSON makes those early attempts unparseable, the layer burns its retry budget and
 * reports "failed". Answering in whichever format was actually asked for is what makes this stub
 * behave like a real service. */
const toEsriJson = (fc, geometryType) => ({
  objectIdFieldName: "OBJECTID",
  geometryType,
  spatialReference: { wkid: 4326, latestWkid: 4326 },
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  features: fc.features.map((f) => ({
    attributes: f.properties,
    geometry: f.geometry.type === "Point"
      ? { x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] }
      : { paths: [f.geometry.coordinates] },
  })),
});

async function stubElectric(page, { substations = SUBSTATION_FC } = {}) {
  const serve = (fc, geometryType, name) => async (route) => {
    const url = route.request().url();
    if (!/\/query\b/i.test(url)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(metadata(geometryType, name)) });
      return;
    }
    const wantsGeoJson = /[?&]f=geojson\b/i.test(url);
    const body = wantsGeoJson ? fc : toEsriJson(fc, geometryType);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  };
  // HIFLD substations (points) and the DOE/NETL transmission lines.
  await page.route("**services.arcgis.com/**Electric_Substations**", serve(substations, "esriGeometryPoint", "Electric Substations"));
  await page.route("**arcgis.netl.doe.gov/**", serve(TRANSMISSION_FC, "esriGeometryPolyline", "Transmission Lines"));
  // The OSM member of the same merged row would fire a live Overpass call; keep it quiet so the
  // assertions are about the HIFLD layers under test.
  await page.route("**overpass**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elements: [] }) }));
  // No aerial tiles in the sandbox; stop them retrying noisily.
  await page.route("**/*.jpg", (route) => route.abort());
  await page.route("**/*.jpeg", (route) => route.abort());
}

async function openPlanner(page, site = SITE) {
  // Arms the backdrop-map handle (window.__geoMap) the projection helper below needs. A hook that
  // never runs in production — it is gated on this flag.
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [site.id]: site }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText(site.name, { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(900); // fit-on-load + first view commit settle
}

/* Turn a Layers-panel row on by its VISIBLE checkbox. Both hosts stay mounted (the shell hides the
 * inactive one with display:none to keep its map alive), so the DOM holds two copies of this panel
 * — target the visible one by role, never `.first()` on a text node. */
async function toggleLayer(page, name) {
  await page.getByRole("button", { name: /Layers/ }).first().click();
  const row = page.getByRole("checkbox", { name }).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
}

// Feet → viewport client px, off the canvas transform seam the planner publishes.
async function feetToScreen(page, fx, fy) {
  return page.evaluate(([f, g]) => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const offX = parseFloat(svg.getAttribute("data-view-offx"));
    const offY = parseFloat(svg.getAttribute("data-view-offy"));
    const ppf = parseFloat(svg.getAttribute("data-view-ppf"));
    const vb = svg.getAttribute("viewBox").split(" ").map(Number);
    const r = svg.getBoundingClientRect();
    return {
      x: r.left + ((f * ppf + offX) / vb[2]) * r.width,
      y: r.top + ((g * ppf + offY) / vb[3]) * r.height,
    };
  }, [fx, fy]);
}

/* lat/lng → viewport client px, via the backdrop Leaflet map the planner publishes on
 * window.__geoMap. The stubbed features are defined in lat/lng, so this is how a hover lands on
 * one regardless of where the canvas's foot origin happens to sit on screen. */
async function lngLatToScreen(page, lat, lng) {
  return page.evaluate(([la, ln]) => {
    const m = window.__geoMap;
    if (!m) return null;
    const p = m.latLngToContainerPoint([la, ln]);
    const r = m.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
}

/* THE ITEM-1 ASSERTION, in the DOM, as the brief specifies: no broken default marker anywhere. */
async function expectNoBrokenMarkers(page) {
  const bad = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")];
    return {
      // Leaflet's default marker images, by src.
      defaultIconSrc: imgs.filter((i) => /marker-icon|marker-shadow/i.test(i.getAttribute("src") || "")
        && !/^data:/.test(i.getAttribute("src") || "")).length,
      // Leaflet's default marker alt text — the "Mark" the owner saw was this string clipped.
      markerAlt: document.querySelectorAll('[alt="Marker"]').length,
      // Any image that FAILED to load (a broken-image glyph is a decoded-size-zero <img>).
      broken: imgs.filter((i) => i.complete && i.naturalWidth === 0 && (i.getAttribute("src") || "") !== "").length,
      // Leaflet only creates a marker pane child for an L.Marker; a circleMarker lives in the
      // overlay pane as SVG. Zero marker-pane images means zero icon markers were built.
      markerPaneImgs: document.querySelectorAll(".leaflet-marker-pane img").length,
    };
  });
  expect(bad.defaultIconSrc, "an <img> is pointing at Leaflet's unresolved default marker PNG").toBe(0);
  expect(bad.markerAlt, 'a default marker exists (alt="Marker") — this is the owner\'s "Mark" glyph').toBe(0);
  expect(bad.broken, "an <img> on the page failed to load (broken-image glyph)").toBe(0);
  expect(bad.markerPaneImgs, "an icon marker was built where a circleMarker symbol was expected").toBe(0);
}

test.describe("electric layer point symbols + hover identify (NEW-1/NEW-2)", () => {
  test("substation POINTS paint as circleMarkers, never a broken default marker", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await stubElectric(page);
    await openPlanner(page);

    await toggleLayer(page, /^Electric/);
    await page.waitForTimeout(2500); // metadata + query + paint

    // The points are actually on the map, and every one of them is a CircleMarker.
    const shapes = await page.evaluate(() => {
      const m = window.__geoMap;
      if (!m) return null;
      /* Duck-typed, not `instanceof`: leaflet is an ESM import inside the bundle, so there is no
       * `window.L` to compare against. A CircleMarker is the only layer with getRadius; an icon
       * Marker is the only one with setIcon. That distinction is exactly what is under test. */
      const isCircleMarker = (l) => typeof l.getRadius === "function" && typeof l.getLatLng === "function";
      const isIconMarker = (l) => typeof l.setIcon === "function";
      const out = { circleMarkers: 0, iconMarkers: 0, paths: 0 };
      const walk = (layer) => {
        if (!layer) return;
        if (isCircleMarker(layer)) { out.circleMarkers += 1; return; }
        if (isIconMarker(layer)) { out.iconMarkers += 1; return; }
        if (typeof layer.eachLayer === "function") { layer.eachLayer(walk); return; }
        if (typeof layer.getLatLngs === "function") out.paths += 1;
      };
      m.eachLayer(walk);
      return out;
    });
    expect(shapes, "window.__geoMap not exposed — cannot inspect the painted layers").not.toBeNull();
    // Two stubbed substation points → two circleMarkers. Before the fix these were L.Markers
    // wearing an unresolvable L.Icon.Default.
    expect(shapes.circleMarkers, "substation points did not paint as circleMarkers").toBeGreaterThanOrEqual(2);
    expect(shapes.iconMarkers, "a point painted as an ICON marker (the broken-image path)").toBe(0);

    await expectNoBrokenMarkers(page);
    expect(errors, errors.join(" | ")).toHaveLength(0);
  });

  test("hovering a SUBSTATION names it — and moving off dismisses the readout", async ({ page }) => {
    await stubElectric(page);
    await openPlanner(page);
    await toggleLayer(page, /^Electric/);
    await page.waitForTimeout(2500);

    const readout = page.getByTestId("gis-identify-hover");
    await expect(readout).toHaveCount(0); // nothing showing before the hover

    const at = await lngLatToScreen(page, LAT, LON);
    expect(at, "could not project the substation to screen").not.toBeNull();
    await page.mouse.move(at.x, at.y);
    await expect(readout).toBeVisible({ timeout: 6000 });
    // The wording matches the OSM tooltip beside it in the same merged row, and carries the
    // facts the brief asks for: what it is, its voltage, and who published it.
    await expect(readout).toContainText("Substation (HIFLD)");
    await expect(readout).toContainText("Addicks");
    await expect(readout).toContainText("138 kV");

    // Moving well off the feature dismisses it — a hover readout, not a sticky card.
    const off = await feetToScreen(page, 1250, 1250);
    await page.mouse.move(off.x, off.y);
    await expect(readout).toHaveCount(0, { timeout: 6000 });
  });

  test("a REDACTED substation still says what KIND of thing it is", async ({ page }) => {
    await stubElectric(page, { substations: REDACTED_ONLY_FC });
    await openPlanner(page);
    await toggleLayer(page, /^Electric/);
    await page.waitForTimeout(2500);

    const at = await lngLatToScreen(page, LAT, LON);
    await page.mouse.move(at.x, at.y);
    const readout = page.getByTestId("gis-identify-hover");
    await expect(readout).toBeVisible({ timeout: 6000 });
    await expect(readout).toContainText("Substation (HIFLD)");
    // A withheld attribute is ABSENCE, never a fact: no anonymised code, no zero voltage.
    await expect(readout).not.toContainText("UNKNOWN");
    await expect(readout).not.toContainText("NOT AVAILABLE");
    await expect(readout).not.toContainText("0 kV");
  });

  test("hovering a TRANSMISSION LINE names it with its voltage and owner", async ({ page }) => {
    await stubElectric(page);
    await openPlanner(page);
    await toggleLayer(page, /^Electric/);
    await page.waitForTimeout(2500);

    const at = await lngLatToScreen(page, LAT + SUB_B_DLAT, TX_LON);
    await page.mouse.move(at.x, at.y);
    const readout = page.getByTestId("gis-identify-hover");
    await expect(readout).toBeVisible({ timeout: 6000 });
    await expect(readout).toContainText("Transmission line (HIFLD)");
    await expect(readout).toContainText("138 kV");
    await expect(readout).toContainText("CenterPoint Energy");
  });

  /* THE RASTER PATH. Half the registry paints as a server-rendered picture with no features in the
   * DOM at all, so it can only answer by asking the service. FEMA is the canonical one. */
  test("hovering a RASTER-painted layer identifies it through the service", async ({ page }) => {
    await stubElectric(page);
    let identifyCalls = 0;
    await page.route("**/MapServer/identify**", async (route) => {
      identifyCalls += 1;
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ results: [{ layerName: "Flood Hazard Zones", value: "AE", attributes: { FLD_ZONE: "AE", STATIC_BFE: 102.4 } }] }),
      });
    });
    // Keep the raster export image itself from hanging the layer's status wiring.
    await page.route("**/MapServer/export**", (route) => route.abort());
    await page.route("**/MapServer?f=json**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ currentVersion: 11.1, mapName: "Layers", capabilities: "Map,Query,Identify" }) }));

    await openPlanner(page);
    await toggleLayer(page, /FEMA flood zones/i);
    await page.waitForTimeout(2000);

    const at = await feetToScreen(page, 400, 400);
    await page.mouse.move(at.x, at.y);
    const readout = page.getByTestId("gis-identify-hover");
    await expect(readout).toBeVisible({ timeout: 8000 });
    // The service's own answer, named — the same shape the vector tooltips use.
    await expect(readout).toContainText(/Flood Hazard Zones|AE/);
    expect(identifyCalls, "no /identify request was made for the raster layer").toBeGreaterThan(0);
  });

  /* FAILURE BEHAVIOUR. The brief is explicit: never a spinner that never resolves, and never a
   * silent nothing that reads as a dead layer. */
  test("an unreachable identify service says so, briefly — never a hanging spinner", async ({ page }) => {
    await stubElectric(page);
    await page.route("**/MapServer/identify**", (route) => route.abort("failed"));
    await page.route("**/MapServer/export**", (route) => route.abort());
    await page.route("**/MapServer?f=json**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ currentVersion: 11.1, mapName: "Layers", capabilities: "Map,Query,Identify" }) }));

    await openPlanner(page);
    await toggleLayer(page, /FEMA flood zones/i);
    await page.waitForTimeout(2000);

    const at = await feetToScreen(page, 400, 400);
    await page.mouse.move(at.x, at.y);
    const readout = page.getByTestId("gis-identify-hover");
    await expect(readout).toBeVisible({ timeout: 8000 });
    /* An honest STATED outcome — which of the failure wordings appears depends on how far the
     * request got (a direct block, or the cache-proxy retry reaching something that isn't the
     * service), and all of them are legitimate. What matters is the three things that must
     * NEVER happen: a spinner left up forever, an empty readout, and a raw internal message. */
    await expect(readout).toContainText(/couldn't reach|didn't answer|rate-limit|nothing here|unreadable|HTTP \d+|needs the cache proxy/i);
    await expect(readout).not.toContainText("Checking…");
    await expect(readout).not.toContainText(/Unexpected token|is not valid JSON|undefined|\[object/i);
    expect((await readout.innerText()).trim().length).toBeGreaterThan(0);
  });

  /* Both themes, per the verification brief — the readout is app chrome, so it must clear the
   * contrast rule in light AND dark (the B316–B320 palette rule). */
  for (const theme of ["light", "dark"]) {
    test(`the hover readout renders in the ${theme} theme`, async ({ page }) => {
      await stubElectric(page);
      /* Set the theme through the app's OWN stored preference ("planyr.theme"), before load, and
       * let ThemeProvider apply it. Forcing `data-theme` on <html> by hand instead flips only the
       * CSS tokens and leaves the JS palette mirror (shared/theme/palette.js, which the SVG canvas
       * and these overlay cards read) on the other theme's values — the exact drift CLAUDE.md warns
       * about, and it renders as text the same colour as its own surface. */
      await page.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch (_) {} }, theme);
      await openPlanner(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await toggleLayer(page, /^Electric/);
      await page.waitForTimeout(2500);

      const at = await lngLatToScreen(page, LAT, LON);
      await page.mouse.move(at.x, at.y);
      const readout = page.getByTestId("gis-identify-hover");
      await expect(readout).toBeVisible({ timeout: 6000 });
      await expect(readout).toContainText("Substation (HIFLD)");
      // The item-1 guarantee must hold in either theme too.
      await expectNoBrokenMarkers(page);
      // Let the theme's colour transitions finish before capturing — a screenshot taken mid-flip
      // shows half the page's text still transitioning, which reads as a rendering bug it is not.
      await page.waitForTimeout(600);
      await page.screenshot({ path: `test-results/new1-hover-identify-${theme}.png`, fullPage: false });
    });
  }
});
