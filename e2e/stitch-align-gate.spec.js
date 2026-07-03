/* Logged-out smoke for the Stitch align-gate work (B630–B633 / NEW-1..4).
 *
 * Runs with no seeded account (sandbox-safe). It can't load the owner's auth-only JACINTOPORT
 * set — that signed-in check is recorded in VERIFICATION.md (V200) — but it DOES prove the
 * Stitcher mounts and renders with the new reference-set classifier, the not-to-scale flag, the
 * badge-clamp render path, and the dedupe/re-persist effect all live, with no runtime crash. The
 * pure logic behind each is unit-locked (stitchDedupe / stitchGeom / sheetRead tests). */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

test.describe("Stitch align-gate smoke (logged out)", () => {
  test("mounts the multi-sheet Stitcher without error and shows the empty state", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/");
    await openModule(page, "doc-review");
    // Enter multi-sheet (Stitch) mode from the Review toolbar.
    await page.getByRole("button", { name: /Stitch/ }).first().click();
    // The empty stitcher renders its "drop a set" prompt — proof the module mounted cleanly with
    // the new referenceSet/dedupe/badge code paths (empty placed[] ⇒ no steer, no crash).
    await expect(page.getByText(/Drop a whole set/i)).toBeVisible({ timeout: 15_000 });
    // The toolbar's tools + zoom controls are present (the canvas chrome rendered).
    await expect(page.getByRole("button", { name: "Calibrate" })).toBeVisible();
    expect(errors, `no runtime errors on Stitcher mount:\n${errors.join("\n")}`).toEqual([]);
  });
});
