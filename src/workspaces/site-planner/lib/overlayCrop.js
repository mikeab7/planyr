/* Site-plan overlay crop (B719779). Pure geometry — no DOM — so the trim math is independently
 * unit-tested.
 *
 * "Whenever we place a site plan over, the ability to crop that site plan would be very helpful
 * because we sometimes don't need all the white space." (owner)
 *
 * NON-DESTRUCTIVE BY DESIGN: `o.crop = { x, y, w, h }` in IMAGE PIXELS (the same unit as
 * `o.imgW`/`o.imgH`) is additive to the existing record — the persisted raster (`src`/`storageKey`/
 * `idbKey`) is never touched, so widening or clearing the crop later recovers the full original
 * picture with no re-import. Sparse like every other overlay/settings flag in this codebase: no
 * crop key at all = the full image, and a crop that happens to cover the whole image normalizes
 * back to "no key" rather than persisting a no-op rect.
 *
 * ⛔ RASTERISATION COST — WHAT THIS DOES AND DOES NOT DO, so a later session doesn't assume more
 * than was actually built. `SitePlanner.jsx` applies the crop rect as an SVG `<clipPath>` on the
 * placed `<image>`; a clipped-out region is never painted to the framebuffer by the browser's own
 * compositor, so a heavily-cropped overlay genuinely costs less to paint/composite on every pan and
 * zoom, and the same clip carries through to the export (`buildExportSvg` clones the live SVG). What
 * this does NOT do is shrink the PDF.js re-raster this overlay's zoomed-in "hi-res" tier produces
 * (`overlayPdf.rasterizePageHiRes`, the B251136/B251137 hot path) — that still renders the FULL page
 * at the requested scale regardless of crop. Doing that safely needs the hi-res `<image>`'s on-screen
 * box AND the export's blob→persisted-src swap (`exportSheet.js` `inlineImages`) to agree on a
 * crop-shaped box instead of the whole-image box they share today, and this repo's own guidance on
 * that exact code path is "read both headers before touching either" (B251136/B251137, /CLAUDE.md) —
 * not a change to make without the visual verification tooling to prove a wrong transform doesn't
 * silently stretch a real placed drawing. Left as clearly-scoped follow-up (see the item filed
 * alongside this one), not attempted half-built here.
 */

// Below this many image px on either edge a crop reads as "nothing useful left" — guards against a
// fat-fingered trim collapsing the overlay to an unselectable sliver.
export const MIN_CROP_PX = 8;

// Clamp a proposed crop rect into the image's bounds, on a POSITIVE finite imgW/imgH. Never mutates
// the input; returns a fresh { x, y, w, h }, or null if imgW/imgH themselves aren't usable.
export function clampCropRect(crop, imgW, imgH) {
  if (!(imgW > 0) || !(imgH > 0) || !crop) return null;
  const x = Math.min(Math.max(0, crop.x || 0), imgW - MIN_CROP_PX);
  const y = Math.min(Math.max(0, crop.y || 0), imgH - MIN_CROP_PX);
  const w = Math.min(Math.max(MIN_CROP_PX, crop.w || 0), imgW - x);
  const h = Math.min(Math.max(MIN_CROP_PX, crop.h || 0), imgH - y);
  return { x, y, w, h };
}

// A crop that (after clamping) covers the whole image is not a crop at all.
export function isFullCrop(crop, imgW, imgH) {
  if (!crop) return true;
  const c = clampCropRect(crop, imgW, imgH);
  if (!c) return true;
  return c.x <= 0.01 && c.y <= 0.01 && c.x + c.w >= imgW - 0.01 && c.y + c.h >= imgH - 0.01;
}

// The one setter every caller (the panel's trim fields, a future drag-to-crop gesture) should run
// through before persisting: clamps, then collapses a no-op (whole-image) crop to `null` so an
// untouched — or reset — overlay carries no `crop` key at all.
export function normalizeCrop(crop, imgW, imgH) {
  if (isFullCrop(crop, imgW, imgH)) return null;
  return clampCropRect(crop, imgW, imgH);
}

export const hasCrop = (o) => !!(o && o.crop);

// The box actually visible/interactive, in image px — the crop rect, or the full image when unset.
export function effectiveCropRect(o) {
  if (o && o.crop) return o.crop;
  return { x: 0, y: 0, w: (o && o.imgW) || 0, h: (o && o.imgH) || 0 };
}

// The crop rect in SCREEN px, in the SAME coordinate space the overlay's own <image> already draws
// in (top-left `tl`, feet-per-image-px `ftPerPx`, current view scale `rppf`) — so it can be handed
// straight to an SVG <clipPath>'s <rect> with no further transform.
export function cropClipRectScreen(o, tl, ftPerPx, rppf) {
  const c = effectiveCropRect(o);
  const k = ftPerPx * rppf;
  return { x: tl.x + c.x * k, y: tl.y + c.y * k, width: c.w * k, height: c.h * k };
}

// The panel's four trim fields, in FEET (never px — this app is feet-everywhere-internal at the UI
// boundary), derived from the overlay's current crop (or zero trim, full image, when unset).
export function cropTrimFeet(o) {
  const c = effectiveCropRect(o);
  const ftPerPx = (o && o.ftPerPx) || 0;
  const imgW = (o && o.imgW) || 0, imgH = (o && o.imgH) || 0;
  return {
    left: c.x * ftPerPx,
    top: c.y * ftPerPx,
    right: (imgW - c.x - c.w) * ftPerPx,
    bottom: (imgH - c.y - c.h) * ftPerPx,
  };
}

// Inverse of cropTrimFeet: four edge trims in feet -> a normalized crop rect (or null, if the trims
// amount to no crop at all). Negative/NaN trims read as 0 (never expand past the image edge).
export function cropFromTrimFeet(trim, o) {
  const imgW = (o && o.imgW) || 0, imgH = (o && o.imgH) || 0, ftPerPx = (o && o.ftPerPx) || 0;
  if (!(imgW > 0) || !(imgH > 0) || !(ftPerPx > 0)) return null;
  const clean = (v) => (Number.isFinite(v) && v > 0 ? v / ftPerPx : 0); // feet -> image px
  const left = clean(trim && trim.left), top = clean(trim && trim.top);
  const right = clean(trim && trim.right), bottom = clean(trim && trim.bottom);
  return normalizeCrop({ x: left, y: top, w: imgW - left - right, h: imgH - top - bottom }, imgW, imgH);
}
