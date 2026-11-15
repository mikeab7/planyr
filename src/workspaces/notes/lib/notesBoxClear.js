/* notesBoxClear — WHEN A BOX GROWS FROM ITS OWN WORDS AND LANDS ON ANOTHER, WHAT IT NOW COVERS GETS OUT OF THE WAY (NEW-1 / NEW-2, B2671237 + B2671238; NARROWED by NEW-2 of 2026-11-15).
 *
 * OWNER REPORT 2026-11-12: pasting a line into a box made it wrap to two lines and "draw straight on top of" the box below — "atrocious".
 * Expected, verbatim: "nothing on a Notes page ever draws on top of anything else after an edit. When a box grows, what is below
 * it gets out of the way."
 *
 * ⛔ OWNER DECISION 2026-11-15 (NEW-2), which NARROWS the rule above and must not be read past: "We don't need to move the boxes out the
 * way... I want it to function slightly like PowerPoint, where you can post stuff over each other." A box the PERSON PLACED — dropped by
 * its border, resized from a handle, pasted as a box — may overlap anything and NOTHING moves because of it. Only growth that comes from
 * the box's OWN WORDS (typing, pasting text, a list, a bigger font, a table…) pushes what it newly covers: that overlap is the one he
 * did not choose. The caller (`notesBoxClearPlugin.js`) says which boxes were placed by hand (`placed`); this module never guesses.
 *
 * WHY IT HAPPENED, measured: a box is absolutely placed (`top` = its stored y) and its HEIGHT IS ITS WORDS (`h: null`), so any edit
 * that adds a line grows it straight down over whatever sits there. Nothing ever asked "did that growth just cover somebody?".
 *
 * THE RULE (PURE — rectangles in, new y's out; no DOM, no editor):
 *   · A box whose rectangle CHANGED, and that nobody placed by hand, is a MOVER. A box that was placed is never a mover.
 *     Boxes whose rectangle changed this edit (movers AND placed ones) are never pushed — a group dragged together keeps its arrangement.
 *   · A non-changed box that NOW intersects a mover and did NOT intersect it BEFORE is pushed just clear of it, then checked against
 *     everything in turn (a push can cover the next box — it cascades, top to bottom, until nothing new is covered).
 *   · ⛔ AN OVERLAP THE PERSON ALREADY HAD IS NEVER TOUCHED. Free placement lets a person stack boxes on purpose; the rule only
 *     answers what THIS edit did, so opening a note or editing one box never rearranges a page they laid out themselves.
 *   · Direction: always DOWN — a box grows downward. (The old "dropped box pushes away from its centre" branch is deleted with the
 *     drop rule it served.)
 *   · The gap kept is the gap the two had (6–24), else 8.
 * Only `y` ever changes. A pushed box keeps its x, width and words. */

export const GAP_DEFAULT = 8;
export const GAP_MIN = 6;
export const GAP_MAX = 24;
const EPS = 0.5;

/** Strict intersection: boxes that merely touch do not overlap. */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}
const same = (a, b) => Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS && Math.abs(a.w - b.w) <= EPS && Math.abs(a.h - b.h) <= EPS;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Which ids' rectangles differ between two measurements (only ids present in both). */
export function changedIds(before, after) {
  const out = [];
  for (const [id, a] of after) { const b = before.get(id); if (b && !same(a, b)) out.push(id); }
  return out;
}

/**
 * @param before  Map<id,{x,y,w,h}>  the last stable measurement
 * @param after   Map<id,{x,y,w,h}>  now
 * @param placed  Set<id>  boxes whose stored x / y / width / height the person set this edit (a drop, a resize, a pasted box) — never movers
 * @returns Map<id, newY> for every box that has to move (empty when nothing newly overlaps)
 */
export function planClear(before, after, placed = new Set()) {
  const changed = new Set(changedIds(before, after));
  const moversList = [...changed].filter((id) => !placed.has(id));
  if (!moversList.length) return new Map();
  const cur = new Map([...after].map(([id, r]) => [id, { ...r }]));
  const out = new Map();
  const queue = moversList.slice();
  const ids = [...after.keys()].sort((a, b) => after.get(a).y - after.get(b).y || (a < b ? -1 : 1));
  for (let guard = 0; queue.length && guard < 2000; guard++) {
    const mid = queue.shift();
    const M = cur.get(mid);
    const bm = before.get(mid);
    for (const oid of ids) {
      if (oid === mid || changed.has(oid)) continue;
      const O = cur.get(oid);
      const bo = before.get(oid);
      if (!bo || !bm) continue;                       // a box that did not exist before is nobody's to push
      if (!rectsOverlap(M, O)) continue;
      if (rectsOverlap(bm, bo)) continue;             // they already overlapped: not this edit's doing
      const oldGap = bo.y - (bm.y + bm.h);
      const gap = oldGap >= 0 ? clamp(oldGap, GAP_MIN, GAP_MAX) : GAP_DEFAULT;
      const ny = M.y + M.h + gap;
      if (ny <= O.y + EPS) continue;
      O.y = ny;
      out.set(oid, ny);
      queue.push(oid);
    }
  }
  return out;
}
