/* overlayScaleGeo — the pure rules behind the Map/Comps "Adjust site plan" panel's three scale actions
 * (NEW-7, owner 2026-10-11): "Set scale", "Trace a length", "Match 2 points". Same three actions, same
 * names as the Site tab's Overlays panel; the MATH is the shared overlay engine's (`overlayPlacement.js`
 * `anchorImagePointGeo` / `alignOverlayGeo`, `overlayScale.js`), this file only turns a person's input
 * into a placement patch, or a plain refusal. No React, no Leaflet, no storage.
 *
 * A patch is always { centerLat, centerLon, ftPerPx[, rotationDeg] } — it goes through the SAME
 * placement commit a corner drag uses, so pinned comps follow the new scale. */
import { anchorImagePointGeo, alignOverlayGeo, latLonToImagePoint, visibleCenterPx, validPlacement } from "../../overlay/overlayPlacement.js";
import { ftPerPointForScale, scaleForFtPerPoint, parseDistanceInput, REAL_UNIT_TO_FT } from "../../overlay/overlayScale.js";
import { OVERLAY_RASTER_BASE_DPI, OVERLAY_RASTER_MAX_LONG_EDGE_PX } from "../../overlay/overlayRaster.js";

// Standard drawing sheets, inches (long × short). A page whose raster hit the long-edge cap is matched to
// one by aspect ratio so its true page size — and so its pixels per inch — can be recovered.
const STD_SHEETS_IN = [[11, 8.5], [17, 11], [22, 17], [24, 18], [34, 22], [36, 24], [42, 30], [48, 36]];

/** True when the overlay was rasterised from a PDF page (the only source with a real page size). */
export const isPdfOverlay = (o) => !!o && (/\.pdf$/i.test(o.sourceFileName || "") || (o.reviewId != null && o.page != null && o.page > 0 && !/\.(png|jpe?g|gif|webp)$/i.test(o.sourceFileName || "")));

/** Raster pixels per page inch for a PDF-sourced overlay, or null when it cannot be known. Uncapped pages
 * render at OVERLAY_RASTER_BASE_DPI exactly; a capped (large-format) page is matched to a standard sheet. */
export function rasterPxPerInch(imgW, imgH) {
  const long = Math.max(imgW || 0, imgH || 0), short = Math.min(imgW || 0, imgH || 0);
  if (!(long > 0) || !(short > 0)) return null;
  if (long < OVERLAY_RASTER_MAX_LONG_EDGE_PX - 8) return OVERLAY_RASTER_BASE_DPI;
  const aspect = long / short;
  for (const [l, s] of STD_SHEETS_IN) {
    if (Math.abs(l / s - aspect) / aspect < 0.02 && l * OVERLAY_RASTER_BASE_DPI >= long) return long / l;
  }
  return null;
}

/** Why "Set scale" is unavailable for this overlay, or null when it is available. */
export function setScaleBlock(o) {
  if (!isPdfOverlay(o)) return "Set scale needs a PDF page — use Trace a length or Match 2 points";
  if (!rasterPxPerInch(o.imgW, o.imgH)) return "Can't read this page's size — use Trace a length or Match 2 points";
  return null;
}

/** The sheet scale the overlay currently shows, in feet per page inch (PDF only), else null. */
export function currentFeetPerInch(o) {
  const ppi = isPdfOverlay(o) ? rasterPxPerInch(o.imgW, o.imgH) : null;
  return ppi && o.ftPerPx > 0 ? o.ftPerPx * ppi : null;
}

/** "Set scale": `feetPerInch` (e.g. 40 for 1" = 40') → the patch, scaling about the visible centre. */
export function planSetScale(o, feetPerInch) {
  if (!validPlacement(o) || !(feetPerInch > 0)) return { error: "Enter a scale first." };
  const block = setScaleBlock(o);
  if (block) return { error: block };
  const ftPerPx = feetPerInch / rasterPxPerInch(o.imgW, o.imgH);
  const c = visibleCenterPx(o);
  const next = anchorImagePointGeo(o, c.x, c.y, { ftPerPx });
  return { patch: { centerLat: next.centerLat, centerLon: next.centerLon, ftPerPx } };
}

/** "Trace a length": two clicked map points on the drawing + the real length between them (feet, or any unit
 * via `unit`). Scales about the traced segment's midpoint so what was measured stays where it was. */
export function planTrace(o, a, b, realText, unit = "ft") {
  if (!validPlacement(o) || !a || !b) return { error: "Click both ends of the length first." };
  const real = parseDistanceInput(realText);
  if (!(real > 0)) return { error: "Enter the real length (e.g. 120 or 1/2)." };
  const realFt = real * (REAL_UNIT_TO_FT[unit] ?? 1);
  const pa = latLonToImagePoint(o, o.imgW, o.imgH, a.lat, a.lng ?? a.lon);
  const pb = latLonToImagePoint(o, o.imgW, o.imgH, b.lat, b.lng ?? b.lon);
  if (!pa || !pb) return { error: "Couldn't read those points on the drawing." };
  const px = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  if (!(px > 1e-6)) return { error: "Those two clicks are on the same spot — click the two ends of the length." };
  const ftPerPx = realFt / px;
  const next = anchorImagePointGeo(o, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2, { ftPerPx });
  return { patch: { centerLat: next.centerLat, centerLon: next.centerLon, ftPerPx } };
}

/** "Match 2 points": `pairs` = [{ from: {lat, lng} (a spot on the drawing as it sits now), to: {lat, lng} (where
 * it truly belongs on the map) }] (2 or more complete pairs). Moves, rotates and scales the drawing. */
export function planMatch(o, pairs) {
  if (!validPlacement(o)) return { error: "This plan isn't placed on the map yet." };
  const done = (pairs || []).filter((p) => p && p.from && p.to);
  if (done.length < 2) return { error: "Pick at least 2 matching pairs of points." };
  const mapped = [];
  for (const p of done) {
    const img = latLonToImagePoint(o, o.imgW, o.imgH, p.from.lat, p.from.lng ?? p.from.lon);
    if (!img) return { error: "Couldn't read those points on the drawing." };
    mapped.push({ img, ll: { lat: p.to.lat, lon: p.to.lng ?? p.to.lon } });
  }
  const fit = alignOverlayGeo(o, mapped);
  if (!fit) return { error: "Those points don't pin down a size and direction — pick two that are far apart." };
  const { residualFt, ...patch } = fit;
  return { patch, residualFt, pairs: done.length };
}

export { ftPerPointForScale, scaleForFtPerPoint };
