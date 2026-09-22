-- B1777120 -- THE AUTHORITY FLIP: the two pieces the prior session's own BACKLOG.md entry named as
-- "NOT DONE THIS SESSION" and required to ship TOGETHER -- (1) a per-account switch that makes
-- public.schedules / public.schedule_account_index the write-of-record instead of the single
-- planar_data (key='hs-v1') blob, and (2) a database-level refusal of further blob writes once an
-- account is flipped, so a stale/cached tab running pre-flip JS cannot silently resurrect the
-- whole-account document over what the per-schedule rows now hold. This repo has already been
-- bitten by exactly that shape once (a purge fixed client-side that a stale tab still walked past
-- until a database rule closed it) -- see this item's own dispatch text.
--
-- SEQUENCING, so a future reader does not wonder why this is a separate file from
-- schedules_normalization.sql / schedules_decompose_recompose.sql: those shipped the schema, the
-- migration, and a dual-read/dual-write scaffold that defaults OFF -- nothing in production read
-- from or wrote to the new tables as its PRIMARY copy. This file is the flip itself: additive
-- (one new column, three new/replaced functions, one new trigger), and the flip is applied
-- PER ACCOUNT via a plain UPDATE (see the bottom of this file's comment) run by hand after this
-- schema ships and after a fresh decompose has been proven to reconstruct the live blob exactly --
-- never automatically, and never for an account that has not been migrated.
--
-- Idempotent throughout; safe to re-run.

begin;

-- 1. THE FLAG. One boolean per owner. While false, planar_data stays authoritative for that
-- owner -- unchanged legacy behavior, including for a brand-new owner who has never been migrated
-- at all (they simply read false here, same as everyone else, until an operator opts them in).
alter table public.schedule_account_index
  add column if not exists rows_authoritative boolean not null default false;

comment on column public.schedule_account_index.rows_authoritative is
  'B1777120 -- true once this owner''s Schedule reads/writes are authoritative on '
  'public.schedules + public.schedule_account_index rather than the single planar_data '
  '(key=hs-v1) blob. Flipped by hand, per account, only after '
  'schedules_decompose_from_planar_data() has run and schedules_recompose_to_planar_data() has '
  'been proven to reconstruct the current blob exactly (minus __rev). Read by the client at load '
  'time to choose which storage path is primary, and enforced server-side by '
  'planar_data_refuse_post_flip_write below -- the client-side choice alone cannot close the '
  '"a stale cached tab never learned about the flip" hole.';

create or replace function public.schedule_rows_authoritative(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select rows_authoritative from public.schedule_account_index where user_id = p_user_id),
    false
  );
$$;

comment on function public.schedule_rows_authoritative(uuid) is
  'B1777120 -- true iff this owner''s Schedule authority has flipped to the normalized rows. '
  'False (never null) for an owner with no schedule_account_index row at all.';

revoke all on function public.schedule_rows_authoritative(uuid) from public;
grant execute on function public.schedule_rows_authoritative(uuid) to authenticated;

-- 2. THE REFUSAL. Once an owner is flipped, a content-changing write to ANY of their planar_data
-- rows is refused outright -- not because it fails the existing rev guard (PR #1765's
-- planar_data_enforce_version_monotonic), but because the blob is the WRONG SHAPE to be
-- authoritative any more for that owner. This is the case the existing rev guard cannot catch: a
-- stale tab that has not written the blob since before the flip can still compute an internally
-- consistent, strictly-increasing __rev (nothing else has moved the blob either) and would sail
-- straight through that guard. Only a check that knows about the flip itself can refuse it.
-- Deliberately NOT scoped to key='hs-v1': the flip is a per-OWNER fact (schedule_account_index is
-- keyed by user_id, not by planar_data key), so a flipped owner has no legitimate blob write left
-- to make under ANY key -- and hardcoding one key would also make this untestable without writing
-- to the single real production row, which self-rolling-back-transaction tests must never do.
--
-- Escape hatch: schedules_rollback_to_blob() below needs to write the recomposed blob back as the
-- actual rollback mechanism, so it sets a transaction-local GUC
-- (planyr.schedule_blob_rollback) the same way this repo's other exceptional-write escape hatches
-- already do (site-planner/db/purge_one_deleted_plan.sql, .../team_share_default.sql). PostgREST
-- never forwards a client `set_config` call, so an ordinary client write can never fake this.
create or replace function public.planar_data_refuse_post_flip_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  owner uuid;
begin
  if coalesce(current_setting('planyr.schedule_blob_rollback', true), '') = '1' then
    return new;   -- the one sanctioned bypass: an explicit, logged rollback
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
  'B1777120 -- once schedule_account_index.rows_authoritative is true for a user, refuses any '
  'further content-changing write to any of that user''s planar_data rows (not scoped to '
  'key=hs-v1 -- the flip is a per-owner fact). The database-level half of the authority flip -- '
  'see schedules_authority_flip.sql for the full reasoning.';

drop trigger if exists planar_data_refuse_post_flip_write on public.planar_data;
create trigger planar_data_refuse_post_flip_write
  before insert or update on public.planar_data
  for each row execute function public.planar_data_refuse_post_flip_write();

-- 3. THE REVERSE PATH, as a real callable rollback -- not just the read-only
-- schedules_recompose_to_planar_data() this builds on. Recomposes the current rows into the
-- legacy blob shape, stamps a fresh __rev strictly above whatever the blob currently holds (so
-- any tab still watching the old row sees a forward-moving version, never a same-or-lower one the
-- existing monotonic guard would itself refuse), authorizes the one write past the trigger above,
-- writes it, and un-flips the owner so the client's own read path (which already prefers rows
-- only while flipped) falls back to reading the blob it just restored. Never touches
-- public.schedules / public.schedule_account_index rows themselves -- a rollback is a REVERT OF
-- AUTHORITY, not a data-destroying operation, so flipping forward again later needs no
-- re-migration. Locked to service-role/ops use via the Supabase MCP, never client-facing.
create or replace function public.schedules_rollback_to_blob(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  recomposed jsonb;
  next_rev   numeric;
  cur_team   uuid;
begin
  recomposed := public.schedules_recompose_to_planar_data(p_user_id);
  if recomposed is null then
    raise exception 'schedules_rollback_to_blob: no schedule_account_index row for user %', p_user_id;
  end if;

  select coalesce(public.planar_data_rev_of(value), 0), team_id
    into next_rev, cur_team
    from public.planar_data
    where key = 'hs-v1' and user_id = p_user_id;
  next_rev := coalesce(next_rev, 0) + 1;
  recomposed := recomposed || jsonb_build_object('__rev', next_rev);

  perform set_config('planyr.schedule_blob_rollback', '1', true);   -- transaction-local; cannot leak

  update public.planar_data
    set value = recomposed
    where key = 'hs-v1' and user_id = p_user_id;

  if not found then
    insert into public.planar_data (key, value, user_id, team_id)
    values ('hs-v1', recomposed, p_user_id, cur_team);
  end if;

  -- rev must advance here too: schedule_account_index_enforce_version_monotonic (below) refuses
  -- any content-changing UPDATE -- including flipping rows_authoritative -- unless rev strictly
  -- increases, the same CAS discipline as every other write to this row.
  update public.schedule_account_index
    set rows_authoritative = false,
        rev = rev + 1
    where user_id = p_user_id;

  perform set_config('planyr.schedule_blob_rollback', '0', true);

  return recomposed;
end;
$$;

comment on function public.schedules_rollback_to_blob(uuid) is
  'B1777120 -- the actual rollback mechanism: recomposes planar_data.value from the current '
  'schedules/schedule_account_index rows, stamps a fresh __rev, writes it back (bypassing '
  'planar_data_refuse_post_flip_write via the planyr.schedule_blob_rollback transaction-local '
  'GUC), and un-flips rows_authoritative so the client reads the blob again. Run by hand via the '
  'Supabase MCP; never granted to authenticated/anon.';

revoke execute on function public.schedules_rollback_to_blob(uuid) from public;

-- 4. THE MISSING CAS GUARD schedule_account_index never got. schedules_version_monotonic_guard.sql
-- gave public.schedules a real rev-CAS trigger; schedule_account_index has carried a `rev` column
-- since schedules_normalization.sql but NO trigger ever enforced it -- an UPDATE landed
-- unconditionally regardless of rev, so the client's own "0 rows returned means refused" detection
-- (the same `.select(...)` trick every other guarded write in this app already relies on) would
-- silently never fire for this row. Same shape as schedules_enforce_version_monotonic, adapted for
-- a row whose content is spread across several columns rather than one `data` jsonb -- "unchanged"
-- means every content column matches, not just one.
create or replace function public.schedule_account_index_enforce_version_monotonic()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.n_pid                is not distinct from old.n_pid
     and new.n_tid               is not distinct from old.n_tid
     and new.last_active_by_site is not distinct from old.last_active_by_site
     and new.settings            is not distinct from old.settings
     and new.migration_flags     is not distinct from old.migration_flags
     and new.rows_authoritative  is not distinct from old.rows_authoritative
  then
    return new;   -- no content claim (e.g. a team_id reassignment only) -- exempt
  end if;

  if new.rev > old.rev then
    return new;
  end if;

  raise warning 'schedule_account_index_enforce_version_monotonic: refused a non-advancing content write for user % (stored_rev=%, attempted_rev=%)',
    old.user_id, old.rev, new.rev;

  begin
    insert into public.client_errors (user_id, module, source, message)
    values (
      old.user_id,
      'scheduler',
      'event:schedule-account-index-guard-refused',
      format('stored_rev=%s attempted_rev=%s', old.rev, new.rev)
    );
  exception when others then
    raise warning 'schedule_account_index_enforce_version_monotonic: telemetry insert failed: %', sqlerrm;
  end;

  return null;
end;
$$;

comment on function public.schedule_account_index_enforce_version_monotonic() is
  'B1777120 -- an UPDATE that changes any content column of public.schedule_account_index must '
  'carry a rev strictly greater than the row''s stored one, or it is refused. Same shape as '
  'schedules_enforce_version_monotonic; this table simply never had the guard until the client '
  'write path (writeIndexRow in public/sequence/index.html) started depending on it.';

drop trigger if exists schedule_account_index_enforce_version_monotonic on public.schedule_account_index;
create trigger schedule_account_index_enforce_version_monotonic
  before update on public.schedule_account_index
  for each row execute function public.schedule_account_index_enforce_version_monotonic();

commit;

-- ============================================================================================
-- HOW TO FLIP AN ACCOUNT FORWARD (run by hand, after this file, per account -- never automatic):
--   1. select * from public.schedules_decompose_from_planar_data();   -- bring rows fully current
--   2. Compare public.schedules_recompose_to_planar_data(p_user_id) against the live
--      planar_data.value for that user (minus __rev) -- must be jsonb-equal.
--   3. update public.schedule_account_index set rows_authoritative = true where user_id = p_user_id;
--
-- HOW TO ROLL AN ACCOUNT BACK:
--   select public.schedules_rollback_to_blob('<user_id>'::uuid);
--
-- Verification (run after applying this file):
--   select column_name from information_schema.columns
--     where table_name='schedule_account_index' and column_name='rows_authoritative';   -- 1 row
--   select tgname from pg_trigger
--     where tgrelid='public.planar_data'::regclass and not tgisinternal;
--     -- planar_data_enforce_version_monotonic AND planar_data_refuse_post_flip_write, both present.
