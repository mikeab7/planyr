/* pinKeys — the ONE definition of a manual pin's identity key. Pure JS, no Supabase import, so the
 * pure list logic (foodLists.js) and foodStore.js read the very same function instead of two copies.
 * foodStore.js re-exports both, so every existing import keeps working. */

/** The identity key a manual pin (place_id null) groups under — (name, rounded lat/lon), 4dp
 *  (~11m) so two presses a few feet apart still count as "the same taco truck." Shared between
 *  manualPinsFromVisits (visits), manualWishlistFromRows (want-to-try flags, B669312) and the
 *  restaurant lists (NEW-1 / B2088288) so a manual pin resolves to the SAME key whichever table it
 *  came from. */
export function manualGroupKey(name, lat, lon) {
  return `${name}|${Number(lat).toFixed(4)}|${Number(lon).toFixed(4)}`;
}

/** B1953796 (R5) — the ONE selection/row key for a manual pin (name + rounded lat/lon), used by the
 *  map, the list row highlight and the panel, so two different "Taco Stand" pins never merge. */
export function manualPinKey(name, lat, lon) {
  return `pin:${manualGroupKey(name, lat, lon)}`;
}
