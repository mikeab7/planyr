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

### B7 — Project lifecycle status on map markers `[Site Planner / map]` (feature)
`[ ]` Right-click a project marker to set its status. Lifecycle: **Pursuit → Active → On Hold → Complete → Dead** (see B8 for the full state set and visuals). Core of this item:
- Right-click marker → menu of states, current one checked. Mirror the same control in the project detail panel if one exists.
- **Status is a real field** on the project record in Supabase — persists across devices, stays private per the existing row-level security (each user sees only their own).
- **New projects default to Pursuit.**
- Companion features: **filter by status** (toggle each state on/off — "hide Complete" and "hide Dead" will be the common ones), a **legend**, and **pipeline counts** (e.g., "4 Pursuit · 6 Active · 2 On Hold · 11 Complete · 5 Dead").

### B8 — Lifecycle states & marker visuals `[Site Planner / map]` (feature)
`[ ]` The five states and how each marker reads. Use two redundant cues — **color + shape/glyph** — so status stays legible for colorblind users and on a busy basemap:
- **Pursuit** — amber, dashed ring (tentative, uncommitted).
- **Active** — green, solid (the live work; should grab the eye).
- **On Hold** — slate/indigo blue, solid ring, pause "‖" glyph (alive but paused; revivable). Lean slate/indigo rather than sky-blue so it doesn't vanish over blue water on the basemap.
- **Complete** — gray, muted, small check ✓ (done; recedes).
- **Dead** — hollow gray, dimmest, faint ✕, no fill (didn't proceed; kept for the record). **Not red** — red reads as urgent/alert; a dead deal is inert.
- Live (green) should pop; both Complete and Dead recede into the background, with shape/glyph telling them apart.

### B9 — Wire this backlog into CLAUDE.md `[repo / workflow]` (task)
`[ ]` Add a line to the repo's `CLAUDE.md` telling future runs to check `BACKLOG.md` on every run — work the **🔲 Open** section, skip **✅ Done**. This closes the loop so the backlog is consulted automatically, without anyone having to point at it each time.

### B10 — Consolidate the two header rows into one bar with a module switcher `[global UI]` (feature)
`[ ]` The Site Planner currently stacks **two** header rows that repeat information: row 1 is `Planyr | Site Planner | Document Review` (top-level module tabs); row 2 is `‹ Map | Site Planyr | Houston ColdPort ▾ › Plan 1 ▾ | undo/redo | Snap 10' | Saved ✓ | File ▾`. The brand and the active module name both appear twice.
- **Collapse to a single top bar.** Switch modules via a **product-switcher dropdown** — the standard multi-product pattern (think Atlassian/Google Workspace): brand logo + current module name on the far left with a chevron; clicking it reveals the other modules (Site Planner, Document Review, and later Project Scheduling, Cost Estimating). This replaces the row of flat tabs.
- **Recommended one-row layout:** `[▾ Planyr · Site Planyr]  ‹ Map › Houston ColdPort ▾ › Plan 1 ▾   ·   [undo] [redo] [fit] · Snap 10' · Saved/Cloud ✓ · [account] · File ▾`. (Map → Project → Plan reads as a breadcrumb — the trail showing where you are in the hierarchy.)
- Honor **B3** spelling here: row 1 still shows the old "Site Planner" — the rebuilt bar must use **Planyr / Site Planyr**.
- Removing the county selector (see **B11**) frees additional header space, reinforcing this consolidation.

### B11 — Remove the county pre-selection gate; click anywhere, auto-resolve the county `[Site Planner / map]` (feature)
`[ ]` Today the user must pick a county (e.g., Harris vs. Fort Bend) *before* clicking a parcel. Remove that gate — the user should be able to pan/click **anywhere** and select any parcel without choosing a county first; the unnecessary upfront choice just adds friction.
- Parcel geometry is published per **county appraisal district (CAD)** — the county agency that maintains the parcel map and ownership data (Harris County Appraisal District, Fort Bend Central Appraisal District, etc.). So "click anywhere" means the backend must **resolve which county the clicked point falls in** (point-in-county lookup) and route the parcel query to that county's CAD service automatically.
- Handle the **county-boundary case** gracefully (a click near a line, or a multi-parcel selection that straddles two counties → query both services and merge results).
- This also removes the county dropdown from the header, feeding **B10**.

### B12 — Rename the "start / import" entry point to describe what it does `[Site Planner]` (task) `[?]`
`[ ]` There's a control (current label rendered to me as "skip-point" — **needs confirmation of exact label/location**) that is the on-ramp where you **bring in a survey or a site and start editing** — i.e., drop a surveyed drawing or pick a site and begin a new working session on the editable layer above it. The current wording doesn't communicate that.
- **Goal:** rename it to plainly describe the action. Candidates, depending on exactly what it does: **"New Site,"** **"Start New,"** **"Import & Edit,"** **"Drop a Survey,"** or **"New Plan."** If it's specifically the *alternative* to selecting existing parcels (start from a survey/blank instead), **"Start Blank"** or **"Start from Survey"** fit.
- **`[?]` for Claude Code:** confirm the current label string and where it lives before renaming, so the right element is changed.

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
> Done 2026-06-14 (rename PR #7 + PR #10 + this PR). All user-facing brand marks are now "Planyr" / "Site Planyr": shell brand, module tab, map + planner headers, export/print labels, export-error text, and the tax label ("Combined rate" → "total tax rate"). The last stray "Site Planner" (Document Review help text) was fixed in this PR. **Exception:** the browser-tab title keeps "Industrial Site Planner" as a descriptive tagline, per the owner's call (see "item two" decision, 2026-06-14). Internal identifiers, folder/file paths, and the `planarfit:*` localStorage cache keys are intentionally unchanged (not user-facing; renaming the cache keys would orphan saved data).

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
