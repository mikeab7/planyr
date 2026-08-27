/* Pure status-reporting decisions for the terrain/contour layer's `onStatus` channel (B802400
 * round 4), split out so they unit-test without Leaflet — `terrainLayers.js` imports `L` at
 * module scope and cannot be imported in Node at all (throws "window is not defined").
 *
 * THE DEFECT THIS CLOSES: the layer paints whatever tiles are already cached in the current
 * view SYNCHRONOUSLY, before the rest of the view's tiles (if any) have finished fetching —
 * that's correct, it shows real data as soon as it has it. But the status report that went
 * with that paint said "loaded" unconditionally, even when some of the view's tiles were still
 * in flight. On the common pan (most of the view already cached, one new edge tile isn't), the
 * status went straight to "loaded" and never once said "loading" — the pulsing dot never
 * appeared, and the picture just quietly updated later with nothing to show it had been
 * working. `isPartialCover` names the condition; `paintStatus` picks the honest state, reusing
 * the "loading" value the panel already renders as a pulsing dot rather than inventing a new UI
 * state for it. */

// True when some tile in the current view's cover is not among the ones already painted —
// i.e. this paint is a partial picture, and a fetch for the rest is still outstanding.
export function isPartialCover(paintedCount, coverCount) {
  return paintedCount < coverCount;
}

// The onStatus state for a paint: "loading" while a real fetch for the same view is still in
// flight (even though something is already on screen), else the ordinary "loaded"/"empty".
export function paintStatus(partial, hasContent) {
  if (partial) return "loading";
  return hasContent ? "loaded" : "empty";
}
