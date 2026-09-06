# Agent rules — how to not ship a false result in this repo

Every rule below was paid for by a real incident on Planyr — a false bug filed, a working feature reported broken, a wrong number written into the backlog, or a gate quietly weakened to go green. Read them as failure modes that have already happened here, not as general advice.

## The verification rules

**Prove the browser is running the build you are judging, in the same call as the assertion.** Planyr code-splits every feature into its own hashed lazy chunk, so the main bundle can be byte-identical across a deploy; compare the Vite manifest (cache:'no-store') against performance.getEntriesByType('resource'), never document.scripts. A plain reload re-executes the cached index.html and its old chunk list — force freshness with a query, https://planyr.io/?cb=<ts>#/route. This cost three rounds of "still broken" on fixes that were live.

**Verify against a string literal the change introduced, not an identifier.** Minification mangles identifiers and strips comments; a new user-visible string is both the deploy marker and half the acceptance test.

**Read /version.json in a real tab with cache:'no-store', never through WebFetch.** WebFetch returned b487f11 twice — even with a cache-buster — while production was actually on 21aa3d6. That nearly became a report that the deploy pipeline had been dead for twelve hours.

**A feature is not verified until the workflow has been run end to end and attacked: minimum three tests, one of them hostile.** Opening a menu and reading its items proved a menu, and was reported as a verified Excel export. Round-trip anything reversible; test empty, one row, a cell with a comma or leading zero; then feed it a wrong file type and demand a clear message, never a silent failure or a wipe of good data. Unit tests and the UI are built against the same mental model and agree with each other while both are wrong about the user's path.

**Trigger and screenshot every transient surface.** Every screenshot of the Model module had been of the page at rest, so context menus shipped as bare text floating over the grid with no background, mis-anchored, and column-header right-click did nothing at all. For each surface check three things: it appears, it is anchored and flips at viewport edges, and it has real chrome (opaque background, border, z-index, dismiss on Escape and outside-click).

**Label every responsive result emulated, simulated, or on-device.** Chromium at 390 wide is not an iPhone: env(safe-area-inset-*) resolves to 0 headless, and iOS Safari's collapsing toolbar cannot be emulated at all. Use Playwright device descriptors (they carry hasTouch, isMobile, DPR) and name the engine — and never report one tool's limitation as a limitation of the work without checking whether Playwright, a DB query, or the shipped bundle covers it.

**A status surface is a claim; the source is evidence.** A "needs input" badge meant a session was blocked whose PR had already merged. Did it merge -> GitHub PR state. Did the fix work -> production data. Did the control work -> whether the value persisted, in the database, not just on screen.

## The measurement traps

**Validate a selector against a known-good case before reporting any count, and report the query with the number.** [data-testid^=task-row], tr returned 0 rows on a div-based grid that was rendering fine — a clean, plausible, confirmation-shaped zero identical to the bug being hunted. Prove the selector can be non-zero, count the container too, and read innerText.

**"No hits" from GitHub code search on this repo carries no information.** A search for buildingFloodExposure returned three paths and no importer; SitePlanner.jsx contains it five times including the import. The file is ~31k lines and gets skipped silently. Before calling anything dead, fetch raw.githubusercontent.com/mikeab7/planyr/main/<path> and count occurrences — check SitePlanner.jsx explicitly, every time.

**A hidden tab gives wrong timings and a self-consistent stale scene.** setTimeout throttling measured 3,156 ms for a gesture that really took 182 ms — reported as "3.6-4.4 s per interaction" and written into perf items. Suspended requestAnimationFrame returns element boxes and hit tests that all agree with each other and describe a view the app has left; that produced a false anchored-zoom regression. Assert visibilityState === "visible" AND probe rAF liveness before measuring time or geometry, and fail loudly. Extension-driven automation tabs are always hidden, so timing, animation, zoom, layout-width and cold-boot questions cannot be answered there at all.

**getComputedStyle is one theme behind after a theme flip.** 900 ms was not enough; a correct dark tab measured as pure white and nearly shipped as a defect. Read twice with a long gap and trust only a settled value — and for "does this look attached / legible", take the screenshot, because no single element's computed background answers a composite question.

**Arm the listener, act, and read the log in one batch.** Split across three tool calls the click log was empty; in one browser_batch the same click read t=true @1401,43. An empty log across calls proves nothing, and re-clicking a toggle to "try again" closes what the first click opened.

**Empty never means zero.** Distinguish no hazard / not covered / not checked / failed to load at the point of rendering. A null ETJ rendered as "unincorporated" put finished floors 1-2 ft too low; 38 of 43 GIS sources returning zero read as all-clear over an oil-and-gas field.

**Demand a positive control, and break it on purpose before believing it.** Roughly two in three instrument failures on record read clean when they were not, because a harness that cannot see a defect and a product with no defect emit identical output — a drift guard passed 34 tests over a real injected bug.

**Before diagnosing why an action failed, prove the instrument was in a state where it could have worked; after two failures change the mechanism, not the parameters.** Hours went into click-coordinate theories while window.innerWidth was 0. Tuning the same approach a third time is almost always wasted.

## CI, gates and merges

**A PR that needs a gate to pass must not modify that gate.** #1375 failed visual regression on surfaces it genuinely changed and responded by demoting desktop baseline failures to advisory, then reported "all 16 clean" — true of a weakened gate. Gate sensitivity is a separate PR. Ask the diff, not the summary, and force a yes/no: did anything become more permissive than main?

**Triage failing visual baselines by name; a failure on a surface unrelated to the change is a stop-and-report.** The failures were library, site-planner-header and site-planner-left-rail on a Model-module PR — that is how a token split was discovered to be app-wide. Also check coverage: re-approved phone-only baselines mean desktop was never pixel-checked. And capture new baselines only AFTER a refactor lands, or the current mess becomes the approved reference.

**ui-audit/design-drift-ceiling.json moves down only.** Fix your own new offenders with FONT_SIZE and RADIUS tokens; one PR bumped fontSizeCeiling 446 -> 447 in a one-line edit and only reverted when challenged.

**Attribute bundle bytes before optimizing, and ratchet one metric at a time.** Source size lies by ~4x — only the bundler knows what shipped; run scripts/perf-base-stats.mjs --compare. Derived metrics (totalJsBytes, largestChunkBytes) fall out of route fixes; ratcheting them ratchets a thermometer. A --allow-raise reason must name the feature that bought the bytes; a third one in a row means stop and report.

## Data model invariants

**One authoritative home per fact; every other copy is a read-only mirror.** A project's name is copied onto the site column of every plan row, so renameSiteGroup misses any plan not hydrated locally — and that stale plan republishes the old name on its next save.

**Exactly one function answers "is this my own write?", covering per-tab and per-account.** Six overlapping mechanisms consulted in different combinations at ~50 sites in elementSync.js produced seven rounds of false conflict banners; each round fixed the one site reported.

**One gesture is one causal unit, end to end.** Building assemblies tear on move because a batch of derived writes carries no marker binding them, so members surface individually. Five rounds and seven merges of point fixes did not end it.

**No write fails silently, and no remote tombstone is resurrected by a local undo.** The rename failure was noticed only because a name visibly reverted.

**More than one presence on a plan means a diff is not attributable to you — and the repair is the dangerous act.** A drop of 77 -> 76 elements looked like data destruction and was the owner merging parcels (-2 +1, same timestamp); the planned UPDATE ... SET deleted_at = NULL would have resurrected two parcels overlapping the new one. updated_by cannot disambiguate — both sessions authenticate as the same account. A same-timestamp creation alongside a delete is a merge, split or replace.

## Dispatch and scope

**One task per session; continue an existing one only when a fresh session would have to rebuild a fixture, harness or measurement rig it needs.** Every turn re-sends the whole conversation, so session length outweighs model tier. A warm container is not a reason.

**Front-load the brief with everything already measured, including approaches ruled out and why — and never cite claude/*.md.** Those docs live outside the repo; a session burned real time proving six cited paths did not exist. Cite docs/, CLAUDE.md, BACKLOG.md, ui-audit/*.mjs freely, paste everything else, and treat any claim from an older doc as a hypothesis to re-verify — one dispatch found two of three requested fixes already shipped and "fifty call sites" was ten.

**A dependency you invent is a dispatch you owe.** "Ship this after X merges" with nothing watching for X is a decision-shaped way to lose an item; it survives review precisely because the sequencing reasoning is correct.

**A backlog block is a ship order.** File, dedupe, then implement in-session and verify. An item that genuinely cannot ship must say so loudly on the item and in the reply — silent filing is the original failure this rule exists to stop.

**In the Model module, build the capability and never the preset.** No preset columns, no starting template, no scaffolded rows; the benchmark is Excel, which ships the ability to build a pro forma, not one.

**A finding a future session needs belongs in the repo and referenced from CLAUDE.md.** A rule that lives only where the reader does not look has not been delivered.
