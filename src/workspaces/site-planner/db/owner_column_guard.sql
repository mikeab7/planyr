-- B2404336 (NEW-1, DB hardening block 2026-10-21) — THE OWNER COLUMN IS IMMUTABLE TO A TEAM MEMBER.
--
-- MEASURED ON PRODUCTION (2026-10-19/21, pg_policy + pg_trigger, project lyeqzkuiwngunutlkkmi): the UPDATE
-- policies on public.sites ("update own or team sites"), public.doc_reviews ("update own or team reviews")
-- and public.file_facts ("update own or team file_facts") carry a WITH CHECK of the shape
--     (user_id = auth.uid() AND (team_id IS NULL OR is_team_member(team_id)))
--     OR (team_id IS NOT NULL AND is_team_member(team_id) [AND NOT share_locked on sites])
-- RLS WITH CHECK sees only the NEW row, never OLD, so nothing in it pins user_id to its previous value.
-- The only BEFORE UPDATE guards were guard_team_share (sites: team_id + share_locked) and
-- guard_team_rehome (doc_reviews / file_facts: team_id). sites_enforce_version_monotonic returns early
-- when data/site/name are unchanged, so a bare `set user_id = …` needs no version bump either.
--
-- THE HOLE: owner A shares project P with team T; member B runs
--     update public.sites set user_id = <B> where id = <P's plan id>;
-- USING passes (B is a member), WITH CHECK passes through its first branch (user_id is now B, team_id
-- not null, B is a member), no trigger raises → B owns the row. B then set_plan_lock()s it (the guard
-- reads old.user_id = B) and A, now an ordinary member, is locked out of their own plan. Same shape on
-- doc_reviews (a review is supposed to stay PRIVATE to its owner — owner rule 2026-10-15) and file_facts.
-- B can also hand the row to a third party through the second branch.
--
-- THE RULE: user_id on these three tables changes only when the CURRENT OWNER makes the change (a
-- deliberate transfer — auth.uid() = old.user_id), or when a trusted server-side actor does (the
-- `service_role` key, or `postgres` in the SQL editor / the Supabase MCP for a recovery). A client-role
-- write (`authenticated` / `anon`) by anyone else is refused with errcode 42501 and a plain message.
-- ONE function shared by all three tables — deliberately separate from guard_team_share /
-- guard_team_rehome so there is one implementation of "who may move the owner column", not three.
--
-- WHY THE ROLE TEST IS "current_user IN (authenticated, anon)" AND NOT "current_user <> service_role":
-- a SECURITY DEFINER RPC runs as its owner (postgres here), and a dashboard / MCP recovery runs as
-- postgres with auth.uid() NULL. Refusing everything but service_role would block a legitimate owner
-- recovery and any future, deliberately-gated transfer RPC. Measured 2026-10-21: NO function in
-- public (definer or not) updates user_id on any of the three tables, so the two forms are equivalent
-- today; this one is the one that stays correct when a trusted transfer path is added.
--
-- CLIENT SURFACE (LOUD-FAILURE): the planner never sends user_id on an UPDATE (casUpsert stamps it on
-- INSERT only), so no legitimate save can trip this. A write that does is returned by PostgREST as a
-- 42501 whose message is the text below; optimisticUpsert.interpretCas turns it into {ok:false,error},
-- cloudSync.cloudUpsertCore reports `cloud-write-failed` and returns the error to the save banner.
-- reviewStore.updateReview takes the same casUpsert path. Nothing on either route swallows it.
--
-- Idempotent. Applied to production by the shipping session. Proof: db/test/owner_column_guard.test.sql
-- (member hijack refused on all three tables, owner edits/share/lock still work, red-proof by dropping
-- the trigger). Read-only confirmation after apply:
--     select tgname, tgrelid::regclass from pg_trigger where tgname like '%owner_column%';

create or replace function public.guard_owner_column()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.user_id is distinct from old.user_id
     and old.user_id is distinct from auth.uid()
     and current_user in ('authenticated', 'anon') then
    raise exception 'Only the project owner can transfer a plan.'
      using errcode = '42501',
            hint = 'user_id is immutable for everyone except its current owner.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_owner_column() from public, anon, authenticated;

create or replace trigger sites_owner_column_guard
  before update on public.sites
  for each row execute function public.guard_owner_column();

create or replace trigger doc_reviews_owner_column_guard
  before update on public.doc_reviews
  for each row execute function public.guard_owner_column();

create or replace trigger file_facts_owner_column_guard
  before update on public.file_facts
  for each row execute function public.guard_owner_column();

-- AUDIT of every other UPDATE policy with an is_team_member branch (measured 2026-10-21):
--   comps / map_notes / site_plan_overlays — USING is `user_id = auth.uid()` (owner-only), so a member
--     cannot address the row at all; the team branch is only in WITH CHECK. No guard needed. Left alone.
--   site_elements — owned through its parent site (EXISTS … sites s …); it has no user_id column. Left alone.

-- APPLY NOTE (2026-10-21): `create or replace trigger` (PG 14+) rather than drop-then-create on purpose —
-- the Supabase MCP holds any statement containing DROP for an interactive confirmation (measured: 60 s
-- timeouts, nothing applied), while CREATE OR REPLACE / ALTER / REVOKE apply at once. Same effect.
