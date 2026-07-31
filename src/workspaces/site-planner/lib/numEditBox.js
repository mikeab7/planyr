/* NEW-1 — WHERE the inline numeric editor paints, and AT WHAT SIZE.
 *
 * The owner clicked a setback chip to change 25 ft and sent back one frame showing five things
 * wrong at once (2026-07-31: "I hope I don't have to explain what's wrong with that"):
 *
 *   1  SIZE — the editor was 96 × 30 at 13 px type, editing a 26 × 16 pill with 10.5 px type.
 *      Roughly four times the thing it edits in every dimension.
 *   2  THE VALUE TWICE — it painted ABOVE its anchor (`bp.y - H - 8`), so the editor's "25" and
 *      the chip's "25′" were on screen together, one right above the other.
 *   3  IT COVERED THE WORK — landing on the building, the setback line and the red setback drag
 *      handles: exactly the geometry you are looking at while deciding the number.
 *   4  NATIVE SPINNERS — a bare `input type="number"`, so the browser painted its own chevrons,
 *      which match nothing else in the app (suppressed app-wide in `index.css`; the keyboard
 *      nudge below replaces them).
 *   5  STYLING THAT MATCHED NOTHING — a 2 px accent border, a `ui-monospace` face and a heavy
 *      drop shadow, on a canvas where no other control has any of the three.
 *
 * The fix is an IN-PLACE edit, and this module is the one place that expresses it: given the
 * control that spawned the editor, the editor takes that control's OWN box — same footprint, same
 * type scale, same corner radius. Nothing grows, nothing moves, nothing is covered, and the value
 * appears exactly once because the chip IS the editor (its caller suppresses the static chip while
 * the editor is open, so the two can never both paint).
 *
 * The editor is SHARED — road width, overlay trace length, element resize and aerial calibration
 * all open it, and those anchors are not chips. Passing no `spawn` returns the FLOATING fallback:
 * the same styling and the same absence of spinners, brought down to chip scale, and offset
 * up-and-to-the-side of the anchor rather than centred over it, so the dimension being measured
 * (and the handle under the cursor) stays visible.
 *
 * Pure: no DOM, no React, no feet↔pixel knowledge. Callers hand in a SCREEN anchor.
 */

/* The setback chip's own metrics — the plate the in-place editor must match exactly. These live
 * here, not at the render site, so the guard test can compare the editor against the real chip
 * rather than against a copy of its numbers. */
export const SETBACK_CHIP = { h: 15, fontPx: 9.5, rx: 3.5, minW: 22, charW: 5.35, padW: 10 };

/** Plate width for a chip's text — the historic measure, unchanged. */
export const setbackChipPlateW = (txt) =>
  Math.max(SETBACK_CHIP.minW, Math.round(String(txt).length * SETBACK_CHIP.charW + SETBACK_CHIP.padW));

/** The spawning-control descriptor for a setback chip showing `txt`. */
export const setbackChipSpawn = (txt) => ({
  w: setbackChipPlateW(txt), h: SETBACK_CHIP.h, fontPx: SETBACK_CHIP.fontPx, rx: SETBACK_CHIP.rx,
});

/* The FLOATING fallback, for a caller whose anchor is not a chip. Deliberately close to chip
 * scale (the old 96 × 30 / 13 px is what this item exists to end) and deliberately OFFSET: `dx`
 * pushes it clear of the pointer, `dy` clear of the line it is measuring, so it sits beside the
 * geometry instead of on top of it. */
export const NUMEDIT_FLOAT = { w: 54, h: 18, fontPx: 10.5, rx: 4, dx: 10, dy: 12 };

/**
 * The editor's box, in screen px.
 *
 * @param anchor  {px, py} — the spawning control's CENTRE (in-place) or the click point (floating)
 * @param spawn   {w, h, fontPx, rx} of the control that opened the editor, or null/undefined for
 *                the floating fallback
 * @returns {x, y, w, h, fontPx, rx, inPlace}
 */
export function numEditBox(anchor, spawn) {
  const px = Number(anchor?.px) || 0;
  const py = Number(anchor?.py) || 0;
  if (spawn) {
    // Exactly the chip's rect: same centre, same plate, same optical baseline nudge.
    return { x: px - spawn.w / 2, y: py - spawn.h / 2 - 1, w: spawn.w, h: spawn.h, fontPx: spawn.fontPx, rx: spawn.rx, inPlace: true };
  }
  const f = NUMEDIT_FLOAT;
  return { x: px + f.dx, y: py - f.h - f.dy, w: f.w, h: f.h, fontPx: f.fontPx, rx: f.rx, inPlace: false };
}

/**
 * THE INVARIANT this item exists to keep: a control that edits a small thing may not be
 * enormously bigger than the thing. True when the editor's box and type scale are within `tol`
 * of the control that spawned it.
 */
export function numEditFitsSpawn(box, spawn, tol = 1) {
  if (!box || !spawn) return false;
  return box.w <= spawn.w + tol && box.h <= spawn.h + tol && box.fontPx <= spawn.fontPx + tol;
}

/**
 * ArrowUp / ArrowDown nudge — what replaces the browser's spinner buttons at a size where no
 * button belongs. Shift takes the coarse step. Clamped at zero: every value this editor commits
 * (a setback, a road width, a traced length) is a non-negative distance in feet.
 */
export function nudgeNumEditValue(value, dir, coarse = false) {
  const n = parseFloat(value);
  const base = Number.isFinite(n) ? n : 0;
  const step = coarse ? 10 : 1;
  const next = base + (dir < 0 ? -step : step);
  return String(Math.max(0, Math.round(next * 100) / 100));
}
