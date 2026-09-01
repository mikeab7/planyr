/* Notification-position live-verify (V568016, B1000400/B1000401/B1000402, 2026-09-01).
 *
 * Owner report with a screenshot: on the map, in "+ Select parcels" mode, the guidance box sat
 * oversized at the top-left, covering the aerial and the +/- zoom controls. Instruction: make a
 * rule that every notification banner is bottom-centered, and apply it everywhere.
 *
 * This drives the REAL render path, logged out, on the map landing page (no account, no external
 * GIS — ATTEMPT-BEFORE-YOU-PARK: this check needs neither, so it is not deferred to a live pass)
 * and proves, on the running app:
 *   1. The select-parcels guidance tip renders bottom-centered and does not overlap the Leaflet
 *      zoom control (the owner's exact complaint).
 *   2. A second floating notification (fullscreen-refused) showing at the same time STACKS above
 *      it — newest nearest the bottom edge — rather than overlapping it, per the "multiple
 *      simultaneous notifications" rule.
 */
import { test, expect } from "@playwright/test";

async function openMap(page) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:mapSeeded")) return;
    localStorage.setItem("e2e:mapSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.addInitScript(() => {
    // Refuse fullscreen exactly as a permissions policy would, so a second, independent
    // notification can be raised deterministically (module-keepalive.spec.js's own technique).
    const refuse = () => Promise.reject(new Error("fullscreen-refused-by-test"));
    Object.defineProperty(Element.prototype, "requestFullscreen", { value: refuse, configurable: true });
  });
  await page.goto("/#/");
  await expect(page.getByTestId("map-start-blank-menu-btn")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); // let the Leaflet map + layer probes settle
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe("V568016 — floating notifications are bottom-centered and stack, never overlap", () => {
  test("the select-parcels tip is bottom-centered, clear of the zoom controls; a second notice stacks above it", async ({ page }) => {
    await openMap(page);
    const viewport = page.viewportSize();

    // Everything below happens back-to-back, deliberately with no extra waits: this sandbox's
    // county GIS hosts are egress-blocked (parcel-outage-fallback.spec.js's own note), and once
    // that probe fails the map's `err` state takes the SAME slot as the tip (`!err && selectMode`)
    // — a real, pre-existing, mutually-exclusive design in MapFinder.jsx that this item did not
    // touch and is not the subject of this check. Racing it, rather than waiting it out, is what
    // keeps this test about POSITION, not about GIS reachability.
    await page.getByRole("button", { name: "Select parcels" }).click();
    const tip = page.getByTestId("select-parcels-tip");
    await expect(tip).toBeVisible();

    const tipBox = await tip.boundingBox();
    const zoomBox = await page.locator(".leaflet-control-zoom").boundingBox();
    expect(zoomBox, "the Leaflet zoom control must be on screen for this check to mean anything").not.toBeNull();

    // Bottom-centered: sits in the lower half of the viewport, horizontally centered.
    expect(tipBox.y, "the tip must sit in the lower half of the viewport, not the top-left").toBeGreaterThan(viewport.height / 2);
    const tipCenterX = tipBox.x + tipBox.width / 2;
    expect(Math.abs(tipCenterX - viewport.width / 2), "the tip must be horizontally centered").toBeLessThan(4);

    // The owner's exact complaint: must not cover the zoom controls (or, by the same measure, the
    // aerial underneath it — a box that doesn't touch a bottom-left control is not parked over the
    // top-left corner it used to occupy).
    expect(intersects(tipBox, zoomBox), "the tip must not overlap the zoom control stack").toBe(false);

    // A second, independent floating notice at the same time: fullscreen-refused. Stacks above the
    // tip (never overlapping it), and both remain bottom-centered.
    await page.keyboard.press("f");
    const fsNotice = page.getByTestId("fullscreen-refused");
    await expect(fsNotice).toBeVisible();
    await expect(tip, "the first notice must still be showing — stacking, not replacement (if this " +
      "fails with the tip gone, the sandbox's blocked GIS egress raced the check — see the note above)")
      .toBeVisible();

    const fsBox = await fsNotice.boundingBox();
    const tipBox2 = await tip.boundingBox();
    await page.screenshot({ path: "test-results/v568016-stacked-notices.png" });
    expect(intersects(fsBox, tipBox2), "two simultaneous floating notices must never overlap").toBe(false);
    // Stacked, not side-by-side, and NEWEST NEAREST THE BOTTOM EDGE (docs/DESIGN.md): the
    // just-mounted fullscreen notice sits closer to the bottom edge, and the tip (mounted first)
    // is pushed up above it.
    expect(tipBox2.y + tipBox2.height, "the earlier notice (the tip) must sit ABOVE the newer one").toBeLessThanOrEqual(fsBox.y + 1);
    const fsCenterX = fsBox.x + fsBox.width / 2;
    expect(Math.abs(fsCenterX - viewport.width / 2), "the second notice must also be horizontally centered").toBeLessThan(4);
  });
});
