# Colorado readiness audit — what is Texas-hardcoded, what is registry-driven

**Date:** 2026-07-29 · **Item:** B1098 (NEW-2) · **Scope:** Adams, Denver, Arapahoe, Larimer, Weld,
Jefferson, El Paso, Boulder, Broomfield.

This is a sizing document. It inventories, with file and line references, every place Planyr assumes
Texas — what a Colorado site hits, what has been fixed in this pass, and what a teammate would have
to build next. It is written to be read cold.

Line numbers are as of commit `437088a`. Where this pass already changed something, both the
before and after are given, because the *before* is what tells you how much of the codebase carries
the same shape.

---

## 0. Executive summary

**The good news, and it is the headline.** Planyr is far more registry-driven than a first read
suggests. Endpoints, detention rules, floodplain rules, FFE rules, easement widths, grading rules
and pond criteria are all **versioned data records in registries**, not code constants — the
codebase's own standing rule is "adding a source is adding a registry ROW, never new code," and it
largely holds. Nine Colorado counties, a second state-plane zone family, a second statewide parcel
fallback and a whole new statutory rule all landed this session **without a single Texas output
moving** (proven by the `test/goldenMasterTexas.test.js` characterisation harness, §1).

**The bad news is concentrated in one place.** Detention is not registry-shaped across states. Every
Texas rule is a **rate method** — some `ac-ft` per acre, times an area. Colorado is a **different
formula shape**, not a different constant (§6). That is the one genuinely large piece of work, and
it is deliberately not attempted here.

**Three brief premises turned out to be wrong or incomplete.** Recorded plainly, because the brief
asked for exactly that:

| Premise in the brief | What the code / the world actually says |
|---|---|
| "Colorado has no equivalent middle or bottom tier" to Texas's H-GAC → TxGIO chain | **Half wrong, and the important half.** There IS a statewide bottom tier: the Colorado OIT **Colorado Public Parcels** composite, county-scopable, the exact TxGIO analogue. No clean *middle* tier exists (regional bodies are partial: DRCOG metro-only, PPACG El Paso-only), so none is modelled. See §3. |
| The source-priority fallback chain is "authoritative city → H-GAC regional → TxGIO statewide" | **Not the actual shape.** There is no city tier and no regional tier in the parcel path. It is two tiers: the county's own CAD, then the statewide layer, chosen by a bbox pre-filter with the statewide source appended last. See §3. |
| The map viewer's "extent/bounds clamp and tile coverage" is the suspect for the zoom problem | **None of those.** No `maxBounds` is ever set, both tile sources serve from z0, and there is one Web Mercator worldwide. It was a single hard `minZoom: 8`. See §8. |

One more thing the brief did not ask about but that a teammate must know: **the app measures in two
different feet frames**, and only one of them is ground-true (§4).

---

## 1. The regression harness (B1097 / NEW-1) — read this before changing anything

**Files:** `test/support/texasGoldenMaster.js` · `test/fixtures/texasGoldenMaster.json` ·
`test/goldenMasterTexas.test.js` · `scripts/build-texas-golden-master.mjs`

Before any Colorado work landed, the current Texas outputs were captured across a representative
matrix and frozen. The suite recomputes them and asserts byte-identity, printing the first differing
**paths** rather than a 68 KB diff.

**What it covers:** the EPSG:2278 projection and its round trip at six Texas points; the planner's
own feet frame (`mapLock`) at each; county click-routing and the statewide-backup resolver;
jurisdiction → drainage-authority resolution across eleven signal shapes (straddles, ETJ, unmodeled
city, frontage sliver); the **full detention matrix** — nine authorities × six site sizes, plus the
Harris outfall-type and PCPM variants and the published rate curves; drawdown; the floodplain-
mitigation rule records; the FFE rules, required-FFE evaluation and flood-administrator resolution;
road/paving quantities and the cost rollup; pond storage geometry.

**What it cannot cover, stated plainly:**
- Anything needing a live GIS answer — `identifyJurisdiction`, `resolveDrainageAuthority`'s fetch
  half, the WSE samplers. The harness freezes the **pure decision** those feed (e.g.
  `authorityForJurisdiction`), because a network fixture would freeze a county server's data rather
  than our behaviour.
- React rendering and the export sheet. Those have their own suites; this harness pins the numbers
  those surfaces read.
- Persisted-model migration. No field was renamed or restructured in this pass, so nothing needed a
  read-migration — but the harness would not have caught it if one had.

**It caught two real regressions during this session**, both in the additive county-registry change:
Colorado's statewide composite leaking into Texas click candidates, and a Texas out-of-bbox click
losing its `harris`-first ordering. Both were fixed, not accepted.

> **If it fails, do not regenerate the fixture.** A diff means a Texas number moved.

---

## 2. The GIS source registry and its field mapping

**File:** `src/shared/gis/sources.js` (1,300 lines, 43 rows)

Each row is `{ key, label, provider, serviceUrl, layerId, geometryType, fields, coverage, tier,
lastVerified, fixtures }`. `fields` is the per-source name mapping that lets one connector read
every source (`county.fields = { name: "CNTY_NM", fips: "FIPS_ST_CNTY_CD" }`, `sources.js:448`).

**Machine-enforced discipline** (`ui-audit/gis-source-audit.mjs`, wired to CI via
`test/gisSources.test.js`):
1. **Tier integrity** — every row must be `production` or an acknowledged `monitored-exception` with
   a reason. Only two exceptions exist (`wetlands`, `growthFaults`).
2. **No inline URLs** in the analysis path — `siteAnalysis.js`, `jurisdiction.js`,
   `detentionRules.js` must read every endpoint from the registry.
3. **NEW this pass — county parcel provenance.** `counties.js` is deliberately *exempt* from rule 2
   (its endpoints *are* per-county parcel services), and that exemption is precisely what would let
   a guessed URL ship. Adding nine counties at once is when it would have bitten. Every county row
   must now declare its `state`, and must either carry a `verifiedOn` date (the endpoint was queried
   and answered), sit on its state's statewide composite, or carry a `verifiedNote` saying why it
   could not be probed. An unverified county-own endpoint is parked in `candidateUrl` **with
   provenance** — recorded, never shipped.

**Texas-specific rows** (the inventory a Colorado build has to answer): `county` (TxDOT), `city`
(TxGIO), `road` (TxDOT Roadway Inventory), `isd` (TEA), `etj_hgac` / `etj_austin` / `etj_fortworth`,
`mud` (TCEQ districts), `bkdd`, `hcfcdChannels`, `hcfcdWatersheds`, `oilgas` (TxRRC), `lpst` (TCEQ).
**National rows that travel unchanged:** `flood` (FEMA NFHL), `wetlands` (USFWS NWI), `pipelines`
(PHMSA), terrain/3DEP, NOAA Atlas-14, SSURGO soils, NHDPlus HR, `epaCleanups`.

**Added this pass:** `countyCo` — Colorado statewide county boundaries, live-verified 2026-07-29
(64 polygons, `NAME20`/`GEOID20`). `GEOID20` is the same 5-digit state+county FIPS as TxDOT's
`FIPS_ST_CNTY_CD`, so the field means the same thing on both sources.

---

## 3. The county registry and the ACTUAL fallback chain

**File:** `src/workspaces/site-planner/lib/counties.js`

### What the chain really is

There is no city tier and no regional tier in the parcel path. `candidateCountiesForPoint`
(`counties.js:~430`) does this:

1. **bbox pre-filter** — every county whose padded extent contains the point. Overlap at borders is
   deliberate, so a straddle click queries both. The bbox is *never authoritative*: the parcel
   service that returns a lot is the source of truth, and `countyAtPoint` corrects the label
   afterwards (B36a).
2. **statewide append** — the statewide source is appended **last**, so a county's own CAD (richer
   schema, more authoritative) answers first.
3. **out-of-every-bbox** — previously returned *every* configured county, `harris` first.

Step 3 was the dangerous one for Colorado. The Layers-panel jurisdiction resolver reads
`candidate[0]`, so a Colorado click would have been handed **`harris`** — a Colorado site inheriting
Harris County is exactly the wrong-but-plausible answer this work exists to prevent. The fallback is
now scoped to the point's **state** (`STATE_BOUNDS` in `counties.js`); a Texas point gets a
byte-identical list, and a point in neither state keeps the old all-counties behaviour.

### When a county server is down

Texas: `statewideFallbackFor(county)` returns the TxGIO layer scoped with `county='HARRIS'`, so an
account or street search cannot leak into a like-named parcel elsewhere (B244). A county whose
*primary* already is the statewide layer (Waller) returns `null` — no self-referential backup.

**Colorado now has the same tier.** `statewideFallbackFor` resolves the **Colorado Public Parcels**
composite scoped with `countyName='Adams'`. So a Colorado county outage degrades to the same honest
statewide backup a Texas one does, rather than to nothing. `STATEWIDE_LAYER_BY_STATE` exports both so
a surface can *name* the tier it fell through to instead of showing an unattributed outline.

### The nine counties, and what was actually verified

Endpoints were probed live from the build environment. Its egress policy blocks self-hosted county
hosts (403 on CONNECT — a sandbox limitation, not evidence the endpoint moved), so ArcGIS-Online-
hosted services could be verified and self-hosted ones could not. That split is recorded per row,
not smoothed over.

| County | Zone | Primary shipped | Verified |
|---|---|---|---|
| Adams | North 2231 | county's own AGOL service | ✅ **188,723** parcels, 2026-07-29 |
| Denver | Central 2232 | county's own AGOL service (layer id **245**, not 0) | ✅ **240,360** parcels; native SR **2877** = Colorado Central ftUS |
| Weld | North 2231 | county open-data FeatureServer | ✅ **163,685** parcels |
| Broomfield | North 2231 | county's own AGOL service | ✅ **27,531** parcels; native SR **2876** = Colorado North ftUS |
| Arapahoe | Central 2232 | statewide composite | ⏳ own endpoint recorded (AGOL item, owner `gis@mhfd`); host blocked |
| Larimer | North 2231 | statewide composite | ⏳ own endpoint recorded (AGOL item `Larimer County Tax Parcels`); host blocked |
| Boulder | North 2231 | statewide composite | ⏳ own endpoint recorded (AGOL item, owner `gis@mhfd`); host blocked |
| El Paso | Central 2232 | statewide composite | ⏳ own endpoint recorded (AGOL item, owner `BaileyG`); host blocked |
| Jefferson | Central 2232 | statewide composite | ❗ **no county parcel endpoint could be found at all** — the public Jeffco services are open-space land boundaries and one-off project layers, not the parcel fabric. Rides the composite outright, exactly as Waller does in Texas. |

**Live-verified regional alternative, deliberately not shipped:** PPACG Parcels (2025) for El Paso
(native SR 2232, reachable) is the MPO's *derived planning* layer, not the assessor's fabric, so it
is recorded in `candidateProvenance` rather than used as a parcel source.

**Key collision, and how it is handled:** Texas and Colorado **both** have an El Paso County and a
Jefferson County. Texas keys are persisted in saved plans and could not be renamed (Constraint 1), so
Colorado keys are `co_`-prefixed and `countyKeyForName(name)` stays **Texas-only** unless a state is
passed. An unqualified `"El Paso"` returns `null` rather than guessing.

**Verification pending:** `V508` — probe the five blocked endpoints from an unblocked network and
promote each to its own service (a one-line change per row).

---

## 4. The projection frame — and the two feet frames nobody had written down

### Where the projection was chosen

**Before:** one hardcoded zone, `src/shared/coordinates/index.js:16` —
`PROJECT_CRS = { epsg: 2278 }`, with the Texas South Central Lambert parameters as **module
constants** (`index.js:57–62`) and the cone constants precomputed once at import
(`index.js:69–73`). Not per-app *or* per-site: per **module load**. Correct for Houston/Katy, wrong
everywhere else. `FEET_WKID = 2278` in `counties.js:30` is a second hardcoded statement of the same
thing, used to request ArcGIS geometry already in feet.

**Now (B1099 / NEW-3):** `src/shared/coordinates/statePlane.js` carries a **zone registry** (TX South
Central 2278, CO North 2231, CO Central 2232), per-county assignment, and `resolveZone({state,
county, lat, lon})` — county first (Colorado's zone boundaries *are* county lines), coarse extent
second, honest `null` last. `index.js` was **not refactored**; the new generic Lambert engine is
written in the same operation order and reproduces it **bit-for-bit** (`Object.is`, not
`toBeCloseTo` — `test/statePlane.test.js`).

**Broomfield is a documented decision, not a lookup.** C.R.S. 38-52-101 never names it: the statute
predates the county, created 2001 from parts of Adams, Boulder, Jefferson and Weld. Three of those
four parents are North zone; and independently, **Broomfield's own parcel service publishes in
EPSG:2876 — NAD83(HARN) / Colorado North (ftUS)**. Assigned **North**, carrying `decided: true` and
a `decisionNote`, so any surface showing the zone can show *why*.

### The two feet frames (not in the brief; a teammate must know it)

| Frame | Where | Ground-true? |
|---|---|---|
| **Planner frame** — a uniform scaling of spherical Mercator anchored at the site origin | `site-planner/lib/mapLock.js` | **Yes**, by construction at the site. Every drawn dimension is a ground distance. |
| **State-plane grid** | `shared/coordinates` → `proximityScreen.js`, `coverage.js`, `fbcdWse.js`, `deedAlign.js`, `thoroughfare/ingestTransform.js` | **No.** These measure in grid feet and treat them as ground feet. |

So **yes, the app assumes grid equals ground** wherever it measures on the grid. In Texas that has
been correct by accident: Houston at ~50 ft has an elevation factor of 0.999998 — about 0.01 ft per
mile. On the Front Range it is not: **Denver at ~5,280 ft is roughly 0.99975 combined, ~1.3 ft per
mile, about nine inches across a 3,000-ft site.** A "within 1,000 ft" proximity screen in Denver is
really measuring about 1,000.25 ground ft. Small, but it is a *bias*, not noise.

**B1100 / NEW-4 ships the surfacing, not the transform.** `shared/coordinates/scaleFactor.js`
computes the grid factor, the elevation factor (with optional geoid separation — the Front Range
geoid sits ~55–60 ft below the ellipsoid, worth ~3 ppm) and their product, plus what it is worth per
mile and over any run, and `detectSurveyFrame` classifies a survey as `grid` / `ground` /
`other-scale` / `unknown` from corresponding survey↔grid distances. It **deliberately does not apply
the factor** — a half-applied factor turns a known constant into an untraceable error. `other-scale`
is a real answer, not a failure: a project can be scaled about a local origin by a factor the
surveyor chose.

**Sized, not built (B1106):** a true ground/grid transform — a project combined factor and origin
carried on the site model, applied consistently across screening distances, deed import, CAD import
and export. That is a persisted-schema change and touches every measuring path; it needs its own
session and its own golden master.

---

## 5. Jurisdiction and drainage-authority resolution

**Files:** `site-planner/lib/jurisdiction.js` (620 lines) · `site-planner/lib/detentionRules.js`
(2,000+ lines)

### `identifyJurisdiction` (`jurisdiction.js:437`)

Registry-driven, `roles = ["county", "city", "etj", "isd"]`, each resolving to one source or a
**region-routed list**. ETJ was already region-routed (`etjSourcesForPoint`, `jurisdiction.js:134`) —
an established, low-risk seam. **This pass routed `county` the same way** (`countySourcesForPoint`):
a Colorado point resolves against Colorado's boundary layer; every Texas point and every point
outside Colorado gets the *identical* `JURISDICTION_SOURCES.county` object (asserted by identity, not
equality, in `test/coloradoRegistry.test.js`).

Why it mattered: an empty county list is the dangerous outcome, because it is what lets a site fall
through to a default further down the chain.

**Still Texas-only in this module:** `city` (TxGIO), `isd` (TEA), `road` + `ROAD_MAINT_AGENCY`
(TxDOT `RDWAY_MAINT_AGCY` codes, calibrated 2026-06-15), all three ETJ sources. A Colorado site gets
honest "no source for this area" states for these — the pre-existing `unavailable` path, not a wrong
answer. **Colorado has no ETJ doctrine equivalent to Texas's**, so that gap is partly conceptual, not
just missing data.

### `authorityForJurisdiction` (`detentionRules.js:~1486`) — pure, and the real decision

Maps county/city/ETJ facts to a reviewing authority via `COUNTY_AUTHORITY` (five Texas counties) and
`CITY_OVERLAYS`. Straddles surface in `ambiguous` and are never silently defaulted; an unmodeled city
keeps the county authority with a flag; a Houston ETJ hit is an informational overlay and never sets
the primary. Colorado counties are simply absent from `COUNTY_AUTHORITY`, so `primary` is `null` and
the `no-criteria-modeled` flag fires — safe, but *generic*, which is why B1104 adds an explicit
Colorado state (§6).

**Colorado's four regimes are now named** (`site-planner/lib/coloradoRegions.js`):

| Regime | Counties (of the nine) | Criteria |
|---|---|---|
| **MHFD** (Mile High Flood District, formerly UDFCD) | Adams, Arapahoe, Boulder, Broomfield, Denver, Jefferson — **6 of 9** | USDCM Vols 1–3 |
| **Larimer** | Larimer | Larimer County standards; Fort Collins and Loveland each their own |
| **Weld** | Weld | Weld County; Greeley its own |
| **El Paso** | El Paso | El Paso County / Colorado Springs DCM Vols 1–2 |

MHFD is a *regional district*, but the **city or county is still the permitting authority** — MHFD's
manual is what they adopt and review against. Larimer, Weld and El Paso are **not** MHFD members and
each record says so in its `note`.

---

## 6. Detention — the one genuinely large gap

**File:** `site-planner/lib/detentionRules.js`

### Can `ruleType` carry a volume-curve rule without surgery?

The brief asked this directly. **Answer: no — and the reason is not the type tag.**

`ruleType` already spans five shapes: `rate` (Harris), `tiered` (Houston), `table-band` (Fort Bend
Table 6-1), `policy-band` (Montgomery), `rate-match` (BKDD), `overlay` (Missouri City, Magnolia).
Adding a sixth string is trivial. The problem is that **every branch inside
`computeRequiredDetention` produces `volume = rate × area`**, and each is dispatched inside one
function (`detentionRules.js:~540–700`). The carrier itself is fine — `{kind, requiredAcFt, bandAcFt,
rateAcFtPerAc, basis, rule, flags, caveat}` — and `kind: "band"` and `kind: "unknown"` already prove
it can express a non-point answer.

**What Colorado needs instead:**
- **MHFD Full Spectrum Detention** = **WQCV** (Water Quality Capture Volume — a function of
  imperviousness *and* the selected 12/24/40-hour drain time) **+ EURV** (Excess Urban Runoff
  Volume). Two volumes, each from its own curve, combined. There is no `ac-ft/ac` number to seed.
- **Larimer, Weld, El Paso** each need separate transcription again — four regimes, four bodies of
  work, not one.

So: **a new `ruleType` with its own calculator module**, invoked through the existing dispatch, plus
a `params` shape that carries curves rather than rates. The carrier and the versioned-record
discipline survive; the arithmetic does not. Estimate: MHFD alone is a session's work to transcribe
and test; the other three are a session each.

**Filed as B1105, explicitly out of build scope this session** at the owner's direction.

### What WAS built: the guard (B1104 / NEW-8)

`computeRequiredDetention` takes `siteState` and returns an explicit `kind: "unavailable"` carrier
for Colorado. Three deliberate placement decisions:

1. **First statement in the function** — above the `acres > 0` check, because "no site area" is a
   Texas-shaped answer too.
2. **Above the authority lookup** — so that even if a user overrides the reviewing agency to a Texas
   authority on a Colorado site, no Texas rate can leak through. Tested against *every* rule in
   `DETENTION_RULES`.
3. **Fires on a positive Colorado answer only** — `siteState: null` (every legacy plan without
   coordinates) behaves exactly as before.

The site's state is resolved **geometrically and without a network call**
(`coloradoRegions.siteState`), because the guard has to hold when every GIS endpoint is down —
which is exactly when a site is most likely to fall through to a default.

The panel renders a named verdict, **`not in Colorado yet` / chip `N/A · CO`** — deliberately not
"unknown" or "unresolved", which would read as *we could not look it up* and invite the reader to
wait for a number that is never coming. In Colorado `detReq` is computed **regardless of whether an
authority resolved**, because the normal precondition would otherwise leave the group rendering
nothing at all — a blank that reads as zero.

---

## 7. Floodplain: `floodAdministrator.js` and `floodplainRules.js`

**Files:** `site-planner/lib/floodAdministrator.js` (164 lines) · `floodplainRules.js` (252 lines)

**FEMA travels.** The `flood` source is the national NFHL; zone classification (`classifyFlood`,
`isSFHA`) is zone-letter logic with nothing state-specific. Colorado sites get real flood zones today.

**Everything around it is Texas.**
- `floodAdministrator.js:60` — `RULE_KEY_ALIAS` maps place names to rule keys and is entirely Texas
  (`houston→coh`, `fortbend`, `harris`, `hcfcd`, `montgomery`, `chambers`, `waller`, `missouricity`,
  `magnolia`). A Colorado city resolves to no rule, so it is flagged `ruleModeled: false` — correctly
  *never allowed to govern*, but also never able to answer.
- `floodplainRules.js:40` — `DEFAULT_FLOODPLAIN_RULES` has six Texas jurisdictions. Harris and Fort
  Bend are `verified: true` with confirmed subsection lettering; the rest are placeholders. No
  Colorado record exists, so compensating storage is **unwired in Colorado** and reported as such by
  the capability matrix.
- The module docstring reasons entirely in Texas terms (Fort Bend FDPR §5.02 vs Houston Ch. 19).
- `floodplainRules.js:38` — the localStorage key is `planarfit:floodplainRules:v1`, part of the
  known un-migrated `planarfit:*` prefix debt. Untouched (Constraint 1: no renaming a persisted field
  without a proven read-migration).

### CWCB — verified, and it cuts the *other* way

The brief asked whether Colorado's state floodplain authority has rules stricter than FEMA. **It
does, statewide, in three specific ways** (CWCB, **2 CCR 408-1**, recorded in
`coloradoRegions.CO_STATE_FLOOD_STANDARD`):

| Standard | Colorado | FEMA / NFIP baseline |
|---|---|---|
| Freeboard, new / substantially improved | **1 ft** above the 100-yr elevation | at or above BFE — no freeboard |
| **Critical facilities** | **2 ft** above the 100-yr (4 categories: essential services, hazardous materials, at-risk populations, restoration-vital) | no separate standard |
| Floodway designation rise | **0.5 ft** (six inches) for newly studied / revised reaches | 1.0 ft surcharge |

This is genuinely useful: unlike Texas, where freeboard is purely a local-ordinance matter, a
Colorado site has a **known minimum before any local ordinance is read**. It is a **floor** — local
communities commonly adopt more, and a hazardous-materials building can be a Critical Facility even
on an industrial site.

*Provenance:* the CWCB's own adopted-rules PDF returned HTTP 403 to this environment, so the values
are triangulated from the rule text as published through the Colorado Secretary of State CCR and
Cornell LII. Marked `verified: true, secondarySource: true` per this repo's existing convention —
confirm subsection lettering against the primary PDF.

### The drawdown statute (B1103 / NEW-7) — cheap, because the engine existed

`site-planner/lib/drawdownStatute.js` turns **C.R.S. 37-92-602(8)** into a rule record: ≥97% of a
5-year storm released within 72 hr, ≥99% of larger events within 120 hr, plus the post-5-Aug-2015
State Engineer notification (location, surface area at design volume, drain-rate data). Compliance
carries a rebuttable presumption of no material injury; non-compliance is an out-of-priority
diversion in a prior-appropriation state.

Two design points worth carrying forward:
- **It never reports "pass."** `drawdownTime`'s figure is a constant-rate *lower* bound — real
  outflow decays as head drops, so the true drawdown is always longer. A screening result inside the
  limit therefore means non-compliance is **not ruled out**, not that the facility complies. A
  failure, by the same logic, is real. Verdicts are `fail` / `not-ruled-out` / `unknown`.
- **It fails the facility, not the average.** The statute applies per facility, so one slow pond
  fails the site even when the site-wide figure is inside the limit.

**Texas presentation is unchanged** — `assessStatutoryDrawdown` returns `applies: false` for any
state but CO, and the existing informational readout renders exactly as before.

---

## 8. Map viewer: extent, bounds and tile coverage (B1102 / NEW-6)

**Reported:** cannot zoom out far enough. **Cause, and it is a single line:**
`MapFinder.jsx:417` — `L.map(el, { zoomControl: false, minZoom: 8, maxZoom: 21 })`.

The three candidates in the brief were all ruled out by inspection:
- **Not a bounds clamp** — `setMaxBounds` / `maxBounds` appear nowhere in the codebase.
- **Not tile coverage** — Esri World Imagery and USGS ImageryOnly both serve from z0. Their
  `maxNative` ceilings (19 and 16) constrain the *deep* end, not the shallow end.
- **Not a projection chosen at init** — the map is one Web Mercator worldwide; the per-site frame
  (`mapLock`) is the planner canvas's, not the finder's.

At z8 the view spans a few counties, so there was no way to pull back and see another state at all —
you could only jump by picking a site. Now `minZoom: 3`, which puts the continent on screen.
Guarded by `test/coloradoRegistry.test.js`, which also asserts no `maxBounds` reappears.

The initial landing view is still `COUNTIES_MAP.harris` (`MapFinder.jsx:412`) — deliberately
unchanged; changing where the app opens is a product decision, not a bug fix.

---

## 9. Everything else the sweep turned up (Texas-keyed, not yet addressed)

Each is enumerated in the `CAPABILITIES` matrix in `coloradoRegions.js`, so each renders a named
"not available in Colorado yet" state rather than a number or a blank.

| Area | File | Status in Colorado |
|---|---|---|
| Detention volume | `detentionRules.js` | **not wired** — guarded (§6) |
| Compensating storage | `floodplainRules.js`, `floodplainMitigation.js` | **not wired** — guarded |
| Required FFE | `buildability.js` | **partial** — CWCB statewide floor only; no local ordinance |
| Drainage authority | `coloradoRegions.js` | **partial** — regime named, criteria not carried |
| Tax units / rates | `counties.js:126` `TAX_RATE_SOURCES` | **not wired** — mines Texas CAD attributes |
| Utility easement widths | `easementRules.js` | **not wired** — Texas jurisdictions only |
| Thoroughfare plan / ROW | `shared/thoroughfare/houston.js` | **not wired** — one Houston config |
| Subsidence districts | `subsidence.js` | **not applicable** — Harris-Galveston / Fort Bend are Texas entities with no Colorado counterpart |
| Regional detention / fee-in-lieu | `regionalDetention.js` | Texas registry only |
| Grading / pond criteria | `gradingRules.js`, `pondCriteriaRules.js` | Texas-seeded; user-editable, so usable but unverified |
| Atlas-14 rainfall, SSURGO soils, 3DEP terrain, NHDPlus | `pfdsClient.js`, `soils.js`, `elevation.js`, `receivingWater.js` | **national — these travel unchanged.** The screening-BFE study (`screeningBfeSite.js`) should work in Colorado on national inputs; **untested there.** |
| FBCDD / HCFCD WSE samplers | `fbcdWse.js`, `hcfcdWse.js` | Texas-only by construction; `wseProviders.js` precedence degrades honestly |
| Snapshot cache | `counties.js` `SNAPSHOT_COUNTIES` | Texas counties only; Colorado has no Drive snapshot backing |

**Distinguishing not-applicable from not-built matters.** Saying "not built yet" about subsidence
districts would imply work that will never happen; the matrix carries a `notApplicable` flag for
exactly that reason.

---

## 10. Suggested order of work for a teammate

1. **`V508` — probe the five blocked county endpoints** from an unblocked network; promote each
   (one line per row). Cheapest possible win, and it removes the composite dependency for four
   counties.
2. **MHFD detention (B1105, part 1)** — the new `ruleType` + WQCV/EURV calculator. Covers **6 of the
   9 counties** in one body of work. Biggest single unlock.
3. **Colorado floodplain records** — local ordinances for the metro jurisdictions, layered over the
   CWCB floor that already ships.
4. **Larimer / Weld / El Paso detention (B1105, parts 2–4)** — a session each.
5. **Ground/grid transform (B1106)** — only worth doing once Colorado sites are real, and it needs
   its own golden master because it touches every measuring path.

Throughout: **the golden master stays green.** If a Texas number moves, stop.
