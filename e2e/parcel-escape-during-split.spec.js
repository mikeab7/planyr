/* NEW-1 — ESCAPE MUST ABANDON AN IN-PROGRESS PARCEL OPERATION, EVEN WHEN A CHECKBOX IN THE PARCELS
 * PANEL HOLDS FOCUS.
 *
 * The owner: "escape doesnt work on getting out of this parcel editing tool, and theres no clear
 * way out" / "i was splitting a parcel and couldnt get out of the splitting it option." His
 * screenshot showed the Parcels panel open (inputs and checkboxes visible) with an in-progress
 * split — a red dashed cut line and its two handles on the map.
 *
 * AUDIT-FIRST finding: Escape IS wired (SitePlanner.jsx's big sweep clears splitPath/mergePick/
 * boundaryEdit/etc and resets the tool). The defect is in `keyScopeVerdict`
 * (site-planner/lib/keyContract.js): a genuinely focused text-entry control (FIELD scope) refused
 * EVERY key unconditionally, `escape` included — and `shared/keyboard/keyScope.js` classified ANY
 * `<input>` as FIELD purely by tag, checkboxes included (the Parcels panel's per-row "Active"
 * toggle is one), so touching that control put Escape out of reach for as long as
 * `document.activeElement` stayed on it.
 *
 * ⛔ MEASURED, NOT ASSUMED — the ORDER that actually reproduces it. This session tried the order a
 * trace of the code suggested first (touch the checkbox, THEN arm Split, THEN cut, THEN Escape)
 * and it did NOT reproduce on the pre-fix build: arming Split means clicking the ✂ Split BUTTON,
 * which is itself focusable and takes `document.activeElement` away from the checkbox before
 * Escape is ever pressed, landing on BUTTON → CHROME scope, which already allowed Escape through.
 * What DOES reproduce — proven RED on the pre-fix build, GREEN once the fix lands — is the
 * checkbox taking focus WHILE the cut is already live (exactly the owner's screenshot: the panel's
 * checkboxes and the red cut line on screen at once) and Escape pressed right after, so the
 * checkbox is still `document.activeElement` at that instant. Both orders are driven below so the
 * measurement is on the record, not just the one that discriminates.
 *
 * This drives the REAL render path, logged out, on a seeded rectangular parcel (no account, no
 * external GIS) and proves the fix at the gesture level, not just at the pure-function level that
 * test/keyContract.test.js already covers (including the exact `fieldEdit: true` / persisted-latch
 * condition a pure trace of the code pointed at, which turned out — also measured, not assumed —
 * to already have been harmless: that state resolves to CHROME, which unconditionally allows a
 * scope:"app" entry like escape; FIELD, driven only by the CURRENTLY focused node, was the one
 * actual gate, and it is what `entry.guaranteed` now bypasses).
 *
 * Run: npx playwright test e2e/parcel-escape-during-split.spec.js
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const selectToolBtn = (p) => p.getByRole("button", { name: /^Select V$/ });
const cutPreviewText = (p) => p.getByText(/′ cut$/);
const activeCheckbox = (p) => p.locator('input[type="checkbox"]').first();

async function startBlank(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // NEW-1 (owner report 2026-08-29) — B831776's toolbar rebuild had left TWO "Start blank" buttons
  // on screen at once (the row-1 toolbar one and the map toolbar one), which is exactly what this
  // comment used to route `.first()` around instead of fixing. That duplicate is gone now: there is
  // ONE entry point (the "Select parcels" split button's caret), so `.first()` is no longer load-
  // bearing here — left in place only because it is harmless.
  await page.getByTestId("map-start-blank-menu-btn").first().click();
  await page.getByTestId("map-start-blank-menu-item").first().click();
  await expect(canvas(page)).toBeVisible();
}

async function drawRectParcel(page) {
  const box = await canvas(page).boundingBox();
  await page.locator('[data-rail-tab="parcel"]').click();
  await page.getByTitle(/Add land to this plan/i).click();
  await page.getByRole("button", { name: /Draw a new boundary/i }).click();
  await expect(page.getByText(/drop boundary points/i)).toBeVisible();
  const L = Math.round(box.x + box.width * 0.32), R = Math.round(box.x + box.width * 0.68);
  const T = Math.round(box.y + box.height * 0.28), B = Math.round(box.y + box.height * 0.68);
  for (const [x, y] of [[L, T], [R, T], [R, B], [L, B]]) { await page.mouse.click(x, y); await page.waitForTimeout(90); }
  await page.mouse.click(L, T); // close the ring
  await expect(page.getByTestId("parcel-outline")).toBeVisible();
  await page.keyboard.press("Escape"); // leave boundary-draw mode
  await selectToolBtn(page).click();
  await expect(selectToolBtn(page)).toHaveAttribute("aria-pressed", "true");
  return { L, R, T, B };
}

test.describe("Escape abandons an in-progress Split even while a Parcels-panel checkbox has focus", () => {
  /* This order does NOT reproduce the pre-fix defect (see the file header) — kept as coverage
   * because it is still a real, once-plausible path, and because the fix must hold here too. */
  test("panel checkbox touched FIRST, split armed second — Escape still drops the cut and returns to Select", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { L, R, T, B } = await drawRectParcel(page);

    // Same panel the owner had open — the "Active" checkbox column renders beside the parcel list,
    // in the SAME Section as the ✂ Split / ⧉ Merge buttons and the "Select parcels" toggle.
    await expect(activeCheckbox(page)).toBeVisible();
    await activeCheckbox(page).click();
    await expect(activeCheckbox(page)).toBeFocused();

    // NOW arm Split and lay down a cut — the dashed "…′ cut" polyline + handles from the owner's
    // screenshot. Record where focus actually lands after each step, so the mechanism is measured
    // rather than assumed.
    await page.getByTitle(/Split a parcel/i).click();
    const afterArm = await page.evaluate(() => ({ tag: document.activeElement?.tagName, type: document.activeElement?.type }));
    const mx = Math.round((L + R) / 2);
    await page.mouse.click(mx, T + 4);
    await page.mouse.click(mx, B - 4);
    await expect(cutPreviewText(page)).toBeVisible();
    const afterCut = await page.evaluate(() => ({ tag: document.activeElement?.tagName, type: document.activeElement?.type }));
    test.info().annotations.push({ type: "focus-after-arm", description: JSON.stringify(afterArm) });
    test.info().annotations.push({ type: "focus-after-cut-points", description: JSON.stringify(afterCut) });

    // The reproduction: Escape, with the panel checkbox touched before any of this started. Before
    // the fix, this is refused (silently) whenever the checkbox is still what keyScope resolves
    // against; the split preview and armed tool must NOT survive it once the fix has landed.
    await page.keyboard.press("Escape");

    await expect(cutPreviewText(page)).toHaveCount(0);
    await expect(selectToolBtn(page)).toHaveAttribute("aria-pressed", "true");

    // Re-arming Split must start with a CLEAN path, not a leftover one — proves setSplitPath([])
    // actually ran rather than the preview merely vanishing because the tool changed.
    await page.getByTitle(/Split a parcel/i).click();
    await expect(cutPreviewText(page)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* ⛔ THE DISCRIMINATING CASE — proven RED on the pre-fix build, GREEN once the fix lands (see the
   * file header). This is the order that actually matches the owner's screenshot: the Parcels
   * panel's checkboxes and the live red cut line are on screen TOGETHER, so a checkbox is what was
   * focused at the moment Escape was pressed. */
  test("checkbox focused mid-split (touched AFTER the cut is started) — Escape still drops the cut", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { L, R, T, B } = await drawRectParcel(page);

    await expect(activeCheckbox(page)).toBeVisible();

    await page.getByTitle(/Split a parcel/i).click();
    const mx = Math.round((L + R) / 2);
    await page.mouse.click(mx, T + 4);
    await page.mouse.click(mx, B - 4);
    await expect(cutPreviewText(page)).toBeVisible();

    await activeCheckbox(page).click();
    await expect(activeCheckbox(page)).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(cutPreviewText(page)).toHaveCount(0);
    await expect(selectToolBtn(page)).toHaveAttribute("aria-pressed", "true");

    await page.getByTitle(/Split a parcel/i).click();
    await expect(cutPreviewText(page)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* SCOPE — check the adjacent modes with the same "no way out" shape, not just the one the owner
   * hit: Merge/Combine (mergePick) lives in the same Escape sweep as Split (SitePlanner.jsx's one
   * big Escape branch) and goes through the identical keyScope path — the fix is in that one shared
   * gate, so every mode it covers inherits it together, not one at a time. (This particular order
   * did not discriminate pre-fix on this control, same as the "touched FIRST" case above — kept as
   * coverage that the fix holds for Merge too, not as a second RED/GREEN proof.) */
  test("checkbox focused mid-Merge-pick — Escape exits merge picking", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawRectParcel(page);
    // A second parcel so Merge is offered (parcels.length > 1).
    const box = await canvas(page).boundingBox();
    await page.getByTitle(/Add land to this plan/i).click();
    await page.getByRole("button", { name: /Draw a new boundary/i }).click();
    await expect(page.getByText(/drop boundary points/i)).toBeVisible();
    const L = Math.round(box.x + box.width * 0.05), R = Math.round(box.x + box.width * 0.20);
    const T = Math.round(box.y + box.height * 0.05), B = Math.round(box.y + box.height * 0.20);
    for (const [x, y] of [[L, T], [R, T], [R, B], [L, B]]) { await page.mouse.click(x, y); await page.waitForTimeout(90); }
    await page.mouse.click(L, T);
    await page.keyboard.press("Escape");
    await selectToolBtn(page).click();

    const mergeBtn = page.getByTitle(/Merge parcels/i);
    await expect(mergeBtn).toBeVisible();
    await mergeBtn.click(); // enters merge-pick mode

    await expect(activeCheckbox(page).first()).toBeVisible();
    await activeCheckbox(page).first().click();
    await expect(activeCheckbox(page).first()).toBeFocused();
    await page.keyboard.press("Escape");

    // Merge picking is off: the Merge button no longer reads the armed (blue) state — checked via
    // its accessible name reverting to the un-counted form.
    await expect(mergeBtn).toHaveText(/^⧉ Merge$/);
    await expect(selectToolBtn(page)).toHaveAttribute("aria-pressed", "true");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* NEW-3 — a MOUSE-ONLY way out, matching the Merge/easement/Parcel-tool banners this file already
   * has. Independent of the Escape fix above: even a user who never finds (or trusts) a keyboard
   * shortcut can now see and click a way out of an in-progress Split. */
  test("the Split banner's Done button abandons the cut without touching the keyboard at all", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { L, R, T, B } = await drawRectParcel(page);

    await page.getByTitle(/Split a parcel/i).click();
    await expect(page.getByText(/Click a cut line across a parcel/i)).toBeVisible();
    const mx = Math.round((L + R) / 2);
    await page.mouse.click(mx, T + 4);
    await page.mouse.click(mx, B - 4);
    await expect(cutPreviewText(page)).toBeVisible();
    await expect(page.getByText(/points on the cut/i)).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();

    await expect(cutPreviewText(page)).toHaveCount(0);
    await expect(selectToolBtn(page)).toHaveAttribute("aria-pressed", "true");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
