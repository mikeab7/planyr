/* NEW-1 (2026-11-12) — PARCEL FIXTURES: known lots the nightly parcel health job re-queries BY ID.
 *
 * WHY. `parcel-source-health-sweep.mjs` proves a wired layer answers and holds features; it cannot
 * tell that a county quietly re-keyed its id column, swapped its owner field, or began returning
 * acres in the wrong unit. A fixture is a lot whose id, owner and acreage were MEASURED live and
 * are re-asserted every night, so that kind of drift goes red the day it happens (the weekly
 * "where people are working" sweep chose these — docs/ACTIVE-AREAS.md).
 *
 * SAME RULE AS THE REST OF sourceFixtures*.js: nothing in the app imports this (it is an assertion,
 * not an endpoint fact — `sources.js` is on the Site route's critical path, this is not). The layer
 * URL is NEVER repeated here: the sweep reads it from the registry (`COUNTIES[key].layerUrl`), so
 * the registry stays the one place an endpoint lives.
 *
 * Keyed by COUNTY KEY (`counties.js`). Per county:
 *   idField     — the column the fixture id is looked up in (a Chambers-style joined layer keeps its
 *                 table prefix: `ChambersCADWeb.DBO.Accounts.Account`)
 *   ownerField  — optional. Absent = the app's own `appraisal.ownerKey` resolves it, so the fixture
 *                 also proves the owner row the parcel card shows still resolves on this layer
 *   acresField  — the column that carries acres (compared ±1%)
 *   probed      — the date every row below was last measured live (re-measure before relying on it)
 *   stacked     — true while the layer returns SEVERAL rows for one id (Bartow: the stacked-rows
 *                 defect, one row per sub-polygon). The check then asserts ≥ 1 row, every one of
 *                 them carrying the expected owner + acres; flip it off (and set `oneLot: true`) once the
 *                 stacked-rows fix ships and the check will demand EXACTLY one logical lot per id.
 *   parcels[]   — { id, owner, acres }  (owner is compared trimmed, whitespace-collapsed, case-blind)
 */
export const PARCEL_FIXTURES = {
  harris: {
    idField: "HCAD_NUM", ownerField: "owner_name_1", acresField: "acreage_1", probed: "2026-11-12",
    parcels: [
      { id: "0402460000044", owner: "CHEVRON PRODUCTS CO", acres: 36.31 },
      { id: "0410320010147", owner: "GULF ACCESS TERMINAL LLC", acres: 46.0712 },
      { id: "1351280000001", owner: "BUC-EES LTD", acres: 17.8928 },
      { id: "0432370000001", owner: "DARVESH INVESTMENTS LLC", acres: 88.9009 },
      { id: "1328060010001", owner: "MOGAS REAL ESTATE LLC", acres: 4.418 },
      { id: "0390350000019", owner: "PONCE JOSE R & SAN JUANITA", acres: 0.1263 },
    ],
  },
  fortbend: {
    idField: "QUICKREFID", ownerField: "OWNERNAME", acresField: "LANDSIZEAC", probed: "2026-11-12",
    parcels: [
      { id: "R126255", owner: "Fulshear FF Texas Holdings LP", acres: 85.08 },
      { id: "R33231", owner: "ChampionX Texas Leasing LLC", acres: 30.7913 },
      { id: "R130561", owner: "Dalho Corporation", acres: 31.775 },
      { id: "R136054", owner: "Dorsett Brothers Concrete Supply Inc", acres: 54.088 },
      { id: "R127511", owner: "Renteria Louis", acres: 0.125 },
    ],
  },
  tn_rutherford: {
    idField: "ParcelID", ownerField: "Owner1", acresField: "DEEDACRES", probed: "2026-11-12",
    parcels: [
      { id: "156-027.00-000", owner: "RHODES DEVELOPMENT COMPANY", acres: 8.75 },
      { id: "126-050.12-000", owner: "STAG INDUSTRIAL HOLDINGS LLC", acres: 7.95 },
      { id: "135-002.02-000", owner: "LOGISTICS WAY NASHVILLE OWNER LLC", acres: 26.24 },
      { id: "113-020.00-000", owner: "MIDWEST YOGURT INC", acres: 72.29 },
      { id: "171-025.02-000", owner: "MOSELEY STEVEN", acres: 0.79 },
    ],
  },
  ga_bartow: {
    // Owner1 is space-padded to a fixed width by the county; the check trims. Gerdau returned 170 stacked rows
    // for its one id and Allatoona 3 on 2026-11-12 — see `stacked` above.
    idField: "PARCELID", ownerField: "Owner1", acresField: "TOTALACRES", probed: "2026-11-12", stacked: true,
    parcels: [
      { id: "0080-0202-001", owner: "GERDAU AMERISTEEL US INC", acres: 267.91 },
      { id: "0058-0055-004", owner: "SHAW INDUSTRIES INC", acres: 85.8 },
      { id: "0096-1153-001", owner: "ALLATOONA BUSINESS CENTER LLC", acres: 126.4 },
      { id: "0070-0164-025", owner: "GEORGIA GARAGE LLC", acres: 0.58 },
    ],
  },
  chambers: {
    // ⚠ NOT re-measured by the session that added it: gisdata.pandai.com is blocked in the Claude Code sandbox and is not on the
    // gis-proxy allow-list, so these three rows are the weekly sweep's own 2026-11-01 readings. `ownerField` is left to the app's
    // `ownerKey` because the joined layer's owner column name was not captured. The FIRST nightly run is the live check: a red
    // Chambers row there means a stale seed or a wrong field guess — re-measure from a browser before trusting either.
    idField: "ChambersCADWeb.DBO.Accounts.Account", acresField: "ChambersCADWeb.DBO.Accounts.Acres", probed: "2026-11-01",
    parcels: [
      { id: "00004-00100-00000-090001", owner: "TARGA DOWNSTREAM LLC", acres: 124.645 },
      { id: "00028-01102-00000-210001", owner: "AMERIPORT LLC", acres: 171.9 },
      { id: "54500-00012-00000-000400", owner: "STANCOPIA LLC", acres: 0.277 },
    ],
  },
  tn_davidson: {
    idField: "STANPAR", ownerField: "Owner", acresField: "Acres", probed: "2026-11-12",
    parcels: [
      { id: "09400020000", owner: "AMERIPLEX CD INVESTORS, LLC", acres: 13.81 },
      { id: "12000003500", owner: "UTICA REALTY NASHVILLE LLC", acres: 73.81 },
      { id: "10508026600", owner: "AKZO NOBEL COATINGS INC", acres: 9.52 },
      { id: "08202009400", owner: "RICHLAND SOUTH LLC", acres: 0.44 },
    ],
  },
};
