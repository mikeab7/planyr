/* Every source pack imported STATICALLY, as `{ id: { sources, reach } }` — shared by sourcesAll.js (tooling) and the vitest preload helper. Never imported by app code. */
import { HOUSTON_METRO_SOURCES, HOUSTON_METRO_FIXTURE_REACH } from "./sourcesHoustonMetro.js";
import { FLORIDA_SOURCES, FLORIDA_FIXTURE_REACH } from "./sourcesFlorida.js";
import { OK_SOURCES, OK_FIXTURE_REACH } from "./sourcesOk.js";
import { TX_CITY_ZONING_SOURCES, TX_CITY_ZONING_FIXTURE_REACH } from "./sourcesTxCityZoning.js";
import { SUGARLAND_SOURCES, SUGARLAND_FIXTURE_REACH } from "./sourcesSugarLand.js";
import { FORTBEND_SOURCES, FORTBEND_FIXTURE_REACH } from "./sourcesFortBend.js";
import { WALLER_SOURCES, WALLER_FIXTURE_REACH } from "./sourcesWaller.js";
import { NASHVILLE_BUFFER_SOURCES, NASHVILLE_BUFFER_FIXTURE_REACH } from "./sourcesNashvilleBuffers.js";
import { NASHVILLE_SOURCES, NASHVILLE_FIXTURE_REACH } from "./sourcesNashville.js";
import { TENNESSEE_SOURCES, TENNESSEE_FIXTURE_REACH } from "./sourcesTennessee.js";
import { RUTHERFORD_SOURCES, RUTHERFORD_FIXTURE_REACH } from "./sourcesRutherford.js";
import { GEORGIA_SOURCES, GEORGIA_FIXTURE_REACH } from "./sourcesGeorgia.js";
import { COLORADO_SOURCES, COLORADO_FIXTURE_REACH } from "./sourcesColorado.js";
import { MISSISSIPPI_SOURCES, MISSISSIPPI_FIXTURE_REACH } from "./sourcesMississippi.js";
import { REGISTRY_ONLY_SOURCES, REGISTRY_ONLY_FIXTURE_REACH } from "./sourcesRegistryOnly.js";

export const PACKS_ALL = {
  houstonMetro: { sources: HOUSTON_METRO_SOURCES, reach: HOUSTON_METRO_FIXTURE_REACH },
  florida: { sources: FLORIDA_SOURCES, reach: FLORIDA_FIXTURE_REACH },
  oklahoma: { sources: OK_SOURCES, reach: OK_FIXTURE_REACH },
  txCityZoning: { sources: TX_CITY_ZONING_SOURCES, reach: TX_CITY_ZONING_FIXTURE_REACH },
  sugarland: { sources: SUGARLAND_SOURCES, reach: SUGARLAND_FIXTURE_REACH },
  waller: { sources: WALLER_SOURCES, reach: WALLER_FIXTURE_REACH },
  fortbend: { sources: FORTBEND_SOURCES, reach: FORTBEND_FIXTURE_REACH },
  nashvilleBuffers: { sources: NASHVILLE_BUFFER_SOURCES, reach: NASHVILLE_BUFFER_FIXTURE_REACH },
  nashville: { sources: NASHVILLE_SOURCES, reach: NASHVILLE_FIXTURE_REACH },
  tennessee: { sources: { ...TENNESSEE_SOURCES, ...RUTHERFORD_SOURCES }, reach: { ...TENNESSEE_FIXTURE_REACH, ...RUTHERFORD_FIXTURE_REACH } },
  georgia: { sources: GEORGIA_SOURCES, reach: GEORGIA_FIXTURE_REACH },
  colorado: { sources: COLORADO_SOURCES, reach: COLORADO_FIXTURE_REACH },
  mississippi: { sources: MISSISSIPPI_SOURCES, reach: MISSISSIPPI_FIXTURE_REACH },
  registryOnly: { sources: REGISTRY_ONLY_SOURCES, reach: REGISTRY_ONLY_FIXTURE_REACH },
};
