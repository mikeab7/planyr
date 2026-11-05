/* trailerOverRoads — TRAILER PARKING ALWAYS DRAWS ABOVE ROADS (NEW-1, owner order 2026-11-05).
 *
 * ⛔ THIS IS A DELIBERATE, OWNER-ORDERED EXCEPTION TO ROOT /CLAUDE.md OWNER CONSTRAINT 10 ("elements
 * stack in creation order, newest on top"). That rule stands for every other pair of types. Owner,
 * verbatim: "showing trailer parking above the roads" and "I'm trying to fix the visual." The case:
 * on Academy › Concept A a road drawn after the building covered the outer edge of a trailer row, while
 * the landscape buffer beyond it (added after the road) stayed on top — the buffer looked detached from
 * the trailer row with a sliver of road between them. Do not widen it to any other type pair, and do
 * not undo it as "a violation of constraint 10": the constraint itself now names this exception.
 *
 * WHAT IT IS: a RENDER-ORDER rule, nothing more. It reads the already z-sorted paint list and moves
 * each trailer row to sit just above the highest road (or road cluster) that painted above it. No `z`
 * is ever written to a saved element, so no plan re-stacks on disk, and a road deleted tomorrow leaves
 * the trailer exactly where it always was in the stack. It is one linear pass over a list that was
 * already sorted — no extra sort, nothing per frame (the caller's memo is keyed on model + selection,
 * never on the view — VIEW-INDEPENDENT-ONCE).
 *
 * THE ONE PLACE THE OWNER'S THREE RULES CANNOT ALL HOLD, stated rather than hidden: "trailer above every
 * road", "roads keep their place against everything else" and "an item already above a trailer stays
 * above it" form a cycle for an item X drawn AFTER the trailer but BEFORE the road (trailer < X < road <
 * trailer). This rule resolves it by moving ONLY the trailer: the trailer rises past the road and past
 * such an X. Everything above the highest road — which is every item added after the road, the buffer in
 * the Academy case — is untouched, and a road never changes its place against anything. Moving the
 * trailer is the minimum visible change: the alternative (pulling roads down) would put every road
 * under everything drawn between, which touches far more of the picture.
 *
 * SEAMS (SCREEN = EXPORT = THUMBNAIL = KMZ): `SitePlanner.jsx` `elPaintItems` (the canvas, the print
 * clone, the editable-PDF annotation order and the PNG/preview all read that one DOM order),
 * `planThumbnail.js` and `kmzExport.js` (their own flat sort). A new surface that paints elements in
 * z-order calls `liftTrailersOverRoads` / `sortElsForPaint` — never its own copy of the rule.
 *
 * The selection lift is NOT touched: a selected road still lifts above everything while selected
 * (it lives in the separate `lifted` list), and a selected trailer lifts with it, trailer above road.
 *
 * Pure. No React, no DOM.
 */

/** A paint item (`SitePlanner.jsx` elPaintItems shape: `{ kind: "el", el }` | `{ kind: "road" }`) or a
 *  bare element: is it a road? A road-network cluster (`kind: "road"`) counts, and so does a lone road
 *  element that is not part of a cluster. */
export const isRoadItem = (it) => !!it && (it.kind === "road" || (it.kind === "el" ? it.el?.type === "road" : it.type === "road"));

/** Is it a trailer-parking row? (`type === "trailer"` — the dock chain's `truckCourt` and buffer pieces
 *  are other types and keep plain draw order, by the owner's decision.) */
export const isTrailerItem = (it) => !!it && (it.kind === "el" ? it.el?.type === "trailer" : it.type === "trailer");

/**
 * Re-order an ascending paint list so every trailer paints above every road that painted above it.
 * Returns the SAME array when nothing needs to move (the common case — no trailer, no road, or the
 * trailer already above them all). Otherwise a new array: the trailers that sat below the last road
 * are lifted to sit right after it, keeping their own relative order; every other item keeps its place.
 */
export function liftTrailersOverRoads(sorted) {
  const list = sorted || [];
  let lastRoad = -1;
  for (let i = list.length - 1; i >= 0; i--) if (isRoadItem(list[i])) { lastRoad = i; break; }
  if (lastRoad < 0) return list;
  let moved = null;
  for (let i = 0; i < lastRoad; i++) if (isTrailerItem(list[i])) (moved || (moved = new Set())).add(i);
  if (!moved) return list;
  const out = [];
  const lifted = [];
  for (let i = 0; i <= lastRoad; i++) (moved.has(i) ? lifted : out).push(list[i]);
  for (let i = lastRoad + 1; i < list.length; i++) out.push(list[i]);
  // `out` already holds everything after the last road; the lifted trailers go right after that road.
  const at = out.length - (list.length - 1 - lastRoad);
  out.splice(at, 0, ...lifted);
  return out;
}

/** The flat-element form (thumbnail, KMZ, tests): z-sort, then apply the rule. `cmp` is `byZ`. */
export function sortElsForPaint(els, cmp) {
  return liftTrailersOverRoads([...(els || [])].sort(cmp));
}

/** Does a plan hold both kinds, i.e. is the rule observable at all? (Arrange's explanation uses it.) */
export function hasTrailerAndRoad(els) {
  let t = false, r = false;
  for (const e of els || []) {
    if (!e) continue;
    if (e.type === "trailer") t = true; else if (e.type === "road") r = true;
    if (t && r) return true;
  }
  return false;
}

/** The plain-words note Arrange shows when an order command on a road/trailer cannot beat this rule
 *  (null when it can). `mode` is arrangeSel's: front | forward | back | backward. */
export function arrangeRuleNote(el, mode, els) {
  if (!el || !hasTrailerAndRoad(els)) return null;
  const up = mode === "front" || mode === "forward";
  if ((el.type === "road" && up) || (el.type === "trailer" && !up)) return "Trailer parking always draws above roads, so this can't change that.";
  return null;
}
