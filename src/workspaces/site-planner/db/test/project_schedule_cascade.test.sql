-- NEW-1 / NEW-2 (2026-10-05) — proves db/project_schedule_cascade.sql against the REAL tables.
-- Self-rolling-back: every fixture is a throwaway `cascadetest-*` row on a synthetic auth.users row and the
-- whole thing ends in a raised exception, so nothing survives. Run via scripts/run-db-tests.mjs (CI) or paste
-- into the SQL editor. The reader the Dashboard uses is `schedules where deleted_at is null`
-- (scheduleSource.fetchScheduleProjectsFromRows), so "the Dashboard no longer lists it" is asserted as
-- exactly that query.
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000c0a01';
  d  timestamptz := '2026-10-05 12:00:00+00';
  n  int; t timestamptz; tag text; h text; v_before int; v_after int; v_other int;
  rep text := ''; failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade-a@test.invalid', now(), now());

  -- P1: solo project + one schedule + a hint on its plan.  P2: two-plan project + one live schedule
  -- + one schedule the user deleted on its own earlier.
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data) values
    ('cascadetest-p1',  ua, 'cascadetest-p1',  'P1', 'A', now(), '{"groupId":"cascadetest-p1","scheduleProjectId":"9001"}'),
    ('cascadetest-p2a', ua, 'cascadetest-p2a', 'P2', 'A', now(), '{"groupId":"cascadetest-p2a","scheduleProjectId":"9002"}'),
    ('cascadetest-p2b', ua, 'cascadetest-p2a', 'P2', 'B', now(), '{"groupId":"cascadetest-p2a","scheduleProjectId":"9002"}');
  insert into public.schedules (id, user_id, linked_site_id, linked_site_name, name, data, rev) values
    (9001, ua, 'cascadetest-p1',  'P1', 'S1', '{"id":9001}', 0),
    (9002, ua, 'cascadetest-p2a', 'P2', 'S2', '{"id":9002}', 0),
    (9003, ua, 'cascadetest-p2a', 'P2', 'S3-own-delete', '{"id":9003}', 0);
  update public.schedules set deleted_at = d - interval '1 day' where id = 9003;

  -- CASE 1 — delete the project: the live-schedule reader no longer lists its schedule; stamped with the
  -- project's deleted_at and tagged.
  update public.sites set deleted_at = d where id = 'cascadetest-p1';
  select count(*) into n from public.schedules where deleted_at is null and linked_site_id = 'cascadetest-p1';
  if n <> 0 then failed := failed + 1; rep := rep || E'\n  FAIL 1a: a deleted project still has a LIVE schedule (the Dashboard orphan)'; end if;
  select deleted_at, deleted_with_project into t, tag from public.schedules where id = 9001;
  if t is distinct from d or tag is distinct from 'cascadetest-p1' then
    failed := failed + 1; rep := rep || format(E'\n  FAIL 1b: cascade stamp wrong (deleted_at=%s tag=%s)', t, tag);
  end if;

  -- CASE 2 — restore the project: the schedule comes back, tag cleared.
  update public.sites set deleted_at = null where id = 'cascadetest-p1';
  select count(*) into n from public.schedules where deleted_at is null and id = 9001 and deleted_with_project is null;
  if n <> 1 then failed := failed + 1; rep := rep || E'\n  FAIL 2: restoring the project did not bring its schedule back'; end if;

  -- CASE 3 — a two-plan project: deleting ONE plan leaves the schedule alone; deleting the LAST takes it.
  update public.sites set deleted_at = d where id = 'cascadetest-p2a';
  select count(*) into n from public.schedules where id = 9002 and deleted_at is null;
  if n <> 1 then failed := failed + 1; rep := rep || E'\n  FAIL 3a: deleting one plan of a still-live project deleted its schedule'; end if;
  update public.sites set deleted_at = d where id = 'cascadetest-p2b';
  select count(*) into n from public.schedules where id = 9002 and deleted_at is null;
  if n <> 0 then failed := failed + 1; rep := rep || E'\n  FAIL 3b: deleting the last plan did not take the schedule'; end if;

  -- CASE 4 — restoring the project never resurrects a schedule the user deleted on its own earlier.
  update public.sites set deleted_at = null where id in ('cascadetest-p2a', 'cascadetest-p2b');
  select count(*) into n from public.schedules where id = 9002 and deleted_at is null;
  if n <> 1 then failed := failed + 1; rep := rep || E'\n  FAIL 4a: restore did not bring back the cascade-deleted schedule'; end if;
  select count(*) into n from public.schedules where id = 9003 and deleted_at is not null;
  if n <> 1 then failed := failed + 1; rep := rep || E'\n  FAIL 4b: restore resurrected a schedule that was deleted on its own'; end if;

  -- CASE 5 — a schedule leaving (soft OR hard delete) clears the plan hints that name it, bumping version;
  -- a hint naming a DIFFERENT schedule is untouched. (Cases 1-4 already cleared the hints of the cascade-deleted
  -- schedules — by design; the client heal re-derives them from the restored schedule — so re-seed two.)
  update public.sites set data = jsonb_set(data, '{scheduleProjectId}', '"9001"'), version = version + 1 where id = 'cascadetest-p1';
  update public.sites set data = jsonb_set(data, '{scheduleProjectId}', '"9002"'), version = version + 1 where id = 'cascadetest-p2a';
  update public.sites set data = jsonb_set(data, '{scheduleProjectId}', '"9003"'), version = version + 1 where id = 'cascadetest-p2b';  -- 9003 is long deleted: a dangling hint
  select version into v_before from public.sites where id = 'cascadetest-p1';
  select version into v_other from public.sites where id = 'cascadetest-p2a';
  update public.schedules set deleted_at = now() where id = 9001;                    -- soft delete on its own
  select data->>'scheduleProjectId', version into h, v_after from public.sites where id = 'cascadetest-p1';
  if h is not null then failed := failed + 1; rep := rep || format(E'\n  FAIL 5a: hint still names a soft-deleted schedule (%s)', h); end if;
  if v_after is not distinct from v_before then failed := failed + 1; rep := rep || E'\n  FAIL 5b: hint clear did not bump version (a stale client could not detect it)'; end if;
  select data->>'scheduleProjectId' into h from public.sites where id = 'cascadetest-p2a';
  if h is distinct from '9002' then failed := failed + 1; rep := rep || format(E'\n  FAIL 5c: a hint naming a LIVE schedule was cleared (%s)', h); end if;
  select version into v_after from public.sites where id = 'cascadetest-p2a';
  if v_after is distinct from v_other then failed := failed + 1; rep := rep || E'\n  FAIL 5d: an unrelated plan was version-bumped'; end if;
  delete from public.schedules where id = 9002;                                      -- hard delete (a row removed outside the app)
  select count(*) into n from public.sites where data->>'scheduleProjectId' = '9002';
  if n <> 0 then failed := failed + 1; rep := rep || E'\n  FAIL 5e: hard-deleting a schedule left plan hints pointing at it'; end if;

  if failed > 0 then
    raise exception E'project_schedule_cascade: % of 12 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'project_schedule_cascade: ALL 12 CHECKS PASSED\n(fixtures rolled back)';
end $$;
