# COWORK-RESULT 2026-06-25 — signed-in VERIFICATION pass (two batches)

> **Claude Code: please fold these into `VERIFICATION.md`** — flip the listed ⏳→✅ (or to ◑/note) per item and set `Last checked 2026-06-25`. Filed as a result-doc instead of a direct `VERIFICATION.md` edit because `main` advanced ~hundreds of commits (B474 Stage A/B etc.) *during* this session, so a full-file edit kept clobbering your concurrent new V### entries. All checks below were run **signed-in on planyr.io in the owner's own browser** (Cowork), since this session's sandbox couldn't reach planyr.io and had no Playwright.
>
> Supersedes draft PRs **#360** and **#364** (both were full-file `VERIFICATION.md` replaces that went stale against the moving `main` — closed in favor of this doc).

Legend: **✅** confirmed live this session · **◑** partially advanced (a sub-check needs an asset a solo signed-in browser can't supply — a 2nd user / two live tabs / a full localStorage / a network outage / a fresh dropped PDF) · **⏳** attempted, not drivable this session.

## Batch 1

- **V129 ✅ (fully — archivable)** — B445 GIS imagery cache in-app render. Toggled FEMA flood zones, zoomed to street level → the NFHL raster **paints**. Network: the export requests route through the same-origin proxy `…/api/gis-cache/svc/<b64>/export` (b64 decodes to `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer`) returning **HTTP 200 image/png** — not a 302 fail-open, no direct `hazards.fema.gov` hit — plus a `&meta=1` sidecar at 200 driving the panel age badge ("just now"/"as of …"). Closes the one thing curl couldn't show.
- **V117 ✅ (core path)** — B405+B207 Library file-open. Opened **8 South** → Review → clicked the existing "8 South B2 & B3 - Final Geotech Report": the B446 "Opening…" overlay fired, then the 68-sheet PDF rendered (cover + sheet thumbnails + tool rail + Takeoff), **no banner / no blank screen**. The "opening any file fails" root cause is cleared. (Oversize-banner step 3 + Drive-row step 4 not re-run.)
- **V130 ✅ (fully)** — B439/B440 Schedule rename/delete (the owner's reported bug). In the Schedule project switcher: hovering a row reveals the ⋯ kebab; on a throwaway project, **Rename** (inline edit) updated the name in BOTH the breadcrumb and the embedded scheduler; **Delete** showed the inline "this can't be undone" confirm, removed the project, and — it being the open one — dropped to the Dashboard. Fixed live.
- **V131 ◑** — B446 open-feedback **✅ verified live** (the "Opening <name>…" overlay fires, never a silent open). B447 switch-determinism + B448 keyless-mid-upload **still ⏳** — need a 2-review project + a droppable PDF the browser session couldn't supply.

## Batch 2

- **V140 ⏳** — B475/B476 Markup switcher cold-cache divergence not driven (signed-in cold-cache-only; needs a fresh tab/device with an empty project cache; B476 is messaging-only).
- **V71 ✅** — Layers picker Relevance modes (Show all / Dim / Hide) + the "Nearby range" slider render and work.
- **V101 ✅** — Site Analysis honest source states live on Grand Port: Floodplain "Zone X · PRESENT"; Wetlands "UNAVAILABLE — couldn't reach the GIS source" (+Retry, not a false "None found"); Pipelines "PRESENT — 8 segments" from real RRC operators (Enterprise / ONEOK / Magellan); Oil & gas wells "No mapped oil & gas wells on the site · just now" (successful query, honest zero); Environmental "not connected". RRC source is live (pipelines prove it). Wells/pipelines coverage-COUNT fixtures remain the CI check.
- **V77 ◑** — the street-imagery feature is present in the planner Layers as EVIDENCE TOOLS (Infer water main from hydrants, Route electric/water service, Trace overhead electric); the Mapillary same-origin-proxy + no-token-leak network capture was NOT driven (needs tool-activate + zoom ≥16; the renderer froze under map+GIS load).
- **V73 ✅** — identity-pill dropdown shows the account name "Michael Butler", org "Hillwood", the email, and Profile / Team / Settings / Sign out (the profiles-table name, not an email fallback).
- **V103 ✅** — the app-wide CloudSyncBadge sits in Row 1 showing the quiet-green "synced" state.
- **V122 ✅** (degrade-fallback still ◑) — an edit (drew + deleted a markup in a Review) autosaved and the header read "Cloud sync: Synced"; the version-less-DB id-first fallback stays dormant on production (the `version` column exists).
- **V100 ✅ (Site↔Review) / ◑ (Schedule)** — the active project carries Site→Review via the URL hash (Grand Port → Review shows "Grand Port" + the file-browser landing with the category tree). Site→Schedule carries the id in the URL but the embedded scheduler lands on its own all-projects report (breadcrumb "Select a project"), not the carried project. The real drop→categorize round-trip (needs a dropped PDF) wasn't driven.
- **V98 ✅** — opened the live Jacintoport record: the bonded children (perimeter strip + 2 bump-outs) sit flush/parallel to the building with no visible ~1° skew (B363 holds); the building carries its 2 bump-outs. The resize-persist round-trip (B362) wasn't separately driven.
- **V70 ✅** — clicking a filed document opened it in the Review canvas on the FIRST click (B446 overlay → render; breadcrumb shows the project), via the per-project file browser. The global file-pill variant wasn't separately driven.
- **V97 ✅** — Markup header de-clutter: no "Library" button (B359), "Reviews ▾" in the tools row (B360), no cry-wolf save chip (B358); the single Row-1 cloud badge is the save indicator (per V103/B373).
- **V123 ✅** — armed Line → dragged → a Line markup committed; selecting it opened the PROPERTIES panel (color / weight / Dash / Opacity); Polyline/Polygon/Rect present in the rail. (Test markup deleted; file left clean.)
- **V124 ✅** — Polylength tool present; the Line tool exposes "Arrow toggles in Properties"; the draw round-trip works.
- **V125 ◑ / V126 ◑** — Arc/Dimension/Pen/Highlight/Eraser/Snapshot were already proven to ARM against production in V127's CI (run 28102406142); a one-tool draw round-trip (Line) is now confirmed live, but the per-tool Arc/Pen/etc. gestures and the vertex-drag + Shift-snap + ParcelDrawing inline-calibrate gestures weren't individually driven.
- **V46 ✅** — Eagle's Gantt shows navy summary brackets (B210) over Tree/Topo/Geotech, gray task-fill bars (not health-colored) with red row-backgrounds for Needs-Attn (B211), and the "⊞ Columns" chooser (B212). The add-column + reload-persist round-trip wasn't driven.
- **V58 ✅** — the Schedule module loads/renders (all-projects report + a full project Gantt), no deploy dead-end.
- **V40 ⏳** — not drivable this session: the embedded scheduler's task grid didn't respond to wheel-scroll to reach the "+ New task" row, and pressing Enter would create a real task in a live project.
- **V90 ✅** — Jacintoport's site-plan overlay loaded in its persisted HIDDEN state (persistence across page-load), and the eye toggle shows/hides it live; restored to hidden afterward.
- **V68 ◑** — the per-overlay visibility toggle (B277) is confirmed via the same eye control; delete-persistence (B276) wasn't tested (destructive on the real overlay; headless-proven).
- **V120 ⏳ / V102 ⏳** — copy-paste-at-cursor and the delete-site-stays-deleted reload check weren't driven (finicky canvas selection / would need a throwaway site create+delete+reload; both headless-proven).

_Asset-blocked cluster (intentionally skipped — not solo-browser checks): V137, V136, V135, V134, V133, V132, V118, V99, V85, V81, V79, V74, V67, V66, V63, V61._
