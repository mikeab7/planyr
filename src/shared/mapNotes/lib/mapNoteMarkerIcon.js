/* mapNoteMarkerIcon — the map marker for a map note. Pure (no Leaflet import), so the silhouette
 * is unit-testable; the caller wraps the returned HTML in `L.divIcon`, exactly as compMarkerIcon.js
 * is used by MapFinder's comps layer.
 *
 * ⛔ DELIBERATELY A THIRD SILHOUETTE, so nothing on this map can be confused for anything else:
 *   · a SITE is a plain solid CIRCLE, colored by status (sitePinIcon, MapFinder.jsx; B1628913)
 *   · a COMP is a flat rotated DIAMOND tag, colored by comp type (compMarkerIcon.js)
 *   · a NOTE is a rounded SPEECH BUBBLE with a downward tail, in the Notes accent (magenta).
 * Shape AND hue differ, not hue alone — the map is read over aerial imagery, and B433's own
 * colorblind-safety reasoning (coral+green is the red-green confusion pair) applies just as much
 * to telling a note from a comp as it does to telling two deal stages apart.
 *
 * Color comes from the shared theme mirror (`accentNotes` / `onAccentNotes`), never a fourth
 * hand-picked hex: an SVG presentation attribute can't resolve `var(--accent-notes)`, which is
 * exactly what palette.js exists to mirror. The fill is FIXED across themes (module accents are —
 * see palette.js), which is right here: the marker sits on satellite imagery, not on app chrome.
 *
 * Solid fill + a hard white keyline, never a hollow ring and never a `drop-shadow` halo — B434's
 * marker rule (a thin hollow ring vanishes over green imagery) and B850016's (a drop-shadow blurs
 * the shape's own alpha into exactly the glow the owner asked to be rid of on comps).
 */
import { PALETTES } from "../../theme/palette.js";

export const NOTE_MARKER_COLOR = PALETTES.light.accentNotes;   // the --accent-notes magenta
export const NOTE_MARKER_INK = PALETTES.light.onAccentNotes;   // white — the --on-accent-notes token

/** Pure spec for the marker's HTML: a filled rounded-rect bubble with a short tail pointing down
 * at the anchor point, a solid white keyline behind it, and a small mark of "text" inside so the
 * shape reads as a note rather than a generic blob at marker size. */
export function mapNoteMarkerSvg({ selected = false } = {}) {
  const w = selected ? 24 : 20;
  const bodyH = selected ? 18 : 15;   // bubble height, excluding the tail
  const tail = selected ? 5 : 4;
  const h = bodyH + tail;
  const ring = selected ? 2 : 1.6;    // the white keyline's width — same hard-stroke range as comps
  const r = selected ? 5 : 4;
  const cx = w / 2;
  // Tail: a small triangle hanging off the bubble's bottom edge, its apex ON the anchor point.
  const tailPath = (inset) =>
    `M ${cx - (tail - inset)} ${bodyH - inset} L ${cx} ${h - inset * 1.4} L ${cx + (tail - inset)} ${bodyH - inset} Z`;
  const lineY = [bodyH * 0.36, bodyH * 0.58, bodyH * 0.8];
  const lineX0 = ring + 2.6, lineX1 = w - ring - 2.6;
  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">` +
    // white keyline: the same bubble, one ring wider, painted underneath
    `<rect x="0" y="0" width="${w}" height="${bodyH}" rx="${r + 1}" fill="${NOTE_MARKER_INK}"/>` +
    `<path d="${tailPath(0)}" fill="${NOTE_MARKER_INK}"/>` +
    // the bubble itself
    `<rect x="${ring}" y="${ring}" width="${w - ring * 2}" height="${bodyH - ring * 2}" rx="${r}" fill="${NOTE_MARKER_COLOR}"/>` +
    `<path d="${tailPath(ring)}" fill="${NOTE_MARKER_COLOR}"/>` +
    // three short rules = "there is text in here", legible at 20px and gone by nothing
    lineY.map((y, i) => `<rect x="${lineX0}" y="${y - 0.6}" width="${(lineX1 - lineX0) * (i === 2 ? 0.6 : 1)}" height="1.2" rx="0.6" fill="${NOTE_MARKER_INK}" opacity="0.9"/>`).join("") +
    `</svg>`
  );
}

/** Marker size + anchor for the Leaflet L.divIcon wrapper. Unlike a comp's tag (anchored at its
 * CENTER), a note bubble is anchored at the TIP OF ITS TAIL — the tail is what points at the
 * ground, so anchoring anywhere else would sit the note off its own coordinate. */
export function mapNoteMarkerSize(selected = false) {
  const w = selected ? 24 : 20;
  const bodyH = selected ? 18 : 15;
  const tail = selected ? 5 : 4;
  return { size: [w, bodyH + tail], anchor: [w / 2, bodyH + tail] };
}
