/* NEW-1 (parcel-slow toast without parcels) — WHEN MAY A PARCEL-SOURCE OUTAGE / "SLOW" BANNER BE RAISED.
 *
 * Owner report 2026-10-15: on the plain Site map (no project, metro zoom, Select parcels never used) the banner
 * "That county's parcel server is slow right now — showing statewide outlines…" appeared. Parcels were not in use.
 *
 * ROOT CAUSE. The banner is raised by an outline layer's own health guard (an 8 s hang timer and a 2.5 s "still
 * loading" timer armed from the layer's first request). Turning Select parcels off removes the layers but never
 * cancelled those timers, and `layerInDrawRange` reads a layer that is no longer on a map (`_map` null) as "in range"
 * — "unknown reads as IN" — so a timer armed seconds before the user left the tool fired later, called the
 * outage handler, and put a banner about a layer nobody was looking at on a map with the tool off. Nothing retracted
 * it either (the banner outlives the tool until the view moves away from the named county).
 *
 * THE RULE (one answer, asked by every site that raises the banner): a parcel notice may be raised only when
 *   1. Select parcels is ON (a parcel outline layer is something the user asked for), AND
 *   2. the reporting layer is STILL the live display (not removed, not replaced, not left behind by a view change), AND
 *   3. the layer is inside the zoom range it can draw in (below its floor it asks for no cells — silence is health).
 * Pure so the truth table is unit-tested; the Leaflet wiring that consults it is in MapFinder.jsx.
 */

export function parcelNoticeMayRaise({ selectMode, layerLive, inDrawRange } = {}) {
  return selectMode === true && layerLive === true && inDrawRange !== false;
}

/* Is `layer` still one of the live display layers? An alias key may own the layer, so ask by identity across every
 * key rather than by the key that happened to create it. */
export function isLiveDisplayLayer(displays, layer) {
  if (!displays || !layer) return false;
  return Object.keys(displays).some((k) => displays[k] === layer);
}

/* The generic county banner names "statewide outlines" as the stand-in — true only where a statewide composite exists
 * for that state (`statewideKeysForState(state).length`). Elsewhere it would promise a picture nothing draws, so it
 * says only what is known: the county server is slow and outlines may be missing. (B629/V199's wording finding —
 * the cached-copy case — is already its own message, `cacheFallbackNotice`; this covers the remaining one.) */
/* NEW-1 (Memphis line band, B2289168 ×3) — and it NAMES the county. The owner's Memphis screenshot carried "That county's
 * parcel server is slow…" at the Shelby/DeSoto line, where two county servers are in view and nothing said which one (it was
 * DeSoto: Mississippi has no statewide layer, the only wording that yields "outlines may be missing"). `countyName` is
 * `counties.sourceDisplayName(key)`; without one the old subject stays. */
export function countyOutageMessage(hasStatewideBackup, countyName = null) {
  const who = countyName ? `${countyName}'s` : "That county's";
  return hasStatewideBackup
    ? `${who} parcel server is slow right now — showing statewide outlines; clicking a lot still adds it.`
    : `${who} parcel server is slow right now — its outlines may be missing until it recovers; clicking a lot still asks it.`;
}
