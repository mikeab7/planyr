# Tennessee — industrial due-diligence layers (B2521584, 2026-10-29)

What a Tennessee site's **Layers** panel offers beyond the national set (FEMA, NHD streams, electric, hydrants, wetlands, EPA cleanups, EIA
pipelines, rail, airports, truck routes, traffic) — and, just as important, what it deliberately does not. Owner brief: "think of the stuff
that's really obvious that developers check for … like Georgia, you did a great job calling out stream buffers." Jurisdiction (city / county /
road authority) is a separate subject: [`TENNESSEE-JURISDICTION.md`](TENNESSEE-JURISDICTION.md).

**Rules every row obeys.** One registry (`lib/layers.js`, rows in `lib/tennesseeLayers.js`), every row `states: ["TN"]`; the source is the agency
that owns the fact, in the shared GIS registry (`src/shared/gis/sources.js`) with its probe date and coverage fixtures; MAP LAYERS ONLY —
Site Analysis verdicts stay trusted-only (`siteChecks.TRUSTED_CHECKS`), so nothing here adds a verdict card; the click card is clean
(owner constraint #45, wording in `lib/tennesseeCards.js`); any regulatory number is cited on the row's ⓘ and below.

## Built

| Row (group) | Source | What it answers |
|---|---|---|
| County Boundaries / City Limits (Jurisdictions, merged "Counties & Cities") | State of Tennessee (STS), 95 counties / 345 cities (the county row is main's `tn_county`, B2507065) | Whose jurisdiction; Tennessee has no ETJ |
| Stormwater (MS4) Permit Areas (Jurisdictions) | TDEC DWR, 88 areas | Whose stormwater / post-construction / buffer rules apply on top of the state permit |
| Stream Buffers (Flood & Drainage) | computed from USGS NHD | The 30 ft construction buffer — below |
| Impaired & Assessed Waters (Flood & Drainage) | TDEC DWR 2026 Water Quality Assessment | Impaired / threatened / fully supporting / not assessed, per reach |
| Water Service Areas (Utilities, merged "Water & Sewer") | TDEC DWR, 447 public water systems | Which system's declared territory holds the point (+ Drinking Water Watch link) |
| Remediation Sites (Environmental) | TDEC Division of Remediation DOR Sites (TDEC's ArcGIS Online org), 825 open sites; last edited 2024-06-25 | Voluntary cleanup, State Superfund, EPA / DoD sites — a Phase I flag, with the program in plain words |
| Permitted Landfills (Environmental) | TDEC Solid Waste (maps.tdec.tn.gov, via the relay), 111 facilities | Gas / leachate / truck-traffic flag for a Phase I |
| Known Drycleaners (Environmental) | TDEC Division of Remediation (DCERP) | Solvent-contamination flag for a Phase I |
| State Natural Areas, State Scenic Rivers (Environmental) | TDEC Division of Natural Areas | Designated land — the Rutherford County cedar glades are here |
| Historic Places, National Register Boundaries, Recorded Historic Sites (Environmental) | NPS points; THC / SHPO boundaries and survey inventory (tnmap.tn.gov, via the relay) | Federal register, district footprints, and the Commission's 186,000-record survey (partial, close zoom only) |
| Cemeteries, Critical Habitat (Environmental) | USGS GNIS, USFWS | Recorded burial grounds; federal critical habitat |

**Reachability, measured 2026-10-29 through planyr.io (build 88b0334):** `maps.tdec.tn.gov` and `tnmap.tn.gov` answer the same-origin relay; TDEC's
other server **`tdeconline.tn.gov` answers it with HTTP 403** (it refuses Cloudflare's addresses) and cannot be read from the build environment, so
the layers that live only there are not wired — see "Not built".

## The stream-buffer rule, and where the numbers come from

`lib/tennesseeStreamBuffers.js` (pure) draws a band each side of every NHD stream (ftype 460, not ephemeral — the Georgia rule) at:

- **30 ft** — the **natural riparian buffer zone** the TDEC **Construction General Permit, TNR100000**, requires between a waterbody and the
  limits of disturbance. The permit lets a project **average** the width, with **no point narrower than half of it (15 ft)**; each side of a
  stream is averaged on its own.

**Not drawn: the 60 ft tier.** The same permit asks a 60 ft average (no point under 30 ft) where the discharge is to **Exceptional Tennessee Waters or
waters with unavailable parameters** (siltation / habitat alteration). TDEC publishes those reaches as the **CGP Unavailable Waters** layer — on
`tdeconline.tn.gov`, which refuses the relay. There is no standalone ETW layer and the assessment layer on ArcGIS Online carries impairment status but not
the cause, so Planyr cannot tell which streams are 60 ft. The row says so on its status line; the 60 ft source is the first thing to add once
`tdeconline` is readable (a real-browser CORS probe from planyr.io would settle whether the browser can read it directly).

Sources of the numbers: the 2021 permit text and the TDEC Erosion Prevention & Sediment Control Handbook ch. 3.3.3.2 (riparian buffer zones).
⚠ **TDEC's permit page says a final 2026 permit has been issued, effective 2026-10-01 (expires 2031-09-30).** A consultant summary says the 30 ft / 15 ft rule is unchanged; the
2026 text itself was not read — the permit PDF sits on `tn.gov`, which the build environment cannot reach. The ⓘ says so.
Measured from the **centreline** (NHD), not the top of bank. A wet-weather conveyance (TDEC rule 0400-40-17 hydrologic determination) carries
no buffer, and NHD cannot tell one from a stream.

**Local rules are NOT drawn.** Cities add their own, and the width depends on drainage area and stream class the map does not carry:
Murfreesboro's Water Quality Protection Area policy asks 35, 50 or 60 ft by stream size and health (city page, 2024 update); Metro
Nashville's Stormwater Management Manual Vol. 1 §6.10 sets its own; Franklin, Brentwood and Williamson County have theirs. The MS4 row says
whose rules apply; the permittee's manual says what they are.

## Not built, and why

| Candidate | Why not |
|---|---|
| **Sinkholes / karst** (Rutherford is heavily karst) | No authoritative LIVE service. USGS publishes the Tennessee depressions + sinking-streams dataset (Ladd 2025, DOI 10.5066/F74F1PZJ) and the national karst map (OFR 2014-1156) as **downloads only**; the only live copies are personal ArcGIS Online accounts (the "TN_Sinkholes" layer is built from a hobbyist database, tnlandforms.us). Metro Nashville, Rutherford County and TDEC's Division of Geology publish none that was found. TDEC's ArcGIS Online org holds only a partial karst dye-trace / flow-indicator set (`Karst_Flow_Indicators`, 111 points; `KarstHydrologicInvenotry`) — not a sinkhole inventory, so not drawn. The USGS hosts are not reachable from the build environment, so the download cannot be ingested as a static asset yet. **Top follow-up.** |
| **Underground storage tanks, oil & gas wells, dams** | Live only on `tdeconline.tn.gov` (UST_Facilities, Oil_and_Gas2, DWR_Public), which refuses the relay (403) and the build environment. The AGOL copies found are personal / university accounts or single-county. (Remediation sites ARE built: TDEC publishes the same register on its own ArcGIS Online org.) Needs a real-browser CORS probe from planyr.io, or TDEC allowing the relay. |
| **Restricted waters (CGP Unavailable Waters), Exceptional Tennessee Waters, Hydrologic Determinations** (wet-weather conveyances) | Same server. Costs the 60 ft buffer tier (above). |
| Wellhead / source-water protection areas | TDEC's Wellhead Protection Area service sits in the `internal` folder of gis.tdec.tn.gov — not public. |
| TVA transmission | Already covered nationally by the Power lines (HIFLD) row; TVA publishes no separate public service. |
| Tribal lands | There are no federally recognized reservations in Tennessee. |
| Irrigation / drainage-district rights-of-way | No public statewide source. |
| State rare-species occurrences (TDEC Natural Heritage) | Released only under a data-use agreement — not public. |
| Historical markers (THC, 1,807 points) | On the same server but a roadside-marker list, not a development constraint. |
| Airport zoning / noise | No statewide Tennessee overlay; the FAA airports row (national) stands. |
| Rail, pipelines, wetlands, truck routes | National rows already offered (BTS, EIA, NWI). |
| Aquifers (TDEC principal aquifers) | Informational, not a development constraint. |
| Local stream buffers (Murfreesboro, Nashville, Franklin) | Width depends on drainage area / stream class — see above. |

## Draw-budget notes (adversarial review, 2026-10-29)

The USFWS critical-habitat service returns each mussel reach whole (up to 314,000 vertices a feature; one Duck River cell is 522,000), the National Register
boundaries include a 363,000-vertex "Old Natchez Trace", and Nashville's MS4 areas total 309,000 vertices at the zoom they first draw. The app declines to draw a batch over
its vertex budget (`layers.buildFeatureLayer`), and zooming in does not shrink a whole-feature answer — so those three rows ask the server to simplify
(`simplifyFactor: 6`, ~6 screen pixels, re-asked every two zoom levels): measured 15,900–106,000 vertices per cell across z9–z17 (critical habitat), 1,500–3,200
(National Register), 700–3,100 (MS4). The 186,000-record historic-sites layer requests only the eight fields its card reads.

Also fixed after the second review: the historic-sites layer now requests the object id (without it the service sends no feature id and esri-leaflet draws every point
under one key — **one point**), Water Service Areas and the stream assessment simplify too (a 112,589-vertex system; 270–370k vertices at first zoom), and the shared
budget (`layers.buildFeatureLayer`) now counts a feature once however many tiles return it and no longer lets the `load` that follows a refusal turn "too detailed to
draw" into "empty / no features here" (`test/layerDrawBudget.test.js`).
