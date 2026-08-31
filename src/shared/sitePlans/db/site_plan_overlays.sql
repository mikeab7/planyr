-- Site-plan overlays (B848848 — upload a site plan, place it on the map, pin comps to
-- buildings shown on it). Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi),
-- AFTER site-planner/db/teams.sql (needs public.is_team_member) and doc-review/db/doc_reviews.sql
-- + project_library.sql (needs public.doc_reviews with its project_id column). Idempotent.
--
-- WHAT THIS IS: a site plan is its OWN entity, mirroring comps.sql's decision for comps — it
-- MAY optionally reference a project, but never requires one, and is visible to a team the
-- same way a shared comp is. It is a reference INTO an existing `doc_reviews` row (the whole
-- uploaded brochure, stored via the existing Review/Library document pipeline — never a
-- second file-storage system), naming which PAGE of that document is the georeferenced site
-- plan. Deliberately not one-per-document: `review_id` is not unique here, so one brochure
-- can carry several overlay pages (phases, multiple buildings drawn separately) and one site
-- can carry several dated brochures over time (a 2024 flyer and a 2026 flyer describe
-- different buildings/availability) — nothing here forces either count to stay at one.
--
-- AUDIT-FIRST NOTE (found applying this migration): the repo's own doc_reviews.sql declares
-- `primary key (user_id, id)`, but production's LIVE constraint is `PRIMARY KEY (id)` alone
-- (doc_reviews.id, text, is globally unique there, not just per-user) — the deployed schema
-- has drifted from the checked-in migration file at some point. This migration follows the
-- deployed reality: `review_id` alone is the FK to doc_reviews; `review_user_id` is kept as a
-- plain informational column (not part of any FK) rather than assumed to be needed for
-- uniqueness.
--
-- GEOREFERENCE: `control_points` (>=2 pairs of {px,py} image-pixel <-> {lat,lon}) is the
-- SOURCE OF TRUTH — the transform itself (a rotation+scale+translation similarity fit, see
-- shared/sitePlans/lib/overlayGeoref.js, which reuses the Site Planner reference-overlay's
-- own align-mode solver) is recomputed from these points on every read, never persisted as a
-- separate serialized closure, so it can never drift out of sync with what defines it.
-- `scale_ft_per_px`/`rotation_deg`/`fit_residual_ft` are DERIVED CACHE columns for cheap
-- display/sort — a write always recomputes and overwrites them, they are never edited
-- independently. `scale_check_ft`/`scale_check_note` record the post-anchor sanity check the
-- user ran (measuring a real distance on the map against something he knows) — deliberately
-- independent of the control points, so a badly-fit georeference can't hide behind its own math.

create table if not exists public.site_plan_overlays (
  id             uuid not null default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_id        uuid references public.teams(id) on delete set null,
  project_id     text references public.sites(id) on delete set null,  -- optional; never required

  review_id      text not null,   -- the doc_reviews row holding the WHOLE brochure
  review_user_id uuid not null,   -- doc_reviews' PK is (user_id, id); carried for the FK below
  page           integer not null check (page >= 1),  -- which page of that document this overlay is
  doc_title      text,            -- display cache: the brochure's title/filename when anchored
  doc_date       date,            -- display cache: mirrors doc_reviews.doc_date (dated brochures)

  img_w          integer not null check (img_w > 0),   -- rasterized page size, px
  img_h          integer not null check (img_h > 0),
  raster_key     text,            -- Storage object key for the cached rasterized page (png)

  control_points   jsonb not null,  -- [{px,py,lat,lon}, ...], >=2 pairs — source of truth
  scale_ft_per_px  double precision,  -- derived cache
  rotation_deg     double precision,  -- derived cache
  fit_residual_ft  double precision,  -- derived cache (Procrustes fit residual, feet)
  scale_check_ft   double precision,  -- the independent post-anchor measured check, feet
  scale_check_note text,             -- what he compared it against (free text)

  opacity        double precision not null default 0.85 check (opacity >= 0 and opacity <= 1),
  visible        boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (id),
  foreign key (review_id) references public.doc_reviews(id) on delete cascade,
  constraint site_plan_overlays_control_points_shape check (jsonb_typeof(control_points) = 'array')
);

create index if not exists site_plan_overlays_user_idx    on public.site_plan_overlays (user_id);
create index if not exists site_plan_overlays_team_idx    on public.site_plan_overlays (team_id) where team_id is not null;
create index if not exists site_plan_overlays_project_idx on public.site_plan_overlays (project_id) where project_id is not null;
create index if not exists site_plan_overlays_review_idx  on public.site_plan_overlays (review_user_id, review_id);

-- RLS: composed from comps.sql's precedent — team-read, owner-write only (a shared site plan
-- is reference data other team members read and pin comps against, not jointly edit).
alter table public.site_plan_overlays enable row level security;

drop policy if exists "select own or team site plan overlays" on public.site_plan_overlays;
drop policy if exists "insert own site plan overlays"          on public.site_plan_overlays;
drop policy if exists "update own site plan overlays"          on public.site_plan_overlays;
drop policy if exists "delete own site plan overlays"          on public.site_plan_overlays;

create policy "select own or team site plan overlays" on public.site_plan_overlays
  for select to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_member(team_id)) );

create policy "insert own site plan overlays" on public.site_plan_overlays
  for insert to authenticated
  with check ( user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)) );

create policy "update own site plan overlays" on public.site_plan_overlays
  for update to authenticated
  using ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)) );

create policy "delete own site plan overlays" on public.site_plan_overlays
  for delete to authenticated
  using ( user_id = (select auth.uid()) );

create or replace function public.site_plan_overlays_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_plan_overlays_touch on public.site_plan_overlays;
create trigger site_plan_overlays_touch before update on public.site_plan_overlays
  for each row execute function public.site_plan_overlays_touch_updated_at();

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select relrowsecurity from pg_class where oid = 'public.site_plan_overlays'::regclass;  -- expect true
--   select polname from pg_policy where polrelid = 'public.site_plan_overlays'::regclass;   -- 4 rows
