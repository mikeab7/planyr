/* B-NEW (2026-11-26, Goose Creek far-zoom report) — how a SWITCHED-OFF parcel (active === false,
 * excluded from the math, "context only", B100) draws its outline.
 *
 * It used to borrow the parcel's own boundary weight (an override can be ~6 screen px) with a fixed
 * "8 6" dash. At that weight an 8 px dash is nearly square, so from far out the lot read as a row of
 * big blue blocks rather than a line ("the partial outline looks like that at such an extended range").
 *
 * The fix is a SCREEN-PIXEL rule, never a zoom factor (owner constraint #23): a switched-off lot is
 * drawn at most INACTIVE_PARCEL_MAX_W px wide, and its dash is proportional to THAT weight, so the
 * dash always reads as a fine dash, at every zoom, on screen and on the printed sheet alike. A lot
 * whose own boundary is already thinner keeps its thinner weight. The ACTIVE boundary is untouched.
 * Pure — unit-tested in test/inactiveParcelLine.test.js. */

export const INACTIVE_PARCEL_MAX_W = 1.5;
// dash : gap as multiples of the line weight → "4 3" at 1.5 px
export const INACTIVE_DASH_ON = 8 / 3;
export const INACTIVE_DASH_OFF = 2;

const r2 = (n) => Math.round(n * 100) / 100;

/** { width, dash } for a switched-off parcel whose own boundary weight is `baseW` screen px. */
export function inactiveParcelStroke(baseW) {
  const w = Number.isFinite(baseW) && baseW > 0 ? Math.min(baseW, INACTIVE_PARCEL_MAX_W) : INACTIVE_PARCEL_MAX_W;
  return { width: r2(w), dash: `${r2(w * INACTIVE_DASH_ON)} ${r2(w * INACTIVE_DASH_OFF)}` };
}
