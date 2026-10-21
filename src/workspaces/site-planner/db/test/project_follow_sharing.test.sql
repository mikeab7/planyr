-- ============================================================================
-- B2244017 / B2244018 — RLS proof: a project's overlays and comps follow the project's sharing.
--
-- Runs AS THE REAL NON-SUPERUSER ROLE (`authenticated`, with a JWT `sub`) against the REAL policies —
-- every check is a plain SELECT on storage.objects / site_plan_overlays / comps / doc_reviews, so it is
-- the policies that answer, not a function called by hand. Self-rolling-back: the DO block raises at the
-- end with the report, so every fixture (users, team, plans, objects) is discarded. Includes a MUTATION
-- PROOF: two guards are weakened in place and the checks that depend on them must go red, then the
-- block's own rollback restores them.
--
-- Fixture: O owns; M is O's teammate (team T); X is outside T. Plans: P1 shared with T (live), P2
-- private, P3 shared with T but binned. Attack fixtures are described next to each check.
-- ============================================================================
do $$
declare
  o uuid := '00000000-0000-4000-8000-00000b224401';
  m uuid := '00000000-0000-4000-8000-00000b224402';
  x uuid := '00000000-0000-4000-8000-00000b224403';
  t uuid; t3 uuid;
  k1 text; k2 text; k3 text; kx text; ko text; rk1 text; rk2 text; rk5 text;
  r1 uuid; r2 uuid; r5 uuid; c1 uuid; c2 uuid; cx uuid; rv text := 'b2244017-test-review-private'; rvo text := 'b2244017-test-review-own';
  n int; rep text := ''; passed int := 0; failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
    (o, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2244017-o@test.invalid', now(), now()),
    (m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2244017-m@test.invalid', now(), now()),
    (x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2244017-x@test.invalid', now(), now());
  insert into public.teams (name, created_by) values ('B2244017 team T', o) returning id into t;
  insert into public.team_members (team_id, user_id, role, added_by) values (t, o, 'admin', o), (t, m, 'member', o);
  insert into public.teams (name, created_by) values ('B2244017 team T3', m) returning id into t3;
  insert into public.team_members (team_id, user_id, role, added_by) values (t3, m, 'admin', m), (t3, x, 'member', m);

  k1 := o::text || '/site-overlays/b2244017p1/ov1.pdf';
  k2 := o::text || '/site-overlays/b2244017p2/ov2.pdf';
  k3 := o::text || '/site-overlays/b2244017p3/ov3.pdf';
  kx := x::text || '/site-overlays/b2244017px/ovx.pdf';
  ko := o::text || '/site-overlays/b2244017gone/orphan.pdf';   -- O's file whose origin plan was purged
  rk1 := o::text || '/site-plan-overlays/r1.jpg';
  rk2 := o::text || '/site-plan-overlays/r2.jpg';
  rk5 := o::text || '/site-plan-overlays/r5.jpg';
  insert into storage.objects (bucket_id, name) select 'doc-review-files', unnest(array[k1, k2, k3, kx, ko, rk1, rk2, rk5]);

  -- Plans. team_id is set at INSERT (the share guard governs UPDATEs of team_id, not creation).
  insert into public.sites (id, user_id, team_id, site, name, data) values
    ('b2244017p1', o, t,    'B2244017 Proj1', 'P1', jsonb_build_object('groupId', 'b2244017g1', 'sheetOverlays', jsonb_build_array(jsonb_build_object('id','ov1','storageKey',k1)))),
    ('b2244017p2', o, null, 'B2244017 Proj2', 'P2', jsonb_build_object('groupId', 'b2244017g2', 'sheetOverlays', jsonb_build_array(jsonb_build_object('id','ov2','storageKey',k2)))),
    ('b2244017p3', o, t,    'B2244017 Proj3', 'P3', jsonb_build_object('groupId', 'b2244017g3', 'sheetOverlays', jsonb_build_array(jsonb_build_object('id','ov3','storageKey',k3)))),
    ('b2244017px', x, null, 'B2244017 ProjX', 'PX', jsonb_build_object('groupId', 'b2244017gx', 'sheetOverlays', jsonb_build_array(jsonb_build_object('id','ovx','storageKey',kx)))),
    -- ATTACK: M's own plan, shared with T, NAMING keys it never uploaded: O's private P2 file, X's private
    -- file, and a path-trick variant routed through the readable P1 folder.
    ('b2244017pa', m, t,    'B2244017 ProjA', 'PA', jsonb_build_object('groupId', 'b2244017ga', 'sheetOverlays', jsonb_build_array(
        jsonb_build_object('id','a1','storageKey',k2), jsonb_build_object('id','a2','storageKey',kx),
        jsonb_build_object('id','a3','storageKey', o::text || '/site-overlays/b2244017p1/../b2244017p2/ov2.pdf'),
        jsonb_build_object('id','a4','storageKey', o::text || '/site-overlays/b2244017gone/orphan.pdf')))),
    -- ATTACK (review #1): X SQUATS the id of O's purged origin folder `b2244017gone`, then names O's
    -- orphaned file in X's own plan. ATTACK (review #2): M names the same orphan in O's SHARED plan P1's
    -- sibling PA (M can edit shared plans) hoping the team can read it.
    ('b2244017gone', x, null, 'B2244017 squat', 'squat', '{}'::jsonb),
    ('b2244017pq', x, null, 'B2244017 ProjQ', 'PQ', jsonb_build_object('groupId', 'b2244017gq', 'sheetOverlays', jsonb_build_array(jsonb_build_object('id','q1','storageKey',ko)))),
    -- ATTACK: M grafts a plan into O's PRIVATE project group and shares it with T3 (where X is).
    ('b2244017pg', m, t3,   'B2244017 Proj2', 'graft', jsonb_build_object('groupId', 'b2244017g2'));
  update public.sites set deleted_at = now() where id = 'b2244017p3';

  insert into public.doc_reviews (id, user_id, title, data) values (rv, o, 'B2244017 private review', '{}'::jsonb), (rvo, o, 'B2244017 source review', '{}'::jsonb);
  insert into public.site_plan_overlays (user_id, team_id, project_id, review_id, page, img_w, img_h, raster_key) values (o, null, 'b2244017p1', rvo, 1, 10, 10, rk1) returning id into r1;
  insert into public.site_plan_overlays (user_id, team_id, project_id, review_id, page, img_w, img_h, raster_key) values (o, null, 'b2244017p2', rvo, 1, 10, 10, rk2) returning id into r2;
  insert into public.site_plan_overlays (user_id, team_id, project_id, review_id, page, img_w, img_h, raster_key) values (o, t,    null,         rvo, 1, 10, 10, rk5) returning id into r5;
  -- ATTACK (B2244018): M's own overlay shared with T, naming O's PRIVATE raster and O's PRIVATE review.
  insert into public.site_plan_overlays (user_id, team_id, project_id, review_id, page, img_w, img_h, raster_key) values (m, t, null, rv, 1, 10, 10, rk2);
  insert into public.comps (user_id, team_id, project_id, comp_type, comp_date, anchor_kind, lat, lon, land_price, land_size_value, land_size_unit)
    values (o, null, 'b2244017p1', 'land', current_date, 'pin', 29.7, -95.4, 1, 1, 'ac') returning id into c1;
  insert into public.comps (user_id, team_id, project_id, comp_type, comp_date, anchor_kind, lat, lon, land_price, land_size_value, land_size_unit)
    values (o, null, 'b2244017p2', 'land', current_date, 'pin', 29.7, -95.4, 1, 1, 'ac') returning id into c2;
  -- ATTACK: X (not on T) attaches X's own comp to O's shared project P1, trying to push it at T.
  insert into public.comps (user_id, team_id, project_id, comp_type, comp_date, anchor_kind, lat, lon, land_price, land_size_value, land_size_unit)
    values (x, null, 'b2244017p1', 'land', current_date, 'pin', 29.7, -95.4, 1, 1, 'ac') returning id into cx;

  -- helper pattern: become <who>, count what the policies let through, become postgres again.
  -- (inlined; plpgsql has no closures)
  <<checks>>
  declare
  begin
    -- ===== M (teammate on shared P1) =====
    execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', m, 'role', 'authenticated')::text);
    select count(*) into n from storage.objects where name = k1;            if n = 1 then passed := passed+1; rep := rep||'PASS 1 teammate loads the shared plan''s overlay file'||E'\n'; else failed := failed+1; rep := rep||'FAIL 1 teammate cannot load P1 overlay file'||E'\n'; end if;
    select count(*) into n from public.site_plan_overlays where id = r1;     if n = 1 then passed := passed+1; rep := rep||'PASS 2 teammate sees the project''s Map overlay row'||E'\n'; else failed := failed+1; rep := rep||'FAIL 2 teammate cannot see R1'||E'\n'; end if;
    select count(*) into n from storage.objects where name = rk1;           if n = 1 then passed := passed+1; rep := rep||'PASS 3 teammate loads the Map overlay raster'||E'\n'; else failed := failed+1; rep := rep||'FAIL 3 teammate cannot load R1 raster'||E'\n'; end if;
    select count(*) into n from public.comps where id = c1;                 if n = 1 then passed := passed+1; rep := rep||'PASS 4 teammate sees the project''s comp'||E'\n'; else failed := failed+1; rep := rep||'FAIL 4 teammate cannot see C1'||E'\n'; end if;
    select count(*) into n from storage.objects where name in (k2, rk2);    if n = 0 then passed := passed+1; rep := rep||'PASS 5 unshared project: overlay file + raster stay private'||E'\n'; else failed := failed+1; rep := rep||'FAIL 5 unshared P2 leaked ('||n||')'||E'\n'; end if;
    select count(*) into n from public.site_plan_overlays where id = r2;    if n = 0 then passed := passed+1; rep := rep||'PASS 6 unshared project: Map overlay row private'||E'\n'; else failed := failed+1; rep := rep||'FAIL 6 R2 leaked'||E'\n'; end if;
    select count(*) into n from public.comps where id = c2;                 if n = 0 then passed := passed+1; rep := rep||'PASS 7 unshared project: comp private'||E'\n'; else failed := failed+1; rep := rep||'FAIL 7 C2 leaked'||E'\n'; end if;
    select count(*) into n from storage.objects where name = k3;            if n = 0 then passed := passed+1; rep := rep||'PASS 8 binned plan grants nothing'||E'\n'; else failed := failed+1; rep := rep||'FAIL 8 binned P3 file readable'||E'\n'; end if;
    select count(*) into n from storage.objects where name = kx;            if n = 0 then passed := passed+1; rep := rep||'PASS 9 a plan naming ANOTHER user''s private file grants nothing'||E'\n'; else failed := failed+1; rep := rep||'FAIL 9 X private file readable via PA'||E'\n'; end if;
    select case when public.can_read_shared_site_overlay_file(o::text || '/site-overlays/b2244017p1/../b2244017p2/ov2.pdf') then 1 else 0 end into n;
                                                                            if n = 0 then passed := passed+1; rep := rep||'PASS 10 path trick (..) in a named key refused'||E'\n'; else failed := failed+1; rep := rep||'FAIL 10 path trick accepted'||E'\n'; end if;
    select count(*) into n from storage.objects where name = rk5;           if n = 1 then passed := passed+1; rep := rep||'PASS 11 regression: team-shared Map overlay raster still readable'||E'\n'; else failed := failed+1; rep := rep||'FAIL 11 B978273 raster regressed'||E'\n'; end if;
    select count(*) into n from storage.objects where name = rk2;           if n = 0 then passed := passed+1; rep := rep||'PASS 12 (B2244018) an overlay naming another user''s raster grants nothing'||E'\n'; else failed := failed+1; rep := rep||'FAIL 12 forged raster_key readable'||E'\n'; end if;
    select count(*) into n from public.doc_reviews where id = rv;           if n = 0 then passed := passed+1; rep := rep||'PASS 13 (B2244018) an overlay naming another user''s review grants nothing'||E'\n'; else failed := failed+1; rep := rep||'FAIL 13 forged review_id readable'||E'\n'; end if;
    select count(*) into n from public.comps where id = cx;                 if n = 0 then passed := passed+1; rep := rep||'PASS 14 a stranger cannot push a row into a project''s team'||E'\n'; else failed := failed+1; rep := rep||'FAIL 14 injected comp visible'||E'\n'; end if;
    select count(*) into n from storage.objects where name = ko;            if n = 0 then passed := passed+1; rep := rep||'PASS 14b a teammate naming the owner''s ORPHANED file (purged origin) grants nothing'||E'\n'; else failed := failed+1; rep := rep||'FAIL 14b orphan readable via PA'||E'\n'; end if;
    execute 'reset role';

    -- ===== X (outside T; on T3 with M's graft plan) =====
    execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', x, 'role', 'authenticated')::text);
    select count(*) into n from storage.objects where name in (k1, rk1);    if n = 0 then passed := passed+1; rep := rep||'PASS 15 outsider cannot load the shared project''s files'||E'\n'; else failed := failed+1; rep := rep||'FAIL 15 outsider read files ('||n||')'||E'\n'; end if;
    select count(*) into n from public.site_plan_overlays where id = r1;    if n = 0 then passed := passed+1; rep := rep||'PASS 16 outsider cannot see the Map overlay row'||E'\n'; else failed := failed+1; rep := rep||'FAIL 16 outsider sees R1'||E'\n'; end if;
    select count(*) into n from public.comps where id in (c1, c2);          if n = 0 then passed := passed+1; rep := rep||'PASS 17 outsider sees no comps — including through a plan grafted into the group'||E'\n'; else failed := failed+1; rep := rep||'FAIL 17 outsider sees comps ('||n||')'||E'\n'; end if;
    select count(*) into n from storage.objects where name = ko;            if n = 0 then passed := passed+1; rep := rep||'PASS 17b plan-id SQUATTING (X owns a plan with the purged origin id) grants nothing'||E'\n'; else failed := failed+1; rep := rep||'FAIL 17b squatted origin leaked O''s file'||E'\n'; end if;
    select count(*) into n from storage.objects where name = kx;            if n = 1 then passed := passed+1; rep := rep||'PASS 18 regression: own-folder read unchanged'||E'\n'; else failed := failed+1; rep := rep||'FAIL 18 own file unreadable'||E'\n'; end if;
    execute 'reset role';

    -- ===== anon =====
    execute 'set local role anon'; execute 'set local request.jwt.claims = default';
    begin perform public.can_read_via_project('b2244017p1', o); failed := failed+1; rep := rep||'FAIL 19 anon executed can_read_via_project'||E'\n';
    exception when insufficient_privilege then passed := passed+1; rep := rep||'PASS 19 anon cannot execute the helpers'||E'\n'; end;
    execute 'reset role';

    -- ===== UNSHARE P1 → M loses everything derived from it =====
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    perform set_config('planyr.share_intent', '1', true);
    update public.sites set team_id = null where id = 'b2244017p1';
    perform set_config('planyr.share_intent', '0', true);
    execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', m, 'role', 'authenticated')::text);
    select (select count(*) from storage.objects where name in (k1, rk1)) + (select count(*) from public.site_plan_overlays where id = r1) + (select count(*) from public.comps where id = c1) into n;
    if n = 0 then passed := passed+1; rep := rep||'PASS 20 after unshare the teammate loses file, raster, row and comp'||E'\n'; else failed := failed+1; rep := rep||'FAIL 20 still visible after unshare ('||n||')'||E'\n'; end if;
    execute 'reset role';
    -- (2026-10-21, B2404336 session: `reset role` does not reset request.jwt.claims, which still named M
    -- here, so guard_team_share refused the owner's re-share. Re-assert O before it.)
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    perform set_config('planyr.share_intent', '1', true);
    update public.sites set team_id = t where id = 'b2244017p1';
    perform set_config('planyr.share_intent', '0', true);

    -- ===== MUTATION PROOF: weaken two guards; the checks that rely on them MUST go red =====
    create or replace function public.can_read_shared_site_overlay_file(p_name text) returns boolean
      language sql stable security definer set search_path = public as $f$
      select exists (select 1 from public.sites s
        where (s.user_id = auth.uid() or (s.team_id is not null and public.is_team_member(s.team_id)))
          and s.data->'sheetOverlays' @> jsonb_build_array(jsonb_build_object('storageKey', p_name))) $f$;
    create or replace function public.can_read_via_project(p_project text, p_row_owner uuid) returns boolean
      language sql stable security definer set search_path = public as $f$
      select exists (select 1 from public.sites ref join public.sites s
        on coalesce(s.data->>'groupId', s.id) = coalesce(ref.data->>'groupId', ref.id)
        where ref.id = p_project and s.deleted_at is null
          and (s.user_id = auth.uid() or (s.team_id is not null and public.is_team_member(s.team_id)))) $f$;
    execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', m, 'role', 'authenticated')::text);
    select count(*) into n from storage.objects where name in (k3, kx, ko);
    if n > 0 then passed := passed+1; rep := rep||'PASS M1 mutation caught: without the bin + origin checks, checks 8/9 go red ('||n||' leaked)'||E'\n'; else failed := failed+1; rep := rep||'FAIL M1 weakened file guard not detected — checks 8/9 are vacuous'||E'\n'; end if;
    execute 'reset role';
    execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', x, 'role', 'authenticated')::text);
    select count(*) into n from public.comps where id = c2;
    if n > 0 then passed := passed+1; rep := rep||'PASS M2 mutation caught: without the owner binding, the graft leaks C2 (check 17 goes red)'||E'\n'; else failed := failed+1; rep := rep||'FAIL M2 weakened project guard not detected — check 17 is vacuous'||E'\n'; end if;
    execute 'reset role';
  end checks;

  raise exception 'B2244017 RLS proof — % passed, % failed.%', passed, failed, E'\n' || rep;
end $$;
