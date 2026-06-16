# Planyr — UI Audit

A screen-by-screen, element-by-element UI review of **Planyr** (product: Planyr;
modules: **Site Planyr** + **Document Review**). This file is the UI workstream's
working record: each finding is `element → recommended fix`, with a status marker
and cross-references to `BACKLOG.md` (`B#`) where one exists.

> **Provenance note (read this first).** A predecessor audit ("58 element findings
> on the three currently-visible screens") was produced in a parallel chat and used
> as the brief for this pass, but it was **never committed to this repo**, so it
> could not be extended directly. This file was therefore re-authored from a fresh
> audit of the code at HEAD plus headless screenshots (see *Method*). Several of the
> brief's findings turned out to be **already implemented** on `main` (the parallel
> audit was partly stale) — those are marked `✓ already OK` with the evidence, so
> we don't "fix" what's done. The brief's letter/number IDs (H2, C1, D5, D4, D10,
> D11, D13, E2, G1–G3, B6–B8) are preserved on the matching findings below so its
> cross-references still resolve.

## Status legend
- `✅ FIXED` — changed in this UI pass (commit referenced).
- `✓ OK` — already implemented / acceptable; verified, no change needed.
- `🔲 OPEN` — recommended, not yet done.
- `⏸ DEFER` — real but intentionally deferred (reason given); larger or ambiguous.

## Method
- Built the app (`vite build`) and drove a headless Chromium (Playwright) over
  `vite preview`. Harness: `ui-audit/capture.mjs`; shots in `ui-audit/screens/`.
- Auth-gated cloud views are **out of scope** (no Supabase credentials in this
  environment, per the working agreements). To exercise the planner without a
  backend, the harness seeds a representative all-element-types site into
  `localStorage` so the app boots straight into the planner (no map tiles / no
  cloud needed). Map basemap tiles are blocked by the environment network policy,
  so the map shot shows chrome only (expected; not a defect).
- Screens captured: planner (plan, each left panel, each element dropdown, File
  menu, shortcuts, Setup/legend), map finder, Document Review module, and a
  mobile-width (390px) pass.

---

## 0. Priority-fix scoreboard (this pass)

| # | Item | Brief ID | Status | Notes |
|---|------|----------|--------|-------|
| 1 | Tool-panel model + "Parcel" duplication | C1, D5 | ✅ FIXED | Right draw/split group renamed **Boundary**; left **Parcel** inspector kept (parallels Element). Model: left = views/inspectors, right = tools. |
| 2 | Element colour differentiation + colourblind cue | H2 | ✅ FIXED | Distinct hue+lightness per surface; sidewalk dot + trailer diagonal patterns; parking striping / road centreline carry their own cue. |
| 3 | Naming: Parking vs Car/Trailer Parking | D10 | ✅ FIXED | Rail tools now "Car Parking" / "Trailer Parking" to match canvas + legend. |
| 3 | Naming: Pond vs Detention Pond | D11 | ✅ FIXED | Rail tool now "Detention Pond". |
| 3 | Consolidate "Saved ✓" + "Cloud ✓" | E2 / B10 | ✅ FIXED | One header badge: Syncing / Synced ✓ / Saved ✓ (device) / Offline / Unsaved. Floating cloud diagnostic removed. |
| 4 | Pan off Shift+V → Space-drag + H | D4 | ✅ FIXED | `H` = Pan; hold **Space** = temporary hand-pan over any tool; V = Select. |
| 4 | Tooltips + disabled on undo/redo/fullscreen | B6–B8 | ✓ OK | Already present (`title`+`aria-label`+`disabled`) at SitePlanner.jsx undo/redo/fit. |
| 4 | Scale bar / zoom-to-extent / north arrow | G1–G3 | ✓ OK (planner) / 🔲 (map) | Planner already has all three; the map finder has Leaflet zoom but no scale/north (minor). |
| 4 | Standardize element-row anatomy | D13 | ⏸ DEFER | See D13 below — right-rail rows mix 1-line/2-line; safe template change, but ambiguous vs. the (missing) original spec; documented not guessed. |
| — | Dropdown z-index behind header | B16→**B66** | ✓ OK | Already fixed (B66, shipped). |
| — | White flash on zoom/pan | B15→**B65** | 🔲 OPEN | Runtime-only; partial mitigation already shipped (paper backdrop + keepBuffer); needs a live repro. Out of reach headless. |
| — | Remove legend | B18 (brief) | ⏸ DEFER (keep) | After H2 the legend is the *key* to the new colours; removing it would hurt. Kept; see H5. |
| — | Roads units / rename | B19 (brief) | ⏸ DEFER | Road tool already shows "N′ travel" + curb note; rename intent unclear without the original spec. See D-Road. |

### Brief B# → this repo reconciliation
The brief's "coordinate with" B-numbers are the **parallel chat's** provisional
numbers and collide with different real items here. Mapping:

| Brief says | Means | Real item here | State |
|---|---|---|---|
| B2 account control | shell account pill | **B2** | ✓ done |
| B3 Planyr spelling | brand rename | **B3** | ✓ done |
| B10 header consolidation | one bar + switcher | **B10** | ✓ done (substance) |
| B15 white flash | zoom/pan flash | **B65** | 🔲 open (runtime) |
| B16 dropdown z-index | switcher behind bar | **B66** | ✓ done |
| B18 remove legend | (a legend) | *new* | see H5 (keep) |
| B19 roads units/rename | road tool | *new* | see D-Road |

New UI items genuinely surfaced by this pass are filed in `BACKLOG.md` as **B93–B99**
(the completed pass is recorded as **B98**).

---

## A. App shell (global header) — `src/app/Shell.jsx`
- **A1** Product switcher (brand + current module + ▾). `✓ OK` — opens a clean
  "Planyr modules" menu (Site Planyr / Document Review), active item marked; z-index
  fixed (B66). Keyboard: `aria-haspopup`/`aria-expanded` present.
- **A2** Brand mark "Planyr" / module "Site Planyr". `✓ OK` — spelling correct (B3).
- **A3** Account control (top-right pill). `✓ OK` placement/B2 — **but** only renders
  when Supabase is configured; with cloud off there is *no* visible account/sign-in
  affordance at all. `🔲 OPEN (B95)` — show a "Sign in" entry point (or an explicit
  "cloud off" hint) even when unconfigured, so the door isn't simply missing.
- **A4** Two stacked bars persist (shell bar + the workspace's own header row).
  `⏸ DEFER` — B10 deliberately left a single *physical* row as later polish; the
  dedup + switcher (the substance) are done.

## B. Planner header / context bar — `SitePlanner.jsx`
- **B1** Breadcrumb `‹ Map › Site ▾ › Plan ▾`. `✓ OK` — reads as a hierarchy;
  rename inputs inline.
- **B2** Site `▾` / Plan `▾` menus. `✓ OK` — switch/rename/new/duplicate present.
- **B6** Undo `↶`. `✓ OK` — `title="Undo (Ctrl+Z)"`, `aria-label`, `disabled` when
  history empty. (Brief asked to add these; already present.)
- **B7** Redo `↷`. `✓ OK` — `title="Redo (Ctrl+Shift+Z)"`, `aria-label`, `disabled`.
- **B8** Zoom-to-fit `⤢` (the brief's "fullscreen"). `✓ OK` — `title="Zoom to fit"`,
  `aria-label`, `disabled` when nothing to frame. Note: this is *fit*, not OS
  fullscreen; there is no fullscreen toggle (none needed).
- **B9** Snap pill (`Snap 10′` + green dot). `✓ OK` — toggles snap; state legible.
- **E2** Save/sync badge. `✅ FIXED` — was a bare "Saved ✓"; now a single pill with
  a status dot: Syncing… / Synced ✓ / Saved ✓ (this device) / Offline / Unsaved,
  each with a tooltip. Replaces the old separate floating "Cloud ✓/off/err" pill.
- **B11** `File ▾` (Export JSON / Import JSON / Export PNG / Print / Title reader).
  `✓ OK` — grouped under one menu. `🔲 minor (B96)` — items lack icons/dividers
  consistency and there's no tooltip on destructive-ish actions; low priority.

## C. Tool-panel model
- **C1** *Model.* `✅ FIXED` — settled as **left rail = views/inspectors**
  (Element, Parcel, Yield, Aerial, Overlay, Setup) and **right rail = tools**
  (Select, Pan, Boundary, Site elements, Shapes, Measure, Annotate). This matches
  the actual layout once the duplicate name is removed (see D5).

## D. Right tool rail — `SitePlanner.jsx`
- **D1** Select (V). `✓ OK`.
- **D4** Pan. `✅ FIXED` — was `Shift+V`; now `H` + hold-**Space** temporary pan
  (Figma/PS convention) with a grab/grabbing cursor; V always selects. Rail badge,
  hints, and the shortcuts panel updated.
- **D5** "Parcel" duplication. `✅ FIXED` — the word appeared on **both** rails
  (left inspector tab AND right draw/split group). Right group renamed **Boundary**
  (menu still "Draw new parcel / Split a parcel"); left **Parcel** inspector kept.
- **D6** Site-elements group: Building, Paving, Road, Car Parking, Trailer Parking,
  Detention Pond. `✓ OK` (post-fix).
- **D10** "Parking" → **Car Parking**. `✅ FIXED` — matches canvas label, legend,
  Properties. With two parking types, bare "Parking" was ambiguous.
- **D11** "Pond" → **Detention Pond**; "Trailer" → **Trailer Parking**. `✅ FIXED`.
- **D13** Element-row anatomy. `⏸ DEFER` — rows are inconsistent: Building / Road /
  Car Parking are 2-line (label + sub-label) with a `▾` preset menu; Paving /
  Trailer Parking / Detention Pond are 1-line with no menu. Recommend a uniform row
  template (consistent height + a sub-label slot, `▾` only where presets exist).
  Deferred: the exact target spec from the original audit wasn't available and the
  change is cosmetic-with-regression-risk; filed as **B93** to do deliberately.
- **D-Shapes** Line/Rectangle/Ellipse/Polygon/Polyline (L/R/E/⇧P/⇧N). `✓ OK` —
  shortcut badges shown.
- **D-Measure** Measure (`▾` Line/Polyline/Area). `✓ OK`.
- **D-Annotate** Callout (Q) / Text (T). `✓ OK`.
- **D-Road** Road `▾` shows "N′ travel" sub-label; hint notes "6″ curb each side
  (24′ road = 25′ wide)". `🔲 OPEN (B94)` — the **width preset menu** lists bare
  numbers ("24′ wide — drag the length") while the sub-label says "travel"; unify
  the wording to "N′ travel" everywhere and confirm the displayed-vs-curb units
  read consistently (the parallel "B19 roads units" item).

## E. Left panel rail + panels — `SitePlanner.jsx`
- **E1** Rail tabs: Element ✎ / Parcel ⬡ / Yield ∑ / Aerial ◳ / Overlay ▦ /
  Setup ⚙. `✓ OK` — toggle one panel; active tab marked with an ember bar.
- **E-Element** (props). `✓ OK` — type, dimensions, per-element colour overrides,
  Set-as-default / Reset, pond detention readout for ponds. Empty-state hint when
  nothing selected.
- **E-Parcel** (inspector). `✓ OK` (post-D5) — Parcels·N list (click to select),
  Merge parcels, Identify parcel + appraisal data. Empty-state now points at the
  **Boundary** tool.
- **E-Yield** (∑). `✓ OK` — three stat cards (Site / Building / Coverage) + a clean
  two-column metric list (Site area, Building, FAR, Car stalls + ratio, Trailer
  stalls, Impervious, Detention, Detention %, Open/green). Good row anatomy
  (contrast with D13's tool rows).
- **E-Aerial** (◳). `✓ OK` — load screenshot underlay, show/hide, calibrate.
- **E-Overlay** (▦). `✓ OK` — sheet-overlay (PDF/image) add + per-overlay transform
  controls (B72/B73 work).
- **E-Setup** (⚙). `✓ OK` — Site defaults (grid/snap/setback), Parking, Trailers,
  Roads sections + Element default colours editor + the legend.

## F. Planner canvas chrome
- **F1 / G1** Graphic scale bar (alternating segments, bottom-right). `✓ OK` —
  already present and live (brief's G1 already done).
- **F2 / G3** North arrow (bottom-left). `✓ OK` — already present (G3 done).
- **F3 / G2** Zoom controls `＋ － ⤢` (⤢ = zoom-to-fit/extent). `✓ OK` — present;
  fit also in the header (B8). (G2 done.)
- **F4** Calibration/accuracy badge (bottom-left): "● True scale · drawn in feet" /
  "Scaled · county GIS" / "Not calibrated (click to calibrate)". `✓ OK` — honest,
  colour-coded, actionable.
- **F5** Status bar (cursor ft, px/ft, contextual hint, site acreage, `?` help).
  `✓ OK`.
- **F6** Layers control (top-right) + Evidence tools. `✓ OK` — shared with the map;
  per-layer status; roadmap items disabled with a tooltip.
- **F7** Empty-state card ("Start your site" 1/2/3). `✓ OK` (post-fix) — step 3 now
  references the **Boundary** tool.

## G. Element rendering / colour / legend
- **H2** Surface colour differentiation. `✅ FIXED` — the five paved greys (paving,
  car parking, trailer, sidewalk, road) were near-identical; now distinct by hue +
  lightness with colourblind-safe textures (sidewalk dot grid, trailer diagonal),
  while parking striping / road centreline / pond water / landscape hatch / building
  poché carry their own cues. See `planner-plan.png`.
- **H3** Selection chrome (accent outline, handles). `✓ OK`.
- **H4** Canvas element labels use canonical names ("Car Parking", "Detention
  Pond"). `✓ OK` — and now consistent with the rail (D10/D11).
- **H5** Legend (Setup → Element default colours). `⏸ DEFER (keep)` — the brief's
  "remove legend" would remove the key to the new H2 palette; kept. `🔲 minor` — the
  legend swatch is colour-only; could overlay the pattern so the colourblind cue is
  also in the key (filed **B97**).

## H. Element config dropdowns
- **D-Building** Dock layout `▾` (Single-load / Cross-dock / No docks). `✓ OK`.
- **D-Parking** Car Parking presets `▾` (Free draw / Single row / Double row, with
  computed depths). `✓ OK` (label now "Car Parking").
- **D-Road** Road width `▾` — see D-Road above (`🔲 B94`).
- **D-Measure** Measure modes `▾`. `✓ OK`.
- **D-Boundary** Boundary `▾` (Draw new parcel / Split a parcel + Merge/Reshape
  help). `✓ OK` (post-D5).

## I. Modals & overlays
- **I1** Keyboard & gestures panel (`?`). `✓ OK` — now lists `H` Pan + `Space-drag`
  (updated for D4).
- **I2** Title reader / metes-and-bounds modal. `✓ OK` (not deeply re-audited).
- **I3** Print-frame mode (Letter/Tabloid, Landscape/Portrait, draggable crop).
  `✓ OK`.
- **I4** Cloud-error / loading banners (app level). `✓ OK`.

## J. Map / portfolio finder — `MapFinder.jsx`
- **J1** Header: brand, "Find a site" search + Go, "Start blank". `✓ OK` (B12 rename).
- **J2** Leaflet zoom `＋ －` (top-left). `✓ OK`. `🔲 OPEN (B96)` — no scale bar /
  north / zoom-to-all-sites on the map (the planner has them); add a Leaflet scale
  control + a "frame all sites" button. Minor.
- **J3** Layers panel (Imagery picker, Labels, FEMA, Wetlands, Pipelines, Wells,
  Power, Hydrants, Mapillary, Transmission, COH hydrants). `✓ OK`.
- **J4** "+ Select parcels" CTA (bottom-center). `🔲 OPEN (B96)` — the instruction
  card bottom-left says the button is "(top-right)" but it renders bottom-center; fix
  the copy or the position to agree.
- **J5** Saved-site markers + status legend/filters/pipeline counts. `✓ OK` (B7/B8) —
  not re-exercised here (needs saved located sites).

## K. Document Review module — `DocReview.jsx` / `Stitcher.jsx`
Captured the empty state (`doc-review.png`); the measure/markup/takeoff toolset only
renders with a PDF loaded (can't seed a PDF headless), so those are audited from code.
- **K1** Toolbar: Open PDF… / Stitch sheets ▸ / 📁 Library / "Not saved" / Reviews ▾.
  `✓ OK` — clear empty state ("Open or drop a construction PDF…").
- **K2** Its own "Not saved" badge is separate from the planner's. `🔲 minor (B96)` —
  for cross-module consistency, align it visually with the planner's unified save pill
  (dot + state word). Low priority.
- **K3** Measure / quantity takeoff / redline / overlay-compare / stitcher / page
  nav / thumbnails / properties. `✓ (code)` — present per code + prior backlog
  (B33/B34/B39–B45/B51/B52 hardening). Recommend a follow-up screenshot pass with a
  sample PDF when one is available.

## L. Responsive / mobile (390px) — `planner-mobile.png`
- **L1** `🔲 OPEN (B99)` — the planner is **not responsive**: the fixed
  168px right rail + the left rail/panel consume most of the width, squeezing the
  canvas to a sliver; the header wraps. The app is effectively desktop-only. Recommend
  a mobile treatment (collapsible rails / off-canvas panels / a bottom toolbar) — a
  larger effort; flagged for the roadmap, not this pass.

## M. Cross-cutting
- **M1** Focus-visible / keyboard nav across the rails. `🔲 minor` — buttons are
  reachable but focus rings are faint on dark chrome; audit a consistent focus style.
- **M2** Colour contrast of muted chrome text (`chromeMuted` on dark). `🔲 minor` —
  some sub-labels are low-contrast; verify against WCAG AA.
- **M3** `aria-label`s exist on icon-only controls (zoom, undo/redo, help). `✓ OK`.
