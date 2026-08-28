-- Food place tracker (B568400) — a private, personal place-tracker: browse food places on a
-- map, click one to log a visit (rating, cost, notes). Run once in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi). Idempotent: safe to re-run.
--
-- TWO TABLES, two different RLS shapes, deliberately:
--   food_places — the reference snapshot (Overture Maps, loaded once by scripts/load-food-
--                 places.py). PUBLIC READ, service-role write only — same shape as
--                 site-planner/db/thoroughfare_segments.sql (a jurisdiction's thoroughfare
--                 plan is the same for every user; a restaurant's location is too).
--   food_visits — the owner's own log: what he had, what he thought, what it cost.
--                 OWNER-ONLY RLS, own-row (the exact profiles.sql / user_prefs.sql shape:
--                 `(select auth.uid()) = user_id`, `to authenticated`, no anon policy at all).
--                 Deliberately NOT covered by B326416's default-shared-project path: this
--                 table has no project_id, no team_share_state join, no project_shares
--                 join anywhere near it — exempt by construction, not by a flag that could
--                 later be flipped.

create extension if not exists postgis with schema extensions;

-- ── food_places: public reference data (Overture Maps snapshot; manual pins live in
--    food_visits instead, never written here from the browser) ──────────────────────────────
create table if not exists public.food_places (
  id             text primary key,             -- Overture GERS id
  name           text not null,
  lat            double precision not null,
  lon            double precision not null,
  metro          text not null,                -- which registered metro loaded this row (scripts/load-food-places.py's METROS) — 'Houston' / 'Dallas-Fort Worth' / 'Austin'
  category       text,                         -- Overture categories.primary, e.g. 'mexican_restaurant'
  cuisine        text,                         -- Overture taxonomy.hierarchy tail, e.g. 'taco_restaurant'
  address        text,
  brand          text,
  source         text,                         -- contributing dataset, e.g. 'meta' / 'Foursquare' / 'AllThePlaces'
  source_licence text,                         -- that source's licence, e.g. 'CDLA-Permissive-2.0' / 'Apache-2.0' / 'CC0-1.0'
  confidence     double precision,
  geom           extensions.geography(Point, 4326)
                   generated always as (
                     extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography
                   ) stored,
  created_at     timestamptz not null default now()
);

create index if not exists food_places_geom_idx     on public.food_places using gist (geom);
create index if not exists food_places_category_idx on public.food_places (category);
create index if not exists food_places_metro_idx    on public.food_places (metro);

alter table public.food_places enable row level security;

do $$ begin
  create policy "Public read food_places" on public.food_places
    for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

-- SELECT only — no insert/update/delete grant, so writes stay service-role-only (the load
-- script authenticates with the service_role key, which bypasses RLS entirely).
grant select on public.food_places to anon, authenticated;

-- ── food_visits: the owner's private log. Owner-only RLS, own-row. ─────────────────────────
create table if not exists public.food_visits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  place_id     text references public.food_places(id) on delete set null,  -- null = manual pin
  custom_name  text,             -- manual-pin name (only set when place_id is null)
  custom_lat   double precision,
  custom_lon   double precision,
  visited_on   date,  -- nullable, no default: NEVER pre-fill today's date (owner, 2026-08-18: "i want
                       -- to rate restaurants i've been to before and don't remember the date i visited")
  rating       numeric(3,1) check (rating is null or (rating between 1 and 10 and rating * 2 = round(rating * 2))),
                       -- half-point steps (owner, 2026-08-18: "let me pick intervals of .5 too");
                       -- numeric not smallint, matching this table's own `cost numeric(8,2)` precedent
  rating_ambiance numeric(3,1) check (rating_ambiance is null or (rating_ambiance between 1 and 10 and rating_ambiance * 2 = round(rating_ambiance * 2))),
                       -- a SECOND, independent rating (owner, 2026-08-19: "add an ambiance rating too,
                       -- matching scale") -- same 1-10 half-point representation as `rating`, entirely
                       -- optional and independent of it. The MAP PIN stays keyed to `rating` (food) only
                       -- -- this column is never read by avgRatingByPlaceId/manualPinsFromVisits.
  cost         numeric(8,2),
  what_i_had   text,
  what_was_good text,  -- the SHORTLIST of what's worth ordering again -- deliberately separate from
                       -- what_i_had (owner, 2026-08-19: "'What I had' is the record of the meal; this
                       -- is the shortlist of what was actually GOOD... he orders four things and two
                       -- are worth repeating"). Free text, same weight/shape as what_i_had, never merged
                       -- with it. The PLACE panel aggregates this across every visit at that place
                       -- (VisitPanel.jsx) rather than burying it one visit deep.
  notes        text,
  would_return boolean,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint food_visits_place_or_manual check (place_id is not null or custom_name is not null)
);

create index if not exists food_visits_user_idx  on public.food_visits (user_id);
create index if not exists food_visits_place_idx on public.food_visits (place_id);

alter table public.food_visits enable row level security;

drop policy if exists "Users select own food_visits" on public.food_visits;
drop policy if exists "Users insert own food_visits" on public.food_visits;
drop policy if exists "Users update own food_visits" on public.food_visits;
drop policy if exists "Users delete own food_visits" on public.food_visits;

create policy "Users select own food_visits" on public.food_visits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own food_visits" on public.food_visits
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own food_visits" on public.food_visits
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own food_visits" on public.food_visits
  for delete to authenticated using ((select auth.uid()) = user_id);
-- No anon policy at all -> a signed-out request sees zero rows, always.

create or replace function public.food_visits_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists food_visits_touch on public.food_visits;
create trigger food_visits_touch before update on public.food_visits
  for each row execute function public.food_visits_touch_updated_at();

-- ── rating scale, 1-10 not 1-5 (owner redesign, 2026-08-18). `create table if not exists`
-- above won't touch an already-existing table, so an ALTER is required to actually widen it —
-- the inline `check` clause above only governs a FIRST-EVER creation of this table. Checked
-- production first: food_visits had 0 rows when this changed, so this is a pure widen, never a
-- silent rescale of anyone's real data. Idempotent: safe to re-run (drops-then-adds under the
-- same fixed name every time, so a second run just recreates the identical constraint).
alter table public.food_visits drop constraint if exists food_visits_rating_check;
alter table public.food_visits add constraint food_visits_rating_check check (rating between 1 and 10);

-- ── rating scale, HALF-POINT steps (owner request, 2026-08-18: "let me pick intervals of .5
-- too"). numeric(3,1) rather than an integer half-point count -- the column stays self-
-- explanatory (the value IS the rating, 7.5, never "15 half-points" a caller has to remember to
-- halve), matching this table's own existing `cost numeric(8,2)` precedent for decimal values --
-- including the SAME PostgREST behaviour (a `numeric` column round-trips as a JSON STRING over
-- the API to preserve precision, exactly like `cost` already does; every app-side read site that
-- computes with `rating` wraps it in Number(), the same pattern already used for `cost`).
-- Checked production first (not empty this time -- 16 real rows, ratings 7-9 only): every
-- existing value is a whole number, so `rating::numeric(3,1)` is a lossless, non-rescaling
-- widen -- an integer N trivially satisfies the new halves-only check (N*2 = round(N*2)).
-- Idempotent: safe to re-run.
alter table public.food_visits alter column rating type numeric(3,1) using rating::numeric(3,1);
alter table public.food_visits drop constraint if exists food_visits_rating_check;
alter table public.food_visits add constraint food_visits_rating_check
  check (rating is null or (rating between 1 and 10 and rating * 2 = round(rating * 2)));

-- ── food_visits.rating_ambiance (owner chat block, 2026-08-19: "add an ambiance rating too,
-- matching scale"). A SECOND, independent 1-10 half-point rating per visit -- nullable and
-- unrelated to `rating`: he must be able to rate the food and skip ambiance, or the reverse.
-- Same representation as `rating` (numeric(3,1), same halves-only check), for the identical
-- PostgREST-numeric-as-string reason documented above. ⛔ THE MAP PIN STAYS KEYED TO `rating`
-- (food) ONLY -- avgRatingByPlaceId/manualPinsFromVisits (foodStore.js) never read this column;
-- ambiance surfaces only in the panel and the list. Idempotent: safe to re-run.
alter table public.food_visits add column if not exists rating_ambiance numeric(3,1);
do $$ begin
  alter table public.food_visits add constraint food_visits_rating_ambiance_check
    check (rating_ambiance is null or (rating_ambiance between 1 and 10 and rating_ambiance * 2 = round(rating_ambiance * 2)));
exception when duplicate_object then null; end $$;

-- ── food_visits.what_was_good (owner chat block, 2026-08-19: "add a place where I can log the
-- food that I liked"). Deliberately SEPARATE from `what_i_had` -- that column is the record of
-- the meal; this is the shortlist of what's worth ordering again. Plain nullable text, no dish
-- taxonomy/entity table (owner: "KEEP IT TEXT... if you think [a taxonomy] is warranted, say so
-- and stop rather than building it" -- it is not warranted; a free-text shortlist is all this
-- asks for). Idempotent: safe to re-run.
alter table public.food_visits add column if not exists what_was_good text;

-- ── food_places.metro (owner chat block, 2026-08-18: "add dallas and austin too" -- which
-- metro registered by scripts/load-food-places.py's METROS loaded this row). The inline column
-- above only governs a first-ever create; the already-existing production table needs an
-- explicit ADD + backfill. Checked first: every existing row is Houston-only (lon range
-- -95.998 to -94.602, confirmed against the table before this ran), so the backfill is exact,
-- not a guess. Idempotent: safe to re-run (the UPDATE only ever touches still-null rows).
alter table public.food_places add column if not exists metro text;
update public.food_places set metro = 'Houston' where metro is null;
alter table public.food_places alter column metro set not null;
create index if not exists food_places_metro_idx on public.food_places (metro);

-- ── food_places_in_bounds_sampled (NEW-4) — a VIEWPORT-WIDE, PROPORTIONALLY-DISTRIBUTED
-- capped read. The plain "just add ORDER BY" fix is wrong here: an ORDER BY id/name/whatever
-- still returns an arbitrary prefix that happens to sit wherever those ids/names cluster. So
-- this partitions the bbox into a p_grid × p_grid lattice (default 8×8 = 64 cells) — but each
-- cell's SHARE OF THE CAP IS PROPORTIONAL TO ITS OWN TRUE COUNT, not a flat 1/64th each.
-- ⛔ THE FLAT VERSION WAS ITSELF A BIASED SLICE, MEASURED (owner report 2026-08-18, "focusing on
-- showing places in the middle of the screen... the distribution is uneven"): giving every cell
-- the SAME fixed cap (p_cap/64) meant a dense cell (e.g. 1,959 real places) returned only ~6%
-- of its true content while a sparse cell (114 real places) returned ~88% — over a real
-- production viewport, coverage fraction ranged 0.063–0.877 cell to cell, a >13x disparity.
-- Weighting each cell's cap by `cell_count / total_matched` (both cheap window functions on the
-- SAME scan) flattened that to a near-constant ~0.23 across every cell in the identical test —
-- a genuinely representative sample of the viewport, not a shape that favors wherever a cell
-- happens to be dense or centrally located. `total_matched` still rides along free, so the
-- client can say "showing 2,000 of 30,620" instead of silently truncating. SECURITY INVOKER
-- (the default) — runs under the caller's own RLS, and food_places is already public-read, so
-- this grants no new access.
--
-- ⛔ THE VIEWPORT PREDICATE (rewritten 2026-08-18, B632178 — verified before adding Dallas-Fort
-- Worth and Austin, per the owner's instruction not to trust it silently: "confirm this does
-- not slow the map... check the query plan uses the index"). The original `where lat >= ...
-- and lat <= ... and lon >= ... and lon <= ...` never touched `geom` at all, so the table's own
-- GIST spatial index (`food_places_geom_idx`, defined above, since the table's FIRST migration)
-- sat there unused — every neighbourhood-zoom pan was a SEQUENTIAL SCAN. Measured directly
-- against production on the 34k-row Houston-only table: 727ms for a plain range filter over a
-- neighbourhood box. Rewriting to `geom && ST_MakeEnvelope(...)::geography` -- the bounding-box
-- overlap operator PostGIS's GIST opclass actually indexes -- measured at 86ms for the
-- IDENTICAL result set on the SAME query, confirmed via EXPLAIN ANALYZE to be a
-- `Bitmap Index Scan on food_places_geom_idx`, not a table scan. This is the fix that lets the
-- table roughly triple (Houston + Dallas-Fort Worth + Austin) without the map degrading --
-- an index scan's cost tracks the RESULT size, not the TABLE size, unlike a sequential scan.
create or replace function public.food_places_in_bounds_sampled(
  p_south double precision, p_west double precision,
  p_north double precision, p_east double precision,
  p_cap integer default 2000, p_grid integer default 8
)
returns table (
  id text, name text, lat double precision, lon double precision,
  category text, cuisine text, address text, brand text,
  source text, source_licence text, total_matched bigint
)
language sql stable as $$
  with matched as (
    select id, name, lat, lon, category, cuisine, address, brand, source, source_licence,
      width_bucket(lat, p_south, p_north, greatest(p_grid, 1)) as gy,
      width_bucket(lon, p_west, p_east, greatest(p_grid, 1)) as gx
    from public.food_places
    where geom && extensions.st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::extensions.geography
  ),
  counted as (
    select *,
      count(*) over (partition by gy, gx) as cell_count,
      count(*) over () as total_matched
    from matched
  ),
  ranked as (
    select *, row_number() over (partition by gy, gx order by id) as rn
    from counted
  )
  select id, name, lat, lon, category, cuisine, address, brand, source, source_licence, total_matched
  from ranked
  where rn <= greatest(1, ceil(p_cap::numeric * cell_count / greatest(total_matched, 1)))
  order by gy, gx, rn
  limit p_cap;
$$;

grant execute on function public.food_places_in_bounds_sampled(
  double precision, double precision, double precision, double precision, integer, integer
) to anon, authenticated;

-- ── food_places_search_by_name (owner chat block, 2026-08-18: "add a search bar to search
-- restaurants... the entire point of search is finding a place you cannot see" -- so this
-- searches the WHOLE 34,000+-row snapshot, never scoped to the current viewport, unlike the
-- bounds-based RPC above). TRIGRAM WORD-SIMILARITY, not a plain ILIKE prefix search: a
-- restaurant name is usually multiple words ("Bandito's Taco Grill"), and the owner is far more
-- likely to type one distinctive word ("taco") than the exact start of the string -- pg_trgm's
-- word_similarity()/`<%` finds the best-matching SUBSTRING of a longer name against a short
-- query, which a prefix index cannot. Chose a GIN index on lower(name) (not GiST): GIN is
-- slower to build/update but faster to QUERY, and this table is bulk-loaded ~once or twice a
-- year (see the module's CLAUDE.md) -- read-heavy by a wide margin, so GIN is the right trade.
-- Measured directly against production (34k+ rows): a real query like 'taco' or 'sushi' returns
-- in ~30-50ms via the index (confirmed with EXPLAIN ANALYZE -- Bitmap Index Scan on
-- food_places_name_trgm_idx, not a sequential scan), comfortably inside a debounced search box's
-- budget. threshold 0.3 (word_similarity's default is 0.6, which is tuned for whole-document
-- search and misses short, close variants like "mcdon" -> "McDonald's" at 0.83) -- loose enough
-- for typo/partial tolerance, tight enough that a nonsense query returns nothing rather than
-- padding out the cap with noise (verified: 'zzznonexistentxyz' returns zero rows).
create extension if not exists pg_trgm;

create index if not exists food_places_name_trgm_idx
  on public.food_places using gin (lower(name) gin_trgm_ops);

-- ⛔ DISTANCE-AWARE SEARCH RANKING (B632178, owner chat block 2026-08-18, once the snapshot
-- spanned three metros: "Searching Torchy's must not return fifteen indistinguishable rows...
-- results in or near the current map view should rank above far-away ones"). Every location of
-- a searched chain scores an IDENTICAL trigram similarity (the name text is the same), so
-- without a centre point they'd fall back to alphabetical order. `p_center_lat`/`p_center_lon`
-- (the current map view's midpoint, optional) add a `distance_km` column and break ties by it --
-- NAME RELEVANCE STILL COMES FIRST (`order by sim desc, distance_km asc nulls last`): a worse
-- name match never outranks a better one just for being closer. Also now returns `metro`, so a
-- chain search across three metros can show which city each result is in.
--
-- ⛔ B634980 (self-discovered 2026-08-19): this file DRIFTED from production after B632178 -- the
-- rewrite above was applied directly to the live database (confirmed via `pg_get_functiondef`)
-- but the matching edit to THIS file was lost before it was ever committed, so the version that
-- shipped to git was still the old 2-arg, no-distance function. AUDIT-FIRST caught it while
-- starting on an unrelated request: re-reading this file to plan the next change surfaced that it
-- no longer matched what `execute_sql` had just shown was actually live. Fixed by rewriting this
-- definition to match production byte-for-byte rather than re-deriving it from memory.
--
-- The OLD 2-arg overload (`food_places_search_by_name(text, integer)`) must be DROPPED, not just
-- replaced -- Postgres treats a different parameter list as a distinct OVERLOAD, not a
-- replacement, so `create or replace` alone would leave both versions callable side by side.
drop function if exists public.food_places_search_by_name(text, integer);

-- ⛔ B709697 (owner report, 2026-08-23: searching "fadis" surfaced a corrupted 0.77-confidence
-- Foursquare row -- two street addresses concatenated into one field with "and", coordinates
-- matching NEITHER address -- ahead of two clean 0.99-confidence records for the same brand).
--
-- Two independent fixes, both scoped to this search RPC (the reported bug is search-triggered;
-- browsing the map via food_places_in_bounds_sampled is untouched):
--   1) `confidence` now rides along in the output. The RANKING itself (word-coverage "strong
--      match" filtering, confidence/registry-name de-ranking, near-duplicate collapse) lives
--      client-side in lib/searchQuality.js, not here -- it needs per-candidate JS logic (typo-
--      tolerant word matching, haversine clustering) that's clearer and more testable as a pure
--      JS module than a bigger SQL function, and the candidate set is already capped small
--      (p_cap, default 15) so there's no performance reason to push it into the query.
--   2) Corrupted concatenated-address rows are excluded here too, not just client-side --
--      measured directly against production: only 2 rows currently match this shape (the report
--      estimated 37 from an earlier sample; the snapshot reloads periodically per this module's
--      CLAUDE.md, so the counts drift -- AUDIT-FIRST: recorded here rather than silently matched
--      to the old number). The pattern is deliberately narrow -- it requires a REAL zip code
--      immediately followed by "and" and a second house number, so it does NOT fire on a Texas
--      place name that happens to contain the word "and" ("Cut and Shoot, TX", "Town and Country
--      Way", both real and common in this snapshot).
--
-- ⛔ WHY THIS IS TWO FUNCTIONS NOW (`_raw` + a thin wrapper), NOT ONE -- READ BEFORE "SIMPLIFYING"
-- THIS BACK TO A SINGLE DROP-AND-RECREATE. `confidence` is a new output column, a return-type
-- change, which Postgres cannot apply via `create or replace` -- it has to be dropped and
-- recreated. But this function's own tuning (`set pg_trgm.word_similarity_threshold = 0.3`,
-- loosened from pg_trgm's 0.6 default for typo/partial tolerance -- see the ORIGINAL 2-arg-drop
-- comment above) requires a privilege that even this project's `postgres` role does NOT hold on
-- Supabase's hosted platform (confirmed live, 2026-08-23: `rolsuper = false` for that role;
-- re-issuing the identical, already-live `SET` clause via `CREATE FUNCTION` failed with `42501:
-- permission denied to set parameter "pg_trgm.word_similarity_threshold"`, from BOTH the
-- migration tool and a direct SQL session). So the word_similarity-tuned search logic is defined
-- ONCE, under `_raw`, where it can be freely `create or replace`d without ever touching that SET
-- clause again after this file first creates it; a separate, unprivileged wrapper (below) adds
-- `confidence` and the address exclusion on top. A brand-new project just gets both functions
-- created directly, in order -- the rename step right below only matters for THIS repo's already-
-- live production database, which had the search logic under the plain (now wrapper's) name
-- before this change; it's a guarded no-op everywhere else (fresh install, or re-running this
-- file after the rename has already happened once). Verified end to end against production
-- (search "fadis": the corrupted row gone from the result set; search "chiptle": the loose 0.3
-- threshold still returns "Chipotle" at sim 0.545 -- proof the rename preserved the original
-- tuning byte for byte). If the raw search logic itself ever needs to change, that edit has to go
-- through Supabase's SQL Editor (full privilege), not this file run via an automated tool.
do $$ begin
  alter function public.food_places_search_by_name(text, integer, double precision, double precision)
    rename to food_places_search_by_name_raw;
exception when undefined_function then null; -- fresh install, or already renamed by a prior run
end $$;

create or replace function public.food_places_search_by_name_raw(
  p_query text, p_cap integer default 15,
  p_center_lat double precision default null, p_center_lon double precision default null
)
returns table (
  id text, name text, lat double precision, lon double precision,
  category text, cuisine text, address text, brand text,
  source text, source_licence text, metro text, sim real, distance_km double precision
)
language sql stable
set pg_trgm.word_similarity_threshold = 0.3
as $$
  select id, name, lat, lon, category, cuisine, address, brand, source, source_licence, metro,
    word_similarity(lower(p_query), lower(name)) as sim,
    case when p_center_lat is null or p_center_lon is null then null
      else extensions.st_distance(
        geom,
        extensions.st_setsrid(extensions.st_makepoint(p_center_lon, p_center_lat), 4326)::extensions.geography
      ) / 1000.0
    end as distance_km
  from public.food_places
  where lower(p_query) <% lower(name)
  order by sim desc, distance_km asc nulls last, name asc
  limit greatest(1, p_cap);
$$;

create or replace function public.food_places_search_by_name(
  p_query text, p_cap integer default 15,
  p_center_lat double precision default null, p_center_lon double precision default null
)
returns table (
  id text, name text, lat double precision, lon double precision,
  category text, cuisine text, address text, brand text,
  source text, source_licence text, metro text, confidence double precision,
  sim real, distance_km double precision
)
language sql stable
as $$
  select s.id, s.name, s.lat, s.lon, s.category, s.cuisine, s.address, s.brand,
    s.source, s.source_licence, s.metro, fp.confidence, s.sim, s.distance_km
  from public.food_places_search_by_name_raw(p_query, p_cap, p_center_lat, p_center_lon) s
  join public.food_places fp on fp.id = s.id
  where fp.address !~ '\d{5}(-\d{4})?\s+and\s+\d+\s+\S';
$$;

grant execute on function public.food_places_search_by_name(text, integer, double precision, double precision) to anon, authenticated;
grant execute on function public.food_places_search_by_name_raw(text, integer, double precision, double precision) to anon, authenticated;

-- ── food_wishlist: "want to try" flags (B669312, owner chat block 2026-08-22: "flag places he
-- has not been to yet, so the map doubles as a shortlist and not just a log"). A THIRD table,
-- deliberately -- not a food_places column (that table has no user_id and is service-role-write-
-- only, so a personal flag can't live there) and not a food_visits row (a want-to-try place has
-- ZERO visits by definition and must never appear in a visit count, rating, or average that reads
-- that table). Mirrors food_visits' identity shape (place_id OR custom_name/custom_lat/custom_lon,
-- for a flagged manual/dropped pin) but carries no visit facts -- a flag, not a log entry. Owner-
-- only RLS, own-row, the identical shape to food_visits (see db/test/food_rls.test.sql, extended
-- alongside this table with the same proof pattern).
create table if not exists public.food_wishlist (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  place_id     text references public.food_places(id) on delete cascade,
  custom_name  text,
  custom_lat   double precision,
  custom_lon   double precision,
  note         text,
  created_at   timestamptz not null default now(),
  constraint food_wishlist_place_or_manual check (place_id is not null or custom_name is not null)
);

-- One flag per (user, place) -- enforced at the database, not just the UI (the brief: "enforce it
-- with a unique constraint, do not rely on the UI to prevent duplicates"). Two partial unique
-- indexes because place_id is nullable: a snapshot-place wish is deduped by (user, place_id); a
-- manual/dropped-pin wish has place_id null and is deduped the same way foodStore.js's
-- manualPinsFromVisits already groups manual VISITS -- by (user, name, rounded lat/lon), rounded
-- to 4dp (~11m) so a second flag press a few feet off still resolves to the same pin.
create unique index if not exists food_wishlist_user_place_uidx
  on public.food_wishlist (user_id, place_id) where place_id is not null;
create unique index if not exists food_wishlist_user_manual_uidx
  on public.food_wishlist (user_id, custom_name, round(custom_lat::numeric, 4), round(custom_lon::numeric, 4))
  where place_id is null;

create index if not exists food_wishlist_user_idx on public.food_wishlist (user_id);

alter table public.food_wishlist enable row level security;

drop policy if exists "Users select own food_wishlist" on public.food_wishlist;
drop policy if exists "Users insert own food_wishlist" on public.food_wishlist;
drop policy if exists "Users delete own food_wishlist" on public.food_wishlist;

create policy "Users select own food_wishlist" on public.food_wishlist
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own food_wishlist" on public.food_wishlist
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own food_wishlist" on public.food_wishlist
  for delete to authenticated using ((select auth.uid()) = user_id);
-- No update policy -- a flag is toggled on/off (insert/delete) rather than edited in place, and
-- no anon policy at all -> a signed-out request sees zero rows, exactly like food_visits.

-- ── food_dish_wishlist: "want to try" AT THE DISH LEVEL, on a place he has ALREADY visited
-- (NEW-3, owner chat block, 2026-08-23, verbatim: "remove the want to try option from a
-- restaurant I've already visited. Well, I guess unless there's a dish that I want to try... let's
-- do something good there"). Deliberately its OWN table, not a food_wishlist row and not a
-- food_visits column: food_wishlist is PLACE-level (one flag per place, dropped the instant a
-- visit is logged) and a dish list needs the OPPOSITE lifecycle -- it only starts mattering ONCE
-- a place has a visit, is MANY rows per place (one per dish), and survives across every future
-- visit to that same place rather than belonging to any single one. Same owner-only RLS shape as
-- food_wishlist/food_visits (own-row, `to authenticated`, no anon policy).
create table if not exists public.food_dish_wishlist (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  place_id     text references public.food_places(id) on delete cascade,
  custom_name  text,
  custom_lat   double precision,
  custom_lon   double precision,
  dish_name    text not null,
  -- Struck off once he's had it (VisitPanel's visit-log form surfaces outstanding dishes next to
  -- "What I had" so he can strike one off in the same motion -- suggested, never auto-matched).
  -- Distinct from actually REMOVING a dish (a plain delete, one tap, no confirmation): "done" keeps
  -- the row (and its history) rather than erasing that he once wanted it.
  done         boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint food_dish_wishlist_place_or_manual check (place_id is not null or custom_name is not null),
  constraint food_dish_wishlist_dish_name_len check (char_length(btrim(dish_name)) > 0)
);

-- Unlike food_wishlist (one flag per PLACE), a place can have many wanted dishes -- so the unique
-- constraint is per (user, place, dish), not per (user, place). Case/whitespace-insensitive so
-- "Pad Thai" and "pad thai " dedupe to the same row rather than silently doubling up.
create unique index if not exists food_dish_wishlist_place_dish_uidx
  on public.food_dish_wishlist (user_id, place_id, lower(btrim(dish_name))) where place_id is not null;
create unique index if not exists food_dish_wishlist_manual_dish_uidx
  on public.food_dish_wishlist (user_id, custom_name, round(custom_lat::numeric, 4), round(custom_lon::numeric, 4), lower(btrim(dish_name)))
  where place_id is null;

create index if not exists food_dish_wishlist_user_idx on public.food_dish_wishlist (user_id);
create index if not exists food_dish_wishlist_user_place_idx on public.food_dish_wishlist (user_id, place_id) where place_id is not null;

alter table public.food_dish_wishlist enable row level security;

drop policy if exists "Users select own food_dish_wishlist" on public.food_dish_wishlist;
drop policy if exists "Users insert own food_dish_wishlist" on public.food_dish_wishlist;
drop policy if exists "Users update own food_dish_wishlist" on public.food_dish_wishlist;
drop policy if exists "Users delete own food_dish_wishlist" on public.food_dish_wishlist;

create policy "Users select own food_dish_wishlist" on public.food_dish_wishlist
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own food_dish_wishlist" on public.food_dish_wishlist
  for insert to authenticated with check ((select auth.uid()) = user_id);
-- Update is needed here (unlike food_wishlist) -- striking a dish "done" is an UPDATE in place,
-- not a delete-and-reinsert, so its created_at/history stays intact.
create policy "Users update own food_dish_wishlist" on public.food_dish_wishlist
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own food_dish_wishlist" on public.food_dish_wishlist
  for delete to authenticated using ((select auth.uid()) = user_id);
-- No anon policy at all -> a signed-out request sees zero rows, exactly like food_visits/food_wishlist.

-- ── food_visits.rating / rating_ambiance: QUARTER-POINT steps (owner chat block, 2026-08-27/28:
-- "quarter-point ratings, not just half points"). Widens both columns from numeric(3,1) (one
-- decimal, half-point-capable, added by the "rating scale, HALF-POINT steps" section above) to
-- numeric(4,2) (two decimals, quarter-point-capable), and loosens the halves-only CHECK to a
-- quarters-only one.
--
-- ⛔ NOT numeric(3,2), despite that being the brief's own suggested type — it is a genuine
-- overflow bug, not a style choice. numeric(precision, scale): precision is the TOTAL count of
-- significant digits, scale is how many of those sit after the decimal point. numeric(3,2) has
-- only 1 digit of room before the decimal point, i.e. a max representable value of 9.99 — a
-- rating of exactly 10 would raise "numeric field overflow" on insert, not silently truncate.
-- Confirmed LIVE against this exact production database before writing this migration:
-- `select '10.00'::numeric(3,2)` raises 22003 numeric field overflow, and production already
-- held a real rating of exactly 10 (row 9830a4b5-d9b6-4305-a238-c8b93cbb1b00) that would have
-- failed to migrate under numeric(3,2). numeric(4,2) allows 2 digits before the decimal point
-- (up to 99.99), comfortably covering the 1-10 scale at quarter-point resolution.
--
-- Verified non-destructive on production before shipping: a scale-independent checksum
-- (md5 over every row's id + trim_scale(rating) + trim_scale(rating_ambiance), so it isn't
-- fooled by the display-padding difference between numeric(3,1) and numeric(4,2)) over all 174
-- existing rows matched EXACTLY before and after this ALTER — nobody's recorded rating moved.
-- Idempotent: safe to re-run (a column already at numeric(4,2) is a no-op `alter...type`; the
-- constraint drop-then-add always recreates the identical definition).
alter table public.food_visits alter column rating type numeric(4,2) using rating::numeric(4,2);
alter table public.food_visits drop constraint if exists food_visits_rating_check;
alter table public.food_visits add constraint food_visits_rating_check
  check (rating is null or (rating between 1 and 10 and rating * 4 = round(rating * 4)));

alter table public.food_visits alter column rating_ambiance type numeric(4,2) using rating_ambiance::numeric(4,2);
alter table public.food_visits drop constraint if exists food_visits_rating_ambiance_check;
alter table public.food_visits add constraint food_visits_rating_ambiance_check
  check (rating_ambiance is null or (rating_ambiance between 1 and 10 and rating_ambiance * 4 = round(rating_ambiance * 4)));

-- 3) Verify (read-only; safe to run any time) ---------------------------------
--   select relrowsecurity from pg_class where oid = 'public.food_visits'::regclass;   -- expect true
--   select polname from pg_policy where polrelid = 'public.food_visits'::regclass;    -- 4 owner-only rows, no anon
--   select count(*) from public.food_places;                                         -- expect ~34,000 after the load script runs
--   select food_places_in_bounds_sampled(29.4, -95.9, 30.2, -94.9, 2000, 8);          -- spread across the bbox, total_matched on every row
--   select relrowsecurity from pg_class where oid = 'public.food_wishlist'::regclass; -- expect true
--   select polname from pg_policy where polrelid = 'public.food_wishlist'::regclass;  -- 3 owner-only rows (select/insert/delete), no anon
--   select relrowsecurity from pg_class where oid = 'public.food_dish_wishlist'::regclass; -- expect true
--   select polname from pg_policy where polrelid = 'public.food_dish_wishlist'::regclass;  -- 4 owner-only rows (select/insert/update/delete), no anon
--   select numeric_precision, numeric_scale from information_schema.columns
--     where table_name = 'food_visits' and column_name = 'rating';                    -- expect 4, 2
