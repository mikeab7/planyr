-- ============================================================================
-- Default team sharing for NEW projects + per-plan view-only lock
-- (B326416 · B326417 · B326419). Run ONCE in the Supabase SQL editor (project
-- lyeqzkuiwngunutlkkmi), AFTER db/team_sharing.sql and db/team_rehome_guard.sql.
-- Idempotent; safe to re-run.
--
-- ⛔ THE ONE THING THIS FILE EXISTS TO GUARANTEE:
--    NO PROJECT THAT ALREADY EXISTS CHANGES VISIBILITY WHEN THIS RUNS, OR EVER
--    AFTERWARDS BY ANY ORDINARY WRITE PATH.
--
--    Running this file touches no row's `team_id`. It adds a column that defaults
--    to false, replaces a trigger function, and rewrites policies whose team
--    branches are strictly NARROWER than the ones they replace. A project that is
--    private today is private the instant this finishes, and there is no statement
--    here that could make it otherwise.
--
-- HOW THE SCOPE GUARANTEE IS ENFORCED (this is the load-bearing part):
--   Before this file, `guard_team_rehome` allowed the row OWNER to change `team_id`
--   on ANY update. That is fine for a deliberate share, but it means a client bug, a
--   stale in-memory model, a replayed cache write or a future refactor could flip an
--   existing private project to shared through an ordinary content save — silently,
--   with the owner's own credentials, and RLS would permit it.
--
--   `guard_team_share` replaces it with DENY BY DEFAULT: an UPDATE that changes
--   `team_id` is REFUSED outright unless it arrives inside `set_project_team()`,
--   which is the only thing that sets the transaction-local flag the trigger looks
--   for. Ordinary writes cannot set that flag — PostgREST sends no `set_config`, and
--   the flag is `is_local = true` so it cannot leak across statements on a pooled
--   connection.
--
--   INSERT is deliberately untouched: a BRAND-NEW row may be born with a team_id.
--   That is exactly the feature, and it is why the feature can only ever affect
--   projects created after it ships — "new projects only" is a consequence of the
--   schema rather than a rule the client is trusted to follow.
--
-- WHAT IS SHARED, AND WHAT IS NOT (owner decision, 2026-08-09):
--   SITE PLANS ONLY. `set_project_team` writes `public.sites` and nothing else.
--   Notes (notes_*), Schedule (planar_*), Library folders (project_folders) and pins
--   are keyed to their author with own-row RLS and have no team column at all, so
--   they are untouched by construction. `doc_reviews` and `file_facts` DO carry a
--   team_id from db/team_sharing.sql; this RPC deliberately leaves both alone, so
--   Review and the Library file index stay with their owner.
-- ============================================================================

-- 1) Per-plan view-only lock ------------------------------------------------
-- Default FALSE: every existing plan is unlocked, i.e. exactly today's behaviour.
alter table public.sites add column if not exists share_locked boolean not null default false;
comment on column public.sites.share_locked is
  'Owner-set view-only flag. When true, teammates may read this plan but not write it; the owner is unaffected.';

-- 2) The guard — deny-by-default on team_id, owner-only on the lock ---------
-- Plain (SECURITY INVOKER): it reads OLD/NEW + auth.uid() only, so it needs no RLS bypass.
create or replace function public.guard_team_share()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.team_id is distinct from old.team_id then
    -- (a) Not through the share control → refuse, whoever you are. This is the clause that
    --     makes "an existing project can never silently become shared" a property of the
    --     database rather than a promise made by the client.
    if coalesce(current_setting('planyr.share_intent', true), '') <> '1' then
      raise exception 'Sharing can only be changed through the share control.'
        using errcode = '42501', hint = 'Call public.set_project_team(group_id, team_id).';
    end if;
    -- (b) Owner-only (the B486 rule, preserved): a member of two teams must not be able to
    --     re-home someone else's shared project out from under them.
    if old.user_id is distinct from auth.uid() then
      raise exception 'Only the project owner can change sharing.' using errcode = '42501';
    end if;
  end if;

  -- The lock is the owner's control alone — otherwise a teammate could simply unlock a plan
  -- the owner had just made read-only, which would make the lock decorative.
  if new.share_locked is distinct from old.share_locked and old.user_id is distinct from auth.uid() then
    raise exception 'Only the plan owner can lock or unlock a plan.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- `sites` moves to the stricter guard. doc_reviews / file_facts keep the original
-- owner-only rehome guard: they are not part of the default-share feature, and
-- narrowing them here would change a shipped flow this item does not touch.
drop trigger if exists sites_team_rehome_guard on public.sites;
drop trigger if exists sites_team_share_guard on public.sites;
create trigger sites_team_share_guard before update on public.sites
  for each row execute function public.guard_team_share();

-- 3) The ONLY way to change sharing: an explicit, audited RPC ---------------
-- SECURITY DEFINER so it can set the intent flag and write past the trigger, but it
-- re-checks ownership and membership ITSELF — running as owner means RLS is not doing
-- that for us, so nothing here may be left implicit.
create or replace function public.set_project_team(p_group_id text, p_team_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer := 0;
  v_mine  integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_group_id is null or p_group_id = '' then raise exception 'Which project?' using errcode = '22023'; end if;

  -- Sharing INTO a team requires you to be in it. Without this check a SECURITY DEFINER
  -- function would happily publish a project to a team of strangers.
  if p_team_id is not null and not public.is_team_member(p_team_id) then
    raise exception 'You are not a member of that team.' using errcode = '42501';
  end if;

  -- Only the caller's OWN plans move. A group containing someone else's plan is not an
  -- error, but their rows are left exactly as they were.
  select count(*) into v_mine from public.sites
    where coalesce(group_id, id) = p_group_id and user_id = v_uid and deleted_at is null;
  if v_mine = 0 then raise exception 'No project of yours with that id.' using errcode = '42501'; end if;

  perform set_config('planyr.share_intent', '1', true);   -- transaction-local; cannot leak
  update public.sites set team_id = p_team_id
    where coalesce(group_id, id) = p_group_id and user_id = v_uid and deleted_at is null
      and team_id is distinct from p_team_id;
  get diagnostics v_count = row_count;
  perform set_config('planyr.share_intent', '0', true);

  return v_count;
end;
$$;
revoke all on function public.set_project_team(text, uuid) from public;
grant execute on function public.set_project_team(text, uuid) to authenticated;

-- 4) Per-plan lock RPC ------------------------------------------------------
create or replace function public.set_plan_lock(p_site_id text, p_locked boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ok integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.sites set share_locked = coalesce(p_locked, false)
    where id = p_site_id and user_id = v_uid;
  get diagnostics v_ok = row_count;
  if v_ok = 0 then raise exception 'That plan is not yours to lock.' using errcode = '42501'; end if;
  return coalesce(p_locked, false);
end;
$$;
revoke all on function public.set_plan_lock(text, boolean) from public;
grant execute on function public.set_plan_lock(text, boolean) to authenticated;

-- 5) Lock-aware RLS ---------------------------------------------------------
-- Every team branch below gains `and not share_locked`. SELECT is deliberately NOT
-- narrowed: a locked plan is view-only, so teammates must still be able to read it.
-- The owner branch (`user_id = auth.uid()`) is untouched everywhere — a lock never
-- locks the owner out of their own plan.
drop policy if exists "update own or team sites" on public.sites;
create policy "update own or team sites" on public.sites
  for update to authenticated
  using ( user_id = (select auth.uid())
          or (team_id is not null and public.is_team_member(team_id) and not share_locked) )
  with check ( (user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)))
               or (team_id is not null and public.is_team_member(team_id) and not share_locked) );

drop policy if exists "delete own or team-admin sites" on public.sites;
create policy "delete own or team-admin sites" on public.sites
  for delete to authenticated
  using ( user_id = (select auth.uid())
          or (team_id is not null and public.is_team_admin(team_id) and not share_locked) );

-- site_elements is where the drawing actually lives, so a lock that stopped at the
-- `sites` header would be no lock at all — a teammate could still move every building.
-- One shared predicate, applied to all four policies.
drop policy if exists "select elements via parent site" on public.site_elements;
create policy "select elements via parent site" on public.site_elements
  for select to authenticated using (exists (
    select 1 from public.sites s where s.id = site_elements.site_id
      and (s.user_id = (select auth.uid()) or (s.team_id is not null and public.is_team_member(s.team_id)))));

drop policy if exists "insert elements via parent site" on public.site_elements;
create policy "insert elements via parent site" on public.site_elements
  for insert to authenticated with check (exists (
    select 1 from public.sites s where s.id = site_elements.site_id
      and (s.user_id = (select auth.uid())
           or (s.team_id is not null and public.is_team_member(s.team_id) and not s.share_locked))));

drop policy if exists "update elements via parent site" on public.site_elements;
create policy "update elements via parent site" on public.site_elements
  for update to authenticated
  using (exists (
    select 1 from public.sites s where s.id = site_elements.site_id
      and (s.user_id = (select auth.uid())
           or (s.team_id is not null and public.is_team_member(s.team_id) and not s.share_locked))))
  with check (exists (
    select 1 from public.sites s where s.id = site_elements.site_id
      and (s.user_id = (select auth.uid())
           or (s.team_id is not null and public.is_team_member(s.team_id) and not s.share_locked))));

drop policy if exists "purge elements owner or team-admin" on public.site_elements;
create policy "purge elements owner or team-admin" on public.site_elements
  for delete to authenticated using (exists (
    select 1 from public.sites s where s.id = site_elements.site_id
      and (s.user_id = (select auth.uid())
           or (s.team_id is not null and public.is_team_admin(s.team_id) and not s.share_locked))));

-- After running:
--   • Every existing project keeps exactly the visibility it had. Nothing is back-filled.
--   • A NEW project created by a user on a team is born with team_id set (INSERT path).
--   • An existing project changes sharing ONLY through set_project_team().
--   • A locked plan is readable but not writable by teammates; the owner is unaffected.
