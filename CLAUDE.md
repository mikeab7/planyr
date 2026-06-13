# CLAUDE.md — handoff note

Concise orientation for a fresh session. Skim this first.

## 1. What this is
**Planar_Fit** — a browser-based, TestFit-style **industrial site planner** for the
Houston metro (Harris, Fort Bend, Chambers counties). Two surfaces:
- **Map finder** — aerial map; find/select parcel(s) from county GIS, then "Plan".
- **Planner** — a feet-based SVG canvas to lay out buildings, car parking,
  trailer storage, paving, and detention ponds, with live site-yield metrics
  (coverage, FAR, impervious %, stall counts, etc.). Plans on the real aerial.

Live site (GitHub Pages, builds from `main`): https://mikeab7.github.io/Planar_Fit/

## 2. Stack & structure
Vite + React 18, plain JS/JSX, inline styles. No backend — 100% client-side.
Map = Leaflet + esri-leaflet. Planner canvas = hand-rolled SVG. Persistence =
localStorage.

- `src/main.jsx` → `src/App.jsx` — toggles MapFinder ↔ SitePlanner, holds the
  parcel hand-off, resumes into the planner if autosave has work.
- `src/MapFinder.jsx` — Leaflet map: Esri/USGS aerial basemaps, faint labels
  toggle, "Select parcels" mode (＋/− cursors), click a lot (arcgis query),
  assemble several, capture the aerial export, hand a payload to the planner.
- `src/SitePlanner.jsx` — the big one (~1500 lines). FEET-based SVG canvas,
  tools, rect/polygon elements, parcels, aerial underlay + scale calibration,
  metrics, undo/redo, autosave, named scenarios.
- `src/lib/arcgis.js` — minimal ArcGIS REST client: layer metadata, queries,
  point-intersect query, geometry→feet, aerial-export placement.
- `src/lib/counties.js` — county endpoint presets (lookup + map) + field
  auto-detect. State Plane EPSG:2278 (TX South Central, US ft).
- `src/lib/storage.js` — scenarios + `loadAutosave`/`saveAutosave`.
- `src/lib/image.js` — screenshot loader/downscale (for the underlay path).
- `.github/workflows/deploy.yml` — build + deploy to Pages (deploy gated to `main`).

## 3. Run & build
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
npm run preview
```

## 4. Key decisions & non-obvious workarounds
- **Everything internal is FEET.** Map lat/long → local feet via an
  equirectangular projection about a shared origin (`FT_PER_DEG_LAT` constant,
  `ftPerDegLon(lat)=…*cos(lat)`). Conversions live in `arcgis.js`.
- **Aerial underlay** is exported from Esri `World_Imagery/MapServer/export` in
  **EPSG:4326, sized to the *degree* aspect** (so the server returns exactly the
  requested bbox), then stretched into the true-feet rectangle with **separate
  `ftPerPx` (x) and `ftPerPxY` (y)**. This fixed a vertical-stretch misalignment.
  The planner **always captures from Esri** even if the map shows USGS — USGS
  tiles render but its `export` op returns no image.
- **Parcel outlines** use an esri-leaflet **`featureLayer`** (vector, the working
  query path), not `dynamicMapLayer` (server image — it silently failed to
  render). Outlines are `interactive:false` so the map receives the click;
  selection uses `queryAtPoint` (point-intersect), which works at any zoom.
  Visible outlines need ~zoom 16 (too many parcels otherwise).
- **GitHub Pages:** vite `base: "./"` (relative) so it works under the
  `/Planar_Fit/` subpath; deploy is gated to `main` (the `github-pages`
  environment rejects non-default branches); repo is **public** (free-plan Pages
  needs it). Pages deploys occasionally fail transiently — just re-run the job.
- **Undo/redo** = snapshot-by-reference history kept in refs; the dedupe key
  excludes the underlay `src` (a screenshot dataURL can be huge).
- **Elements are either rectangles** `{cx,cy,w,h,rot}` **or polygons**
  `{points,…}`. Rectangles get exact stall striping; polygons get area-based
  estimates.

## 4b. Map-layer system (shared by both pages)
- One source of truth: `src/lib/layers.js` (`STATEWIDE`, `EVIDENCE`, jurisdiction
  flattening, `defaultOverlayState`, `syncOverlayLayers`) + `src/components/
  LayerPanel.jsx` (toggle/opacity UI). **Both** MapFinder and SitePlanner consume
  these, so a layer added once appears on both surfaces.
- Layer `kind`s: `dynamic` (esri `dynamicMapLayer` image overlay — FEMA, NWI,
  TxRRC, jurisdiction utilities, COH hydrants), `esriImage` (esri `imageMapLayer`
  ImageServer — USGS 3DEP elevation/hillshade), `esriFeature` (vector
  `featureLayer` — HIFLD transmission from US DOE/NETL, crisp + attribute-rich,
  non-interactive so it never steals parcel clicks), `overpass` and `mapillary`
  (live, view-driven vector layers in `src/lib/evidenceLayers.js`).
- **Site-engineering toolset (planner Layers control → Evidence tools):** electric
  & water service routing (shared engine: `buildUtilRoute` → `utilRoute` markup
  with easement corridor + fitting pad + overlap constraint), pond **detention
  calculator** (`detentionStorage`, 3:1 taper, prismoidal volume) in the pond
  inspector, **easement-rule table** (`lib/easementRules.js`, editable, VERIFY
  placeholders), and the **ditch cross-section** tool (`lib/elevation.js` samples
  3DEP `getSamples`) which can feed `el.det.availDepth` into detention. All
  elevation output is labeled "screening only — verify with survey."
- **Planner is geographic** (Phase 1): a non-interactive Leaflet Web-Mercator
  basemap + the shared overlays sit *behind* the (transparent) feet-based SVG,
  anchored to the site `origin`. Geometry/metrics stay in feet (projection-
  independent); `ppfToZoom` + canvas-centre→latlng lock the basemap to the view.
  Feet↔deg uses the Mercator sphere base (≈365223 ft/deg, both axes) so drawn
  geometry overlays the aerial with sub-pixel error.
- **Mapillary token is a secret** — read from `import.meta.env.VITE_MAPILLARY_TOKEN`
  (set as a GitHub Actions/CI secret at build) or a user-entered localStorage
  value. **Never commit a token.** Same rule as the title-reader Anthropic key.
- Known caveat: Print/PNG export clones the SVG and can't capture the live Leaflet
  basemap/overlay tiles (cross-origin canvas). With the basemap off, the captured
  screenshot underlay still prints.

## Site Model — the ONE source of truth (`src/lib/siteModel.js`)
Every site/plan is the canonical **Site Model**. All site data lives here; read it
via the selectors, persist it via storage — never invent a parallel store.

**Schema** (`createSiteModel`, `SITE_MODEL_VERSION = 2`). Persisted fields stay
flat + back-compatible (Option A — no field renames), with additive buckets:
```
{ schemaVersion,
  id, groupId, site, name, updatedAt,        // identity
  origin:{lat,lon}|null, county,             // geo anchor + jurisdiction
  parcels[], underlay, settings,             // inputs
  els[],                                      // drawn layout elements
  markups[],                                  // flat: neutral annotations + semantic shapes
  measures[], callouts[],                     // annotations
  elevation:{ crossSections[] },             // elevation references (newly persisted)
  constraints:{ liveLayers[] } }             // RESERVED: per-site layer memory (not yet wired)
```
`els` and `markups` stay flat (splitting them physically is a deferred canvas
rewrite); **selectors classify them by meaning** instead:
- `constraintsOf(m)` → `{ easements (markup kind `encumbrance`), setbacks (derived
  from parcels), liveLayers }`
- `utilitiesOf(m)` → markup kinds `utilRoute | traced | infwater`
- `annotationsOf(m)` → `{ markups (line/rect/ellipse/polygon/polyline), measures, callouts }`
- `crossSectionsOf(m)`, `setbacksOf(m)`, `parcelsOf`, `elementsOf`
- `developableArea(m)` — **stub**; the future buildable-area/cost synthesis reads
  the whole model from here.

**Persistence** (`storage.js` is a thin layer over the model): `loadSite` /
`loadSitesList` migrate on read; `saveSite` merges the partial onto the existing
record and re-normalizes through `createSiteModel`. Migration is **additive,
lossless, idempotent** — old saved sites upgrade automatically.

**Layer/overlay state is app-shared, NOT per-site** (yet): one `overlays` object
lives in `App.jsx` and is passed to both pages, so a toggle on one page shows on
the other. `constraints.liveLayers` is the reserved slot for future per-site memory.

**Conformance rule for future sessions:** add new site data as new model fields
(additive), bump `SITE_MODEL_VERSION`, extend `migrate`, and expose it via a
selector. The planner still keeps in-component `useState` for live editing and
serializes to the model at the save boundary (collapsing that into a single
reducer is a deferred, separate task).

## 5. Known limitations / roadmap
- **AI corridor scan (roadmap — NOT built; disabled placeholder only).** Intended:
  draw a ≤2 sq-mi box, fetch public-domain NAIP aerial tiles for it, send tiles to
  the Claude API vision model to flag pole/hydrant candidates, then georeference
  hits back onto the plan as confirm/reject pins. **Requirements when built:** show
  the tile count + estimated API cost *before* running (explicit confirm), and read
  the Claude API key from env/secrets or user input — never commit it (same rule as
  the title reader). There is a disabled, labeled "🛰 AI corridor scan — coming
  soon" button in the planner Layers control; wire it here.
- Polygon elements: vertex editing **is** supported (drag a dot, ＋ on an edge
  adds a corner, Shift-click deletes — same as parcels), but striping is **not
  clipped** to the polygon (counts are area-based estimates).
- Parcel setback is a simple inward offset (good for convex/mildly-concave lots).
- Single-story FAR assumption.
- Counties limited to Harris / Fort Bend / **Chambers (endpoint is provisional)**.
- Imagery is free **keyless** only (Esri/USGS); a paid source (Nearmap/Vexcel/
  Google) could be added as a 3rd "Imagery" option — would need an API key.
- Autosave is **per-browser/device**; no cloud sync (named scenarios + Export
  JSON are the portable options).
- Nice-to-haves: polygon vertex edit, true striping in polygons, more counties,
  DXF/PDF export.

## 6. Conventions for future sessions
- **Develop on `main` and push to deploy** — the user authorized straight-to-live.
  A stale branch `claude/clever-babbage-vj59nr` exists; ignore it — `main` is the
  source of truth.
- Always `npm run build` before pushing; after each push, the Pages deploy runs
  (gated to `main`). If a deploy fails transiently, re-run it.
- **Units:** feet everywhere internal; convert only at the map boundary.
- Match the existing style: compact code, inline styles, the `PAL` drafting
  palette, terse comments.
- **Secrets: never commit API keys or secrets to the repo.** They belong in
  environment variables or a secrets store. Keep `.env*` in `.gitignore`. The app
  currently uses only keyless public endpoints; if a paid imagery/geocoding key
  is ever added, read it from an env var / runtime config — do not hardcode or
  commit it.
- End commit messages with the session link the harness provides.
