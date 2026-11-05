-- ============================================================================
-- B2404337 (NEW-2, 2026-10-21) — project_folders drive_* INSERT guard proof, against the REAL trigger.
--
-- (1) an authenticated INSERT carrying a drive_folder_id is REFUSED; (1b) one carrying only
-- drive_trashed=true is refused; (2) an authenticated INSERT with every drive_* at its default is
-- ALLOWED; (3) folder_set_drive_meta() on that row still works (the live server path); (4) a direct
-- authenticated UPDATE of drive_* is still refused (the pre-existing half of the guard); (5) RED-PROOF —
-- with the trigger disabled the forged INSERT lands.
--
-- Every assertion runs as a real `authenticated` role with a real JWT subject. SELF-ROLLING-BACK: it
-- ends by raising an exception carrying the report, so the fixture user, every row and the red-proof
-- `disable trigger` are all discarded. Run via the Supabase MCP `execute_sql`, the SQL editor, or
-- `node scripts/run-db-tests.mjs --dir src/workspaces/doc-review/db/test`.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0d01';
  proj text := 'pfigtest-project';
  fid uuid := '00000000-0000-4000-8000-0000000d0d10';
  fid2 uuid := '00000000-0000-4000-8000-0000000d0d11';
  rep text := '';
  n int;
  got text;
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pfig-a@test.invalid', now(), now());

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);

  -- ---------- 1. forged drive_folder_id on INSERT → refused ----------------
  begin
    insert into public.project_folders (id, project_id, name, drive_folder_id, trashed)
    values (fid, proj, 'Forged', 'victims-drive-folder-id', true);
    failed := failed + 1; rep := rep || E'FAIL  1. authenticated INSERT with a drive_folder_id LANDED\n';
  exception when others then
    if sqlerrm like 'drive_* columns are server-managed%' then
      passed := passed + 1; rep := rep || format(E'PASS  1. INSERT with drive_folder_id refused: %s\n', sqlerrm);
    else failed := failed + 1; rep := rep || format(E'FAIL  1. refused with an unexpected error: [%s] %s\n', sqlstate, sqlerrm); end if;
  end;
  -- ---------- 1b. drive_trashed=true alone → refused -----------------------
  begin
    insert into public.project_folders (id, project_id, name, drive_trashed)
    values (fid, proj, 'Forged trashed', true);
    failed := failed + 1; rep := rep || E'FAIL  1b. authenticated INSERT with drive_trashed=true LANDED\n';
  exception when others then
    if sqlerrm like 'drive_* columns are server-managed%' then passed := passed + 1; rep := rep || E'PASS  1b. INSERT with drive_trashed=true refused\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  1b. unexpected error: [%s] %s\n', sqlstate, sqlerrm); end if;
  end;

  -- ---------- 2. an ordinary structure-only INSERT is allowed --------------
  begin
    insert into public.project_folders (id, project_id, name, sort_order) values (fid, proj, 'Drawings', 1);
    get diagnostics n = row_count;
    if n = 1 then passed := passed + 1; rep := rep || E'PASS  2. structure-only INSERT (all drive_* at default) allowed\n';
    else failed := failed + 1; rep := rep || E'FAIL  2. structure-only INSERT inserted no row\n'; end if;
  exception when others then
    failed := failed + 1; rep := rep || format(E'FAIL  2. structure-only INSERT raised: [%s] %s\n', sqlstate, sqlerrm);
  end;

  -- ---------- 3. the server path (SECURITY DEFINER RPC) still writes drive_* ----
  begin
    perform public.folder_set_drive_meta(fid, '{"drive_folder_id":"srv-folder-1","drive_name":"Drawings"}'::jsonb);
    select drive_folder_id into got from public.project_folders where id = fid;
    if got = 'srv-folder-1' then passed := passed + 1; rep := rep || E'PASS  3. folder_set_drive_meta still sets drive_* on the owner''s row\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  3. folder_set_drive_meta left drive_folder_id = %s\n', coalesce(got, '<null>')); end if;
  exception when others then
    failed := failed + 1; rep := rep || format(E'FAIL  3. folder_set_drive_meta raised: [%s] %s\n', sqlstate, sqlerrm);
  end;

  -- ---------- 4. a direct client UPDATE of drive_* is still refused --------
  begin
    update public.project_folders set drive_folder_id = 'victims-drive-folder-id' where id = fid;
    failed := failed + 1; rep := rep || E'FAIL  4. direct authenticated UPDATE of drive_folder_id LANDED\n';
  exception when others then
    if sqlerrm like 'drive_* columns are server-managed%' then passed := passed + 1; rep := rep || E'PASS  4. direct UPDATE of drive_* still refused\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  4. unexpected error: [%s] %s\n', sqlstate, sqlerrm); end if;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- 5. RED-PROOF: disable the trigger, the forged INSERT lands ---
  -- (DISABLE rather than DROP: the Supabase MCP holds any statement containing DROP for a
  -- confirmation an unattended session cannot give; the effect inside this transaction is the same.)
  alter table public.project_folders disable trigger project_folders_guard_drive;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    insert into public.project_folders (id, project_id, name, drive_folder_id, trashed)
    values (fid2, proj, 'Forged after drop', 'victims-drive-folder-id', true);
    get diagnostics n = row_count;
    if n = 1 then passed := passed + 1; rep := rep || E'PASS  5. red-proof: with the trigger disabled the forged INSERT lands (the guard is what stops it)\n';
    else failed := failed + 1; rep := rep || E'FAIL  5. red-proof: trigger disabled yet no row inserted\n'; end if;
  exception when others then
    failed := failed + 1; rep := rep || format(E'FAIL  5. red-proof: trigger disabled yet refused: [%s] %s\n', sqlstate, sqlerrm);
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  raise exception E'\n%\n---- % passed, % FAILED ----\n(this exception is deliberate: it rolls the whole test back, the disabled trigger included)',
    rep, passed, failed;
end $$;
