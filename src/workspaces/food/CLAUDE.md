# Food workspace — folder pointer

`/food` (B568400) — a private, personal place-tracker, completely unrelated to the Site
Planner. The owner: track the places he's eaten, on a map, click a pin to log what he had,
rate it, note the cost. Internal id `food`, route `#/food`, chili-red accent `--accent-food`.

**⛔ BUNDLE ISOLATION is this module's one hard rule.** Nothing under `src/workspaces/food/`
may import from `src/workspaces/site-planner/` — not the Supabase client, not a util, nothing.
That's why `lib/supabaseClient.js` is a three-line duplicate of the site-planner one instead of
an import: a shared edge would hoist this module's bytes onto the Site route, and the owner was
explicit that a restaurant tracker may not cost that route a single byte. `FoodApp.jsx` is its
own `React.lazy` entry in the app Shell's workspace registry, measured separately forever as
`foodRouteJsBytes` (the bundle-metrics module's `ROUTE_KEYS`).

**Data has two very different shapes, and the RLS split follows the shape:**
- `food_places` — the reference snapshot. **Public read, service-role write only** (same
  design as the site-planner's `thoroughfare_segments` reference table) — loaded once (not a
  live API call) from Overture Maps' open Places dataset by `scripts/load-food-places.py`,
  filtered to the Houston metro and to the `food_and_drink` taxonomy group. Re-run that script
  once or twice a year to refresh it; it is documented in its own header, including why it's
  Python and not Node (remote GeoParquet row-group pruning needs pyarrow's column stats).
- `food_visits` — the owner's own log (rating, cost, what he had, notes). **Owner-only RLS**,
  the exact own-row shape as the site-planner's `profiles`/user-prefs tables
  (`(select auth.uid()) = user_id`, `to authenticated`, no anon policy at all). Deliberately
  **not** covered by the site-planner's default-team-sharing path (B326416) — this table has no
  `project_id` and joins nothing team-shaped, so it's exempt by construction. Proven with a
  self-rolling-back SQL test (`db/test/food_rls.test.sql`): anon sees zero visits, a second
  signed-in user sees zero of the owner's visits and can't update them either.
- `food_dishes` (B1873008, 2026-09-27) — per-dish ratings on a visit: name, course, score
  (numeric(3,1), HALF-point steps, 1.0–10.0 — the owner's own original scale, distinct from
  `food_visits.rating`'s later-widened quarter-point steps), order_again, price_cents, note.
  Owner-only RLS, own-row, the same four-policy shape as `food_visits`. `place_id` is
  **denormalised from the visit by a DB trigger** (`food_dishes_before_write()`) — never trusted
  from the client, and it raises loudly on a forged/cross-user `visit_id` rather than writing a
  wrong value. `food_visits.rating`/`what_i_had`/`what_was_good` are **never touched** by this
  table — a dish's score is its own; see `lib/dishAggregates.js`'s own header. Also finally wires
  up `food_dish_wishlist`'s UI (auto-marks a matching open entry done on save) — the piece NEW-3
  below deliberately held back.
- A **manual pin** ("no dataset has the taco truck") is a `food_visits` row with `place_id`
  null and `custom_name`/`custom_lat`/`custom_lon` set — never a row minted in `food_places`,
  which stays service-role-write-only. `lib/foodStore.js`'s `manualPinsFromVisits` groups a
  user's manual visits by (name, rounded lat/lon) so a second visit at the same spot is a
  click on the same pin, not a new one.
- `food_wishlist` (B669312) — a THIRD table: "want to try" flags. Owner-only RLS, own-row, same
  shape as `food_visits`. A flag can't live on `food_places` (no `user_id`) and can't be a
  `food_visits` row (a want-to-try place has zero visits by definition — a row there would
  corrupt every visit count/average). One row per (user, place) or (user, manual pin), enforced
  by a unique index, not just the UI. The flag clears automatically the moment a real visit is
  logged (`FoodApp.jsx`'s `submitVisit`). The "flagged" state is a plain client-side Set built
  from one small bulk fetch (`fetchAllWishlist`), exactly like `loggedPlaceIds` already is for
  visits — no RPC join, so `food_places_in_bounds_sampled`/`food_places_search_by_name` are
  untouched.
- `food_dish_wishlist` (NEW-3, 2026-08-23) — a FOURTH table: DISH-level "want to try" on a place
  he's already visited (place-level `food_wishlist` above is meaningless once visited — the
  panel hides that toggle then; a dish list replaces it). Owner-only RLS, own-row, PLUS an update
  policy (unlike `food_wishlist`) since striking a dish "done" is an in-place update. Many rows
  per place (one per dish), unique per (user, place, dish) case/whitespace-insensitive.
  `lib/foodStore.js`'s `fetchAllDishWishlist`/`addDishWishlist`/`removeDishWishlist`/
  `markDishDone`/`dishWishlistByPlaceId`/`dishWishlistByManualKey` — data layer + RLS shipped and
  proven (`db/test/food_rls.test.sql` tests 12-16); the VisitPanel UI wiring is now shipped by
  B1873008 (above) — saving a real dish under "Dishes" auto-marks a matching open entry done.
- **Fallback for what the snapshot misses:** `lib/overpass.js` queries OpenStreetMap's
  Overpass API — free, no key. Cached per bbox for the session and **never called from a
  pan/zoom handler**, only from an explicit "search live for more here" press (`FoodMap.jsx`)
  — the fair-use ask is "don't hammer it", and an automatic re-query on every drag would.

**Files**
- `FoodApp.jsx` — workspace root (lazy chunk). Owns view state (map/list), the visit CRUD
  flow, and the manual-pin drop flow. No projects, no cross-workspace navigation — this module
  is deliberately outside the Site Planner's project model.
- `components/FoodMap.jsx` — Leaflet map, canvas-rendered pins; basemap = the shared Site Plan map or Hybrid, defined in the shared basemaps registry under src/shared/ (NEW-1/B2025280 — never inline a tile URL here)
  (not SVG — the snapshot query can return up to ~2,000 points). Logged vs not-yet-logged vs
  manual pins are three distinct colors, per the brief.
- `components/VisitPanel.jsx` — click a pin, see past visits, log another. A right-side panel,
  never a dialog box (`window.prompt`/`confirm` are banned app-wide).
- `components/VisitList.jsx` — every visit, searchable by name, sortable by date/rating/cost.
- `components/DishesSection.jsx` (B1873008) — the place-detail Dishes table, its inline add/edit
  row, "The order," and the per-dish history view. Also mounts inside an editing `VisitCard` for
  the "add dishes under this visit" flow.
- `lib/keyboardInset.js`, `lib/draftDishes.js`, `lib/noAutofill.js` (B2057920, "Food on a phone") — the
  covered-by-keyboard height from `visualViewport` (BottomSheet lifts by it), the dishes typed into a
  NEW visit before it exists (`FoodApp.submitVisit` writes the visit then each dish, all-or-nothing),
  and the `autocomplete=off` + non-contact `name` props every free-text field spreads (a source sweep in
  foodPhone.test fails a field that doesn't). There is NO "What I had" input any more; old
  visits' saved `what_i_had` text stays readable and is never rewritten. At phone width ratings are a
  1-10 tap grid (`ScoreTapGrid` in ScoreMeter), desktop keeps the slider. Phone harness:
  verify-food-visit-phone (ui-audit) + its food-panel fixture page.
- `components/ScoreMeter.jsx` (B1873008) — the per-dish score control (half-point, 1.0–10.0). A
  deliberate sibling of `VisitPanel.jsx`'s own `RatingSlider`, not a replacement — see its own
  header for why the two stayed separate.
- `lib/foodStore.js` — the one seam to Supabase: place/visit queries, visit CRUD, the manual-
  pin grouping and the logged-id set the map colors pins by. Also the dish CRUD (`fetchAllDishes`/
  `insertDish`/`updateDish`/`deleteDish`) — every write strips any client-supplied `place_id`,
  since the DB trigger is the only source of truth for it.
- `lib/dishAggregates.js` (B1873008) — pure reads over already-fetched `food_dishes` rows: latest-
  score-wins grouping, "best dish here," "the order," a visit's own mean dish score. No Supabase
  import, no write call — the one file that proves a dish score can never overwrite a visit rating.
- `lib/overpass.js` — the Overpass fallback (see above).
- `lib/searchQuality.js` (B709696/B709697, 2026-08-23) — filters/ranks the whole-snapshot search
  RPC's candidates before they reach the dropdown: a word-coverage "strong match" gate (so a
  query with no real match shows the no-match state instead of ten fuzzy-similarity results),
  registry-name and confidence de-ranking, corrupted-concatenated-address exclusion, and
  near-duplicate (same real-world spot, multiple sources) collapse. Pure JS, no Supabase import —
  see its own header for the production-measured reasoning behind every threshold.
- `lib/placeIdentity.js` (B2046224) — pure "is this a restaurant he ALREADY has?": normalised-name
  (case/apostrophes/punctuation/diacritics-blind) AND within 300 m — never name alone (chains) or distance
  alone. `mergeSearchRows` gives the search dropdown ONE row per restaurant (a snapshot hit that is really
  his manual pin shows as the pin), `findExisting` backs `FoodApp.openPlace`, and `addressKey` (B2070432) makes same name + same street address one place even when a source geocoded it kilometres off; `canonicalIdentity` is the
  SAVE-PATH GUARD every visit save and want-to-try flag resolves through, so no route mints a second record.
- Phone behaviour (B2046224): the toolbar is exactly one screen wide on a narrow viewport (search field flexes,
  pin button reads "Pin") so focusing it can't scroll the header row; `FoodMap`'s flyTo has NO horizontal shift on a
  phone (the panel is a bottom sheet) and re-centres above the sheet once it reports its height. Real-browser proof:
  the verify-food-phone harness in the repo-root ui-audit folder (WebKit iPhone descriptors + its foodFixture helper, a fully mocked signed-in
  Supabase — build with `VITE_SUPABASE_URL=https://plnrtestfood123456.supabase.co VITE_SUPABASE_ANON_KEY=fixture-anon`).
- `lib/searchProximity.js` (B2051664) — orders the merged search list (saved + snapshot + live) nearest the visible map first (B2070432: his saved places that really match LEAD, wherever the map looks): text band (exact name/address on top) → in-view → distance from centre, with a small head start for his own places. A bias, never a filter; client-side because the RPC has no viewport parameter. Pure JS.
- `lib/supabaseClient.js` — this module's own client. See BUNDLE ISOLATION above for why it
  isn't the site-planner's.
- `db/food.sql` — the applied migration (production, `lyeqzkuiwngunutlkkmi`). `db/test/food_rls.test.sql` — the RLS proof.

**Explicitly out of scope** — do not build, do not scaffold: photo upload, sharing/social,
other people's reviews, recommendations, any AI, offline/PWA mode. If a future ask needs one of
these, it's a new decision, not an extension of this module.
