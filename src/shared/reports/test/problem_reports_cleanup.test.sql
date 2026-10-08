-- Proof for delete_my_session_reports (B2159505). Self-rolling-back DO block: run via the Supabase MCP
-- execute_sql and read the report out of the raised message. Proves: it deletes ONLY the caller's own
-- session's recent anonymous/own rows, leaves another session's rows, an older row, and another user's
-- signed-in row untouched, refuses a short session id, and reports remaining = 0.
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000e0b01';
  ub uuid := '00000000-0000-4000-8000-0000000e0b02';
  s1 text := 'cleanup-test-session-aaaaaaaa';
  s2 text := 'cleanup-test-session-bbbbbbbb';
  res jsonb; n int; rep text := ''; failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cleanup-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cleanup-b@test.invalid', now(), now())
  on conflict (id) do nothing;
  insert into public.problem_reports (category, description, session_id, user_id) values
    ('problem', 'a: anon in s1', s1, null),
    ('slow', null, s1, ua),
    ('problem', 'b: other session s2', s2, null),
    ('problem', 'c: s1 but another user', s1, ub);
  insert into public.problem_reports (category, description, session_id, at) values ('problem', 'd: s1 but old', s1, now() - interval '2 days');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  res := public.delete_my_session_reports(s1);
  execute 'reset role';
  if (res->>'deleted')::int = 2 and (res->>'remaining')::int = 0 then rep := rep || 'PASS 1: deleted 2 (anon + own), remaining 0. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 1: got %s', res) || E'\n'; end if;
  select count(*) into n from public.problem_reports where session_id = s2;
  if n = 1 then rep := rep || 'PASS 2: another session untouched. ' || E'\n'; else failed := failed + 1; rep := rep || 'FAIL 2' || E'\n'; end if;
  select count(*) into n from public.problem_reports where session_id = s1 and description in ('c: s1 but another user', 'd: s1 but old');
  if n = 2 then rep := rep || 'PASS 3: another user''s row and an old row untouched. ' || E'\n'; else failed := failed + 1; rep := rep || 'FAIL 3' || E'\n'; end if;
  begin perform public.delete_my_session_reports('short'); failed := failed + 1; rep := rep || 'FAIL 4: short id accepted' || E'\n';
  exception when others then rep := rep || 'PASS 4: short session id refused. ' || E'\n'; end;
  raise exception E'ROLLBACK-REPORT failed=%\n%', failed, rep;
end $$;
