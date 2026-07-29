/* The terrain zoom gate, alone in a leaf module (B1093).
 *
 * `layers.js` needs this number to write the two terrain layers' registry notes, and the
 * terrain pipeline itself needs it to decide what to paint — but the pipeline is now
 * LOADED ON DEMAND (see terrainLazy.js), and a static import of it just to read one
 * constant would have dragged the whole thing back onto the boot bundle. So the constant
 * lives here, imported by both, and this file imports nothing. */

// ~3 m ground cells at Houston; z15 would be 1-ft-contour mush.
export const TERRAIN_MIN_ZOOM = 16;
