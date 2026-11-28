/* 2026-11-26 (Goose Creek far-zoom report) — the casing ("halo") behind a site-plan element label
 * that sits OUT on the map: a pond's name, or any label pushed off its own shape onto a leader.
 *
 * It was dark text inside a fat WHITE glow. Over aerial imagery that reads as a cheap sticker; the
 * basemap's own street names do the opposite — WHITE text with a thin DARK edge — and the owner
 * liked those ("maybe it's a reverse halo"). So:
 *   - over the aerial  → white text, thin dark halo (matches the road names);
 *   - on plain paper (aerial hidden) → dark text, thin white halo (the cartographic rule for a light
 *     ground; white-on-light would vanish).
 * Either way the halo is THINNER than before (HALO_THIN of the old width). A label drawn INSIDE its
 * own filled shape has no halo and keeps its contrast ink — unchanged. Same answer on screen and in
 * the PDF/PNG export (the export pass renders this same code with the same aerial setting).
 * Pure — unit-tested in test/labelHalo.test.js. */

export const HALO_THIN = 0.6;
export const AERIAL_LABEL_FILL = "#FFFFFF"; // design-exempt: map-label ink over aerial imagery is fixed, not themed (the printed sheet never goes dark)
export const AERIAL_LABEL_HALO = "rgba(12, 22, 26, 0.85)"; // design-exempt: map-label ink over aerial imagery is fixed, not themed (the printed sheet never goes dark)
export const PAPER_LABEL_HALO = "#FFFFFF"; // design-exempt: map-label ink over aerial imagery is fixed, not themed (the printed sheet never goes dark)

/**
 * @param {{ halo: boolean, onAerial: boolean, ink: string, haloW: number }} o
 *   halo: the label carries a casing (carto/pond or leadered); ink: its dark ink on paper;
 *   haloW: the OLD white-halo width in label space (this returns the thinner one).
 * @returns {{ fill: string, stroke?: string, strokeWidth?: number }}
 */
export function labelHaloStyle({ halo, onAerial, ink, haloW }) {
  if (!halo) return { fill: ink };
  const strokeWidth = Math.round((Number(haloW) || 0) * HALO_THIN * 1000) / 1000;
  return onAerial
    ? { fill: AERIAL_LABEL_FILL, stroke: AERIAL_LABEL_HALO, strokeWidth }
    : { fill: ink, stroke: PAPER_LABEL_HALO, strokeWidth };
}
