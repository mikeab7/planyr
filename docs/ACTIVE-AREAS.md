# ACTIVE AREAS — where Planyr users actually place sites

The weekly **"where people are working" sweep** (Michael's standing ask) keeps its ledger here: hone in on the
counties where users really place sites, check that parcels, tax, zoning, water and each state's site-killers
work there, and fix what doesn't. The sweep runs read-only and cannot push, so a Claude Code session writes this
file from its report.

**How to keep it (rules for the sweep and for any session that edits this file)**
- ONE section per `sites.county` key. **A re-sweep REPLACES that section — this is a ledger of now, never a history.**
- Counts = `live rows` (`deleted_at is null`) · `distinct users` · `rows touched in the last 14 days`
  (`updated_at`). Aggregates only — never a site id, name or user.
- Checklist per area: **A** Parcels · **B** Tax · **C** Jurisdiction & zoning · **D** Water · **E** Site-killers · **F** Signals.
  Each cell is one of **PASS** · **FAIL** · **NOT WIRED (blocker)** · **N/A**, plus the open `B#`s. A cell the sweep has
  not (re)recorded is written **—** — never guessed.
- Evidence of a PASS is measured, dated and re-measurable: A is backed by the nightly known-parcel fixtures
  (`src/shared/gis/sourceFixturesParcels.js`, asserted by `ui-audit/parcel-source-health-sweep.mjs`).
- Open items go on the ledger (`npm run ledger -- list open`); this file only points at them.
- The nightly **unresolved-county watch** (`.github/workflows/ops-digest.yml` → `scripts/ops-county-watch.mjs`) counts live
  plans with drawn parcels and no county — they fall out of every area below. Red when above zero for more than a week.

**Dispatched 2026-11-12** (the chat sent each open finding to its own session; the area each touches is by name — the
owning session's `B#` on the ledger is the record): address search / situs · stacked rows · Texas tax · Tennessee tax ·
Bartow tax · Rutherford zoning · Nashville zoning · Nashville water buffers · Texas city zoning (Fort Bend: B2671234,
Webster: B2671235) · Mont Belvieu / Baytown (B2671236) · ETJ sources · Fort Bend water / contours · Houston layers ·
ag rollback (B2671233) · Chambers detention · storage wells · Bartow layers · map errors.

Counts below were measured on **2026-11-12** (production, read-only). Sections swept so far carry their sweep date.

---

## harris — Harris County, TX
Last swept **2026-10-30** · live rows **136** · users **5** · touched 14d **17**

| | Status | Notes |
|---|---|---|
| A Parcels | **PASS** (fixtures, 6 lots, 2026-11-12) | `HCAD_NUM` / `owner_name_1` / `acreage_1` all matched. Dispatched: address search / situs. |
| B Tax | — | Dispatched: Texas tax · ag rollback (B2671233). |
| C Jurisdiction & zoning | — | Dispatched: Texas city zoning · ETJ sources. |
| D Water | — | Dispatched: Houston layers. |
| E Site-killers | — | Dispatched: storage wells. |
| F Signals | — | Dispatched: map errors. |

## fortbend — Fort Bend County, TX
Last swept **2026-10-30** · live rows **22** · users **3** · touched 14d **5**

| | Status | Notes |
|---|---|---|
| A Parcels | **PASS** (fixtures, 5 lots, 2026-11-12) | `QUICKREFID` / `OWNERNAME` / `LANDSIZEAC` matched. |
| B Tax | — | Dispatched: Texas tax · ag rollback (B2671233). |
| C Jurisdiction & zoning | **FAIL** | Richmond / Fulshear / Stafford zoning: B2671234. Dispatched: ETJ sources. |
| D Water | — | Dispatched: Fort Bend water / contours. |
| E Site-killers | — | |
| F Signals | — | |

## tn_rutherford — Rutherford County, TN
Last swept **2026-10-30** · live rows **5** · users **2** · touched 14d **2**

| | Status | Notes |
|---|---|---|
| A Parcels | **PASS** (fixtures, 5 lots, 2026-11-12) | `ParcelID` / `Owner1` / `DEEDACRES` matched. |
| B Tax | — | Dispatched: Tennessee tax. |
| C Jurisdiction & zoning | **FAIL** | Dispatched: Rutherford zoning. |
| D Water | — | |
| E Site-killers | — | |
| F Signals | — | |

## ga_bartow — Bartow County, GA
Last swept **2026-11-01** · live rows **5** · users **3** · touched 14d **0**

| | Status | Notes |
|---|---|---|
| A Parcels | **PASS, with a defect** (fixtures, 4 lots, 2026-11-12) | Owner + acres match, but the layer returns **stacked rows** for one `PARCELID` (Gerdau 170 rows, Allatoona 3). The fixture asserts ≥ 1 row until the stacked-rows fix ships, then flip `stacked` off / `oneLot` on. Dispatched: stacked rows. |
| B Tax | — | Dispatched: Bartow tax. |
| C Jurisdiction & zoning | — | |
| D Water | — | Dispatched: Bartow layers. |
| E Site-killers | — | |
| F Signals | — | |

## chambers — Chambers County, TX
Last swept **2026-11-01** · live rows **5** · users **2** · touched 14d **2**

| | Status | Notes |
|---|---|---|
| A Parcels | **NOT MEASURED this session** | 3 fixtures seeded from the 2026-11-01 sweep; `gisdata.pandai.com` is blocked in the Claude Code sandbox and is not on the gis-proxy allow-list, so they were not re-queried. The first nightly run is the live check (owner column auto-resolved by `ownerKey`). |
| B Tax | — | Dispatched: Texas tax. |
| C Jurisdiction & zoning | **FAIL** | Mont Belvieu / Baytown: B2671236. |
| D Water | — | Dispatched: Chambers detention. |
| E Site-killers | — | Dispatched: storage wells. |
| F Signals | — | |

## tn_davidson — Davidson County, TN (Nashville)
Last swept **2026-11-01** · live rows **2** · users **2** · touched 14d **0**

| | Status | Notes |
|---|---|---|
| A Parcels | **PASS** (fixtures, 4 lots, 2026-11-12) | `STANPAR` / `Owner` / `Acres` matched. |
| B Tax | — | Dispatched: Tennessee tax. |
| C Jurisdiction & zoning | **FAIL** | Dispatched: Nashville zoning. |
| D Water | **FAIL** | Dispatched: Nashville water buffers. |
| E Site-killers | — | |
| F Signals | — | |

---

## Next areas to sweep (not yet swept)

| Area | Live rows | Users | Touched 14d | Note |
|---|---|---|---|---|
| waller | 4 | 2 | 2 | |
| co_adams | 16 | 1 | 15 | busiest unswept area |
| ms_desoto | 6 | 2 | 6 | re-sweep **after 2026-11-26** |
| ga_fulton | 5 | 1 | 2 | |
| ga_spalding | 1 | 1 | 1 | |
| ok_washington | 2 | 1 | 2 | |
| co_arapahoe | 2 | 1 | 1 | |
| co_denver | 3 | 1 | 0 | |
| the Georgia singles | — | — | — | one-site Georgia counties |

## Unresolved county (no section can hold these)

2026-11-12: **3** live plans have drawn parcels and no county (the 2026-11-01 sweep saw exactly 1). They belong to no area
above. The nightly watch starts its one-week clock on its first run; the query is in `src/workspaces/admin/db/admin_ops_county_watch.sql`.
