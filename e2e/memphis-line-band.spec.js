/* NEW-1 (Memphis line band, recurrence ×3 of B2289168) — the owner's exact clicks: "its still saying no lot here in memphis",
 * Stateline Rd East between Swinnea and Tchulahoma, north side (Shelby County TN; Stateline Rd IS the TN/MS line).
 *
 * The county servers are stubbed to the MEASURED truth (2026-10-16): the Shelby Assessor relay holds the lot (real parcel
 * 094100 00069, POOL 5 INDUSTRIAL TN LLC, its outline simplified to a box), DeSoto County's service has nothing at that point.
 * The bundled county polygons draw the state line ≈550 m north of the surveyed one, so the point resolves to DeSoto.
 *
 * RED ON MAIN (edb5811): the click asks DeSoto ALONE, DeSoto answers empty, and the owner's message appears — "No parcel right
 * there — zoom in and click directly on a lot." — over a lot the app has just outlined in purple.
 * KNOWN-GOOD ARM: airport east (35.03, -89.95), deep in Shelby, selected before and after.
 * GENUINE-EMPTY ARM: a point neither county holds (a road) still says "No parcel right there", having asked both. */
import { test, expect } from "@playwright/test";

const GENERIC = /No parcel right there/i;
const ring = (s, w, n, e) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const POOL5 = { attributes: { OBJECTID: 9069, PARCELID: "094100  00069", OWNER: "POOL 5 INDUSTRIAL TN LLC", PAR_ADDR1: "STATELINE RD" }, geometry: { rings: ring(34.9948, -89.9365, 34.9965, -89.9279) } };
const AIRPORT = { attributes: { OBJECTID: 1, PARCELID: "073088  00221", OWNER: "LIBERTY STREET MEMPHIS PARTNERS", PAR_ADDR1: "0 ARNOLD RD" }, geometry: { rings: ring(35.027, -89.953, 35.033, -89.947) } };
const inRing = (f, lng, lat) => { const r = f.geometry.rings[0]; return lng > r[0][0] && lng < r[1][0] && lat > r[0][1] && lat < r[2][1]; };

async function openMap(page, asked) {
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, (route) => {
    const req = route.request();
    const u = decodeURIComponent(req.url() + " " + (req.postData() || ""));
    if (!/\/query/.test(u) || !/esriGeometryPoint/.test(u)) return; // outlines / metadata: never answered
    const m = u.match(/"x":\s*(-?[\d.]+),\s*"y":\s*(-?[\d.]+)/);
    const lng = m ? +m[1] : NaN, lat = m ? +m[2] : NaN;
    const reply = (features) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ spatialReference: { wkid: 4326 }, fields: [], features }) });
    if (/scgis\.shelbycountytn\.gov/.test(u)) { asked.push("shelby"); return reply([POOL5, AIRPORT].filter((f) => inRing(f, lng, lat))); }
    if (/DESOTO_PARCELS/.test(u)) { asked.push("desoto"); return reply([]); }
    asked.push("other"); return reply([]);
  });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:lineBandSeeded")) return;
    localStorage.setItem("e2e:lineBandSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-select-parcels")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500); // county polygons resident
}

async function pickAt(page, lat, lng) {
  await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [lat, lng]);
  await page.waitForTimeout(300);
  await page.getByTestId("map-toolbar-select-parcels").click();
  await page.waitForTimeout(300);
  const pt = await page.evaluate(([a, b]) => {
    const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
  await page.mouse.click(pt.x, pt.y);
}
const summary = (page) => page.evaluate(() => (document.querySelector('[data-testid="map-decide-summary"]') || {}).textContent || "");
const body = (page) => page.evaluate(() => document.body.innerText);

test.describe("Memphis — a Shelby lot AT the state line is selected, not refused", () => {
  test.setTimeout(60_000);

  test("KNOWN-GOOD ARM — airport east (deep in Shelby) selects its lot", async ({ page }) => {
    const asked = [];
    await openMap(page, asked);
    await pickAt(page, 35.03, -89.95);
    await expect.poll(() => summary(page), { timeout: 20_000 }).toMatch(/^1 parcel/);
  });

  test("the owner's spot — north side of Stateline Rd: the SHELBY lot is selected", async ({ page }) => {
    const asked = [];
    await openMap(page, asked);
    await pickAt(page, 34.9955, -89.9330);
    await expect.poll(() => summary(page), { timeout: 20_000 }).toMatch(/^1 parcel/);
    expect(await body(page)).not.toMatch(GENERIC);
    const held = await page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : []));
    expect(held.map((h) => h.attrs && h.attrs.PARCELID)).toEqual(["094100  00069"]);
    expect(asked, "DeSoto (where the geometry routes it) first, then Shelby across the line").toEqual(expect.arrayContaining(["desoto", "shelby"]));
  });

  test("GENUINE-EMPTY ARM — a point neither county holds still says so, after asking both", async ({ page }) => {
    const asked = [];
    await openMap(page, asked);
    await pickAt(page, 34.9944, -89.9500); // Stateline Rd itself, west of every stubbed lot
    await expect.poll(() => body(page), { timeout: 20_000 }).toMatch(GENERIC);
    expect(asked).toEqual(expect.arrayContaining(["desoto", "shelby"]));
    expect(await summary(page)).not.toMatch(/^1 parcel/);
  });
});
