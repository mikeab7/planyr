/* Clicking a GIS feature ON THE PLANNER CANVAS answers (B1092).
 *
 * The report: at the Tsakiris tract, single- and double-clicking the district easement band
 * and the channel centreline produced only the coordinate/elevation readout — never a feature
 * popup. The audit found why: the planner's Leaflet backdrop lives inside a pointer-events:none
 * box (the SVG canvas owns every pointer event) AND the planner never passed `identifyOk`, so
 * `cachedVectorLayer` bound no click handler there at all. Identify was a MAP FINDER feature.
 * Making the easement layer vector bought nothing on the surface where a site is actually
 * worked. B1092 wires the canvas's own tap to the same answer.
 *
 * This spec drives the REAL planner LOGGED OUT, with the district endpoint STUBBED at the
 * network boundary (the sandbox's egress proxy 403s gisclient.quiddity.com, and a spec that
 * depends on a live agency host is a flaky spec anyway). What it proves is the wiring the
 * report is about: a tap on the band opens a card carrying the easement's recorded WIDTH and
 * EXHIBIT, and a tap off the band opens nothing.
 */
import { test, expect } from "@playwright/test";

// The Tsakiris tract (Waller County, inside BKDD) — the exact coordinates of the report.
const LAT = 29.77938, LON = -95.89503;
const SITE = {
  schemaVersion: 12, id: "b1090-identify", groupId: "b1090-identify",
  site: "B1092 Identify Guard", name: "B1092 Identify Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};

// A 70-ft recorded easement band, as the district's own service would return it: a small
// polygon straddling the site origin, with the width + recorded-exhibit attributes that are
// the entire reason that layer is vector rather than a picture.
const D = 0.0006; // ≈ a couple hundred feet each way — contains the origin, excludes the far corner
const EASEMENT_JSON = {
  features: [{
    attributes: { width: 70, file: "WF-10.pdf" },
    geometry: { rings: [[[LON - D, LAT - D], [LON + D, LAT - D], [LON + D, LAT + D], [LON - D, LAT + D], [LON - D, LAT - D]]] },
  }],
};

// Feet → viewport client px, off the canvas transform seam the planner publishes.
async function feetToScreen(page, fx, fy) {
  return page.evaluate(([f, g]) => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const offX = parseFloat(svg.getAttribute("data-view-offx"));
    const offY = parseFloat(svg.getAttribute("data-view-offy"));
    const ppf = parseFloat(svg.getAttribute("data-view-ppf"));
    const vb = svg.getAttribute("viewBox").split(" ").map(Number); // 0 0 w h
    const r = svg.getBoundingClientRect();
    return {
      x: r.left + ((f * ppf + offX) / vb[2]) * r.width,
      y: r.top + ((g * ppf + offY) / vb[3]) * r.height,
    };
  }, [fx, fy]);
}

const card = (p) => p.getByTestId("gis-identify");

test.describe("canvas GIS identify (B1092)", () => {
  test("tapping the district easement band reports its width and recorded exhibit", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // Stub the district service at the network boundary — every /query on that host.
    await page.route("**gisclient.quiddity.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EASEMENT_JSON) }));
    // No aerial tiles in the sandbox; keep them from retrying noisily.
    await page.route("**/*.jpg", (route) => route.abort());

    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("B1092 Identify Guard", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900); // fit-on-load + first commit settle

    // Turn the easement layer on through the real Layers panel.
    await page.getByRole("button", { name: /Layers/ }).first().click();
    const easementRow = page.getByText("District drainage easements", { exact: true }).first();
    await expect(easementRow).toBeVisible({ timeout: 10000 });
    await easementRow.click(); // the row's <label> wraps the checkbox
    await page.waitForTimeout(1500); // the (stubbed) pull + paint

    // A tap ON the band: inside the stubbed easement polygon, and inside the parcel BODY
    // (which is click-through by design, B420) so the tap lands on empty canvas — never on
    // the boundary stroke or a corner handle, which own their own click.
    const on = await feetToScreen(page, 150, 150);
    await page.mouse.click(on.x, on.y);
    await expect(card(page)).toBeVisible({ timeout: 5000 });
    await expect(card(page)).toContainText("70 ft");
    await expect(card(page)).toContainText("WF-10.pdf");
    // …and it says what a district easement MEANS, not just a number.
    await expect(card(page)).toContainText(/hard constraint/i);

    // A tap well OFF the band opens nothing — the card is a hit test, not a click counter.
    const off = await feetToScreen(page, 1250, 1250);
    await page.mouse.click(off.x, off.y);
    await expect(card(page)).toHaveCount(0);

    expect(errors, errors.join(" | ")).toHaveLength(0);
  });
});
