/* ghostSnapshot — the frozen copy of the basemap held over an unavoidable tile wipe.
 *
 * WHY IT CHANGED (NEW-4). The anti-flash ghost (B65/B183/B933) used to be
 * `wrap.cloneNode(true)` — a DEEP clone of the whole overscanned Leaflet container, which
 * on the measured reference session meant 390–500 `<img>` nodes copied on every commit that
 * changes zoom. Nothing leaked (the heap falls back at idle, and every spawn drops the
 * previous ghost first), but the churn is real: it is a large part of the allocation spike
 * that swung the heap's CAPACITY from ~89 to ~143 MB with the USED heap flat, and that
 * churn is what the garbage collector pays for in the p99 frame times.
 *
 * The insight: the ghost only has to cover the pixels the user can SEE. Everything in the
 * overscan margin is, by definition, off-screen, and behind the ghost sits the live coarse
 * backfill layer, which covers any reveal. So instead of deep-cloning the container we take
 * a FLAT snapshot: the handful of loaded tiles that intersect the visible clip, each cloned
 * shallowly and positioned absolutely at the screen position it occupies right now. A
 * frozen copy doesn't need Leaflet's transform hierarchy — only the pixels, where they are.
 *
 * Typically ~12–40 tiles instead of ~400: an order of magnitude less allocation per commit,
 * with pixel-identical cover over the visible area.
 */

/* Which tiles are worth snapshotting: loaded, non-degenerate, and intersecting the clip
 * (grown by `margin` so a tile straddling the edge still contributes). Pure — takes plain
 * rects, returns the ones to keep, so the selection is unit-tested away from the DOM. */
export function visibleTiles(tiles, clip, margin = 0) {
  const m = Math.max(0, Number(margin) || 0);
  const l = clip.left - m, t = clip.top - m, r = clip.right + m, b = clip.bottom + m;
  return (Array.isArray(tiles) ? tiles : []).filter((tile) => {
    if (!tile || tile.loaded === false) return false;
    const q = tile.rect || tile;
    if (!q || !(q.width > 0) || !(q.height > 0)) return false;
    return q.left < r && q.right > l && q.top < b && q.bottom > t;
  });
}

/* Build the frozen overlay. `clipEl` is the element the ghost is appended to (the map's
 * clipping box); `wrap` is the oversized Leaflet container inside it. Returns the ghost
 * element, or null when there is nothing loaded to snapshot. DOM-bound but tiny — the
 * selection maths above is where the behaviour lives. */
export function buildGhost(clipEl, wrap, doc = typeof document !== "undefined" ? document : null) {
  if (!clipEl || !wrap || !doc) return null;
  const clip = clipEl.getBoundingClientRect();
  if (!(clip.width > 0 && clip.height > 0)) return null;
  const imgs = Array.from(wrap.querySelectorAll("img.leaflet-tile"));
  if (!imgs.length) return null;
  // One layout read for the whole batch (all reads, then all writes — no interleaving, so
  // this costs a single forced layout rather than one per tile).
  const measured = imgs.map((el) => ({ el, loaded: el.complete && el.naturalWidth > 0, rect: el.getBoundingClientRect() }));
  const keep = visibleTiles(measured, clip, 8);
  if (!keep.length) return null;

  const ghost = doc.createElement("div");
  ghost.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;background:transparent;";
  ghost.setAttribute("data-export", "skip");
  ghost.setAttribute("data-testid", "geo-ghost");
  for (const { el, rect } of keep) {
    const img = el.cloneNode(false); // an <img> has no children — shallow is a full copy
    img.className = "";
    img.style.cssText =
      `position:absolute;left:${rect.left - clip.left}px;top:${rect.top - clip.top}px;` +
      `width:${rect.width}px;height:${rect.height}px;transform:none;`;
    ghost.appendChild(img);
  }
  return ghost;
}
