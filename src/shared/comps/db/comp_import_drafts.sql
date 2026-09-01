-- Comp import drafts — the staging table for KML/Google My Maps imports (B849233/NEW-2). Run
-- once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER comps.sql. Idempotent.
--
-- WHY A SEPARATE TABLE, NOT A LOOSER `comps` ROW: `public.comps` is deliberately strict —
-- comp_date NOT NULL, lat/lon NOT NULL, anchor_kind constrained, and
-- comps_parcel_anchor_has_identity requiring an anchor to carry its own identity. An imported
-- KML placemark routinely satisfies NONE of that: Jordan's My Maps descriptions are prose typed
-- over months, often with no date at all, and a polygon placemark has no anchor_kind until a
-- centroid or a parcel match is chosen. Relaxing comps' constraints to accommodate a half-parsed
-- import would trade the integrity of the real table — the only reason a comp can be trusted
-- downstream — for the convenience of the import path. So this table has loose types and
-- nullable-everything, and PROMOTION (application code, `compDraftsStore.js` `promoteDraft`) is
-- the moment the strict constraints get enforced: a draft that can't satisfy `comps`' constraints
-- fails the promotion INSERT and the Postgres error is surfaced against the row, never silently
-- retried or downgraded.
--
-- HAND ENTRY NEVER CREATES A ROW HERE — the paste-grid (comps.sql's `public.comps`) is a
-- completely separate path. Import is the ONLY way into this table (owner decision 2026-09-01:
-- "three lines out of an email do not need a holding pen, twenty rows of someone else's
-- years-old prose do").
--
-- VISIBILITY: OWNER-ONLY, always — narrower than `comps`' own owner-or-team-shared SELECT.
-- A draft is not a comp yet and must never appear on a teammate's map, in an aggregate, or in
-- any list a teammate can see, whether or not the importer is on a team. `profiles.sql`'s plain
-- own-row shape, not `comps.sql`'s team-composed one.

create table if not exists public.comp_import_drafts (
  id             uuid not null default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,

  source         text not null default 'kml',         -- import origin; 'kml' today, room for a future source
  source_file    text,                                  -- the uploaded file's name, for provenance in the review list

  -- What the import actually found — RAW, never coerced to a comps-shaped value. A polygon
  -- placemark's coordinates and a bare, undated paragraph of prose both land here untouched.
  raw_name         text,
  raw_description  text,
  raw_geometry     jsonb,     -- {kind:'point'|'polygon', lat, lon} or {kind:'polygon', ring:[[lon,lat],...]}

  -- Best-effort EXTRACTION, proposed only — never committed until the user confirms (per the
  -- leasing spec: "best-effort extraction proposed as values, every row shown for confirmation,
  -- nothing committed silently"). Shape mirrors compParse.js's generic-then-draft fields, stored
  -- loose (jsonb) because a draft can legitimately hold nothing extractable at all.
  proposed        jsonb not null default '{}'::jsonb,

  status          text not null default 'pending' check (status in ('pending', 'promoted', 'dismissed')),
  promoted_comp_id uuid references public.comps(id) on delete set null,
  promote_error   text,      -- the reason the last promotion attempt failed, shown against the row

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (id)
);

create index if not exists comp_import_drafts_user_idx   on public.comp_import_drafts (user_id);
create index if not exists comp_import_drafts_status_idx on public.comp_import_drafts (user_id, status);

-- RLS: OWNER-ONLY on every operation, no team composition at all (the whole point of this table).
alter table public.comp_import_drafts enable row level security;

drop policy if exists "select own comp drafts" on public.comp_import_drafts;
drop policy if exists "insert own comp drafts" on public.comp_import_drafts;
drop policy if exists "update own comp drafts" on public.comp_import_drafts;
drop policy if exists "delete own comp drafts" on public.comp_import_drafts;

create policy "select own comp drafts" on public.comp_import_drafts
  for select to authenticated
  using ( user_id = (select auth.uid()) );

create policy "insert own comp drafts" on public.comp_import_drafts
  for insert to authenticated
  with check ( user_id = (select auth.uid()) );

create policy "update own comp drafts" on public.comp_import_drafts
  for update to authenticated
  using ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );

create policy "delete own comp drafts" on public.comp_import_drafts
  for delete to authenticated
  using ( user_id = (select auth.uid()) );

create or replace function public.comp_import_drafts_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists comp_import_drafts_touch on public.comp_import_drafts;
create trigger comp_import_drafts_touch before update on public.comp_import_drafts
  for each row execute function public.comp_import_drafts_touch_updated_at();

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select relrowsecurity from pg_class where oid = 'public.comp_import_drafts'::regclass;  -- expect true
--   select polname from pg_policy where polrelid = 'public.comp_import_drafts'::regclass;    -- 4 rows
