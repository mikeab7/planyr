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
  visited_on   date,
  rating       smallint check (rating between 1 and 5),
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

-- ── food_places_in_bounds_sampled (NEW-4) — a VIEWPORT-WIDE, SPATIALLY-DISTRIBUTED capped
-- read. The plain "just add ORDER BY" fix is wrong here: an ORDER BY id/name/whatever still
-- returns an arbitrary prefix that happens to sit wherever those ids/names cluster. What the
-- owner actually needs is "spread across the box I'm looking at, not bunched in one corner" —
-- so this partitions the bbox into a p_grid × p_grid lattice (default 8×8 = 64 cells) and takes
-- an even share from EVERY cell that has anything in it, via one window-function pass (no N+1
-- queries, no client-side looping). `total_matched` rides along (a `count(*) over ()` on the
-- SAME scan, so it costs nothing extra) so the client can tell the user "showing 2,000 of
-- 30,620" instead of silently truncating. SECURITY INVOKER (the default) — it runs under the
-- caller's own RLS, and food_places is already public-read, so this grants no new access.
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
      width_bucket(lon, p_west, p_east, greatest(p_grid, 1)) as gx,
      count(*) over () as total_matched
    from public.food_places
    where lat >= p_south and lat <= p_north and lon >= p_west and lon <= p_east
  ),
  ranked as (
    select *, row_number() over (partition by gy, gx order by id) as rn
    from matched
  )
  select id, name, lat, lon, category, cuisine, address, brand, source, source_licence, total_matched
  from ranked
  where rn <= greatest(1, p_cap / (greatest(p_grid, 1) * greatest(p_grid, 1)))
  order by gy, gx, rn
  limit p_cap;
$$;

grant execute on function public.food_places_in_bounds_sampled(
  double precision, double precision, double precision, double precision, integer, integer
) to anon, authenticated;

-- 3) Verify (read-only; safe to run any time) ---------------------------------
--   select relrowsecurity from pg_class where oid = 'public.food_visits'::regclass;   -- expect true
--   select polname from pg_policy where polrelid = 'public.food_visits'::regclass;    -- 4 owner-only rows, no anon
--   select count(*) from public.food_places;                                         -- expect ~34,000 after the load script runs
--   select food_places_in_bounds_sampled(29.4, -95.9, 30.2, -94.9, 2000, 8);          -- spread across the bbox, total_matched on every row
