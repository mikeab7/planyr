/* The ONE parcel menu (NEW-1, 2026-10-22): the same items in the same order on the panel row's ⋯, on a right-click of a panel
 * row, and on a right-click of the parcel on the map. Three surfaces used to carry three different lists (the row had Rename /
 * Zoom / Lock / Delete…, the map had Properties / Merge / Clear / label / Delete). This is the only place the list and its order
 * are written; `components/ParcelContextMenu.jsx` is the only thing that draws it, and the two hosts only supply what each id DOES.
 *
 * Order (owner-approved mockup):
 *   Properties · [Rename — combined / split rows only] · Zoom to · Lock/Unlock · Hide/Show acreage label ·
 *   [Reset label position — only once the label was dragged] · [Merge parcels (n) / Clear selection — map only, only while 2+
 *   are shift-picked] · ── · [Un-combine, with "Brings back the n lots" — combined tracts only] · Delete parcel (red, "Del")
 *
 * Delete is NEVER gated on `locked` (owner: lock protects the boundary from edits, not from deletion) — there is no code path here
 * that reads it for that. Pure: no React, no DOM.
 */

/** A row is renameable from the menu when it is a combined tract or a split piece — the same test the panel always used. */
export function isRenameable(row) {
  return !!(row && (row.splitFrom || (row.origin && row.origin.kind === "combined")));
}

/** How many lots Un-combine brings back (0 = this parcel was not made by combining). */
export function combinedLotCount(pc) {
  const from = pc && pc.combined && pc.combined.from;
  return Array.isArray(from) ? from.length : 0;
}

/**
 * @param pc     the stored parcel (locked / chipHidden / labelOffset / combined)
 * @param opts   renameable (row-based), mergeCount (map menu: how many are shift-picked; 0 elsewhere)
 * @returns {Array<{id:string, label?:string, sub?:string, hint?:string, danger?:boolean}>}  `{id:"divider"}` is a rule.
 */
export function parcelMenuItems(pc, { renameable = false, mergeCount = 0 } = {}) {
  const p = pc || {};
  const out = [{ id: "properties", label: "Properties" }];
  if (renameable) out.push({ id: "rename", label: "Rename" });
  out.push({ id: "zoom", label: "Zoom to" });
  out.push({ id: "lock", label: p.locked ? "Unlock" : "Lock" });
  out.push({ id: "chip", label: p.chipHidden ? "Show acreage label" : "Hide acreage label" });
  if (!p.chipHidden && p.labelOffset) out.push({ id: "chipReset", label: "Reset label position" });
  if (mergeCount >= 2) {
    out.push({ id: "merge", label: `Merge parcels (${mergeCount})` });
    out.push({ id: "clearSel", label: "Clear selection" });
  }
  out.push({ id: "divider" });
  const n = combinedLotCount(p);
  if (n > 0) out.push({ id: "uncombine", label: "Un-combine", sub: `Brings back the ${n} lots` });
  out.push({ id: "delete", label: "Delete parcel", hint: "Del", danger: true });
  return out;
}
