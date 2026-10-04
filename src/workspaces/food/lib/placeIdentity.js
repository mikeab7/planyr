/* placeIdentity — "is this search hit a restaurant he ALREADY has?" — pure JS, no Supabase import.
 *
 * WHY THIS EXISTS (B2046224, owner walk of /food on a phone: searching DAO'N listed it twice, and
 * picking the second copy would have saved it as a brand-new restaurant). A restaurant can live in
 * his data in two shapes — a MANUAL pin (a visit row with place_id null + custom_name/lat/lon, made
 * when the snapshot had nothing, or when he dropped a pin by hand) or a SNAPSHOT place (a visit row
 * pointing at a food_places id) — and the whole-snapshot search returns the snapshot's own record
 * of the same real-world spot. Nothing tied the two together, so the dropdown showed both and the
 * save path happily minted a second record for the second one.
 *
 * THE RULE: two records are the same restaurant when their NAMES are equal after normalising
 * (case, apostrophes — straight or curly —, punctuation, spacing and diacritics all ignored) AND
 * they sit within MERGE_RADIUS_METERS of each other. Name alone is never enough (a chain has the
 * same name every few miles — those are different restaurants and must stay separate rows), and
 * distance alone is never enough (two neighbours). The radius is wider than searchQuality's 150 m
 * snapshot-vs-snapshot collapse because a pin he dropped by hand is only as exact as his fingertip.
 *
 * Deliberately conservative: EQUALITY of normalised names, not "one contains the other" — a false
 * merge opens the wrong restaurant, which is worse than a visible duplicate. The cost of that
 * conservatism (a manual "Dao'n Kitchen" vs a snapshot "DAO'N") is stated, not hidden.
 */

export const MERGE_RADIUS_METERS = 300;

/** Case/punctuation/spacing/diacritic-insensitive name key. "DAO'N", "dao’n" (curly), "Dao N." and
 *  "DAO-N" all read "daon". Empty for a name with no letters or digits. */
export function normalizeName(name) {
  return (name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics (café → cafe)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

const STREET_WORDS = {
  northwest: "nw", northeast: "ne", southwest: "sw", southeast: "se", north: "n", south: "s", east: "e", west: "w",
  freeway: "fwy", highway: "hwy", road: "rd", street: "st", avenue: "ave", boulevard: "blvd", drive: "dr",
  lane: "ln", parkway: "pkwy", court: "ct", circle: "cir", place: "pl", expressway: "expy", suite: "ste",
};

/** The STREET part of an address as a comparable key — "9861 Long Point Rd, Houston, TX, 77055-4107" and
 *  "9861 Long Point Road, Houston, TX 77055" both read "9861 long point rd"; "12950 NW Fwy" and
 *  "12950 Northwest Freeway Ste 100" both read "12950 nw fwy". Zip (5 or +4), city, state and unit are
 *  dropped. null when there is no house-numbered street (so two bare place names never "match"). */
export function addressKey(address) {
  const street = String(address || "").split(",")[0].toLowerCase().replace(/[.#]/g, " ");
  let words = street.split(/[^a-z0-9]+/).filter(Boolean).map((w) => STREET_WORDS[w] || w);
  const unit = words.findIndex((w, i) => i > 1 && (w === "ste" || w === "unit" || w === "apt" || w === "bldg"));
  if (unit > 0) words = words.slice(0, unit);
  if (words.length < 2 || !/^\d+$/.test(words[0])) return null;
  return words.join(" ");
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const hasPoint = (p) => p && p.lat != null && p.lon != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon));
const pt = (p) => ({ lat: Number(p.lat), lon: Number(p.lon) });

/** Are these two records one real-world restaurant? Records need only {name, lat, lon}. */
export function samePlace(a, b) {
  if (!a || !b) return false;
  const na = normalizeName(a.name);
  if (!na || na !== normalizeName(b.name)) return false;
  // Same name + same street address is one restaurant even when the sources geocoded it kilometres apart
  // (production: DAO'N at 9861 Long Point Rd is in the snapshot twice, one copy ~20 km off).
  const ka = addressKey(a.address);
  if (ka && ka === addressKey(b.address)) return true;
  if (!hasPoint(a) || !hasPoint(b)) return false;
  return haversineMeters(pt(a), pt(b)) <= MERGE_RADIUS_METERS;
}

/** Everything he already HAS, as one flat list of {kind, name, lat, lon, ref}: his manual pins
 *  (visited or flagged) and every snapshot place he's logged or flagged. `ref` is the original
 *  object — a manual pin ({key,name,lat,lon,visitIds}) or a place ({id,name,lat,lon}) — so a caller
 *  can open exactly the thing that already exists. Manual pins come first so a tie resolves to the
 *  pin (the older, hand-made record is the one his past visits are attached to). */
export function existingRestaurants({ manualPins = [], wishlistManualPins = [], loggedPlaces = [], wishlistPlaces = [] } = {}) {
  const out = [];
  for (const p of [...manualPins, ...wishlistManualPins]) out.push({ kind: "manual", name: p.name, lat: p.lat, lon: p.lon, ref: p });
  for (const p of [...loggedPlaces, ...wishlistPlaces]) out.push({ kind: "place", name: p.name, lat: p.lat, lon: p.lon, address: p.address, ref: p });
  return out;
}

/** The existing restaurant that `candidate` is a duplicate of, or null. A candidate that IS the
 *  existing record (same place id, or the very same manual pin key) is not "a duplicate of it" — it
 *  returns that record itself so the caller can treat "already his" uniformly. */
export function findExisting(candidate, existing) {
  if (!candidate || !existing?.length) return null;
  // Exact identity first: the same snapshot id, or the same manual pin key.
  if (candidate.id != null) {
    const byId = existing.find((e) => e.kind === "place" && e.ref.id === candidate.id);
    if (byId) return byId;
  }
  if (candidate.key != null) {
    const byKey = existing.find((e) => e.kind === "manual" && e.ref.key === candidate.key);
    if (byKey) return byKey;
  }
  // Then the same real-world spot under another record.
  // Several same-name records in range (two of his own pins a block apart): the NEAREST is the match.
  let best = null, bestD = Infinity;
  for (const e of existing) {
    if (!samePlace(e, candidate)) continue;
    const d = haversineMeters(pt(e), pt(candidate));
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

/** Fold a search's raw rows into one row per restaurant. `manualRows`/`snapshotRows`/`liveRows`
 *  are already-ranked row lists ({kind, name, lat, lon, ...}); `existing` is existingRestaurants().
 *  Output order is manual → snapshot → live with every row that duplicates an EARLIER kept row (or
 *  an existing record) dropped — and a snapshot/live hit that matches an existing manual pin is
 *  REPLACED by that pin's row, so the surviving row is always the thing that already has his visits.
 *  `pinRowFor(existingEntry)` builds the manual-kind row for an existing manual pin the search
 *  query itself didn't surface by name (a punctuation-different spelling). */
export function mergeSearchRows({ manualRows = [], snapshotRows = [], liveRows = [], existing = [], pinRowFor }) {
  const kept = [];
  const dupOfKept = (r) => kept.some((k) => samePlace(k, r) || (r.id != null && k.id === r.id));
  const push = (r) => { if (!dupOfKept(r)) kept.push(r); };

  kept.push(...manualRows); // his own pins are never collapsed into each other — each is a saved record
  for (const r of [...snapshotRows, ...liveRows]) {
    const hit = findExisting(r, existing);
    if (hit && hit.kind === "manual") {
      // The snapshot's record of a restaurant he already has as a manual pin: show the PIN.
      const visited = (hit.ref.visitIds || []).length > 0;
      push(pinRowFor ? pinRowFor(hit) : { ...hit.ref, kind: "manual", mine: visited, wishlisted: !visited });
    } else if (hit && hit.kind === "place" && hit.ref.id !== r.id) {
      // A second snapshot record for a restaurant he's logged under another id: stay on his.
      const own = snapshotRows.find((s) => s.id === hit.ref.id);
      push(own || { ...hit.ref, kind: "place", mine: true }); // collapse onto the record he already has
    } else {
      push(r);
    }
  }
  return kept;
}

/** The ONE answer to "which record does a save/flag on this selection belong to?" — the save-path
 *  guard (B2046224). Returns `{ place_id }` for a snapshot place, or `{ custom_name, custom_lat,
 *  custom_lon }` for a manual pin, and — whatever the selection says — resolves it onto a restaurant
 *  he ALREADY has whenever one matches (samePlace), so a second record for the same place cannot be
 *  created by any route that reaches a write: the search dropdown, a map pin, the list, a dropped
 *  pin typed with an existing name, or a stale selection opened before his visits finished loading.
 *  `selected` is FoodApp's {kind:'place'|'manualPin'|'newPin', ...}; null for an unusable one. */
export function canonicalIdentity(selected, draftName, existing) {
  if (!selected) return null;
  // An existing manual pin IS already a saved record — never remap it (two same-named pins a block
  // apart are two real places, and a name+radius match would land a visit on the wrong one).
  if (selected.kind === "manualPin") return { custom_name: selected.pin.name, custom_lat: selected.pin.lat, custom_lon: selected.pin.lon };
  let cand;
  if (selected.kind === "place") cand = { id: selected.place.id, name: selected.place.name, lat: selected.place.lat, lon: selected.place.lon };
  else if (selected.kind === "newPin") cand = { name: draftName, lat: selected.lat, lon: selected.lon };
  else return null;
  const hit = findExisting(cand, existing);
  if (hit) {
    return hit.kind === "place"
      ? { place_id: hit.ref.id }
      : { custom_name: hit.ref.name, custom_lat: hit.ref.lat, custom_lon: hit.ref.lon };
  }
  return selected.kind === "place"
    ? { place_id: selected.place.id }
    : { custom_name: cand.name, custom_lat: cand.lat, custom_lon: cand.lon };
}
