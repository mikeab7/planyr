/* PRODUCTION: nothing is preloaded — every per-state county table loads on demand (parcelStateTables.js).
 * TESTS: vitest.config.js aliases this module to test/helpers/parcelTablesPreloadAll.js, which imports every table file statically so the unit
 * suites keep seeing the FULL county registry synchronously, exactly as before the split (same seam as lazyLayerPreload.js, batch K stage 1). */
export const PRELOADED = null;
