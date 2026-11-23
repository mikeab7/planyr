/* PRODUCTION: nothing is preloaded — every lazy layer file loads on demand (lazyLayerFiles.js).
 * TESTS: vitest.config.js aliases this module to test/helpers/lazyLayerPreloadAll.js, which imports every file statically so the unit
 * suites keep seeing the FULL registry synchronously, exactly as before the split. */
export const PRELOADED = null;
