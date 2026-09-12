-- ============================================================================
-- NEW-3 (2026-09-12 owner review) — proof that backfill_group_id_column() actually converges the
-- group_id COLUMN onto the jsonb, AGAINST THE REAL DATABASE.
--
-- Proves the single property this function exists for:
--
--     A ROW WHOSE group_id COLUMN DISAGREES WITH data->>'groupId' GOES RED; THE FUNCTION TURNS IT
--     GREEN, AND TOUCHES NOTHING ELSE ON THE ROW.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute.
--   It is SELF-ROLLING-BACK — it ends by raising an exception carrying the report, so every
--   fixture row is discarded. It writes NOTHING that survives. Fixture id is
--   `zzgidcheck-newthree` — never a real plan id.
--
-- HOW TO PROVE IT RED (do this whenever backfill_group_id_column() is touched):
--   Comment out the `perform public.backfill_group_id_column(...)` line and re-run — the AFTER
--   assertion must now FAIL (the column still disagrees), proving the backfill is load-bearing.
-- ============================================================================
do $$
declare
  owner_uid uuid;
  fid text := 'zzgidcheck-newthree';
  before_col text;
  before_json text;
  after_col text;
  after_site text;
  after_data jsonb;
  rep text := '';
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'proof: no auth user to hang the fixture off'; end if;

  insert into public.sites (id, user_id, group_id, site, data, version)
  values (
    fid, owner_uid, 'zzgidcheck-WRONG', 'Throwaway Fixture',
    jsonb_build_object('id', fid, 'groupId', fid, 'site', 'Throwaway Fixture', 'name', 'Concept A'),
    1
  );

  -- RED: the column deliberately disagrees with the jsonb.
  select group_id, data->>'groupId' into before_col, before_json from public.sites where id = fid;
  if before_col = before_json then
    raise exception 'PROOF FAILED — the planted disagreement was not planted (col=% json=%)', before_col, before_json;
  end if;
  rep := rep || format('BEFORE backfill: group_id=%L data.groupId=%L (RED — confirmed disagreeing) — ', before_col, before_json);

  perform public.backfill_group_id_column(fid);

  -- GREEN: the column now matches the jsonb, and nothing else on the row moved.
  select group_id, site, data into after_col, after_site, after_data from public.sites where id = fid;
  if after_col is distinct from before_json then
    raise exception 'PROOF FAILED — backfill_group_id_column() did not converge the column (expected %, got %)', before_json, after_col;
  end if;
  if after_site is distinct from 'Throwaway Fixture' or after_data is distinct from jsonb_build_object('id', fid, 'groupId', fid, 'site', 'Throwaway Fixture', 'name', 'Concept A') then
    raise exception 'PROOF FAILED — backfill_group_id_column() touched site/data, which it must never do';
  end if;
  rep := rep || format('AFTER backfill: group_id=%L (GREEN — matches data.groupId, site/data untouched).', after_col);

  raise exception 'PROOF PASSED (rolled back, nothing persists): %', rep;
end $$;
