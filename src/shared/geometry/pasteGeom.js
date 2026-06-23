/* Paste-at-cursor placement math (B417) — shared by the Site Planner and Review
 * canvases so a pasted copy drops CENTERED under the cursor (Bluebeam behaviour).
 * Pure + unit-tested (test/pasteGeom.test.js): coordinates are plain {x,y} in
 * whatever space the caller uses (Site Planner = feet, Review = PDF page units). */

// Axis-aligned bounding-box center of a non-empty point list.
export function bboxCenter(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

// Translate every point so the list's bbox center lands exactly on `target`.
// A single point (e.g. a text anchor) is simply moved onto the target.
export function centerOn(pts, target) {
  const c = bboxCenter(pts);
  const dx = target.x - c.x, dy = target.y - c.y;
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}
