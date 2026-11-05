-- V2080640 step 7 / B2635968 — clear the team-invite live-check leftovers. ONE-SHOT, run once in the Supabase SQL editor.
--
-- WHAT IT DELETES — only rows tied to an `@planyr.test` address (the pinned test-account domain), nothing else:
--   1. team_invites   whose team no longer exists (the live DB has no FK invites -> teams, so deleting a team
--                     orphaned them) AND whose email ends in @planyr.test                      (expected 15)
--   2. team_members   whose team no longer exists AND whose user's auth email ends in @planyr.test   (expected 21)
--   3. mailbox_proofs the TEAMMATE's own row (e2e-teammate@planyr.test proving e2e-teammate@planyr.test)  (expected 1)
--                     — step 7 needs that mailbox UNPROVEN
--   4. auth.users     the one account zz-proof-mw130fz4@planyr.test (its mailbox_proofs / memberships cascade)  (expected 1)
-- It NEVER touches a real address, a real team, a team that still exists, the two pinned accounts themselves
-- (e2e@planyr.test, e2e-teammate@planyr.test) or the standing fixture sites.
--
-- SAFETY: one transaction. Candidates are collected first, then ASSERTED — every candidate's email must end in
-- '@planyr.test' and no set may exceed its expected size — before anything is deleted; any failed assertion raises and
-- the whole run rolls back with nothing changed. The read-only counts print before and after.

begin;

-- ── BEFORE: read-only counts ─────────────────────────────────────────────────────────────────────────────
select 'before' as phase,
  (select count(*) from public.team_invites i
     where not exists (select 1 from public.teams t where t.id = i.team_id))                                  as orphan_invites_all,
  (select count(*) from public.team_invites i
     where not exists (select 1 from public.teams t where t.id = i.team_id)
       and lower(i.email) like '%@planyr.test')                                                              as orphan_invites_test,
  (select count(*) from public.team_members m
     where not exists (select 1 from public.teams t where t.id = m.team_id))                                  as orphan_members_all,
  (select count(*) from public.team_members m join auth.users u on u.id = m.user_id
     where not exists (select 1 from public.teams t where t.id = m.team_id)
       and lower(u.email) like '%@planyr.test')                                                              as orphan_members_test,
  (select count(*) from public.mailbox_proofs p join auth.users u on u.id = p.user_id
     where lower(u.email) = 'e2e-teammate@planyr.test')                                                       as teammate_proofs,
  (select count(*) from auth.users where lower(email) = 'zz-proof-mw130fz4@planyr.test')                      as zz_user;

-- ── candidates (by id), then assert ──────────────────────────────────────────────────────────────────────
create temp table _c_invites on commit drop as
  select i.id, i.email from public.team_invites i
   where not exists (select 1 from public.teams t where t.id = i.team_id)
     and lower(i.email) like '%@planyr.test';

create temp table _c_members on commit drop as
  select m.team_id, m.user_id, u.email from public.team_members m join auth.users u on u.id = m.user_id
   where not exists (select 1 from public.teams t where t.id = m.team_id)
     and lower(u.email) like '%@planyr.test';

create temp table _c_proofs on commit drop as
  select p.user_id, p.email, u.email as account from public.mailbox_proofs p join auth.users u on u.id = p.user_id
   where lower(u.email) = 'e2e-teammate@planyr.test' and lower(p.email) = 'e2e-teammate@planyr.test';

create temp table _c_users on commit drop as
  select id, email from auth.users where lower(email) = 'zz-proof-mw130fz4@planyr.test';

do $$
begin
  if exists (select 1 from _c_invites where lower(email) not like '%@planyr.test')
     or exists (select 1 from _c_members where lower(email) not like '%@planyr.test')
     or exists (select 1 from _c_proofs where lower(email) <> 'e2e-teammate@planyr.test' or lower(account) <> 'e2e-teammate@planyr.test')
     or exists (select 1 from _c_users where lower(email) <> 'zz-proof-mw130fz4@planyr.test') then
    raise exception 'ABORT: a candidate row is not an @planyr.test row — nothing deleted';
  end if;
  if (select count(*) from _c_invites) > 15 or (select count(*) from _c_members) > 21
     or (select count(*) from _c_proofs) > 1 or (select count(*) from _c_users) > 1 then
    raise exception 'ABORT: more candidate rows than the 15 / 21 / 1 / 1 this run was written for — nothing deleted';
  end if;
  -- the zz account must own nothing that still matters (a team it created would not be deleted by this script)
  if exists (select 1 from public.teams t join _c_users u on u.id = t.created_by) then
    raise exception 'ABORT: the zz-proof account still owns a live team — nothing deleted';
  end if;
end $$;

-- ── delete (children first), each by the asserted ids ────────────────────────────────────────────────────
delete from public.team_invites  i using _c_invites c where i.id = c.id;
delete from public.team_members  m using _c_members c where m.team_id = c.team_id and m.user_id = c.user_id;
delete from public.mailbox_proofs p using _c_proofs c where p.user_id = c.user_id and p.email = c.email;
delete from public.mailbox_proofs p using _c_users  c where p.user_id = c.id;
delete from public.team_members   m using _c_users  c where m.user_id = c.id;
delete from auth.users            u using _c_users  c where u.id = c.id;

-- ── AFTER: read-only counts (expect 0 / 0 / 0 / 0 for the @planyr.test sets) ─────────────────────────────
select 'after' as phase,
  (select count(*) from public.team_invites i
     where not exists (select 1 from public.teams t where t.id = i.team_id)
       and lower(i.email) like '%@planyr.test')                                                              as orphan_invites_test,
  (select count(*) from public.team_members m join auth.users u on u.id = m.user_id
     where not exists (select 1 from public.teams t where t.id = m.team_id)
       and lower(u.email) like '%@planyr.test')                                                              as orphan_members_test,
  (select count(*) from public.mailbox_proofs p join auth.users u on u.id = p.user_id
     where lower(u.email) = 'e2e-teammate@planyr.test')                                                       as teammate_proofs,
  (select count(*) from auth.users where lower(email) = 'zz-proof-mw130fz4@planyr.test')                      as zz_user,
  -- untouched: anything not @planyr.test (orphans of a real address, if any, are reported here and left alone)
  (select count(*) from public.team_invites i
     where not exists (select 1 from public.teams t where t.id = i.team_id)
       and lower(i.email) not like '%@planyr.test')                                                          as orphan_invites_real_left_alone;

commit;
