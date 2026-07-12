# Planyr — Technical reference (implementation detail)

Moved out of `CLAUDE.md` 2026-07-02. Deeper specifics behind the architecture summaries in `CLAUDE.md`. Pull up on demand when you touch a subsystem.

# Technical reference (preserved implementation detail)
Deeper specifics behind the summaries above. Paths reflect the monorepo layout
(`src/workspaces/site-planner/…`).

## Playwright / ui-audit in the sandbox
All screenshot harnesses live in `ui-audit/` and target the Vite preview server on
`:4173` (`npm run build && npx vite preview`). One non-obvious sandbox quirk:

**Always pass `--ignore-certificate-errors` to Chromium.** The sandbox routes
outbound HTTPS through a TLS inspection proxy. Node.js trusts it (system cert store);
Chromium does not — every tile request fails with `ERR_CERT_AUTHORITY_INVALID` and
the basemap renders gray. The flag is already set in `capture.mjs` and
`verify-markers.mjs`. Add it to any new Playwright harness you write:
```js
chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] })
```
The allowed-domain list (`*.arcgisonline.com`, etc.) is configured at the environment
level and works fine once Chromium trusts the proxy cert.

**`statusOf(site)` reads `site.status` (top level), not `site.data.status`.** When
seeding localStorage for verification, put `status: "active"` directly on the site
object. Sites loaded through `loadSitesList()` → `createSiteModel()` get the field
normalized automatically, but raw localStorage seeds bypass that path.

## Stack
Vite + React 18, plain JS/JSX, inline styles, the `PAL` drafting palette, terse
comments. Map = Leaflet + esri-leaflet. Planner canvas = hand-rolled SVG. **Units:
feet everywhere internal; convert only at the map boundary.**

## Site Model (`src/workspaces/site-planner/lib/siteModel.js`)
Canonical per-plan schema; read via selectors, persist via storage — never a parallel
store. `createSiteModel`, `SITE_MODEL_VERSION = 2`. Persisted fields stay flat +
back-compatible (no field renames), additive buckets:
```
{ schemaVersion, id, groupId, site, name, updatedAt,
  origin:{lat,lon}|null, county,
  parcels[], underlay, settings,
  els[],                         // drawn layout elements
  markups[],                     // flat: neutral annotations + semantic shapes
  measures[], callouts[],
  elevation:{ crossSections[] },
  constraints:{ liveLayers[] } } // RESERVED: per-site layer memory (not yet wired)
```
`els`/`markups` stay flat; **selectors classify by meaning:** `constraintsOf`
(easements = markup kind `encumbrance`; setbacks derived from parcels; liveLayers),
`utilitiesOf` (`utilRoute|traced|infwater`), `annotationsOf`
(line/rect/ellipse/polygon/polyline + measures + callouts), `crossSectionsOf`,
`setbacksOf`, `parcelsOf`, `elementsOf`, `developableArea` (**stub** for the future
synthesis). **Conformance:** add data as new model fields (additive), bump
`SITE_MODEL_VERSION`, extend `migrate`, expose via a selector.

`storage.js` is a thin layer over the model: `loadSite`/`loadSitesList` migrate on
read; `saveSite` merges the partial and re-normalizes via `createSiteModel` (additive,
lossless, idempotent).

## Map-layer system (`src/workspaces/site-planner/lib/layers.js` + `components/LayerPanel.jsx`)
One source of truth used across the planner. Layer `kind`s: `dynamic` (esri
`dynamicMapLayer` image — FEMA, NWI, TxRRC, jurisdiction utilities, COH hydrants),
`esriImage` (esri `imageMapLayer` — USGS 3DEP elevation/hillshade), `esriFeature`
(vector `featureLayer` — HIFLD transmission, non-interactive), `overpass` and
`mapillary` (live, view-driven vectors in `lib/evidenceLayers.js`).
- **Geographic planner:** a non-interactive Leaflet Web-Mercator basemap + shared
  overlays sit behind the transparent feet-based SVG, anchored to the site `origin`.
  Geometry/metrics stay in feet; `ppfToZoom` + canvas-centre→latlng lock the basemap.
  Feet↔deg uses the Mercator sphere base (**≈365223 ft/deg, both axes**) so drawn
  geometry overlays the aerial sub-pixel.
- **Health/diagnostics:** `probeService` parses the service JSON (HTTP 200 + `.error`
  = failed) and surfaces the server message; per-layer status dots
  (loading/loaded/empty/failed); no zero-size export; `fetchWithRetry` + tile retry
  with backoff; ~45s self-heal re-probe.
- **Houston COH utilities** (`counties.js` JURISDICTION_LAYERS.harris): host
  `geogimstest.houstontx.gov/arcgis/rest` (folders `HW/Water_gx`, `HW/WasteWater_gx`,
  `TDO/UN_Stormwater`) — the only CORS-clean host. Sublayers pinned via `layers:`
  (water `0,1`; wastewater `2,6`; storm `22,23,24,904`) or defaults render meters,
  not mains. Trunk lines scale-gated to ~≥1:40k; coverage is City-of-Houston-only.
- **Site-engineering tools** (planner Layers control → Evidence tools): electric &
  water service routing (`buildUtilRoute`), pond detention calculator
  (`detentionStorage`, 3:1 taper, prismoidal volume), editable easement-rule table
  (`lib/easementRules.js`, VERIFY placeholders), ditch cross-section
  (`lib/elevation.js`, 3DEP `getSamples`) feeding `el.det.availDepth`. All elevation
  output labeled "screening only — verify with survey."
- **Terrain pipeline (B703–B706):** the `TERRAIN` registry rows in `lib/layers.js` — ground
  relief (an `esriImage` layer whose `rendering` is a custom Colormap-over-Stretch **DRA**
  rendering-rule OBJECT: the server re-stretches blue→cream→red to each exported extent, so
  colors are view-relative), plus client-generated **1-ft contours** and **drainage-direction
  arrows**. Those two fetch the RAW DEM per snapped view tile (`lib/demGrid.js` —
  `exportImage format=lerc pixelType=F32 renderingRule=None`, native SR 3857, decoded to
  survey-ft NAVD88 with a validity mask) and compute in `lib/terrainWorker.js` (the repo's
  first Web Worker; pure-module imports only, test-pinned): masked gaussian smooth →
  `d3-contour` marching squares with border/void strip passes (`lib/contours.js`) →
  windowed-gradient flow arrows (`lib/flowField.js`; classic D8 kept there as the future
  flow-accumulation seed). Main-thread glue `lib/terrainLayers.js`: one deduped fetch+compute
  per tile shared by both layers, `gisCache.swr` persists the JSON artifact only (grids live
  in an in-memory LRU — never JSON.stringify a Float32Array through gisCache), proxy→direct
  fallback with LERC magic-byte sniff, canvas-renderer polylines, zoom gate 16. The hover
  elevation readout (`components/useGroundElevation.js`) bilinear-samples the UNSMOOTHED
  cached grid (agrees with the cross-section tool) with a debounced `samplePoint` fallback.
  The one pixel convention (cell value at cell CENTER) is pinned by the ramp calibration test
  in `test/contours.test.js` — contours, readout, and cross-section can't drift by half a cell.
- **Mapillary token is a secret** — `import.meta.env.VITE_MAPILLARY_TOKEN` (CI secret)
  or a user-entered localStorage value. Never commit it.
- **Print/PNG (B738/B739):** the SVG clone can't capture the live Leaflet basemap/overlay
  tiles (cross-origin canvas), so the export SYNTHESIZES them per print frame instead of
  screenshotting: the aerial from the basemap source's `export` endpoint (B738), and each
  enabled RASTER overlay (`kind` absent/`dynamic`/`esriImage` — FEMA/pipelines/wetlands/
  utilities/MUD/relief) from its own transparent ArcGIS `/export` PNG (B739,
  `overlayExportPlacement`/`overlayExportRequest`), composited above the aerial in on-screen
  z-order (`ALL_LAYERS` registry order) at each layer's opacity. Fetched proxy-first
  (same-origin → canvas-clean) with a direct-agency CORS fallback; a dropped layer warns
  loudly (`overlaysDropped` → batched banner), never a silent omission. Gated by the "Print
  map layers" toggle (default on). The VECTOR/thin-line layers (HIFLD transmission,
  road-authority, county/city/ETJ boundaries, contours, drainage arrows, OSM/Mapillary) are NOT
  server images, so they're captured differently (B745, `lib/overlayVectorSvg.js` +
  `exportVectorOverlaysForFrame`): each live layer's lat/lon geometry is read off `overlayRefs`,
  reprojected into the site feet frame (`lngLatRingToFeet` → `f2p`) and redrawn as styled SVG in a
  `<g data-export-vector>` at the same z-anchor (colors/weights verbatim — PDF-PARITY; boundary
  names re-run `boundaryLabels`; terrain from the cached `terrain:*` artifact). Sync-only — a layer
  that's on but not loaded / out of frame / below its load-zoom is honestly omitted (console note),
  never half-drawn. Note: DRA ground-relief re-stretches per sheet extent, so its tint is
  self-consistent per sheet but not pixel-matched to the screen ramp.

## Supabase (`src/workspaces/site-planner/lib/supabase.js`, `auth.js`, `cloudSync.js`)
Config from build-time env only (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`;
gitignored, Actions secrets — see build.yml). Connection test hits `/auth/v1/health`
with the apikey (the PostgREST root is secret-key-only under the new key model — a
publishable/anon key correctly 401s there). Auth = email+password via `auth.js` +
`components/AuthPanel.jsx`. Phase 4: logged in → per-user local cache
(`planarfit:sites:cloud:<uid>`) pulled on login + writes mirror to the `sites` table;
logged out → legacy `planarfit:sites:v1`. Save badge reflects the real cloud write.
No migration of legacy sites (recreate manually).

**Supabase org/project naming convention (resolved — closes the "Planar vs Planyr" confusion; B407).**
ONE app, so the **org carries the brand** and **projects are named by environment** (deployment-
lifecycle stage), never by feature — this keeps the set readable as the commercial/VC direction adds
environments and avoids the redundant "Planyr / Planyr" nesting:
- **Organization = `Planyr`.**
- **Live (production) project = `planyr-production`**, AWS `us-east-1` — serves planyr.io; its
  dashboard label was the old "Site Planar" until the owner renamed it to this convention (2026-06-23).
- **`planyr-staging` reserved** for a future second-environment project (not yet created).

**Renaming a Supabase org/project display label is COSMETIC — no rebuild, nothing breaks** (the safety
fact that pairs with the build-time-env gotcha above). The connection is bound to the **immutable
20-char project ref** baked into `VITE_SUPABASE_URL` (`https://<ref>.supabase.co`) and the **anon
key** — renaming the org or project changes **neither the ref, the URL, nor the key**, so cloud
save/load/auth keep working with **no redeploy**. Only creating a *different* project (a new ref) or
rotating keys would force a rebuild of the build-time env.

**✅ CONSOLIDATED — ONE live Supabase project (B408, executed 2026-07-11).** The old two-project split
(main app on `lyeqzkuiwngunutlkkmi`, Scheduler on its own project `ksetjztkplttbcehyicv`) is resolved:
the Scheduler's three tables (`planar_data` / `planar_history` / `planar_suggestions`) were recreated
in **`planyr-production` (ref `lyeqzkuiwngunutlkkmi`)** with identical columns, the
`planar_history_id_seq` sequence (setval'd to max id), the `planar_history_key_created_idx` index,
identical RLS policies (anon read/insert/update — the scheduler talks to PostgREST with the anon key),
and realtime enabled on `planar_suggestions` (the Suggestions view subscribes). All 679 rows
(1 `planar_data` / 669 `planar_history` / 9 `planar_suggestions`) were copied with ids + timestamps
preserved and verified byte-identical via full-table md5 checksums (migrations
`scheduler_consolidation_planar_tables` + `planar_suggestions_realtime` in the target's migration
history). Code repointed in the same change: `public/sequence/index.html` (hardcoded URL + anon key),
`functions/api/mcp/_tools.js` (`SEQ_URL`/`SEQ_ANON` fallbacks), `ui-audit/verify-cross-module-link.mjs`
(abort route). The old project ("Planar", AWS `us-west-2`, ref `ksetjztkplttbcehyicv`) is **retired —
after a post-deploy delta re-sync + live check it is safe to delete**, freeing the second free-plan
slot (the owner is repurposing it for a personal, non-Planyr database). If any doc still says "TWO live
projects," it predates this. `planyr-staging` remains reserved as a name for a future second environment.

**Follow-up worth knowing (not urgent):** the migrated `planar_*` RLS policies are wide-open anon
read/write — exact parity with how the scheduler has always worked, but now those tables sit in the
production project. Tightening them to authenticated/owner-scoped access is a future item; it requires
scheduler auth work, not just a policy flip.

**Supabase security-advisor ACCEPTANCES (audited 2026-07-12, delete-safety batch — don't re-litigate
these on the next advisor sweep):**
- `planar_data` / `planar_history` / `planar_suggestions` **anon INSERT/UPDATE policies are flagged by
  the linter but DELIBERATE** — the standalone scheduler page (`public/sequence/index.html`) saves
  signed-out by design. The protection layers are already in place: every save also snapshots to
  `planar_history` (so an overwrite is recoverable), and **anon DELETE is blocked by policy**. Do NOT
  "fix" these policies without doing the scheduler-auth work above first — a naive tightening breaks
  the owner's scheduler saves. (Tracked as open item **B778**.)
- The `anon/authenticated can execute SECURITY DEFINER function` warnings on the team helpers
  (`is_team_member`, `list_my_teams`, `create_team`, `claim_team_invites`, …) are the working team
  RPC surface — each is internally scoped to `auth.uid()`.
- The two `function_search_path_mutable` warnings were REAL and are fixed by
  `doc-review/db/advisor_hardening.sql` (pins `project_folders_guard_drive_cols` +
  re-applies the already-pinned `guard_team_rehome` to the live DB).
- Leaked-password protection is an Auth dashboard toggle → `OWNER-TODO.md`.

**Table schema** (one row per plan; `data` jsonb = serialized Site Model):
```sql
create table public.sites (
  id text not null, user_id uuid not null default auth.uid() references auth.users(id),
  group_id text, site text, name text, county text,
  updated_at timestamptz not null default now(), data jsonb not null,
  primary key (id) );
  -- NOTE: live PK is single-column (id) — verified against planyr-production 2026-06-23.
  -- The table was CREATED with primary key (user_id, id); db/team_sharing.sql later changed
  -- it to (id) so one row exists per project regardless of which teammate edits it. user_id
  -- is KEPT as the creator/owner column and is the RLS predicate (never part of the PK now).
  -- Upserts must therefore target onConflict "id" (with a "user_id,id" fallback only for a
  -- not-yet-migrated DB) — never "user_id,id" alone, which 42P10s on the live schema.
```
**RLS (private-by-default; applied in the dashboard):**
```sql
alter table public.sites enable row level security;
create policy "Users select own sites" on public.sites for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own sites" on public.sites for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own sites" on public.sites for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own sites" on public.sites for delete to authenticated using ((select auth.uid()) = user_id);
```
No anon policy, no admin/cross-user policy (deferred by decision).

**User profiles (`lib/profile.js`, `shared/profile/useProfile.js`, `db/profiles.sql`; B297/B298).**
Names captured at signup live in a queryable `public.profiles` table (one row per
`auth.uid()`) — NOT just auth `user_metadata` — so they're the scalable foundation for the
B2B direction (org/role/prefs later). `signUp` still seeds `options.data` (first/last/org);
a **`handle_new_user` SECURITY DEFINER trigger** on `auth.users insert` copies those into
`profiles` (trigger route avoids the client follow-up-insert race), and a one-time backfill
seeds rows for pre-existing users. RLS is the same own-row private-by-default shape as
`public.sites` (`auth.uid() = id`; select/insert/update; no delete — `on delete cascade`).
`profile.js` = pure I/O (`loadProfile`/`saveProfile`, reuses the anon client + session, no
new keys); `useProfile(user)` = the hook → `{ profile, loading, displayName, firstName, org,
initial, reload, save }` with a never-blank display chain (First Last → first → last →
metadata → email; pure `displayNameFor`/`firstNameFor`/`initialFor`, unit-tested). The Shell
pill reads it and opens an account dropdown (`AnchoredMenu` portal); `AuthPanel` is a tabbed
Profile/Settings panel (Profile edits name/org → `profiles`; Settings hosts Change password,
reusing `updatePassword`). Run `db/profiles.sql` once in the SQL editor (idempotent).
```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text, last_name text, org text,
  updated_at timestamptz not null default now() );
-- RLS: 3 own-row policies (select/insert/update) keyed on auth.uid() = id.
-- Trigger handle_new_user() inserts the row from raw_user_meta_data on signup; + backfill.
```

## Document Review persistence (`src/workspaces/doc-review/lib/reviewStore.js`, `usePersistence.js`)
Reuses the SAME Supabase client/session (imports `site-planner/lib/supabase.js` +
`auth.js`); no second client/keys. A "review" is `kind:'single'|'stitch'`; the work
layer (markups, calibration, stitch transforms, measures, takeoff, source-file refs)
is the `data` jsonb. Source-file BYTES live in Google Drive via the CHUNKED same-origin
upload (B409 rework: `src/shared/files/chunkedUpload.js` → `/api/uploads/*` → a Drive
resumable session persisted in `public.upload_sessions`; ANY size, resume + progress);
reads stream through `GET /api/files` with Range→206 (`driveStreamSource` + URL-source
`loadPdf` for >50 MB PDFs). The old private `doc-review-files` Supabase bucket
(`<uid>/<reviewId>/<srcId>.pdf`, 50 MB cap) is READ-BACK ONLY for pre-cutover files —
its upload fallback was removed; `oversize`/`too-large` states classify legacy records.
`reviewStore.js` = I/O (upsert/load/list/delete + upload/download + the localStorage
mirror); `usePersistence.js` = the data-loss hook (debounced first-edit save, honest
badge, synchronous mirror + beforeunload/visibility/unmount flush). Reload re-fetches
PDFs and re-applies transforms/markups. Full migration (table + RLS + bucket + Storage
policies) in `doc-review/db/doc_reviews.sql`; the upload-session table is
`server/storage/db/upload_sessions.sql`.
```sql
create table public.doc_reviews (
  id text not null, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text, kind text, project text, discipline text,
  updated_at timestamptz not null default now(), data jsonb not null,
  primary key (id) );
-- NOTE: live PK is single-column (id) — same story as public.sites: CREATEd with
-- primary key (user_id, id), migrated to (id) by db/team_sharing.sql (verified against
-- planyr-production 2026-06-23). user_id stays the owner column + RLS predicate; upserts
-- target onConflict "id" (with a "user_id,id" fallback only for a not-yet-migrated DB).
-- RLS: same 4 own-rows policies as public.sites (private by default).
-- Storage bucket 'doc-review-files' (private, 50 MB cap; READ-BACK ONLY since the B409
-- rework — new uploads go chunked to Drive): 4 own-folder policies on
-- storage.objects keyed by (storage.foldername(name))[1] = auth.uid()::text.
```
**Project library (B14):** `reviewStore.js` also has `listProjects` (Site groups +
status from `sites`), `setProjectStatus` (writes back via the Site Planner's
`cloudUpsert`), and `fileNewReview` (drag-drop filing); `components/ProjectLibrary.jsx`
is the explorer drawer; `components/ReviewsBar.jsx` does the project/discipline/item/
revision/date filing UI + the `"<Project> - <Item> - YYYY.MM.DD"` default name. Index
columns `project_id/item/revision/doc_date` + object paths `<uid>/project-<id>/
<discipline>/<srcId>.pdf` come from `doc-review/db/project_library.sql` (additive;
`upsert`/`list` degrade to the core columns until it's run). Lifecycle status is reused
from the Site Model, never duplicated.

## Counties / GIS plumbing
`lib/counties.js` — county presets (Harris/Fort Bend/Chambers) + `JURISDICTION_LAYERS`
+ State Plane EPSG:2278. `lib/arcgis.js` — ArcGIS REST client, `feetToLatLng` /
`lngLatRingToFeet` (FT_PER_DEG_LAT = 365223, Mercator-sphere base), aerial export.
County/city GIS hosts move and stop often — rely on the probe + honest error
surfacing, never hardcode-and-assume.

---
