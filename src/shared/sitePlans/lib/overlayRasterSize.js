/* overlayRasterSize — pure sizing math for the site-plan-overlay raster (B972225 NEW-5).
 *
 * THE DECISION (measured on the owner's real C5IP_Airtex_BldgA_PropertyFlyer_Rd5.pdf, see
 * scripts/_tmp_measure_compress.mjs's numbers on the item): rasterizing a PDF page is the
 * expensive step (~700–1300ms in real measurement); re-encoding the SAME already-rendered
 * pixels as JPEG instead of PNG costs tens to low-hundreds of ms more — genuinely "milliseconds"
 * next to the render. So resolution, not codec, is the lever that matters for file size, and it
 * only matters for a page LARGER than a normal flyer sheet: at the app's existing 150 DPI base,
 * his own 8.5x11" flyer page renders to 1275x1650px, well under any sane cap — the cap is
 * insurance for a full civil site-plan sheet (24x36" or bigger), which at the same 150 DPI would
 * rasterize to 3600x5400px+ for a map overlay nobody's screen can show at more than a few
 * thousand pixels at once.
 *
 * `effectiveRasterDpi` therefore never RAISES the DPI above the base — it only ever caps it
 * down, and only when the page is big enough to need it.
 */

/** The DPI to actually render at: the app's normal base DPI, capped down (never up) so the
 *  long edge of the rendered page never exceeds `maxLongEdgePx`. */
export function effectiveRasterDpi(widthPt, heightPt, { baseDpi = 150, maxLongEdgePx = 4000 } = {}) {
  const longEdgePt = Math.max(widthPt || 0, heightPt || 0);
  if (!(longEdgePt > 0)) return baseDpi;
  const capDpi = (maxLongEdgePx / longEdgePt) * 72;
  return Math.min(baseDpi, capDpi);
}

/** Proportionally scale {w,h} down so its long edge is at most `maxLongEdgePx` — never scales
 *  up. Used to build the small list-row thumbnail from an already-rendered raster. */
export function cappedRasterDims(w, h, maxLongEdgePx) {
  const longEdge = Math.max(w || 0, h || 0);
  if (!(longEdge > maxLongEdgePx)) return { w: Math.round(w), h: Math.round(h) };
  const scale = maxLongEdgePx / longEdge;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// The overlay raster is a MAP BACKGROUND, not an archival copy — the original brochure stays
// untouched in Review/Library (see SitePlansSection.jsx's header). These are the app's chosen
// defaults; see the module header for the measurement that picked them.
export const OVERLAY_RASTER_BASE_DPI = 150;
export const OVERLAY_RASTER_MAX_LONG_EDGE_PX = 4000;
export const OVERLAY_RASTER_JPEG_QUALITY = 0.85;
export const OVERLAY_THUMB_MAX_LONG_EDGE_PX = 320;
export const OVERLAY_THUMB_JPEG_QUALITY = 0.7;
