-- Leasing Comps (NEW-COMPS; provisional label until the real B# is minted at push time, per
-- /CLAUDE.md's LATE-BIND rule). Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi),
-- AFTER site-planner/db/teams.sql (needs public.is_team_member). Idempotent: safe to re-run.
--
-- WHAT THIS IS: a comp (comparable transaction — a recent land sale, building sale, or lease
-- deal used to price a deal) is its OWN entity, owned by the user who entered it. It is NOT a
-- project type: a comp MAY optionally reference a project (site), but never requires one — the
-- owner's own words, "I don't need to build on it to place a lease comp on it." Every comp a
-- viewer can access (their own, plus their team's) is a candidate for the map regardless of
-- which project it was entered under, or whether it has one at all.
--
-- SHARING SHAPE IS DELIBERATELY NARROWER THAN A SHARED SITE PLAN (site_planner/db/team_sharing.sql):
-- a team member can READ every team-shared comp, but only the person who ENTERED a comp may
-- change or delete it — team sharing's "any member may edit" is explicitly NOT reused here. Comp
-- sets are reference data: many readers, few writers. So this composes team_sharing.sql's SELECT
-- half (own row OR a team you're in) with profiles.sql's plain OWNER-ONLY shape for UPDATE/DELETE
-- (no team-admin override either — an admin cannot edit a teammate's comp).
--
-- ANCHOR: a pin drop OR a real parcel selection — never a hand-drawn rectangle. `anchor_kind`
-- says which; `lat`/`lon` is the point either way (the parcel's representative point when
-- anchor_kind='parcel'), and `parcel_apn`/`parcel_geom` carry a snapshot of the selected parcel
-- (county assessor account id + a GeoJSON geometry capture) so the shape renders on the map
-- without a live re-query of the county service every time the comp layer draws.
--
-- THREE COMP TYPES, flat nullable columns rather than a jsonb blob — simple, queryable, and the
-- set is small and stable (unlike, say, markup properties). A field is optional per column;
-- `comp_date` is the one field required on all three (repeated three times in the product spec).
-- $/SF for LAND and BUILDING SALE is DERIVED client-side from price + size (never stored,
-- never entered twice) — see lib/comps.js `landPricePerSf`/`buildingPricePerSf`. LEASE basis
-- (period × expense) is stored PER COMP, as quoted, and normalized only where the math is
-- honest (period, exact ×12) — NNN vs gross are never blended into one number; see
-- lib/comps.js `summarizeLeaseComps` for why and how that view stays honest.

create table if not exists public.comps (
  id           uuid not null default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_id      uuid references public.teams(id) on delete set null,
  project_id   text references public.sites(id) on delete set null,  -- optional; a comp never requires a project

  comp_type    text not null check (comp_type in ('land', 'building_sale', 'lease')),
  comp_date    date not null,                    -- required on all three comp types
  title        text,                              -- optional display label (property/deal name)
  notes        text,                              -- free text, on every type

  -- anchor: pin OR real parcel selection
  anchor_kind  text not null check (anchor_kind in ('pin', 'parcel')),
  lat          double precision not null,
  lon          double precision not null,
  county       text,                              -- parcel anchor only
  parcel_apn   text,                              -- parcel anchor only (assessor account/parcel id)
  parcel_geom  jsonb,                              -- parcel anchor only: a GeoJSON geometry snapshot

  -- LAND: $/SF headline is derived client-side from land_price + land_size_*, never stored here.
  land_price       numeric,
  land_size_value  numeric,
  land_size_unit   text check (land_size_unit in ('ac', 'sf')),

  -- BUILDING SALE: $/SF on BUILDING sf, not land.
  bldg_price    numeric,
  bldg_size_sf  numeric,

  -- LEASE: rate + basis (period x expense, stored as quoted) + TI$ + optional term.
  lease_rate          numeric,
  lease_rate_period   text check (lease_rate_period in ('annual', 'monthly')),
  lease_rate_expense  text check (lease_rate_expense in ('nnn', 'gross')),
  lease_ti            numeric,   -- tenant improvement allowance, $/SF the landlord contributes
  lease_term          text,      -- free-form ("5 yrs", "60 mo") — deliberately not a numeric unit

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (id),
  -- a parcel anchor must actually carry a parcel identity (an APN or a geometry snapshot) —
  -- otherwise it is indistinguishable from a bare pin and the map/panel can't render its shape.
  constraint comps_parcel_anchor_has_identity check (
    anchor_kind = 'pin' or parcel_apn is not null or parcel_geom is not null
  )
);

create index if not exists comps_user_idx        on public.comps (user_id);
create index if not exists comps_team_idx        on public.comps (team_id) where team_id is not null;
create index if not exists comps_project_idx     on public.comps (project_id) where project_id is not null;
create index if not exists comps_type_date_idx   on public.comps (comp_type, comp_date desc);

-- RLS: composed from two existing precedents, not a new shape ----------------------------------
alter table public.comps enable row level security;

drop policy if exists "select own or team comps" on public.comps;
drop policy if exists "insert own comps"          on public.comps;
drop policy if exists "update own comps"          on public.comps;
drop policy if exists "delete own comps"          on public.comps;

-- SELECT: own row OR a row shared with a team you're in — team_sharing.sql's shape verbatim.
create policy "select own or team comps" on public.comps
  for select to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_member(team_id)) );

-- INSERT: you must be the creator, and if you set a team_id you must belong to that team.
create policy "insert own comps" on public.comps
  for insert to authenticated
  with check ( user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)) );

-- UPDATE: OWNER ONLY, even on a team-shared row (profiles.sql's plain own-row shape) — this is
-- the ONE deliberate departure from team_sharing.sql, per the product decision that comp sets
-- are reference data (many readers, few writers), not a jointly-editable plan.
create policy "update own comps" on public.comps
  for update to authenticated
  using ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)) );

-- DELETE: OWNER ONLY too — not even a team admin can remove a teammate's comp.
create policy "delete own comps" on public.comps
  for delete to authenticated
  using ( user_id = (select auth.uid()) );

create or replace function public.comps_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists comps_touch on public.comps;
create trigger comps_touch before update on public.comps
  for each row execute function public.comps_touch_updated_at();

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select relrowsecurity from pg_class where oid = 'public.comps'::regclass;  -- expect true
--   select polname from pg_policy where polrelid = 'public.comps'::regclass;   -- 4 rows
