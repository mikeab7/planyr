/* TEST-ONLY (aliased over lazyLayerPreload.js by vitest.config.js): every lazy layer file imported statically, so the unit suites see the full registry synchronously. */
import * as m0 from "../../src/workspaces/site-planner/lib/desotoLayers.js";
import * as m1 from "../../src/workspaces/site-planner/lib/sugarLandLayers.js";
import * as m2 from "../../src/workspaces/site-planner/lib/fortBendLayers.js";
import * as m3 from "../../src/workspaces/site-planner/lib/nashvilleLayers.js";
import * as m4 from "../../src/workspaces/site-planner/lib/nashvilleBufferLayers.js";
import * as m5 from "../../src/workspaces/site-planner/lib/georgiaLayers.js";
import * as m6 from "../../src/workspaces/site-planner/lib/coloradoLayers.js";
import * as m7 from "../../src/workspaces/site-planner/lib/tennesseeLayers.js";
import * as m8 from "../../src/workspaces/site-planner/lib/mississippiLayers.js";
import * as m9 from "../../src/workspaces/site-planner/lib/floridaLayers.js";
import * as m10 from "../../src/workspaces/site-planner/lib/oklahomaLayers.js";
import * as m11 from "../../src/workspaces/site-planner/lib/chambersLayers.js";
import * as m12 from "../../src/workspaces/site-planner/lib/houstonMetroLayers.js";
import * as m13 from "../../src/workspaces/site-planner/lib/txCityZoningLayers.js";
// A suite that wants the production-shaped "nothing loaded yet" registry sets globalThis.__PLANYR_NO_LAZY_PRELOAD__ before importing layers.js
// (test/lazyLayerRegistry.test.js does, after vi.resetModules()).
export const PRELOADED = globalThis.__PLANYR_NO_LAZY_PRELOAD__ ? null : {
  desoto: m0,
  sugarland: m1,
  fortbend: m2,
  nashville: m3,
  nashvilleBuffers: m4,
  georgia: m5,
  colorado: m6,
  tennessee: m7,
  mississippi: m8,
  florida: m9,
  oklahoma: m10,
  chambers: m11,
  houstonMetro: m12,
  txCityZoning: m13,
};
