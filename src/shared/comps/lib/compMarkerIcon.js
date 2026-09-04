/* compMarkerIcon — the map marker for a leasing comp. Deliberately a DIFFERENT silhouette from
 * sitePinIcon (site-planner/MapFinder.jsx) so a comp can never be mistaken for a project pin on
 * the same map: a small flat TAG shape (no ground ring/progress sweep — a comp has no status),
 * colored by comp type so the three kinds read apart at a glance. Pure — no Leaflet import here,
 * so this is unit-testable; the caller wraps the returned spec in `L.divIcon`.
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
  const w = selected ? 22 : 18, h = selected ? 22 : 18;
  const cx = w / 2, cy = w / 2;
  const r = (w / 2) - 2;
  // The selected state's own distinguishing cue is mostly the overall SIZE bump above (18->22);
  // a marginally thicker crisp border on top of that (rather than reproducing the old halo's
  // now-removed 2px-vs-3px blur difference) keeps it visually distinct without reintroducing a
  // glow. Both values sit inside the 1.5-2px hard-stroke range asked for.
  const ring = selected ? 2 : 1.6;
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
 * corner) sits on the comp's coordinate. */
export function compMarkerSize(selected = false) {
  const s = selected ? 22 : 18;
  return { size: [s, s], anchor: [s / 2, s / 2] };
}
