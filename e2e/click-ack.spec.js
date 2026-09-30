/* NEW-1 — a lot click is ACKNOWLEDGED AT THE CURSOR at once, however slow the county server is.
 *
 * Owner report 2026-09-29 (Grand Port / Chambers): the lot row landed 1.5–2 s after the click and
 * nothing on screen said the app had heard it. The county server is the floor, so the click itself
 * must show. Red-proof: on a build without src/shared/ui/clickAck.js the ring never exists, so the
 * first assertion (with the county request HELD OPEN) fails.
 *
 * Logged out; the county service is mocked with a request we hold until the test releases it, so the
 * "county is slow" condition is exact rather than hoped for. */
import { test, expect } from "@playwright/test";

const site = {
  id: "e2e-click-ack", groupId: "e2e-click-ack", site: "Katy Tract Demo", name: "Plan 1",
  origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

async function arm(page, mode) {
  let release;
  const gate = new Promise((r) => { release = r; });
  let pointQueries = 0;
  await page.context().route(/gis\.hctx\.net/, async (route) => {
    const url = route.request().url();
    const cors = { "access-control-allow-origin": "*" };
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    if (/\/MapServer\/0\/query/.test(url)) {
      if (!/esriGeometryPoint/.test(url)) return json({ features: [] });
      pointQueries += 1;
      if (mode !== "instant") await gate; // the slow county server, held open until released
      if (mode === "none") return json({ geometryType: "esriGeometryPolygon", features: [] });
      let x = -95.37, y = 29.76;
      try { const g = JSON.parse(new URL(url).searchParams.get("geometry")); x = g.x; y = g.y; } catch {}
      const oid = Math.abs(Math.round(x * 100000)) * 100000 + Math.abs(Math.round(y * 100000));
      const d = 0.0008;
      return json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, features: [{ attributes: { OBJECTID: oid, SITUS_ADDR: `Lot ${oid}` }, geometry: { rings: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]], spatialReference: { wkid: 4326 } } }] });
    }
    return json({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }], extent: { xmin: -96, ymin: 29, xmax: -95, ymax: 30, spatialReference: { wkid: 4326 } }, drawingInfo: { renderer: {} } });
  });
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s }));
      localStorage.setItem("planarfit:currentSite:v1", s.id);
    } catch (e) {}
  }, site);
  await page.route("**/*.jpg", (route) => route.abort());
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Katy Tract Demo", { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(900);
  await page.getByTestId("rail-parcel-tools").click();
  await page.locator('[data-parcel-action="identify"]').click();
  await page.waitForTimeout(500);
  const canvas = page.getByTestId("planner-canvas");
  const box = await canvas.boundingBox();
  return { release: () => release(), box, pointQueries: () => pointQueries };
}

const ack = (page) => page.getByTestId("click-ack");
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test("a held-open county request still shows a ring at the cursor within a frame of pointerdown", async ({ page }) => {
  const { release, box, pointQueries } = await arm(page, "held");
  const x = box.x + box.width / 2 - 180, y = box.y + box.height / 2 - 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await nextFrame(page); // ONE frame after pointerdown — before the button is even released
  await expect(ack(page)).toHaveCount(1);
  await expect(ack(page)).toHaveAttribute("data-state", "pending");
  const at = await ack(page).evaluate((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
  expect(Math.abs(at.x - x)).toBeLessThan(2);
  expect(Math.abs(at.y - y)).toBeLessThan(2);
  await page.mouse.up();
  await expect.poll(pointQueries).toBeGreaterThan(0); // the county request is out and held
  await expect(ack(page)).toHaveAttribute("data-state", "pending"); // still holding while the county thinks
  release();
  await expect(ack(page)).toHaveCount(0); // lot landed → ring gone
  await expect(page.getByText(/Added/).first()).toBeVisible();
});

test("a drag (pan) is not a click: the ring clears and nothing is queried", async ({ page }) => {
  const { box, pointQueries } = await arm(page, "held");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await nextFrame(page);
  await expect(ack(page)).toHaveCount(1);
  await page.mouse.move(x + 90, y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(ack(page)).toHaveCount(0);
  expect(pointQueries()).toBe(0);
});

test("a click on no lot ends in a clear 'No lot here', never a silent ring", async ({ page }) => {
  const { release, box } = await arm(page, "none");
  await page.mouse.click(box.x + box.width / 2 - 100, box.y + box.height / 2);
  await expect(ack(page)).toHaveAttribute("data-state", "pending");
  release();
  await expect(ack(page)).toHaveAttribute("data-state", "empty");
  await expect(ack(page)).toContainText("No lot here");
  await expect(ack(page)).toHaveCount(0, { timeout: 6000 }); // and the tag then goes away
});

test("two rapid clicks: the first is superseded, only the second ring remains, then it lands", async ({ page }) => {
  const { release, box } = await arm(page, "held");
  await page.mouse.click(box.x + box.width / 2 - 180, box.y + box.height / 2 - 60);
  await page.mouse.click(box.x + box.width / 2 + 200, box.y + box.height / 2 + 80);
  await nextFrame(page);
  await expect(ack(page)).toHaveCount(1);
  release();
  await expect(ack(page)).toHaveCount(0);
  await expect(page.getByText(/Added/).first()).toBeVisible();
});
