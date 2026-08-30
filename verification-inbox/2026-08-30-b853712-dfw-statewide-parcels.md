# Verification inbox — 2026-08-30 — B853712 / V475024, closed by the Cowork thread

**Why this file exists.** `Blocker: auth` / `real-data` / `live-GIS` items in `VERIFICATION.md` can only be
closed by the Cowork thread driving Michael's signed-in browser — and that actor cannot push to this repo.
Sessions can push but cannot sign in. This directory is the missing pipe (B825232). Append-only. A session
drains it into `VERIFICATION.md`, moves fully passed items to `VERIFICATION-DONE.md`, and marks the entry
drained here with the PR number.

---

## V475024 — B853712 `Blocker: live-GIS` — PASS, all four steps, driven live in the real app

Closed 2026-08-30 on Michael's real signed-in browser, real network — the exact case this item's
`live-GIS` blocker names: a Claude Code sandbox cannot reach ArcGIS from Chromium (`ws_closed_mid_exchange`
tunnel resets for `geocode.arcgis.com`, `server.arcgisonline.com`, `services.arcgis.com`, and even
Chromium's own `content-autofill.googleapis.com` — a transport limit, not an app fault, per the sandbox's
own diagnosis already on record for this item).

**All four counties driven below are on the DERIVED tier, not a pre-existing literal row** —
`COUNTIES_RAW` holds only 18 literal rows (9 TX Houston-MSA + 9 CO), none of them DFW — so every one of
these exercised the new statewide-derivation path this item shipped, not something that already worked.

### D) The four V475024 steps, driven in the real app, on throwaway plans only

**Step 1 — parcel outlines paint on the map at working zoom.** PASS in Dallas, Rains, Hartley, and
Tarrant: real geometry drew on the Leaflet map at working zoom in every one.

**Step 2 — a click identifies a parcel, never the old "no parcel data wired here yet."** PASS.
- Dallas: "2929 STAG RD, DALLAS, TX 75241", DALLAS ISD, acct `3538267`, 12.73 AC — "More details" returned
  the full appraisal set (land $1,116,620, improvement $0, land use C12).
- Rains: "RS COUNTY ROAD 1495", XTO ENERGY, acct `10894508`, 1992.54 AC.
- Hartley: SKILES CLIFFORD A JR AND JO SONDRA, acct `7452113`, 563.38 AC.
- Tarrant: "4909 NE LOOP 820", LOUIS ENGLER PROPERTIES LLC, acct `11904932`, 15.38 AC.

**Step 3 — the correct county shown in the header.** PASS. The jurisdiction pill read "City of Dallas /
Dallas County" and "City of Haltom City / Tarrant County" — correct governing city AND correct county,
never Harris, never blank, never "couldn't check"; the status chip read green "Scaled / county GIS" on
both.

**Step 4 — a plan is genuinely buildable, saves, and reloads.** PASS. Built a throwaway on the Tarrant
parcel, placed Building 1 at 253,782 SF (966 × 256 ft), then **hard-reloaded**: the parcel outline, the
acreage label, the building, and the jurisdiction header all came back intact. The 3DEP ground-elevation
readout also resolved in both counties, so the terrain tier works there too.

### A) Earlier live TxGIO `/identify` sample, 23 counties, 23/23

Every one returned a real parcel with a real `prop_id` AND a `COUNTY` attribute matching the county the
probed point is actually in.

- **All nineteen DFW-area counties** (every county with territory inside 50 miles of downtown Dallas, edge
  distance): Dallas → DALLAS, Collin → COLLIN, Denton → DENTON, Kaufman → KAUFMAN, Rockwall → ROCKWALL,
  Tarrant → TARRANT, Ellis → ELLIS, Johnson → JOHNSON, Hunt → HUNT, Henderson → HENDERSON, Wise → WISE,
  Hill → HILL, Navarro → NAVARRO, Van Zandt → VAN ZANDT, Grayson → GRAYSON, Parker → PARKER,
  Cooke → COOKE, Fannin → FANNIN, Rains → RAINS.
- **Spread sample outside the 50-mile radius** (proving the statewide derivation, not just the DFW cluster):
  Hartley → HARTLEY, Webb → WEBB, Nacogdoches → NACOGDOCHES, Calhoun → CALHOUN.
- **Sample rows, for the record:** Wise `780574` "618 GREENWOOD RD"; Grayson `105708` "329 WILLOW DR,
  POTTSBORO"; Cooke `14678` "1031 N GRAND, GAINESVILLE"; Webb `215297` "102 E MAYBERRY ST, LAREDO";
  Calhoun `27492` "HWY 185, PORT OCONNOR".

**Honest note, carried forward rather than smoothed over:** Hartley and Parker returned a blank situs
("0 , , TX"). That is the CAD itself having no street address on file for a rangeland tract — correct
data, not a fault. Parcel, owner, and account all resolved for both.

### B) Shipped-code probe, same 23 points

Run directly against the real `counties.js` module and the real committed
`public/geo/county-polygons.json` (not a fixture): `countyIdentity()` returns `status: "ok"` with the
right key and name for every one; `COUNTIES[key]` and `COUNTIES_MAP[key]` both resolve; `scopeWhere` is
exactly `county='<NAME UPPER>'` each time; `statewideDerived` is `true`; `sharedLayerUrlConflicts()` is
empty. 0 failures of 23 — this is the code-level mechanism corroborating the live network pass above, not
a second independent check.

### C) Teeth proof

The green above is a measurement, not an absence (per `DRIVER-SCROLL-IS-NOT-APP-SCROLL` clause 6: point a
probe at a case whose answer is already known, and require it to report that known answer, before trusting
it on the unknown case). With `derivedTxCounties()` stubbed to return `null` (the pre-B853712 world), the
identical probe goes RED exactly where it should: Dallas, Rains, and Hartley all report
`status: "no-source"` and `noParcelSourceNote()` renders "Dallas County — no parcel data wired here yet."
The known-good CONTROL, Harris (a literal `COUNTIES_RAW` row, not derived), stays green throughout —
`status: "ok"`, note `null` — proving the probe can actually see the defect it claims to rule out, and
isn't just green by construction.

### E) A retracted suspicion, recorded so it is not re-opened on the reading alone

While reviewing this drain, `candidateCountiesForPoint` was checked and it returns `harris` as
`candidate[0]` for every DERIVED county, with the real county's own key absent from the list — which
*looks* exactly like the pre-existing B209502 defect (wrong-county candidate ordering). **It is not one,
and it is not a regression.** `withStatewideDerivation`'s Proxy deliberately adds no `ownKeys` trap, so
`Object.entries(COUNTIES_MAP)` still enumerates only the literal rows — the shipping session documented
this decision explicitly in `counties.js` under "WHAT THIS DOES NOT CHANGE." Behaviour is byte-identical
to before B853712: a click over a derived county still finds its parcel through the `txgio_statewide`
candidate that's appended unconditionally for every Texas point, and adding the derived key to the
candidate list would double-query the identical endpoint under two names. Separately — and this is what
actually answers "which county is this" for the UI — `countyIdentity()` and `countyForView()` resolve by
**geometry**, not by the candidate-ordering list, and both were measured correct for all 23 points in
sections A and B above, and driven correctly live in section D. No source file was touched to check this;
it was read-only review of already-shipped code.

**Against V475024's four named steps — all four now driven live, not inferred:**

1. Parcel outlines paint at working zoom, never blank — **PASS**, driven live (D) in 4 counties, and
   corroborated by the 23-county `/identify` sample (A) that every one returns real geometry.
2. Click identifies a parcel, never "no parcel data wired here yet" — **PASS**, driven live (D) with named
   parcels/accounts in all 4, corroborated by the shipped-code probe (B) and its teeth proof (C).
3. Correct county name shown in the header — **PASS**, driven live (D): correct city + county jurisdiction
   pill in Dallas and Tarrant, corroborated by the 23/23 `COUNTY`-attribute match in (A).
4. A throwaway plan is buildable, saves, and survives a reload — **PASS**, driven live (D) on the Tarrant
   parcel: boundary, building, and jurisdiction header all intact after a hard reload.

> **Drained → `VERIFICATION-DONE.md` by PR #1231 (2026-08-30).** Marked ✅ PASSED, all four steps directly
> confirmed live. B853712's whole block moved to `BACKLOG-DONE.md`. No source file changed as part of this
> drain — records only, per the owner's explicit instruction on this drain.
