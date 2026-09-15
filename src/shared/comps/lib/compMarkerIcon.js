/* compMarkerIcon — the map marker for a leasing comp. Deliberately a DIFFERENT silhouette from
 * sitePinIcon (site-planner/MapFinder.jsx — a plain solid circle, colored by status; B1628913)
 * so a comp can never be mistaken for a project pin on the same map: a small flat rotated TAG
 * shape (a comp has no status, so no size-tier/glyph machinery), colored by comp type so the
 * three kinds read apart at a glance. Pure — no Leaflet import here, so this is unit-testable;
 * the caller wraps the returned spec in `L.divIcon`.
 */

const TYPE_COLOR = {
  land: "#8a6d3b", // tan/brown — raw land
  building_sale: "#2f6fb0", // blue — a built asset changing hands
  lease: "#3f8f5f", // green — an occupancy deal
};

export function compMarkerColor(compType) {
  return TYPE_COLOR[compType] || "#6b6b6b";
}

/** Pure spec for the marker's HTML — a filled diamond tag with a white keyline (same "solid,
 * never hollow, over an aerial" rule as sitePinIcon) and a short stem to the anchor point.
 *
 * B850016 (NEW-14, owner: "i dont want a halo around comps, white border is fine") — the white
 * backing rect used to carry `filter:drop-shadow(0 0 Npx #fff)` (twice, stacked) on top of
 * already being a solid white shape. A `drop-shadow` blurs the shape's own alpha into a soft
 * glow around it, which is exactly the "fades outward into the satellite imagery" the owner
 * described — the crisp ring this SVG already draws (the white rect showing through the ~1.6px
 * gap between it and the smaller colored rect on top) was there the whole time, underneath the
 * blur. Fix is a deletion, not an addition: drop the filter and the white rect renders as the
 * hard, uniform, fully-opaque border it always geometrically was. Same underlying pattern as
 * `sitePinIcon`'s own white keyline (a solid larger shape behind a solid smaller one, no
 * `drop-shadow`) — that module's own header notes drop-shadow is avoided here for a second
 * reason too (it flashes on re-render).
 */
export function compMarkerSvg(compType, { selected = false } = {}) {
  const col = compMarkerColor(compType);
  const w = selected ? 17 : 14, h = selected ? 17 : 14;
  const cx = w / 2, cy = w / 2;
  const r = (w / 2) - 2;
  // B1628912 (NEW-1) — sized down from 18/22 (owner: comps read heavier than they should next to
  // everything else). The selected state's own distinguishing cue is still mostly the overall
  // SIZE bump above (14->17); the keyline is now a PROPORTION of the marker's own width rather
  // than a fixed px pair, so it grows and shrinks with the marker instead of going hairline at
  // the smaller resting size or looking oversized if the marker is ever resized again.
  const ring = +(w * 0.1).toFixed(2);
  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">` +
    `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="3" ` +
    `transform="rotate(45 ${cx} ${cy})" fill="#fff" stroke="none"/>` +
    `<rect x="${cx - r + ring}" y="${cy - r + ring}" width="${(r - ring) * 2}" height="${(r - ring) * 2}" rx="2" ` +
    `transform="rotate(45 ${cx} ${cy})" fill="${col}" stroke="${col}" stroke-width="0.6"/>` +
    `</svg>`
  );
}

/** Marker anchor size — used by the Leaflet L.divIcon wrapper so the tag's CENTER (not a
 * corner) sits on the comp's coordinate. Kept in lockstep with `compMarkerSvg`'s own w/h —
 * B1628912 (NEW-1) sized both down together; drifting them apart puts a comp off its coordinate. */
export function compMarkerSize(selected = false) {
  const s = selected ? 17 : 14;
  return { size: [s, s], anchor: [s / 2, s / 2] };
}
