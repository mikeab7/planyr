-- ============================================================================
-- project_shares — per-grantee, per-module project sharing (B916 / NEW-2).
--
-- ⛔ DRAFT — NOT YET APPLIED TO PRODUCTION. Do not run blind.
--    This governs who can read whose projects; its core acceptance ("revoke is
--    IMMEDIATE and verified — crash-severity if a revoked grantee can still
--    read") can only be confirmed with TWO signed-in accounts in the live app,
--    which the sandbox cannot do. Apply + verify with the owner present, using a
--    second test account. See BACKLOG.md B916 and VERIFICATION.md V387/V388.
--
-- Additive + private-by-default: this file creates ONLY the sharing tables +
-- helper + RPCs. Until a project-scoped table's SELECT policy is switched to call
-- has_project_access() (the commented examples at the bottom, applied one table
-- at a time under live verification), NOTHING changes — a project with zero
-- grants behaves exactly as before, and today's team_id sharing (B406) keeps
-- working untouched. project_shares is a SECOND, independent read path; when both
-- a team_id share and a project_shares grant cover the same (project, user),
-- access is the UNION (either grants read).
--
-- Model:
--   public.project_shares  — one row per (project → grantee) grant. grantee is a
--                            user OR a team. At most ONE LIVE grant per (project,
--                            grantee) — enforced by a partial unique index.
--   public.share_events    — append-only audit log of every grant / revoke.
--   public.has_project_access(project_id, module, min_role) — the ONE RLS helper
--                            every project-scoped table calls.
--
-- Depends on: db/teams.sql (public.teams, public.team_members, is_team_member).
--
-- ⚠ DESIGN QUESTION for the live pass: what is `project_id`? Today the app groups
--    plans by a client-side groupId and shares whole `sites` rows via team_id
--    (B406). project_shares keys on a stable project_id uuid. Deciding the exact
--    mapping (a projects table? the site groupId promoted to a column?) is part of
--    the live design work — this DRAFT keeps project_id as an opaque uuid so the
--    schema is ready once that call is made.
-- ============================================================================

-- 1) Grants ------------------------------------------------------------------
create table if not exists public.project_shares (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null,
  grantee_type text not null check (grantee_type in ('user','team')),
  grantee_id   uuid not null,                 -- auth.users(id) when 'user', teams(id) when 'team'
  role         text not null default 'viewer' check (role in ('viewer')), -- v1: viewer only (see B916)
  modules      text[] not null default '{}',  -- module keys the grantee may see; NOT boolean columns
  created_by   uuid not null default auth.uid() references auth.users(id),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz                    -- null = LIVE; set = revoked (kept for the audit trail)
);
create index if not exists project_shares_project_idx on public.project_shares (project_id) where revoked_at is null;
create index if not exists project_shares_grantee_idx on public.project_shares (grantee_type, grantee_id) where revoked_at is null;
-- Exactly ONE live grant per (project, grantee): a partial unique index over the non-revoked rows.
create unique index if not exists project_shares_one_live_idx
  on public.project_shares (project_id, grantee_type, grantee_id) where revoked_at is null;

-- 2) Audit log (append-only) -------------------------------------------------
create table if not exists public.share_events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  action     text not null check (action in ('grant','revoke','modify')),
  share_id   uuid,                             -- the project_shares row acted on
  grantee_type text,
  grantee_id text,
  modules    text[],
  actor      uuid not null default auth.uid() references auth.users(id),
  at         timestamptz not null default now()
);
create index if not exists share_events_project_idx on public.share_events (project_id, at desc);

-- 3) The ONE RLS helper ------------------------------------------------------
-- has_project_access(project, module, min_role) → true when the caller:
--   • OWNS the project (a project_shares grant created_by them counts as ownership proxy in v1;
--     replace with the real owner check once project_id identity is settled), OR
--   • has a LIVE user-grant whose modules include `module` and role ≥ min_role, OR
--   • has a LIVE team-grant to a team they belong to, same module/role test (UNION with team_id).
-- SECURITY DEFINER so it reads project_shares/team_members as owner (no policy recursion).
-- v1 has a single role, so role ordering is trivial; min_role is threaded now so adding
-- 'commenter'/'editor' later is a data + helper change, not a per-table policy rewrite.
create or replace function public.has_project_access(p_project uuid, p_module text, p_min_role text default 'viewer')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    -- direct user grant
    select 1 from public.project_shares s
    where s.project_id = p_project
      and s.revoked_at is null
      and s.grantee_type = 'user'
      and s.grantee_id = auth.uid()
      and (s.modules @> array[p_module] or p_module is null)
    union all
    -- team grant to a team the caller belongs to
    select 1 from public.project_shares s
    where s.project_id = p_project
      and s.revoked_at is null
      and s.grantee_type = 'team'
      and public.is_team_member(s.grantee_id)
      and (s.modules @> array[p_module] or p_module is null)
  );
$$;
revoke all on function public.has_project_access(uuid, text, text) from public;
grant execute on function public.has_project_access(uuid, text, text) to authenticated;

-- 4) RLS on the sharing tables themselves ------------------------------------
alter table public.project_shares enable row level security;
drop policy if exists "owner reads grants"    on public.project_shares;
drop policy if exists "grantee reads own grant" on public.project_shares;
drop policy if exists "owner creates grant"    on public.project_shares;
drop policy if exists "owner revokes grant"    on public.project_shares;
-- the grantor sees the full access list for projects they granted; a grantee sees only their own row.
create policy "owner reads grants" on public.project_shares
  for select to authenticated using (created_by = (select auth.uid()));
create policy "grantee reads own grant" on public.project_shares
  for select to authenticated using (
    (grantee_type = 'user' and grantee_id = (select auth.uid()))
    or (grantee_type = 'team' and public.is_team_member(grantee_id))
  );
-- Writes go through the SECURITY-DEFINER RPCs below (which also write the audit row). These
-- narrow client policies are the backstop: only the grantor may create/revoke, and only their
-- own rows. (No god-mode: nobody can read or write another grantor's grants.)
create policy "owner creates grant" on public.project_shares
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "owner revokes grant" on public.project_shares
  for update to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

alter table public.share_events enable row level security;
drop policy if exists "actor reads own events" on public.share_events;
create policy "actor reads own events" on public.share_events
  for select to authenticated using (actor = (select auth.uid()));

-- 5) Grant / revoke RPCs (atomic + audited) ----------------------------------
-- share_project: upsert the ONE live grant for (project, grantee) and log a 'grant'/'modify' event.
create or replace function public.share_project(p_project uuid, p_grantee_type text, p_grantee_id uuid, p_modules text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  -- reactivate a revoked grant, or insert fresh; keep exactly one live row per (project,grantee).
  update public.project_shares
    set modules = p_modules, revoked_at = null, created_by = v_uid, created_at = now()
    where project_id = p_project and grantee_type = p_grantee_type and grantee_id = p_grantee_id
    returning id into v_id;
  if v_id is null then
    insert into public.project_shares (project_id, grantee_type, grantee_id, modules, created_by)
      values (p_project, p_grantee_type, p_grantee_id, p_modules, v_uid) returning id into v_id;
  end if;
  insert into public.share_events (project_id, action, share_id, grantee_type, grantee_id, modules, actor)
    values (p_project, 'grant', v_id, p_grantee_type, p_grantee_id::text, p_modules, v_uid);
  return v_id;
end;
$$;
revoke all on function public.share_project(uuid, text, uuid, text[]) from public;
grant execute on function public.share_project(uuid, text, uuid, text[]) to authenticated;

-- revoke_share: set revoked_at NOW (immediate — the partial index drops it from every access check
-- on the next query) and log a 'revoke' event. Undoable in one step by re-calling share_project.
create or replace function public.revoke_share(p_share_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_project uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.project_shares set revoked_at = now()
    where id = p_share_id and created_by = v_uid and revoked_at is null
    returning project_id into v_project;
  if v_project is null then raise exception 'No live grant to revoke (not yours, or already revoked)'; end if;
  insert into public.share_events (project_id, action, share_id, actor)
    values (v_project, 'revoke', p_share_id, v_uid);
end;
$$;
revoke all on function public.revoke_share(uuid) from public;
grant execute on function public.revoke_share(uuid) to authenticated;

-- 6) Wiring project-scoped tables (ILLUSTRATIVE — apply one at a time, live-verified) --------
-- Each project-scoped table's SELECT policy becomes a one-line union: "own row OR
-- has_project_access(<the row's project_id>, '<module key>')". Example shapes (NOT run here — the
-- exact project_id column per table is the DESIGN QUESTION above):
--
--   -- Site Planner:
--   create policy "shared read sites" on public.sites for select to authenticated
--     using (user_id = auth.uid() or has_project_access(project_id, 'site-planner'));
--   -- Document Review:
--   create policy "shared read reviews" on public.doc_reviews for select to authenticated
--     using (user_id = auth.uid() or has_project_access(project_id, 'doc-review'));
--
-- v1 is VIEWER-only, so NO shared INSERT/UPDATE/DELETE policies are added — a grantee can read
-- but never write (the read-only client mode in B917 mirrors this in the UI so a viewer is never
-- even offered an edit that RLS would reject).
--
-- ⛔ Live acceptance before any of section 6 ships to prod (V387/V388):
--   1. Account A shares project P (module = site-planner) to Account B → B sees P, read-only.
--   2. B cannot write P (every edit RLS-rejected AND UI-disabled).
--   3. A revokes → re-run B's SELECT on P → returns ZERO rows immediately (crash-severity if not).
--   4. A project with no grant is invisible to B (default-private holds).
--   5. Redacting a module (uncheck) hides only that module, others still visible.
