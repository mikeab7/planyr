/* THE ONE on-demand loader for the terrain pipeline (B1095).
 *
 * Why: `terrainLayers.js` pulls in `demGrid.js`, `contours.js` and the Web-Worker glue,
 * and it rode the Site route's BOOT bundle even though nothing it does is needed until
 * the user either switches a terrain layer on or moves the cursor over the map. The
 * B1042 precedent (`exportSheet.js`, `lercGrid.js`) is the same shape: keep the heavy
 * module off the critical path and import it at the first moment it is actually used.
 *
 * Two accessors, and the split matters:
 *  - `terrainNow()` is SYNCHRONOUS and returns null until the chunk has landed. The
 *    cursor readout samples through this, so once loaded it stays a plain synchronous
 *    call on every mousemove — no promise, no frame of latency, no behaviour change.
 *  - `loadTerrain()` returns the cached module promise (one import, ever). A failed load
 *    clears the cache so the next attempt retries rather than wedging on a dead promise.
 */
let mod = null, loading = null;

export function loadTerrain() {
  if (mod) return Promise.resolve(mod);
  if (!loading) {
    loading = import("./terrainLayers.js").then(
      (m) => { mod = m; return m; },
      (e) => { loading = null; throw e; }, // a network blip must not wedge every later call
    );
  }
  return loading;
}

/* The loaded module, or null. Callers on a hot path (the per-move cursor sample) use this
 * and treat null as "not yet" — never as an answer. */
export const terrainNow = () => mod;

/* NEW-1's hover, routed so it costs nothing before the pipeline exists. It deliberately
 * does NOT trigger the load itself: the cursor readout on the same move already does, and
 * two independent triggers for one chunk is how a double-fetch gets introduced. Until the
 * chunk lands this is a no-op, which is correct — there are no contours painted yet. */
export function contourHover(map, ll) {
  const m = mod;
  if (m && m.setContourHover) m.setContourHover(map, ll);
}
