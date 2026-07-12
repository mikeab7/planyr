# COWORK-BRIEF — 2026-07-12 — Stormwater drainage-authority follow-ups (evidence for B796–B802)

Shared evidence for backlog items **B796–B801** (+ **B802**, the NEW-7 residual — see the NEW-7
section at the end), filed from a Cowork investigation under provisional labels NEW-1…NEW-7. All
ground truth below was **verified live 2026-07-12** by the investigating session, replayed at the
real parcel ring against the app's own registry sources.

> **⚠ SECOND RENUMBER (2026-07-12, on merge-in of `origin/main`).** These items were first filed as
> **B788–B793**; the concurrent data-deletion-safety session (PR #602) merged first holding the same
> numbers, so the six renumbered to **B796–B801** (headings only — code, tests, specs, and commit
> messages keep the provisional B788–B793 labels, per the house late-bind rule). Mapping:
> NEW-1 B788→**B796** · NEW-2 B789→**B797** · NEW-3 B790→**B798** · NEW-4 B791→**B799** ·
> NEW-5 B792→**B800** · NEW-6 B793→**B801** · NEW-7 → **B802** (residual only — see below).
> Section headings below keep their original numbers for fidelity with the code labels.

## ⚠ B# renumber mapping (the brief was written against provisional labels)

The investigation cited commit-label B#s; those renumbered on merge (code/commits keep provisional
labels — house rule). Translation used in the filed items:

| Brief said | Live B# | PR | What it is |
|---|---|---|---|
| "B750 remember-it" | **B751** | #571 | transparent/overridable HCFCD-channel + reviewing-agency drainage detection, remember the last check |
| "B752 ETJ fix" | **B754** | #574 (merged Jul 10, 3:30 PM CDT) | Houston-**ETJ** parcel no longer treated as City of Houston for detention criteria |
| "B758–B764" | **B763–B773** batch | #587 | Fort Bend / Harris floodplain + detention criteria records |

## Site under test

Project `smr9olizi5ue` **"Bain"** / Concept A — 27211 Hoyt Ln, Katy 77494. 5 parcels, 110.06 ac,
main tract 64.38 ac.

## Ground truth (replayed live at the real parcel ring, 2026-07-12)

- **TxDOT county** → **Fort Bend only** (no straddle).
- **TxGIO city limits** → ring **intersects Katy** but **centroid outside** (frontage sliver).
- **H-GAC ETJ** → **HOUSTON** for both ring and centroid.
- **TEA** → Katy ISD.
- **TCEQ districts** → **Fort Bend County Drainage District**.
- **No HCFCD presence** — HCFCD ends at the Harris line.

## Per-item evidence

### B788 (NEW-1) — rehydrated check replays the pre-B754 verdict
- `sites.data.settings.drainage.lastCheck.checkedAt = 1783713120066` → **Fri Jul 10, 2:52 PM CDT**,
  **38 min before B754 (PR #574) merged** at 3:30 PM CDT.
- Stored `authority.jurisdiction = {city:[Katy], etj:[Houston], county:[Fort Bend]}` — the **raw facts
  are correct**; stored `primaryReviewerId:"coh"` is the pre-B754 verdict, and it rehydrates forever,
  rendering as present-tense "(detected from city-limits GIS)".
- Code path: `hydrateDrainageContext` (`lib/detentionRules.js:1493`), consumed at `SitePlanner.jsx:6255`
  (line anchors re-verified against main 2026-07-12; the brief's originals had drifted).

### B789 (NEW-2) — Harris-side criteria priced a Fort Bend site
- Cascade as displayed: **HCFCD 0.65 × 109.0 ac = 70.85 ac-ft** vs **COH 0.75 × 21.4 impervious ac
  = 16.05** → "HCFCD governs". Neither authority has jurisdiction (site is Fort Bend / FBCDD).
- `drainInCity` (`SitePlanner.jsx:6276`) tests any-city membership — the Katy frontage sliver satisfied it.
- Bain carries a latent `drainsToHcfdChannel`-override `true` stored against a
  `channel.state:"not-applicable"` detection.

### B790 (NEW-3) — sticky floodplain-mitigation picker
- `settings.floodMitigation.jurKey:"harris"` persisted on the Fort Bend site → panel reads
  "Harris County (unincorporated)" directly above the FBCDD district note; ↻ Re-check can't fix it,
  no way back to automatic.
- Only writer is the Jurisdiction select in the flood-mitigation panel (writes through the `onChange`
  patch at `SitePlanner.jsx:6461`; panel ~12555). `defaultFloodJurForAuthority` maps hcfcd→harris,
  coh→coh (`lib/floodplainRules.js:132`) — so the sticky "harris" plausibly arrived via the same
  pre-B754 COH/HCFCD verdict.

### B791 (NEW-4) — stale check stays authoritative
- Boundary edited **Jul 11** → signature mismatch → only a small italic line; the stale
  reviewer/pricing/copy stay authoritative.

### B792 (NEW-5) — `sites.county` = "waller" on a Fort Bend site
- Bain row `county:"waller"` while all parcel attrs are **FIPS 48157 (Fort Bend)**.
- Consumers reading it as truth (anchors re-verified 2026-07-12): `resolveCountyLayer`
  (`SitePlanner.jsx:6592` — identify-mode add queries the wrong CAD), `resolveTaxRates(siteCounty, …)`
  (`SitePlanner.jsx:2546`), easement `jurKey` default (`SitePlanner.jsx:1562`),
  `defaultFloodJurForCounty(restored?.county)` fallback (`SitePlanner.jsx:6315`).
- MapFinder's B36(a) relabel (`MapFinder.jsx` ~899–906 — note the `chambers` carve-out, since
  B787-adjusted) does **not** persist to the site row.

### B793 (NEW-6) — badge leads with a sliver city
- Badge reads "City of Katy / City of Houston — ETJ" although Katy's limits touch only the parcel
  edge (ring intersects; centroid doesn't) and the dominant jurisdiction is unincorporated Fort Bend
  in Houston's ETJ.

## Owner-side state (may already be corrected before a fixing session reads this)

In-app corrections were advised to the owner on 2026-07-12: ↻ Re-check drainage, floodplain
Jurisdiction → Fort Bend County, channel toggle → Auto. The deployed build already includes B754 +
the B763–B773 batch, so a **fresh** check resolves Fort Bend correctly — the bugs are about stored
state, gating, and presentation, not the current-rules engine.

## Data note (reconcile when the spec is next touched)

The owner-side jurisdiction-criteria spec (§2.5 — not an in-repo file) says "Katy ETJ" at this
address; **H-GAC returns HOUSTON ETJ for the entire ring**. Reconcile whenever that spec is next
touched (SB 2038 vintage caveat applies — city ETJs are shrinking as landowners opt out, so any
stored ETJ answer carries the layer's vintage).

## NEW-7 (→ B802) — 0.2% (500-yr) WSE provider: dedupe verdict + evidence (added 2026-07-12)

NEW-7 asked to wire a 0.2% WSE provider (FBCDD "Local Watershed Studies Atlas 14 Results") so the
500-yr mitigation slice prices automatically, with fallback UX and a Harris stance. **DEDUPE-FIRST
verdict: Scope A was already shipped as B782** (⏳ Verify → V284, branch
`claude/fort-bend-ffe-outfall-kt4j8i`): `GIS_SOURCES.fbcddWse02` (production-tier raster row for
`gisportal.fortbendcountytx.gov/image/rest/services/500YR_WSE/ImageServer`, sampleFixtures + the
drift-verifier raster branch), the `lib/fbcdWse.js` getSamples sampler (FEET/ft-NAVD88, SR 2278),
the Fort Bend-gated compute in `checkDrainage` → `floodGeo.derivedWse02` → `fmElev.derivedWse02Ft`,
engine precedence manual-over-derived, and DRAFT labels through card + print. The brief's premise
that "`derivedWse02Ft` is hard-null" was stale — B782 merged the same day. **Scope C** (Harris:
MAAPnext DRAFT, M3 download-only → manual) was already the documented stance in
`WSE02_PROVIDER_NOTES` (`lib/pfds.js`). **No number was minted for either.**

**B802 = the genuine residual, implemented 2026-07-12:** (1) the mitigation UNKNOWN names the
missing input ("no 0.2% (500-yr) WSE — enter it from the EFFECTIVE FIS profile"); (2) county-aware
input placeholder/tooltip (Fort Bend → FIRM 48157C, eff. 2014-04-02 — the pre-Atlas-14 basis
Interim §9 references); (3) the basis-distinction label on every `fbcdd-wse02-draft` surface
(card ⚑, footer, print pairs — the Atlas-14 read is a labeled STAND-IN for the pre-Atlas-14 FIS
basis, never silently substituted); (4) the `wse02-below-1pct` sanity flag (flag, never clamp).

Plug points confirmed during implementation (anchors current as of this commit):
`derivedWse02` compute SitePlanner.jsx ~6227–6237 (B782); engine 02pct precedence
`floodplainMitigation.js:459-465`; buildability reads `wse02Ft ?? derivedWse02Ft` (:6423 region);
`WSE02_PROVIDER_NOTES` at `lib/pfds.js:93`. Verified Bain fixture facts for any future 100-yr work:
NFHL S_XS (MapServer/14) returns 8 cross-sections on "Willow Fork Buffalo Bayou", WSEL_REG
134.9–139.7 ft NAVD88; S_BFE (MapServer/16) returns 0 BFE lines; site ground ≈135.5 NAVD88.
The brief's acceptance ("fresh check on Bain prices BOTH bands with zero manual entry") is B782
Scope-A behavior → verifies under **V284**; B802's own checks are **V300**.
