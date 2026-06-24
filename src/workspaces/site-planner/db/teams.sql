-- Shared team workspaces — teams, membership, invites (B-TEAM, phase 1).
-- Run ONCE in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER db/profiles.sql.
-- Idempotent; safe to re-run. ADDITIVE and self-contained: this file creates ONLY the
-- team-management tables + helpers. It does NOT touch public.sites / doc_reviews / file_facts
-- — data sharing is a separate, later migration (db/team_sharing.sql). After this file alone,
-- the rest of the app behaves EXACTLY as before: users can create teams and invite people, but
-- no project data is shared until team_sharing.sql is run and a project is deliberately shared.
--
-- Model:
--   public.teams         — one row per team (a shared workspace).
--   public.team_members  — who's in a team and their role ('admin' | 'member').
--   public.team_invites  — pending invites keyed by email, so you can invite someone who
--                          doesn't have an account yet; it activates when they sign up / sign in.
--
-- The trick that makes RLS safe here: SECURITY DEFINER helper functions (is_team_member /
-- is_team_admin) read team_members as the function OWNER, bypassing RLS. Policies on other
-- tables call these helpers, so they never re-trigger team_members' own policies — avoiding
-- the classic "infinite recursion detected in policy for relation team_members" error.

-- 1) Teams -------------------------------------------------------------------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);
-- If the table already existed (hand-created in the dashboard) and is missing columns,
-- add them so the INSERT policy and createTeam() can reference created_by.
alter table if exists public.teams add column if not exists created_by uuid not null default auth.uid() references auth.users(id);
alter table if exists public.teams add column if not exists created_at timestamptz not null default now();

-- 2) Membership --------------------------------------------------------------
create table if not exists public.team_members (
  team_id   uuid not null references public.teams(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin','member')),
  added_by  uuid references auth.users(id),
  added_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members (user_id);

-- 3) Pending invites (keyed by lower-cased email; one open invite per team+email) -----
create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  email       text not null,                 -- stored lower-cased (client lowers too)
  role        text not null default 'member' check (role in ('admin','member')),
  invited_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  unique (team_id, email)
);
create index if not exists team_invites_email_idx on public.team_invites (lower(email));

-- 4) Recursion-safe membership helpers (SECURITY DEFINER → bypass RLS) -------
-- Answer ONLY for the current auth.uid(); never leak another user's/team's membership.
create or replace function public.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_team_admin(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

revoke all on function public.is_team_member(uuid) from public;
revoke all on function public.is_team_admin(uuid)  from public;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_admin(uuid)  to authenticated;

-- 5) RLS — teams -------------------------------------------------------------
alter table public.teams enable row level security;
drop policy if exists "members read team" on public.teams;
drop policy if exists "auth create team"  on public.teams;
drop policy if exists "admins update team" on public.teams;
drop policy if exists "admins delete team" on public.teams;
create policy "members read team" on public.teams
  for select to authenticated using (public.is_team_member(id));
create policy "auth create team" on public.teams
  for insert to authenticated with check ((select auth.uid()) = created_by);
create policy "admins update team" on public.teams
  for update to authenticated using (public.is_team_admin(id)) with check (public.is_team_admin(id));
create policy "admins delete team" on public.teams
  for delete to authenticated using (public.is_team_admin(id));

-- 6) RLS — team_members ------------------------------------------------------
-- SELECT routes through the SECURITY-DEFINER helper (which reads team_members as owner),
-- so a policy ON team_members querying team_members does NOT recurse.
alter table public.team_members enable row level security;
drop policy if exists "members read roster"  on public.team_members;
drop policy if exists "admins add members"    on public.team_members;
drop policy if exists "self add via claim"    on public.team_members;
drop policy if exists "admins update roles"   on public.team_members;
drop policy if exists "admins remove members" on public.team_members;
drop policy if exists "self leave"            on public.team_members;
create policy "members read roster" on public.team_members
  for select to authenticated using (public.is_team_member(team_id));
create policy "admins add members" on public.team_members
  for insert to authenticated with check (public.is_team_admin(team_id));
-- backstop so a user can insert THEIR OWN membership when claiming an invite (claim_team_invites
-- runs SECURITY DEFINER and is the normal path; this keeps a direct self-insert narrow to self).
create policy "self add via claim" on public.team_members
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "admins update roles" on public.team_members
  for update to authenticated using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));
create policy "admins remove members" on public.team_members
  for delete to authenticated using (public.is_team_admin(team_id));
create policy "self leave" on public.team_members
  for delete to authenticated using (user_id = (select auth.uid()));

-- 7) RLS — team_invites ------------------------------------------------------
alter table public.team_invites enable row level security;
drop policy if exists "admins read invites"  on public.team_invites;
drop policy if exists "invitee reads own"     on public.team_invites;
drop policy if exists "admins create invites" on public.team_invites;
drop policy if exists "admins delete invites" on public.team_invites;
create policy "admins read invites" on public.team_invites
  for select to authenticated using (public.is_team_admin(team_id));
-- an invitee may see invites addressed to their own verified email (auth.email() = JWT claim)
create policy "invitee reads own" on public.team_invites
  for select to authenticated using (lower(email) = lower(auth.email()));
create policy "admins create invites" on public.team_invites
  for insert to authenticated with check (public.is_team_admin(team_id));
create policy "admins delete invites" on public.team_invites
  for delete to authenticated using (public.is_team_admin(team_id));

-- 8) Claim invites for the CURRENT user (existing account invited later) ------
-- SECURITY DEFINER so it can write team_members + mark invites claimed regardless of RLS.
-- Acts ONLY on invites whose email matches the caller's verified auth email. Idempotent.
-- Returns the number of NEW memberships created.
create or replace function public.claim_team_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_count integer := 0;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;
  insert into public.team_members (team_id, user_id, role, added_by)
    select i.team_id, auth.uid(), i.role, i.invited_by
    from public.team_invites i
    where lower(i.email) = v_email and i.claimed_at is null
    on conflict (team_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  update public.team_invites
    set claimed_at = now()
    where lower(email) = v_email and claimed_at is null;
  return v_count;
end;
$$;
grant execute on function public.claim_team_invites() to authenticated;

-- 9) Team roster (name + email) without opening profiles SELECT to other users -
-- SECURITY DEFINER, returns rows ONLY for teams the caller belongs to. Reads the email
-- mirror added in db/profiles.sql so auth.users.email never needs cross-user access.
create or replace function public.list_team_members(p_team uuid)
returns table (user_id uuid, role text, first_name text, last_name text, email text)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, p.first_name, p.last_name, p.email
  from public.team_members m
  left join public.profiles p on p.id = m.user_id
  where m.team_id = p_team and public.is_team_member(p_team);
$$;
grant execute on function public.list_team_members(uuid) to authenticated;

-- 9b) Atomic team creation (SECURITY DEFINER) --------------------------------
-- Create a team AND the creator's admin membership in one transaction. Runs as
-- the function owner (RLS bypassed inside), returning the new id directly. This
-- avoids the two-step client insert, whose .select() RETURNING on public.teams
-- is blocked by the "members read team" SELECT policy (the creator isn't a
-- member yet) → "new row violates row-level security policy for table teams".
create or replace function public.create_team(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_name = '' then raise exception 'Team name is required' using errcode = '22023'; end if;
  insert into public.teams (name, created_by) values (v_name, v_uid) returning id into v_id;
  insert into public.team_members (team_id, user_id, role, added_by)
    values (v_id, v_uid, 'admin', v_uid) on conflict (team_id, user_id) do nothing;
  return v_id;
end;
$$;
revoke all on function public.create_team(text) from public;
grant execute on function public.create_team(text) to authenticated;

-- 10) Auto-claim invites on signup — extend handle_new_user (from db/profiles.sql) --
-- Re-created here (AFTER the team tables exist) so a brand-new user lands on any team they
-- were invited to the instant they confirm. The profile insert is unchanged from profiles.sql.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, org, email)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'org', ''),
    lower(new.email)
  )
  on conflict (id) do update set email = excluded.email;

  insert into public.team_members (team_id, user_id, role, added_by)
    select i.team_id, new.id, i.role, i.invited_by
    from public.team_invites i
    where lower(i.email) = lower(new.email) and i.claimed_at is null
    on conflict (team_id, user_id) do nothing;
  update public.team_invites set claimed_at = now()
    where lower(email) = lower(new.email) and claimed_at is null;
  return new;
end;
$$;
-- trigger on_auth_user_created already exists (db/profiles.sql) → re-creating the function suffices.
