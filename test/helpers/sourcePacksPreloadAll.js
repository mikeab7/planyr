/* TEST-ONLY (aliased over sourcePacksPreload.js by vitest.config.js): every source pack imported statically, so the unit suites see the full registry synchronously.
 * A suite that wants the production-shaped "core only" registry sets globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__ before importing sources.js (test/sourcePacks.test.js does, after vi.resetModules()). */
import { PACKS_ALL } from "../../src/shared/gis/sourcePacksAll.js";
export const PRELOADED = globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__ ? null : PACKS_ALL;
