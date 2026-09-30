/* The DFW ETJ county coverage table — ONE list, read by the audit harness, the doc, and a unit test.
 *
 * NEW-2 (2026-09-30). The circle is 50 miles around Dallas City Hall; these are the 19 counties its area
 * touches, measured from TxDOT county polygons (share of the circle in brackets in `share`).
 *
 * `status`:
 *   complete — the county's own publisher table, declared in the registry's `completeCounties`. Only here
 *              may "no ETJ hit" read as Unincorporated.
 *   partial  — one or more sources answer for SOME cities. A hit is a finding; a miss reads
 *              "ETJ data unavailable".
 *   none     — no published ETJ data found (`tried` records the mechanisms). Reads "ETJ data unavailable".
 *
 * `sources` are registry keys (`GIS_SOURCES`). `date` is the publisher's own last-edit date for the newest
 * source that carries the county. `test/dfwEtjCounties.test.js` fails if a source id is unknown, if
 * "complete" and the registry's `completeCounties` disagree, or if a `none` county records fewer than two
 * mechanisms.
 *
 * MECHANISMS (numbered as in the brief):
 *   M1 city-published service/open-data item — ArcGIS Online search by city and by county, every layer of
 *      every service, kept only where the polygon extent reaches the circle.
 *   M2 county GIS / appraisal-district / utility-district organisations.
 *   M3 spatial join — where a publisher gives no usable city name, the city is the TxGIO limit the polygon
 *      abuts; ambiguous ones are WITHHELD, not guessed (Dallas County: 10 of 48 polygons).
 *   M4 a fresher copy of an out-of-date layer (Fort Worth: 2018 → 2025).
 *   NCTCOG (`geospatial.nctcog.org/map/rest/services` — note /map/, not /arcgis/): its hub publishes NO ETJ layer
 *   (195-dataset catalogue checked), and the server is denied by this environment's egress policy. The owner's
 *   browser (planyr.io tab, 2026-09-30) confirmed it answers, found city limits at Dfwmaps/Other_Boundaries/
 *   MapServer/4 and no ETJ layer by name. ONE LEAD IS STILL UNREAD: the hub's catalogue lists Boundaries/Boundaries
 *   layers 0-6, 9, 11, 12 — ids 7, 8 and 10 are absent and may be ETJ-like under another name.
 *   `ui-audit/verify-dfw-etj-browser-hosts.mjs` enumerates them from a browser.
 *   BROWSER-ONLY HOSTS — denied to the build sandbox, but CORS-clean from planyr.io (owner-probed 2026-09-30), so the
 *   app uses them at runtime: gis.dentoncounty.gov (WIRED: Denton current), mapit.fortworthtexas.gov (WIRED: Fort
 *   Worth ETJ + release areas), mapit.tarrantcounty.com (no ETJ-named layer in GeoData/Dynamic/Tax/Elections; the
 *   unread lead is Transportation/ETJ/MapServer/0, edited 2020), geospatial.nctcog.org (above).
 *   STILL BLOCKED, and unprobed: arcgis.waxahachie.com, arcgisint.forneytx.gov, maps.midlothian.tx.us,
 *   gisapp.wylietexas.gov, emap.rowlett.com, gis.burlesontx.com, maps.mckinneytexas.org, gis.friscotexas.gov,
 *   tad.newedgeservices.com.
 */
export const DFW_ETJ_COUNTIES = [
  { county: "Ellis", share: 12.2, status: "partial", sources: ["etj_ellis", "etj_waxahachie", "etj_johnson"], date: "2026-02-02",
    note: "Ellis compilation (Ennis, Maypearl, Midlothian, Oak Leaf, Ovilla, Palmer, Pecan Hill, Red Oak — some rows self-labelled \"Need to Research\"/\"Unofficial\") + Waxahachie's own layer + Midlothian via the Johnson SUD compile. Missing: Ferris, Italy, Milford, Garrett, Bardwell." },
  { county: "Denton", share: 11.7, status: "partial", sources: ["etj_denton", "etj_fortworth", "etj_collin"], date: "2026-09-24",
    note: "Denton County GIS's OWN CURRENT table (CityETJPermits_GC/MapServer/3 — 40 polygons, last edited 2026-09-24; probed from the owner's browser, the host is unreachable from the build sandbox), replacing the 2022 edition. Five polygons are NAME='Undetermined': the county's word for a strip two cities claim — they read \"ETJ undetermined (disputed)\", are never assigned to a city, never read as unincorporated. One is TYPE 'DIV 2' (Denton's second ETJ division): read as a Denton ETJ. The city list was not enumerated, so nothing claims which cities it carries and the county is not declared complete." },
  { county: "Dallas", share: 11.5, status: "partial", sources: ["etj_dallasco", "etj_sunnyvale", "etj_collin", "etj_johnson"], date: "2024-02-06",
    note: "Dallas County GIS: Combine, Ferris, Hutchins, Lancaster, Seagoville, Wilmer, Wylie — the `City` column carries the names (the `NAME` column reads \"ETJ\"); M3 spatial join withheld 10 of 48 polygons whose name no adjoining city limit confirmed. Plus Sunnyvale (town-published), Garland/Allen/Murphy/Wylie via Collin's table, Grand Prairie via the Johnson SUD compile. Not found: Mesquite (2018 only), Cedar Hill, DeSoto, Duncanville, Irving, Rowlett (host blocked)." },
  { county: "Tarrant", share: 11.5, status: "partial", sources: ["etj_fortworth", "etj_release_fortworth", "etj_mansfield", "etj_johnson"], date: "2026-09-01",
    note: "Fort Worth's OWN current ETJ (OpenData_Boundaries/MapServer/1 — 81 polygons, DATESTAMP max 2026-09-01; browser-probed) plus its SB 2038 release-area layer (a point inside one reads \"Fort Worth ETJ release area (SB 2038)\", never a plain ETJ — the layer's attributes are unread, so no claim is made about whether a release is effective), Mansfield (city GIS, 2026), and Crowley/Burleson/Grand Prairie via the Johnson SUD compile. Tarrant County's own server answers from a browser but has no ETJ-named layer in GeoData, Dynamic, Tax or Elections; the one unread lead is Transportation/ETJ/MapServer/0 (edited 2020). Not found: Arlington, Keller, Southlake, Colleyville, Azle (private layer, token required), Benbrook (2018 only)." },
  { county: "Collin", share: 11.3, status: "complete", sources: ["etj_collin"], date: "2026-09-26",
    note: "Collin County GIS, 33 city names; declared complete." },
  { county: "Kaufman", share: 10.4, status: "partial", sources: ["etj_forney", "etj_talty", "etj_dallasco"], date: "2025-04-10",
    note: "Forney and Talty from a consultant's 2025 planning service (M3: named by the abutting city limits — Forney 25.3%, Talty 42.2%); Combine/Seagoville reach in via Dallas County's table. Found but not wired (2018, pre-SB 2038, \"claimed\" ETJs): Kaufman, Terrell, Mesquite. Forney's own server is a blocked host. Not found: Crandall, Kemp, Mabank, Heath's Kaufman side." },
  { county: "Johnson", share: 6.9, status: "partial", sources: ["etj_johnson"], date: "2026-09-01",
    note: "Johnson County Special Utility District's 2025 compile: Alvarado, Briaroaks, Burleson, Cleburne, Coyote Flats, Cresson, Cross Timber, Godley, Grandview, Joshua, Keene, Rio Vista, Venus (+ Fort Worth, Crowley, Grand Prairie, Mansfield, Midlothian edges). A utility district's compile, not the county's — not declared complete. City-published Alvarado (2026) exists but duplicates it." },
  { county: "Hunt", share: 6.3, status: "partial", sources: ["etj_collin"], date: "2026-09-26",
    note: "Greenville, Caddo Mills and Celeste ETJs arrive via Collin County's table (`HuntCo-…` rows). Greenville also publishes its own 2-mile ETJ (2024; not wired — duplicates). Not found: Commerce, Quinlan, Wolfe City, Lone Oak." },
  { county: "Navarro", share: 4.1, status: "partial", sources: ["etj_corsicana", "etj_bloominggrove"], date: "2026-05-08",
    note: "Corsicana (M3: the publisher's layer is titled just \"ETJ\"; it abuts Corsicana's limits over 33.7%, next best 4.3%) and Blooming Grove (2024). Not found: Kerens, Rice, Angus." },
  { county: "Van Zandt", share: 2.2, status: "none", sources: [], date: null,
    tried: ["M1: ArcGIS Online search for Wills Point, Canton, Edgewood, Grand Saline — no ETJ layer", "M2: county / appraisal-district organisations — no ETJ or jurisdiction layer"],
    note: "no published ETJ data found" },
  { county: "Parker", share: 2.1, status: "none", sources: [], date: null,
    tried: ["M1: ArcGIS Online search for Weatherford, Aledo, Springtown, Hudson Oaks, Willow Park — none (Azle's layer is private)", "M2: Parker County / Parker CAD organisations — no ETJ layer; Parker County GIS not reachable"],
    note: "no published ETJ data found" },
  { county: "Grayson", share: 2.1, status: "partial", sources: ["etj_grayson"], date: "2024-07-24",
    note: "Sixteen Grayson County cities' ETJs from a thoroughfare-plan consultant layer (2024) — not the county's own table, so not declared complete. Only the county's southern strip is inside the circle." },
  { county: "Wise", share: 2.0, status: "none", sources: [], date: null,
    tried: ["M1: ArcGIS Online search for Decatur, Rhome, Bridgeport, Runway Bay — found Decatur (City of Decatur, 2021-09-02, pre-SB 2038) and Runway Bay (2025, consultant layer), neither wired", "M2: Wise County / Wise CAD organisations — no ETJ layer"],
    note: "no ETJ data current enough to wire" },
  { county: "Hill", share: 1.8, status: "none", sources: [], date: null,
    tried: ["M1: ArcGIS Online search for Hillsboro, Whitney, Itasca — no ETJ layer", "M2: Hill County / Hill CAD organisations — no ETJ layer"],
    note: "no published ETJ data found" },
  { county: "Rockwall", share: 1.8, status: "complete", sources: ["etj_rockwall", "etj_collin"], date: "2026-06-25",
    note: "Rockwall County GIS, six cities; declared complete." },
  { county: "Henderson", share: 1.1, status: "none", sources: [], date: null,
    tried: ["M1: ArcGIS Online search for Mabank, Gun Barrel City, Seven Points, Kemp, Athens — Athens' layer is private (token required)", "M2: Henderson County / Henderson CAD organisations — no ETJ layer"],
    note: "no published ETJ data found" },
  { county: "Cooke", share: 0.5, status: "none", sources: [], date: null,
    tried: ["M1: ArcGIS Online search for Gainesville, Lindsay, Valley View — no ETJ layer", "M2: Cooke County / Cooke CAD organisations — no ETJ layer"],
    note: "no published ETJ data found" },
  { county: "Fannin", share: 0.2, status: "none", sources: [], date: null,
    tried: ["M1: ArcGIS Online search for Bonham, Honey Grove, Leonard — Bonham's ETJ (2024) exists but lies outside the circle", "M2: Fannin County / Fannin CAD organisations — no ETJ layer"],
    note: "no published ETJ data found inside the circle" },
  { county: "Rains", share: 0.1, status: "none", sources: [], date: null,
    tried: ["M1: ArcGIS Online search for Emory, Point — no ETJ layer", "M2: Rains County / Rains CAD organisations — no ETJ layer"],
    note: "no published ETJ data found" },
];
/* Counties on the brief's list that the circle does NOT reach (measured) — recorded so nobody re-adds them. */
export const DFW_ETJ_COUNTIES_OUTSIDE_CIRCLE = ["Hood", "Somervell", "Jack"];
