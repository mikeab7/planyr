/* Pure rules behind the Overlays panel (NEW-1 redesign). Browser-free so the "what does this
 * overlay show" decisions are unit-tested rather than living in JSX.
 *
 * KINDS. The scale ratio (1" = N ft) only means something for a PDF: its imgW/imgH are PDF
 * points, so ftPerPx = S/72 (overlayScale.js). A raster image has no paper inch, a DXF has
 * drawing units, a map capture is already true to the map. Never fake a ratio for the others.
 *
 * "NOT SCALED". Additive field `unscaled: true`, written only when an overlay is born from the
 * size-to-fit fallback (or after "Size to view"); every trace / match / typed scale writes
 * `unscaled: false`. An overlay with NO such field — every overlay that exists today — reads as
 * scaled. Nothing is migrated or rewritten. (A DXF is the one kind with its own pre-existing
 * "I guessed" flag, `unitsAssumed`, which reads as not-scaled too.) */
import { scaleForFtPerPoint, matchScalePreset } from "../../../shared/overlay/overlayScale.js";

export const OV_KIND = { PDF: "pdf", IMAGE: "image", DXF: "dxf", MAP: "map" };

export function overlayKind(o) {
  if (!o) return OV_KIND.IMAGE;
  if (o.fromMap) return OV_KIND.MAP;
  if (o.kind === "dxf") return OV_KIND.DXF;
  if (o.sheet || (o.pageCount || 1) > 1 || /\.pdf$/i.test(o.storageKey || "")) return OV_KIND.PDF;
  return OV_KIND.IMAGE;
}

export function isOverlayScaled(o) {
  const k = overlayKind(o);
  if (k === OV_KIND.MAP) return true;
  if (k === OV_KIND.DXF && o.unitsAssumed) return false;
  return o.unscaled !== true;
}

const trim = (n) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");

/** `1" = 200'` for feet-per-inch 200 (an architectural scale shows its own label). */
export function formatScaleRatio(feetPerInch) {
  if (!(feetPerInch > 0)) return "";
  const p = matchScalePreset(feetPerInch);
  if (p) return p.label;
  return `1" = ${trim(feetPerInch)}'`;
}

/** The row's second line: { text, warn }. `warn` colours the whole line amber ("not scaled"). */
export function overlaySubline(o) {
  const k = overlayKind(o);
  const page = (o.pageCount || 1) > 1 ? ` · p. ${o.page || 1}` : "";
  if (k === OV_KIND.MAP) return { text: "Aerial from the map", warn: false };
  if (!isOverlayScaled(o)) return { text: "not scaled" + page, warn: true };
  if (k === OV_KIND.PDF) return { text: formatScaleRatio(scaleForFtPerPoint(o.ftPerPx)) + page, warn: false };
  if (k === OV_KIND.DXF) return { text: "Drawing units" + (o.unitsLabel ? ` · ${o.unitsLabel}` : ""), warn: false };
  return { text: "Image" + page, warn: false };
}

/** Which Placement controls an overlay gets. */
export function placementPlan(o) {
  const k = overlayKind(o);
  const scaled = isOverlayScaled(o);
  return {
    kind: k,
    showRatio: k === OV_KIND.PDF && scaled,           // the "Scale 1" = 200'" line
    showUnits: k === OV_KIND.DXF && scaled,           // "Drawing units" instead of a ratio
    scaleButtons: k === OV_KIND.MAP ? [] : k === OV_KIND.PDF ? ["set", "trace", "match"] : ["trace", "match"],
    notScaledBox: k !== OV_KIND.MAP && !scaled,
    rotate: k !== OV_KIND.MAP,
    crop: k !== OV_KIND.MAP,
    knockout: k === OV_KIND.PDF,
    pageChange: k === OV_KIND.PDF && (o.pageCount || 1) > 1,
  };
}

/** The patch a calibration writes: marks the overlay scaled (and a DXF's guess confirmed). */
export function scaledPatch(o) {
  return overlayKind(o) === OV_KIND.DXF ? { unscaled: false, unitsAssumed: false } : { unscaled: false };
}
