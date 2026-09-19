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

/* ---- Polygon crop (NEW-1, B1783328) --------------------------------------------------------
 * Discriminated union, additive to the rect shape above: `{kind:'rect', x,y,w,h}` |
 * `{kind:'poly', pts:[[x,y],...]}`. A crop object with NO `kind` key is read as `rect` — every
 * row written before this shipped (Michael's live overlay, version 208, included) has no `kind`
 * key at all and must keep rendering byte-identically. That is why this is a MIGRATE-ON-READ
 * rule (`cropKind`) rather than a data rewrite: nothing here ever back-fills `kind` onto an
 * existing row.
 *
 * Points are in IMAGE-PIXEL space — the same frame the rect crop already uses — never lat/lon,
 * so a polygon crop survives move/resize/rotate/re-anchor exactly like the rect one: the
 * placement transform is applied to the SAME element the clip is drawn on, after the clip, so
 * neither shape's math needs to know anything about where the overlay currently sits on the map.
 */

export const MIN_POLY_VERTICES = 3;
// Same pixel floor MIN_CROP_PX guards the rect with, applied to the polygon's bounding box and
// to its (unsigned) area — the same fat-fingered-sliver failure, one guard for both shapes.
export const MIN_POLY_BBOX_PX = MIN_CROP_PX;

// 'rect' for a legacy no-key crop (migrate-on-read) or an explicit {kind:'rect'}; 'poly' only
// when the object explicitly says so. Never returns anything else.
export function cropKind(crop) {
  if (!crop) return null;
  return crop.kind === "poly" ? "poly" : "rect";
}

function polygonBoundsPx(pts) {
  if (!Array.isArray(pts) || !pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  for (const p of pts) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    any = true;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

// Unsigned polygon area (shoelace) — used only as a degenerate-shape guard, so winding
// direction (which flips the sign) doesn't matter here.
export function polygonAreaPx(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (!a || !b) return 0;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

// Clamp every vertex into the image's bounds. Never mutates the input; returns null on bad input.
export function clampPolyPoints(pts, imgW, imgH) {
  if (!Array.isArray(pts) || !(imgW > 0) || !(imgH > 0)) return null;
  return pts.map((p) => [
    Math.min(Math.max(0, (p && Number(p[0])) || 0), imgW),
    Math.min(Math.max(0, (p && Number(p[1])) || 0), imgH),
  ]);
}

// Whether `pts` is a usable polygon crop: at least MIN_POLY_VERTICES real vertices, and a
// bounding box + area that clear the same degenerate-sliver floor the rect crop uses — an
// overlay can never be clipped down to nothing and lost, exactly like the rect side.
export function isUsablePoly(pts, imgW, imgH) {
  if (!Array.isArray(pts) || pts.length < MIN_POLY_VERTICES) return false;
  if (!pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false;
  const b = polygonBoundsPx(pts);
  if (!b) return false;
  if (b.maxX - b.minX < MIN_POLY_BBOX_PX || b.maxY - b.minY < MIN_POLY_BBOX_PX) return false;
  if (imgW > 0 && imgH > 0 && polygonAreaPx(pts) < MIN_POLY_BBOX_PX * MIN_POLY_BBOX_PX) return false;
  return true;
}

// The setter a poly-drawing caller runs through before persisting: clamps into the image, then
// refuses (returns null) anything too small/degenerate to be a usable crop — the isUsablePoly
// floor. Unlike the rect side, a poly never "normalizes away" to null just for covering the
// whole image: there's no single natural full-image polygon to collapse to, so a genuinely
// drawn (and usable) polygon is always kept as drawn.
export function normalizePolyCrop(pts, imgW, imgH) {
  const clamped = clampPolyPoints(pts, imgW, imgH);
  if (!clamped || !isUsablePoly(clamped, imgW, imgH)) return null;
  return clamped;
}

// Reversible, one-step conversions between the two shapes. Pure projections only — the CALLER
// (ImageCropTool) is what keeps each shape's own last-drawn value alive across a mode toggle by
// holding both drafts in state rather than deriving one from the other on every switch.
export function rectToPolyPoints(rect) {
  if (!rect) return null;
  const { x, y, w, h } = rect;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
export function polyPointsToRect(pts) {
  const b = polygonBoundsPx(pts);
  if (!b) return null;
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

// The ONE crop-shape validator a DB row reader (or any future writer) runs through — accepts
// null (full image), a legacy-or-explicit rect, or a poly; rejects anything else, so a malformed
// value can never reach rendering as though it were a real crop. `overlayCrop.test.js` is the
// unit proof; the Postgres CHECK constraint (site_plan_overlays_crop.sql) enforces the same
// shape at the write boundary.
export function isValidCropShape(crop) {
  if (!crop) return true;
  if (cropKind(crop) === "poly") {
    return Array.isArray(crop.pts) && crop.pts.length >= MIN_POLY_VERTICES &&
      crop.pts.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }
  return Number.isFinite(crop.x) && Number.isFinite(crop.y) && Number.isFinite(crop.w) && Number.isFinite(crop.h)
    && crop.w > 0 && crop.h > 0;
}

// Dispatches normalizeCrop (rect) / normalizePolyCrop by kind, and stamps the discriminator
// going forward — a NEW rect commit from the tool now writes `{kind:'rect', x,y,w,h}` explicitly
// (only an old, already-persisted row is ever missing the key). Returns null for "no crop."
export function normalizeCropShape(crop, imgW, imgH) {
  if (!crop) return null;
  if (cropKind(crop) === "poly") {
    const pts = normalizePolyCrop(crop.pts, imgW, imgH);
    return pts ? { kind: "poly", pts } : null;
  }
  const rect = normalizeCrop(crop, imgW, imgH);
  return rect ? { kind: "rect", ...rect } : null;
}

// THE single clip-path value for either shape, in IMAGE-LOCAL pixel coordinates — exactly the
// box an overlay's own <img>/<clipPath> already draws in, BEFORE the placement transform is
// applied. One mechanism, not two: a rect renders as `inset(...)` (byte-identical to B1134754's
// original), a polygon as `polygon(evenodd, ...)`. Because the placement transform is applied to
// the SAME element afterward, the clip rotates/scales/moves with the placement for free either way.
//
// SELF-INTERSECTING POLYGON RULE — evenodd, chosen over refuse-to-close: refusing would strand a
// user mid-draw with only Backspace/Escape to recover from one careless click, which is a worse
// failure than rendering a well-defined (if unexpected) region. `evenodd` is what CSS computes
// natively with no extra self-intersection detection on our part, so it costs nothing here and
// is the SAME rule the crop tool's own live preview mask uses, so what you draw is what you get.
export function clipPathValueForCrop(crop, imgW, imgH) {
  if (!crop) return "";
  if (cropKind(crop) === "poly") {
    if (!Array.isArray(crop.pts) || crop.pts.length < MIN_POLY_VERTICES) return "";
    return `polygon(evenodd, ${crop.pts.map(([x, y]) => `${x}px ${y}px`).join(", ")})`;
  }
  if (!(imgW > 0) || !(imgH > 0)) return "";
  const top = Math.max(0, crop.y), left = Math.max(0, crop.x);
  const right = Math.max(0, imgW - crop.x - crop.w), bottom = Math.max(0, imgH - crop.y - crop.h);
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}
