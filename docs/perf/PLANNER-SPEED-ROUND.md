# Site Planner speed round — where the time goes (2026-10-31)

Owner, 2026-10-30: *"I want you to improve the speed of the software. I guess I want you to refactor it so that it's good."* There
was no named culprit, so the job was to find where the time goes first. Items: **B2596704** (this table + the instrument),
**B2596705** (the fixes, live check V2042432), **B2596706** (the guard), **B2596707** / **B2596708** (what is NOT yet inside budget).

## How it was measured

`ui-audit/profile-planner-perf.mjs` (`npm run perf:planner:profile`) drives the grading harness with the owner's **Concept A**
(`?owner=2`) on the **real Chehaw ground**: the real `GradingController` + `GradingCanvas` + `GradingPanel`, grading ON, proposed
contours + cut/fill + paper on. A **production build** (dev React roughly doubles every re-render with prop validation — measured),
1913 × 1000 at DSF 2.15 (his screen), **CPU throttled 4×** — the honest stand-in for a weak machine. His own browser's frame rate is
not evidence of app cost that night (B2319137 ×4: every heavy page, github.com included, drew at ~1 fps). Views: the scale bar
reading **500 / 125 / 50 ft**. Phases: **open** (load → the graded picture), **zoom-in / zoom-out** (one wheel-notch step each way),
**pan** (20 moves the way the planner pans — B1440's anchor, one translate per move, one re-bake at release), **mode** (the limit
mode switch), **move** (a building drag, 10 moves + release). Numbers come from a CDP trace of the renderer main thread (self time
per class — a forced layout inside a script counts as layout, not twice) plus in-page counters. The run is VOID unless a known
120 ms block reads as ≥ 120 ms. "Before" is `main` at 2d9ba19, "after" the same base with this round's changes (round 10 of
grading landed during the session; the exactness test and the guard were re-run on the merged code).

## The table (4× throttle, production build, before → after)

| mode | view | phase | wall ms (before → after) | main-thread ms | longest task ms | scripting ms | style+layout | paint | composite | React commits | surface rebuilds | worker jobs | job MB | picture re-encodes | DOM (canvas) | contour paths | image Mpx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| layout | 500 ft | open | 11543 → 10489 | 10157 → 9236 | 240 → 221 | 8970 → 8058 | 90 → 85 | 14 → 11 | 87 → 69 | 23 → 24 | 1 → 1 | buildable×1 band-outline×1 contours-proposed×1 | 1.51 | 3 → 3 | 137 (66) | 7 | 0.6 |
| layout | 500 ft | zoom-in | 30 → 22 | 25 → 17 | 11 → 8 | 11 → 8 | 4 → 2 | 1 → 1 | 1 → 0 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 137 (66) | 7 | 0.9 |
| layout | 500 ft | zoom-out | 30 → 13 | 26 → 9 | 10 → 5 | 12 → 6 | 3 → 1 | 3 → 0 | 1 → 0 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 137 (66) | 7 | 0.6 |
| layout | 500 ft | pan | 363 → 364 | 289 → 216 | 18 → 16 | 167 → 73 | 23 → 31 | 25 → 21 | 16 → 28 | 22 → 22 | 0 → 0 | — | 0.00 | 0 → 0 | 137 (66) | 7 | 0.6 |
| layout | 500 ft | mode | 2532 → 2790 | 2103 → 2339 | 72 → 60 | 1823 → 1972 | 14 → 15 | 6 → 6 | 17 → 21 | 10 → 10 | 1 → 1 | band-outline×1 contours-proposed×1 | 0.52 | 4 → 3 | 142 (73) | 10 | 1.1 |
| layout | 500 ft | move | 401 → 280 | 395 → 266 | 38 → 23 | 283 → 162 | 24 → 24 | 20 → 17 | 7 → 6 | 18 → 20 | 0 → 0 | — | 0.00 | 10 → 0 (during moves 10 → 0) | 137 (66) | 7 | 0.6 |
| layout | 125 ft | open | 12914 → 10486 | 11421 → 9305 | 221 → 285 | 10082 → 8032 | 99 → 96 | 15 → 15 | 99 → 80 | 25 → 25 | 1 → 1 | buildable×1 band-outline×1 contours-proposed×1 | 1.51 | 3 → 3 | 274 (203) | 7 | 9.7 |
| layout | 125 ft | zoom-in | 39 → 46 | 34 → 35 | 14 → 17 | 19 → 13 | 6 → 6 | 2 → 2 | 2 → 1 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 324 (253) | 32 | 15.2 |
| layout | 125 ft | zoom-out | 36 → 30 | 31 → 23 | 13 → 10 | 15 → 10 | 6 → 5 | 2 → 2 | 1 → 1 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 274 (203) | 7 | 9.7 |
| layout | 125 ft | pan | 364 → 352 | 290 → 199 | 14 → 12 | 155 → 62 | 25 → 23 | 32 → 39 | 18 → 19 | 22 → 22 | 0 → 0 | — | 0.00 | 0 → 0 | 274 (203) | 7 | 9.7 |
| layout | 125 ft | mode | 3042 → 2808 | 2561 → 2386 | 62 → 73 | 2240 → 2071 | 16 → 14 | 4 → 3 | 33 → 17 | 10 → 10 | 1 → 1 | band-outline×1 contours-proposed×1 | 0.52 | 4 → 3 | 283 (214) | 10 | 17.4 |
| layout | 125 ft | move | 412 → 241 | 403 → 234 | 34 → 13 | 259 → 133 | 50 → 26 | 30 → 23 | 9 → 8 | 13 → 17 | 0 → 0 | — | 0.00 | 10 → 0 (during moves 10 → 0) | 274 (203) | 7 | 9.7 |
| layout | 50 ft | open | 13152 → 10716 | 11550 → 9434 | 192 → 252 | 10127 → 8209 | 90 → 90 | 19 → 15 | 96 → 84 | 25 → 25 | 1 → 1 | buildable×1 band-outline×1 contours-proposed×1 | 1.51 | 3 → 3 | 325 (254) | 32 | 60.6 |
| layout | 50 ft | zoom-in | 49 → 44 | 47 → 37 | 22 → 16 | 22 → 15 | 10 → 7 | 3 → 2 | 2 → 2 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 325 (254) | 32 | 94.7 |
| layout | 50 ft | zoom-out | 61 → 53 | 54 → 46 | 29 → 21 | 28 → 20 | 14 → 11 | 2 → 4 | 0 → 3 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 325 (254) | 32 | 60.6 |
| layout | 50 ft | pan | 404 → 341 | 384 → 189 | 20 → 8 | 208 → 48 | 40 → 24 | 50 → 41 | 27 → 27 | 22 → 22 | 0 → 0 | — | 0.00 | 0 → 0 | 325 (254) | 32 | 60.6 |
| layout | 50 ft | mode | 2599 → 2678 | 2136 → 2276 | 75 → 87 | 1886 → 1975 | 17 → 16 | 6 → 8 | 21 → 19 | 10 → 10 | 1 → 1 | band-outline×1 contours-proposed×1 | 0.52 | 4 → 3 | 356 (287) | 46 | 108.5 |
| layout | 50 ft | move | 376 → 272 | 367 → 258 | 28 → 20 | 263 → 150 | 33 → 38 | 20 → 15 | 9 → 11 | 16 → 20 | 0 → 0 | — | 0.00 | 10 → 0 (during moves 10 → 0) | 325 (254) | 32 | 60.6 |
| boundary | 500 ft | open | 29075 → 20008 | 25616 → 17838 | 257 → 233 | 23120 → 15895 | 122 → 104 | 17 → 13 | 219 → 141 | 25 → 25 | 1 → 1 | buildable×1 band-outline×1 contours-proposed×1 | 1.51 | 3 → 3 | 142 (73) | 10 | 1.1 |
| boundary | 500 ft | zoom-in | 30 → 22 | 27 → 15 | 13 → 7 | 13 → 7 | 3 → 2 | 1 → 1 | 2 → 0 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 142 (73) | 10 | 1.7 |
| boundary | 500 ft | zoom-out | 30 → 15 | 27 → 15 | 14 → 6 | 12 → 6 | 3 → 4 | 1 → 1 | 1 → 1 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 142 (73) | 10 | 1.1 |
| boundary | 500 ft | pan | 336 → 352 | 253 → 169 | 8 → 9 | 145 → 59 | 21 → 22 | 22 → 22 | 18 → 16 | 22 → 22 | 0 → 0 | — | 0.00 | 0 → 0 | 142 (73) | 10 | 1.1 |
| boundary | 500 ft | mode | 2069 → 1681 | 1747 → 1430 | 81 → 75 | 1504 → 1229 | 11 → 13 | 5 → 3 | 22 → 9 | 10 → 10 | 1 → 1 | band-outline×1 contours-proposed×1 | 0.52 | 4 → 3 | 137 (66) | 7 | 0.6 |
| boundary | 500 ft | move | 357 → 216 | 352 → 208 | 43 → 11 | 261 → 128 | 20 → 17 | 16 → 17 | 9 → 9 | 15 → 20 | 0 → 0 | — | 0.00 | 10 → 0 (during moves 10 → 0) | 142 (73) | 10 | 1.1 |
| boundary | 125 ft | open | 30613 → 20379 | 27001 → 18220 | 197 → 206 | 24351 → 16173 | 113 → 117 | 14 → 19 | 235 → 161 | 25 → 23 | 1 → 1 | buildable×1 band-outline×1 contours-proposed×1 | 1.51 | 3 → 3 | 279 (210) | 10 | 17.4 |
| boundary | 125 ft | zoom-in | 39 → 34 | 37 → 33 | 18 → 15 | 18 → 14 | 9 → 8 | 2 → 2 | 1 → 2 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 353 (284) | 46 | 27.1 |
| boundary | 125 ft | zoom-out | 47 → 28 | 44 → 26 | 22 → 12 | 22 → 12 | 9 → 4 | 3 → 1 | 2 → 1 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 279 (210) | 10 | 17.4 |
| boundary | 125 ft | pan | 384 → 381 | 328 → 296 | 16 → 18 | 174 → 100 | 34 → 37 | 34 → 28 | 23 → 33 | 22 → 22 | 0 → 0 | — | 0.00 | 0 → 0 | 279 (210) | 10 | 17.4 |
| boundary | 125 ft | mode | 2713 → 2454 | 2355 → 2206 | 118 → 182 | 1992 → 1788 | 14 → 26 | 8 → 8 | 21 → 18 | 10 → 10 | 1 → 1 | band-outline×1 contours-proposed×1 | 0.52 | 4 → 3 | 272 (201) | 7 | 9.7 |
| boundary | 125 ft | move | 444 → 453 | 427 → 446 | 29 → 22 | 282 → 240 | 48 → 76 | 27 → 44 | 11 → 15 | 18 → 18 | 0 → 0 | — | 0.00 | 10 → 0 (during moves 10 → 0) | 279 (210) | 10 | 17.4 |
| boundary | 50 ft | open | 28848 → 21067 | 25467 → 18700 | 228 → 288 | 22915 → 16517 | 111 → 122 | 14 → 16 | 199 → 160 | 25 → 25 | 1 → 1 | buildable×1 band-outline×1 contours-proposed×1 | 1.51 | 3 → 3 | 353 (284) | 46 | 108.5 |
| boundary | 50 ft | zoom-in | 38 → 37 | 36 → 33 | 14 → 16 | 14 → 16 | 7 → 6 | 2 → 2 | 1 → 1 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 353 (284) | 46 | 169.6 |
| boundary | 50 ft | zoom-out | 29 → 36 | 26 → 32 | 11 → 12 | 11 → 15 | 6 → 6 | 2 → 4 | 2 → 1 | 1 → 1 | 0 → 0 | — | 0.00 | 0 → 0 | 353 (284) | 46 | 108.5 |
| boundary | 50 ft | pan | 345 → 374 | 300 → 267 | 12 → 17 | 148 → 75 | 26 → 37 | 33 → 41 | 26 → 43 | 22 → 22 | 0 → 0 | — | 0.00 | 0 → 0 | 353 (284) | 46 | 108.5 |
| boundary | 50 ft | mode | 1913 → 1663 | 1607 → 1443 | 77 → 71 | 1386 → 1224 | 12 → 23 | 4 → 8 | 12 → 11 | 10 → 10 | 1 → 1 | band-outline×1 contours-proposed×1 | 0.52 | 4 → 3 | 322 (251) | 32 | 60.8 |
| boundary | 50 ft | move | 338 → 232 | 331 → 211 | 22 → 12 | 227 → 132 | 32 → 22 | 21 → 18 | 8 → 8 | 17 → 19 | 0 → 0 | — | 0.00 | 10 → 0 (during moves 10 → 0) | 353 (284) | 46 | 108.5 |

"Main-thread ms" for **pan** is the 20 moves + the release (÷ 21 for per move). For **move** it includes the release, which starts
the re-grade; the per-move rule is judged by the counts ("picture re-encodes during moves").

## The top five costs, by ms

1. **The FFE suggestion on open — ~20 surface builds.** `suggestFfe` bisects for the dirt-balancing finish elevation and then
   refines over five 0.1-ft steps, building the WHOLE surface each time: ~6.9 s of ~11.4 s main-thread time at layout / 125 ft
   (inclusive, CPU profile), and most of ~27 s in "To the boundary". **Fixed in part** (B2596705 a): the geometry half of each
   build is now recorded once per geometry — ~33% off the boundary open, ~15% off layout. **Still over budget: B2596707.**
2. **The open's own surface build + contour lattice** — ~1 s. Unchanged (it is the picture).
3. **One React render task on open, 190–290 ms**, building the cut/fill tint and the paper background in `useMemo`s. **Not fixed —
   B2596708** (a parallel grading session was in the same file that night).
4. **The cut/fill picture re-built on every drag move** — its memo keyed on a per-move `facts` Map. **Fixed** (B2596705 b):
   re-encodes during 10 moves 10 → 0, at every view and mode.
5. **The grading canvas + panel re-rendered on every pan move.** **Fixed** (B2596705 c): memoised canvas; panel behind a
   stable-callback wrapper. Pan scripting roughly halved; 8–14 ms of main-thread work per move, inside the 16 ms budget.

**Not where the brief expected:** a **zoom step** costs 22–88 ms and never rebuilds the surface — contours are traced once per
surface (already in the grading worker with transferred Float32Arrays), so there was no per-density re-trace to memoise. The
**band / contour tracing** is already off the main thread. **Canvas backing store** is not a factor — the grading picture is one
SVG `<image>`, and paint stays ~1.5 ms a frame even with ~108 Mpx of image at the 50-ft view. The **parcel / zoning / FEMA layer
draws** cannot be measured on this harness (no Leaflet; the sandbox reaches no county GIS); the Olive Branch session measured them
live (B2559952: zero GIS requests while the pointer is down) and owns the remainder (B2559954) — not duplicated here.

## Budgets (ui-audit/planner-perf-budget.json) and where each stands

| budget (4×, owner's geometry) | status |
|---|---|
| pan ≤ 16 ms main-thread work per move, nothing recomputed per move | ✅ 8–14 ms; 0 rebuilds, 0 jobs, 0 re-encodes, 1.1 commits/move |
| zoom step: picture ≤ 1.5 s, never re-runs the surface | ✅ 22–88 ms, 0 rebuilds |
| mode switch: picture ≤ 3 s | ✅ 1.7–2.8 s |
| building drag: nothing rebuilt or re-encoded per move | ✅ 0 / 0 (was 10 re-encodes per 10 moves) |
| open → picture ≤ 4 s | ❌ ~10 s layout, ~20 s boundary — **B2596707** (ratchet 24 s) |
| no task > 50 ms outside `runChunked` | ❌ 190–290 ms on open — **B2596708** (ratchet 320 ms) |

The guard (`ui-audit/verify-planner-perf.mjs`) runs the COUNTS in the required build check and the timings on demand
(`npm run perf:planner`); both halves run a known-slow arm (`?perfMutant=1`) that must fail, or the run is VOID.
