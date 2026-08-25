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
 * never hollow, over an aerial" rule as sitePinIcon) and a short stem to the anchor point. */
export function compMarkerSvg(compType, { selected = false } = {}) {
  const col = compMarkerColor(compType);
  const w = selected ? 22 : 18, h = selected ? 22 : 18;
  const cx = w / 2, cy = w / 2;
  const r = (w / 2) - 2;
  const halo = selected ? 3 : 2;
  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">` +
    `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="3" ` +
    `transform="rotate(45 ${cx} ${cy})" fill="#fff" stroke="none" ` +
    `style="filter:drop-shadow(0 0 ${halo}px #fff) drop-shadow(0 0 ${halo}px #fff)"/>` +
    `<rect x="${cx - r + 1.4}" y="${cy - r + 1.4}" width="${(r - 1.4) * 2}" height="${(r - 1.4) * 2}" rx="2" ` +
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
