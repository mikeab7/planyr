# State-plane audit — every NAD83 SPCS zone, all 50 states (NEW-1)

Owner ask (verbatim intent): Houston/Texas is right; every other state — Tennessee first — must run on **its own legally defined NAD83 State
Plane zone**; later amended: *every state, no exceptions, all ten Alaska zones included, Alaska zone 1 (Oblique Mercator) in scope.*

## 1 · What was wrong

`shared/coordinates/statePlane.js` registered three zones (`tx_sc` 2278, `co_north` 2231, `co_central` 2232). `resolveZone` returned **null**
anywhere else, and `shared/overlay/overlayPlacement.js` then fell back to the hardcoded EPSG:2278 Texas South Central grid. So a Tennessee,
Georgia or Louisiana site-plan overlay was **placed, scaled and rotated (grid convergence) on a cone centred on 99°W**. Texas itself only had
South Central — a Dallas or Austin site was wrong too. `proximityScreen.js` (every Site Analysis distance) had the same silent default (B290247).

## 2 · What exists now

* **122 zones** — every SPCS83 zone for the 50 states (AK 10, HI 5, TX 5, CA 6, …; Louisiana Offshore included). Constants are **read from EPSG**
  (pyproj 3.8.0 / PROJ 9.8.1), never typed from memory: `python3 scripts/gen-state-plane-zones.py` regenerates
  `src/shared/coordinates/statePlaneZones.js` + `statePlaneCounties.js` and `test/fixtures/statePlaneGolden.json`. Dev-time only; nothing in the app or CI runs Python.
* **Two modules, one engine.** `statePlaneCore.js` (zones, projections, units, the point resolver, the site-local frame — no county table) and `statePlane.js` (county-first resolution on top; re-exports the core). Point-only callers (`overlayPlacement`, `proximityScreen`) import the core so the 2,600-name table (22 KB) stays off the Site route's boot path — the bundle gate charges this branch +33 KB for the zone table instead of +55 KB.
* **Three projections**, one engine: Lambert Conformal Conic (the original code, untouched, so Texas stays bit-for-bit),
  **Transverse Mercator** (Karney's n⁶ series — the series PROJ uses; nanometre-accurate inside a zone) and **Hotine Oblique Mercator variant A**
  (EPSG 9812; Alaska zone 1 only).
* **Units are recorded on the zone and used.** `projectToZone`/`zoneToProject` speak the zone's own unit (`us-ft` | `ft` (international) | `m`);
  `unitInUsFt(zone)` is how the US-survey-foot overlay math and the screening distances rescale (exactly 1 for every ftUS zone).
  International foot: **AZ, MI, MT, ND, OR, SC** (confirmed — see §6). Metres: **AK, AL, HI, MO** (EPSG has no foot code for their NAD83 zones;
  the states legislate metres). US survey foot everywhere else. Utah is a decided ftUS (§4).
* **NEVER TEXAS.** No zone → `null` from `resolveZone`; overlay placement and the screening distances then use an explicit **site-local
  transverse Mercator** (`localFrameZone`, `zone.local === true`, scale 1 at the anchor) — labelled, never a state plane, never 2278.
* `queryFeatures`' dead `outSR = FEET_WKID` default (a silent 2278 for any county) is now WGS84.

### The zones

| State | id | EPSG | Zone | Projection | Unit | Counties |
|---|---|---|---|---|---|---|
| AL | `al_east` | 26929 | Alabama East | Transverse Mercator | m | 30 |
| AL | `al_west` | 26930 | Alabama West | Transverse Mercator | m | 37 |
| AZ | `az_east` | 2222 | Arizona East | Transverse Mercator | ft (intl) | 6 |
| AZ | `az_central` | 2223 | Arizona Central | Transverse Mercator | ft (intl) | 6 |
| AZ | `az_west` | 2224 | Arizona West | Transverse Mercator | ft (intl) | 3 |
| AR | `ar_north` | 3433 | Arkansas North | Lambert | ftUS | 40 |
| AR | `ar_south` | 3434 | Arkansas South | Lambert | ftUS | 35 |
| CA | `ca_1` | 2225 | California zone 1 | Lambert | ftUS | 9 |
| CA | `ca_2` | 2226 | California zone 2 | Lambert | ftUS | 18 |
| CA | `ca_3` | 2227 | California zone 3 | Lambert | ftUS | 15 |
| CA | `ca_4` | 2228 | California zone 4 | Lambert | ftUS | 6 |
| CA | `ca_5` | 2229 | California zone 5 | Lambert | ftUS | 6 |
| CA | `ca_6` | 2230 | California zone 6 | Lambert | ftUS | 4 |
| CO | `co_north` | 2231 | Colorado North | Lambert | ftUS | 16 |
| CO | `co_central` | 2232 | Colorado Central | Lambert | ftUS | 22 |
| CO | `co_south` | 2233 | Colorado South | Lambert | ftUS | 25 |
| CT | `ct` | 2234 | Connecticut | Lambert | ftUS | — |
| DE | `de` | 2235 | Delaware | Transverse Mercator | ftUS | — |
| FL | `fl_east` | 2236 | Florida East | Transverse Mercator | ftUS | 24 |
| FL | `fl_west` | 2237 | Florida West | Transverse Mercator | ftUS | 15 |
| FL | `fl_north` | 2238 | Florida North | Lambert | ftUS | 28 |
| GA | `ga_east` | 2239 | Georgia East | Transverse Mercator | ftUS | 57 |
| GA | `ga_west` | 2240 | Georgia West | Transverse Mercator | ftUS | 102 |
| HI | `hi_1` | 26961 | Hawaii zone 1 | Transverse Mercator | m | — |
| HI | `hi_2` | 26962 | Hawaii zone 2 | Transverse Mercator | m | — |
| HI | `hi_3` | 26963 | Hawaii zone 3 | Transverse Mercator | m | — |
| HI | `hi_4` | 26964 | Hawaii zone 4 | Transverse Mercator | m | — |
| HI | `hi_5` | 26965 | Hawaii zone 5 | Transverse Mercator | m | — |
| AK | `ak_1` | 26931 | Alaska zone 1 | Oblique Mercator | m | — |
| AK | `ak_2` | 26932 | Alaska zone 2 | Transverse Mercator | m | — |
| AK | `ak_3` | 26933 | Alaska zone 3 | Transverse Mercator | m | — |
| AK | `ak_4` | 26934 | Alaska zone 4 | Transverse Mercator | m | — |
| AK | `ak_5` | 26935 | Alaska zone 5 | Transverse Mercator | m | — |
| AK | `ak_6` | 26936 | Alaska zone 6 | Transverse Mercator | m | — |
| AK | `ak_7` | 26937 | Alaska zone 7 | Transverse Mercator | m | — |
| AK | `ak_8` | 26938 | Alaska zone 8 | Transverse Mercator | m | — |
| AK | `ak_9` | 26939 | Alaska zone 9 | Transverse Mercator | m | — |
| AK | `ak_10` | 26940 | Alaska zone 10 | Lambert | m | — |
| ID | `id_east` | 2241 | Idaho East | Transverse Mercator | ftUS | 13 |
| ID | `id_central` | 2242 | Idaho Central | Transverse Mercator | ftUS | 11 |
| ID | `id_west` | 2243 | Idaho West | Transverse Mercator | ftUS | 20 |
| IL | `il_east` | 3435 | Illinois East | Transverse Mercator | ftUS | 50 |
| IL | `il_west` | 3436 | Illinois West | Transverse Mercator | ftUS | 52 |
| IN | `in_east` | 2965 | Indiana East | Transverse Mercator | ftUS | 51 |
| IN | `in_west` | 2966 | Indiana West | Transverse Mercator | ftUS | 41 |
| IA | `ia_north` | 3417 | Iowa North | Lambert | ftUS | 54 |
| IA | `ia_south` | 3418 | Iowa South | Lambert | ftUS | 45 |
| KS | `ks_north` | 3419 | Kansas North | Lambert | ftUS | 46 |
| KS | `ks_south` | 3420 | Kansas South | Lambert | ftUS | 59 |
| KY | `ky_north` | 2246 | Kentucky North | Lambert | ftUS | 40 |
| KY | `ky_south` | 2247 | Kentucky South | Lambert | ftUS | 80 |
| LA | `la_north` | 3451 | Louisiana North | Lambert | ftUS | 29 |
| LA | `la_south` | 3452 | Louisiana South | Lambert | ftUS | 35 |
| LA | `la_offshore` | 3453 | Louisiana Offshore | Lambert | ftUS | — |
| ME | `me_east` | 26847 | Maine East | Transverse Mercator | ftUS | 7 |
| ME | `me_west` | 26848 | Maine West | Transverse Mercator | ftUS | 9 |
| MD | `md` | 2248 | Maryland | Lambert | ftUS | — |
| MA | `ma_mainland` | 2249 | Massachusetts Mainland | Lambert | ftUS | 12 |
| MA | `ma_island` | 2250 | Massachusetts Island | Lambert | ftUS | 2 |
| MI | `mi_north` | 2251 | Michigan North | Lambert | ft (intl) | 15 |
| MI | `mi_central` | 2252 | Michigan Central | Lambert | ft (intl) | 27 |
| MI | `mi_south` | 2253 | Michigan South | Lambert | ft (intl) | 41 |
| MN | `mn_north` | 26849 | Minnesota North | Lambert | ftUS | 16 |
| MN | `mn_central` | 26850 | Minnesota Central | Lambert | ftUS | 24 |
| MN | `mn_south` | 26851 | Minnesota South | Lambert | ftUS | 47 |
| MS | `ms_east` | 2254 | Mississippi East | Transverse Mercator | ftUS | 44 |
| MS | `ms_west` | 2255 | Mississippi West | Transverse Mercator | ftUS | 38 |
| MO | `mo_east` | 26996 | Missouri East | Transverse Mercator | m | 36 |
| MO | `mo_central` | 26997 | Missouri Central | Transverse Mercator | m | 47 |
| MO | `mo_west` | 26998 | Missouri West | Transverse Mercator | m | 31 |
| MT | `mt` | 2256 | Montana | Lambert | ft (intl) | — |
| NE | `ne` | 26852 | Nebraska | Lambert | ftUS | — |
| NV | `nv_east` | 3421 | Nevada East | Transverse Mercator | ftUS | 5 |
| NV | `nv_central` | 3422 | Nevada Central | Transverse Mercator | ftUS | 2 |
| NV | `nv_west` | 3423 | Nevada West | Transverse Mercator | ftUS | 9 |
| NH | `nh` | 3437 | New Hampshire | Transverse Mercator | ftUS | — |
| NJ | `nj` | 3424 | New Jersey | Transverse Mercator | ftUS | — |
| NM | `nm_east` | 2257 | New Mexico East | Transverse Mercator | ftUS | 13 |
| NM | `nm_central` | 2258 | New Mexico Central | Transverse Mercator | ftUS | 12 |
| NM | `nm_west` | 2259 | New Mexico West | Transverse Mercator | ftUS | 8 |
| NY | `ny_east` | 2260 | New York East | Transverse Mercator | ftUS | 26 |
| NY | `ny_central` | 2261 | New York Central | Transverse Mercator | ftUS | 19 |
| NY | `ny_west` | 2262 | New York West | Transverse Mercator | ftUS | 10 |
| NY | `ny_long_island` | 2263 | New York Long Island | Lambert | ftUS | 7 |
| NC | `nc` | 2264 | North Carolina | Lambert | ftUS | — |
| ND | `nd_north` | 2265 | North Dakota North | Lambert | ft (intl) | 27 |
| ND | `nd_south` | 2266 | North Dakota South | Lambert | ft (intl) | 26 |
| OH | `oh_north` | 3734 | Ohio North | Lambert | ftUS | 49 |
| OH | `oh_south` | 3735 | Ohio South | Lambert | ftUS | 39 |
| OK | `ok_north` | 2267 | Oklahoma North | Lambert | ftUS | 41 |
| OK | `ok_south` | 2268 | Oklahoma South | Lambert | ftUS | 36 |
| OR | `or_north` | 2269 | Oregon North | Lambert | ft (intl) | 24 |
| OR | `or_south` | 2270 | Oregon South | Lambert | ft (intl) | 12 |
| PA | `pa_north` | 2271 | Pennsylvania North | Lambert | ftUS | 31 |
| PA | `pa_south` | 2272 | Pennsylvania South | Lambert | ftUS | 36 |
| RI | `ri` | 3438 | Rhode Island | Transverse Mercator | ftUS | — |
| SC | `sc` | 2273 | South Carolina | Lambert | ft (intl) | — |
| SD | `sd_north` | 4457 | South Dakota North | Lambert | ftUS | 30 |
| SD | `sd_south` | 3455 | South Dakota South | Lambert | ftUS | 36 |
| TN | `tn` | 2274 | Tennessee | Lambert | ftUS | — |
| TX | `tx_north` | 2275 | Texas North | Lambert | ftUS | 26 |
| TX | `tx_north_central` | 2276 | Texas North Central | Lambert | ftUS | 88 |
| TX | `tx_central` | 2277 | Texas Central | Lambert | ftUS | 77 |
| TX | `tx_sc` | 2278 | Texas South Central | Lambert | ftUS | 49 |
| TX | `tx_south` | 2279 | Texas South | Lambert | ftUS | 14 |
| UT | `ut_north` | 3560 | Utah North | Lambert | ftUS | 8 |
| UT | `ut_central` | 3566 | Utah Central | Lambert | ftUS | 13 |
| UT | `ut_south` | 3567 | Utah South | Lambert | ftUS | 8 |
| VT | `vt` | 5646 | Vermont | Transverse Mercator | ftUS | — |
| VA | `va_north` | 2283 | Virginia North | Lambert | ftUS | 24 |
| VA | `va_south` | 2284 | Virginia South | Lambert | ftUS | 82 |
| WA | `wa_north` | 2285 | Washington North | Lambert | ftUS | 17 |
| WA | `wa_south` | 2286 | Washington South | Lambert | ftUS | 21 |
| WV | `wv_north` | 26853 | West Virginia North | Lambert | ftUS | 25 |
| WV | `wv_south` | 26854 | West Virginia South | Lambert | ftUS | 30 |
| WI | `wi_north` | 2287 | Wisconsin North | Lambert | ftUS | 12 |
| WI | `wi_central` | 2288 | Wisconsin Central | Lambert | ftUS | 28 |
| WI | `wi_south` | 2289 | Wisconsin South | Lambert | ftUS | 32 |
| WY | `wy_east` | 3736 | Wyoming East | Transverse Mercator | ftUS | 9 |
| WY | `wy_east_central` | 3737 | Wyoming East Central | Transverse Mercator | ftUS | 6 |
| WY | `wy_west_central` | 3738 | Wyoming West Central | Transverse Mercator | ftUS | 4 |
| WY | `wy_west` | 3739 | Wyoming West | Transverse Mercator | ftUS | 4 |

## 3 · Resolution rule per state

`resolveZone({ state, county, lat, lon })`, in this order:

1. **Alaska** (`state: "AK"`) — by **position**, not borough (boroughs straddle the bands). EPSG's area text names the statutory meridians:
   zone 1 east of 141°W (panhandle) · zones 2–9 the 4°-wide bands 144/148/152/156/160/164/168°W (zone 8 and 9 north of 54°30′N; zone 9 is
   everything west of 168°W) · zone 10 the Aleutians south of 54°30′N. A borough with no point → honest null.
2. **Hawaii** — by **island** (zone bounds don't overlap); counties map Hawaii→1, Maui/Kalawao→2, Honolulu→3, Kauai→4; Niihau (Kauai County) is
   zone 5 and is found by position.
3. **County first** for multi-zone states (boundaries follow county lines): the table is each zone's EPSG "counties of …" list — **36 states, 2,601
   county slugs**. Names are slugged (letters only; County/Parish/Borough/Census Area/Municipality/City/and/of removed; accents folded; the app's
   routing prefix `ga_`, `co_`, `fl_` … stripped), so `"Fulton"`, `"FULTON COUNTY"`, `"ga_fulton"` all land on one key.
4. **Single-zone states** resolve from the state alone — CT, DE, MD (+DC), MT, NE, NH, NJ, NC, RI, SC, TN, VT.
5. **A county that is not in the table** is a *known gap*: only the state's own coarse boxes may answer, flagged `unassignedCounty` — never the
   neighbour's zone, never Texas.
6. **No state** (a bare lat/lon — Map/Comps overlay anchors carry no county): **the county the point is in comes first** (B2494336, 2026-10-29).
   `public/geo/county-polygons.json` is point-in-polygon tested and the county's zone read from the county table
   (`site-planner/lib/pointZoneLocator.js`, installed into the lean core by `countyPolygons.js` the moment the polygons are resident; answer
   `via: "county-point"`, not coarse, `nearEdge: true` within ~150 m of a county line). Only when no county answer exists — the polygons
   have not loaded yet, the point is outside every county, or the state in the call disagrees with the county found — do the coarse boxes
   answer: the two legacy envelopes (Houston area → `tx_sc`; Front Range → `co_north`/`co_central`, both unchanged), then each zone's EPSG
   area-of-use box, **the box the point sits deepest inside winning**. Always `coarse: true`, plus `ambiguous: true` when more than one
   box held it. Outside every box → `null`. Why: the Houston box (27.0–31.2 N, −99.8 – −93.5 W) swallows Conroe, Liberty and Beaumont-area
   Texas Central counties; measured over eleven points the old boxes were wrong at Conroe, Liberty (→ `tx_sc`), Yonkers (→ Long Island),
   Anaheim (→ CA 5) and Memphis (→ Arkansas North).

## 4 · Decided assignments (judgment calls — `decided: true` + `decisionNote`, same pattern as Broomfield)

| Assignment | Decision | Why |
|---|---|---|
| **Broomfield, CO** | `co_north` | Unchanged (COLORADO-AUDIT.md). Statute genuinely silent (C.R.S. 38-52-101 predates the 2001 county). |
| ~~Montgomery, TX~~ | **removed 2026-10-29 (B2478961)** | Was `tx_sc` kept as a legacy exception. **Owner decision: SWITCH** — Tex. Nat. Res. Code §21.074(c) names Montgomery in Texas CENTRAL (EPSG:2277). Standing rule: in every state that splits into zones, every county sits in the zone its statute assigns; no legacy exceptions; a `decided:true` row is allowed only where the statute is genuinely silent (Broomfield is the model). Harris, Fort Bend, Waller, Chambers stay `tx_sc`, bit-for-bit. |
| ~~Carson City, NV~~ | **no longer decided (B2494337, 2026-10-29)** | NRS 327.010(2) names Carson City in the West Zone, so it is a plain `nv_west` row. |
| Billings County, ND | `nd_south` | In neither list of N.D.C.C. 47-20.2-01(1) (the South list names 25 counties; the table has 26). Statute silent; the surrounding Golden Valley, Stark, Dunn and Slope counties are all South. The one NEW `decided:true` row from the cross-check. |
| Grant County, WA | `wa_north` / `wa_south` by latitude 47°30′N | EPSG splits it "north / south of approximately 47°30′N"; a point is required, else null. |
| Kauai County, HI | `hi_4`, Niihau → `hi_5` by position | Kauai County holds two zones. |
| ~~23 Virginia independent cities~~ | **no longer decided (B2494337, 2026-10-29)** | Va. Code 1-601 names every one of them in the zone the surrounding-county rule gave it, so they are plain table rows. The table below is kept as the record of which county each took its zone from. |
| California offshore islands | `ca_6` by position | Pub. Res. Code §8802 puts Santa Catalina and San Clemente (Los Angeles Co.), San Nicolas and Santa Barbara Island in Zone 6 while their counties are Zone 5. A named, statute-backed rule (not a decision): `CA_ISLAND_ZONE6` in `statePlaneCore.js`, exact on the island, never on the mainland or on Anacapa / the northern Channel Islands. |
| Utah | **ftUS** (EPSG 3560/3566/3567), not the international-foot codes (2280–2282) | Utah Code §57-10-3 gives 1983 values in metres and survey feet for 1927; 2026 HB 512 adopts SPCS 2022 (international foot). Unit affects only the native grid numbers, never lat/lon. |
| Hawaii | metres for all five | NGS/EPSG define Hawaii in metres (EPSG 3759 ftUS for zone 3 is an alternate). |
| Old / mistyped county names | aliases: `dade`→`miamidade`, `shannon`→`oglalalakota`, `mountrial`→`mountrail` (EPSG typo) | Renames / typo in the EPSG text. |

**Re-review of the remaining decided rows (closed 2026-10-29, B2494337).** The owner read the statutes (§10): Carson City and all 23 Virginia independent cities are named, so they left the decided set; Billings County, ND joined it; Broomfield, Grant WA and the Hawaii county→island rows are unchanged. `test/statePlaneStatute.test.js` pins the exact set and demands a note naming the gap on each. Utah's unit (ftUS vs international foot) is a unit, not a county zone, and is unaffected.

Independent Virginia cities (zone = the county that surrounds them — Va. Code 1-601 confirms each; no longer `decided`):

| city | zone | surrounded by |
|---|---|---|
| alexandria | `va_north` | Fairfax County |
| buenavista | `va_south` | Rockbridge County |
| charlottesville | `va_south` | Albemarle County |
| covington | `va_south` | Alleghany County |
| danville | `va_south` | Pittsylvania County |
| emporia | `va_south` | Greensville County |
| fallschurch | `va_north` | Arlington County |
| fredericksburg | `va_north` | Spotsylvania County |
| galax | `va_south` | Carroll County |
| harrisonburg | `va_north` | Rockingham County |
| hopewell | `va_south` | Prince George County |
| lexington | `va_south` | Rockbridge County |
| manassas | `va_north` | Prince William County |
| manassaspark | `va_north` | Prince William County |
| martinsville | `va_south` | Henry County |
| poquoson | `va_south` | York County |
| radford | `va_south` | Pulaski County |
| salem | `va_south` | Roanoke County |
| staunton | `va_north` | Augusta County |
| virginiabeach | `va_south` | Northampton County |
| waynesboro | `va_north` | Augusta County |
| williamsburg | `va_south` | James City County |
| winchester | `va_north` | Frederick County |

Observation, not a decision: Virginia's "Richmond" appears once in EPSG's South list and stands for both the independent city and Richmond
County, which therefore share a slug and a zone.

## 5 · Accuracy

* **Projection:** all 122 zones × 3 points (366 points; the Aleutians use three real islands because their box crosses the antimeridian), forward
  and inverse, against PROJ — worst error **0.0003 ft**, against a bar of 0.01 ft (`test/statePlaneAllZones.test.js`, §2). Alaska zone 1 has its
  own inline golden (Juneau, Ketchikan), and scale factor + convergence are checked on 8 more points from PROJ's `get_factors`.
* **County table:** all **3,144** counties in `public/geo/county-polygons.json` resolve to a zone of their own state, and so does every county key
  `counties.js` serves (`test/statePlaneAllZones.test.js` §6). The generator refuses to run if a county in a multi-zone state is unassigned.
* **Point-only fallback** (coarse by design): measured on the 3,144 county bbox-centres — **89.7% exact zone, 3.2% a neighbouring zone of the
  right state, 7.2% a neighbouring state's zone**. Near a state line a county or state in the call always wins; callers that have one should pass it.
* **Convergence:** `gridConvergenceDeg` (pre-existing) converts the east component with cos(lat) alone, so it is within 0.6% of PROJ's value (+0.001°)
  everywhere — Nashville 0.002°, Dallas 0.004°, Unalaska 0.016°. Left alone on purpose: Texas and Colorado placements are pinned by goldens and
  the brief fixed Texas South Central. Filed as B2478962.

## 6 · Units — what was verified

NGS (st_plane policy, 1991) records the international foot in **6** states and the US survey foot in 11 in the SPCS83 legislation, the metre alone in the rest;
EPSG carries `(ft)` codes for exactly **AZ, MI, MT, ND, OR, SC** (+ Utah, decided above) and `(ftUS)` for the rest. Arizona's statute (A.R.S. 33-132) defines
the foot as 0.3048 m. The six international-foot states are asserted by a test.

## 7 · Consumer audit — who read 2278, and what happened

| Consumer | Finding | Action |
|---|---|---|
| `shared/overlay/overlayPlacement.js` `projectorsFor` / `gridRotationDeg` / `alignOverlayGeo` | **Core bug.** Null zone → hardcoded EPSG:2278 | Fixed: `placementZone` = resolved zone else the site-local frame; rescaled to US feet by `unitInUsFt`; the same zone feeds convergence. |
| `site-planner/lib/proximityScreen.js` + `siteChecks.js` (every Site Analysis distance and area) | Projected every point through the Texas cone (B290247: Colorado +1.93%) | Fixed: ONE plane per measurement (`planeForRings`), shared by rings and features. B290247 → Done. |
| `shared/coordinates/scaleFactor.js` `combinedScaleFactor` | Uses `resolveZone`; null for unmodelled ground | Now covers all states automatically; `gridScaleFactor(zone, lat, lon)` takes the longitude for TM/HOM zones. |
| `site-planner/lib/deedAlign.js` / `SitePlanner.jsx` `gridConvergenceDeg` | Already zone-aware (B290241) | Now covers all states automatically. |
| `shared/coordinates/index.js` `projectToGrid`/`PROJECT_CRS` | The original hardcoded EPSG:2278 | **Left alone** (legacy, Texas-only, proven bit-identical to `tx_sc`). Remaining importers below are Texas-only by construction. |
| `shared/thoroughfare/ingestTransform.js` (`geom_2278`) | City of Houston Thoroughfare Plan ingest only | **Confirmed Texas-only**, unchanged. |
| `site-planner/lib/fbcdWse.js`, `coverage.js` (`STATEPLANE_2278`) | Fort Bend / Houston-area service extents published in SR 2278 | **Confirmed Texas-only data sources**, unchanged. `extent2278` in `shared/gis/sources.js` stays as is. |
| `site-planner/lib/arcgis.js` `queryFeatures` default `outSR = FEET_WKID` | A silent 2278 default (both callers pass 4326) | Default changed to 4326. |
| `kmzExport.js`, `elevation.js`, `footprintEdit.js`, comments naming EPSG:2278 | The planner's own per-site feet frame; US survey foot constants | No state plane involved. |

## 8 · Scoped out / not done — said plainly

* **Nothing in the 50-state scope was left out**: all 122 zones, all 10 Alaska zones (zone 1 included, with its own golden), Hawaii's 5, Louisiana Offshore.
* **Louisiana Offshore** is registered and tested but never resolves from a parish or a bare point (it is federal water, not a parish); reach it by id.
* **Alaska zone 8/9/10 offshore edges** follow the meridians/latitude in EPSG's area text; the 54°30′N line and the −164.84° eastern limit of zone 10 are as published, not surveyed here.
* **Territories** (Puerto Rico, USVI, Guam, American Samoa) are not in the 50-state ask and are not registered.
* **Alaska boroughs** do not resolve to a zone without a point (by design).
* **Open follow-ups**: B2478962 (convergence ellipsoid factor). B2478961 (Montgomery) and B2478963 (coarse bare-point zone) are CLOSED by the 2026-10-29 owner decision and B2494336 — see §3 step 6 and §4. B2494337: the statute cross-check is CLOSED (§10) — the one residual is that five states' statutes defer to NGS and Florida's lists no counties, so those six are matched to EPSG, which is not independent of this generator.

## 9 · Regenerating

```bash
python3 -m venv /tmp/pv && /tmp/pv/bin/pip install pyproj
/tmp/pv/bin/python scripts/gen-state-plane-zones.py      # rewrites statePlaneZones.js + statePlaneCounties.js + test/fixtures/statePlaneGolden.json
npx vitest run test/statePlaneAllZones.test.js test/statePlane.test.js
```

## 10 · Statute cross-check of the county tables (B2494337, closed 2026-10-29)

The generated tables come from EPSG's area-of-use lists. Owner rule: the **statute** wins wherever it disagrees; `decided:true` only where the statute is genuinely silent. All 36 multi-zone states were checked in two passes on 2026-10-29. Pass 1 (a sandbox that could not reach any legislature host) verified Texas and Kentucky. Pass 2 is the owner's chat reading the statute text of the remaining 33 states; **those readings are the owner's evidence, recorded here with the citations given** — this session's network policy still blocks the legislature hosts, so it re-derived none of them and checked only what it could (below).

| State | Result | Source read |
|---|---|---|
| **TX** | ✅ verified, no disagreement | Tex. Nat. Res. Code §21.074(a)–(e) (254 counties, each once; zone sizes 26/88/77/49/14) |
| **KY** | ✅ verified, no disagreement | KSPCS Standards (KRS 1.020 → 200 KAR 41:010), 40 north / 80 south |
| AL · AZ · IA · IL · IN · KS · LA · MA · ME · MI · MN · MS · MO · NM · NY · OH · OK · VA · WI · WV · WY · WA | ✅ **match by statute text** | AL Ala. Code 35-2-1 · AZ A.R.S. 33-131(B) · IA Iowa Code 355.17 · IL 765 ILCS 225/3 · IN IC 32-19-1-2 · KS K.S.A. 58-20a09 (all 29 named counties right) · LA R.S. 50:1(C),(D) · MA MGL c.97 §8 · ME 33 MRSA 801-A · MI MCL 54.231 · MN Minn. Stat. 505.18 · MS Miss. Code 89-6-1 · MO RSMo 60.410 (2016 text) · NM NMSA 47-1-49(A) · NY L.1995 ch.605 (NYC boroughs in the Long Island zone) · OH ORC 157.01 · OK 60 O.S. 1001(B) · VA Va. Code 1-601 · WI Wis. Stat. 236.18(3) · WV 1-1-5(e) (2018 enrolled) · WY 1993 W.S. 34-24-101(b) · WA 1989 c.54 / RCW 58.20.130 before its 2020 repeal (Grant split at 47°30′N correct) |
| **CA** | ✅ matches Pub. Res. Code §8802 (mainland); **offshore islands corrected** | see NEW-3 below |
| **GA** | ❌ **1 disagreement — corrected** | O.C.G.A. 44-4-20(b)(2) West Zone list "… Jones, Lamar, **Lanier**, Lee, Lowndes …"; EPSG/NGS had Lanier in East → now `ga_west` |
| **AR** | ❌ **1 disagreement — corrected, with a caveat** | see NEW-2 below |
| **ND** | ⚠ statute silent on one county | N.D.C.C. 47-20.2-01(1): Billings is in neither list → `decided:true`, kept `nd_south` |
| **NV** | ✅ match; Carson City now statute-backed | NRS 327.010(2) names Carson City in the West Zone → plain row, no longer decided |
| ID · OR · PA · SD · UT | ✅ match **via EPSG/NGS only** — **not independent of this generator's source** | the statute defers to NGS and lists no counties |
| **FL** | ⚠ **unverified independently** | Fla. Stat. 177.151 lists no counties; only EPSG's list exists |
| SC · MT | ✅ one zone, stated in statute | |
| TN · NC · NJ · DE · RI · NH · MD · VT | ✅ one projection, one zone | |
| NE · CT | ✅ one zone; statute defers to NGS | |
| CO · HI · AK | not part of this read | Colorado is `COLORADO-AUDIT.md`; Hawaii is by island and Alaska by meridian band |

**Full diff, generated COUNTY_TABLE vs the raw EPSG area-of-use text, every state (2026-10-29, pyproj 3.8.0 / EPSG v12.029).** Every county list the generator reads from EPSG came back **identical to the EPSG text — 0 differences, in every zone that has a county list** (Massachusetts Island and Nevada Central have none; Louisiana Offshore is skipped by design). So **the generator moved no county.** The only things in the table that are not EPSG's list are the ones the generator adds on purpose and prints: the 23 Virginia independent cities and Carson City (statute-named, absent from EPSG's text) and the two statute overrides below. A zone-list name missing from the polygons asset, or a polygons county with no zone, is a run-time WARN in the generator and there are none.

### NEW-1 · Lanier County, GA → Georgia West (B2514416)
O.C.G.A. 44-4-20(b)(2) names Lanier in the West list; EPSG (NAD83 and NAD27 alike) lists it in East. **Statute wins.** Done as a `STATUTE_OVERRIDES` row in `scripts/gen-state-plane-zones.py` (never a hand edit of the generated file); the table is now `ga_east` 56 / `ga_west` 103 of Georgia's 159 (pass 1's unverified search-summary lead of "58 East counties vs our 57" was wrong in direction: the statute moves one county OUT of East, not into it). Red-proofs: Lanier by county key in every spelling, and Lakeland (31.0402, −83.0757) by bare point, → `ga_west`; the neighbours Lowndes/Berrien (West) and Clinch/Atkinson (East) did not move.

### NEW-2 · Pulaski County, AR (Little Rock) → Arkansas North (B2514417) — ⚠ the brief's mechanism is wrong, the outcome is applied
The brief said the generated table put Pulaski in `ar_south` although "EPSG says North", so "the generator or its polygon cross-check MOVED a county". **That is not what happened, and it is recorded so nobody re-hunts it:** the EPSG database shipped inside pyproj 3.8.0 (**EPSG v12.029, 2025-10-02**) lists Pulaski in **Arkansas South** — EPSG:26952 and 3434 (NAD83) and 26752 (NAD27) all contain "Pulaski", and 26951/3433/26751 (North) do not (40 / 35 counties). The full diff above found the generator reproduces EPSG exactly; nothing moved Pulaski. The owner's read of epsg.io (a newer EPSG release than this machine's) shows it in North, and the Arkansas Cadastral Mapping Standard (Rule 192.00.19-001) agrees at **41 North / 34 South** — exactly one county more than EPSG v12.029's 40 / 35. Ark. Code 15-21-301/305 defers to NGS and lists no counties. Per the owner's instruction Pulaski is now `ar_north` through a `STATUTE_OVERRIDES` row whose `why` says all of this; the generator prints `REDUNDANT override` and says to delete the row the day an EPSG database that already agrees is installed. **What is unconfirmed and should be re-read:** the EPSG release in which Pulaski moved (this machine's `epsg.io` is blocked; the NGS SPCS83 manual NOS NGS 5 carries the projection constants, not county lists). Red-proofs: Pulaski by county key, and Little Rock (34.7465, −92.2896) by bare point → `ar_north`; counts 41 / 34.

### NEW-3 · Bookkeeping from the statute read (B2514418)
* **ND** — Billings County: `nd_south`, now `decided:true`, note names the statutory gap and the four South neighbours.
* **NV** — Carson City: `decided` removed (NRS 327.010(2)); a plain `nv_west` row.
* **VA** — the 23 independent cities: `decided` removed (Va. Code 1-601 names each in the zone assigned); plain rows. `DECIDED_COUNTIES` now holds only Billings and the five Hawaii county rows.
* **MN** — slug is `lakethewoods` (the word "of" is a designation word). "Lake of the Woods", "LAKE OF THE WOODS COUNTY", the routing key `mn_lakethewoods` and the run-together `lakeofthewoods` / `mn_lakeofthewoods` all resolve to `mn_north` (the last two through a generator alias, `COUNTY_ALIASES`).
* **SD** — "Shannon", "Shannon County" and `sd_shannon` still resolve to Oglala Lakota County → `sd_south` (alias exists; now pinned).
* **CA offshore islands** — Pub. Res. Code §8802 puts **Santa Catalina and San Clemente (Los Angeles Co.), and San Nicolas and Santa Barbara Island** in Zone 6 while the rest of those counties is Zone 5 (the brief says "Zone 5/Zone 7"; NAD83 has no Zone 7 — Zone 7 was NAD27's Los Angeles zone — so the mainland answer is Zone 5). Coded as `CA_ISLAND_ZONE6` in `statePlaneCore.js`: four lon/lat extents, each holding one island and the water round it and no mainland, consulted **before** the county locator by a bare point (`via:"island-point"`) and by `zoneForCounty`/`resolveZone` when the call carries a latitude **and** longitude. Not a `decided` row — the statute names them. Avalon (33.3428, −118.3278) → `ca_6` by bare point and by county+point; Long Beach, Palos Verdes, Port Hueneme, downtown LA, Anacapa and Santa Cruz Island stay `ca_5`. **Said plainly:** the island list is the owner's reading of §8802 (the pass-1 GitHub mirror gave the same four); this session could not open the statute to re-confirm it, and the extents are boxes, not surveyed outlines — nothing but the named island lies inside any of them.

### What this does NOT establish
Six states (ID OR PA SD UT, plus FL's missing county list, and NE/CT which defer) are matched to EPSG/NGS, which is the same source this generator reads — a real statutory check of those would need a statute that lists counties, and none does. Everything marked ✅ above other than TX and KY rests on the owner's reading, not on text this session fetched.

## 11 · Units at the INPUT boundary — AL, MO, HI, AK (B2528672, 2026-10-29)

**The risk.** All 20 zones of Alabama (2), Missouri (3), Hawaii (5) and Alaska (10) have `unit:"m"` in `statePlaneZones.js` (the other 102 zones are `us-ft`/`ft`). `zoneToProject(zone, {x,y})` reads its argument in the zone's own unit, so a value a surveyor wrote in US survey feet and that reached it unconverted would land ~3.28× too far from the grid origin — hundreds of km out, no error. The projection math is not in question (§5, PROJ goldens, all 122 zones); this section is about units at the boundary where a *person or a file* supplies a grid number.

### Inventory — every place a grid coordinate could enter, and the unit each assumes

**Result: no path takes a person-supplied or file-supplied state plane coordinate into `zoneToProject`/`gridToProject` today.** Every grid number in the app is generated from lat/lon and handed straight back, in a unit the code states explicitly.

| # | Path | What enters | Unit handling | Verdict |
|---|---|---|---|---|
| 1 | `shared/overlay/overlayPlacement.js` (`projectorsFor`, corners, `alignOverlayGeo`) | lat/lon anchor + pixel math | `toGrid` = `projectToZone` × `unitInUsFt(zone)`; `toProject` divides by the same `k` before `zoneToProject`. Grid never leaves the file as a typed value | App-generated; explicit conversion both ways |
| 2 | `site-planner/lib/proximityScreen.js`, `siteChecks.js` | lat/lon | `projectToZone` × `unitInUsFt` | App-generated |
| 3 | `shared/coordinates/scaleFactor.js` `combinedScaleFactor` | lat/elevation | dimensionless factor | n/a |
| 4 | `scaleFactor.js` `detectSurveyFrame` | pairs of *distances* (`surveyFt`, `gridFt`) | feet by field name; **no caller in `src/`** | **Fixed**: a survey÷grid ratio of ≈3.2808 (or ≈0.3048) now returns verdict `unit-mismatch` with a plain `unitHint`, instead of being passed off as `other-scale` |
| 5 | Deed paste / PDF / OCR (`deedParse.js`, `metesAndBounds.js`, `SitePlanner.jsx` deed align) | bearings + distances from a point of beginning the user **clicks on the map** | no northing/easting is read from deed text (grepped); grid enters only as the convergence *angle* (`gridConvergenceDeg`), a unit-free number | No grid coordinate path |
| 6 | DXF/DWG overlay (`dxf/dxfGeom.js` `insunitsToFeet`, `dxfRender.js`) | drawing-space geometry | `$INSUNITS` → feet per unit; absent/0 ⇒ assumed feet **and flagged** `known:false` ("Units assumed: feet — verify"). Placed by hand/scale/2-point match, **never georeferenced from the DXF's coordinates** | Declared unit used; unknown is flagged, not silent |
| 7 | KML/KMZ import (`comps/lib/kmlImport.js`) | lon/lat | WGS84 by the KML spec | n/a |
| 8 | CSV/Excel (Model workspace) | cells | no coordinate semantics | n/a |
| 9 | ArcGIS / MapGuide / GISCloud geometry (`arcgis.js`, `mapguideAdapter.parseQueryGeometry`) | service geometry / query envelope | requested `outSR=4326` (default fixed in §7); `parseQueryGeometry` accepts only 4326/3857 and **refuses any other `inSR` loudly** | Never a state plane value |
| 10 | `site-planner/lib/coverage.js` `srPointToLatLon` (service extents) | an extent in the service's wkid | decoded only for wkid 2278/102740 (Texas South Central, ftUS) via the legacy `gridToProject`; **every other wkid returns `null` and the layer fails open** — an AL/MO/HI/AK extent (e.g. 26929) is never decoded, so never misread | Texas-only by construction |
| 11 | `shared/placement/placeOnMap.js` EMBEDDED rung | would be a file's embedded coordinates + `crs` | `facts.embeddedCoords.crs` is recorded; `ctx.canReproject` is **never set anywhere** and nothing in `src/` imports the module, so the rung never runs ("reprojection … isn't available yet"). **When that rung is built it must read the unit through `statePlaneInput.js`** | Dormant |
| 12 | `parcelAreaFields.js` (service area columns) | an *area* in the service's native unit | each source carries an explicit probed unit tag (`m2wm`, …) | Explicit, not assumed |
| 13 | `thoroughfare/ingestTransform.js`, `fbcdWse.js` | lat/lon → 2278 | Texas South Central only | Confirmed Texas-only (§7) |

`functions/`, `server/` and `scripts/` call none of the zone functions.

### What was built (the door and the guard)

* **`src/shared/coordinates/statePlaneInput.js`** — the unit-explicit boundary a future path must use. `gridInputToLatLon(zone, xy, unit)` has **no default unit** (throws without `"us-ft" | "ft" | "m"`); `gridUnitFromPrj(wkt)` reads the unit a `.prj`/WKT declares for its projected CRS by *factor*, not by name (ESRI `Foot_US`, EPSG "US survey foot", WKT2 `LENGTHUNIT` all work; unrecognised ⇒ `null`); `detectGridUnit(zone, xy, site)` decodes under each candidate unit and keeps the ones that land within 50 km of the site — one survivor is confident, two or none is `ask:true` with **US survey feet preselected** (international feet only in a statutory-international-foot zone such as AZ), and a value that lands nowhere is flagged `fitsNeither`, never converted silently. Nothing imports it yet, so it adds no bundle.
* **`test/stateplaneInputUnit.test.js`** — (a) red-proof for **all 20 metre zones**: the same ground point given as US survey feet tagged `us-ft` lands on the ground (< 1 cm), given as metres tagged `m` lands on the ground, and the feet value read through the zone's own unit (the bug) lands > 100 km away; the Alabama East / Birmingham case is named explicitly (> 300 km off). (b) **The guard:** any file in `src/` other than the audited five that calls `zoneToProject`/`gridToProject` fails the build, naming the file and the fix; the allow-list is itself checked for rot, and the scanner carries a known-bad arm (a synthetic offender must be flagged or the run is VOID). Teeth proof run 2026-10-29: planting `src/shared/coordinates/zzRogueImport.js` calling `zoneToProject` turned it red; removed.
* `statePlaneCore.js` now exports `UNIT_M` (the metres-per-unit table that was already there) — no behaviour change; Texas South Central stays bit-identical (`statePlane` suite green).

### What EPSG says about feet variants (pyproj 3.8.0 / EPSG v12.029, queried 2026-10-29)

A distinct ftUS code exists for **Alabama East/West: EPSG 9748 / 9749** (NAD83(2011)) and **Hawaii zone 3: 3759 (NAD83), 3760 (HARN), 6633 (PA11)**. **None exists for Missouri or Alaska** (their NAD83 / HARN / NSRS2007 / 2011 codes are all metre). Because the Alabama codes are the NAD83(2011) realisation (a ~1 m datum shift from the NAD83 base the zone table uses) and a code-to-unit table would have to be generated and pinned like the zone table, this item did **not** add an EPSG-code→unit map; a future path that reads an EPSG code must treat an unrecognised code as "undeclared" (⇒ `detectGridUnit` ⇒ ask), never as metres or feet.

### Statute lookup — what each state legislates as the grid unit (step 3). **NOT CONFIRMED; zone units unchanged.**

This session's network blocks every legislature host (`law.justia.com`, `revisor.mo.gov`, `www.akleg.gov`, `www.capitol.hawaii.gov` all fail to resolve — the same wall §10 recorded), so no statute text was read. What a web search returned, with how far it can be trusted:

| State | Citation asked for | What was found | Status |
|---|---|---|---|
| AL | Ala. Code 35-2-1 et seq. | Search returned only the structure of §35-2-1 (the system, East/West zones, counties by zone). The unit-of-length language (probably §35-2-3, "Plane coordinates used in system") was not retrieved | **Unconfirmed** |
| MO | RSMo 60.401 et seq. | A secondary copy of the **2011** text of §60.431 says distances are US Survey Feet for the 1927 system and **metres for the 1983 system**. Newer bill drafts and a proposed rule (20 CSR 2030-17.070, citing 60.401 RSMo Supp. 2024) say that when feet are used **the international foot** is the standard foot — *proposed text, enactment not confirmed* | **Unconfirmed**; if the international-foot text is law, Missouri feet are international feet (2 ppm from US survey feet: about 1–2 ft at Missouri's easting magnitudes) and `preselectedFootUnit` would need MO to preselect `ft` |
| HI | "HRS ch. 7?" | No Hawaii statute defining the state plane system was found by search; registry listings (ESRI/EPSG) define the zones, with an ftUS code for zone 3 | **Unconfirmed that a statute exists** |
| AK | AS 34.80 | Search did not find the Alaska coordinate system under AS 34.80; the hits point to **AS 38.20** (a 2021 bill amending AS 38.20.010 refers to the "Alaska Coordinate System of 1983"). Unit language not retrieved | **Unconfirmed**; chapter citation in the brief looks wrong |

Per the item, **the zone tables' `unit` is not changed** (nothing read says otherwise). To close this row someone must read the four sections with the legislature hosts reachable — added to `OWNER-TODO.md`.
