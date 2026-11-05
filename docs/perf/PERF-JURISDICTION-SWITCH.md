# PERF — the jurisdiction share pass after a plan switch (slow report 55807aa9, B2208416)

**Report.** `public.problem_reports` 55807aa9 (2026-10-08 17:58Z, build `99c87bb`, plan `smun6o2o628f` "Bolt-on", Grand Port group `smqfy2r7pdec`,
126 `site_elements` rows of which **6 live parcels**). Perfcap (manual, 191 s): 69 long tasks / 8.35 s; ~30 tasks of 123–142 ms clustered 5 s after the
switch, all attributed `Response.json.then:jurisdiction-CuR1TIW8.js:5638`. Recurring signature in `ef29b5da` (2026-10-05, build `4eacb0d`).

## What the label means (and does not)
- `…:5638` is **not a line**. It is `sourceCharPosition`, a character offset into a minified chunk, and `perfCapture.sanitizeAttribution` cuts the whole label to
  **48 characters** (18 + 1 + 24 + 1 + 4) — the real offset is five digits (≈56383 in a rebuilt chunk): the `await res.json()` inside
  `gisFetch.fetchArcgisJson`, which is bundled into the `jurisdiction` chunk.
- The invoker `Response.json.then` names the promise reaction that **resumed**. Everything chained after it runs in the same microtask turn, so the task is charged to
  the response for **whatever the chain does synchronously** — here, `identifyCityShares` → `cityAreasFromFeatures`.

## The three hypotheses, ruled explicitly
| | Verdict | Evidence |
|---|---|---|
| (a) too many requests | **Out as the cost; one real redundancy found** | A Bolt-on open makes **20** GIS data requests (badge ×10 + drainage), already coalesced per URL by `coalesceRequest`. Requests are cheap. What was *not* deduped was the clipper work after them: the badge and `resolveDrainageAuthority` ask for the same share concurrently and `cache.swr` only dedupes a fetch → the same boundary was dissolved twice. Fixed (`identifyCityShares` in-flight map). |
| (b) large payload parsed | **Out** | Largest answer is TxGIO's Baytown at 334 KB: `JSON.parse` ≈ **8 ms**; the county polygon 168 KB ≈ 2 ms; 527 KB of geometry in all. |
| (c) heavy work inside the `.then` | **CONFIRMED — the cost** | Node CPU profile of one replayed badge lookup: 1.83 s wall, a **947 ms** synchronous block; `distanceToBoundaryM` 303 ms, clipper (`ProcessEdgesAtTopOfScanbeam`, `ExecuteInternal`, `AddPath`, bigint) ≈ 600 ms, GC 351 ms. In Chrome: one task attributed to `Response.json.then:jurisdiction-…` of **544–629 ms** (LoAF script duration), 1.0–1.1 s per open. |

Root cause: for **every** jurisdiction a share call did `normalizePolys(<whole published boundary>)` (clipper dissolve of a 335 KB polygon) once for the whole
site and **again for each of the 6 parcels**, plus an O(site-segments × boundary-segments) `distanceToBoundaryM` for each of those 7 — and a per-parcel
distance is **never read** by anything (only the whole-site one is carried onto the row, and nothing in `src` consumes it).

## Other things read and ruled out
- **GIS 503-under-burst:** a retry adds more handler runs, each cheap; it cannot make one handler 600 ms. Not reproducible by replay and not needed to explain the cost.
- **`gisCache` SWR:** the cached value is the small *derived* answer (never the polygons) with a 7-day ttl, so a warm open costs **0 ms** (measured: `switch-same-group`).
  The cost is the cold compute — which is exactly what a plan whose parcels were just combined (Bolt-on, 2026-10-08) hits: a new ring set is a new key.
- **B752 family (stale verdicts):** correctness, not CPU.
- **Phase-3 "rules engines behind a Worker" (`brief-2026-07-31-speed-program`):** not needed. After the fix the worst single step is ≈ 25 ms (the polygon nesting before the
  first yield on the 335 KB feature). It is the next move **if** a larger boundary ever shows a slice over budget; the generator-step structure (`cityAreasSteps`) is the seam for it.
- **`elementsDrawn` 0 on a 126-row plan:** noted, not concluded from (route `project`, one panel open).
- **`m` (1587 ms) in `ef29b5da`:** **not this path.** `m` ran t = 40.7–42.3 s; two shorter tasks followed; the 156 ms `Response.json…jurisdiction` task started at
  t = 42.8 s — different function, started 2 s earlier, ended before the response was handled (the jurisdiction task was simply queued behind it). A one-letter minified
  name cannot be resolved without that build's map. The newer capture (99c87bb) has no multi-second task at all (longest 243 ms).

## The fix (all in `lib/jurisdiction.js`, `lib/jurisdictionShare.js`, new `lib/yieldToMain.js`)
1. **Window clip.** Each jurisdiction's rings are cut (Sutherland–Hodgman, lon/lat — exact because `toLocal` is linear) to a 3 km window around the site. Every area under the site
   is unchanged: measured **max |Δshare| = 0** against the original algorithm on Goose Creek and Grand Port at windows of 150 m and up.
2. **Dissolve once per jurisdiction** (`clipNorm`), reused by the whole-site and every parcel measurement.
3. **No per-parcel distance** (unread). The whole-site `distanceM` stays **exact**: read off the window when under the pad (every cut edge is ≥ pad away), off the full polygon otherwise.
4. **Time-sliced** (`cityAreasFromFeaturesAsync`, 12 ms budget, macrotask yield — see `yieldToMain.js` for why not `scheduler.yield` and what was and was not measured) — the sync entry point drives the identical steps to completion, so every non-browser caller is unchanged.
5. **In-flight dedupe** of concurrent identical share requests. Also: `esriPolygons` precomputes each outer's bbox/area (hole nesting no longer walks every outer), and `distanceToBoundaryM` compares squared distances (≈1.5 ms warm on the windowed Baytown boundary; same answer to six decimals).

## Measured, same harness, same payloads, two builds of one tree (baseline = 99c87bb, fixed = this change), 3 runs each
`ui-audit/perf-jurisdiction-switch.mjs` (`npm run perf:jurisdictionswitch`), Chromium under xvfb, dpr 2, 1722×700, GIS answers replayed from payloads recorded off the live services
(`fixtures/bolt-on-gis-payloads.json`, 20 requests, 527 KB of geometry; **0 replay misses**). Jurisdiction work = LoAF script time in the `jurisdiction-*` chunk **whatever resumed it**
(`Response.json.then` and each `setTimeout` slice — a first draft counted only `Response.json*` and would have read moved-not-removed work as 0 ms). "Worst frame" = the longest animation frame that carried any of it.

| scenario | | baseline (3 runs) | fixed (3 runs) |
|---|---|---|---|
| cold load straight onto Bolt-on | total | 1006–1068 ms | 39–67 ms |
| | worst single script | 568–629 ms | 22–28 ms |
| | worst frame | 592–672 ms | 99–106 ms |
| open another plan, switch to Bolt-on | total | 1049–1102 ms | 29–42 ms |
| | worst single script | 544–598 ms | 16–20 ms |
| | worst frame | 588–622 ms | 53–101 ms |
| switch with Site Analysis open | total | 1074–1090 ms | 19–67 ms |
| | worst single script | 571–599 ms | 19–31 ms |
| | worst frame | 610–646 ms | 63–104 ms |
| switch to a sibling plan in the same project | all | 0 (same rings → cache hit; a no-op by design, kept as the warm-path control) | 0 |

Budget (`perf-jurisdiction-switch.budget.json`): worst single script ≤ 50 ms, total ≤ 150 ms and worst frame ≤ 200 ms per scenario, ≥ 4 GIS requests answered or the scenario is **VOID**.
The 100 ms "worst frame" is mostly NON-script work sharing the frame (an 80 ms frame holding one 19 ms jurisdiction script was seen) — not claimed as cleared, only as ~6× smaller than before.
The remaining 140–230 ms long tasks in these runs are the plan's own load (`index-…:13985`, `…:40108`), not this path — owned by the editing-hitches work (session `01Q5aoSC85Dowt4AWW2mHFnh`, report 0c68509b); this change touches none of its files.

## Deviations, stated
- The fixture carries the plan's six live parcels, county, settings and origin — **not** its 56 live element rows, 4 markups and 1 callout (the path reads only parcels/origin/county). A plan-load figure from it is a floor, not Bolt-on's full load.
- Production's group id (`smqfy2r7pdec`) differs from the plan id; the harness uses group = plan id (the `perf-edit-switch` convention) because a raw hash switch between projects whose group id is not a plan id was **ignored for 30 s+** in a running app, so the harness switches through the header's own project/plan chips after the first open.
- The baseline and the fix are two builds, not one build with a toggle (a runtime toggle for a perf fix would be dead weight in production).
- Not reproduced: the owner's ~30 separate 130 ms tasks (here: a few larger ones per open). His hardware/ring sets differ; the fix bounds every step ≤ ~25 ms regardless of how many shares run.

Guards: repo-root `test/` **jurisdictionShareWindow** (40 — equivalence to the verbatim original on the owner's recorded boundaries, randomised concave+holes, positive control, slicing, dedupe, source guard; three mutants each caught) and **jurisdictionSwitchVerdict**; live: V1627520.
