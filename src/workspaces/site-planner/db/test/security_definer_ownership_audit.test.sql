-- B1853664 (NEW-3, security-definer audit dispatch, 2026-09-23) — self-rolling-back, run live
-- against production via the Supabase MCP (or paste into the Supabase SQL editor). Proves, against
-- the REAL deployed functions, that every SECURITY DEFINER function in `public` whose body
-- references `public.sites` refuses (a) an unauthenticated caller and (b) a non-owner caller —
-- the exact hole PR #1797 closed on `purge_one_deleted_plan` (a missing auth.uid()-is-null guard
-- ahead of an ownership disjunction).
--
-- ============================================================================================
-- SCOPE — the six functions measured (live, via pg_proc) to have `public.sites` in their body:
--   guard_overlay_object_release() · purge_one_deleted_plan(text) · set_plan_lock(text,boolean) ·
--   set_project_team(text,uuid) · set_project_team_state(text,uuid) ·
--   sites_referencing_storage_key(text)
-- ============================================================================================
--
-- RESULT, measured 2026-09-23 against planyr_production (project lyeqzkuiwngunutlkkmi):
--   guard_overlay_object_release       — SAFE. Not independently re-audited here for auth (it is a
--                                         TRIGGER function — RETURNS trigger — so Postgres refuses
--                                         to invoke it via any ordinary call, `select`/`rpc` alike:
--                                         "ERROR: trigger functions can only be called as triggers".
--                                         No caller, authenticated or not, can reach it directly.
--                                         Proven below (Case 0).
--   purge_one_deleted_plan             — SAFE (fixed by PR #1797, B<the purge item>). Refuses a
--                                         null auth.uid() AND a non-owner/non-team-admin caller.
--                                         Re-proven below (Cases 1-3) as a live regression guard.
--   set_plan_lock                      — SAFE, already. Refuses a null auth.uid(); its UPDATE is
--                                         filtered on `user_id = v_uid`, so a non-owner's write
--                                         matches 0 rows and the function raises. Proven below
--                                         (Cases 4-6).
--   set_project_team                   — SAFE, already. Same shape as set_plan_lock: null-uid
--                                         guard, then an ownership-filtered `v_mine` precondition
--                                         before any write. Proven below (Cases 7-9).
--   set_project_team_state             — MUTATION was already safe (same ownership-filtered UPDATE
--                                         shape). Its READ was NOT: the not-found branch (caller
--                                         owns zero plans in the target group) returned `plans`/
--                                         `foreign` computed across EVERY owner in the group, before
--                                         any ownership check — a genuine (if minor) cross-tenant
--                                         information disclosure. FIXED in
--                                         `set_project_team_state_redact_foreign.sql` (same PR) —
--                                         NOT YET APPLIED to production (see that file's header:
--                                         this session was told not to apply schema changes to
--                                         production). Case 13 below is written against the FIX and
--                                         therefore FAILS on current production and will PASS once
--                                         a human or a later session applies that migration — this
--                                         is the regression test for that fix. Cases 10-12 (the
--                                         mutation half, already safe) pass now and are unaffected.
--   sites_referencing_storage_key      — SAFE, already (fixed 2026-08-14 per
--                                         docs/archive/BACKLOG-DONE.md — the `sites_referencing_storage_key`
--                                         entry there). EXECUTE is revoked from public/anon/
--                                         authenticated; only the guard trigger can reach it (via
--                                         its own SECURITY DEFINER owner privileges, which the
--                                         revoke does not touch). Re-proven below (Case 14).
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute, or run it via the
-- Supabase MCP `execute_sql` against project lyeqzkuiwngunutlkkmi. It is SELF-ROLLING-BACK — it
-- ends by raising an exception carrying the report, so every fixture (users, team, sites) is
-- discarded and NOTHING it does survives. Read the report out of the error message.
-- ============================================================================================

do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000f0f01';  -- A: owns everything in this fixture
  ub uuid := '00000000-0000-4000-8000-0000000f0f02';  -- B: unrelated, but ALSO on A's team (isolates
                                                        -- the ownership check from the team-membership
                                                        -- one for the set_project_team* cases)
  tm uuid := '00000000-0000-4000-8000-0000000f0f03';
  purge_grp   text := 'sdtest-purge-grp';
  purge_dead  text := 'sdtest-purge-dead';   -- deleted, group has a live sibling
  purge_live  text := 'sdtest-purge-live';
  lock_site   text := 'sdtest-lock-1';
  team_grp    text := 'sdtest-team-grp';
  team_site   text := 'sdtest-team-1';
  rep text := '';
  passed int := 0;
  failed int := 0;
  n boolean;
  raised boolean;
  err text;
  jres jsonb;
  anon_exec boolean;
  auth_exec boolean;
  public_exec boolean;
begin
  ------------------------------------------------------------------------------------------------
  -- fixtures, as postgres (RLS bypassed)
  ------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-audit-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-audit-b@test.invalid', now(), now());

  insert into public.teams (id, name, created_by) values (tm, 'SD Audit Team', ua);
  insert into public.team_members (team_id, user_id, role, added_by)
  values (tm, ua, 'admin', ua), (tm, ub, 'member', ua);

  -- purge_one_deleted_plan fixtures: a deleted plan with a live sibling in the same group, both A's.
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id, deleted_at)
  values (purge_dead, ua, purge_grp, 'SD audit purge', 'Concept A', now(), jsonb_build_object('id', purge_dead, 'groupId', purge_grp), null, now());
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (purge_live, ua, purge_grp, 'SD audit purge', 'Concept B', now(), jsonb_build_object('id', purge_live, 'groupId', purge_grp), null);

  -- set_plan_lock fixture: A's own plan, unlocked.
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id, share_locked)
  values (lock_site, ua, lock_site, 'SD audit lock', 'Concept A', now(), jsonb_build_object('id', lock_site), null, false);

  -- set_project_team / set_project_team_state fixture: A's own project, private.
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (team_site, ua, team_grp, 'SD audit team', 'Concept A', now(), jsonb_build_object('id', team_site, 'groupId', team_grp), null);

  ------------------------------------------------------------------------------------------------
  -- CASE 0 — guard_overlay_object_release() cannot be invoked by ANY role, ever: it is a TRIGGER
  -- function (RETURNS trigger) and Postgres itself refuses to call one outside trigger context,
  -- independent of any GRANT/REVOKE. No fixture needed; this is a structural proof.
  ------------------------------------------------------------------------------------------------
  begin
    perform public.guard_overlay_object_release();
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  if not raised or err not like '%trigger functions can only be called as triggers%' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  0. guard_overlay_object_release() was callable directly (raised=%s err=%s) — expected Postgres to refuse a trigger-returning function outside trigger context', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  0. guard_overlay_object_release() cannot be invoked directly by any role (Postgres refuses a trigger-returning function outside trigger context)\n';
  end if;

  ------------------------------------------------------------------------------------------------
  -- CASES 1-3 — purge_one_deleted_plan(text): unauthenticated refused, non-owner refused, owner
  -- succeeds (control — proves the harness can see a positive result too, per WRONG-CASE).
  ------------------------------------------------------------------------------------------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  begin
    perform id from public.purge_one_deleted_plan(purge_dead);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  -- anon has no EXECUTE grant on this function at all (measured: has_function_privilege('anon',
  -- ..., 'EXECUTE') = false), so Postgres refuses at the GRANT layer — "permission denied for
  -- function" — before the function body's own "not signed in" check ever runs. That is a
  -- STRONGER refusal than the application-level check the other four functions rely on (they ARE
  -- anon-executable), so both messages are accepted here.
  if not raised or (err not like '%not signed in%' and err not like '%permission denied%') then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  1. purge_one_deleted_plan() did not refuse an unauthenticated (anon, no JWT) caller — raised=%s err=%s', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  1. purge_one_deleted_plan() refuses an unauthenticated caller\n';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    perform id from public.purge_one_deleted_plan(purge_dead);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select exists(select 1 from public.sites where id = purge_dead and deleted_at is not null) into n;
  if not raised or not n or err not like '%not permitted%' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  2. purge_one_deleted_plan() did not refuse non-owner B — raised=%s err=%s', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  2. purge_one_deleted_plan() refuses non-owner B, row untouched\n';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    perform id from public.purge_one_deleted_plan(purge_dead);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select not exists(select 1 from public.sites where id = purge_dead) into n;
  if raised or not n then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  3 (control). purge_one_deleted_plan() by the real owner A did not succeed — raised=%s err=%s', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  3 (control). purge_one_deleted_plan() by owner A succeeds — the harness CAN see a positive result\n';
  end if;

  ------------------------------------------------------------------------------------------------
  -- CASES 4-6 — set_plan_lock(text, boolean).
  ------------------------------------------------------------------------------------------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  begin
    perform public.set_plan_lock(lock_site, true);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if not raised or err not like '%Not signed in%' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  4. set_plan_lock() did not refuse an unauthenticated caller — raised=%s err=%s', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  4. set_plan_lock() refuses an unauthenticated caller\n';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    perform public.set_plan_lock(lock_site, true);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if not raised or (select share_locked from public.sites where id = lock_site) or err not like '%not yours to lock%' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  5. set_plan_lock() did not refuse non-owner B — raised=%s err=%s locked=%s', raised, coalesce(err, '<none>'), (select share_locked from public.sites where id = lock_site));
  else
    passed := passed + 1;
    rep := rep || E'PASS  5. set_plan_lock() refuses non-owner B, lock state untouched\n';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    perform public.set_plan_lock(lock_site, true);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if raised or not (select share_locked from public.sites where id = lock_site) then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  6 (control). set_plan_lock() by owner A did not succeed — raised=%s err=%s', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  6 (control). set_plan_lock() by owner A succeeds\n';
  end if;

  ------------------------------------------------------------------------------------------------
  -- CASES 7-9 — set_project_team(text, uuid). B is on the SAME team as A, so a refusal can only be
  -- the ownership precondition (`v_mine = 0`), not the team-membership check.
  ------------------------------------------------------------------------------------------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  begin
    perform public.set_project_team(team_grp, tm);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if not raised or err not like '%Not signed in%' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  7. set_project_team() did not refuse an unauthenticated caller — raised=%s err=%s', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  7. set_project_team() refuses an unauthenticated caller\n';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    perform public.set_project_team(team_grp, tm);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if not raised or (select team_id from public.sites where id = team_site) is not null or err not like '%No project of yours%' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  8. set_project_team() did not refuse non-owner B (a fellow team member with no plan of their own in the group) — raised=%s err=%s team_id=%s', raised, coalesce(err, '<none>'), (select team_id from public.sites where id = team_site));
  else
    passed := passed + 1;
    rep := rep || E'PASS  8. set_project_team() refuses non-owner B even though B shares A''s team — ownership, not team membership, is the gate; project untouched\n';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    perform public.set_project_team(team_grp, tm);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if raised or (select team_id from public.sites where id = team_site) is distinct from tm then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  9 (control). set_project_team() by owner A did not succeed — raised=%s err=%s', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  9 (control). set_project_team() by owner A succeeds\n';
  end if;

  ------------------------------------------------------------------------------------------------
  -- CASES 10-12 — set_project_team_state(text, uuid), the MUTATION half (already safe pre-fix).
  -- Undo case 9's share first so this exercises the same "caller owns nothing in the group yet"
  -- shape cases 7/8 did — re-share via set_project_team_state itself as the owner, private again.
  ------------------------------------------------------------------------------------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  perform public.set_project_team_state(team_grp, null); -- back to private, owned by A only
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  begin
    jres := public.set_project_team_state(team_grp, tm);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if not raised or err not like '%Not signed in%' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  10. set_project_team_state() did not refuse an unauthenticated caller — raised=%s err=%s', raised, coalesce(err, '<none>'));
  else
    passed := passed + 1;
    rep := rep || E'PASS  10. set_project_team_state() refuses an unauthenticated caller\n';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    jres := public.set_project_team_state(team_grp, tm);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if raised then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  11. set_project_team_state() raised for non-owner B instead of returning a not-found outcome — err=%s', err);
  elsif (select team_id from public.sites where id = team_site) is not null then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  11. set_project_team_state() let non-owner B change team_id — now %s', (select team_id from public.sites where id = team_site));
  elsif (jres->>'outcome') is distinct from 'not-found' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  11. set_project_team_state() for non-owner B returned outcome=%s, expected not-found', jres->>'outcome');
  else
    passed := passed + 1;
    rep := rep || E'PASS  11. set_project_team_state() refuses to mutate for non-owner B (outcome not-found), project untouched\n';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    jres := public.set_project_team_state(team_grp, tm);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if raised or (jres->>'outcome') is distinct from 'changed' or (select team_id from public.sites where id = team_site) is distinct from tm then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  12 (control). set_project_team_state() by owner A did not succeed as expected — raised=%s err=%s outcome=%s', raised, coalesce(err, '<none>'), jres->>'outcome');
  else
    passed := passed + 1;
    rep := rep || E'PASS  12 (control). set_project_team_state() by owner A succeeds (outcome changed)\n';
  end if;

  ------------------------------------------------------------------------------------------------
  -- CASE 13 — THE FIX BEING TESTED FOR (B1853664): set_project_team_state()'s not-found branch
  -- must never leak a cross-owner plan count. B still owns nothing in `purge_grp` (a DIFFERENT
  -- group, wholly A's, that B has no relation to at all — two live plans in it right now).
  -- THIS CASE IS EXPECTED TO FAIL against the function currently deployed on production (the
  -- pre-fix body still returns v_plans/v_plans instead of 0/0) and to PASS once
  -- set_project_team_state_redact_foreign.sql is applied. That is the regression proof this item's
  -- acceptance criteria asks for — "a test that fails on current main and passes after".
  ------------------------------------------------------------------------------------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    jres := public.set_project_team_state(purge_grp, null);
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if raised then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  13. set_project_team_state() raised for a total stranger to the group instead of returning not-found — err=%s', err);
  elsif (jres->>'outcome') is distinct from 'not-found' then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  13. set_project_team_state() for a total stranger returned outcome=%s, expected not-found', jres->>'outcome');
  elsif coalesce((jres->>'plans')::int, -1) <> 0 or coalesce((jres->>'foreign')::int, -1) <> 0 then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  13 (THE LEAK — expected until set_project_team_state_redact_foreign.sql is applied). set_project_team_state() told non-member B that group %s holds plans=%s foreign=%s, though B owns none of it and has no relation to it — cross-tenant information disclosure', purge_grp, jres->>'plans', jres->>'foreign');
  else
    passed := passed + 1;
    rep := rep || E'PASS  13. set_project_team_state() tells a total stranger nothing about a foreign group''s plan count (plans=0, foreign=0)\n';
  end if;

  ------------------------------------------------------------------------------------------------
  -- CASE 14 — sites_referencing_storage_key(text): EXECUTE must be revoked from every client-
  -- reachable role (fixed 2026-08-14). Structural check, no fixture needed.
  ------------------------------------------------------------------------------------------------
  select has_function_privilege('anon', 'public.sites_referencing_storage_key(text)', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.sites_referencing_storage_key(text)', 'EXECUTE'),
         has_function_privilege('public', 'public.sites_referencing_storage_key(text)', 'EXECUTE')
    into anon_exec, auth_exec, public_exec;
  if anon_exec or auth_exec or public_exec then
    failed := failed + 1;
    rep := rep || format(E'\nFAIL  14. sites_referencing_storage_key() is EXECUTE-able by a client role — anon=%s authenticated=%s public=%s', anon_exec, auth_exec, public_exec);
  else
    passed := passed + 1;
    rep := rep || E'PASS  14. sites_referencing_storage_key() has EXECUTE revoked from anon/authenticated/public — no client role can call it\n';
  end if;

  raise exception E'\n%\n---- % passed, % FAILED ----\n(this exception is deliberate: it rolls the whole test back)',
    rep, passed, failed;
end $$;
