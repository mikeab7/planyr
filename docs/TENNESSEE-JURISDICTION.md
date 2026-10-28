# Tennessee jurisdiction — city, county and road authority (NEW-1, 2026-10-28)

What a Tennessee site shows in the **header chip** and at the **top of Site Analysis** ("Who governs this site"), where the data
comes from, what is deliberately NOT shown, and the gaps. Parcels are a separate subject — see
[`STATEWIDE-PARCELS.md`](STATEWIDE-PARCELS.md) ("Tennessee — all 95 counties swept").

## What it reads (all State of Tennessee, ArcGIS Online, CORS-open from planyr.io, no key, no relay)

| Role | Layer | Rows | Last edited | Registry key |
|---|---|---|---|---|
| County | `TN_Counties_view` — State of Tennessee (STS), org `YuVBSS7Y1of2Qud1` (the org that also publishes the Comptroller's parcels) | 95 (the full roster) | 2026-03-18 | `countyTn` |
| City | `TN_Cities_view` ("Tennessee Cities", same org) | 345 (the full municipal roster) — a `NAME` column and nothing else | 2026-03-18 | `cityTn` |
| Road | TDOT **Road Segment** (`services2.arcgis.com/nf3p7v7Zy4fTOh6M/…/Road_Segment`), updated monthly by TDOT | every public road in the state, with `GOVT_CTRL` (State / County / Municipal Highway Agency …), route name, functional class | 2026-10-26 | `roadTn` |

One resolver, the same one Texas uses: `identifyJurisdiction` → `formatJurisdictionBadge` → the header chip and the Site Analysis
"Who governs" model. Tennessee is a **new state branch of that resolver** (like Georgia / New Jersey), not a parallel path.

## The rules

- **City limits beat anything else; outside every city the county governs** — "Unincorporated Rutherford County, TN".
- **The county is the one the SITE is in**, always from the county layer at the site — never from the city. (A city that crosses a
  county line is one polygon in the city layer: Goodlettsville reads Sumner County on its Sumner side and Metro Nashville-Davidson
  County on its Davidson side.)
- **No ETJ, ever.** Tennessee has none, and the word is not printed on a Tennessee site — not on the chip, the tooltip, the Site
  Analysis rows (the ETJ row is omitted entirely, not "none"), the source messages or the zoning note. (Guarded by
  `test/tennesseeJurisdiction.test.js`.)
- **Three consolidated "Metro" governments** (verified: Nashville-Davidson 1963, Lynchburg-Moore County 1988, Hartsville-Trousdale
  County 2001 — Davidson, Moore and Trousdale are each both a county and a municipality, and have **no unincorporated land**):
  - Nashville proper (the Davidson "balance" polygon) reads **Metro Nashville-Davidson County, TN** — never "unincorporated Davidson".
  - Satellite cities inside Davidson (Belle Meade, Berry Hill, Forest Hills, Oak Hill, parts of Goodlettsville and Ridgetop) keep
    their own charters and read **City of Belle Meade, TN · Metro Nashville-Davidson County**.
  - A Moore or Trousdale point outside the Lynchburg / Hartsville town polygon is still **Metro Lynchburg-Moore County** / **Metro
    Hartsville-Trousdale County**; a Davidson point that no city polygon names is never "unincorporated" either.
- **Memphis / Shelby**: Memphis and *unincorporated* Shelby County are under one Unified Development Code (adopted August 2010 as the
  zoning code and subdivision regulations for both) reviewed through the joint Memphis and Shelby County Office of Planning and
  Development. Shown as a tooltip sentence **only** on a Memphis or unincorporated-Shelby site (Germantown, Collierville, Bartlett,
  Arlington, Lakeland and Millington plan for themselves). Source: Shelby County Board of Commissioners / Memphis City Council staff
  reports on the UDC; the planning office's own UDC landing page was not retrievable, so the sentence says only what the staff reports
  say.
- **Road authority**: the same plain labels as Texas — `State (TDOT)` / `County` / `City` (plus Federal, Private, Other state/local
  agency, `Unknown`). An unrecognised value is "Unknown", never a guess. Functional class text is mapped to the FHWA number the road
  list already decodes.
- **No Texas number on a Tennessee site.** Tennessee has Montgomery, Washington, Jefferson, Lincoln and Franklin Counties (and more)
  that share names with Texas counties; `authorityForJurisdiction` and `computeRequiredDetention` hard-stop on a positive Tennessee
  answer (the named "Detention criteria not yet available in Tennessee" state). Zoning states Tennessee doctrine (cities zone inside
  their limits; counties MAY zone, many do, some do not — T.C.A. title 13, ch. 7), never Texas's "counties have no zoning".
- **Routing is a box; the state is point-in-polygon.** The Tennessee box also holds KY / VA / NC / GA / AL / MS / AR / MO ground; it
  overlaps Georgia's box along the Georgia line (Chattanooga, Cleveland), where BOTH states' county layers are asked and whichever
  names a county decides. Neither naming one → no badge (`notInTennessee`), never "Unincorporated". `siteState` is a real outline
  (`tennesseeJurisdiction.TN_OUTLINE`) that meets Georgia's exactly on the state line — Chattanooga used to read "GA".

## Vintage — said on the tooltip, not hidden

The state's city layer was last edited **2026-03-18**; an annexation after that date is not in it. The tooltip says so ("City limits are
the State of Tennessee's layer, last edited 2026-03-18; annexations since then are not shown — verify with the city"). The date is
read from the registry row (`GIS_SOURCES.cityTn.dataLastEdited`), so refreshing the row refreshes the sentence.

## Urban growth boundaries (TCA 6-58, Public Chapter 1101 of 1998) — NOT shown; here is why

The Tennessee analogue of an ETJ is the county growth plan (urban growth boundary, planned growth area, rural area). It decides where
a city may **annex**; it is not zoning. **There is no statewide authoritative published layer** (searched ArcGIS Online 2026-10-28; the
state's TDOT/Comptroller/STS orgs publish none). What exists is per-publisher and incomplete:

| Where | Layer | Publisher | Edited |
|---|---|---|---|
| Murfreesboro (Rutherford) | `Mboro_UGB` | Rutherford County GIS (the county's own org) | 2023-02-28 |
| Clarksville–Montgomery | `GrowthPlan2040`, `Growth_Plan` | Clarksville-Montgomery County RPC | 2024-07 / 2018 |
| Washington County | `Growth_Areas` | Washington County planning | 2025-10 |
| Columbia, Lewisburg, Mt. Juliet, Livingston, Monroe Co. | one UGB each | each city/county | 2025–26 |

Owner rule — *Planyr makes no claims about data it isn't very sure of* — so no growth boundary is drawn or named anywhere; the
tooltip says growth plans exist and are not mapped yet. Measured for the owner's example: **Epps Mill Rd at I-24 (35.7299, −86.3194)
is unincorporated Rutherford County, outside every city's limits, and outside Murfreesboro's urban growth boundary** (Rutherford County
GIS `Mboro_UGB`, queried 2026-10-28 → no polygon) — for the record only; the app does not state it.

## Coverage and gaps

- **Covered:** all 95 counties (county layer), all 345 municipalities (city layer), the three Metro governments, TDOT road authority
  statewide. Live check, 2026-10-28, 17 sites + 3 road checks + Texas/Georgia known-good arms: `ui-audit/verify-tn-jurisdiction-live-data.mjs`.
- **Gaps (named):**
  1. City-limit **vintage** — annexations after 2026-03-18 are missing until the state refreshes the layer.
  2. **Growth boundaries** — not mapped (above).
  3. **Map lines**: no Layers-panel rows for Tennessee county/city lines yet (Georgia/NJ/NY have them). The header and Site Analysis do not need them.
  4. **School district**: "Not screened in Tennessee" (the ISD source is Texas's TEA).
  5. **Stormwater / detention** criteria: "not available in Tennessee yet" (a hard stop, not a number).
  6. **Local-road coverage** is TDOT's — a road TDOT's inventory does not carry reads "No fronting road found" / `Unknown`, never a guess.
  7. **Knox County** parcels stay a named credentials-locked gap; its jurisdiction works (it needs no parcel).
- **Not tried:** Census TIGERweb (the build sandbox's egress proxy answers 403 for it, so it could not be verified; not wired — the
  verify-before-you-wire rule). It would be the fallback if the state layer is ever withdrawn.

## Guards

`test/tennesseeJurisdiction.test.js` (34 — routing, the outline, every header shape, the Metro governments, the tooltip, no-ETJ,
Site Analysis rows, zoning, road authority, no-Texas-number, registry audit; red on `main` for 28 of them) ·
`ui-audit/verify-tn-jurisdiction-live-data.mjs` (real resolver, live services) · `ui-audit/verify-tn-jurisdiction-live.mjs` (the signed-in app).
Registry rows: `src/shared/gis/sources.js` (`countyTn`, `cityTn`, `roadTn`) with fixtures and notes in `sourceFixtures.js`.
