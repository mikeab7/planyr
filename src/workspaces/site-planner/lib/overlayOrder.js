/* Pure draw-order model for placed map REFERENCES (the site model's `sheetOverlays`).
 *
 * NEW-2 — a reference used to have exactly one place it could live: beneath the parcel, the
 * setback band, the elements and the markups. Array order decided which reference drew over
 * which (B461/B654), but nothing could lift ONE of them over the plan itself. That is the
 * control this module adds, as a two-BAND model rather than a free-for-all:
 *
 *   band "below"  — the historic, and still the DEFAULT, home: the reference is a backdrop you
 *                   trace over, so your own property line and massing must stay legible on top.
 *   band "above"  — an explicit per-reference opt-in ("Draw above the plan"), for the case the
 *                   owner hit: a coloured land-plan exhibit you are working ON, where the parcel
 *                   line drawn across it is what's in the way.
 *
 * Two bands, not an arbitrary interleave with the plan's own layers, because the plan's internal
 * stacking (roads → pads → buildings → markups) is a separate, already-solved ordering; a
 * reference only ever needs to be behind ALL of it or in front of ALL of it.
 *
 * Ordering rules kept here so screen, panel and context menu can't drift:
 *  • The array IS the draw order, bottom → top, and it is always band-GROUPED (every "below"
 *    record precedes every "above" record). Every mutator re-groups, so the invariant holds even
 *    for a legacy plan (which has no `aboveParcel` at all, so it is trivially all-"below").
 *  • Bring to front / Send to back move a reference within its OWN band. Crossing bands is the
 *    toggle's job — otherwise "bring to front" would silently promote a backdrop over the parcel.
 *  • Every mutator returns the SAME array reference on a no-op, so a caller can skip its history
 *    push without re-comparing contents.
 */

const arr = (a) => (Array.isArray(a) ? a : []);

export const OVERLAY_BAND_BELOW = "below";
export const OVERLAY_BAND_ABOVE = "above";

/** Which band a reference record draws in. Absent/false/anything-but-true → the default band. */
export const overlayBand = (o) => (o && o.aboveParcel === true ? OVERLAY_BAND_ABOVE : OVERLAY_BAND_BELOW);

/** Split a reference list into its two bands, each keeping its relative array order. */
export function splitOverlayBands(list) {
  const below = [], above = [];
  for (const o of arr(list)) (overlayBand(o) === OVERLAY_BAND_ABOVE ? above : below).push(o);
  return { below, above };
}

/** True when the list is already band-grouped (no "below" record after an "above" one). */
export function overlayBandsGrouped(list) {
  let seenAbove = false;
  for (const o of arr(list)) {
    if (overlayBand(o) === OVERLAY_BAND_ABOVE) seenAbove = true;
    else if (seenAbove) return false;
  }
  return true;
}

/** The canonical draw order, bottom → top. Identity when the list is already grouped. */
export function overlayDrawOrder(list) {
  const a = arr(list);
  if (overlayBandsGrouped(a)) return a;
  const { below, above } = splitOverlayBands(a);
  return below.concat(above);
}

/** The References panel's list order: FRONT-most first, the way every layers panel reads. */
export const overlayPanelOrder = (list) => overlayDrawOrder(list).slice().reverse();

/**
 * Where a reference sits, for greying the Bring-to-front / Send-to-back affordances.
 * `index`/`count`/`atFront`/`atBack` are all WITHIN the record's own band.
 */
export function overlayOrderFlags(list, id) {
  const { below, above } = splitOverlayBands(list);
  for (const [band, group] of [[OVERLAY_BAND_BELOW, below], [OVERLAY_BAND_ABOVE, above]]) {
    const index = group.findIndex((o) => o && o.id === id);
    if (index < 0) continue;
    return { found: true, band, index, count: group.length, atFront: index === group.length - 1, atBack: index === 0 };
  }
  return { found: false, band: null, index: -1, count: 0, atFront: true, atBack: true };
}

/** Move a reference to the front / back of its own band. Same array reference on a no-op. */
export function reorderOverlays(list, id, mode) {
  const a = arr(list);
  if (mode !== "front" && mode !== "back") return a;
  const flags = overlayOrderFlags(a, id);
  if (!flags.found) return a;
  const already = mode === "front" ? flags.atFront : flags.atBack;
  if (already && overlayBandsGrouped(a)) return a;
  const { below, above } = splitOverlayBands(a);
  const group = flags.band === OVERLAY_BAND_ABOVE ? above : below;
  const [item] = group.splice(flags.index, 1);
  if (mode === "front") group.push(item); else group.unshift(item);
  return below.concat(above);
}

/**
 * Promote / demote ONE reference across the parcel. The moved record lands at the FRONT of its
 * new band — you promoted it to see (or grab) it, so burying it under its new neighbours would
 * miss the point — and the band it left keeps its own order untouched.
 * Same array reference when the record is missing or already in that band.
 */
export function setOverlayBand(list, id, above) {
  const a = arr(list);
  const want = above ? OVERLAY_BAND_ABOVE : OVERLAY_BAND_BELOW;
  const cur = a.find((o) => o && o.id === id);
  if (!cur) return a;
  if (overlayBand(cur) === want && overlayBandsGrouped(a)) return a;
  const moved = { ...cur, aboveParcel: !!above };
  const rest = a.filter((o) => o && o.id !== id);
  const { below, above: aboveGroup } = splitOverlayBands(rest);
  if (want === OVERLAY_BAND_ABOVE) aboveGroup.push(moved); else below.push(moved);
  return below.concat(aboveGroup);
}
