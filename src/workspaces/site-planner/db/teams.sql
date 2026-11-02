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
drop policy if exists "self join via invite"  on public.team_members;
drop policy if exists "admins update roles"   on public.team_members;
drop policy if exists "admins remove members" on public.team_members;
drop policy if exists "self leave"            on public.team_members;
create policy "members read roster" on public.team_members
  for select to authenticated using (public.is_team_member(team_id));
create policy "admins add members" on public.team_members
  for insert to authenticated with check (public.is_team_admin(team_id));
-- NEW-1 (2026-11-02): there is deliberately NO client self-join policy any more. The old
-- "self join via invite" (an INSERT allowed when the caller's address matched an open invite) treated
-- the address as proof of the mailbox, and with email confirmation OFF anyone can sign up with any
-- address — so a stranger could put themselves on a team. Joining is done only by the SECURITY DEFINER
-- functions redeem_invite_link / respond_to_invite (db/team_invite_proof.sql), which require the emailed
-- link or an already-proven mailbox. Admins still add members directly ("admins add members").
create policy "admins update roles" on public.team_members
  for update to authenticated using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));
create policy "admins remove members" on public.team_members
  for delete to authenticated using (public.is_team_admin(team_id));
create policy "self leave" on public.team_members
  for delete to authenticated using (user_id = (select auth.uid()));

-- 7) RLS — team_invites ------------------------------------------------------
alter table public.team_invites enable row level security;
drop policy if exists "admins read invites"  on public.team_invites;
drop policy if exists "invitee reads own"     on public.team_invites;  -- NEW-1: stays dropped
drop policy if exists "admins create invites" on public.team_invites;
drop policy if exists "admins delete invites" on public.team_invites;
create policy "admins read invites" on public.team_invites
  for select to authenticated using (public.is_team_admin(team_id));
-- NEW-1 (2026-11-02): no "invitee reads own" policy any more — with confirmation OFF the address is not proof,
-- and the row carries the invite id (the bearer secret in the emailed link). An invitee reads their
-- invitations through list_my_invites(), which withholds everything until the mailbox is proven.
create policy "admins create invites" on public.team_invites
  for insert to authenticated with check (public.is_team_admin(team_id));
create policy "admins delete invites" on public.team_invites
  for delete to authenticated using (public.is_team_admin(team_id));

-- 8) claim_team_invites — a NO-OP since NEW-1 (2026-11-02). It used to add the caller to every team whose open
-- invite matched their address; with email confirmation OFF the address is not proof of the mailbox, so
-- that was a way onto a team for anyone who could type an address. Kept (and granted) so a cached older
-- client that still calls it on load gets 0 instead of an error. Joining is db/team_invite_proof.sql.
create or replace function public.claim_team_invites()
returns integer language plpgsql security definer set search_path = public as $$
begin
  return 0;
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

-- 9a) Teams the caller belongs to (SECURITY DEFINER) -------------------------
-- Server-side join so listing doesn't depend on PostgREST's embedded-join relationship
-- cache (which can transiently 404 right after the tables change, hiding a just-created team).
create or replace function public.list_my_teams()
returns table (id uuid, name text, role text, created_by uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, m.role, t.created_by, t.created_at
  from public.team_members m
  join public.teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by t.created_at desc;
$$;
revoke all on function public.list_my_teams() from public;
grant execute on function public.list_my_teams() to authenticated;

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

-- 10) handle_new_user (from db/profiles.sql), re-created AFTER the team tables exist. NEW-1 (2026-11-02): it no
-- longer joins anyone to a team (see the comment in the body). The profile insert is unchanged from profiles.sql.
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

  -- NEW-1 (2026-11-02): a new account is NOT added to any team here. This used to join every team whose open
  -- invite matched the new address — but email confirmation is off, so nobody has proven they own that
  -- address. The emailed link (redeem_invite_link) or an already-proven mailbox is the only way in.
  return new;
end;
$$;
-- trigger on_auth_user_created already exists (db/profiles.sql) → re-creating the function suffices.
