/* placeIdentity — ONE answer to "is this the same restaurant he already has?" (owner report,
 * 2026-10-04, seen with "DAO'N"): search listed his own saved restaurant AND the matching
 * food_places hit as two rows, and picking the second copy logged his next visit against a brand
 * new record. The search merge (lib/searchMerge.js), the save path (FoodApp submitVisit) and the
 * want-to-try toggle all ask THIS file, so the three can never disagree about what "same" means.
 *
 * Same restaurant = one of
 *   · the same food_places id;
 *   · the same NORMALISED name within NEAR_METERS of each other, where either side may be a manual
 *     pin (place_id null, name + lat/lon on the visit row) or a snapshot place he has logged.
 * Normalised = Unicode-folded, lower-cased, and stripped of everything that is not a letter or digit
 * — so DAO'N, Dao’N, dao n and "  DAO’N " are one name (curly vs straight apostrophes, case and
 * whitespace were exactly what let a duplicate through). Name alone never merges two places: a chain
 * has the same name in every suburb, so the position test is load-bearing (km apart = different).
 *
 * Pure JS, no Supabase import (BUNDLE ISOLATION applies to this folder).
 */

/** Far enough that a pin dropped by thumb on a phone still matches the storefront's own record,
 *  near enough that two branches of one chain never merge (the closest distinct same-brand pair
 *  measured in production sits ~3,540 m apart — see lib/searchQuality.js DEDUPE_RADIUS_METERS). */
export const NEAR_METERS = 300;

export function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\p{M}\p{Lm}]+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const hasCoords = (p) => p && p.lat != null && p.lon != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon));
const pt = (p) => ({ lat: Number(p.lat), lon: Number(p.lon) });

/** Same normalised name AND close together. Missing coordinates never match (a name alone is not
 *  identity — see the header). */
export function sameSpot(a, b) {
  const na = normalizeName(a?.name);
  if (!na || na !== normalizeName(b?.name)) return false;
  if (!hasCoords(a) || !hasCoords(b)) return false;
  return haversineMeters(pt(a), pt(b)) <= NEAR_METERS;
}

/** The restaurant he ALREADY has that `candidate` ({id?, name, lat, lon}) is a copy of, or null.
 *  `manualPins` = manualPinsFromVisits(visits); `ownPlaces` = [{id, name, lat, lon}] for every
 *  snapshot place he has logged (FoodApp's `loggedPlaces`). Preference order: the candidate's own id
 *  (it IS the existing place) → a manual pin → a different logged place record. */
export function findExisting(candidate, { manualPins = [], ownPlaces = [] } = {}) {
  if (!candidate) return null;
  if (candidate.id != null) {
    const self = ownPlaces.find((p) => p.id === candidate.id);
    if (self) return { kind: "place", place: self };
  }
  const pin = manualPins.find((p) => sameSpot(candidate, { name: p.name, lat: p.lat, lon: p.lon }));
  if (pin) return { kind: "manualPin", pin };
  const other = ownPlaces.find((p) => p.id !== candidate.id && sameSpot(candidate, p));
  if (other) return { kind: "place", place: other };
  return null;
}

/** The save-path guard. Given what is currently selected (`selected`: {kind:'place'|'manualPin'|
 *  'newPin', …}) and the draft name for a new pin, decide which record a visit/flag must attach to.
 *  Returns { target, redirected }: `target` is a `selected`-shaped object that is guaranteed to be
 *  his EXISTING record when one exists (so a second record for the same place cannot be created),
 *  and `redirected` says whether it differs from what was selected (the caller re-points the panel). */
export function resolveSaveTarget(selected, manualDraftName, ctx) {
  if (!selected) return { target: selected, redirected: false };
  let candidate;
  if (selected.kind === "place") {
    candidate = { id: selected.place.id, name: selected.place.name, lat: selected.place.lat, lon: selected.place.lon };
  } else if (selected.kind === "newPin") {
    candidate = { name: manualDraftName, lat: selected.lat, lon: selected.lon };
  } else {
    // A manual pin the panel already holds IS a record; only a stale copy (its visits were since
    // merged under a different spelling) needs resolving, which findExisting handles identically.
    candidate = { name: selected.pin.name, lat: selected.pin.lat, lon: selected.pin.lon };
    const same = (ctx.manualPins || []).find((p) => p.key === selected.pin.key);
    if (same) return { target: { kind: "manualPin", pin: same }, redirected: false };
  }
  const hit = findExisting(candidate, ctx);
  if (!hit) return { target: selected, redirected: false };
  if (hit.kind === "place" && selected.kind === "place" && hit.place.id === selected.place.id) {
    return { target: selected, redirected: false };
  }
  return { target: hit, redirected: true };
}
