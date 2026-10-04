/* searchMerge — builds the rows the Food search dropdown shows, with ONE row per real-world
 * restaurant (owner report, 2026-10-04, "DAO'N" listed twice).
 *
 * The dropdown has up to four sources that can all describe the same restaurant:
 *   · his manual pins (a visit with place_id null — name + lat/lon live on the visit row),
 *   · the snapshot places he has logged or flagged,
 *   · the whole-snapshot name-search results (food_places_search_by_name, already ranked/deduped
 *     among themselves by lib/searchQuality.js),
 *   · live OpenStreetMap results from an explicit "search live" press.
 * Searching used to concatenate those lists, so a restaurant he already had appeared once as HIS
 * record and once as the matching snapshot row — and picking the snapshot copy opened a blank
 * restaurant, whose first visit then created a second record.
 *
 * Rule: a result that lib/placeIdentity.js says is a copy of something he already has is REPLACED by
 * that existing record (which keeps its visit history, its "Been here" mark, and is what a pick
 * opens). The existing record is added even if its own name did not match the typed text (he typed
 * "korean", the snapshot row says "Korean BBQ", his pin is called "DAO'N"). The displayed address
 * is borrowed from the snapshot copy when his own record has none (a manual pin never does).
 *
 * Pure JS, no Supabase import.
 */
import { findExisting, normalizeName, sameSpot } from "./placeIdentity.js";

const identityOf = (r) => (r.kind === "manual" ? `pin:${r.key || normalizeName(r.name)}` : `place:${r.id || normalizeName(r.name)}`);

export function mergeSearchResults({
  query, manualPins = [], ownPlaces = [], loggedIds, wishlistIds, snapshotRanked = [], liveMatches = [], cap = 10,
}) {
  const nq = normalizeName(query);
  const ctx = { manualPins, ownPlaces };
  const mine = new Map(); // identity -> row (insertion order = ranking order)
  const addMine = (row) => {
    const k = identityOf(row);
    if (mine.has(k)) return mine.get(k);
    if (row.kind === "manual") {
      // Two manual pins for one storefront (a spelling variant logged a few metres off) read as ONE
      // restaurant here; the surviving row opens the visits of both.
      for (const e of mine.values()) {
        if (e.kind === "manual" && sameSpot(e, row)) {
          e.visitIds = [...new Set([...(e.visitIds || []), ...(row.visitIds || [])])];
          return e;
        }
      }
    }
    mine.set(k, row);
    return row;
  };

  // His own records whose NAME matches what was typed — normalised, so "dao'n" finds "Dao’N".
  if (nq) {
    for (const p of manualPins) {
      if (normalizeName(p.name).includes(nq)) addMine({ ...p, kind: "manual", mine: true });
    }
    for (const p of ownPlaces) {
      if (!normalizeName(p.name).includes(nq)) continue;
      addMine({ ...p, kind: "place", mine: !!loggedIds?.has(p.id), wishlisted: !!wishlistIds?.has(p.id) });
    }
  }

  const rest = [];
  const fold = (row) => {
    const hit = findExisting(row, ctx);
    if (!hit) return false;
    if (hit.kind === "manualPin") {
      const existing = addMine({ ...hit.pin, kind: "manual", mine: true });
      if (!existing.address && row.address) existing.address = row.address;
    } else {
      const own = hit.place;
      const existing = addMine({ ...own, kind: "place", mine: !!loggedIds?.has(own.id), wishlisted: !!wishlistIds?.has(own.id) });
      // A snapshot row for the SAME id carries the richer record (address, category) — use it.
      if (row.id === own.id) { existing.address = row.address ?? existing.address; existing.category = row.category ?? existing.category; }
      else if (!existing.address && row.address) existing.address = row.address;
    }
    return true;
  };

  for (const r of snapshotRanked) { if (!fold(r)) rest.push({ ...r, kind: "place" }); }
  for (const r of liveMatches) { if (!fold(r)) rest.push({ ...r, kind: "live" }); }

  const seen = new Set();
  const out = [];
  for (const r of [...mine.values(), ...rest]) {
    const k = r.kind === "live" ? `live:${r.id || normalizeName(r.name)}:${r.lat}:${r.lon}` : identityOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  // His own first — manual pins, then logged/flagged places — then the rest in their ranked order.
  const isMine = (r) => r.kind === "manual" || !!r.mine;
  return [...out.filter((r) => r.kind === "manual"), ...out.filter((r) => r.kind !== "manual" && isMine(r)), ...out.filter((r) => !isMine(r))].slice(0, cap);
}
