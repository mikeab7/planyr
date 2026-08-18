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
  cost         numeric(8,2),
  what_i_had   text,
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

create or replace function public.food_places_search_by_name(
  p_query text, p_cap integer default 15
)
returns table (
  id text, name text, lat double precision, lon double precision,
  category text, cuisine text, address text, brand text,
  source text, source_licence text, sim real
)
language sql stable
set pg_trgm.word_similarity_threshold = 0.3
as $$
  select id, name, lat, lon, category, cuisine, address, brand, source, source_licence,
    word_similarity(lower(p_query), lower(name)) as sim
  from public.food_places
  where lower(p_query) <% lower(name)
  order by sim desc, name asc
  limit greatest(1, p_cap);
$$;

grant execute on function public.food_places_search_by_name(text, integer) to anon, authenticated;

-- 3) Verify (read-only; safe to run any time) ---------------------------------
--   select relrowsecurity from pg_class where oid = 'public.food_visits'::regclass;   -- expect true
--   select polname from pg_policy where polrelid = 'public.food_visits'::regclass;    -- 4 owner-only rows, no anon
--   select count(*) from public.food_places;                                         -- expect ~34,000 after the load script runs
--   select food_places_in_bounds_sampled(29.4, -95.9, 30.2, -94.9, 2000, 8);          -- spread across the bbox, total_matched on every row
