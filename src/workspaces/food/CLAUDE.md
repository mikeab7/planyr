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
  proven (`db/test/food_rls.test.sql` tests 12-16); the VisitPanel UI wiring (under "Order again")
  is the one piece deliberately held back this session — see `BACKLOG.md` for why.
- **Fallback for what the snapshot misses:** `lib/overpass.js` queries OpenStreetMap's
  Overpass API — free, no key. Cached per bbox for the session and **never called from a
  pan/zoom handler**, only from an explicit "search live for more here" press (`FoodMap.jsx`)
  — the fair-use ask is "don't hammer it", and an automatic re-query on every drag would.

**Files**
- `FoodApp.jsx` — workspace root (lazy chunk). Owns view state (map/list), the visit CRUD
  flow, and the manual-pin drop flow. No projects, no cross-workspace navigation — this module
  is deliberately outside the Site Planner's project model.
- `components/FoodMap.jsx` — Leaflet map (OpenStreetMap tiles, free), canvas-rendered pins
  (not SVG — the snapshot query can return up to ~2,000 points). Logged vs not-yet-logged vs
  manual pins are three distinct colors, per the brief.
- `components/VisitPanel.jsx` — click a pin, see past visits, log another. A right-side panel,
  never a dialog box (`window.prompt`/`confirm` are banned app-wide).
- `components/VisitList.jsx` — every visit, searchable by name, sortable by date/rating/cost.
- `lib/foodStore.js` — the one seam to Supabase: place/visit queries, visit CRUD, the manual-
  pin grouping and the logged-id set the map colors pins by.
- `lib/overpass.js` — the Overpass fallback (see above).
- `lib/supabaseClient.js` — this module's own client. See BUNDLE ISOLATION above for why it
  isn't the site-planner's.
- `db/food.sql` — the applied migration (production, `lyeqzkuiwngunutlkkmi`). `db/test/food_rls.test.sql` — the RLS proof.

**Explicitly out of scope** — do not build, do not scaffold: photo upload, sharing/social,
other people's reviews, recommendations, any AI, offline/PWA mode. If a future ask needs one of
these, it's a new decision, not an extension of this module.
