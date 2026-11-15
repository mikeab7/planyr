/* notesChipPlace — WHERE THE PASTE-OPTIONS TAB GOES SO IT COVERS NO TEXT (NEW-1, B2671237).
 *
 * The tab used to sit "just below the caret at the end of the pasted range" with no idea what was under it, so a paste that
 * ended near another box's text drew "(Ctrl) ▾" straight over that text (owner screenshot, 2026-11-12). It is a floating control,
 * and a floating control that hides words is the bug whatever else is right about it.
 *
 * PURE. Everything is in ONE coordinate space — the host's own, in the same units the caller already used for `x` / `y` — and
 * `obstacles` are the rectangles of every line of text on the page ({left, top, right, bottom}).
 *
 * ORDER OF PREFERENCE (the first candidate that overlaps no text wins; the first one is what shipped, so a paste that was
 * already fine does not move):
 *   1. below the caret, left edge on the caret
 *   2. on the caret's own row, to the RIGHT of the last text on that row
 *   3. above the caret's line
 *   4. on the caret's own row, to the LEFT of the first text on that row
 *   5. otherwise the candidate that hides the least (never nothing: the tab must be reachable)
 * Every candidate is kept inside the host. */
export const CHIP_GAP = 4;
export const TEXT_PAD = 2;

const overlapArea = (a, b) => {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};
const grow = (r, p) => ({ left: r.left - p, top: r.top - p, right: r.right + p, bottom: r.bottom + p });

/** How much text a chip at (left, top) of size w × h would cover (area, px²). */
export function coveredArea({ left, top, w, h }, obstacles) {
  const rect = { left, top, right: left + w, bottom: top + h };
  let sum = 0;
  for (const o of obstacles) sum += overlapArea(rect, grow(o, TEXT_PAD));
  return sum;
}

/**
 * @param chip       { w, h }
 * @param at         { x, y, yTop }  caret x, its line's bottom (y) and top (yTop)
 * @param obstacles  [{left, top, right, bottom}]
 * @param host       { w, h }
 * @returns { left, top, covered }
 */
export function placeChip({ chip, at, obstacles = [], host }) {
  const { w, h } = chip;
  const yTop = at.yTop ?? at.y;
  const clampX = (v) => Math.max(6, Math.min(v, host.w - w - 6));
  const clampY = (v) => Math.max(6, Math.min(v, host.h - h - 6));
  const row = obstacles.filter((o) => o.bottom > yTop && o.top < at.y);
  const rowRight = row.length ? Math.max(...row.map((o) => o.right)) : null;
  const rowLeft = row.length ? Math.min(...row.map((o) => o.left)) : null;
  const cands = [
    { left: clampX(at.x), top: at.y + CHIP_GAP },
    rowRight != null ? { left: rowRight + 8, top: yTop } : null,
    { left: clampX(at.x), top: yTop - h - CHIP_GAP },
    rowLeft != null ? { left: rowLeft - w - 8, top: yTop } : null,
  ].filter(Boolean).filter((c) => c.left >= 6 && c.left + w <= host.w - 6 && c.top >= 6 && c.top + h <= host.h - 6);
  /* The historic rule when below would not fit: flip above. Kept as a candidate so a tight host still has a position. */
  cands.push({ left: clampX(at.x), top: clampY(at.y + CHIP_GAP) });
  let best = null;
  for (const c of cands) {
    const covered = coveredArea({ ...c, w, h }, obstacles);
    if (covered === 0) return { left: c.left, top: c.top, covered: 0 };
    if (!best || covered < best.covered) best = { left: c.left, top: c.top, covered };
  }
  return best;
}
