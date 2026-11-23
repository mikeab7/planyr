/* PRODUCTION: nothing is preloaded — every source pack loads on demand (sourcePacks.js, with the lazy layer file that reads it).
 * TESTS: vitest.config.js aliases this module to test/helpers/sourcePacksPreloadAll.js, which imports every pack statically so the unit suites see the FULL
 * registry synchronously, exactly as before the split (same seam as lazyLayerPreload.js / parcelTablesPreload.js). */
export const PRELOADED = null;
