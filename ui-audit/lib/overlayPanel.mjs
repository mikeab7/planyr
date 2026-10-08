/* Shared selectors/actions for the redesigned OVERLAYS panel (NEW-1, 2026-10-08), so the older harnesses that only
 * use the panel to reach a control do not each re-derive its markup. The controls moved: Remove / Hide / Lock are
 * the row's eye, padlock and ⋯ menu; the scale buttons are "Set scale" / "Trace a length" / "Match 2 points"
 * (was "Align to map"); crop is one "Edit" + "Reset" pair; the trim-by-feet fields live in the Crop dialog. */
export const EYE = '[data-testid^="reference-eye-"]';
export const MORE = '[data-testid^="reference-more-"]';

/** ⋯ → Remove overlay on the first (or given) row. */
export async function removeFirstOverlay(page, id) {
  const more = page.locator(id ? `[data-testid="reference-more-${id}"]` : MORE).first();
  await more.click();
  await page.waitForTimeout(250);
  await page.locator("[role=menuitem]", { hasText: /^Remove overlay$/ }).click();
  await page.waitForTimeout(400);
}
/** Click the row's open button for the overlay whose name contains `text`. */
export const openRowByName = (page, text) => page.locator('[data-testid^="reference-open-"]', { hasText: text }).first().click();
