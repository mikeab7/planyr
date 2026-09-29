/* mapNoteMarkerIcon — the map marker for a map note. Pure (no Leaflet import), so it is
 * unit-testable; the caller wraps the returned HTML in `L.divIcon`.
 *
 * NEW-1 (owner-approved, 2026-09-29): a note is now the SAME one-size symbol circle a site is
 * (mapPinSymbol.js), in the Notes accent (magenta) with a folded-page glyph, anchored at the
 * circle CENTRE. This SUPERSEDES the earlier "a note is a speech bubble, a deliberately third
 * silhouette" rule. A note is still told apart from a site by hue AND glyph (page vs warehouse /
 * status marks), and from a comp — the flat diamond tag (compMarkerIcon.js) — by shape.
 *
 * `selected` = the note whose editor is open: a ring OUTSIDE the circle, circle size unchanged.
 * Color comes from the shared theme mirror (`accentNotes`), never a hand-picked hex.
 */
import { PALETTES } from "../../theme/palette.js";
import { notePinSvg, pinHitBox } from "./mapPinSymbol.js";

export const NOTE_MARKER_COLOR = PALETTES.light.accentNotes;   // the --accent-notes magenta
export const NOTE_MARKER_INK = PALETTES.light.onAccentNotes;   // white — the --on-accent-notes token

/** The note pin's svg (circle + folded-page glyph; ring when `selected`). */
export function mapNoteMarkerSvg({ selected = false } = {}) {
  return notePinSvg(selected);
}

/** Marker size + anchor for the Leaflet L.divIcon wrapper — the fixed hit box, anchored at its
 * CENTRE (the circle's centre), identical for every state. */
export function mapNoteMarkerSize(/* selected */) {
  return pinHitBox();
}
