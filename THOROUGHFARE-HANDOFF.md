# 🛣 Thoroughfare Epic — Handoff for the next session (live Houston data load)

> **Read this in full if Michael says _"load the Houston thoroughfare data"_ (or asks about thoroughfares / ROW / the MTFP).**
> A fresh session has none of the prior chat context — everything to finish **B721's live pull (VERIFICATION V274)** is here.
> Written + verified 2026-07-11 (adversarially fact-checked against the live prod DB and the code). **Delete this file once V274 is closed.**

---

## 0. FIRST: confirm egress, then pick the write path (a decision gate)

**Egress check** — Michael allowed the Houston GIS hosts (list in `OWNER-TODO.md`), but confirm it's live:
```
curl -sS "https://mycity2.houstontx.gov/pubgis02/rest/services/HoustonMap/Transportation/MapServer/1?f=json" | head -c 400
```
JSON back → unblocked. A proxy `CONNECT ... 403` → egress isn't open yet; tell Michael the **exact** blocked host and stop (never route around the proxy).

**Write-path decision gate** — run `printenv SUPABASE_SERVICE_ROLE_KEY`:
- **Set** → you can run the built Node adapter directly (§3, option A). One command.
- **Not set** (the likely case in a normal session) → **do NOT run `server/ingest/thoroughfare.mjs`, it throws.** Use the Supabase-MCP recipe (§3, option B). The MCP writes as the project owner and bypasses RLS.

---

## 1. Where the epic stands (B720–B726, tag `#thoroughfare`)
- **B720 — DONE & live** (verification V275): the data model — three tables on `planyr_production`, PostGIS on, public-read RLS. In `BACKLOG-DONE.md`.
- **B721 — BUILT & merged; live pull owed → V274** (this handoff).
- **B722–B726 — not started.** Surrounding-jurisdiction adapters, the map overlay, parcel ROW-dedication analysis, auto entitlement issues, versioning/freshness. Open in `BACKLOG.md` (grep `^### B72`).

## 2. The production database — `planyr_production` (Supabase project id `lyeqzkuiwngunutlkkmi`)
_All of this was re-verified against the live DB 2026-07-11._
- **PostGIS 3.3.7** enabled — **installed in the `extensions` schema** (NOT `public`). This matters: the `geometry_columns`/`spatial_ref_sys` views and the `geometry` type / `ST_*` functions are `extensions.*`. Schema-qualify them (see §5) — `public.geometry_columns` does **not** exist.
- **`public.jurisdictions`** — 7 rows seeded (config only): `coh, harris, fortbend, pearland, montgomery, sugarland, hgac`.
- **`public.jurisdiction_row_standards`** — **empty.** You seed Houston's Chapter-42 widths here.
- **`public.thoroughfare_segments`** — **empty.** You load Houston's segments here.
- `geom` (MultiLineString, SRID 4326) and `geom_2278` (MultiLineString, SRID 2278, ftUS). A **UNIQUE index on `(jurisdiction, source_feature_id)`** backs the idempotent upsert.
- **RLS = public read-only reference data:** exactly one SELECT policy per table for `{anon, authenticated}`; **no** insert/update/delete policies → only the **service role** (or the MCP owner connection) can write. Don't change this.

## 3. Loading the data — two ways to WRITE

### Option A — you HAVE the service-role key
```
NODE_USE_ENV_PROXY=1 node server/ingest/thoroughfare.mjs houston
```
(`NODE_USE_ENV_PROXY=1` makes Node's fetch honor the agent proxy.) It seeds standards, then pages the layer and upserts. Done. Skip to §5.

### Option B — no service-role key → fetch-transform-to-SQL, then MCP (Claude runs the writes)
A Node script can't call the `mcp__Supabase__*` tools — only Claude can. So split it:
1. **Node harness** (run with `NODE_USE_ENV_PROXY=1`): loop the ArcGIS pages (`buildQueryUrl` from `ingestTransform.js`), run `featureToRow` on each feature, and **write batched SQL files** to the scratchpad — each an `INSERT INTO public.thoroughfare_segments (...) VALUES (...) ON CONFLICT (jurisdiction, source_feature_id) DO UPDATE SET ...`. **Batch 200–500 rows per file** (~≤1 MB of SQL) — thoroughfare EWKT is long; expect a **few thousand** Houston segments → ~10–30 batches.
2. **Cast the geometry explicitly.** `featureToRow` emits `geom`/`geom_2278` as EWKT strings. Raw SQL needs an explicit cast, and because PostGIS lives in `extensions`, **qualify it**: `'SRID=4326;MULTILINESTRING(...)'::extensions.geometry`. **Do a one-row test insert first** to confirm the cast + `search_path` resolve before bulk-loading. Escape the EWKT safely (it contains commas/parens) — prefer parameter-free literals your generator quotes correctly.
3. **Claude runs each batch** via `mcp__Supabase__execute_sql` (project `lyeqzkuiwngunutlkkmi`). Also seed `jurisdiction_row_standards` (the 5 Houston rows from `HOUSTON_ROW_STANDARDS`, with the verified widths from §step-2).

## 4. V274 — the exact steps to finish B721 live

**Step 1 — reconcile the schema against reality.** GET `…/HoustonMap/Transportation/MapServer/1?f=json` and read:
- `fields[]` + their coded-value **domains** — confirm the real field names and the ACTUAL values of the classification/status fields, then fix `houston.js`:
  - `idField` (handoff assumes `OBJECTID` — confirm `objectIdField`).
  - `fieldMap.classification` (`HIER_TABLE`/`ROW_STATUS`) + `fieldMap.status` (`ST_STATUS`) + `fieldMap.street_name` (`FULL_NAME`/`NAME`) — confirm they exist.
  - `classificationCrosswalk` keys must be the **lowercased actual domain values** (`normalizeClassification` lowercases+trims). Anything unmatched → `other`; make sure nothing important lands there.
- `maxRecordCount`, `advancedQueryCapabilities.supportsPagination`, `supportedQueryFormats`.
  - **Good news — the adapter is already hardened for the common failure modes:** it queries **`f=json`** (universal; `f=geojson` is only on 10.4+), `featureToRow`/`geometryToParts` parse **both** Esri JSON (`attributes` + `paths`) and GeoJSON, paging stops on the server's **`exceededTransferLimit`** flag (not a brittle page-size compare), and a **dedupe guard** breaks the loop if the layer ignores `resultOffset`. If that guard fires ("a full page returned no NEW features"), the layer needs **OBJECTID-window paging** — set `orderByObjectId:true` in `buildQueryUrl` and change the loop to `where=OBJECTID>lastId`. A run that ends **"0 upserted but N skipped"** = a geometry-format mismatch — inspect the response geometry shape.
- **`plan_adopted_date`:** read the plan/layer vintage now and set `HOUSTON.planAdoptedDate` in `houston.js` **before** loading, so segments are stamped with it (B726 needs a defensible "as-of"). If you load first, do a follow-up `UPDATE ... SET plan_adopted_date=... WHERE jurisdiction='coh'`.
- ⚠ **Changing `houston.js` will break `test/thoroughfareIngest.test.js`** — its fixtures hardcode the current guessed field names/domains. Update those fixtures to the real values **in the same commit** and re-run `npm test`, or the build gate goes red.

**Step 2 — seed the VERIFIED Chapter-42 widths.** Today only `major_thoroughfare = 100 ft` is confirmed (Houston Code of Ordinances §42-122). Get the official table — from `https://www.houstontx.gov/planning/transportation/MTFP.html`, the **"MTFP Minimum Right-of-Way Width by Street Classification"** PDF — and fill `freeway / transit_corridor / collector_major / collector_minor` (+ `building_line_ft` if given) in BOTH `HOUSTON_ROW_STANDARDS` (code) and the DB.
- It's a **PDF**: `curl` it down (only `www.houstontx.gov` is allowlisted) and extract the table (pdf-to-text; WebFetch on PDFs is unreliable). **If a source is on a NON-houstontx.gov host** (e.g. municode / `elaws.us` — both were **blocked** by org policy last session), you can't reach it — ask Michael to allow that host, or fall back.
- **Never guess a width — leave a class null** if the table is unclear. A wrong ROW number is worse than a null in an entitlement tool.

**Step 3 — load the segments** (§3, option A or B). Idempotent upsert on `(jurisdiction, source_feature_id)`.

**Step 4 — verify it worked** (via `mcp__Supabase__execute_sql`, project `lyeqzkuiwngunutlkkmi`):
```sql
-- pre-flight: EPSG:2278 must exist for the geom_2278 insert
select count(*) from extensions.spatial_ref_sys where srid = 2278;                 -- expect 1
-- geometry columns are registered as MultiLineString
select f_geometry_column, type, srid from extensions.geometry_columns
  where f_table_name = 'thoroughfare_segments';
-- counts + no class dumping-ground
select count(*) from public.thoroughfare_segments where jurisdiction = 'coh';
select classification, count(*) from public.thoroughfare_segments
  where jurisdiction = 'coh' group by 1 order by 2 desc;                            -- 'other' should be small
select count(*) from public.jurisdiction_row_standards where jurisdiction = 'coh'; -- expect 5, widths filled
-- spot-check a known road + that geometry plots in the Houston area
select street_name, classification, status,
       extensions.ST_AsText(extensions.ST_PointN(extensions.ST_GeometryN(geom,1),1)) as first_vertex
  from public.thoroughfare_segments
  where jurisdiction='coh' and street_name ilike '%westheimer%' limit 3;           -- lon ~ -95.x, lat ~ 29.x
```
Then **re-run the load** and confirm the count is unchanged (idempotency — no duplicates).

**Step 5 — close it out** (mind the archiving rules):
- **B721 is in `BACKLOG.md` under `## ⏳ Verify — awaiting live confirmation`** (NOT in BACKLOG-DONE yet). Move its whole block **from there to `BACKLOG-DONE.md`** with the real counts.
- Move **V274** from `VERIFICATION.md` **to `VERIFICATION-DONE.md`** with the observed result (date · method · counts).
- Regenerate `node scripts/build-backlog-index.mjs` (drops B721 off the open index) and `node scripts/build-map.mjs` if any file changed; run `npm test` + the drift/`doc-pointer-audit` gates green; commit + ship (PR → merge into `main`).

## 5. Decisions already made — don't re-litigate
- **Public reference data**, not per-user. Anon-readable, service-role-write. Do **not** add own-row RLS.
- **ROW width comes from the standards lookup, never off the source feature.**
- **Geometry is MultiLineString**; `geom_2278` is projected client-side via the shared, pyproj-validated `projectToGrid` — reuse it, don't add a DB trigger.
- **Idempotency key = `(jurisdiction, source_feature_id)`.**
- **Never guess ROW widths** — null beats wrong.

## 6. The code (already on `main`, 27 unit tests green)
- `src/shared/thoroughfare/classification.js` — canonical class enum + `normalizeClassification(raw, crosswalk)` + `normalizeStatus`.
- `src/shared/thoroughfare/ingestTransform.js` — pure `featureToRow(feature, config)` (format-agnostic: Esri JSON + GeoJSON), `geometryToParts`, `ewkt4326`/`ewkt2278`, `buildQueryUrl(config, {offset,pageSize,orderByObjectId})`.
- `src/shared/thoroughfare/houston.js` — `HOUSTON` config (endpoint, field map, crosswalk, `.standards`) + `HOUSTON_ROW_STANDARDS`.
- `server/ingest/thoroughfare.mjs` — runnable adapter (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).
- `test/thoroughfare.test.js` + `test/thoroughfareIngest.test.js` — 27 tests.

## 7. After B721
- **B722** — generalize to Harris, Fort Bend, Pearland, Montgomery, H-GAC: one config per jurisdiction reusing `ingestTransform.js`; each needs its own field map + crosswalk. PDF-only plans (Sugar Land 2012, Montgomery 2016) = a low-fidelity, lower-confidence path. Log per-source coverage.
- **B723** — the toggleable "Thoroughfare Plan" map overlay (do once data is loaded, so it's testable): style by classification/status (solid=existing, dashed=proposed), legend, jurisdiction filter, click popup, provenance note.
- **B724/B725/B726** — parcel frontage + ROW-dedication analysis (uses `geom_2278`), auto entitlement issues, and versioning/freshness + scheduled re-ingestion (`pg_cron` + `pg_net`/`http` are available on this DB, or the built-but-undeployed Cloud Run tier).

## 8. Egress
The hosts Michael allowed are in `OWNER-TODO.md`. If a county GIS host is still blocked when you reach it in B722, report the **exact** host to Michael — the proxy denies it by org policy; never route around it.
