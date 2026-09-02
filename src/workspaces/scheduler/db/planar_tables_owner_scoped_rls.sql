-- Planyr Scheduler — give every schedule a real owner and replace the wide-open anon RLS
-- policies on planar_data / planar_history / planar_suggestions with real ownership checks.
-- (B778 amendment, ship-now directive from owner chat, 2026-09-02.)
--
-- ⛔ SUPERSEDED IN PART, SAME SESSION — see planar_tables_owner_only_no_team_default.sql, applied
-- immediately after this file. This file's policies read "owner OR same team"; the owner then
-- ruled that out ("let me decide when i share" — schedules are PRIVATE BY DEFAULT, no implicit
-- team sharing). Read both files together; the second is the final, correct state.
--
-- Context: these three tables were readable AND writable by anyone on the internet using only
-- the public anon key (RLS enabled, but every policy was `USING (true)` for `public`/`anon`).
-- Confirmed live: an unauthenticated request with the anon key and no Authorization header
-- returned Michael's real schedule ("hs-v1"), and an unauthenticated INSERT succeeded.
-- There is exactly ONE schedule document today (planar_data.key = 'hs-v1'), used by Michael
-- and his HIP Houston teammates (team 454aa114-1318-462d-8f78-ffad6ac01cac). This migration:
--   1. adds user_id/team_id ownership columns to all three tables, mirroring public.sites'
--      user_id/team_id + is_team_member() model (no second sharing mechanism in this app);
--   2. backfills the existing rows to their real owner (Michael + HIP Houston);
--   3. replaces every anon policy with an authenticated, ownership-scoped one, and revokes
--      anon's table-level grants outright (defense in depth beyond RLS — anon previously held
--      SELECT/INSERT/UPDATE/DELETE/TRUNCATE table grants on all three, not just SELECT/anon-INSERT/
--      anon-UPDATE policies);
--   4. adds a BEFORE INSERT trigger on planar_history that stamps ownership from the schedule
--      (planar_data) row being snapshotted, so the existing client — which has never sent
--      user_id/team_id on a history insert — needs no changes to keep saving history.
-- planar_data.user_id defaults to auth.uid() (same pattern as sites.user_id), so a client
-- upsert that only ever sends {key, value} still gets a real owner on first insert, and an
-- ordinary save (an update on the existing key) leaves the stored owner untouched.
--
-- Applied directly to production (lyeqzkuiwngunutlkkmi) via the Supabase MCP `apply_migration`
-- tool on 2026-09-02; this file is the committed record of that migration (matches the other
-- workspaces' db/ convention) — re-running it is idempotent (IF NOT EXISTS / IF EXISTS / OR
-- REPLACE throughout).
--
-- Live-verified before/after (Postgres role + JWT-claim simulation, the exact mechanism
-- PostgREST uses to enforce RLS — direct HTTPS to the project is blocked from this sandbox):
--   anon SELECT   BEFORE: 200, returned key "hs-v1"   AFTER: 42501 permission denied (403)
--   anon INSERT   BEFORE: succeeded (rolled back)     AFTER: 42501 permission denied (403)
--   Michael (owner, authenticated)   SELECT + UPDATE both succeed
--   HIP Houston teammate (team member, not owner)     SELECT succeeds via team_id
--   unrelated signed-in stranger (real account, not on the team)   SELECT returns 0 rows

alter table public.planar_data
  add column if not exists user_id uuid references auth.users(id) default auth.uid(),
  add column if not exists team_id uuid references public.teams(id);

alter table public.planar_history
  add column if not exists user_id uuid references auth.users(id),
  add column if not exists team_id uuid references public.teams(id);

alter table public.planar_suggestions
  add column if not exists user_id uuid references auth.users(id),
  add column if not exists team_id uuid references public.teams(id);

-- Backfill: the one schedule that exists today is Michael's, shared with the HIP Houston team.
update public.planar_data
  set user_id = 'b147d90d-b610-423d-af65-7e004f0ad72f',
      team_id = '454aa114-1318-462d-8f78-ffad6ac01cac'
  where key = 'hs-v1' and user_id is null;

update public.planar_history
  set user_id = 'b147d90d-b610-423d-af65-7e004f0ad72f',
      team_id = '454aa114-1318-462d-8f78-ffad6ac01cac'
  where key = 'hs-v1' and user_id is null;

update public.planar_suggestions
  set user_id = 'b147d90d-b610-423d-af65-7e004f0ad72f',
      team_id = '454aa114-1318-462d-8f78-ffad6ac01cac'
  where user_id is null;

-- Auto-stamp ownership on every new history snapshot from the schedule row it snapshots, so
-- the existing client (which never sends user_id/team_id on a history insert) needs no changes.
create or replace function public.planar_history_stamp_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  if new.team_id is null then
    select p.team_id into new.team_id from public.planar_data p where p.key = new.key;
  end if;
  return new;
end;
$$;

drop trigger if exists planar_history_stamp_owner_trg on public.planar_history;
create trigger planar_history_stamp_owner_trg
  before insert on public.planar_history
  for each row execute function public.planar_history_stamp_owner();

-- Drop the wide-open anon policies.
drop policy if exists "anon read" on public.planar_data;
drop policy if exists "anon insert" on public.planar_data;
drop policy if exists "anon update" on public.planar_data;
drop policy if exists "hist read" on public.planar_history;
drop policy if exists "hist insert" on public.planar_history;
drop policy if exists "anon can read suggestions" on public.planar_suggestions;
drop policy if exists "anon can update status" on public.planar_suggestions;

-- Real, ownership-scoped policies — same shape as sites/comps/doc_reviews.
create policy "select own or team schedule" on public.planar_data
  for select to authenticated
  using (user_id = auth.uid() or (team_id is not null and is_team_member(team_id)));

create policy "insert own schedule" on public.planar_data
  for insert to authenticated
  with check (user_id = auth.uid() and (team_id is null or is_team_member(team_id)));

create policy "update own or team schedule" on public.planar_data
  for update to authenticated
  using (user_id = auth.uid() or (team_id is not null and is_team_member(team_id)))
  with check (user_id = auth.uid() or (team_id is not null and is_team_member(team_id)));

create policy "select own or team schedule history" on public.planar_history
  for select to authenticated
  using (user_id = auth.uid() or (team_id is not null and is_team_member(team_id)));

create policy "insert own schedule history" on public.planar_history
  for insert to authenticated
  with check (user_id = auth.uid() and (team_id is null or is_team_member(team_id)));

create policy "select own or team suggestions" on public.planar_suggestions
  for select to authenticated
  using (user_id = auth.uid() or (team_id is not null and is_team_member(team_id)));

create policy "update own or team suggestions" on public.planar_suggestions
  for update to authenticated
  using (user_id = auth.uid() or (team_id is not null and is_team_member(team_id)))
  with check (user_id = auth.uid() or (team_id is not null and is_team_member(team_id)));

-- Defense in depth: anon has no business touching these tables at all any more.
revoke all on public.planar_data from anon;
revoke all on public.planar_history from anon;
revoke all on public.planar_suggestions from anon;
