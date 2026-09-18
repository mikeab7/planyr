-- B1629618 — A STALE WRITE TO public.planar_data MAY NEVER LAND, ENFORCED AT THE DATABASE, NOT
-- JUST BY THE CLIENT'S OWN READ-THEN-WRITE CHECK. Run ONCE in the Supabase SQL editor (or via the
-- Supabase MCP apply_migration tool). Idempotent; safe to re-run. ADDITIVE: adds two functions and
-- one BEFORE UPDATE trigger. Changes no column, no policy, no existing row.
--
-- ============================================================================================
-- THE BUG (filed by the B1629616 concurrency audit, 2026-09-15; built here, 2026-09-18)
-- ============================================================================================
-- public.planar_data holds the whole Schedule module as ONE row per key (today, exactly one row,
-- key = 'hs-v1', holding all ten of the owner's schedules under one ~419 KB jsonb document). It
-- has no dedicated `version` COLUMN the way public.sites does (db/optimistic_concurrency.sql) --
-- the revision token is embedded IN the jsonb itself, at `value->>'__rev'` -- and the client
-- (public/sequence/index.html's `_rawSet`) already reads the cloud's current rev immediately
-- before writing and refuses-or-merges when the cloud has moved ahead of what this tab last knew.
-- That is a real, working guard, but it is a plain CLIENT-SIDE read-then-write check with no
-- server-side compare-and-swap: `pg_trigger` on planar_data returns ZERO non-internal triggers
-- (measured 2026-09-17), and the actual write is an unconditional
-- `.upsert({key, value}, {onConflict:"key"})` with no WHERE clause tying it to the rev the client
-- last read. Two tabs can each pass their own pre-write check (each reading a cloudRev that really
-- was current AT THE MOMENT it read) and still race each other to the write itself: tab A reads
-- rev 10, tab B reads rev 10 microseconds later, both compute rev 11, A's upsert lands first and
-- the cloud is now at rev 11 -- and B's upsert, ALSO carrying rev 11, still passes an unconditional
-- write and silently overwrites A's edit, with the counter never even moving backwards (it's a
-- same-value collision, not a regression), so nothing client-side ever notices.
--
-- ============================================================================================
-- THE FIX
-- ============================================================================================
-- A BEFORE UPDATE trigger, the same shape as `public.sites`' own guard
-- (db/sites_version_monotonic_guard.sql / `sites_enforce_version_monotonic`, B1626528): an UPDATE
-- that changes this row's `value` must carry a `value->>'__rev'` STRICTLY GREATER than the one
-- already stored, or it is refused outright (the row is left exactly as it was).
--
-- WHY STRICT `>`, NOT "ADVANCE-OR-EQUAL" (considered and rejected -- this is the one place an
-- earlier draft of this item's own brief suggested loosening the rule, and it is wrong). The exact
-- race above produces a write whose proposed rev EQUALS the row's already-stored rev (both tabs
-- compute 11 from the same stale read of 10). An "advance-or-equal" rule (`new >= old`) would
-- ACCEPT that write -- it is precisely the collision this item exists to close, not a benign
-- no-op. Strict `>` is what correctly refuses it: by the time B's write reaches the trigger, the
-- row already holds 11 (A's write), and 11 is not strictly greater than 11.
--
-- WHY "value changed", not "every update" -- `public.planar_data` also carries `user_id`/`team_id`
-- (planar_tables_owner_scoped_rls.sql), and a future write that only reassigns ownership (a team
-- transfer, say) would have no schedule CONTENT to claim is fresher, so it is exempt -- same
-- reasoning as sites_enforce_version_monotonic's soft-delete/restore/group_id-backfill exemptions.
-- Every current write path (grepped: the ONE call site is `_rawSet`'s
-- `sb.from(TABLE).upsert({key,value})`, reached only through `window.storage.set`, which every one
-- of the six `.set("hs-v1", ...)` call sites in public/sequence/index.html funnels through) always
-- sends the WHOLE document as `value` and always stamps a fresh `__rev` on it just before writing
-- (`_rawSet`'s own rev-stamp line, unconditional for every label -- auto, pre-restore,
-- pre-delete-project, pre-import, pre-recascade), so in ordinary (non-racing) operation every real
-- write already produces a strictly-increasing rev and this guard is a no-op. It only ever bites
-- the exact race it is built to close, or a write built from a stale premise (e.g. a read that
-- failed and fell back to a locally-remembered rev that itself was already behind).
--
-- WHAT HAPPENS ON REFUSAL. Returning NULL from a BEFORE UPDATE trigger skips the write for that
-- row -- Postgres reports ZERO rows updated. `_rawSet` now chains `.select("key")` on the upsert
-- specifically to see that (a bare `.upsert()` with no `.select()` sends
-- `Prefer: return=minimal`, so PostgREST would otherwise report success regardless -- the exact "a
-- refused save tells nobody" defect already found once for public.sites, B1693264) and, on an
-- empty result with no error, re-reads the row that actually won the race and either re-sequences
-- an explicit checkpoint write against it (skipSanity callers: pre-delete/pre-import/pre-restore/
-- pre-recascade) or re-merges an ordinary autosave onto it (mergeCloudDoc, the SAME 3-way merge
-- Layer 0 already uses for a staleness caught BEFORE the write) and retries once. A second refusal
-- in a row is treated exactly like today's existing "merge unavailable" case: the tab's own copy is
-- snapshotted to Version History as 'stale-block' and the existing "a newer version was saved
-- elsewhere" banner is shown -- never a silent drop.
-- Belt-and-suspenders LOUD-FAILURE: every refusal also `RAISE WARNING`s (visible in Postgres/
-- Supabase logs) and records one row in `public.client_errors`
-- (`source = 'event:hs-version-guard-refused'`), matching `sites_enforce_version_monotonic`'s own
-- telemetry convention, so the refusal rate is measurable even from a client that predates this fix
-- (an old cached tab with no `.select()`/retry code at all gets no live signal back, exactly as any
-- client without CAS awareness didn't for the sites guard either -- but the row itself can no
-- longer be clobbered, which is the property this item is actually about).
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   • It does not require an EXACT +1 -- any strictly-greater rev is accepted (a future repair/
--     reconcile script jumping the counter is not penalized).
--   • It does not touch INSERT -- the row's very first write for a key is `_rawSet`'s own concern.
--   • It does not repair or rewrite the existing row -- purely a guard on future writes.
--   • It treats a missing or non-numeric `__rev` as 0 (`planar_data_rev_of` below), matching the
--     client's own `revOf` convention exactly, so a malformed payload can never outrank a real one.

begin;

-- Safe rev extraction: NULL/absent/non-numeric __rev reads as 0, matching public/sequence/
-- index.html's own `revOf`. Never throws, so a malformed jsonb shape refuses a write instead of
-- erroring the whole statement out.
create or replace function public.planar_data_rev_of(v jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when v is null then 0
    when jsonb_typeof(v -> '__rev') = 'number' then (v ->> '__rev')::numeric
    else 0
  end;
$$;

comment on function public.planar_data_rev_of(jsonb) is
  'Extracts the __rev revision token from a planar_data value jsonb doc, treating a missing or '
  'non-numeric __rev as 0 -- mirrors public/sequence/index.html''s client-side revOf() exactly.';

create or replace function public.planar_data_enforce_version_monotonic()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  old_rev numeric;
  new_rev numeric;
begin
  -- A write that leaves this row's content untouched (e.g. a future ownership/team reassignment
  -- with no schedule-data change) carries no claim about freshness and is exempt.
  if new.value is not distinct from old.value then
    return new;
  end if;

  old_rev := public.planar_data_rev_of(old.value);
  new_rev := public.planar_data_rev_of(new.value);

  if new_rev > old_rev then
    return new;
  end if;

  raise warning 'planar_data_enforce_version_monotonic: refused a non-advancing content write on key % (stored_rev=%, attempted_rev=%)',
    old.key, old_rev, new_rev;

  begin
    insert into public.client_errors (user_id, module, source, message)
    values (
      auth.uid(),
      'scheduler',
      'event:hs-version-guard-refused',
      format('key=%s stored_rev=%s attempted_rev=%s', old.key, old_rev, new_rev)
    );
  exception when others then
    -- Telemetry must never be able to fail the write it is reporting on.
    raise warning 'planar_data_enforce_version_monotonic: telemetry insert failed: %', sqlerrm;
  end;

  return null;
end;
$$;

comment on function public.planar_data_enforce_version_monotonic() is
  'An UPDATE that changes public.planar_data.value must carry a value->>''__rev'' strictly '
  'greater than the row''s stored one, or it is refused (the row is left unchanged). See '
  'db/planar_data_version_monotonic_guard.sql for the production measurement and reasoning.';

drop trigger if exists planar_data_enforce_version_monotonic on public.planar_data;
create trigger planar_data_enforce_version_monotonic
  before update on public.planar_data
  for each row execute function public.planar_data_enforce_version_monotonic();

commit;

-- Verification (run after):
--   select tgname from pg_trigger where tgrelid = 'public.planar_data'::regclass and not tgisinternal;
--   -- planar_data_enforce_version_monotonic must be present.
-- Mutation proof: test/planar_data_version_monotonic_guard.test.sql (self-rolling-back; run it,
-- then `drop trigger planar_data_enforce_version_monotonic on public.planar_data;` and re-run --
-- the content-change cases must go RED; restoring this file must turn them green again).
