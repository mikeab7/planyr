/* TEST-ONLY (aliased over parcelTablesPreload.js by vitest.config.js): every per-state county table imported statically, so the unit suites see the full registry synchronously. */
import * as m0 from "../../src/workspaces/site-planner/lib/alabamaParcels.js";
import * as m1 from "../../src/workspaces/site-planner/lib/sdParcels.js";
import * as m2 from "../../src/workspaces/site-planner/lib/idParcels.js";
import * as m3 from "../../src/workspaces/site-planner/lib/nmParcels.js";
import * as m4 from "../../src/workspaces/site-planner/lib/gaParcels.js";
import * as m5 from "../../src/workspaces/site-planner/lib/laParcels.js";
import * as m6 from "../../src/workspaces/site-planner/lib/moParcels.js";
import * as m7 from "../../src/workspaces/site-planner/lib/miParcels.js";
import * as m8 from "../../src/workspaces/site-planner/lib/scParcels.js";
import * as m9 from "../../src/workspaces/site-planner/lib/paParcels.js";
import * as m10 from "../../src/workspaces/site-planner/lib/ilParcels.js";
import * as m11 from "../../src/workspaces/site-planner/lib/waParcels.js";
import * as m12 from "../../src/workspaces/site-planner/lib/orParcels.js";
import * as m13 from "../../src/workspaces/site-planner/lib/okParcels.js";
import * as m14 from "../../src/workspaces/site-planner/lib/azParcels.js";
import * as m15 from "../../src/workspaces/site-planner/lib/ksParcels.js";
import * as m16 from "../../src/workspaces/site-planner/lib/nyParcels.js";
import * as m17 from "../../src/workspaces/site-planner/lib/iaParcels.js";
import * as m18 from "../../src/workspaces/site-planner/lib/kyParcels.js";
// A suite that wants the production-shaped "nothing loaded yet" registry sets globalThis.__PLANYR_NO_PARCEL_PRELOAD__ before importing counties.js
// (test/parcelStateTables.test.js does, after vi.resetModules()).
export const PRELOADED = globalThis.__PLANYR_NO_PARCEL_PRELOAD__ ? null : {
  AL: { raw: m0.alRaw(), map: m0.alMap() },
  SD: { raw: m1.sdRaw(), map: m1.sdMap() },
  ID: { raw: m2.idRaw(), map: m2.idMap() },
  NM: { raw: m3.nmRaw(), map: m3.nmMap() },
  GA: { raw: m4.gaRaw(), map: m4.gaMap() },
  LA: { raw: m5.laRaw(), map: m5.laMap() },
  MO: { raw: m6.moRaw(), map: m6.moMap() },
  MI: { raw: m7.miRaw(), map: m7.miMap() },
  SC: { raw: m8.scRaw(), map: m8.scMap() },
  PA: { raw: m9.paRaw(), map: m9.paMap() },
  IL: { raw: m10.ilRaw(), map: m10.ilMap() },
  WA: { raw: m11.waRaw(), map: m11.waMap() },
  OR: { raw: m12.orRaw(), map: m12.orMap() },
  OK: { raw: m13.okRaw(), map: m13.okMap() },
  AZ: { raw: m14.azRaw(), map: m14.azMap() },
  KS: { raw: m15.ksRaw(), map: m15.ksMap() },
  NY: { raw: m16.nyRaw(), map: m16.nyMap() },
  IA: { raw: { ...m17.iaRaw(), ...m17.iaCopyRaw() }, map: { ...m17.iaMap(), ...m17.iaCopyMap() } },
  KY: { raw: m18.kyRaw(), map: m18.kyMap() },
};
