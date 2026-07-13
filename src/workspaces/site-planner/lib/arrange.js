/* Site Planner element/markup z-order — "Arrange" (B820 — layer ordering).
 *
 * The Site Planner's Bring-to-Front / Send-to-Back, the sibling of Document Review's Arrange
 * (doc-review/lib/arrange.js, B421) — but Z-BASED, not array-order. Every drawn element already
 * carries an explicit numeric `z` (the within-type-layer stacking key, B671 — see zOrder.js), and
 * that `z` is what BOTH persistence paths order by (the localStorage blob via ensureZ, and the
 * cloud `site_elements.z_index` column). So a reorder here just moves the selected item's `z`
 * relative to its PEERS (the caller decides the peer set):
 *   - an element reorders within its TYPE-LAYER BAND (all buildings, or all parking, …) so the
 *     Z_LAYER guardrail holds — a building can never drop beneath a road/parking (planStyle.js);
 *   - a markup reorders within the markup layer (all markups share one band).
 *
 * The four modes (Bluebeam / Review parity):
 *   "front"    — Bring to Front  (top of the band)
 *   "forward"  — Bring Forward   (swap z with the next peer above)
 *   "backward" — Send Backward   (swap z with the previous peer below)
 *   "back"     — Send to Back    (bottom of the band)
 *
 * reorderByZ returns a MINIMAL patch — { id: newZ, … } for only the 1–2 elements whose z changed
 * (so a reorder is one or two per-row cloud updates, not a whole-band renormalize) — or null when
 * the move is a no-op (unknown/lone id, already at that end, unknown mode). Pure — no I/O, no
 * globals; operates on any collection of objects that carry a numeric `z`.
 */

import { Z_GAP, needsZ, normalizeZ, sortByZ } from "./zOrder.js";

export const ARRANGE_MODES = ["front", "forward", "backward", "back"];

const zNum = (p) => (typeof p?.z === "number" && Number.isFinite(p.z) ? p.z : 0);

// Where `id` sits within `peers` by z order, and whether an op is a no-op. Mirrors the Review
// helper's shape (minus the per-page concept):
//   { count, index, atTop, atBottom } | null (id not found / bad input).
// atTop = drawn last (topmost — Bring to Front / Forward are no-ops); atBottom = drawn first
// (Send to Back / Backward are no-ops). A lone peer (count < 2) reads atTop && atBottom.
export function arrangeFlags(peers, id) {
  const list = (Array.isArray(peers) ? peers : []).filter((p) => p && p.id != null);
  const ordered = sortByZ(list);
  const index = ordered.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const count = ordered.length;
  return { count, index, atTop: index === count - 1, atBottom: index === 0 };
}

// Return a { id: newZ } patch that moves `id` per `mode` within `peers` — or null on a no-op.
// Only the moved element (front/back) or the moved element + its swapped neighbor (forward/
// backward) appear in the patch. If the peers' z is ambiguous (missing or duplicate — needsZ),
// the band is renormalized ONCE (fresh gapped z by current visual order) and those repairs are
// folded into the patch so the move stays well-defined; that self-heal is rare (ensureZ normalizes
// on load) and never fires on a no-op move (the null short-circuits first).
export function reorderByZ(peers, id, mode) {
  if (!ARRANGE_MODES.includes(mode)) return null;
  const list = (Array.isArray(peers) ? peers : []).filter((p) => p && p.id != null);
  if (list.length < 2) return null;

  const patch = {};
  let base = list;
  if (needsZ(list)) {
    base = normalizeZ(sortByZ(list));
    for (const p of base) {
      const orig = list.find((o) => o.id === p.id);
      if (orig && zNum(orig) !== p.z) patch[p.id] = p.z;
    }
  }

  const ordered = sortByZ(base);
  const n = ordered.length;
  const idx = ordered.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const atTop = idx === n - 1, atBottom = idx === 0;
  if ((mode === "front" || mode === "forward") && atTop) return null;
  if ((mode === "back" || mode === "backward") && atBottom) return null;

  const zAt = (i) => zNum(ordered[i]);
  if (mode === "front") patch[id] = zAt(n - 1) + Z_GAP;
  else if (mode === "back") patch[id] = zAt(0) - Z_GAP;
  else if (mode === "forward") { const a = ordered[idx + 1]; patch[id] = zAt(idx + 1); patch[a.id] = zAt(idx); }
  else if (mode === "backward") { const b = ordered[idx - 1]; patch[id] = zAt(idx - 1); patch[b.id] = zAt(idx); }
  return patch;
}
