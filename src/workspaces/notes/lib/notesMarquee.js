/* notesMarquee — ONE GESTURE ON EMPTY PAGE, THREE MEANINGS: DISTANCE, THEN THE MODIFIER (B421494,
 * extended by NEW-1/NEW-2).
 *
 * ⛔ READ THE DISTANCE RULE BELOW FIRST — IT IS UNCHANGED, AND THAT IS THE POINT. A third meaning
 * (pan the canvas) arrived without touching the boundary that four rounds of work went into: a
 * press that does not travel is still a PLACE, and only a press that DOES travel now has to ask
 * which of the two travelling meanings it is. Shift says marquee; nothing says pan. See
 * `gestureOutcome` and `latchGesture`.
 *
 * ⛔ THE PROBLEM THIS FILE EXISTS TO SETTLE, and it is the reason marquee select was deferred a
 * round rather than bolted on. A press on blank page ALREADY means something: it places a box
 * there. Selecting several boxes wants the same press to mean "start a rubber band". One pointer,
 * two meanings — and if the boundary between them is wrong, the cost is not a missing feature but
 * a WORSE version of the feature that already worked: a stray box left behind every time somebody
 * tries to select, or a selection that never starts because the press placed something instead.
 *
 * ⛔ THE BOUNDARY IS DISTANCE, AND IT IS DECIDED AT MOUSE-UP, NEVER AT MOUSE-DOWN. A press that
 * travelled less than `DRAG_SLOP` is a PLACE; anything beyond it is a SELECT. Deciding at
 * mouse-down is impossible (the future is not knowable) and deciding at first-move is worse — a
 * one-pixel tremor, which every real hand produces, would silently change what the gesture meant.
 * `DRAG_SLOP` is the same order as the browser's own click tolerance for exactly that reason.
 *
 * ⛔ AND A GESTURE THAT BECAME A SELECTION MUST NOT ALSO PLACE. The two outcomes are exclusive:
 * `gestureOutcome` returns one of `"place"` / `"select"`, never both and never neither, so no
 * caller can implement the exclusivity slightly differently from another.
 *
 * Everything here is PURE — no DOM, no editor, no React. The wiring lives in `NoteEditor.jsx`;
 * the decisions live here where they can be tested at zero pixels, one pixel, and either side of
 * the threshold, which is exactly what the owner asked to see proven.
 */

/** How far the pointer must travel before a press stops being a press. */
export const DRAG_SLOP = 4;

/** How far one arrow key nudges a selection, and how far it nudges with Shift held. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_FAST = 10;

const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** How far a gesture travelled, as the crow flies. */
export function dragDistance(from, to) {
  if (!from || !to) return 0;
  const dx = num(to.x) - num(from.x);
  const dy = num(to.y) - num(from.y);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * What a finished press on blank page MEANT.
 *
 * ⛔ EXACTLY ONE ANSWER, ALWAYS. Returning "select" for a gesture that never moved would place
 * nothing and select nothing — a dead press, which is the "it works intermittently" failure this
 * module has already produced twice by other means. Returning both would leave a stray box behind
 * every marquee, which is worse than having no marquee at all.
 *
 * ⛔ AND SINCE NEW-1 THERE ARE THREE ANSWERS, NOT TWO, WITH THE MODIFIER DECIDING BETWEEN THE TWO
 * TRAVELLING ONES — the owner's words: *"Click and drag should move like you're on a map"* and
 * *"shift click and drag should select multiple items."* The DISTANCE still decides whether the
 * press travelled at all; SHIFT decides what travelling means. Deliberately in that order, because
 * distance is the boundary that four rounds of work went into and it is unchanged: a press below
 * `DRAG_SLOP` is a PLACE whether or not Shift was held, so the placement path this module keeps
 * breaking is reached by exactly the same presses it was before.
 *
 * `shift` is read at the PRESS, by the caller, and never re-read mid-gesture. A gesture that
 * changed meaning halfway through because a finger landed on a modifier is the same class of
 * "it behaves differently depending on invisible state" defect the distance boundary exists to
 * prevent.
 */
export function gestureOutcome(from, to, { slop = DRAG_SLOP, shift = false } = {}) {
  if (dragDistance(from, to) <= slop) return "place";
  return shift ? "select" : "pan";
}

/**
 * The outcome a gesture has COMMITTED to, once it has travelled — `null` while it is still a place.
 *
 * ⛔ A GESTURE THAT HAS BECOME A PAN NEVER TURNS BACK INTO A PLACE, and this is not a refinement,
 * it is what stops the pan dropping litter. Panning out and back to where you started is an
 * ordinary thing to do with a map — and `gestureOutcome` read at mouse-up would call that round
 * trip a zero-distance press and PLACE A NOTE at the end of it. The same latent hole was always
 * there for the marquee (band out, band back, a stray box); nobody hit it because a rubber band is
 * rarely returned to its own origin, and a pan is.
 *
 * The latch is one-way and it never looks at `shift` again: `latched` is what the press decided.
 */
export function latchGesture(latched, from, to, { slop = DRAG_SLOP, shift = false } = {}) {
  if (latched === "pan" || latched === "select") return latched;
  const now = gestureOutcome(from, to, { slop, shift });
  return now === "place" ? null : now;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

/**
 * Where a scroller lands when the canvas is dragged by one delta.
 *
 * ⛔ THE SIGN IS THE WHOLE OF IT, AND IT IS THE ONE THING WORTH A UNIT TEST: dragging the canvas
 * to the RIGHT shows you what was to its LEFT, so the scroll offset goes DOWN. Getting it
 * backwards produces a surface that runs away from the pointer, which reads as broken rather
 * than inverted.
 *
 * ⛔ AND IT CLAMPS TO THE REAL EXTENTS rather than trusting the browser to. The browser does clamp
 * a `scrollLeft` write, so this is belt and braces there — but it also makes "a pan past the edge
 * stops AT the edge, and comes straight back the moment you drag the other way" a property that
 * can be checked at zero pixels instead of only in a browser.
 */
export function panTarget(start, { dx = 0, dy = 0 } = {}, { maxLeft = Infinity, maxTop = Infinity } = {}) {
  return {
    scrollLeft: clamp(num(start?.scrollLeft) - num(dx), 0, Math.max(0, num(maxLeft, Infinity))),
    scrollTop: clamp(num(start?.scrollTop) - num(dy), 0, Math.max(0, num(maxTop, Infinity))),
  };
}

/** The rubber band, normalised so it is the same rectangle whichever corner you started from. */
export function marqueeRect(from, to) {
  const x1 = num(from?.x);
  const y1 = num(from?.y);
  const x2 = num(to?.x);
  const y2 = num(to?.y);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** Do two rectangles share any area at all? Touching edges do NOT count as overlapping. */
export function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return num(a.x) < num(b.x) + num(b.w)
    && num(a.x) + num(a.w) > num(b.x)
    && num(a.y) < num(b.y) + num(b.h)
    && num(a.y) + num(a.h) > num(b.y);
}

/**
 * Which boxes a band caught.
 *
 * ⛔ TOUCHED, NOT ENCLOSED — the owner's word was *"every box it touches"*, and it is also the
 * kinder rule: enclosing requires you to start outside the top-left of the first box and finish
 * outside the bottom-right of the last, which on a page that scrolls is often impossible without
 * scrolling mid-drag. Each box is `{ id, x, y, w, h }` in DOCUMENT space, the same frame the band
 * is in — so this is unaffected by zoom, scroll, or where the editor sits on screen.
 */
export function boxesInMarquee(rect, boxes = []) {
  const band = { x: num(rect?.x), y: num(rect?.y), w: num(rect?.w), h: num(rect?.h) };
  const out = [];
  for (const b of boxes || []) {
    if (!b || b.id == null) continue;
    if (rectsOverlap(band, { x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) })) out.push(String(b.id));
  }
  return out;
}

/**
 * The selection after a click, given what is held down.
 *
 * ⛔ SHIFT TOGGLES, IT DOES NOT ONLY ADD. Add-only means the only way to drop one box from a
 * selection of nine is to start again, which is how somebody ends up never using the feature.
 */
export function toggleSelection(selected, id, { additive = false } = {}) {
  const key = String(id);
  const set = new Set([...(selected || [])].map(String));
  if (!additive) return new Set([key]);
  if (set.has(key)) set.delete(key); else set.add(key);
  return set;
}

/** A band's catch folded into what was already selected — additive when Shift is held. */
export function applyMarquee(selected, caught, { additive = false } = {}) {
  const next = additive ? new Set([...(selected || [])].map(String)) : new Set();
  for (const id of caught || []) next.add(String(id));
  return next;
}

/** How far an arrow key moves a selection. Returns null for a key that is not an arrow. */
export function nudgeDelta(key, { shift = false } = {}) {
  const step = shift ? NUDGE_STEP_FAST : NUDGE_STEP;
  if (key === "ArrowLeft") return { dx: -step, dy: 0 };
  if (key === "ArrowRight") return { dx: step, dy: 0 };
  if (key === "ArrowUp") return { dx: 0, dy: -step };
  if (key === "ArrowDown") return { dx: 0, dy: step };
  return null;
}

/**
 * Where a whole selection lands when it is dragged by one delta.
 *
 * ⛔ THE SET MOVES AS ONE SHAPE. Clamping each box independently would DEFORM the selection —
 * drag a group toward the left edge and the boxes nearest it would stop while the rest kept
 * going, so the arrangement somebody built is quietly destroyed by a gesture that was only
 * supposed to move it. So the delta is clamped ONCE, against the whole set's bounding box, and
 * every member gets the same clamped delta. `min` defaults to zero (the page's own edge).
 */
/* ⛔ A GROUP DRAG IS NOT CLAMPED EITHER (NOTES-FREE-PLACEMENT, owner report 2026-09-08). `min`
 * used to default to 0 — the same positive-only floor `moveAnchorPoint` held — so a selection
 * dragged past the page's left or top edge stopped dead while the page failed to grow. Both
 * defaults are now open, and the SHEET grows to hold whatever the set reaches (`anchorExtentLeft`
 * / `anchorExtentTop`). The parameters stay so a caller that genuinely needs a wall can ask for
 * one; no caller does today. */
export function moveSelection(boxes = [], { dx = 0, dy = 0 }, { min = -Infinity, maxX = Infinity } = {}) {
  const members = (boxes || []).filter((b) => b && b.id != null);
  if (!members.length) return [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  for (const b of members) {
    left = Math.min(left, num(b.x));
    top = Math.min(top, num(b.y));
    right = Math.max(right, num(b.x) + num(b.w));
  }
  const clampedDx = Math.max(min - left, Math.min(num(dx), maxX - right));
  const clampedDy = Math.max(min - top, num(dy));
  return members.map((b) => ({
    id: String(b.id),
    x: Math.round(num(b.x) + clampedDx),
    y: Math.round(num(b.y) + clampedDy),
  }));
}
