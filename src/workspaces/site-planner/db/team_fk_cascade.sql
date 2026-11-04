-- B2635969 — production had NO foreign key from team_invites.team_id / team_members.team_id to teams(id), although
-- db/teams.sql declares both `references public.teams(id) on delete cascade`. Deleting a team therefore left its invites
-- open and its memberships behind (found live 2026-11-03 while verifying B2635968).
--
-- This adds the two keys, ON DELETE CASCADE, under the names Postgres would have given them. It deletes NOTHING: it first
-- REFUSES (raises, changes nothing) if any orphan row still exists, so adding the key can never silently remove a member or
-- an invite. Idempotent — a key that already exists is left alone. Run once in the Supabase SQL editor.
--
-- Read-only check before / after (both must show 0 orphans; "after" must list both constraints):
--   select (select count(*) from public.team_invites i where not exists (select 1 from public.teams t where t.id = i.team_id)) as orphan_invites,
--          (select count(*) from public.team_members m where not exists (select 1 from public.teams t where t.id = m.team_id)) as orphan_members;
--   select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--    where contype = 'f' and confrelid = 'public.teams'::regclass and conrelid in ('public.team_invites'::regclass, 'public.team_members'::regclass);

do $$
begin
  if exists (select 1 from public.team_invites i where not exists (select 1 from public.teams t where t.id = i.team_id))
     or exists (select 1 from public.team_members m where not exists (select 1 from public.teams t where t.id = m.team_id)) then
    raise exception 'ABORT: orphan team_invites / team_members rows exist — clear them first (nothing was changed)';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'team_invites_team_id_fkey' and conrelid = 'public.team_invites'::regclass) then
    alter table public.team_invites
      add constraint team_invites_team_id_fkey foreign key (team_id) references public.teams(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'team_members_team_id_fkey' and conrelid = 'public.team_members'::regclass) then
    alter table public.team_members
      add constraint team_members_team_id_fkey foreign key (team_id) references public.teams(id) on delete cascade;
  end if;
end $$;
