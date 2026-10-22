/* NEW-1 (2026-10-22, owner request 2026-10-21) — a county with no parcel data says WHY and offers "Email Michael to request it".
 * Drives the real map lot picker. RED ON MAIN: the toast read "<County> — no parcel data wired here yet." for every county alike and
 * carried no link. Each reason is one real county: Pike KY (paywall — qPublic subscriber-only), Bath KY (paywall — wins over its Token
 * Required layer because the map itself is behind a login), Breckinridge KY (locked), Boyle KY (unreachable), Fulton KY (none, the
 * owner-accepted gap). Every server is held open and never answered, so only the county's own verdict can produce the text.
 * Phone width: the message wraps and the link stays fully inside the screen and tappable. */
import { test, expect } from "@playwright/test";

async function openMap(page) {
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, () => { /* never answers */ });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:gapSeeded")) return;
    localStorage.setItem("e2e:gapSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-select-parcels")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500); // county polygons resident
}

async function pickAt(page, lat, lng, { arm = true } = {}) {
  await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [lat, lng]);
  await page.waitForTimeout(300);
  if (arm) await page.getByTestId("map-toolbar-select-parcels").click();
  await page.waitForTimeout(300);
  const pt = await page.evaluate(([a, b]) => {
    const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
  await page.mouse.click(pt.x, pt.y);
}

const CASES = [
  ["Pike County", "KY", 37.4791, -82.5188, /Pike County keeps its parcel map behind a paid subscription/],
  ["Bath County", "KY", 38.1456, -83.7646, /Bath County keeps its parcel map behind a paid subscription/],
  ["Breckinridge County", "KY", 37.7798, -86.4605, /Breckinridge County has a parcel map, but it isn't open to the public/],
  ["Boyle County", "KY", 37.6456, -84.7694, /Boyle County's parcel map server isn't reachable from Planyr right now/],
  ["Fulton County", "KY", 36.5526, -89.1734, /Planyr hasn't found a public parcel map it can use for Fulton County/],
];

test.describe("a county with no parcel data says why and offers the request link", () => {
  test.setTimeout(60_000);
  for (const [name, st, lat, lng, sentence] of CASES) {
    test(`${name}, ${st}`, async ({ page }) => {
      await openMap(page);
      await pickAt(page, lat, lng);
      const toast = page.getByTestId("map-status-toast");
      await expect(toast).toContainText(sentence, { timeout: 15_000 });
      await expect(toast).not.toContainText("wired here yet");
      const link = page.getByTestId("map-gap-request");
      await expect(link).toHaveText("Email Michael to request it");
      const href = await link.getAttribute("href");
      const u = new URL(href);
      expect(u.pathname).toBe("michael@planyr.io");
      expect(u.searchParams.get("subject")).toBe(`Parcel data request: ${name}, ${st}`);
      const body = u.searchParams.get("body");
      expect(body).toContain(`County: ${name}, ${st}`);
      expect(body).toMatch(/Point I clicked: \d+\.\d{5}, -\d+\.\d{5}/);
      expect(body).toContain("Reason shown: ");
      await page.screenshot({ path: `test-results/parcel-gap-${st}-${name.split(" ")[0]}.png` });
    });
  }

  test("phone width: the message wraps and the link stays on screen, tappable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openMap(page);
    await pickAt(page, 37.4791, -82.5188);
    const link = page.getByTestId("map-gap-request");
    await expect(link).toBeVisible({ timeout: 15_000 });
    const box = await link.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(28);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await page.screenshot({ path: "test-results/parcel-gap-phone.png" });
  });

  test("the link belongs to its own message — a second click in another county carries THAT county's request, never the first's", async ({ page }) => {
    await openMap(page);
    await pickAt(page, 37.4791, -82.5188);
    await expect(page.getByTestId("map-status-toast")).toContainText("Pike County", { timeout: 15_000 });
    expect(new URL(await page.getByTestId("map-gap-request").getAttribute("href")).searchParams.get("subject")).toBe("Parcel data request: Pike County, KY");
    await pickAt(page, 36.5526, -89.1734, { arm: false });
    await expect(page.getByTestId("map-status-toast")).toContainText("Fulton County", { timeout: 15_000 });
    await expect(page.getByTestId("map-gap-request")).toHaveCount(1);
    expect(new URL(await page.getByTestId("map-gap-request").getAttribute("href")).searchParams.get("subject")).toBe("Parcel data request: Fulton County, KY");
  });
});
