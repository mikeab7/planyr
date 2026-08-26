// printScale.js (B765985) — the engineering-scale half of the print compose screen.
//
// Today's print path only ever "fits" the drawing to whatever frame the user drags — there
// is no printed ratio anywhere on the sheet, so a printed exhibit can't be measured off with
// a scale rule. This module is the pure math for an EXPLICIT engineering scale (1 inch on
// paper = N feet on the ground): the standard scale list, the frame footprint a given
// scale+sheet implies, and the "does the drawing actually fit" check.
//
// Pure — no DOM, no React — so the fit rule is unit-testable and can't drift from what the
// compose screen displays.

// Common civil-engineering scales, feet per inch. Not exhaustive — the ones a site plan
// exhibit actually gets printed at.
export const STANDARD_SCALES = [10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000];

// "1\" = 40'" — the printed/UI label for a given feet-per-inch scale. `null`/`0` → "Fit to frame"
// (today's behavior: the frame is scaled to whatever fills the page, no stated ratio).
export function scaleLabel(ftPerIn) {
  if (!ftPerIn) return "Fit to frame";
  return `1" = ${ftPerIn}'`;
}

// The frame's real-world footprint (feet) implied by an explicit scale + a sheet's plan box
// (inches — `printSheetLayout(...).plan.{w,h}` divided by 100, since that layout is centi-inch).
// This is deliberately the ONLY way an explicit scale ever sizes a frame — never a fit-to-page
// rescale, which is exactly what would make the ratio a lie.
export function frameFootprintForScale(ftPerIn, planBoxIn) {
  return { wFt: ftPerIn * planBoxIn.w, hFt: ftPerIn * planBoxIn.h };
}

// Does the frame the user actually picked on the canvas (`pickedFrame`, in feet) fit inside
// the footprint a chosen scale+sheet provides (`effectiveFrame`, in feet)? A `null` scale
// (fit-to-frame) always fits, by construction — there is nothing to compare against.
// Returns `{ fits: true }` or `{ fits: false, message }`; the message never proposes silently
// rescaling — it names the choices that actually resolve it (bigger sheet, smaller scale
// meaning a LARGER feet-per-inch number, or picking a smaller area).
export function checkScaleFits(ftPerIn, pickedFrame, effectiveFrame) {
  if (!ftPerIn || !pickedFrame || !effectiveFrame) return { fits: true };
  const overW = pickedFrame.wFt > effectiveFrame.wFt + 1e-6;
  const overH = pickedFrame.hFt > effectiveFrame.hFt + 1e-6;
  if (!overW && !overH) return { fits: true };
  return {
    fits: false,
    message: `The area you framed (${Math.round(pickedFrame.wFt)}′ × ${Math.round(pickedFrame.hFt)}′) is bigger than what ${scaleLabel(ftPerIn)} fits on this sheet (${Math.round(effectiveFrame.wFt)}′ × ${Math.round(effectiveFrame.hFt)}′). Pick a bigger sheet, a smaller scale, or go back and frame a smaller area.`,
  };
}
