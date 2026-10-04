/* mapCamera — the pure half of "put the selected restaurant in the middle of the map the person can
 * actually SEE". FoodMap projects the target, adds this pixel offset, and unprojects: the camera
 * ends up offset from the target by half of whatever covers the map, so the target lands in the
 * middle of the uncovered strip.
 *
 *  · tablet/desktop — a right-hand panel of `panelWidth` covers the map's right edge → shift the
 *    camera RIGHT by half of it (clamped to 80% of the map's width so a narrow window never shifts
 *    the target off the visible area the other way).
 *  · phone — the detail panel is a BOTTOM SHEET of `sheetPx` → shift the camera DOWN by half of it
 *    (clamped to 80% of the map's height). The old code applied the right-rail rule on a phone too,
 *    which parked the pin against the left edge, underneath the sheet.
 */
export function cameraOffsetPx({ width, height, panelWidth, sheetPx, phone }) {
  if (phone) return [0, Math.min(Math.max(sheetPx || 0, 0), height * 0.8) / 2];
  return [Math.min(panelWidth, width * 0.8) / 2, 0];
}
