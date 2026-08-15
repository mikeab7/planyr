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

/* ⛔ NEW-1 — "SEND TO BACK" MEANS BEHIND EVERYTHING UNDER IT. The two annotation BANDS are one
 * stack from the user's seat, and this is the function that says so.
 *
 * THE DEFECT, measured on the owner's own account (a throwaway duplicate of Goose Creek Plan II),
 * and the reason four correct fixes all missed it. A markup drawn over open land reorders against
 * another markup perfectly — that is the case B421, B820, B671 and B293072/B293073 each tested, and
 * it worked before all four of them. A markup drawn over a BUILDING is the case nobody drove:
 *
 *     right-click the markup → Send to Back → the markup still completely covers the building
 *     re-open the menu       → Send to Back and Send Backward are now GREYED OUT
 *
 * The command RAN. It sent the markup to the back of the MARKUP band, which is entirely above the
 * elements, so nothing moved on screen — and then reported completion by greying itself. The
 * operation the user asked for lived two rows below under a different name ("Send behind
 * buildings"). That is LOUD-FAILURE in its purest form: the app succeeded at a DIFFERENT operation
 * than the one that was asked for, and the only feedback it gave was a disabled row claiming the
 * work was done.
 *
 * THE RULE. For the three annotation families that carry a `behindEls` band — markups, callouts /
 * text boxes, measurements — the ordered stack is `behind` (bottom) then `above` (top), and the
 * four modes address THAT stack, not one band of it:
 *   "back"     → the bottom of the WHOLE stack; crosses the band if it is not already below.
 *   "front"    → the top of the whole stack; crosses up if it is not already above.
 *   "backward" → one step down; at the bottom of the upper band that step CROSSES, landing on top
 *                of the lower band (which is exactly one step down, no more).
 *   "forward"  → the mirror.
 * A move is a no-op — and a row is greyed — only at a TRUE end of the whole stack. Greying can no
 * longer claim completion of something invisible, because there is nothing invisible left to do.
 *
 * ⛔ ELEMENTS ARE DELIBERATELY NOT IN THIS FUNCTION, and that is an owner decision, not an
 * oversight. B316864 settled the cross-band question for site elements: `road → paving → pond →
 * parking → building` stays ABSOLUTE for every untouched element and ordinary Arrange stops at the
 * band edge, with one explicit, named, reversible "Force on top of everything" row as the only way
 * across. The difference that justifies the split: an element's band is an ENGINEERING statement
 * (pavement does not cover a building) that the drawing should keep by default, while an
 * annotation's band is pure presentation — the user drew a rectangle and wants it under or over the
 * plan, and no other meaning attaches. Which is also why the element menu's no-op flash already
 * NAMES the band rule instead of going silent.
 *
 * Returns `{ patch: { id: z, … }, cross: { id, behind } | null }` — or null when the move is a true
 * no-op (already at that end of the whole stack, unknown id/mode). `cross` is present only when the
 * band itself changed, so a caller writes `behindEls` exactly when the band moved.
 */
export function arrangeAcrossBands(items, id, mode) {
  if (!ARRANGE_MODES.includes(mode)) return null;
  const list = (Array.isArray(items) ? items : []).filter((p) => p && p.id != null);
  const t = list.find((p) => p.id === id);
  if (!t) return null;

  const isBehind = (p) => p.behindEls === true;
  const behind = isBehind(t);
  const below = list.filter(isBehind);
  const above = list.filter((p) => !isBehind(p));
  const own = behind ? below : above;
  const flags = arrangeFlags(own, id);
  if (!flags) return null;

  // A move that stays inside the band is the ORIGINAL operation, unchanged — same patch, same
  // minimal-write property. Only the band EDGE cases below are new.
  const within = () => {
    const patch = reorderByZ(own, id, mode);
    return patch ? { patch, cross: null } : null;
  };
  // Land on top of / underneath a destination band, which may be empty (then any z will do).
  const overBand = (band) => (band.length ? zNum(sortByZ(band)[band.length - 1]) + Z_GAP : 0);
  const underBand = (band) => (band.length ? zNum(sortByZ(band)[0]) - Z_GAP : 0);

  if (mode === "back") {
    if (behind) return flags.atBottom ? null : within();
    return { patch: { [id]: underBand(below) }, cross: { id, behind: true } };
  }
  if (mode === "front") {
    if (!behind) return flags.atTop ? null : within();
    return { patch: { [id]: overBand(above) }, cross: { id, behind: false } };
  }
  if (mode === "backward") {
    if (!flags.atBottom) return within();
    if (behind) return null;                    // already at the bottom of the whole stack
    return { patch: { [id]: overBand(below) }, cross: { id, behind: true } };
  }
  // "forward"
  if (!flags.atTop) return within();
  if (!behind) return null;                     // already at the top of the whole stack
  return { patch: { [id]: underBand(above) }, cross: { id, behind: false } };
}

/* The band-aware twin of `arrangeFlags`, for the menu's greying. `atTop` / `atBottom` are now
 * properties of the WHOLE stack: an object is at the back only when it is in the lower band AND at
 * the bottom of it. This is what stops a greyed row claiming an invisible success — a markup alone
 * in the upper band reads `atBottom: false`, because it genuinely has somewhere to go.
 *
 * `count` is the whole family, so "this is the only one on the plan" stays answerable; `alone` is
 * deliberately NOT derived from it here, because a lone annotation over a building is precisely the
 * case that must NOT be greyed. */
export function arrangeBandFlags(items, id) {
  const list = (Array.isArray(items) ? items : []).filter((p) => p && p.id != null);
  const t = list.find((p) => p.id === id);
  if (!t) return null;
  const isBehind = (p) => p.behindEls === true;
  const behind = isBehind(t);
  const own = list.filter((p) => isBehind(p) === behind);
  const f = arrangeFlags(own, id);
  if (!f) return null;
  return {
    count: list.length,
    behind,
    index: f.index,
    atTop: !behind && f.atTop,
    atBottom: behind && f.atBottom,
  };
}

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
