-- ============================================================================
-- Live proof (NEW-1 / NEW-2, 2026-10-29 data-risk block) that a doc_reviews row a
-- site_plan_overlays row is built from can NEVER be deleted — neither by a hard delete nor
-- (on a rebuilt environment) by a silent CASCADE that would take the placed plan with it.
--
-- WHY: the checked-in site_plan_overlays.sql declared ON DELETE CASCADE while production was
-- RESTRICT (B972512-HARDENING changed it live and never back-ported the file). The Library's
-- 30-day purge relies on the FK refusing the row delete, so the refusal is a load-bearing
-- schema property and gets its own guard.
--
-- Proves, AGAINST THE REAL CONSTRAINT:
--   1. pg_constraint says site_plan_overlays_review_id_fkey is ON DELETE RESTRICT (confdeltype 'r').
--   2. DELETE FROM doc_reviews for a review with a live overlay is REFUSED with 23503 and
--      names site_plan_overlays_review_id_fkey.
--   3. After the refusal the doc_reviews row AND the overlay row both still exist.
--   4. Once the overlay row is removed, the same review row deletes normally (RESTRICT is a
--      guard, not a lock).
--
-- Self-rolling-back: runs in a DO block and raises an exception at the end carrying the report,
-- so every fixture is discarded. Run via execute_sql / the SQL editor.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0f01';
  review_id text := 'rls-test-review-fk-restrict';
  overlay_id uuid;
  passed int := 0; failed int := 0; rep text := '';
  deltype "char"; n int; err_code text; err_msg text;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fk-restrict-a@test.invalid', now(), now());
  insert into public.doc_reviews (id, user_id, title, data) values (review_id, ua, 'fk restrict test', '{}'::jsonb);
  insert into public.site_plan_overlays (user_id, review_id, page, img_w, img_h)
  values (ua, review_id, 1, 100, 100) returning id into overlay_id;

  select confdeltype into deltype from pg_constraint
   where conname = 'site_plan_overlays_review_id_fkey' and conrelid = 'public.site_plan_overlays'::regclass;
  if deltype = 'r' then passed := passed + 1; rep := rep || 'PASS 1: review_id FK is ON DELETE RESTRICT. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 1: review_id FK confdeltype = %s, expected r (RESTRICT).', coalesce(deltype::text, 'missing')) || E'\n'; end if;

  begin
    delete from public.doc_reviews where id = review_id;
    failed := failed + 1; rep := rep || 'FAIL 2: delete of a review with a live overlay was NOT refused.' || E'\n';
  exception when others then
    get stacked diagnostics err_code = returned_sqlstate, err_msg = message_text;
    if err_code = '23503' and err_msg like '%site_plan_overlays_review_id_fkey%' then passed := passed + 1; rep := rep || 'PASS 2: delete refused with 23503 naming the FK. ' || E'\n';
    else failed := failed + 1; rep := rep || format('FAIL 2: wrong refusal %s / %s', err_code, err_msg) || E'\n'; end if;
  end;

  select count(*) into n from public.doc_reviews where id = review_id;
  if n = 1 and exists (select 1 from public.site_plan_overlays where id = overlay_id) then passed := passed + 1; rep := rep || 'PASS 3: review row and overlay both survive the refusal. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3: a row went missing after the refused delete.' || E'\n'; end if;

  delete from public.site_plan_overlays where id = overlay_id;
  delete from public.doc_reviews where id = review_id;
  select count(*) into n from public.doc_reviews where id = review_id;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 4: with the overlay gone the review deletes normally. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 4: review still present after overlay removed.' || E'\n'; end if;

  raise exception 'review-fk-restrict proof complete — % passed, % FAILED. %', passed, failed, rep;
end $$;
