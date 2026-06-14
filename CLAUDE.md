# CLAUDE.md — Planyr Project Handoff

Complete handoff for any future session. Read top to bottom to orient. This merges
two tracks of work: the mature **Site Planner** (basemap, GIS layers, Supabase
backend) and the newly-started **Document Review** module (foundation just
scaffolded). Last updated mid-2026.

> **📋 `BACKLOG.md` is the single source of truth for open bugs & feature requests.**
> On every run, check `BACKLOG.md`: work the items under **🔲 Open**, skip those under
> **✅ Done**. (This is the product bug/feature backlog — distinct from the
> "Deferred / maintenance backlog" section near the end of this file, which tracks
> ops/infra cleanup.)

## What Planyr is
A proprietary, TestFit-style web app for industrial real estate site work, built by
Michael (industrial developer, Dallas/Houston). It is becoming a multi-workspace
suite: the existing **Site Planner** (site yield analysis and layout) plus a new
Bluebeam-style **Document Review** workspace for reviewing construction drawings and
surveys.

The two workspaces are **one product, not two apps.** They share a single
real-world coordinate system, so work flows between them (a parsed deed lands on the
planner's map; an engineer's drawing overlays the planner's layout).

## Architecture
- **One product, multiple workspaces.** Each workspace is its own folder/module. The
  app shell switches between them; you do not run two separate apps.
- **Lazy-loaded workspaces.** A workspace's code loads only when opened, so Document
  Review never slows the Site Planner. (Verified: `SitePlannerApp` and `DocReview`
  are separate lazy chunks.)
- **Shared coordinate spine.** One real-world coordinate system underpins everything:
  **EPSG:2278 — NAD83 / Texas State Plane, South Central zone, US survey feet**
  (correct for the Houston/Katy area). This is what lets a deed polygon, an overlay,
  and the site layout all live in the same space. Currently a stub in
  `src/shared/coordinates/`, not yet wired in.
- **Document Review layer model.** The imported drawing is an **immutable backdrop**
  (a fixed background, never altered). The user's measurements, markups, test-fit
  massing, and parsed polygons live on **editable layers stacked over it.** "Editing
  CAD" here means building your own analysis layer over the engineer's drawing —
  never altering or writing back their geometry.
- **Heavy work off the main thread.** CAD/PDF parsing and large geometry ops belong
  in **Web Workers** (background threads) so the UI never freezes.
- **Monorepo.** One repository (`planyr`), a folder per workspace, plus a
  walled-off `/server`. Repo count buys nothing on performance; isolation comes from
  module boundaries + lazy-loading inside the one repo.

## Repository layout (after the foundation restructure)
```
src/
  main.jsx                # renders the shell
  index.css               # global styles
  app/
    Shell.jsx             # shell: lazy-loading workspace registry + header switcher
  workspaces/
    site-planner/         # all existing Site Planner code (moved here, history preserved)
      SitePlannerApp.jsx  # was App.jsx
      MapFinder.jsx, SitePlanner.jsx, components/, lib/
    doc-review/
      DocReview.jsx       # "Document Review (coming soon)" placeholder
  shared/
    coordinates/          # project-grid stub (EPSG:2278); minimal interface; not yet wired
server/                   # placeholder README only — NOT built or deployed; backend + secrets later
```
- Build command: `npm run build` → output `dist/`. Dev: `npm run dev`.
- `vite.config` has `base: "./"` (for the GitHub Pages subpath); works unchanged at a
  domain root too.

## Workflow & deploy
- **Branch per workstream; `main` is the protected, always-working, deployed line.
  No direct commits to `main` from here on.**
- Branch naming: `doc-review/<feature>`, `site-planner/<feature>`. Branch from the
  latest `main`; merge the latest `main` back into long-lived branches as you go.
- **Merge often** — the longer a branch drifts, the larger the eventual merge
  conflict. Per-workspace work in separate folders rarely conflicts; keep edits to
  genuinely shared files (the coordinate module, the shell) small.
- **Land work via pull requests; require a passing build check to merge.** The GitHub
  Actions workflow runs the build on every PR (a green "it builds" check) and on
  pushes to `main`; the deploy job is gated to `main` only.
- **Deploy = GitHub Pages (production).** Because the suite is one app with an in-app
  workspace switcher, "seeing both live" is one URL — you switch tabs inside it.
- **Cloudflare Pages is optional and deferred.** Its only job is per-branch preview
  URLs (seeing an unmerged branch live without merging to `main`). Not required to
  build or to see both workspaces. (Don't conflate this with PR status checks, which
  are a separate GitHub Actions concern.)
- End commit messages with the session link the harness provides. Don't include the
  model identifier in commits/PRs/code.

## DONE & VERIFIED
### Site Planner (mature)
- Geographic basemap refactor.
- Shared layer state across the planner.
- Site-model schema, migration, and selectors.
- New-site data-loss fix: first-edit persistence, an honest save badge, and a
  `beforeunload` flush so in-progress work isn't lost on tab close.
- Layer-status fixes: error-body parsing, per-layer status dots, no zero-size
  exports, wetlands consolidated to a single host, ~45s self-heal re-probe.
- Houston water/wastewater/storm pointed at the City's `geogimstest` host, using
  `layers=show:<sublayer IDs>` to paint the mains/pipes.

### Supabase backend (built, Phases 1–4)
- Phase 1 — connection to a cloud Postgres database.
- Phase 2 — email/password auth.
- Phase 3 — row-level security: each user's sites are private by default.
- Phase 4 — cloud save/load: logged-in users' data lives in the cloud and syncs
  across devices. No migration of old browser-stored sites (few enough to recreate
  by hand — intentional).

### Multi-workspace foundation (new)
- Monorepo restructure landed via **PR #3** (the new clean `main`): the shell, the
  workspace folders, the coordinate stub, and the `/server` placeholder, with the
  Site Planner moved in and functioning exactly as before, no behavior change. Build
  passes; the workspace split is real (separate lazy chunks).

## KEY DECISIONS (must persist)
- **Private by default.** Any future sharing or shared workspaces default to private;
  sharing is always a deliberate, explicit act — never automatic.
- **No admin / cross-user data access.** Deliberately omitted, for customer trust and
  liability. Do not add a "god-mode" admin view.
- **Secrets stay in env/secrets, never committed.** Covers Supabase keys, the Autodesk
  APS key, and Google Drive credentials. The Supabase **anon key is RLS-protected and
  safe to ship in the client**; the Supabase **service_role key and all third-party
  API keys must stay server-side only** and never reach the browser.
- **Logged-in users' data lives in the cloud.**
- **Monorepo, one repo, folder per workspace.** The `/server` folder's secrets and
  deploy pipeline are walled off from the public GitHub Pages deploy, so no
  credential can ride along to a live URL.
- **DWG handling (Document Review):** Michael normally receives DWG (and PDF) and will
  not ask consultants for DXF. The tool auto-converts DWG → DXF on the backend. Start
  with free **LibreDWG** + a hard-failure fallback to **Autodesk APS Model Derivative**
  (~$0.30/file, pay-as-you-go). Optional later verification layer (proxy-object
  pre-screen, header/extents sanity checks, embedded-preview diff) decides when to
  pay. Reserve **ODA** (~$6k first yr / $3.6k/yr) or **Apryse** (~$10k+/yr) only for
  high volume or to keep files off third-party clouds. (Pricing mid-2026 — re-verify.)
- **Auto-filing never auto-guesses.** Files matched confidently to one of the 4 named
  projects (via title block + aliases) are auto-routed and auto-named; no-match /
  multi-match / low-confidence files go to a "needs filing" holding area with
  one-click confirm. A misfiled drawing is worse than an unfiled one.

## DEFERRED (with reasons — waiting creates no rework debt)
- Per-site sharing, shared team workspaces, and a possible commercial/SaaS direction.
  The selling question reshapes the sharing/workspace model, so design these together
  if/when selling becomes real.
- Planner single-reducer rewrite (state-management refactor) — deliberately deferred.
- AI corridor scan — parked.

## ROADMAP / NOT YET BUILT
Two parallel tracks now.

### Track 1 — Site Planner (continue maturing)
1. **GIS layer caching** — next immediate item. Stale-while-revalidate: load
   last-known-good copy instantly, refresh in background, always show data age,
   screening-only. Makes layers fast and resilient.
2. Tier 1 "site-killer" features: storm outfall, then sanitary sewer, fire flow,
   finished-floor-vs-base-flood, environmental screen (TCEQ LPST / EPA),
   entitlement/zoning status.
3. Tier 2: earthwork / cut-fill, soils.
4. Tier 3: swept-path, driveway access.
5. Tier 4: the buildable-area / cost verdict engine (reads the whole Site Model via
   `developableArea()`, currently a stub).

### Track 2 — Document Review (new module)
Build the **browser-only** tranche first (no backend, no credentials), then the
**backend** tranche.
- **Browser-only:** PDF review core (PDF.js viewer, multi-sheet nav, calibrate-to-
  scale, measure tools — distance/area/perimeter/count, basic redline, takeoff rollup
  into the yield panel) → semi-automatic match-line stitching → metes-and-bounds →
  polygon (parse calls incl. curves; flag unreadable calls; require one tie to the
  ground for the Point of Beginning).
- **Backend tranche** (needs `/server`; distinct from the existing Supabase backend):
  auto-filing + index → DWG conversion pipeline (LibreDWG → APS) → overlay & version
  compare → markup-list and flattened marked-up PDF export.
- **Auto-filing detail:** drop a file → read its title block → match against the 4
  named projects (+ aliases: address, parcel, job number) → auto-route and auto-name
  into a central drive (likely Google Drive). A lightweight index/database stores
  facts per file (project, discipline, sheet, revision, date) so files are queryable
  without re-reading them.

### Document Review — roadmap additions
- Drag-and-drop to open: drop PDF/drawing files onto the screen to load them for
  viewing (browser-only, low effort). NOTE: distinct from the auto-filing system
  (drop → read title block → file into Drive), which is the backend feature already
  on the roadmap. Two different things, two timelines.
- Multi-sheet stitcher: assisted alignment (built — `Stitcher.jsx`, 2-point pairwise
  align); automatic match-line detection later; near-automatic once DWG conversion lands.
- Revision compare: add a revision to a discipline set and compare the two
  (overlay/diff) — confirm against the existing overlay/version-compare item.
- ★ North-star: "map → drawings → latest set" — from the Site Planner map, click a
  project → Drawings → pick a discipline (e.g., Landscaping) → see the latest
  revision's full set, already stitched. Depends on the filing system + file index,
  the stitcher, and project nav on the map. The convergence point; build once those exist.

## KNOWN ISSUES
- Houston utilities ride on the City's `geogimstest` **TEST** host — works, but could
  change without notice.
- Storm-sewer service name still needs confirming once the COH services are up.
- GIS layer status: honest per-layer status + ~45s self-heal re-probe; at last note
  roughly 10 of 14 layers were live.

## Two backends — don't conflate
1. **Supabase** (built, managed BaaS): user accounts, auth, row-level security, and
   cloud save/load of site data. The client talks to Supabase directly (anon key +
   RLS); little custom server code.
2. **`/server`** (not built; coming with Document Review): custom backend for CAD
   conversion (APS), Google Drive auto-filing, and the file index database. This
   holds the third-party secrets that must stay isolated from the public Pages deploy.

So "the backend" is built for user data (Supabase) but not yet for CAD conversion and
filing (`/server`). Keep these separate when reasoning about what exists.

---

# Technical reference (preserved implementation detail)
Deeper specifics behind the summaries above. Paths reflect the monorepo layout
(`src/workspaces/site-planner/…`).

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
- **Mapillary token is a secret** — `import.meta.env.VITE_MAPILLARY_TOKEN` (CI secret)
  or a user-entered localStorage value. Never commit it.
- **Print/PNG caveat:** the SVG clone can't capture live Leaflet basemap/overlay
  tiles (cross-origin canvas). With the basemap off, the captured screenshot underlay
  still prints.

## Supabase (`src/workspaces/site-planner/lib/supabase.js`, `auth.js`, `cloudSync.js`)
Config from build-time env only (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`;
gitignored, Actions secrets — see deploy.yml). Connection test hits `/auth/v1/health`
with the apikey (the PostgREST root is secret-key-only under the new key model — a
publishable/anon key correctly 401s there). Auth = email+password via `auth.js` +
`components/AuthPanel.jsx`. Phase 4: logged in → per-user local cache
(`planarfit:sites:cloud:<uid>`) pulled on login + writes mirror to the `sites` table;
logged out → legacy `planarfit:sites:v1`. Save badge reflects the real cloud write.
No migration of legacy sites (recreate manually).

**Table schema** (one row per plan; `data` jsonb = serialized Site Model):
```sql
create table public.sites (
  id text not null, user_id uuid not null default auth.uid() references auth.users(id),
  group_id text, site text, name text, county text,
  updated_at timestamptz not null default now(), data jsonb not null,
  primary key (user_id, id) );
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

## Counties / GIS plumbing
`lib/counties.js` — county presets (Harris/Fort Bend/Chambers) + `JURISDICTION_LAYERS`
+ State Plane EPSG:2278. `lib/arcgis.js` — ArcGIS REST client, `feetToLatLng` /
`lngLatRingToFeet` (FT_PER_DEG_LAT = 365223, Mercator-sphere base), aerial export.
County/city GIS hosts move and stop often — rely on the probe + honest error
surfacing, never hardcode-and-assume.

---

# Deferred / maintenance backlog
Low-priority cleanup items captured here so they aren't lost. Nothing in this section
is urgent or blocking — the app is healthy; pick these up when convenient.

## Retire the old GitHub Pages deploy pipeline (low priority — do later)
**Status: not started.** The site is healthy; this is cleanup, not a fix.

**Background** — the repo currently has TWO things publishing on every merge to
`main`:
1. **Cloudflare Pages** — the real production host, serving planyr.io and
   [www.planyr.io](https://www.planyr.io). **KEEP THIS.**
2. **The original GitHub Actions workflow** that builds/deploys to GitHub Pages
   (the old github.io test site). It still runs on every merge (last observed run
   #155) even though it's no longer production. **RETIRE THIS.**

**Why retire it:** redundant now that Cloudflare is production. Two builds fire on
every change (wasted CI minutes, confusing logs), and it keeps a stale copy of the
app live at the old github.io address that someone could stumble onto.

**How to do it safely when picked up:**
- Cloudflare deploys via its own GitHub App / webhook connection, NOT via a workflow
  file in this repo — so disabling or deleting the GitHub Pages workflow should NOT
  affect the live planyr.io site. Verify before deleting.
- Find the workflow in `.github/workflows/` that targets GitHub Pages (look for
  `actions/deploy-pages`, `actions/upload-pages-artifact`,
  `peaceiris/actions-gh-pages`, or a `github-pages` environment).
- Reversible first: disable it (restrict its trigger to `workflow_dispatch` /
  manual-only, or rename the file so it stops running) rather than deleting.
- Confirm Cloudflare is still the only thing that deploys on the next merge.
- Once confident, delete the workflow file and optionally set Settings → Pages source
  to "None" so the old test site stops serving.

**Baseline reference:** after the repo rename, commit `b593a28` triggered a successful
Cloudflare production build serving planyr.io — so Cloudflare auto-deploy is known-good
independent of the GitHub Pages workflow.
