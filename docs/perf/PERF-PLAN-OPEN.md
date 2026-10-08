# PERF — the main-thread stall while a plan opens / switches (slow report 55807aa9, other half · B2225424)

**Report.** Same owner report as B2208416 (`problem_reports` 55807aa9, plan `smun6o2o628f` "Bolt-on", build 99c87bb). B2208416 fixed the jurisdiction half. Then the owner measured his own signed-in
Chrome on build `bae75b0` with a MessageChannel ping-gap heartbeat (proven on a deliberate 200 ms busy loop, in a hidden tab): **Bolt-on → Concept A (`smqfy2r7pdec`): gaps of 908, 560, 118 ms within ~2 s;
Concept A → Bolt-on: 226 and 253 ms; no GIS fetch fired** — so the stall is the app's own plan-open work.

## The rig (so nobody rebuilds it)
`ui-audit/perf-plan-open.mjs` (`npm run perf:planopen`, `--library 140` pads the account like his 143 plans, `--profile` writes a sourcemap-resolved CPU profile per action). It boots the **signed-in** path
(resumable fake session, `lib/authRemount.mjs`) against a dummy Supabase host answered by `lib/planOpenRig.mjs` from the owner's real rows — `ui-audit/fixtures/plan-load/{concept-a,bolt-on,richfield-concept-a-live}.json`
(`public.sites.data` header + live `public.site_elements`, county records / free text / storage keys stripped). Cold open, Bolt-on ↔ Concept A (first visit · back · revisit), Grand Port ↔ Richfield (the larger plan, 193 rows).
Scored with the heartbeat (`lib/planOpenVerdict.mjs`, VOID if the known-good 200 ms arm reads < 150 ms). Build it with `VITE_SUPABASE_URL=https://bootauth.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vite build --sourcemap true --outDir <dir>` and pass `--dist <dir>`. Same harness, two builds: baseline = main `bae75b0`, fixed = this change.

## The four hypotheses, ruled with numbers
| | Verdict | Evidence |
|---|---|---|
| **derived geometry recomputed on open** | **CONFIRMED — the dominant cause, and it is `polylabel` (the parcel acreage-badge anchor)** | CPU profile of the Bolt-on → Concept A switch, resolved through the build's sourcemaps: `polylabel.js:110` self time **345 ms** (first visit) and **763 ms** (revisit) under `SitePlanner.jsx:17738` (`parcelChips`), in the render. Reproduced in plain Node, no browser: Concept A's 16 parcels cost **416 ms**; two long thin strips (83 × 1,705 ft, 5–6 vertices) cost 155 + 177 ms. Two causes: the best-first search **rescanned its whole candidate queue on every pop** (a flat ridge keeps thousands of cells alive), and its cache was keyed by **array identity** — a plan open re-seeds every parcel into new arrays with the same coordinates, so every open and every revisit paid the whole search again. |
| plan fetch / parse (`Response.text.then`) | **Partly in — it is an ACCOUNT-wide cost, not a per-plan one** | `Response.text.then:index-…:154188` maps (same sources rebuilt at 99c87bb, sourcemap) to `@supabase/postgrest-js` `processResponse` → `await res.text()` → `JSON.parse`, and bills **everything that runs synchronously after it** to that label. The account-wide parcel fetch's continuation ran `summarizeParcelRows` for every plan on the account: **187–201 ms** on a 140-plan library, as one task (`overlappingParcelPairs` is O(parcels²) per plan). Sliced now. **Not proven to be his 134 ms task** — his real parcel set is not in this repo; V1644528 checks it on his account. The plan's own row fetch is tiny (193 rows). |
| element hydration | **Out** | `createSiteModel` + `normalizeBondedChildren` 16–18 ms on the 193-row plan, 8–9 ms on Bolt-on. |
| local store read | **Out — B2165120 is NOT a dependency** | `loadSite` 7–10 ms; `saveSite` 22–30 ms in the click under automation (the legacy-mirror refresh is `sync` under automation and `idle` in production — the rig sets `__PLANYR_LEGACY_MIRROR = "idle"`). 140 filler plans added 20–60 ms in total, none of it a single task. |

Found on the way (not in the brief, same family — an account-scale cost in the header): **`relTimeShort` took 213 ms self** in one plan open on a 140-plan account. `Date#toLocaleDateString(undefined, opts)` builds a
fresh `Intl.DateTimeFormat` per call (~1.5 ms), the project switcher renders a row per project on every header render (the JSX is evaluated whether or not the menu is open), and every plan older than a month takes that branch.

## The fix
1. `lib/polylabel.js` — binary max-heap instead of the linear `popBest` (same search, same stop rule; ties by push order) + a **content-keyed second cache tier** (coordinates → anchor, FIFO-bounded at 512) behind the identity WeakMap. Concept A's parcels: 416 → 41 ms cold in Node, ≈ 0 on every revisit.
2. `lib/parcelSummary.js` `summarizeParcelRowsAsync` — the account-wide summary in ≤ 12 ms slices (a site is the unit), applied by `SitePlannerApp.jsx` with an epoch guard so a finished summary of a superseded call / signed-out account is dropped.
3. `shared/projects/projectSwitcherModel.js` `relTimeShort` — one cached `Intl.DateTimeFormat` (same locale, same options, same strings).

## Measured — same harness, two builds, 3 runs each, `--library 140` (worst single main-thread gap, ms)
| action | baseline `bae75b0` | fixed |
|---|---|---|
| **Bolt-on → Concept A (first visit)** — the owner's 908/560 | 394 · 426 · 513 | **90 · 138 · 142** |
| Concept A → Bolt-on (back) — his 226/253 | 214 · 198 · 233 | 243 · 186 · 178 (not improved) |
| **Bolt-on → Concept A (revisit)** | 491 · 535 · 652 | **139 · 199 · 203** |
| cold open Bolt-on | 244 · 237 · 244 (6 more runs: 219–310) | 261–369 (median ≈ same); total time over 50 ms 1.4 s → 1.2 s |
| Grand Port → Richfield (193 rows) | 479 · 439 · 475 | 475 · 391 · 355 (not fixed) |
| Richfield → Grand Port (back) | 230 · 213 · 311 | 209 · 235 · 253 (not improved) |
Without the library padding: first visit 399–408 → 99–102, revisit 507–600 → 165–197.

## ⛔ WHAT THIS DOES NOT DO — stated loudly
**The brief's acceptance — "no single task over 50 ms on Bolt-on, and the larger plan sharply down" — is NOT met.** Bolt-on's own opens still hold one 180–300 ms task, and Richfield (the larger plan) is not meaningfully down. The remainder is **distributed**, not
one hotspot: `SitePlanner`'s render body ≈ 80–100 ms (renders in the click task: the plan switch is a discrete event, so React renders synchronously inside it; one component = one task, so `startTransition` would not split it), the header's
measuring copies (`PriorityToolbar` 15–26 ms), a Leaflet `addTo` for the detail aerial layer on a 600 ms timer (60–120 ms), and — on Richfield — the **first-time road-network dissolve** (`dissolveRings` 121 ms of a 280 ms render; memoised afterwards, so a revisit is cheaper).
That is B2225425 (open). The budget (`ui-audit/perf-plan-open.budget.json`) is therefore set at what the fixed build measures plus headroom, with the 50 ms as a reported **target**, never a silent pass.
**`m` (1,587 ms in `ef29b5da`, build 4eacb0d): not resolved.** A one-letter minified name cannot be mapped without that build's sourcemap, which is not kept; Richfield (`smt7q6ar8egz`) has three parcels, so it is not `polylabel`. Its first-time road dissolve is 121 ms here. Unexplained.

## Deviations, stated
- The seed (rows → canvas) lands ~4.2 s after a switch in the rig, not ~1–2 s: the engine seeds "on the realtime join or the 4 s fallback" and the rig has no websocket, so it always takes the fallback. The work done at the seed is the same; only its timing differs.
- Aerial tile requests are answered with a solid PNG (a blocked tile is a failure mode Leaflet pays for per tile); GIS data requests are refused (his switches fired none).
- The library padding is clones of the three real plans, so parcel-heavy clones (Concept A ×47) overstate `summarizeParcelRows` relative to his account.
- Two builds, not one build with a toggle.

Guards: repo-root `test/` **polylabelPerf** (the verbatim original replayed as the reference; ratio, not a wall-clock figure), **parcelSummaryAsync**, **relTimeShort** (red on the old code), **planOpenVerdict**; browser: `npm run perf:planopen -- --assert` (baseline fails the Concept A budgets, the fix passes) — deliberately **not** a required CI gate (timing on a shared runner; the unit guards above are the CI-runnable half). Live: V1644528 (`ui-audit/verify-plan-open-live.mjs`).
