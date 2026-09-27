-- B1927952 (NEW-2, 2026-09-27) -- STAMP the retired planar_data blob rather than remove it.
--
-- THE PROBLEM THIS CLOSES. Once an owner is flipped (schedule_account_index.rows_authoritative =
-- true, schedules_authority_flip.sql), their planar_data row (key='hs-v1') stops being written --
-- planar_data_refuse_post_flip_write() already blocks that -- but the ROW ITSELF stays exactly as
-- it was at the moment of the flip, holding a plausible-looking whole-account document. On
-- Michael's own production account it is a 420 KB, __rev 5026 snapshot frozen since 2026-09-25,
-- and reading it has ALREADY produced one wrong finding this same session (the Dashboard's
-- Schedule health / Needs Attention / "Since you were last here" cards, and separately the MCP
-- tool connector's get_schedule/list_projects/get_project -- see BACKLOG.md B1927952). A future
-- reader written without knowing about the flip will make the identical mistake, because nothing
-- about the row's own SHAPE says "this is stale" -- it parses cleanly and looks current.
--
-- ⛔ THE OWNER'S EXPLICIT INSTRUCTION THIS FOLLOWS: "DO NOT delete the row and do not migrate it
-- away -- it is the pre-flip recovery copy, and removing the owner's data is his call, not this
-- session's." So the fix is a MARKER, not a removal: this file adds a callable function that
-- writes two keys into the existing value -- `_retiredAt` (when) and `_supersededBy` (what to
-- read instead) -- plus a mandatory `__rev` bump the pre-existing rev-CAS guard on this table
-- requires of any content-changing write (see that function's own header, below, for why). Every
-- other byte of the document is untouched. The row is still there, still readable, still
-- restorable via schedules_rollback_to_blob() exactly as before; it now also announces its own
-- retirement to anything that reads it directly.
--
-- WHY A SEPARATE BYPASS GUC, NOT THE EXISTING planyr.schedule_blob_rollback ONE.
-- planar_data_refuse_post_flip_write()'s existing bypass is documented as "the one sanctioned
-- bypass: an explicit, logged rollback" and is used by schedules_rollback_to_blob() to restore
-- the blob as the ACTIVE write-of-record again (also un-flipping the owner). Stamping is a
-- different, narrower operation -- the owner STAYS flipped, and the write's only content is the
-- two marker keys -- so it gets its own clearly-named GUC (planyr.schedule_blob_admin_stamp)
-- rather than overloading the rollback one's meaning. Both are transaction-local and neither can
-- be set by an ordinary client write (PostgREST never forwards a client set_config call), exactly
-- like every other exceptional-write escape hatch in this repo.
--
-- WHEN THIS RUNS. Not automatically on every flip today's schedules_authority_flip.sql documents
-- (that stays a plain 3-step manual UPDATE, unchanged) -- this file adds a 4th, ADDITIVE step to
-- that runbook (see the bottom of this file) so a FUTURE flip stamps the blob as part of the same
-- action, and a callable function an operator can also run by hand for an ALREADY-flipped
-- account (Michael's own). ⛔ THIS SESSION DID NOT RUN IT AGAINST PRODUCTION -- the dispatch for
-- this item was explicit ("READ-ONLY on production; no writes ... to his data"), so the function
-- is shipped, reviewed, and left uninvoked; see BACKLOG.md B1927952 for that stated blocker.
--
-- Idempotent (a already-stamped blob is a no-op) and safe to re-run.

begin;

create or replace function public.planar_data_refuse_post_flip_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  owner uuid;
begin
  if coalesce(current_setting('planyr.schedule_blob_rollback', true), '') = '1' then
    return new;   -- sanctioned bypass #1: an explicit, logged rollback (schedules_rollback_to_blob)
  end if;
  if coalesce(current_setting('planyr.schedule_blob_admin_stamp', true), '') = '1' then
    return new;   -- sanctioned bypass #2: an explicit, logged retirement stamp (this file, below)
  end if;

  if TG_OP = 'UPDATE' then
    if new.value is not distinct from old.value then
      return new;   -- no content claim (e.g. a metadata-only reassignment) -- nothing to refuse
    end if;
    owner := coalesce(new.user_id, old.user_id);
  else
    owner := new.user_id;
  end if;

  if owner is null or not public.schedule_rows_authoritative(owner) then
    return new;   -- this account has not been flipped -- unchanged legacy behavior
  end if;

  raise warning 'planar_data_refuse_post_flip_write: refused a write to key % for owner % -- schedules/schedule_account_index are authoritative for this account',
    new.key, owner;

  begin
    insert into public.client_errors (user_id, module, source, message)
    values (
      owner,
      'scheduler',
      'event:hs-blob-write-refused-post-flip',
      format('key=%s -- a write reached the retired planar_data blob after authority flipped; likely a stale cached tab', new.key)
    );
  exception when others then
    -- Telemetry must never be able to fail the write it is reporting on.
    raise warning 'planar_data_refuse_post_flip_write: telemetry insert failed: %', sqlerrm;
  end;

  return null;
end;
$$;

comment on function public.planar_data_refuse_post_flip_write() is
  'B1777120 -- refuses a post-flip content write to a flipped owner''s planar_data row. B1927952 '
  'added a SECOND sanctioned bypass (planyr.schedule_blob_admin_stamp) alongside the original '
  'rollback one, for schedules_stamp_retired_blob() below -- see schedules_authority_flip.sql for '
  'the original reasoning and schedules_blob_retirement_stamp.sql for the addition.';

-- THE STAMP ITSELF. Writes `_retiredAt` (an ISO-8601 UTC timestamp string) and `_supersededBy`
-- ("schedules") into the existing value, changing nothing else. Idempotent: a blob that already
-- carries `_retiredAt` is returned unchanged, so re-running this (e.g. as a routine step of a
-- future flip) never overwrites the original retirement moment. Returns null when there is no
-- blob for this owner at all (nothing to stamp -- not an error). Locked to service-role/ops use
-- only, matching schedules_rollback_to_blob's own access.
--
-- ⛔ ALSO ADVANCES __rev BY 1 -- a defect found and fixed before shipping, worth recording so it
-- is not reintroduced. planar_data ALREADY carries a SECOND, independent trigger from BEFORE this
-- one, planar_data_enforce_version_monotonic (planar_data_version_monotonic_guard.sql / B1629618):
-- it refuses ANY content-changing update to `value` whose `__rev` does not strictly advance,
-- regardless of the flip-refusal trigger this file's own bypass targets. A stamp that changed only
-- `_retiredAt`/`_supersededBy` without touching `__rev` would pass THIS file's bypass and then be
-- silently refused by that OTHER, older guard -- caught by the PGlite proof
-- (test/schedulesBlobRetirementStamp.test.js) before this shipped, not by inspection.
-- schedules_rollback_to_blob (the existing precedent for a controlled write to this table) already
-- does the same thing for the same reason -- this mirrors it rather than inventing a second shape.
create or replace function public.schedules_stamp_retired_blob(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  cur_value jsonb;
  stamped   jsonb;
  next_rev  numeric;
begin
  if not public.schedule_rows_authoritative(p_user_id) then
    raise exception 'schedules_stamp_retired_blob: owner % is not rows_authoritative -- refusing to mark a still-ACTIVE blob as retired',
      p_user_id;
  end if;

  select value into cur_value from public.planar_data where key = 'hs-v1' and user_id = p_user_id;
  if cur_value is null then
    return null;
  end if;
  if cur_value ? '_retiredAt' then
    return cur_value;   -- already stamped -- idempotent no-op, preserves the ORIGINAL retirement moment
  end if;

  next_rev := coalesce(public.planar_data_rev_of(cur_value), 0) + 1;
  stamped := cur_value || jsonb_build_object(
    '__rev', next_rev,
    '_retiredAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    '_supersededBy', 'schedules'
  );

  perform set_config('planyr.schedule_blob_admin_stamp', '1', true);   -- transaction-local; cannot leak

  update public.planar_data
    set value = stamped
    where key = 'hs-v1' and user_id = p_user_id;

  perform set_config('planyr.schedule_blob_admin_stamp', '0', true);

  return stamped;
end;
$$;

comment on function public.schedules_stamp_retired_blob(uuid) is
  'B1927952 -- marks a flipped owner''s retired planar_data (key=hs-v1) blob with '
  '_retiredAt/_supersededBy so a stray direct reader gets an unmistakable signal instead of a '
  'plausible-looking stale snapshot. NEVER deletes or migrates the row -- it stays the pre-flip '
  'recovery copy, restorable via schedules_rollback_to_blob(); removing it is the account owner''s '
  'call, not this function''s. Idempotent (a stamped blob is returned unchanged on a re-run). Run '
  'by hand via the Supabase MCP, or as step 4 of the flip runbook '
  '(schedules_authority_flip.sql''s own trailing comment); never granted to authenticated/anon.';

revoke execute on function public.schedules_stamp_retired_blob(uuid) from public;

commit;

-- ============================================================================================
-- ADDS a 4th step to schedules_authority_flip.sql's "HOW TO FLIP AN ACCOUNT FORWARD" runbook:
--   4. select public.schedules_stamp_retired_blob('<user_id>'::uuid);
--
-- To retroactively stamp an ALREADY-flipped account's blob (e.g. Michael's own, flipped
-- 2026-09-25, NOT run this session -- see this file's own header):
--   select public.schedules_stamp_retired_blob('<user_id>'::uuid);
--   -- then verify: select value->>'_retiredAt', value->>'_supersededBy'
--   --              from public.planar_data where key='hs-v1' and user_id='<user_id>'::uuid;
--
-- Verification (run after applying this file):
--   select routine_name from information_schema.routines
--     where routine_schema='public' and routine_name='schedules_stamp_retired_blob';   -- 1 row
-- ============================================================================================
