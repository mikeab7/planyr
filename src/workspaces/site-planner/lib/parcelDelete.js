/* The ONE parcel delete (NEW-1, 2026-10-22; owner-approved mockup "one menu, one behaviour, Undo everywhere").
 *
 * Deleting a parcel used to have five entry points that did four different things: the map right-click and the panel page went
 * through one function (history + tombstone + a "Deleted X" Undo toast + a delete-outcome event), while the Parcel tool's Remove
 * click, the right-rail "Delete parcel" row and the panel row's ✕ went through another that did the first two and then said nothing
 * and offered no Undo. A destructive action that is silent from three of five doors is the bug.
 *
 * `SitePlanner.jsx`'s `deleteParcels(ids, entry)` is now the only function that removes a parcel, and it is the only caller of
 * this plan. Every door — the row ⋯, a right-click on a panel row, a right-click on the map, the Delete key, the rail's Parcel
 * tools row, the checked bar, the parcel's own page — ends there. This module is the pure DECISION (which ids are real, what the
 * toast says, what to say when nothing was real); the caller applies it. Pure: no React, no DOM, no I/O.
 *
 * LOCKED PARCELS DELETE LIKE ANY OTHER (owner, verbatim: "NOT to block delete on locked parcels"). Lock means "protect the boundary
 * from edits" — nothing here reads `locked` to refuse, grey out or warn; `lockedCount` rides only so telemetry can see it happened.
 *
 * No "are you sure": Undo (one history step, however many parcels) is the safety net.
 */

const arr = (x) => (Array.isArray(x) ? x : []);

/** Every door a parcel delete can come through — the `entry` on the delete-attempt / delete-outcome events (registered in
 *  deletePlan.DELETE_ENTRIES, which a test keeps in step with these). */
export const PARCEL_DELETE_ENTRIES = [
  "row:menu",      // the panel row's ⋯ menu → "Delete parcel"
  "row:context",   // right-click on a panel row → the same menu
  "row:key",       // Delete / Backspace while a panel row has focus
  "menu:parcel",   // right-click on the parcel on the map → the same menu
  "rail:parcel",   // right rail → Parcel tools ▾ → "Delete parcel"
  "bar:parcel",    // the checked-parcels bar → Delete
  "panel:parcel",  // the parcel's own page → ⋯ → Delete
];

export const STALE_MESSAGE = "⚠ That's already gone — nothing left to delete.";
export const NOTHING_MESSAGE = "⚠ No parcel to delete — pick one first.";

/** "Deleted Parcel 4" for one, "Deleted 3 parcels" for many. */
export function deleteToastText(names) {
  const list = arr(names);
  return list.length === 1 ? `Deleted ${list[0]}` : `Deleted ${list.length} parcels`;
}

/**
 * @param parcels  the live parcel list
 * @param ids      one id or an array of ids (duplicates and falsy values are ignored)
 * @param opts.nameOf  (id) => display name; defaults to "Parcel"
 * @returns {{ ok:false, code:"none"|"stale", message:string, stale:string[] }
 *          | { ok:true, ids:string[], stale:string[], names:string[], toast:string, lockedCount:number }}
 *   `ids` is only the parcels that exist (in the order asked), so ONE history step + ONE tombstone set covers them all; `stale` is
 *   whatever the caller named that was already gone (reported, never silently dropped).
 */
export function planParcelDelete(parcels, ids, { nameOf } = {}) {
  const asked = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((x) => x != null && x !== ""))];
  if (!asked.length) return { ok: false, code: "none", message: NOTHING_MESSAGE, stale: [] };
  const byId = new Map(arr(parcels).map((p) => [p.id, p]));
  const live = asked.filter((id) => byId.has(id));
  const stale = asked.filter((id) => !byId.has(id));
  if (!live.length) return { ok: false, code: "stale", message: STALE_MESSAGE, stale };
  const nm = typeof nameOf === "function" ? nameOf : () => "Parcel";
  const names = live.map((id) => nm(id) || "Parcel");
  return { ok: true, ids: live, stale, names, toast: deleteToastText(names), lockedCount: live.filter((id) => byId.get(id).locked).length };
}
