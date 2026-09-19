-- B1777120 -- A STALE WRITE TO public.schedules MAY NEVER LAND, ENFORCED AT THE DATABASE.
-- Same shape as planar_data_version_monotonic_guard.sql (B1629618) and
-- sites_version_monotonic_guard.sql (B1626528) -- a BEFORE UPDATE trigger refuses any UPDATE
-- that changes `data` unless the incoming `rev` is STRICTLY GREATER than the row's stored
-- `rev`. Unlike planar_data's guard, `rev` here is a real bigint COLUMN, not a token
-- embedded inside the jsonb -- schedules is a new table designed this way from the start, so
-- there is no legacy `value->>'__rev'` extraction to mirror.
--
-- WHY STRICT `>`, NOT "ADVANCE-OR-EQUAL": two tabs racing the same schedule can each read
-- rev 10 and each independently compute rev 11 -- an "advance-or-equal" rule would ACCEPT
-- the second writer's identical-looking rev and silently drop the first writer's content.
-- Strict `>` refuses it: by the time the second write reaches the trigger the row already
-- holds 11, and 11 is not strictly greater than 11.
--
-- WHY "data changed", not "every update": a future write that only touches deleted_at (a
-- soft delete/restore) or reassigns ownership has no content to claim is fresher, so it is
-- exempt -- same reasoning as sites_enforce_version_monotonic's own exemptions.
--
-- Idempotent; safe to re-run. Mutation-proof: test/schedules_version_monotonic_guard.test.sql
-- (self-rolling-back; run it, then `drop trigger schedules_enforce_version_monotonic on
-- public.schedules;` and re-run -- the content-change cases must go RED; restoring this file
-- must turn them green again).

begin;

create or replace function public.schedules_enforce_version_monotonic()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- A write that leaves this row's content untouched (a soft delete/restore, an ownership
  -- reassignment) carries no claim about freshness and is exempt.
  if new.data is not distinct from old.data then
    return new;
  end if;

  if new.rev > old.rev then
    return new;
  end if;

  raise warning 'schedules_enforce_version_monotonic: refused a non-advancing content write on schedule % (stored_rev=%, attempted_rev=%)',
    old.id, old.rev, new.rev;

  begin
    insert into public.client_errors (user_id, module, source, message)
    values (
      auth.uid(),
      'scheduler',
      'event:schedules-version-guard-refused',
      format('id=%s stored_rev=%s attempted_rev=%s', old.id, old.rev, new.rev)
    );
  exception when others then
    -- Telemetry must never be able to fail the write it is reporting on.
    raise warning 'schedules_enforce_version_monotonic: telemetry insert failed: %', sqlerrm;
  end;

  return null;
end;
$$;

comment on function public.schedules_enforce_version_monotonic() is
  'An UPDATE that changes public.schedules.data must carry a rev strictly greater than the '
  'row''s stored one, or it is refused (the row is left unchanged). See '
  'schedules_version_monotonic_guard.sql for the reasoning.';

drop trigger if exists schedules_enforce_version_monotonic on public.schedules;
create trigger schedules_enforce_version_monotonic
  before update on public.schedules
  for each row execute function public.schedules_enforce_version_monotonic();

commit;

-- Verification (run after):
--   select tgname from pg_trigger where tgrelid = 'public.schedules'::regclass and not tgisinternal;
--   -- schedules_enforce_version_monotonic must be present.
