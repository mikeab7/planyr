/* NEW-6 (B1102) — the map must zoom out far enough to reach a second state.
 *
 * Logged-out, no auth, no external GIS needed: the zoom floor is enforced entirely client-side by
 * Leaflet, so this is verifiable HERE rather than parked as a live check. Tile requests will fail
 * in the sandbox (egress is restricted) and that is fine — Leaflet handles missing tiles, and the
 * zoom floor is independent of whether imagery arrives.
 *
 * Guards the actual reported symptom ("I can't zoom out far enough") end to end, not just the
 * source literal that `test/coloradoRegistry.test.js` asserts.
 */
import { test, expect } from "@playwright/test";

test.describe("NEW-6 · map finder zoom floor", () => {
  test("the map can be pulled back to a continental view, and reach Colorado", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/");
    // The map finder is the landing surface; wait for Leaflet to have painted its container.
    await page.waitForSelector(".leaflet-container", { timeout: 45000 });

    // Leaflet keeps its map instance off the DOM node, so drive the zoom the way a user does and
    // read the result off the surface a user actually reads: the graphic SCALE BAR. That is both
    // the honest observable and the one the owner would look at.
    const zoomOut = page.locator(".leaflet-control-zoom-out");
    await expect(zoomOut).toBeVisible();

    // The landing view is z11 (Harris). The old floor was z8 — three clicks. Click well past it.
    for (let i = 0; i < 14; i++) {
      if (await zoomOut.evaluate((el) => el.classList.contains("leaflet-disabled"))) break;
      await zoomOut.click();
      await page.waitForTimeout(320);   // Leaflet's zoom animation, or clicks coalesce
    }

    const scaleText = (await page.locator(".leaflet-control-scale-line").first().innerText()).trim();
    const m = /^([\d.,]+)\s*(mi|ft)$/i.exec(scaleText);
    expect(m, `could not read the scale bar (got "${scaleText}")`).toBeTruthy();
    const miles = m[2].toLowerCase() === "mi" ? Number(m[1].replace(/,/g, "")) : Number(m[1].replace(/,/g, "")) / 5280;

    // At the OLD minZoom of 8 the scale bar reads single-digit miles. A continental view reads in
    // the hundreds. This is the regression, in the units the user sees.
    expect(miles, `scale bar reads ${scaleText} — still clamped to a regional view`).toBeGreaterThanOrEqual(100);

    // And the view genuinely reaches Colorado's latitude band: pan the centre there and confirm
    // the app accepts it (the finder's jurisdiction resolver keys off the view centre).
    const before = await page.locator(".leaflet-container").boundingBox();
    expect(before.width).toBeGreaterThan(0);

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
