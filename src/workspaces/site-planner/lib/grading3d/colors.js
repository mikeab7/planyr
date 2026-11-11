/* The 3D cut-and-fill viewer's palette (owner-only grading layer; NEW-1, 2026-11-11). PURE.
 *
 * The cut / fill ink is the 2D picture's own: `gradingPaint.CUT_RGB` (rust) and `FILL_RGB` (blue), `EDGE_EPS_FT` ("on grade") and
 * `BAND_TINT.fullDepthFt` (the depth at which the tint is full) are IMPORTED, never restated, so the 2D bands and the 3D model cannot
 * drift apart. Everything else here is the viewer's own: the earth tones of the block's sides, the neutral ground, the ghost mesh,
 * the section face. Colours are fixed hex by design — the viewer is a black void with a lit model in it, which does not theme. */
import { CUT_RGB, FILL_RGB, EDGE_EPS_FT, BAND_TINT } from "../gradingPaint.js";

export { CUT_RGB, FILL_RGB };

// design-exempt: the viewer is a fixed black void with a lit model in it — it does not theme (owner spec 2026-11-11: pure black).
export const VOID_HEX = "#000000";
export const NEUTRAL_RGB = [178, 183, 190];     // ground nothing changes on — a light neutral under the tint (pad, courts, untouched land)
export const EARTH_TOP_RGB = [122, 96, 68];     // side faces / section face: earth-brown, lighter at the top
export const EARTH_DEEP_RGB = [58, 44, 31];     // …darker at the base
export const STRATA_RGB = [96, 74, 52];         // the faint horizontal strata lines on the section face
export const GHOST_BRIGHT_RGB = [236, 240, 245]; // existing ground ABOVE the finished grade (cut): bright, floats over the solid
export const GHOST_DIM_RGB = [132, 138, 148];      // existing ground below the finished grade (fill) or on grade: dim
export const OUTLINE_RGB = [255, 255, 255];      // the building outline and the section lines

/* The depth at which the tint reaches full strength — the 2D band's own number. */
export const FULL_DEPTH_FT = BAND_TINT.fullDepthFt;
/* The weakest visible tint for a cell that DOES change (anything past the on-grade epsilon reads as a hint, not as nothing). */
export const MIN_TINT = 0.16;

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* dz = proposed − existing. + = fill (blue), − = cut (rust), ~0 = neutral grey. A non-finite dz (a void) is neutral. Returns 0..255 floats. */
export function groundRgb(dz) {
  if (!Number.isFinite(dz) || Math.abs(dz) <= EDGE_EPS_FT) return NEUTRAL_RGB.slice();
  const t = MIN_TINT + (1 - MIN_TINT) * Math.min(1, Math.abs(dz) / FULL_DEPTH_FT);
  return mix(NEUTRAL_RGB, dz > 0 ? FILL_RGB : CUT_RGB, t);
}
/* The same colour as 0..1 floats (a GPU vertex colour). */
export const toUnit = (rgb) => [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
/* The ghost mesh at a node: existing ABOVE the finished grade (cut) is bright; at or below it, dim. Depth only brightens it. */
export function ghostRgb(dz) {
  if (!Number.isFinite(dz) || dz >= -EDGE_EPS_FT) return GHOST_DIM_RGB.slice();   // dz = proposed − existing: ≥ 0 means existing is at / below the proposed
  return mix(GHOST_DIM_RGB, GHOST_BRIGHT_RGB, Math.min(1, 0.55 + 0.45 * Math.min(1, -dz / FULL_DEPTH_FT)));
}
/* Earth at a fraction f of the way from the base (0) to the top (1). */
export const earthRgb = (f) => mix(EARTH_DEEP_RGB, EARTH_TOP_RGB, Math.max(0, Math.min(1, f)));

// design-exempt: the slice handle's amber — a fixed ink on the black void, the same family as the planner's selection grips
export const HANDLE_HEX = "#F2B233";
