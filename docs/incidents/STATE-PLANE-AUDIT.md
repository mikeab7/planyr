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
  `src/shared/coordinates/statePlaneData.js` and `test/fixtures/statePlaneGolden.json`. Dev-time only; nothing in the app or CI runs Python.
* **Three projections**, one engine (`statePlane.js`): Lambert Conformal Conic (the original code, untouched, so Texas stays bit-for-bit),
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
6. **No state** (a bare lat/lon — Map/Comps overlay anchors carry no county): the two legacy envelopes first (Houston area → `tx_sc`; Front Range →
   `co_north`/`co_central`, both unchanged), then each zone's EPSG area-of-use box, **the box the point sits deepest inside winning**. Always
   `coarse: true`, plus `ambiguous: true` when more than one box held it. Outside every box → `null`.

## 4 · Decided assignments (judgment calls — `decided: true` + `decisionNote`, same pattern as Broomfield)

| Assignment | Decision | Why |
|---|---|---|
| **Broomfield, CO** | `co_north` | Unchanged (COLORADO-AUDIT.md). |
| **Montgomery, TX** | **`tx_sc` — kept, but EPSG/NGS says Texas CENTRAL (2277)** | ⚠ **OWNER DECISION.** The app has always put Montgomery on South Central; `test/statePlane.test.js` pins it and the brief said South Central stays bit-for-bit. Flip = one line in `COUNTY_ZONE` + that test. Effect is a small scale/convergence difference at screening grade. Filed as B2478961. |
| Carson City, NV | `nv_west` | Not in EPSG's Nevada lists (formerly Ormsby); surrounded by Douglas, Lyon, Storey, Washoe — all West. |
| Grant County, WA | `wa_north` / `wa_south` by latitude 47°30′N | EPSG splits it "north / south of approximately 47°30′N"; a point is required, else null. |
| Kauai County, HI | `hi_4`, Niihau → `hi_5` by position | Kauai County holds two zones. |
| 23 Virginia independent cities | zone of the surrounding county | EPSG's list does not name them (generator picks the county outline containing, else nearest to, the city). |
| Utah | **ftUS** (EPSG 3560/3566/3567), not the international-foot codes (2280–2282) | Utah Code §57-10-3 gives 1983 values in metres and survey feet for 1927; 2026 HB 512 adopts SPCS 2022 (international foot). Unit affects only the native grid numbers, never lat/lon. |
| Hawaii | metres for all five | NGS/EPSG define Hawaii in metres (EPSG 3759 ftUS for zone 3 is an alternate). |
| Old / mistyped county names | aliases: `dade`→`miamidade`, `shannon`→`oglalalakota`, `mountrial`→`mountrail` (EPSG typo) | Renames / typo in the EPSG text. |

Independent Virginia cities (zone = the county that surrounds them):

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
* **Open follow-ups**: B2478961 (Montgomery County decision), B2478962 (convergence ellipsoid factor), B2478963 (thread state/county into overlay placements so the coarse fallback is rarely used).

## 9 · Regenerating

```bash
python3 -m venv /tmp/pv && /tmp/pv/bin/pip install pyproj
/tmp/pv/bin/python scripts/gen-state-plane-zones.py      # rewrites statePlaneData.js + test/fixtures/statePlaneGolden.json
npx vitest run test/statePlaneAllZones.test.js test/statePlane.test.js
```
