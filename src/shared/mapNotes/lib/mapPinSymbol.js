/* mapPinSymbol — the ONE "symbol circle" every site pin and every note pin is drawn from
 * (NEW-1, owner-approved mockup 2026-09-29, row "C · Symbol circle, revised"). Pure (no Leaflet
 * import) so the geometry is unit-testable; MapFinder wraps the result in `L.divIcon`.
 *
 * ONE SIZE: every pin — any site status, and a note — draws the identical circle. Status/kind sets
 * color, glyph, map opacity and z-order, never size. This deliberately SUPERSEDES B433/B1628913's
 * "size tracks importance" for the map pin and the old "a note is a speech bubble, a third
 * silhouette" rule; comps stay the flat diamond tag (compMarkerIcon.js) and remain distinct.
 *
 * Geometry, in a 28×28 viewBox centred on (14,14): dark hairline disc r=11.4 (near-black @ .45) →
 * white keyline disc r=10.7 → color disc r=8.4 → white glyph. No drop-shadow anywhere (B850016).
 *
 * OPEN pin (the site whose plan is loaded / the note whose editor is open): a ring OUTSIDE the
 * circle — white stroke 3.2 under a color stroke 1.8 at r=13.6. The svg box grows to hold the ring
 * at the SAME scale, so the inner circle renders at exactly the same size as every unopened pin.
 *
 * ANCHOR is the circle's CENTRE for both sites and notes, in a fixed hit box that never changes
 * with status or open state.
 */
import { PALETTES } from "../../theme/palette.js";
import { statusToken } from "../../ui/statusTokens.js";

export const PIN_VIEWBOX = 28;
export const PIN_CENTER = 14;
export const PIN_HAIRLINE_R = 11.4;
export const PIN_KEYLINE_R = 10.7;
export const PIN_DISC_R = 8.4;
export const PIN_RING_R = 13.6;
export const PIN_RING_WHITE_W = 3.2;
export const PIN_RING_COLOR_W = 1.8;
// Fixed hit box, ≥ the previous 34×46 tap target in both directions; the anchor is its centre.
export const PIN_HIT_W = 34;
export const PIN_HIT_H = 46;

// SVG presentation attributes can't use var(), and a map pin sits on satellite imagery, not on
// themed chrome — fixed ink, like the note accent below (see palette.js).
const PIN_INK = "#fff"; // design-exempt: white keyline/glyph on a photograph — SVG attrs can't use var(), fixed across themes
const PIN_HAIRLINE = "#0f1214"; // design-exempt: dark hairline that separates the white keyline from bright imagery — fixed, no token models "over a photo"
const PIN_DOOR = "#000"; // design-exempt: dock-door shade on the white warehouse body — fixed, over a photo

export const NOTE_PIN_COLOR = PALETTES.light.accentNotes; // the --accent-notes magenta

// The open ring's outer extent (white stroke's outer edge) — the box must contain it.
const RING_OUTER = PIN_RING_R + PIN_RING_WHITE_W / 2;
const PAD = Math.ceil(RING_OUTER - PIN_CENTER); // whole units of extra room each side when open

/** Glyphs, all white, all with clear margin to the colored edge (r=8.4). */
function siteGlyph(shape) {
  switch (shape) {
    case "pause":
      return `<rect x="10.7" y="9" width="2.6" height="10" rx="1" fill="${PIN_INK}"/><rect x="14.7" y="9" width="2.6" height="10" rx="1" fill="${PIN_INK}"/>`;
    case "check":
      return `<polyline points="9,14 12.4,17.7 19.4,9.6" fill="none" stroke="${PIN_INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "x":
      return `<path d="M10.6,10.6 L17.4,17.4 M17.4,10.6 L10.6,17.4" stroke="${PIN_INK}" stroke-width="2" stroke-linecap="round"/>`;
    default: // pursuit / active — the small warehouse
      return (
        `<path d="M10.1,17.4 V12.9 L14,11.2 L17.9,12.9 V17.4 Z" fill="${PIN_INK}"/>` +
        [11, 13.2, 15.4].map((x) => `<rect x="${x}" y="15" width="1.6" height="2.4" fill="${PIN_DOOR}" fill-opacity="0.3"/>`).join("")
      );
  }
}

function noteGlyph(color) {
  return (
    `<path d="M11,10 H15.2 L17.4,12.2 V18.2 H11 Z" fill="${PIN_INK}"/>` +
    `<path d="M15.2,10 V12.2 H17.4" fill="none" stroke="${color}" stroke-width="0.9"/>` +
    `<rect x="12.3" y="14.2" width="3.8" height="0.9" fill="${color}"/>` +
    `<rect x="12.3" y="16.1" width="2.6" height="0.9" fill="${color}"/>`
  );
}

function circleSvg({ color, glyph, open }) {
  const pad = open ? PAD : 0;
  const box = PIN_VIEWBOX + pad * 2;
  const c = PIN_CENTER;
  const ring = open
    ? `<circle cx="${c}" cy="${c}" r="${PIN_RING_R}" fill="none" stroke="${PIN_INK}" stroke-width="${PIN_RING_WHITE_W}"/>` +
      `<circle cx="${c}" cy="${c}" r="${PIN_RING_R}" fill="none" stroke="${color}" stroke-width="${PIN_RING_COLOR_W}"/>`
    : "";
  return (
    // 1 svg unit = 1 css px in both states, so the inner circle never changes size.
    `<svg width="${box}" height="${box}" viewBox="${-pad} ${-pad} ${box} ${box}" style="overflow:visible;display:block">` +
    ring +
    `<circle cx="${c}" cy="${c}" r="${PIN_HAIRLINE_R}" fill="${PIN_HAIRLINE}" fill-opacity="0.45"/>` +
    `<circle cx="${c}" cy="${c}" r="${PIN_KEYLINE_R}" fill="${PIN_INK}"/>` +
    `<circle cx="${c}" cy="${c}" r="${PIN_DISC_R}" fill="${color}"/>` +
    glyph +
    `</svg>`
  );
}

/** Pure spec: the svg for a site pin of `status`, open (loaded plan) or not. */
export function sitePinSvg(status, open = false) {
  const t = statusToken(status);
  return circleSvg({ color: t.color, glyph: siteGlyph(t.shape), open });
}

/** Pure spec: the svg for a note pin, open (its editor is showing) or not. */
export function notePinSvg(open = false) {
  return circleSvg({ color: NOTE_PIN_COLOR, glyph: noteGlyph(NOTE_PIN_COLOR), open });
}

/** Rendered size of the circle's own svg box (grows only to hold the open ring). */
export function pinSvgBox(open = false) {
  return PIN_VIEWBOX + (open ? PAD * 2 : 0);
}

/** Fixed hit box + centre anchor, identical for sites and notes in every state. */
export function pinHitBox() {
  return { size: [PIN_HIT_W, PIN_HIT_H], anchor: [PIN_HIT_W / 2, PIN_HIT_H / 2] };
}

/** The wrapper HTML: the svg centred in the fixed hit box so the circle CENTRE is the anchor. */
export function pinHtml(svg, open, opacity = 1) {
  const box = pinSvgBox(open);
  const left = +(PIN_HIT_W / 2 - box / 2).toFixed(1);
  const top = +(PIN_HIT_H / 2 - box / 2).toFixed(1);
  return (
    `<div style="position:relative;width:${PIN_HIT_W}px;height:${PIN_HIT_H}px;opacity:${opacity}">` +
    `<span style="position:absolute;left:${left}px;top:${top}px;display:block;width:${box}px;height:${box}px">${svg}</span>` +
    `</div>`
  );
}
