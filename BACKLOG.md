# Planyr — Backlog

Single source of truth for bugs and feature requests. Repo: `planyr` (product: **Planyr**).

> *"Single source of truth"* = the one file everyone trusts for what's done and what's left, so status never has to be tracked in anyone's head or in a chat thread.

---

## How this file works — Claude Code, read this first

- **On each run:** address every item under **🔲 Open**. Skip everything under **✅ Done** — it's already handled.
- **IDs are permanent.** Never renumber, never reuse a number. A new item gets the next unused B-number, even after earlier items are done.
- **When you finish an item:** move its whole block from 🔲 Open to ✅ Done, flip `[ ]` to `[x]`, and append a one-line note — what changed, the date, and the PR/commit if there is one.
- **Never delete items.** Completed ones stay in ✅ Done as a record.
- **If an item is ambiguous,** don't guess. Mark it `[?]`, add your question inline, and leave it in Open.
- **Bracket tags** like `[Site Planner]` mark the module. `(bug)` / `(feature)` marks the type.

---

## 🔲 Open

### B13 — Refine B11 county resolution: precise boundaries + per-area jurisdiction `[Site Planner / map]` (feature)
`[ ]` Follow-up to **B11** (shipped in PR #13) — two interim simplifications captured here so they aren't forgotten. Neither is urgent; both are screening-only conveniences today and degrade gracefully.
- **Coarse bbox pre-filter → real point-in-county.** B11 routes a parcel click to a CAD service using *approximate* per-county bounding boxes (a coarse screen; the CAD that actually returns a lot is the source of truth, with a fall-back to querying all counties). Fine for the 3 configured counties (Harris / Fort Bend / Chambers), but as more counties are added, switch to true point-in-county boundary polygons so the pre-filter stays accurate and cheap. **(STILL OPEN.)**
- **Layers panel jurisdiction is hardcoded to Harris/Houston.** ~~With no county pre-picked, the map's Layers panel defaults to the Harris/Houston jurisdiction…~~ **DONE** — the map Layers panel jurisdiction now follows the map's current area.
> Progress 2026-06-15 (this PR): **point 2 done** — the map's Layers panel jurisdiction is no longer hardcoded to Harris; `MapFinder` resolves `viewCounty` from the view centre via `candidateCountiesForPoint` on every `moveend`, so the correct utility overlays are offered outside Houston (falls back to Harris when the centre is outside all configured counties; per-site jurisdiction still follows the opened site's county). **Point 1** (true point-in-polygon county boundaries vs. the bbox pre-filter) remains open — the bbox screen is still adequate for the 3 configured counties, so this is deferred until more counties are added.

---

## ✅ Done

### B1 — Sign-up form: missing fields `[auth]` (bug)
`[x]` Sign-up must collect **First name**, **Last name**, and **Organization/Company**. These fields are currently absent.
> Done 2026-06-14 (PR #10). First/Last/Organization added to the sign-up form, stored in Supabase `user_metadata` via `signUp` `options.data`; the signed-in account view now greets by name + org.

### B2 — Account control: placement & styling `[global UI]` (bug)
`[x]` Move the sign-in / sign-out control to the **top-right** (standard web-app convention) and clean up its styling. Current placement and formatting are rough.
> Done 2026-06-14 (PR #10). Account control moved to the shell header (top-right, global across workspaces) and restyled as an avatar+name pill; the old bottom-right pill was removed and the auth modal now lives in the shell.

### B3 — Brand spelling: global `[global]` (bug)
`[x]` Product name is **Planyr**. Replace both wrong spellings everywhere they appear: "Planar" (a-r) and "Planner" (normal spelling). Includes the module label: **"Site Planner" → "Site Planyr."**
> Done 2026-06-14 (rename PR #7 + PR #10 + PR #11). All user-facing brand marks are now "Planyr" / "Site Planyr": shell brand, module tab, map + planner headers, export/print labels, export-error text, and the tax label ("Combined rate" → "total tax rate"). The last stray "Site Planner" (Document Review help text) was fixed in PR #11. **Exception:** the browser-tab title keeps "Industrial Site Planner" as a descriptive tagline, per the owner's call (see "item two" decision, 2026-06-14). Internal identifiers, folder/file paths, and the `planarfit:*` localStorage cache keys are intentionally unchanged (not user-facing; renaming the cache keys would orphan saved data).

### B4 — Parcel selection doesn't reset on return to map `[Site Planner]` (bug)
`[x]` Repro: select parcels → "plan these N parcels" → work in the planner → back out to map. Currently the parcels stay selected and the map is still in select-parcels mode. Expected: returning to the map **clears the committed parcels** and **exits select-parcels mode** back to the normal map state.
> Done 2026-06-14 (PR #10). MapFinder now clears highlights/selection and exits select-parcels mode via an effect that fires whenever the map becomes visible again.

### B5 — Multi-select + merge parcels `[Site Planner]` (feature)
`[x]`
- **Shift+click multi-select** (Bluebeam-style): click a parcel, hold Shift, click others to add to the selection; Shift+clicking a selected parcel de-selects it (toggle).
- With multiple selected, two ways to merge into one: (a) right-click → **"Merge parcels"** context menu, and (b) a **"Merge parcels"** button in the right-hand parcel tool panel.
- **Terminology locked to "Merge"** — remove any "Combine/Combined" labels project-wide.
- This is a *working* merge on the editable layer (geometry for test-fit/yield), **not** a recorded legal consolidation. Button copy must not imply a county filing.
> Done 2026-06-14 (PR #10). Shift-click toggles multi-select in the Select tool; merge via a right-click context menu and a "Merge parcels" button in the parcel panel; the old Combine tool was removed and all user-facing labels say "Merge". Copy states it's a working merge for test-fit, not a recorded consolidation. (Residual non-user-facing leftovers: an unused `combine` icon-glyph key and two code comments — cosmetic, no user impact.)

### B6 — Auto-parking returns wrong dimension after sidewalk resize + delete `[Site Planner]` (bug)
`[x]` Repro: place building → add 30-ft sidewalk → parking within sidewalk → expand sidewalk to 30 ft → delete parking → click "add parking" → tool produced a ~135-ft parking field. Expected: "add parking" drops a **fixed-depth** field every time, regardless of surrounding geometry. Fixed depth is the spec, so the bug is that **something overrides the depth constant with a measured value**. Trace where the parking field's depth is assigned; confirm it can't be contaminated by adjacent or just-deleted geometry (the resized sidewalk and the gap left by the deleted parking are prime suspects).
> Done 2026-06-14 (PR #10). `addParkingRowSide` now offsets by the sidewalk's true *thickness* (`swThick`, which resolves the correct axis) instead of a raw `w`/`h` read that could pick up the sidewalk's *run* (~wall length); the row depth stays the fixed `stallDepth + aisle` constant and can't be contaminated by adjacent or just-deleted geometry.

### B7 — Project lifecycle status on map markers `[Site Planner / map]` (feature)
`[x]` Right-click a project marker to set its status. Lifecycle: **Pursuit → Active → On Hold → Complete → Dead** (see B8 for the full state set and visuals). Core of this item:
- Right-click marker → menu of states, current one checked. Mirror the same control in the project detail panel if one exists.
- **Status is a real field** on the project record in Supabase — persists across devices, stays private per the existing row-level security (each user sees only their own).
- **New projects default to Pursuit.**
- Companion features: **filter by status** (toggle each state on/off — "hide Complete" and "hide Dead" will be the common ones), a **legend**, and **pipeline counts** (e.g., "4 Pursuit · 6 Active · 2 On Hold · 11 Complete · 5 Dead").
> Done 2026-06-14 (this PR — B7–B12 batch). `status` added to the Site Model (`SITE_MODEL_VERSION` 2→3; new sites default to "pursuit"; pre-feature records migrate to "active"), exposed via a `statusOf` selector with ordered `STATUSES` + `STATUS_META`. It persists inside the model `data` — i.e. the `sites.data` jsonb in Supabase, so it syncs across devices and stays private under the existing RLS, with **no DB migration / no dedicated column**. Set a site's status by right-clicking its map marker **or** a saved-sites list row (current state checked); applied to the whole site group. Companion legend + per-state show/hide filters + live pipeline counts live in the saved-sites panel.

### B8 — Lifecycle states & marker visuals `[Site Planner / map]` (feature)
`[x]` The five states and how each marker reads. Use two redundant cues — **color + shape/glyph** — so status stays legible for colorblind users and on a busy basemap:
- **Pursuit** — amber, dashed ring (tentative, uncommitted).
- **Active** — green, solid (the live work; should grab the eye).
- **On Hold** — slate/indigo blue, solid ring, pause "‖" glyph (alive but paused; revivable). Lean slate/indigo rather than sky-blue so it doesn't vanish over blue water on the basemap.
- **Complete** — gray, muted, small check ✓ (done; recedes).
- **Dead** — hollow gray, dimmest, faint ✕, no fill (didn't proceed; kept for the record). **Not red** — red reads as urgent/alert; a dead deal is inert.
- Live (green) should pop; both Complete and Dead recede into the background, with shape/glyph telling them apart.
> Done 2026-06-14 (this PR — B7–B12 batch). Markers carry two redundant cues exactly per spec: Pursuit amber/dashed-ring, Active green/solid (pops), On Hold slate-indigo/pause-‖, Complete gray/muted-check-✓ (recedes), Dead hollow-gray/faint-✕/no-fill (recedes; not red). Glyph distinguishes Complete from Dead.

### B9 — Wire this backlog into CLAUDE.md `[repo / workflow]` (task)
`[x]` Add a line to the repo's `CLAUDE.md` telling future runs to check `BACKLOG.md` on every run — work the **🔲 Open** section, skip **✅ Done**. This closes the loop so the backlog is consulted automatically, without anyone having to point at it each time.
> Done 2026-06-14 (PR #11). `CLAUDE.md` opens with a callout pointing every run at `BACKLOG.md` (work 🔲 Open, skip ✅ Done), disambiguated from the ops "Deferred / maintenance backlog" section near the end of that file.

### B10 — Consolidate the two header rows into one bar with a module switcher `[global UI]` (feature)
`[x]` The Site Planner currently stacks **two** header rows that repeat information: row 1 is `Planyr | Site Planner | Document Review` (top-level module tabs); row 2 is `‹ Map | Site Planyr | Houston ColdPort ▾ › Plan 1 ▾ | undo/redo | Snap 10' | Saved ✓ | File ▾`. The brand and the active module name both appear twice.
- **Collapse to a single top bar.** Switch modules via a **product-switcher dropdown** — the standard multi-product pattern (think Atlassian/Google Workspace): brand logo + current module name on the far left with a chevron; clicking it reveals the other modules (Site Planner, Document Review, and later Project Scheduling, Cost Estimating). This replaces the row of flat tabs.
- **Recommended one-row layout:** `[▾ Planyr · Site Planyr]  ‹ Map › Houston ColdPort ▾ › Plan 1 ▾   ·   [undo] [redo] [fit] · Snap 10' · Saved/Cloud ✓ · [account] · File ▾`. (Map → Project → Plan reads as a breadcrumb — the trail showing where you are in the hierarchy.)
- Honor **B3** spelling here: row 1 still shows the old "Site Planner" — the rebuilt bar must use **Planyr / Site Planyr**.
- Removing the county selector (see **B11**) frees additional header space, reinforcing this consolidation.
> Done 2026-06-14 (this PR — B7–B12 batch). The shell's flat module tabs are now a **product-switcher dropdown** (brand + current module + chevron → menu built from the `WORKSPACES` registry, active one marked); the duplicated brand/module mark was removed from the planner header so brand/module appears exactly once. Global account control unchanged. Note: the shell bar and the planner context bar remain two physical rows — the dedup + switcher are the substance of B10; a single physical row is a later polish.

### B11 — Remove the county pre-selection gate; click anywhere, auto-resolve the county `[Site Planner / map]` (feature)
`[x]` Today the user must pick a county (e.g., Harris vs. Fort Bend) *before* clicking a parcel. Remove that gate — the user should be able to pan/click **anywhere** and select any parcel without choosing a county first; the unnecessary upfront choice just adds friction.
- Parcel geometry is published per **county appraisal district (CAD)** — the county agency that maintains the parcel map and ownership data (Harris County Appraisal District, Fort Bend Central Appraisal District, etc.). So "click anywhere" means the backend must **resolve which county the clicked point falls in** (point-in-county lookup) and route the parcel query to that county's CAD service automatically.
- Handle the **county-boundary case** gracefully (a click near a line, or a multi-parcel selection that straddles two counties → query both services and merge results).
- This also removes the county dropdown from the header, feeding **B10**.
> Done 2026-06-14 (this PR — B7–B12 batch). County gate removed. The map resolves every configured CAD county's parcel layer up front; a click is auto-routed via `candidateCountiesForPoint` (coarse per-county bbox pre-filter, padded so borders overlap → a straddle click queries both) + `identifyParcelAcross` (parallel point-identify across candidates, first hit wins, a down county is skipped not fatal, no match fails gracefully — no parcel, no crash). The selected parcel's resolved county rides into the planner hand-off so the saved site still records its county. The county dropdown is gone from the map header. **Interim:** the Layers panel defaults to the Harris/Houston jurisdiction (same as the prior app default) so the Houston utility overlays stay available with no county picked — per-area jurisdiction resolution is a future refinement.

### B12 — Rename the "start / import" entry point to describe what it does `[Site Planner]` (task)
`[x]` There's a control (current label rendered to me as "skip-point" — **needs confirmation of exact label/location**) that is the on-ramp where you **bring in a survey or a site and start editing** — i.e., drop a surveyed drawing or pick a site and begin a new working session on the editable layer above it. The current wording doesn't communicate that.
- **Goal:** rename it to plainly describe the action. Candidates, depending on exactly what it does: **"New Site,"** **"Start New,"** **"Import & Edit,"** **"Drop a Survey,"** or **"New Plan."** If it's specifically the *alternative* to selecting existing parcels (start from a survey/blank instead), **"Start Blank"** or **"Start from Survey"** fit.
- **`[?]` resolved:** the control was confirmed to be the map's **"Skip — blank canvas"** button, which opens an empty (un-located) planner — it does NOT import a survey today.
> Done 2026-06-14 (this PR — B7–B12 batch). Relabeled the "Skip — blank canvas" button to **"Start blank"** with a tooltip ("Start a new blank plan without selecting parcels"). Behavior unchanged (opens an empty planner; no survey-import was added — that would be a separate, larger item if wanted).

### B14 — Document Review project library: link reviews/files to Projects + browseable folders `[Document Review]` (feature)
`[x]` Link saved Document Review reviews/files to the existing **Project/Site** records (the entity that anchors Site Planner plans, e.g. "Houston ColdPort") and give them a browseable folder structure. Browser-only + existing Supabase.
- **Lifecycle status** reused from the Site Model (pursuit/active/onhold/complete/dead — already shipped in B7/B8); files stay attached regardless of status.
- Each review/file carries a **project link, discipline** (Survey / Civil / Architectural / Landscape / Environmental / CAD / Geotech / Other), **item/type, revision, and date**; the name defaults to **"\<Project\> - \<Item\> - YYYY.MM.DD"** (each piece editable).
- **Storage** organized as `<uid>/project-<id>/<discipline>/<file>` (uid first so the existing private-per-user RLS is unchanged).
- **File-explorer drawer:** project (+ status badge, editable) → discipline folder → files newest-first → click to open in the viewer/stitcher; **drag-drop** a PDF onto a project or discipline to file it.
> Done 2026-06-15 (PR #15, branch `doc-review/project-library`). New `doc_reviews` index columns (`project_id`/`item`/`revision`/`doc_date`) + a `ProjectLibrary` drawer + a project/discipline filing UI in the Reviews menu, all in the doc-review workspace. Projects + their lifecycle status are read from (and written back to) the Site Planner `sites` — one source of truth, no parallel store. Status is NOT re-added (it already exists per B7/B8). Migration `src/workspaces/doc-review/db/project_library.sql`. `upsertReview`/`listReviews` fall back to the core columns if that migration hasn't run yet, so saving never regresses.
