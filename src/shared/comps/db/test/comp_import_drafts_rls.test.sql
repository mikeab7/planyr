-- ============================================================================
-- RLS proof for comp import drafts (B849233/NEW-2).
--
-- Proves, AGAINST THE REAL POLICIES:
--   1. anon sees zero drafts, always.
--   2. the owner (A) sees their own draft.
--   3. a TEAMMATE (B, on a shared team with A) CANNOT see A's draft — this table has NO team
--      composition at all, unlike public.comps; a draft must never leak to a teammate before
--      promotion.
--   4. a stranger (C) cannot see it either.
--   5. B cannot update A's draft.
--   6. B cannot delete A's draft.
--   7. A (the owner) can update their own draft.
--   8. inserting a draft with someone else's user_id is refused (server-stamped owner).
--   9. the status check constraint rejects a value outside pending/promoted/dismissed.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture row is discarded. Run via the Supabase MCP execute_sql tool and read
-- the report out of the error message.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0a01';  -- A: the importer
  ub uuid := '00000000-0000-4000-8000-0000000d0a02';  -- B: a teammate of A (not the importer)
  uc uuid := '00000000-0000-4000-8000-0000000d0a03';  -- C: a stranger
  team_id uuid;
  draft_id uuid;
  n int;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-draft-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-draft-b@test.invalid', now(), now()),
         (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-draft-c@test.invalid', now(), now());

  insert into public.teams (name, created_by) values ('RLS Test Team (comp drafts)', ua) returning id into team_id;
  insert into public.team_members (team_id, user_id, role, added_by) values
    (team_id, ua, 'admin', ua), (team_id, ub, 'member', ua);

  insert into public.comp_import_drafts (user_id, source, raw_name, raw_description)
  values (ua, 'kml', 'Placemark 1', 'Lot on FM 359, roughly 3 ac, talked to owner spring 2026')
  returning id into draft_id;

  -- ---------- Test 1: anon sees zero drafts ----------------------------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.comp_import_drafts where id = draft_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 1: anon sees zero drafts. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 1: anon saw %s drafts, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 2: owner (A) sees their own draft --------------------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select count(*) into n from public.comp_import_drafts where id = draft_id;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 2: owner sees their own draft. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 2: owner read returned %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 3: a TEAMMATE (B) cannot see it — NO team composition here -
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.comp_import_drafts where id = draft_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 3: a teammate cannot see the draft (no team-visible read here). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 3: teammate saw %s rows, expected 0 — draft leaked pre-promotion.', n) || E'\n'; end if;

  -- ---------- Test 4: a stranger (C) cannot see it -----------------------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', uc, 'role', 'authenticated')::text);
  select count(*) into n from public.comp_import_drafts where id = draft_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 4: a stranger cannot see the draft. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 4: stranger saw %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 5: B cannot UPDATE A's draft --------------------------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  update public.comp_import_drafts set raw_name = 'edited by a teammate' where id = draft_id;
  get diagnostics n = row_count;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 5: a teammate cannot update the draft. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 5: teammate update affected %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 6: B cannot DELETE A's draft --------------------------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  delete from public.comp_import_drafts where id = draft_id;
  get diagnostics n = row_count;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 6: a teammate cannot delete the draft. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 6: teammate delete affected %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 7: A (the owner) CAN update their own draft -----------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.comp_import_drafts set raw_name = 'edited by the owner' where id = draft_id;
  get diagnostics n = row_count;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 7: the owner can update their own draft. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 7: owner update affected %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 8: B cannot insert a draft claiming to be A -----------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    insert into public.comp_import_drafts (user_id, source) values (ua, 'kml');
    n := 1;
  exception when insufficient_privilege or others then n := 0;
  end;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 8: cannot insert a draft under someone else''s user_id. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 8: a spoofed-owner insert succeeded.' || E'\n'; end if;

  -- ---------- Test 9: the status check constraint rejects a bad value ----------
  begin
    insert into public.comp_import_drafts (user_id, source, status) values (ua, 'kml', 'bogus');
    n := 1;
  exception when check_violation then n := 0;
  end;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 9: an out-of-range status is rejected. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 9: a bogus status value was accepted.' || E'\n'; end if;

  raise exception E'\n=== comp_import_drafts RLS proof: % passed, % failed ===\n%', passed, failed, rep;
end $$;
