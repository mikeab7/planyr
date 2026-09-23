/* notesArrows — PURE decisions for arrows BETWEEN RICH-TEXT BOXES (NEW-2, 2026-09-22,
 * superseding sketch mode's own boxes-and-arrows canvas).
 *
 * ⛔ WHY THIS EXISTS, AND WHY IT IS NOT A FOURTH COPY OF THE SAME IDEA. The owner: *"I don't
 * care for the sketch boxes at all... really all I was looking for was to get arrows
 * connecting boxes. That sketch box thing just seems poorly thought out... it'd be better if
 * I just had a free canvas to play with."* Sketch mode's OWN boxes (label + body, `boxSize`
 * estimated by character-wrapping — see `notesSketchModel.js`) are retired; the rich-text
 * `noteAnchor` box from NEW-1 is now the ONLY box on the page. An arrow connects two of THOSE,
 * by `aid`, and is stored as an explicit `{ from, to }` pair on the DOCUMENT itself
 * (`doc.attrs.arrows`) — never inferred from a layout, never implied by an indent, and never a
 * second box model bolted alongside the first.
 *
 * ⛔ THE GEOMETRY IS REUSED, NOT REWRITTEN. `edgePoint` — where a ray from box-centre to
 * box-centre crosses a rectangle's border — is EXACTLY the question sketch mode already
 * answered in `notesSketchModel.js`, and a `noteAnchor`'s `{x, y, w, h}` is the identical shape
 * a sketch box's own layout already produced. Re-exported here rather than imported at each
 * call site, so a caller reaching for "the arrow geometry" always finds it in the module named
 * for arrows, not in the sketch module that used to own the concept.
 *
 * ⛔ AN ARROW NEVER OUTLIVES EITHER BOX IT NAMES (TOMBSTONE-DELETES). Storing `{ from, to }` as
 * bare ids means a box's deletion has to actively CASCADE — `cascadeRemoveArrows` is the one
 * place that happens, called from every anchor-deletion command in the SAME transaction as the
 * delete (one undo step restores box AND arrow together).
 */
export { edgePoint } from "./notesSketchModel.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Defensive normalisation — a stored `arrows` attribute is never trusted blindly. Anything
 *  unreadable is DROPPED (never thrown on); a dangling reference (naming an id this doc does
 *  not currently have) is dropped too, since the box it named is gone and nothing else could
 *  have removed the arrow. */
export function normalizeArrows(raw, validIds) {
  const ids = validIds instanceof Set ? validIds : new Set(validIds || []);
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(raw) ? raw : []) {
    if (!a || typeof a !== "object") continue;
    const from = str(a.from);
    const to = str(a.to);
    if (!from || !to || from === to) continue;
    if (!ids.has(from) || !ids.has(to)) continue;
    const key = `${from} ${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}

/** Rule (3), sketch mode's own: an arrow is EXPLICIT. Refused rather than silently ignored,
 *  with a reason (LOUD-FAILURE's quiet cousin). */
export function addArrow(arrows, from, to, validIds) {
  const list = normalizeArrows(arrows, validIds);
  const ids = validIds instanceof Set ? validIds : new Set(validIds || []);
  if (!ids.has(from) || !ids.has(to)) return { arrows: list, added: false, reason: "an arrow needs two boxes" };
  if (from === to) return { arrows: list, added: false, reason: "a box cannot point at itself" };
  if (list.some((a) => a.from === from && a.to === to)) return { arrows: list, added: false, reason: "that arrow is already there" };
  return { arrows: [...list, { from: str(from), to: str(to) }], added: true, reason: "" };
}

/** Remove one arrow by its ends. */
export function removeArrow(arrows, from, to) {
  return (Array.isArray(arrows) ? arrows : []).filter((a) => !(a.from === from && a.to === to));
}

/** Rule (4): every arrow naming a box in `removedIds`, at EITHER end, goes with it — the ONLY
 *  way an arrow may disappear as a consequence of something else. Returns the surviving list
 *  and the ones taken, so a caller can say how many (LOUD-FAILURE's quiet cousin). */
export function cascadeRemoveArrows(arrows, removedIds) {
  const gone = new Set((removedIds || []).map(String));
  const list = Array.isArray(arrows) ? arrows : [];
  const removed = list.filter((a) => gone.has(a.from) || gone.has(a.to));
  const kept = list.filter((a) => !gone.has(a.from) && !gone.has(a.to));
  return { arrows: kept, removed };
}
