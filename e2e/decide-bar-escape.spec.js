/* B2451472 (NEW-1) — Escape does what the decide bar's ✕ does.
 *
 * Owner: with a parcel selected on the Map ("● 1 parcel · 145.29 AC", ✕, Plan this site, Record info ▾) the only way out
 * was the ✕; Escape should do the same. Contract asserted on the real render:
 *   - Escape clears EVERY selected parcel (outline, acreage chip, bar) — the ✕'s own path.
 *   - Layered: with Record info ▾ open, the first Escape closes only that menu; the next clears the selection.
 *   - Focus in a text field keeps Escape's normal meaning — the selection stays.
 *   - Escape with nothing selected is a silent no-op (no page error).
 * KNOWN-GOOD ARM: the ✕ itself clears the same selection through the same function.
 * RED ON MAIN (524ab73): the Escape tests fail — the bar is still on screen after the key.
 *
 * Parcels are served from a stubbed county service (same stub shape as memphis-line-band): two adjoining Shelby lots. */
import { test, expect } from "@playwright/test";

const ring = (s, w, n, e) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const LOT_A = { attributes: { OBJECTID: 1, PARCELID: "073088  00221", OWNER: "ALPHA LLC", PAR_ADDR1: "0 ARNOLD RD" }, geometry: { rings: ring(35.027, -89.953, 35.033, -89.947) } };
const LOT_B = { attributes: { OBJECTID: 2, PARCELID: "073088  00222", OWNER: "BRAVO LLC", PAR_ADDR1: "0 ARNOLD RD" }, geometry: { rings: ring(35.027, -89.947, 35.033, -89.941) } };
const inRing = (f, lng, lat) => { const r = f.geometry.rings[0]; return lng > r[0][0] && lng < r[1][0] && lat > r[0][1] && lat < r[2][1]; };

const summary = (page) => page.evaluate(() => (document.querySelector('[data-testid="map-decide-summary"]') || {}).textContent || "");
const selectedCount = (page) => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels().length : -1));
const bar = (page) => page.getByTestId("map-decide-summary");

// Lot B's answer can be held back (ms) so a lookup is still in flight when the selection is cleared.
let holdLotBMs = 0;

async function openMap(page) {
  holdLotBMs = 0;
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, async (route) => {
    const req = route.request();
    const u = decodeURIComponent(req.url() + " " + (req.postData() || ""));
    if (!/\/query/.test(u) || !/esriGeometryPoint/.test(u)) return;
    const m = u.match(/"x":\s*(-?[\d.]+),\s*"y":\s*(-?[\d.]+)/);
    const lng = m ? +m[1] : NaN, lat = m ? +m[2] : NaN;
    const features = /scgis\.shelbycountytn\.gov/.test(u) ? [LOT_A, LOT_B].filter((f) => inRing(f, lng, lat)) : [];
    if (holdLotBMs && features.some((f) => f === LOT_B)) await new Promise((r) => setTimeout(r, holdLotBMs));
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ spatialReference: { wkid: 4326 }, fields: [], features }) });
  });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:decideEscSeeded")) return;
    localStorage.setItem("e2e:decideEscSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-select-parcels")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__mapFinderMap.setView([35.03, -89.947], 17, { animate: false }));
  await page.waitForTimeout(300);
  await page.getByTestId("map-toolbar-select-parcels").click();
  await page.waitForTimeout(300);
}

async function clickLot(page, lat, lng) {
  const pt = await page.evaluate(([a, b]) => {
    const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
  await page.mouse.click(pt.x, pt.y);
}

async function selectOne(page) {
  await clickLot(page, 35.03, -89.95);
  await expect.poll(() => summary(page), { timeout: 20_000 }).toMatch(/^1 parcel/);
}

test.describe("Escape clears the decide bar like its ✕", () => {
  test.setTimeout(90_000);

  test("KNOWN-GOOD ARM — the ✕ clears the selection", async ({ page }) => {
    await openMap(page);
    await selectOne(page);
    await page.getByTestId("map-decide-clear").click();
    await expect(bar(page)).toHaveCount(0);
    expect(await selectedCount(page)).toBe(0);
  });

  test("Escape clears a one-parcel selection: bar gone, selection empty", async ({ page }) => {
    await openMap(page);
    await selectOne(page);
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    expect(await selectedCount(page)).toBe(0);
  });

  test("Escape clears ALL parcels of a multi-selection, not just the last", async ({ page }) => {
    await openMap(page);
    await selectOne(page);
    await clickLot(page, 35.03, -89.944);
    await expect.poll(() => summary(page), { timeout: 20_000 }).toMatch(/^2 parcels/);
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    expect(await selectedCount(page)).toBe(0);
  });

  test("layered: with Record info open the first Escape closes only the menu, the next clears", async ({ page }) => {
    await openMap(page);
    await selectOne(page);
    await page.getByTestId("map-decide-record-info").click();
    await expect(page.getByTestId("map-decide-verb-note")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("map-decide-verb-note")).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
    expect(await selectedCount(page)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    expect(await selectedCount(page)).toBe(0);
  });

  // The address field is unmounted while Select parcels is on (B1430384), so the text controls that can coexist with
  // the bar are the Sites-panel filter, the comps grid and any field — the rule is generic (isTextControl), so the
  // controls are placed in the page the way a panel would hold them.
  for (const [label, html, focus] of [
    ["a text input", '<input id="e2e-esc-field" type="text" />', (el) => el.focus()],
    ["a textarea", '<textarea id="e2e-esc-field"></textarea>', (el) => el.focus()],
    ["a contenteditable", '<div id="e2e-esc-field" contenteditable="true" tabindex="0">x</div>', (el) => el.focus()],
  ]) {
    test(`focus in ${label} keeps Escape's normal meaning — the selection stays`, async ({ page }) => {
      await openMap(page);
      await selectOne(page);
      await page.evaluate((h) => { const d = document.createElement("div"); d.id = "e2e-esc-host"; d.innerHTML = h; document.body.appendChild(d); }, html);
      await page.locator("#e2e-esc-field").evaluate(focus);
      await page.keyboard.press("Escape");
      await expect(bar(page)).toBeVisible();
      expect(await selectedCount(page)).toBe(1);
      // leaving the field returns Escape to the bar
      await page.locator("#e2e-esc-field").evaluate((el) => el.blur());
      await page.keyboard.press("Escape");
      await expect(bar(page)).toHaveCount(0);
      expect(await selectedCount(page)).toBe(0);
    });
  }

  test("Escape with nothing selected is a silent no-op", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openMap(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    expect(await selectedCount(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  // Found live (V1894976): Escape is instant, so it can land while a lot lookup is still in flight; the late answer used to
  // re-add the lot the person had just cleared (5 of 6 Escapes). Both ways of clearing must abandon an in-flight lookup.
  for (const [how, clear] of [
    ["Escape", (page) => page.keyboard.press("Escape")],
    ["the ✕", (page) => page.getByTestId("map-decide-clear").click()],
  ]) {
    test(`${how} while a second lot's lookup is still in flight: the late answer does NOT bring the selection back`, async ({ page }) => {
      await openMap(page);
      await selectOne(page);
      holdLotBMs = 2500;
      await clickLot(page, 35.03, -89.944); // lot B: its answer arrives 2.5 s later
      await clear(page);
      await expect(bar(page)).toHaveCount(0);
      await page.waitForTimeout(4000); // well past the held answer
      expect(await selectedCount(page)).toBe(0);
      await expect(bar(page)).toHaveCount(0);
    });
  }
});
