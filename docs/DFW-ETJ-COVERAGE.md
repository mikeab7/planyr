# DFW ETJ coverage — the 19 counties inside 50 miles of Dallas City Hall

> Generated from `ui-audit/lib/dfwEtjCounties.mjs` (the one list; `test/dfwEtjCounties.test.js` ties it to the registry). Measured 2026-09-30. Re-check with `NODE_USE_ENV_PROXY=1 node ui-audit/audit-dfw-etj-gaps.mjs`, `ui-audit/audit-etj-coverage.mjs` (roster drift) and, for the hosts the build sandbox cannot reach, `BASE_URL=https://planyr.io node ui-audit/verify-dfw-etj-browser-hosts.mjs` from a browser.

**Read this first.** NCTCOG publishes no ETJ layer in its hub catalogue (195 datasets); its server is denied to the build sandbox but answers from the owner's browser, where no ETJ-named layer was found — one lead is still unread (Boundaries/Boundaries layer ids 7, 8, 10). **`complete` is the only status where "no ETJ hit" reads Unincorporated**; a strip the county marks "Undetermined" reads "ETJ undetermined (disputed)"; a Fort Worth release area reads "release area (SB 2038)"; everywhere else a miss reads **"ETJ data unavailable"**.

| County | Share of circle | Status | Newest publisher date | Sources |
|---|---|---|---|---|
| Ellis | 12.2% | partial | 2026-02-02 | `etj_ellis`, `etj_waxahachie`, `etj_johnson` |
| Denton | 11.7% | partial | 2026-09-24 | `etj_denton`, `etj_fortworth`, `etj_collin` |
| Dallas | 11.5% | partial | 2024-02-06 | `etj_dallasco`, `etj_sunnyvale`, `etj_collin`, `etj_johnson` |
| Tarrant | 11.5% | partial | 2026-09-01 | `etj_fortworth`, `etj_release_fortworth`, `etj_mansfield`, `etj_johnson` |
| Collin | 11.3% | complete | 2026-09-26 | `etj_collin` |
| Kaufman | 10.4% | partial | 2025-04-10 | `etj_forney`, `etj_talty`, `etj_dallasco` |
| Johnson | 6.9% | partial | 2026-09-01 | `etj_johnson` |
| Hunt | 6.3% | partial | 2026-09-26 | `etj_collin` |
| Navarro | 4.1% | partial | 2026-05-08 | `etj_corsicana`, `etj_bloominggrove` |
| Van Zandt | 2.2% | none | — | no published ETJ data found |
| Parker | 2.1% | none | — | no published ETJ data found |
| Grayson | 2.1% | partial | 2024-07-24 | `etj_grayson` |
| Wise | 2% | none | — | no published ETJ data found |
| Hill | 1.8% | none | — | no published ETJ data found |
| Rockwall | 1.8% | complete | 2026-06-25 | `etj_rockwall`, `etj_collin` |
| Henderson | 1.1% | none | — | no published ETJ data found |
| Cooke | 0.5% | none | — | no published ETJ data found |
| Fannin | 0.2% | none | — | no published ETJ data found |
| Rains | 0.1% | none | — | no published ETJ data found |

## Per county

### Ellis County — partial
Ellis compilation (Ennis, Maypearl, Midlothian, Oak Leaf, Ovilla, Palmer, Pecan Hill, Red Oak — some rows self-labelled "Need to Research"/"Unofficial") + Waxahachie's own layer + Midlothian via the Johnson SUD compile. Missing: Ferris, Italy, Milford, Garrett, Bardwell.

### Denton County — partial
Denton County GIS's OWN CURRENT table (CityETJPermits_GC/MapServer/3 — 40 polygons, last edited 2026-09-24; probed from the owner's browser, the host is unreachable from the build sandbox), replacing the 2022 edition. Five polygons are NAME='Undetermined': the county's word for a strip two cities claim — they read "ETJ undetermined (disputed)", are never assigned to a city, never read as unincorporated. One is TYPE 'DIV 2' (Denton's second ETJ division): read as a Denton ETJ. The city list was not enumerated, so nothing claims which cities it carries and the county is not declared complete.

### Dallas County — partial
Dallas County GIS: Combine, Ferris, Hutchins, Lancaster, Seagoville, Wilmer, Wylie — the `City` column carries the names (the `NAME` column reads "ETJ"); M3 spatial join withheld 10 of 48 polygons whose name no adjoining city limit confirmed. Plus Sunnyvale (town-published), Garland/Allen/Murphy/Wylie via Collin's table, Grand Prairie via the Johnson SUD compile. Not found: Mesquite (2018 only), Cedar Hill, DeSoto, Duncanville, Irving, Rowlett (host blocked).

### Tarrant County — partial
Fort Worth's OWN current ETJ (OpenData_Boundaries/MapServer/1 — 81 polygons, DATESTAMP max 2026-09-01; browser-probed) plus its SB 2038 release-area layer (a point inside one reads "Fort Worth ETJ release area (SB 2038)", never a plain ETJ — the layer's attributes are unread, so no claim is made about whether a release is effective), Mansfield (city GIS, 2026), and Crowley/Burleson/Grand Prairie via the Johnson SUD compile. Tarrant County's own server answers from a browser but has no ETJ-named layer in GeoData, Dynamic, Tax or Elections; the one unread lead is Transportation/ETJ/MapServer/0 (edited 2020). Not found: Arlington, Keller, Southlake, Colleyville, Azle (private layer, token required), Benbrook (2018 only).

### Collin County — complete
Collin County GIS, 33 city names; declared complete.

### Kaufman County — partial
Forney and Talty from a consultant's 2025 planning service (M3: named by the abutting city limits — Forney 25.3%, Talty 42.2%); Combine/Seagoville reach in via Dallas County's table. Found but not wired (2018, pre-SB 2038, "claimed" ETJs): Kaufman, Terrell, Mesquite. Forney's own server is a blocked host. Not found: Crandall, Kemp, Mabank, Heath's Kaufman side.

### Johnson County — partial
Johnson County Special Utility District's 2025 compile: Alvarado, Briaroaks, Burleson, Cleburne, Coyote Flats, Cresson, Cross Timber, Godley, Grandview, Joshua, Keene, Rio Vista, Venus (+ Fort Worth, Crowley, Grand Prairie, Mansfield, Midlothian edges). A utility district's compile, not the county's — not declared complete. City-published Alvarado (2026) exists but duplicates it.

### Hunt County — partial
Greenville, Caddo Mills and Celeste ETJs arrive via Collin County's table (`HuntCo-…` rows). Greenville also publishes its own 2-mile ETJ (2024; not wired — duplicates). Not found: Commerce, Quinlan, Wolfe City, Lone Oak.

### Navarro County — partial
Corsicana (M3: the publisher's layer is titled just "ETJ"; it abuts Corsicana's limits over 33.7%, next best 4.3%) and Blooming Grove (2024). Not found: Kerens, Rice, Angus.

### Van Zandt County — none
no published ETJ data found
- tried: M1: ArcGIS Online search for Wills Point, Canton, Edgewood, Grand Saline — no ETJ layer
- tried: M2: county / appraisal-district organisations — no ETJ or jurisdiction layer

### Parker County — none
no published ETJ data found
- tried: M1: ArcGIS Online search for Weatherford, Aledo, Springtown, Hudson Oaks, Willow Park — none (Azle's layer is private)
- tried: M2: Parker County / Parker CAD organisations — no ETJ layer; Parker County GIS not reachable

### Grayson County — partial
Sixteen Grayson County cities' ETJs from a thoroughfare-plan consultant layer (2024) — not the county's own table, so not declared complete. Only the county's southern strip is inside the circle.

### Wise County — none
no ETJ data current enough to wire
- tried: M1: ArcGIS Online search for Decatur, Rhome, Bridgeport, Runway Bay — found Decatur (City of Decatur, 2021-09-02, pre-SB 2038) and Runway Bay (2025, consultant layer), neither wired
- tried: M2: Wise County / Wise CAD organisations — no ETJ layer

### Hill County — none
no published ETJ data found
- tried: M1: ArcGIS Online search for Hillsboro, Whitney, Itasca — no ETJ layer
- tried: M2: Hill County / Hill CAD organisations — no ETJ layer

### Rockwall County — complete
Rockwall County GIS, six cities; declared complete.

### Henderson County — none
no published ETJ data found
- tried: M1: ArcGIS Online search for Mabank, Gun Barrel City, Seven Points, Kemp, Athens — Athens' layer is private (token required)
- tried: M2: Henderson County / Henderson CAD organisations — no ETJ layer

### Cooke County — none
no published ETJ data found
- tried: M1: ArcGIS Online search for Gainesville, Lindsay, Valley View — no ETJ layer
- tried: M2: Cooke County / Cooke CAD organisations — no ETJ layer

### Fannin County — none
no published ETJ data found inside the circle
- tried: M1: ArcGIS Online search for Bonham, Honey Grove, Leonard — Bonham's ETJ (2024) exists but lies outside the circle
- tried: M2: Fannin County / Fannin CAD organisations — no ETJ layer

### Rains County — none
no published ETJ data found
- tried: M1: ArcGIS Online search for Emory, Point — no ETJ layer
- tried: M2: Rains County / Rains CAD organisations — no ETJ layer

## Not reached by the circle
Hood, Somervell, Jack (on the brief's list; measured outside the 50-mile circle).

## Mechanisms and hosts
See the header of `ui-audit/lib/dfwEtjCounties.mjs` (M1–M4, the browser-only hosts and what each one showed, and the hosts still blocked).
