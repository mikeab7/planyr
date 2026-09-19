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

/* B1788912 (2026-09-19, NEW-1) — site elements now stack in CREATION ORDER (their own `z`), never
 * by a fixed type layer (see planStyle.js's SUPERSEDED Z_LAYER block). That makes `z` load-bearing
 * for every element the moment it is drawn, not just for Arrange's within-band tiebreak — so a
 * freshly created element that has no `z` yet must not fall back to `zOrder`'s 0 default (the
 * bottom of the whole drawing) even for the one render before a load-time `ensureZ` would catch it.
 *
 * `withMissingZ` is the gentle sibling of `ensureZ`: it NEVER touches an element that already
 * carries a real numeric z (an Arrange'd 0, or a deliberate negative "sent to back" value, is real
 * and must survive untouched — this is not a renormalize), and it stamps the elements that lack one
 * in their OWN ARRAY ORDER rather than `ensureZ`'s id tie-break, so a batch built in a deliberate
 * sequence (a truck court, then its trailer, then its buffer) keeps that sequence instead of being
 * reshuffled by id. Every stamped element lands above the highest z already in the list — "what you
 * just drew is on top," the whole point of the feature. Idempotent: once every element has a real
 * z, this returns the SAME reference (a no-op `setEls` never fires from it). */
export function withMissingZ(list) {
  const arr = list || [];
  if (!arr.some((el) => el && typeof el === "object" && !Number.isFinite(el.z))) return list;
  let z = nextZ(arr);
  return arr.map((el) => {
    if (!el || typeof el !== "object" || Number.isFinite(el.z)) return el;
    const out = { ...el, z };
    z += Z_GAP;
    return out;
  });
}

/* B1788912 (2026-09-19, NEW-3/CONSTRAINT-CAPTURE) — a legacy element still carrying the retired
 * `bandForce` field (see planStyle.js's SUPERSEDED Z_LAYER block) is folded into an ordinary z on
 * load: "front" lands above every element that doesn't itself carry a forward `bandForce` (so it
 * keeps reading as "on top of everything," now via creation-order z instead of a band), "back"
 * lands below every element that doesn't carry a backward one. The field itself is STRIPPED —
 * `planStyle.zOrder` no longer reads it, so leaving it in place would be dead, misleading data.
 * Relative order among several forced elements is preserved (their own array order), same shape as
 * `withMissingZ`. A record with no `bandForce` anywhere is returned UNCHANGED (same reference), so
 * an already-migrated plan's reload churns nothing. */
export function migrateBandForce(els) {
  const arr = els || [];
  if (!arr.some((el) => el && (el.bandForce === "front" || el.bandForce === "back"))) return els;
  const plain = arr.filter((el) => !el || (el.bandForce !== "front" && el.bandForce !== "back"));
  let maxZ = 0, minZ = 0, seen = false;
  for (const el of plain) {
    const z = el && Number.isFinite(el.z) ? el.z : 0;
    if (!seen || z > maxZ) maxZ = z;
    if (!seen || z < minZ) minZ = z;
    seen = true;
  }
  let front = maxZ + Z_GAP, back = minZ - Z_GAP;
  return arr.map((el) => {
    if (!el || typeof el !== "object") return el;
    if (el.bandForce === "front") { const { bandForce: _bandForce, ...rest } = el; const out = { ...rest, z: front }; front += Z_GAP; return out; }
    if (el.bandForce === "back") { const { bandForce: _bandForce, ...rest } = el; const out = { ...rest, z: back }; back -= Z_GAP; return out; }
    return el;
  });
}
