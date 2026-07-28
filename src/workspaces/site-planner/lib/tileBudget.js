/* tileBudget — how many basemap tiles the planner is allowed to hold, and how big the
 * off-screen overscan may be. Pure policy (no DOM, no Leaflet) so it unit-tests.
 *
 * WHY (NEW-7, measured 2026-07-28 on a real signed-in session). The Leaflet container is
 * deliberately OVERSIZED so a pan/zoom reveals already-loaded imagery instead of the
 * backdrop (B65). Measured, that overscan plus `keepBuffer` made the tile container 3.9x
 * the visible pixel area BEFORE retina; with `detectRetina` on a 2.15x display the working
 * zoom held ~105 tiles where a bare viewport needs ~12-15 — roughly 7-8x. One scenario load
 * fetched ~221 tiles (~3.5 MB) across five zoom levels. Decoded tile bitmaps and their GPU
 * copies — not the JS heap, which peaked at only ~135 MB — are where the tab's memory
 * actually goes, so this is the memory lever.
 *
 * THE POLICY. Overscan exists to hide pan reveal, and its useful value is bounded by how
 * far a drag travels between frames — past that it is pure resident cost. So it is FULL on
 * a light plan and steps down as the plan gets heavy or the device reports little memory;
 * `keepBuffer` (which multiplies on top of the overscan) steps down with it. Retina is
 * gated by zoom BAND rather than switched off globally: turning it off softens the aerial,
 * and a soft aerial is a credibility regression for a tool people eyeball sites in — so
 * full density is kept at the working zooms and clamped only at the wide context zooms
 * where a whole extra tile level buys nothing you can see.
 */

/* Element count above which a plan is "heavy" / "very heavy". Chosen against the reference
 * scenario (148 elements, ~4,600 SVG nodes) so that plan sits in the heavy band. */
const HEAVY_ELS = 120;
const VERY_HEAVY_ELS = 400;

/* navigator.deviceMemory (GiB) at or below which we treat the device as constrained. */
const LOW_MEMORY_GB = 4;

export const OVERSCAN_FULL = 320;
export const OVERSCAN_REDUCED = 176;
export const OVERSCAN_MIN = 96;

/* How heavy is this scenario? Pure classification so the thresholds live in one place. */
export function tileWeight({ elementCount = 0, deviceMemoryGb = null } = {}) {
  const lowMem = Number.isFinite(deviceMemoryGb) && deviceMemoryGb > 0 && deviceMemoryGb <= LOW_MEMORY_GB;
  if (elementCount >= VERY_HEAVY_ELS || (lowMem && elementCount >= HEAVY_ELS)) return "very-heavy";
  if (elementCount >= HEAVY_ELS || lowMem) return "heavy";
  return "light";
}

/* Overscan (px per side) the basemap container may overhang the viewport by. */
export function overscanPx(opts = {}) {
  const w = tileWeight(opts);
  const base = w === "very-heavy" ? OVERSCAN_MIN : w === "heavy" ? OVERSCAN_REDUCED : OVERSCAN_FULL;
  // Never overscan by more than about a third of the viewport's short side — on a small
  // window a fixed 320 px per side is most of the container, which is where the 3.9x
  // pixel-area blow-up came from.
  const short = Math.min(Number(opts.viewportW) || Infinity, Number(opts.viewportH) || Infinity);
  if (!Number.isFinite(short) || short <= 0) return base;
  return Math.max(48, Math.min(base, Math.round(short / 3)));
}

/* Leaflet `keepBuffer` — rings of tiles retained OUTSIDE the container. It multiplies on
 * top of the overscan, so it steps down with it. */
export function keepBufferFor(opts = {}) {
  const w = tileWeight(opts);
  return w === "very-heavy" ? 1 : w === "heavy" ? 2 : 4;
}

/* The zoom at or above which the retina (one-level-deeper) tile uplift is worth its 4x
 * pixel cost — i.e. the working zooms where a site is actually being read. */
export const RETINA_MIN_ZOOM = 15;

/* Whether to ask Leaflet for retina tiles, given the zoom the map is being built at.
 * `dpr <= 1` decides it on its own (Leaflet would ignore detectRetina anyway). */
export function retinaForZoom(zoom, { dpr = 1, weight = "light" } = {}) {
  if (!(Number(dpr) > 1)) return false;
  if (weight === "very-heavy") return false; // a very heavy plan gives the pixels back first
  if (!Number.isFinite(zoom)) return true;   // unknown zoom → keep the sharp default
  return zoom >= RETINA_MIN_ZOOM;
}

/* The maximum number of tiles a single basemap layer may retain. Sized from the tiles the
 * container genuinely needs (its area / tile area) plus the keepBuffer rings, then given
 * generous headroom — the cap is a CEILING that stops a long session growing without
 * limit, not a working-set target that would fight Leaflet's own pruning. */
export function tileCacheLimit({ containerW = 0, containerH = 0, tileSizePx = 256, keepBuffer = 4 } = {}) {
  const ts = Math.max(32, Number(tileSizePx) || 256);
  const cols = Math.ceil((Number(containerW) || 0) / ts) + 1 + 2 * keepBuffer;
  const rows = Math.ceil((Number(containerH) || 0) / ts) + 1 + 2 * keepBuffer;
  return Math.max(64, Math.ceil(cols * rows * 1.5));
}

/* Which retained tiles to evict once a layer is over its cap. Pure: takes plain records
 * `{ key, current, active, loaded, distance }` and returns the keys to drop, furthest-from-
 * view first. A tile Leaflet still considers `current` (part of the view being displayed)
 * is NEVER evicted — dropping one of those is what would flash a hole in the aerial. */
export function tilesToEvict(tiles, limit) {
  const list = Array.isArray(tiles) ? tiles : [];
  const cap = Math.max(1, Number(limit) || 1);
  if (list.length <= cap) return [];
  const evictable = list
    .filter((t) => t && !t.current && !t.active)
    .sort((a, b) => (b.distance || 0) - (a.distance || 0));
  // Only ever shed down to the cap, and only from the evictable set — if every tile is
  // current we simply hold more than the cap this frame rather than punch a hole.
  return evictable.slice(0, Math.min(evictable.length, list.length - cap)).map((t) => t.key);
}
