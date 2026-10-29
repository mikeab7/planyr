-- ============================================================================
-- B2448033 — project_layer_opacity proof, against the REAL functions + RLS.
--
-- Proves: a layer's opacity is ONE row per PROJECT (two plans of one project read and write the same row; a plan in
-- another project does not); a write is a PATCH that sets / removes per layer without touching the others (the
-- stale-device guarantee lives in the wire shape — only changed layers are sent); bad values are refused; access
-- follows the plan's own sharing (owner + team member read; owner + teammate-on-an-UNLOCKED-plan write; a LOCKED plan
-- refuses a teammate with 42501; a stranger reads NULL and is refused P0002); and no client has a direct door to the table.
--
-- Every statement is issued as a real `authenticated` role with a real JWT subject. SELF-ROLLING-BACK — it ends by
-- raising an exception carrying the report, so every fixture (users, team, plans, rows) is discarded.
-- HOW TO RUN: paste into the Supabase SQL editor / `execute_sql`, or `node scripts/run-db-tests.mjs --dir src/workspaces/site-planner/db/test`.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0a01';  -- A: owner
  ub uuid := '00000000-0000-4000-8000-0000000d0a02';  -- B: A's teammate
  uc uuid := '00000000-0000-4000-8000-0000000d0a03';  -- C: a stranger
  tm uuid := '00000000-0000-4000-8000-0000000d0a04';
  rep text := ''; passed int := 0; failed int := 0;
  r jsonb; n int;

begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'plo-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'plo-b@test.invalid', now(), now()),
         (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'plo-c@test.invalid', now(), now());
  insert into public.teams (id, name, created_by) values (tm, 'PLO Test Team', ua);
  insert into public.team_members (team_id, user_id, role, added_by) values (tm, ua, 'admin', ua), (tm, ub, 'member', ua);
  -- project P1 = plo-a1 + plo-a2 (shared with the team, unlocked) · project P2 = plo-b1 (owner's, private)
  -- · project P3 = plo-l1 (shared, LOCKED)
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id, share_locked) values
    ('plo-a1', ua, 'plo-p1', 'PLO one', 'A', now(), '{"id":"plo-a1","groupId":"plo-p1"}'::jsonb, tm, false),
    ('plo-a2', ua, 'plo-p1', 'PLO one', 'B', now(), '{"id":"plo-a2","groupId":"plo-p1"}'::jsonb, tm, false),
    ('plo-b1', ua, 'plo-p2', 'PLO two', 'A', now(), '{"id":"plo-b1","groupId":"plo-p2"}'::jsonb, null, false),
    ('plo-l1', ua, 'plo-p3', 'PLO three', 'A', now(), '{"id":"plo-l1","groupId":"plo-p3"}'::jsonb, tm, true);

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);

  -- 1. nothing stored yet reads as the empty object (not NULL)
  r := public.get_project_layer_opacity('plo-a1');
  if r = '{}'::jsonb then passed := passed + 1; rep := rep || E'PASS  1. an untouched project reads {}\n'; else failed := failed + 1; rep := rep || format(E'FAIL  1. expected {} got %s\n', r); end if;

  -- 2. owner sets two layers; the SIBLING plan of the same project reads the same row
  perform public.set_project_layer_opacity('plo-a1', '{"fema":0.6,"wetlands":0.3}');
  r := public.get_project_layer_opacity('plo-a2');
  if r = '{"fema":0.6,"wetlands":0.3}'::jsonb then passed := passed + 1; rep := rep || E'PASS  2. a sibling plan of the same project reads the project''s value\n'; else failed := failed + 1; rep := rep || format(E'FAIL  2. sibling read %s\n', r); end if;

  -- 3. a plan in ANOTHER project is unaffected
  r := public.get_project_layer_opacity('plo-b1');
  if r = '{}'::jsonb then passed := passed + 1; rep := rep || E'PASS  3. a plan in a different project is untouched\n'; else failed := failed + 1; rep := rep || format(E'FAIL  3. other project read %s\n', r); end if;

  -- 4. a PATCH touches only the layers it names; null removes one
  r := public.set_project_layer_opacity('plo-a2', '{"wetlands":null,"nwi":0.5}');
  if r = '{"fema":0.6,"nwi":0.5}'::jsonb then passed := passed + 1; rep := rep || E'PASS  4. a patch sets/removes per layer and leaves the others alone\n'; else failed := failed + 1; rep := rep || format(E'FAIL  4. merged %s\n', r); end if;

  -- 5. bad values refused (range, type, key)
  begin perform public.set_project_layer_opacity('plo-a1', '{"fema":2}'); failed := failed + 1; rep := rep || E'FAIL  5a. out-of-range accepted\n';
  exception when others then if sqlstate = '22023' then passed := passed + 1; rep := rep || E'PASS  5a. out-of-range refused (22023)\n'; else failed := failed + 1; rep := rep || format(E'FAIL  5a. wrong code %s\n', sqlstate); end if; end;
  begin perform public.set_project_layer_opacity('plo-a1', '{"fema":"x"}'); failed := failed + 1; rep := rep || E'FAIL  5b. non-number accepted\n';
  exception when others then if sqlstate = '22023' then passed := passed + 1; rep := rep || E'PASS  5b. non-number refused (22023)\n'; else failed := failed + 1; rep := rep || format(E'FAIL  5b. wrong code %s\n', sqlstate); end if; end;
  begin perform public.set_project_layer_opacity('plo-a1', '{"bad key!":0.5}'); failed := failed + 1; rep := rep || E'FAIL  5c. bad key accepted\n';
  exception when others then if sqlstate = '22023' then passed := passed + 1; rep := rep || E'PASS  5c. bad key refused (22023)\n'; else failed := failed + 1; rep := rep || format(E'FAIL  5c. wrong code %s\n', sqlstate); end if; end;

  -- 6. no direct door to the table for a client
  begin select count(*) into n from public.project_layer_opacity; failed := failed + 1; rep := rep || E'FAIL  6. the table is directly readable by authenticated\n';
  exception when others then if sqlstate = '42501' then passed := passed + 1; rep := rep || E'PASS  6. no direct table access for a client (42501)\n'; else failed := failed + 1; rep := rep || format(E'FAIL  6. wrong code %s\n', sqlstate); end if; end;

  -- 7. a missing plan: NULL on read, P0002 on write
  if public.get_project_layer_opacity('plo-nope') is null then passed := passed + 1; rep := rep || E'PASS  7a. a missing plan reads NULL\n'; else failed := failed + 1; rep := rep || E'FAIL  7a. a missing plan did not read NULL\n'; end if;
  begin perform public.set_project_layer_opacity('plo-nope', '{"fema":0.5}'); failed := failed + 1; rep := rep || E'FAIL  7b. write to a missing plan accepted\n';
  exception when others then if sqlstate = 'P0002' then passed := passed + 1; rep := rep || E'PASS  7b. write to a missing plan refused (P0002)\n'; else failed := failed + 1; rep := rep || format(E'FAIL  7b. wrong code %s\n', sqlstate); end if; end;

  -- 8. teammate B: reads the project, writes on the UNLOCKED shared plan, is refused on the LOCKED one
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  r := public.get_project_layer_opacity('plo-a1');
  if r = '{"fema":0.6,"nwi":0.5}'::jsonb then passed := passed + 1; rep := rep || E'PASS  8a. a teammate reads the shared project''s opacity\n'; else failed := failed + 1; rep := rep || format(E'FAIL  8a. teammate read %s\n', r); end if;
  r := public.set_project_layer_opacity('plo-a1', '{"nwi":0.7}');
  if r = '{"fema":0.6,"nwi":0.7}'::jsonb then passed := passed + 1; rep := rep || E'PASS  8b. a teammate writes on an unlocked shared plan\n'; else failed := failed + 1; rep := rep || format(E'FAIL  8b. teammate write gave %s\n', r); end if;
  begin perform public.set_project_layer_opacity('plo-l1', '{"fema":0.2}'); failed := failed + 1; rep := rep || E'FAIL  8c. teammate wrote on a LOCKED plan\n';
  exception when others then if sqlstate = '42501' then passed := passed + 1; rep := rep || E'PASS  8c. a teammate is refused on a locked plan (42501)\n'; else failed := failed + 1; rep := rep || format(E'FAIL  8c. wrong code %s\n', sqlstate); end if; end;
  r := public.get_project_layer_opacity('plo-l1');
  if r = '{}'::jsonb then passed := passed + 1; rep := rep || E'PASS  8d. …but can still READ a locked plan''s project (view-only)\n'; else failed := failed + 1; rep := rep || format(E'FAIL  8d. read %s\n', r); end if;
  if public.get_project_layer_opacity('plo-b1') is null then passed := passed + 1; rep := rep || E'PASS  8e. a teammate cannot see the owner''s PRIVATE project\n'; else failed := failed + 1; rep := rep || E'FAIL  8e. teammate read a private project\n'; end if;

  -- 9. stranger C: nothing leaks, nothing writes
  execute format('set local request.jwt.claims = %L', json_build_object('sub', uc, 'role', 'authenticated')::text);
  if public.get_project_layer_opacity('plo-a1') is null then passed := passed + 1; rep := rep || E'PASS  9a. a stranger reads NULL\n'; else failed := failed + 1; rep := rep || E'FAIL  9a. a stranger read the project\n'; end if;
  begin perform public.set_project_layer_opacity('plo-a1', '{"fema":0.1}'); failed := failed + 1; rep := rep || E'FAIL  9b. a stranger wrote\n';
  exception when others then if sqlstate = 'P0002' then passed := passed + 1; rep := rep || E'PASS  9b. a stranger''s write is refused (P0002)\n'; else failed := failed + 1; rep := rep || format(E'FAIL  9b. wrong code %s\n', sqlstate); end if; end;

  -- 10. signed out (anon) is refused outright
  execute 'reset role'; execute 'set local request.jwt.claims = default'; execute 'set local role anon';
  begin perform public.get_project_layer_opacity('plo-a1'); failed := failed + 1; rep := rep || E'FAIL  10. anon could call the read function\n';
  exception when others then passed := passed + 1; rep := rep || E'PASS  10. anon cannot call the function\n'; end;
  execute 'reset role';

  raise exception E'\n%\n---- % passed, % FAILED ----\n(this exception is deliberate: it rolls the whole test back)', rep, passed, failed;
end $$;
