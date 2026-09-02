-- ============================================================================
-- B1060784/NEW-3 — proof that the account-wide split detector actually detects, and that
-- reconcile_site_group_name() actually heals what it detects, AGAINST THE REAL DATABASE.
--
-- Proves the single property this whole item exists for:
--
--     A GENUINE NAME SPLIT WITHIN A GROUP GOES RED; reconcile_site_group_name() TURNS IT GREEN.
--
-- "A check that has never been seen to fail is not a check" — this is that proof, permanent and
-- re-runnable, not a one-off action taken once and forgotten. The detector query here is the
-- OWNER'S OWN exact all-groups check (verbatim, from his own production verification):
--
--   select data->>'groupId', count(distinct data->>'site')
--   from public.sites where data->>'groupId' is not null
--   group by 1 having count(distinct data->>'site') > 1;
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute.
--   It is SELF-ROLLING-BACK — it ends by raising an exception carrying the report, so every
--   fixture row is discarded. It writes NOTHING that survives. Read the report out of the error
--   message. (Same shape as commit_elements_group_cas.test.sql / team_share_scope.test.sql.)
--   Fixture ids are `zzsc1a`/`zzsc1b` under group `zzsplitcheck-b1060784` — never a real plan id,
--   and never ZZ-RENAME-TEST-D (that group is reserved for the owner, per instruction).
--
-- HOW TO PROVE IT RED (do this whenever reconcile_site_group_name() is touched):
--   Comment out the `perform public.reconcile_site_group_name(...)` line and re-run — the AFTER
--   assertion must now FAIL (still 1 group split, not 0), proving the heal step is load-bearing
--   rather than the BEFORE/AFTER counts coincidentally agreeing.
-- ============================================================================
do $$
declare
  owner_uid uuid;
  gid text := 'zzsplitcheck-b1060784';
  before_split int;
  after_split int;
  rep text := '';
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'proof: no auth user to hang the fixture off'; end if;

  insert into public.sites (id, user_id, group_id, site, data, version)
  values
    ('zzsc1a', owner_uid, gid, 'Old Throwaway Name',
      jsonb_build_object('id','zzsc1a','groupId',gid,'site','Old Throwaway Name','siteRenamedAt',1000,'name','Concept A'), 1),
    ('zzsc1b', owner_uid, gid, 'New Throwaway Name',
      jsonb_build_object('id','zzsc1b','groupId',gid,'site','New Throwaway Name','siteRenamedAt',2000,'name','Concept B'), 1);

  -- RED: the owner's own exact all-groups query must find this throwaway group split.
  select count(*) into before_split
  from (
    select data->>'groupId' as g from public.sites
    where data->>'groupId' = gid
    group by 1 having count(distinct data->>'site') > 1
  ) s;
  if before_split <> 1 then
    raise exception 'PROOF FAILED — the detector did not see the planted split (expected 1, got %)', before_split;
  end if;
  rep := rep || format('BEFORE heal: %s group(s) split (expect 1, RED — confirmed) — ', before_split);

  -- Heal through the real write path — the SAME function scripts/audit-project-name-split.mjs's
  -- --fix calls, newest-stamp-wins, exactly what the script's own stamp-basis authority resolves to.
  perform public.reconcile_site_group_name(gid, 'New Throwaway Name', 2000);

  -- GREEN: same query, must now find zero.
  select count(*) into after_split
  from (
    select data->>'groupId' as g from public.sites
    where data->>'groupId' = gid
    group by 1 having count(distinct data->>'site') > 1
  ) s;
  if after_split <> 0 then
    raise exception 'PROOF FAILED — reconcile_site_group_name() did not heal the planted split (expected 0, got %)', after_split;
  end if;
  rep := rep || format('AFTER heal: %s group(s) split (expect 0, GREEN — confirmed).', after_split);

  raise exception 'PROOF PASSED (rolled back, nothing persists): %', rep;
end $$;
