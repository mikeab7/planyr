/* chipStyle — the ONE box every pill / badge / readout in /food is drawn in (NEW-3, 2026-10-23, owner on his iPhone: the "8.0"
 * Food chip under the place name had its text sitting off-centre, extra space above it).
 *
 * WHY it drifted: each chip was its own recipe — `inline-flex` + `alignItems: baseline` + a `minHeight` (the text rides at the TOP of
 * the box and the spare height collects below it), `inline-block` + asymmetric padding, a `minHeight` button with `align-items:center`
 * but a different line-height beside it. So two chips on one row never agreed where their text sat.
 *
 * THE RULE: a chip has an EXPLICIT height, centres its text on BOTH axes (`inline-flex` + `align-items:center`), and sets
 * `line-height: 1` so the line box is exactly the font's em box — with Inter (the one UI face) the digit/cap ink then sits on the box's
 * centre line. Horizontal padding only, never vertical (a vertical pad next to a min-height is how the text got pushed up). Every chip
 * carries `data-chip` so the layout harness (ui-audit/verify-food-visit-sheet-layout.mjs) measures the INK of whatever is on screen
 * against the chip's own centre. test/foodVisitSheetLayout.test.js fails if a chip recipe grows back outside this helper. */
export const CHIP_BASE = Object.freeze({
  display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, boxSizing: "border-box", whiteSpace: "nowrap", verticalAlign: "middle",
});

/** A centred chip box: `height` px tall, `padX` px of horizontal padding, plus any extra declarations (fill, radius, font…). */
export function chipBox(height, padX, extra = {}) {
  return { ...CHIP_BASE, height, minHeight: height, padding: `0 ${padX}px`, ...extra };
}
