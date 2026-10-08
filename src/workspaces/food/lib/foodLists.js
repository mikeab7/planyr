/* foodLists — the PURE logic behind named restaurant lists (NEW-1 / B2088288). No Supabase import, so
 * every rule here is unit-testable (test/foodLists.test.js); lib/foodStore.js is the only thing that
 * touches the database.
 *
 * WHAT A LIST IS. A user-named GROUPING of places ("Lunch @ Work", "Dinner After Work"), orthogonal to
 * status. A place may sit on several lists. Status is NOT stored here and never will be: a place is
 * "been" when he has a food_visits row for it, "want to try" when it has a food_wishlist row, and
 * "unmarked" otherwise (statusOf below derives exactly that). Marking somewhere as been is the existing
 * log-a-visit flow; "want to try" stays its own flag with its own auto-clear on a first visit — a list
 * membership is untouched by either.
 *
 * IDENTITY. A list item mirrors food_wishlist: a snapshot place_id, OR a manual pin
 * (custom_name + rounded lat/lon, the manualGroupKey shape). Which record a restaurant is goes through
 * placeIdentity.canonicalIdentity (the save-path guard) — callers resolve with that and then use
 * `toListIdentity` / `addDecision` here, so the same restaurant reached through two different search
 * rows collapses onto ONE membership. A restaurant is never created from a typed name.
 */
import { manualGroupKey, manualPinKey } from "./pinKeys.js";

/** The one fixed palette. A list stores the hex it was given (never computed from its name/position). */
export const LIST_COLORS = [
  { key: "teal", label: "Teal", hex: "#0E8A8A" }, // design-exempt: stored list-colour palette (data, written to the list row; a canvas pin ring cannot read a CSS token)
  { key: "violet", label: "Violet", hex: "#7A4FD6" }, // design-exempt: stored list-colour palette (data, written to the list row; a canvas pin ring cannot read a CSS token)
  { key: "amber", label: "Amber", hex: "#D98A00" }, // design-exempt: stored list-colour palette (data, written to the list row; a canvas pin ring cannot read a CSS token)
  { key: "magenta", label: "Magenta", hex: "#C2328A" }, // design-exempt: stored list-colour palette (data, written to the list row; a canvas pin ring cannot read a CSS token)
  { key: "indigo", label: "Indigo", hex: "#3949C9" }, // design-exempt: stored list-colour palette (data, written to the list row; a canvas pin ring cannot read a CSS token)
  { key: "lime", label: "Lime", hex: "#6B9A12" }, // design-exempt: stored list-colour palette (data, written to the list row; a canvas pin ring cannot read a CSS token)
];
export const DEFAULT_LIST_COLOR = LIST_COLORS[0].hex;
const PALETTE_HEX = new Set(LIST_COLORS.map((c) => c.hex.toLowerCase()));
export const isPaletteColor = (hex) => PALETTE_HEX.has(String(hex || "").toLowerCase());

/** The first palette colour no list is using yet; once all are used, cycles by list count. */
export function nextListColor(lists = []) {
  const used = new Set(lists.map((l) => String(l.color || "").toLowerCase()));
  const free = LIST_COLORS.find((c) => !used.has(c.hex.toLowerCase()));
  return (free || LIST_COLORS[lists.length % LIST_COLORS.length]).hex;
}

/** Trim and collapse inner whitespace — what is stored. */
export const cleanListName = (name) => String(name ?? "").replace(/\s+/g, " ").trim();
/** The comparison key for uniqueness: case-insensitive. (The database index is lower(btrim(name)).) */
export const listNameKey = (name) => cleanListName(name).toLowerCase();

export const LIST_NAME_MAX = 40;

/** Is `name` acceptable for a list? `exceptId` is the list being renamed (it may keep its own name,
 *  or change only its case). → { ok: true, name } | { ok: false, message } — a refusal is a message to
 *  show, never a silent default (a blank name is refused, not replaced). */
export function validateListName(name, lists = [], exceptId = null) {
  const clean = cleanListName(name);
  if (!clean) return { ok: false, message: "Give the list a name." };
  if (clean.length > LIST_NAME_MAX) return { ok: false, message: `Keep the name under ${LIST_NAME_MAX} characters.` };
  const key = listNameKey(clean);
  const clash = lists.find((l) => l.id !== exceptId && listNameKey(l.name) === key);
  if (clash) return { ok: false, message: `You already have a list called "${clash.name}".` };
  return { ok: true, name: clean };
}

/** The position a new list takes (after the last). */
export const nextListPosition = (lists = []) => lists.reduce((m, l) => Math.max(m, Number(l.position) || 0), -1) + 1;

/** An identity ({place_id} | {custom_*}) as the one string that names a restaurant — the same keys the
 *  map draws its pins under (`place:<id>` / FoodMap's manualPinKey), so a membership and a pin meet. */
export function identityKey(ident) {
  if (!ident) return null;
  if (ident.place_id) return `place:${ident.place_id}`;
  if (ident.custom_name != null) return manualPinKey(ident.custom_name, ident.custom_lat, ident.custom_lon);
  return null;
}

/** A stored item row → its identity. */
export function itemIdentity(row) {
  return row.place_id
    ? { place_id: row.place_id }
    : { custom_name: row.custom_name, custom_lat: row.custom_lat, custom_lon: row.custom_lon };
}
export const itemKey = (row) => identityKey(itemIdentity(row));

/** Live (Overpass) rows carry an `osm:…` id that is not in food_places, so a list item for one would
 *  violate the place_id foreign key — it is stored as a MANUAL pin (name + coordinates) instead, the same
 *  shape a dropped pin has. Every other identity passes through unchanged. `candidate` = {name, lat, lon}. */
export function toListIdentity(ident, candidate) {
  if (ident?.place_id && String(ident.place_id).startsWith("osm:")) {
    if (!candidate || candidate.name == null || candidate.lat == null || candidate.lon == null) return null;
    return { custom_name: candidate.name, custom_lat: candidate.lat, custom_lon: candidate.lon };
  }
  return ident || null;
}

/** All rows of one list. */
export const itemsOfList = (items = [], listId) => items.filter((i) => i.list_id === listId);

/** The item row of `listId` that names `ident`, or undefined. */
export function findItem(items = [], listId, ident) {
  const key = identityKey(ident);
  if (key == null) return undefined;
  return items.find((i) => i.list_id === listId && itemKey(i) === key);
}

/** "add" when `ident` is not yet on the list, "already" when it is — the one decision a second search
 *  row of the same restaurant (already collapsed by canonicalIdentity) must come out "already" on. */
export const addDecision = (items, listId, ident) => (findItem(items, listId, ident) ? "already" : "add");

/** The ids of every list `ident` is on (it may be on several). */
export function listIdsFor(items = [], ident) {
  const key = identityKey(ident);
  const out = new Set();
  if (key == null) return out;
  for (const i of items) if (itemKey(i) === key) out.add(i.list_id);
  return out;
}

/** The pin keys on one list — what the map emphasises. null for "no list selected" (All): the map is then
 *  exactly what it was before lists existed. An empty list gives an EMPTY set (nothing emphasised). */
export function emphasisKeys(items = [], listId) {
  if (!listId) return null;
  return new Set(itemsOfList(items, listId).map(itemKey));
}

/** "been" | "want" | "none" — derived, never stored. Been wins (a visited place is never "want").
 *  `ctx` = { loggedIds: Set<place_id>, visitedManualKeys: Set<manualGroupKey>, wishlistIds: Set<place_id>,
 *            wishlistManualKeys: Set<manualGroupKey> }. */
export function statusOf(ident, ctx = {}) {
  if (!ident) return "none";
  const { loggedIds = new Set(), visitedManualKeys = new Set(), wishlistIds = new Set(), wishlistManualKeys = new Set() } = ctx;
  if (ident.place_id) {
    if (loggedIds.has(ident.place_id)) return "been";
    return wishlistIds.has(ident.place_id) ? "want" : "none";
  }
  const k = manualGroupKey(ident.custom_name, ident.custom_lat, ident.custom_lon);
  if (visitedManualKeys.has(k)) return "been";
  return wishlistManualKeys.has(k) ? "want" : "none";
}

/** A list's members as display records, in the order added: { item, key, ident, name, lat, lon, status }.
 *  `nameOf(ident)` → {name, lat, lon} | null for a snapshot place (null while its row is still loading — it
 *  shows as "…" rather than vanishing). */
export function memberRecords(items, listId, { nameOf, statusCtx }) {
  return itemsOfList(items, listId).map((item) => {
    const ident = itemIdentity(item);
    const info = ident.place_id ? nameOf?.(ident) : { name: ident.custom_name, lat: ident.custom_lat, lon: ident.custom_lon };
    return {
      item, ident, key: identityKey(ident),
      name: info?.name ?? "…", lat: info?.lat ?? null, lon: info?.lon ?? null,
      status: statusOf(ident, statusCtx),
    };
  });
}

/** The BROWSABLE rows for the picker — only what he already has (the snapshot is 82k rows and cannot be
 *  browsed; an unmarked place arrives by search or a map tap). `sources` = {been: [...], want: [...]} of
 *  {ident, name, lat, lon}; rows already on `listId` are left out; `filter` = "all" | "been" | "want". */
export function pickerRows(sources, items, listId, filter = "all") {
  const take = (arr, status) => arr
    .filter((r) => !findItem(items, listId, r.ident))
    .map((r) => ({ ...r, status, key: identityKey(r.ident) }));
  const been = filter === "all" || filter === "been" ? take(sources.been || [], "been") : [];
  const want = filter === "all" || filter === "want" ? take(sources.want || [], "want") : [];
  return [...been, ...want];
}
