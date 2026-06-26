# COWORK-RESULT 2026-06-25 (batch 3) — signed-in VERIFICATION pass, older Site-Planner UI + the two HIGH-PRIORITY persistence items

> **Claude Code: please fold into `VERIFICATION.md`.** Filed as a result-doc (not a direct edit) for the same reason as PR #365 — `main` is moving fast and full-file uploads clobber concurrent V### additions. Run signed-in on planyr.io in the owner's browser.
>
> **⚠️ One thing to actually action:** **V13 / V28 are STILL ❌** (see below) — the resume-into-planner persistence bug is unfixed as of 2026-06-25. Not a data-loss regression (work is intact + reopenable), but the HIGH-PRIORITY resume UX still fails.

Legend: **✅** confirmed live · **◑** partially advanced · **⏳** not drivable this session (subtle-visual / would need a destructive edit).

## HIGH PRIORITY — persistence

- **V13 ❌ (resume-into-planner) — CONFIRMED STILL FAILING 2026-06-25.** Opened **8 South** from the finder → planner loaded (URL `#/project/smqiljx5fngg/site`, buildings + parcels rendered). Ran a real `location.reload()`. Result at **both ~2 s and ~7 s**: the app **bounced to the finder/map** — breadcrumb "Select a project", URL **stripped to `#/`** — and never resumed into the 8 South planner. Same ❌ as the 2026-06-20 run; the hash-route (`#/project/<id>/site`) is dropped on boot. **Data durability is fine** — 8 South stays intact and reopenable from the finder list (not a data-loss event). Also: a cold navigate straight to a project URL likewise bounces to `#/`.
- **V28 ❌ / BLOCKED (no stale-plan flash on reload) — CONFIRMED STILL BLOCKED.** Because reload never resumes into the planner (it bounces to the finder), there is **no plan paint to flash** — the flash test is unreachable until V13's resume-into-planner is fixed. No older/thinner plan was observed (because no plan loads on reload at all).

## Older Site-Planner UI (confirmed live this session, in 8 South's planner)

- **V5 ✅** — opening a saved site from the finder reliably lands in the planner with the plan intact (8 South opened cleanly several times).
- **V10 ✅** — Snap **defaults OFF** (header reads "Snap off"). (The Alt-hold-to-suppress + on/off toggle not separately exercised.)
- **V12 ✅** — the **Measure** tool dropdown offers **Length / Polylength / Area** (+ Count).
- **V14 ✅** — the draw-tool rail **scrolls to reveal the full set** on desktop (Line / Rectangle / Ellipse / Polygon / Polyline, then MEASURE, then ANNOTATE Callout/Text, then SELECT).
- **V16 ✅** — a rail dropdown (the Measure variant menu) **opens fully visible**, portaled to the left of the rail — not clipped behind it.
- **V22 ◑** — red **edge-dimension callouts** render on the building edges at a zoomed-in view; the **hide-on-zoom-out** LOD behavior wasn't cleanly driven (the Site-Planner SVG canvas doesn't zoom on double-click; the +/- zoom buttons weren't exercised to avoid more renderer freezes).

## Not driven this session

- **V6 (no white flash on zoom/pan)** ⏳ — a white flash is a sub-frame transient that screenshots can't reliably catch; needs a human eye or a video capture.
- **V17 (parking hugs building), V19 (label LOD on zoom-out), V21 (building-label 4-line stack + sqft on zoom-out), V24 (print-overlay toggle)** ⏳ — subtle visual / would require adding elements (destructive on a real plan) or driving the canvas zoom + the print/export dialog, which weren't reliably drivable here.

## Note on scope
The remaining VERIFICATION.md backlog is now mostly **either asset-blocked** (need a 2nd user / two live tabs / a full localStorage / a network outage / a fresh dropped PDF / real drawings — V137/136/135/134/133/132, V118/99/85/81/79/74/67/66/63/61) **or subtle-visual** (need a human eye / video — the white-flash and label-LOD items). Those are best handled by Claude Code's headless harness or a deliberately set-up multi-browser session, not a solo signed-in pass.
