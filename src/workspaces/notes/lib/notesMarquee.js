/* notesMarquee — ONE GESTURE ON EMPTY PAGE, TWO MEANINGS, DECIDED BY DISTANCE (B421494).
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
 */
export function gestureOutcome(from, to, { slop = DRAG_SLOP } = {}) {
  return dragDistance(from, to) > slop ? "select" : "place";
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
export function moveSelection(boxes = [], { dx = 0, dy = 0 }, { min = 0, maxX = Infinity } = {}) {
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
