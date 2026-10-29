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
| County Boundaries / City Limits (Jurisdictions, merged "Counties & Cities") | State of Tennessee (STS), 95 counties / 345 cities | Whose jurisdiction; Tennessee has no ETJ |
| Stormwater (MS4) Permit Areas (Jurisdictions) | TDEC DWR, 88 areas | Whose stormwater / post-construction / buffer rules apply on top of the state permit |
| Stream Buffers (Flood & Drainage) | computed: USGS NHD + TDEC CGP restricted waters | 30 ft / 60 ft construction buffers — below |
| Restricted Waters (Flood & Drainage) | TDEC DWR CGP "Unavailable Waters" | The streams the permit treats as restricted (Exceptional Tennessee Waters, unavailable siltation / habitat parameters) |
| Impaired & Assessed Streams (Flood & Drainage) | TDEC DWR 2026 Water Quality Assessment | Impaired / threatened / fully supporting / not assessed, per reach |
| Water Service Areas (Utilities, merged "Water & Sewer") | TDEC DWR, 447 public water systems | Which system's declared territory holds the point (+ Drinking Water Watch link) |
| Known Drycleaners (Environmental) | TDEC Division of Remediation (DCERP) | Solvent-contamination flag for a Phase I |
| State Natural Areas, State Scenic Rivers (Environmental) | TDEC Division of Natural Areas | Designated land — the Rutherford County cedar glades are here |
| Historic Places, Cemeteries, Critical Habitat (Environmental) | NPS NRHP, USGS GNIS, USFWS | The federal registers, read at Tennessee sites |

(The `tdeconline.tn.gov` rows — remediation sites, underground storage tanks, landfills, oil & gas wells, hydrologic determinations, dams —
are listed in "Measured through the relay" below once measured.)

## The stream-buffer rule, and where the numbers come from

`lib/tennesseeStreamBuffers.js` (pure) draws a band each side of every NHD stream (ftype 460, not ephemeral — the Georgia rule), at:

- **30 ft** — the **natural riparian buffer zone** the TDEC **Construction General Permit, TNR100000**, requires between a waterbody and the
  limits of disturbance. The permit lets a project **average** the width, with **no point narrower than half of it (15 ft)**; each side of a
  stream is averaged on its own.
- **60 ft** — the same buffer where the discharge is to **Exceptional Tennessee Waters or waters with unavailable parameters** (siltation /
  habitat alteration): a 60 ft average, no point under 30 ft. TDEC publishes those reaches as **CGP Unavailable Waters**; the layer takes TDEC's
  lines for the 60 ft band and never decides "exceptional" or "impaired" itself. Where both sources hold the same stream, the wider governs and it
  is drawn once.

Sources of the numbers: the 2021 permit text and the TDEC Erosion Prevention & Sediment Control Handbook ch. 3.3.3.2 (riparian buffer zones).
⚠ **TDEC reissued the permit effective 2026-10-01 (expires 2031-09-30).** A consultant summary says the 30 ft / 15 ft rule is unchanged; the
60 ft tier of the 2026 text was not confirmed — the permit PDF sits on `tn.gov`, which the build environment cannot reach. The ⓘ says so.
Measured from the **centreline** (NHD), not the top of bank. A wet-weather conveyance (TDEC rule 0400-40-17 hydrologic determination) carries
no buffer, and NHD cannot tell one from a stream — see the Hydrologic Determinations row.

**Local rules are NOT drawn.** Cities add their own, and the width depends on drainage area and stream class the map does not carry:
Murfreesboro's Water Quality Protection Area policy asks 35, 50 or 60 ft by stream size and health (city page, 2024 update); Metro
Nashville's Stormwater Management Manual Vol. 1 §6.10 sets its own; Franklin, Brentwood and Williamson County have theirs. The MS4 row says
whose rules apply; the permittee's manual says what they are.

## Not built, and why

| Candidate | Why not |
|---|---|
| **Sinkholes / karst** (Rutherford is heavily karst) | No authoritative LIVE service. USGS publishes the Tennessee depressions + sinking-streams dataset (Ladd 2025, DOI 10.5066/F74F1PZJ) and the national karst map (OFR 2014-1156) as **downloads only**; the only live copies are personal ArcGIS Online accounts (the "TN_Sinkholes" layer is built from a hobbyist database, tnlandforms.us). Metro Nashville, Rutherford County and TDEC's Division of Geology publish none that was found. The USGS hosts are not reachable from the build environment, so the download cannot be ingested as a static asset yet. **Top follow-up.** |
| Exceptional Tennessee Waters as its own layer | TDEC publishes no standalone ETW layer; ETW reaches are inside CGP Unavailable Waters (built). |
| Wellhead / source-water protection areas | TDEC's Wellhead Protection Area service sits in the `internal` folder of gis.tdec.tn.gov — not public. |
| TVA transmission | Already covered nationally by the Power lines (HIFLD) row; TVA publishes no separate public service. |
| Tribal lands | There are no federally recognized reservations in Tennessee. |
| Irrigation / drainage-district rights-of-way | No public statewide source (Tennessee drainage districts publish none). |
| State rare-species occurrences (TDEC Natural Heritage) | Released only under a data-use agreement — not public. |
| State historic inventory (Tennessee Historical Commission) | Not public GIS; the NRHP row is the public part. |
| Airport zoning / noise | No statewide Tennessee overlay; the FAA airports row (national) stands. |
| Rail, pipelines, wetlands, truck routes | National rows already offered (BTS, EIA, NWI). |
| Aquifers (TDEC principal aquifers) | Informational, not a development constraint. |
| Local stream buffers (Murfreesboro, Nashville, Franklin) | Width depends on drainage area / stream class — see above. |
