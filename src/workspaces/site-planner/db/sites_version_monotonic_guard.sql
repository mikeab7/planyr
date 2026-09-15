-- NEW-1 — A STALE WRITE TO public.sites MAY NEVER LAND, ENFORCED AT THE DATABASE, NOT JUST BY
-- THE CLIENT'S OWN WHERE CLAUSE. Run ONCE in the Supabase SQL editor. Idempotent; safe to
-- re-run. ADDITIVE: adds one BEFORE UPDATE trigger. Changes no column, no policy, no existing
-- row — see "Do not repair or rewrite any of the owner's existing rows" below.
--
-- ============================================================================================
-- THE BUG, MEASURED ON planyr_production 2026-09-15 (not reasoned about)
-- ============================================================================================
-- `db/optimistic_concurrency.sql` (B314) added an integer `version` column to `public.sites` and
-- the client (`shared/cloud/optimisticUpsert.js`'s `casUpsert`) writes through a CONDITIONAL
-- UPDATE — `WHERE id = … AND version = <expected>`, setting `version = <expected> + 1` — so a
-- write built from a stale copy matches zero rows and is rejected. That conditional WHERE clause
-- lives entirely in the CLIENT's own JavaScript. Nothing at the database compares the incoming
-- `version` (or any other token) against the stored one, so anything that can reach the table
-- through PostgREST with a valid session for its own row — an UNCONDITIONAL update (no `version`
-- filter at all), a cached browser tab running a bundle from before `casUpsert` existed, or a
-- hand-built request — can simply skip the WHERE clause and the check goes with it.
--
-- Reproduced live in a rolled-back transaction against `planyr_production`, on a throwaway row
-- (never one of the owner's real plans), 2026-09-15:
--   0 initial insert                                            version=1  els=3
--   1 window A draws something — a real, WHERE-guarded CAS save  version=2  els=4  (1 row matched)
--   2 window B is stale and sends the SAME well-behaved CAS      version=2  els=4  (0 rows matched — CORRECTLY refused)
--   3 window B / an old bundle sends an UNCONDITIONAL update     version=1  els=3  (1 row matched — THE BUG)
-- Step 2 proves the client-side conditional filter already works correctly when both sides use
-- it. Step 3 proves it buys nothing against a writer that does not use it: the row's version was
-- driven BACKWARDS (2 → 1) and window A's fourth element was silently erased — the exact "a
-- stale tab can silently overwrite a whole plan, and the version counter can move backwards"
-- symptom this item was opened for.
--
-- ============================================================================================
-- THE FIX
-- ============================================================================================
-- A BEFORE UPDATE trigger, the same shape every other guard in this folder uses
-- (`sites_preserve_rename_stamp`, `sites_normalize_county`): an UPDATE that changes this row's
-- CONTENT — its `data` jsonb, or the mirrored `site`/`name` columns — must carry a `version`
-- STRICTLY GREATER than the one already stored, or it is refused outright (the row is left
-- exactly as it was). This is the "reject rather than apply" the item asks for, and it also
-- makes the counter itself monotonic — a version can never move backwards or stand still on a
-- content-changing write, whatever wrote it.
--
-- WHY "content changed", NOT "every update" — three existing write paths on this table
-- DELIBERATELY do not bump `version`, and a blanket rule would break every one of them:
--   • `cloudDelete`/`cloudDeleteGroup`/`cloudRestore` (`cloudSync.js`) — the soft-delete/restore
--     UPDATE touches ONLY `deleted_at`. Its own comment: "must not invalidate another tab's CAS
--     token" — a version bump here would hand every other open tab a false conflict on a field
--     it never touched.
--   • `db/backfill_group_id_column.sql` — writes ONLY `group_id`, by design ("never touches
--     `data`, `site`, `version` or `updated_at`").
--   • the team-share/lock flips (`db/team_share_default.sql`'s `guard_team_share`) — touch only
--     `team_id`/`share_locked`.
-- None of these claims to be carrying fresher CONTENT, so none of them owes a version bump —
-- only a write that changes `data`/`site`/`name` does. `rename_site_group()`, `set_site_group_
-- role()` and `reconcile_site_group_name()` (the three RPCs that DO touch `data`+`site` together)
-- already bump `version = coalesce(s.version,1) + 1` in the same statement, so this guard is a
-- no-op for all three — checked directly against their SQL bodies before shipping this, not
-- assumed.
--
-- WHY THIS TRIGGER RUNS FIRST (trigger name sorts alphabetically ahead of every other BEFORE
-- UPDATE trigger already on this table — Postgres fires same-event row triggers in name order).
-- `sites_normalize_county` and `sites_preserve_rename_stamp` can each, in narrow backstop cases
-- of their own, correct `new.data`/`new.site` as a SIDE EFFECT of a write that never intended to
-- touch content (e.g. a legacy denormalized county key riding along on an unrelated update).
-- Running first means this guard reads `new.data`/`new.site`/`new.version` exactly as the CALLER
-- proposed them, before any sibling trigger's own correction can manufacture a content diff this
-- guard did not ask for. (In today's schema neither sibling actually produces such a diff on a
-- non-content write — verified directly — but the ordering costs nothing and removes the need to
-- keep re-proving that as those triggers evolve.)
--
-- WHAT HAPPENS ON REFUSAL (the deliberate choice, not left implicit)
-- Returning NULL from a BEFORE UPDATE trigger skips the write for that row — Postgres reports
-- ZERO rows updated. For every CURRENT client write path that chains `.select(...)` (every
-- `casUpsert` call — `cloudUpsertCore`, `keepaliveCasPush`), that is EXACTLY the shape
-- `optimisticUpsert.interpretCas` already treats as a CAS conflict (`rows.length === 0` →
-- `{ok:false, conflict:true}`), which `cloudUpsertCore` already handles: refetch the fresh
-- version and retry once, then report `cloud-conflict`/LOUD-FAILURE if it still doesn't land. So
-- a bypassing-but-well-formed write recovers through the EXISTING B672 reconcile path with ZERO
-- client code changes. A caller with no CAS awareness at all (a bundle old enough to predate
-- `casUpsert`, sending a bare `Prefer: return=minimal` upsert) gets no live signal back — there is
-- no way to retrofit feedback into code that already shipped and is only running from a cached
-- tab — but the row itself cannot be clobbered, which is the property this item is actually
-- about. This mirrors "the bin purge" precedent named in the item: the client-side conditional
-- write already exists and already works when both sides honor it; this closes the path where
-- one side doesn't.
-- Belt-and-suspenders LOUD-FAILURE: every refusal also `RAISE WARNING`s (visible in Postgres/
-- Supabase logs) and records one row in `public.client_errors`
-- (`source = 'event:version-guard-refused'`), so the refusal is discoverable even when the
-- writer itself cannot show it — the same pattern `sites_preserve_rename_stamp` already uses for
-- the identical reason.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   • It does not require an EXACT +1 — any strictly-greater version is accepted, matching
--     `sites_preserve_rename_stamp`'s own "newer, not exactly-next" recency rule. Every current
--     writer that bumps version at all bumps it by exactly 1, so this is defense against a future
--     legitimate writer (a repair script, a batch reconcile) needing to jump the counter, not an
--     invitation to skip ahead.
--   • It does not touch INSERT. A brand-new row's starting version is `casUpsert`'s own concern
--     (it inserts at `version:1`); nothing here can be reached before a row exists.
--   • It does not repair or rewrite any existing row — purely a guard on future writes.
--   • It does not gate on `county` — `sites_normalize_county`'s own correction is a distinct,
--     narrower concern (one routing-key field, already self-correcting) and is left alone.

begin;

create or replace function public.sites_enforce_version_monotonic()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- A write that leaves the row's content untouched (soft delete/restore, the group_id
  -- backfill, a team-share/lock flip, …) carries no claim about freshness and is exempt —
  -- see the file header for why each of those paths deliberately does not bump version.
  if new.data is not distinct from old.data
     and new.site is not distinct from old.site
     and new.name is not distinct from old.name then
    return new;
  end if;

  if new.version > old.version then
    return new;
  end if;

  raise warning 'sites_enforce_version_monotonic: refused a non-advancing content write on site % (stored_version=%, attempted_version=%)',
    old.id, old.version, new.version;

  begin
    insert into public.client_errors (user_id, module, source, message)
    values (
      auth.uid(),
      'site-planner',
      'event:version-guard-refused',
      format('site=%s stored_version=%s attempted_version=%s', old.id, old.version, new.version)
    );
  exception when others then
    -- Telemetry must never be able to fail the write it is reporting on.
    raise warning 'sites_enforce_version_monotonic: telemetry insert failed: %', sqlerrm;
  end;

  return null;
end;
$$;

comment on function public.sites_enforce_version_monotonic() is
  'An UPDATE that changes public.sites content (data/site/name) must carry a version strictly '
  'greater than the row''s stored one, or it is refused (the row is left unchanged). Non-content '
  'writes (soft delete/restore, group_id backfill, team-share/lock flips) are exempt — see '
  'db/sites_version_monotonic_guard.sql for the production measurement and reasoning behind it.';

-- Name deliberately sorts before every other BEFORE UPDATE trigger already on this table
-- ("sites_enforce_…" < "sites_normalize_…" < "sites_preserve_…" < "sites_team_…") — see the
-- file header's "WHY THIS TRIGGER RUNS FIRST".
drop trigger if exists sites_enforce_version_monotonic on public.sites;
create trigger sites_enforce_version_monotonic
  before update on public.sites
  for each row execute function public.sites_enforce_version_monotonic();

commit;

-- Verification (run after):
--   select tgname from pg_trigger where tgrelid = 'public.sites'::regclass and not tgisinternal order by tgname;
--   -- sites_enforce_version_monotonic must sort first among the BEFORE UPDATE set.
-- Mutation proof: db/test/sites_version_monotonic_guard.test.sql (self-rolling-back; run it,
-- then `drop trigger sites_enforce_version_monotonic on public.sites;` and re-run — the content-
-- change cases must go RED; restoring this file must turn them green again).
