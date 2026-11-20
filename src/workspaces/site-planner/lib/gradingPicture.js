/* Grading picture — ROUND 9 (B2500224 ×2): ONE LIMIT, READ BY EVERY LAYER OF THE PICTURE.
 *
 * The owner, 2026-10-30, "To the boundary": the panel said "to the property line" and the dashed limit sat just inside the
 * parcel, but the cut band hugged the truck court with a strip of paper and EXISTING contours between it and the limit. Measured
 * on planyr.io (ui-audit diagnose-grading-boundary-live, the owner's Concept A copied to the test account): the moment the panel
 * named the new mode, the band on the map still carried the LAYOUT-mode composition (`data-band-source="contours"`, which only
 * the layout branch produces). The surface — and with it the panel's line, the acreage and the dashed limit — is one result; the
 * band outline, the proposed contours and the existing-contour cut are three more, each traced in the worker off a surface and
 * kept on screen while the next trace is in flight (the round-4 "never flash" rule). Across a LIMIT change that rule painted the
 * old mode's picture under the new mode's name, for as long as the re-trace took (on the owner's machine, a long time).
 *
 * The rule here: the grid's `limit` (proposedSurface.js; `limit.sig` is its identity) is THE limit. A traced picture carries the
 * sig it was traced against and is painted only while that sig is the current one — a re-trace for the SAME limit (an FFE nudge)
 * still keeps the previous picture up, a re-trace for a DIFFERENT limit shows nothing until it lands. The existing-contour cut
 * in boundary mode is the limit itself, read straight off the current grid, so it never waits on a trace at all; in layout mode it
 * is the traced daylight line when that trace is current, else the limit (an honest interim: the graded area is at least that).
 * Pure; the controller (components/GradingController.jsx) is the only caller. */

/* The current limit's identity ("" when the surface has no grading limit). */
export const limitSigOf = (grid) => (grid && grid.limit && grid.limit.sig) || "";

/* Was this traced result made against the limit the surface carries now? */
export const tracedOnLimit = (res, grid) => !!res && !!limitSigOf(grid) && res.limitSig === limitSigOf(grid);

/* The limit's rings, feet: `{ rings, holes }` — outer rings and holes of the limit regions the earthwork may not cross. */
export function limitRingsOf(grid) {
  const L = grid && grid.limit;
  if (!L || !Array.isArray(L.limitRegions)) return null;
  return { rings: L.limitRegions.map((r) => r.outer), holes: L.limitRegions.flatMap((r) => r.holes) };
}

/* What the existing Contour-lines layer is cut OUTSIDE of (feet): boundary mode — the limit, exactly; layout mode — the traced
 * daylight line when that trace is current, else the limit. null when there is no limit. */
export function existingClipFeet(grid, contoursRes) {
  const L = grid && grid.limit;
  if (!L) return null;
  const lim = limitRingsOf(grid);
  if (L.mode === "boundary") return lim;
  if (tracedOnLimit(contoursRes, grid) && contoursRes.daylight && contoursRes.daylight.rings && contoursRes.daylight.rings.length) return contoursRes.daylight;
  return { rings: L.regions.map((r) => r.outer), holes: L.regions.flatMap((r) => r.holes) };
}

/* The proposed contours the canvas may paint: the traced result when it belongs to this limit (with the existing-contour cut
 * from `existingClipFeet`), else an EMPTY set that still carries the cut — never another limit's lines. `toLatLng(ring)` maps a
 * feet ring to [lat, lng] pairs (the Leaflet layer's frame). */
export function publishedContours(contoursRes, grid, toLatLng) {
  if (!grid || !grid.limit) return contoursRes || null;
  const clip = existingClipFeet(grid, contoursRes);
  const clipLatLng = clip && typeof toLatLng === "function" ? { rings: clip.rings.map(toLatLng), holes: clip.holes.map(toLatLng) } : null;
  if (tracedOnLimit(contoursRes, grid)) return { ...contoursRes, daylight: clip, clipLatLng };
  return { key: "", limitSig: limitSigOf(grid), pending: true, interval: contoursRes ? contoursRes.interval : null, levels: [], labels: [], daylight: clip, clipLatLng };
}

/* The band outline the canvas may paint: only one composed against the current limit. */
export const publishedBand = (bandShapes, grid) => (bandShapes && !bandShapes.error && tracedOnLimit(bandShapes, grid) ? bandShapes : null);
