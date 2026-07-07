// Element-level sync, phase 2 (B671) — explicit z_index utilities.
//
// Before B671, an element's paint order within its type-layer was IMPLICIT: the render/hit-test
// sort (`byZ` in planStyle.js) sorts by the fixed Z_LAYER type table and used ARRAY POSITION as
// the stable tiebreak. That array order is not preserved across the cross-tab union merge, and it
// has no per-row home once elements become individual `site_elements` rows. So each element now
// carries an explicit `z` — the within-type-layer tiebreak — assigned on migrate as
// (array index * Z_GAP) and kept as the stable order thereafter. The Z_LAYER type table still
// dominates paint order (road under paving under building); `z` only orders elements OF THE SAME
// TYPE relative to each other.
//
// Pure — no I/O, no globals. Operates on any collection of objects that may carry a numeric `z`.

import { Z_GAP } from "./elementRows.js";

export { Z_GAP };

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The next free z above every element in `list` (max z + Z_GAP). Used when creating an element
// so it lands on top of its collection. Empty list → 0.
export function nextZ(list) {
  let max = null;
  for (const el of list || []) {
    const z = num(el && el.z);
    if (z != null && (max == null || z > max)) max = z;
  }
  return max == null ? 0 : max + Z_GAP;
}

// Stable order by (z, id). Elements with no numeric z sort as 0 (they'll be normalized on the
// next ensureZ). Plain lexicographic id tiebreak — matches the SQL rebuild's `order by z_index, id`.
export const byZAsc = (a, b) =>
  (num(a && a.z) || 0) - (num(b && b.z) || 0) ||
  (String(a && a.id) < String(b && b.id) ? -1 : String(a && a.id) > String(b && b.id) ? 1 : 0);

export function sortByZ(list) {
  return [...(list || [])].sort(byZAsc);
}

// True if any element lacks a numeric z, two elements share the same z (a tie that array
// order used to break — now ambiguous and in need of a renormalize), or an entry isn't an
// object at all (a null/hole from a bad JSON round-trip — normalizeZ drops those).
export function needsZ(list) {
  const seen = new Set();
  for (const el of list || []) {
    if (!el || typeof el !== "object") return true;
    const z = num(el.z);
    if (z == null) return true;
    if (seen.has(z)) return true;
    seen.add(z);
  }
  return false;
}

// Reassign every element a fresh gapped z by its CURRENT array position (idx * Z_GAP). Returns a
// NEW array of NEW element objects (never mutates inputs). This is the renormalize used both on
// migrate (mirror of the SQL backfill's `(ordinality-1)*1024`) and when gaps are exhausted.
// Non-object entries (null / JSON-round-tripped holes) are DROPPED, never spread — `{...null, z}`
// would manufacture a `{z}` husk with no id/points that poisons every consumer downstream (the
// husk-parcel crash: siteAcres read husk.points.length and error-boundaried the whole planner).
export function normalizeZ(list) {
  return (list || []).filter((el) => el && typeof el === "object").map((el, i) => ({ ...el, z: i * Z_GAP }));
}

// Idempotent: if every element already has a distinct numeric z, return the list UNCHANGED (same
// reference — cheap no-op so it can run on every load without churning React state / commits).
// Otherwise sort by whatever z's exist (falling back to array order) and renormalize. Keeping the
// result z-sorted means array position == z order, so array-position-derived features ("Building N"
// numbering, the byZ within-type tiebreak) stay deterministic.
export function ensureZ(list) {
  const arr = list || [];
  if (!needsZ(arr)) return list;
  return normalizeZ(sortByZ(arr));
}
