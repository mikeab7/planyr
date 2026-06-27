-- Team re-home guard (B486, security fix) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), AFTER db/team_sharing.sql. Idempotent; safe to re-run.
--
-- WHY: db/team_sharing.sql's "update own or team …" policies let a teammate EDIT a shared row, with a
-- WITH CHECK whose second branch — (team_id is not null and is_team_member(team_id)) — only requires that
-- the RESULTING team_id is a team the editor belongs to. RLS WITH CHECK cannot see the OLD row, so it
-- cannot tell "kept the same team" from "moved to a different team." That let a NON-OWNER member who
-- belongs to two teams RE-HOME the owner's shared project from team X to team Y (cutting team X — and the
-- owner, if not on Y — out of access). The documented intent is owner-only re-home/unshare; the policies
-- alone can't enforce it. This trigger does.
--
-- RULE: only the row OWNER (user_id) may CHANGE team_id (share / unshare / re-home). A teammate may edit
-- the row's CONTENT all they like, but must leave team_id exactly as it was. Members keep full read/edit on
-- shared content — nothing about normal collaboration changes; only the cross-team move is blocked.
--
-- Plain (SECURITY INVOKER) trigger: it only reads OLD/NEW + auth.uid(); no RLS bypass needed.

create or replace function public.guard_team_rehome()
returns trigger language plpgsql as $$
begin
  if new.team_id is distinct from old.team_id and old.user_id is distinct from auth.uid() then
    raise exception 'Only the project owner can change sharing (team_id).' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sites_team_rehome_guard on public.sites;
create trigger sites_team_rehome_guard before update on public.sites
  for each row execute function public.guard_team_rehome();

drop trigger if exists doc_reviews_team_rehome_guard on public.doc_reviews;
create trigger doc_reviews_team_rehome_guard before update on public.doc_reviews
  for each row execute function public.guard_team_rehome();

drop trigger if exists file_facts_team_rehome_guard on public.file_facts;
create trigger file_facts_team_rehome_guard before update on public.file_facts
  for each row execute function public.guard_team_rehome();

-- After running: a teammate editing shared content still works; only an attempt to CHANGE team_id by a
-- non-owner raises "Only the project owner can change sharing (team_id)." Owner share/unshare/re-home is
-- unaffected (old.user_id = auth.uid()).
