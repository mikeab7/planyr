-- Shared team workspaces — turn ON data sharing (B-TEAM, phase 2).
-- Run ONCE in the Supabase SQL editor, AFTER db/teams.sql. Idempotent; safe to re-run.
-- ADDITIVE in effect: every existing row gets team_id = NULL, and the new RLS policies
-- COLLAPSE to today's own-row behavior whenever team_id IS NULL — so the instant this runs,
-- nothing changes for current users. A row only becomes team-visible when a project is
-- deliberately shared (the client sets team_id; see lib/sharing.js).
--
-- ⚠️ PRE-FLIGHT (owner, do this BEFORE running this file):
--   1. Take a quick database snapshot/backup (Supabase dashboard → Database → Backups).
--   2. Confirm `id` is globally unique on each table (it is, by construction — site ids and
--      review ids are time+random) by running:
--        select id, count(*) from public.sites       group by id having count(*) > 1;
--        select id, count(*) from public.doc_reviews  group by id having count(*) > 1;
--        select id, count(*) from public.file_facts   group by id having count(*) > 1;
--      Each must return ZERO rows. If any returns a row, resolve it before continuing — the
--      primary-key change below requires id to be unique on its own.
--
-- WHY the primary-key change: today PK = (user_id, id). When teammate B edits A's shared row,
-- B's upsert (user_id = B) would INSERT a new (B, id) row instead of UPDATING (A, id). Making
-- the PK just (id) means one row per project regardless of who edits it. user_id is KEPT as the
-- CREATOR/OWNER column (never overwritten on a teammate edit — the client sends it only on insert).

-- 1) team_id columns (NULL = private = unchanged) ----------------------------
alter table public.sites       add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.doc_reviews add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.file_facts  add column if not exists team_id uuid references public.teams(id) on delete set null;
create index if not exists sites_team_idx       on public.sites       (team_id) where team_id is not null;
create index if not exists doc_reviews_team_idx on public.doc_reviews (team_id) where team_id is not null;
create index if not exists file_facts_team_idx  on public.file_facts  (team_id) where team_id is not null;

-- 2) Primary key (user_id, id) → (id). Guarded: only fires while the 2-column PK exists. ----
do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'sites_pkey' and conrelid = 'public.sites'::regclass
               and array_length(conkey,1) = 2) then
    alter table public.sites drop constraint sites_pkey;
    alter table public.sites add primary key (id);
  end if;
  if exists (select 1 from pg_constraint
             where conname = 'doc_reviews_pkey' and conrelid = 'public.doc_reviews'::regclass
               and array_length(conkey,1) = 2) then
    alter table public.doc_reviews drop constraint doc_reviews_pkey;
    alter table public.doc_reviews add primary key (id);
  end if;
  if exists (select 1 from pg_constraint
             where conname = 'file_facts_pkey' and conrelid = 'public.file_facts'::regclass
               and array_length(conkey,1) = 2) then
    alter table public.file_facts drop constraint file_facts_pkey;
    alter table public.file_facts add primary key (id);
  end if;
end $$;

-- 3) RLS rewrite — sites -----------------------------------------------------
-- SELECT/UPDATE: own row OR a row shared with a team you're in.
-- INSERT: you must be the creator, and if you set a team_id you must belong to that team.
-- DELETE: owner OR a team admin (a regular member can't delete a teammate's shared project).
alter table public.sites enable row level security;
drop policy if exists "Users select own sites" on public.sites;
drop policy if exists "Users insert own sites" on public.sites;
drop policy if exists "Users update own sites" on public.sites;
drop policy if exists "Users delete own sites" on public.sites;
drop policy if exists "select own or team sites" on public.sites;
drop policy if exists "insert own sites" on public.sites;
drop policy if exists "update own or team sites" on public.sites;
drop policy if exists "delete own or team-admin sites" on public.sites;
create policy "select own or team sites" on public.sites
  for select to authenticated
  using ( user_id = (select auth.uid())
          or (team_id is not null and public.is_team_member(team_id)) );
create policy "insert own sites" on public.sites
  for insert to authenticated
  with check ( user_id = (select auth.uid())
               and (team_id is null or public.is_team_member(team_id)) );
create policy "update own or team sites" on public.sites
  for update to authenticated
  using ( user_id = (select auth.uid())
          or (team_id is not null and public.is_team_member(team_id)) )
  with check ( (user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)))
               or (team_id is not null and public.is_team_member(team_id)) );
create policy "delete own or team-admin sites" on public.sites
  for delete to authenticated
  using ( user_id = (select auth.uid())
          or (team_id is not null and public.is_team_admin(team_id)) );

-- 4) RLS rewrite — doc_reviews (same shape) ----------------------------------
alter table public.doc_reviews enable row level security;
drop policy if exists "Users select own reviews" on public.doc_reviews;
drop policy if exists "Users insert own reviews" on public.doc_reviews;
drop policy if exists "Users update own reviews" on public.doc_reviews;
drop policy if exists "Users delete own reviews" on public.doc_reviews;
drop policy if exists "select own or team reviews" on public.doc_reviews;
drop policy if exists "insert own reviews" on public.doc_reviews;
drop policy if exists "update own or team reviews" on public.doc_reviews;
drop policy if exists "delete own or team-admin reviews" on public.doc_reviews;
create policy "select own or team reviews" on public.doc_reviews for select to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_member(team_id)) );
create policy "insert own reviews" on public.doc_reviews for insert to authenticated
  with check ( user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)) );
create policy "update own or team reviews" on public.doc_reviews for update to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_member(team_id)) )
  with check ( (user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)))
               or (team_id is not null and public.is_team_member(team_id)) );
create policy "delete own or team-admin reviews" on public.doc_reviews for delete to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_admin(team_id)) );

-- 5) RLS rewrite — file_facts (same shape) -----------------------------------
alter table public.file_facts enable row level security;
drop policy if exists "Users select own file_facts" on public.file_facts;
drop policy if exists "Users insert own file_facts" on public.file_facts;
drop policy if exists "Users update own file_facts" on public.file_facts;
drop policy if exists "Users delete own file_facts" on public.file_facts;
drop policy if exists "select own or team file_facts" on public.file_facts;
drop policy if exists "insert own file_facts" on public.file_facts;
drop policy if exists "update own or team file_facts" on public.file_facts;
drop policy if exists "delete own or team-admin file_facts" on public.file_facts;
create policy "select own or team file_facts" on public.file_facts for select to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_member(team_id)) );
create policy "insert own file_facts" on public.file_facts for insert to authenticated
  with check ( user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)) );
create policy "update own or team file_facts" on public.file_facts for update to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_member(team_id)) )
  with check ( (user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)))
               or (team_id is not null and public.is_team_member(team_id)) );
create policy "delete own or team-admin file_facts" on public.file_facts for delete to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_admin(team_id)) );
