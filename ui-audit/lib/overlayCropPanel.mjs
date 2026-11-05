/* overlayCropPanel — how a ui-audit harness drives the Site tab OVERLAYS panel's CROP section after NEW-2
 * (2026-10-21): crop is a SWITCH in the section heading. Off = the heading alone; on = the picture + an Adjust
 * button (`overlay-crop-open`). The old Edit / Reset pair and the "Not cropped" / "Polygon · N points" line are gone.
 *
 *   openCropEditor(page, id?)  open the crop editor: Adjust when the crop is on, otherwise the switch (an uncropped
 *                              overlay opens the editor straight away; a kept-but-off shape is switched ON instead —
 *                              pass `{ editor: true }` semantics are never needed because Adjust exists once it is on)
 *   cropOff(page, id?)         "Reset" in the old panel: show the whole sheet again (the shape is KEPT, `crop.off`)
 *   cropState(page, id?)       "on" | "off" read from the switch's aria-checked
 */
const scopeOf = (id) => (id ? `[data-testid="overlay-crop-${id}"] ` : "");
const switchOf = (page, id) => page.locator(`${scopeOf(id)}[data-testid^="overlay-crop-switch-"]`).first();

const dialog = (page) => page.locator('[data-testid="overlay-crop-dialog"]');
export async function openCropEditor(page, id) {
  const adjust = page.locator(`${scopeOf(id)}[data-testid="overlay-crop-open"]`);
  if (await adjust.count()) { await adjust.first().click(); return; }
  // crop is off: with no kept shape the switch opens the editor; with a kept (off) shape it switches ON, and Adjust then opens it
  await switchOf(page, id).click();
  const opened = await dialog(page).waitFor({ state: "visible", timeout: 900 }).then(() => true, () => false);
  if (!opened && (await adjust.count())) await adjust.first().click();
}
// The old panel's "Reset": clear the stored crop to null — now done where it belongs, in the editor (Reset to full page → Done).
export async function clearCrop(page, id) {
  await openCropEditor(page, id);
  await dialog(page).waitFor({ state: "visible", timeout: 8000 });
  await page.locator('[data-testid="crop-reset"]').click();
  await page.locator('[data-testid="crop-done"]').click();
  await dialog(page).waitFor({ state: "detached", timeout: 8000 });
  await page.waitForTimeout(300);
}
export async function cropState(page, id) {
  return (await switchOf(page, id).getAttribute("aria-checked")) === "true" ? "on" : "off";
}
export async function cropOff(page, id) {
  if ((await cropState(page, id)) === "on") await switchOf(page, id).click();
}
