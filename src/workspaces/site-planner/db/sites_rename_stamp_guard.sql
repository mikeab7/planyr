-- ⛔ HARDENED 2026-09-12 (B1584512) — THE GUARD BELOW WAS BEATABLE TWO WAYS, BOTH REPRODUCED LIVE
-- IN A ROLLED-BACK PRODUCTION TRANSACTION. Read this block before the original NEW-1 header that
-- follows it — that header still explains why the guard exists at all, but its "WHAT THIS
-- DELIBERATELY DOES NOT DO" section is corrected in place below rather than left to mislead.
--
-- (a) OLDER STAMP WINS. The guard used to return early on "does NEW carry ANY real stamp" —
--     presence, not recency: `if rename_stamp(new...) is not null then return new`. A write
--     carrying a stamp of `1` (or any real-but-OLDER stamp) plus a stale name passed that check
--     outright and overwrote a row whose stored stamp was current. Fixed by comparing the incoming
--     stamp against the stored one and requiring it be STRICTLY newer — an equal or older stamp now
--     loses exactly like no stamp at all. This is a deliberate reversal of the original design note
--     ("it never enforces monotonicity between two real stamps") — see below for why that reasoning
--     no longer holds, and see `rename_site_group.sql`'s own 2026-09-12 correction for the
--     complementary fix that keeps this from turning into a false positive against a legitimate
--     group rename made from a device with a partial local cache.
-- (b) COLUMN-ONLY WRITES WERE UNGUARDED. The revert branch only fired when
--     `(new.data->>'site') is distinct from (old.data->>'site')` — a write that changed the `site`
--     COLUMN while leaving `data.site` untouched skipped it entirely, leaving the column and the
--     jsonb copy disagreeing about the project's name. Fixed by reasoning about the EFFECTIVE name
--     (whichever copy the row actually shows) rather than about which copy the incoming write
--     happened to touch, so the two can no longer be left disagreeing.
-- (c) `rename_stamp` ALSO ACCEPTED NUMERIC STRINGS AND ANY POSITIVE VALUE, so a marker of `"1"` (or
--     the number `1`) read as a "real" rename time — epoch-ms `1` is 1970-01-01T00:00:00.001Z, never
--     a genuine Planyr rename. Tightened to ONE representation (a JSON NUMBER — the only shape any
--     real writer here has ever produced; see `rename_site_group.sql` / the backfill file, both of
--     which write via `to_jsonb(bigint)`) and to a plausible EPOCH-MS RANGE (2024-01-01 through
--     2100-01-01) — comfortably below every real stamp on record (all ~2026) and comfortably above
--     zero, so a trivially small or malformed value now reads as UNKNOWN rather than as a stamp.
--     `(a)`'s strict-recency compare already closes the *specific* `"1"` exploit on its own (`1` is
--     never `> prior_at` for any row that has ever been renamed for real), but a value this
--     implausible should never parse as a stamp in the first place — defense in depth, not
--     decoration.
--
-- LOUD-FAILURE, closing the reason this took four rounds and a retraction to find: a refused or
-- reverted write used to return success with nothing to show for it. The guard now `RAISE WARNING`s
-- (visible in Postgres/Supabase logs) and records one row in `public.client_errors`
-- (`source = 'event:rename-guard-refused'`, the same telemetry sink `storage.js`'s
-- `project-name-write-corrected` client-side event already reports into — this is that event's
-- server-side twin, for writes that never went through `storage.js` at all) every time a write is
-- corrected, so the next instance of this class is visible the first time.
--
-- Every branch here is mutation-proven — see `db/test/sites_rename_stamp_guard.test.sql`, rewritten
-- alongside this fix with dedicated cases for both exploits, run live against `planyr_production`
-- in a rolled-back transaction, confirmed RED against the pre-fix function bodies and GREEN against
-- these.
--
-- ============================================================================================
-- ORIGINAL HEADER (NEW-1, 2026-09-10) FOLLOWS — still accurate on WHY this guard exists; its
-- "WHAT THIS DELIBERATELY DOES NOT DO" section below is corrected in place for the two claims the
-- exploits above disproved.
-- ============================================================================================
--
-- NEW-1 — THE PROJECT-RENAME MARKER MAY NEVER BE WRITTEN EMPTY.
-- Run ONCE in the Supabase SQL editor. Idempotent; safe to re-run. ADDITIVE: adds two functions
-- and one BEFORE UPDATE trigger. Changes no table, no column, no policy, and rewrites NO EXISTING
-- ROW (the repair for rows already damaged is a separate, deliberately un-run file — see
-- db/rename_stamp_backfill_20260910.sql).
--
-- ============================================================================================
-- THE BUG, MEASURED ON planyr_production 2026-09-10 (not reasoned about)
-- ============================================================================================
--   select case when not (data ? 'siteRenamedAt') then 'key-absent'
--               else jsonb_typeof(data->'siteRenamedAt') end, count(*)
--     from public.sites group by 1;
--
--     null        (the key IS present, and it is EMPTY)     64
--     number      (a real epoch-ms stamp)                   34
--     key-absent  (legacy — predates schema v13)            18
--
-- A key that is PRESENT and null is a WRITE. Nothing absent-by-default produces it. It came from
-- the ordinary client document push: `siteModel.createSiteModel` normalises an unknown marker to
-- an explicit `siteRenamedAt: null`, and `cloudSync.siteRowFor` sends the whole model as `data`,
-- which REPLACES the row's jsonb. So a device whose cached copy predated a rename overwrote that
-- rename's own stamp with an empty one.
--
-- IT IS NOT THEORETICAL. Group `smrp1wrgg6u5` — the Silvestri group this whole invariant was built
-- for — was renamed 2026-07-31T19:23:15.307Z. Four of its five live plans still carry that exact
-- stamp. Plan `sms9c5oc7jnt` carries JSON null with `updated_at` 2026-08-05T19:18:05Z, five days
-- AFTER the rename: a client document write erased a real timestamp. `projectName.nameAuthority`
-- then had nothing to compare — the stamped tier lost a voter and the group fell back to the
-- legacy majority rule, which is exactly the coin flip `siteRenamedAt` exists to replace.
--
-- ============================================================================================
-- WHY A SERVER-SIDE GUARD AND NOT ONLY THE CLIENT FIX
-- ============================================================================================
-- The client half shipped alongside this (`cloudSync.slimForCloud` now omits an unknown marker
-- rather than asserting null — `projectName.normalizeRenameStampForWrite`). That closes the
-- writer. It does NOT close the hole, for two reasons:
--   • The cloud write replaces the whole `data` jsonb, so OMITTING the key erases a real stamp
--     just as thoroughly as writing null did. Something at the row has to keep what the row
--     already knows.
--   • A browser tab can run a bundle for weeks (this repo's own chunk-recovery notes measure
--     exactly that). Every un-upgraded tab is still a live writer of empty markers.
-- The brief's own bar was "make an empty marker impossible rather than merely unlikely". Only a
-- rule at the row can say impossible.
--
-- ============================================================================================
-- THE RULE, IN ONE SENTENCE
-- ============================================================================================
-- An UPDATE that does not itself carry a real millisecond stamp may not clear a stamped row's
-- marker, and may not change that row's project NAME either.
--
-- The second half is not extra scope, it is what keeps the first half from backfiring. Preserving
-- the stamp alone would let an unstamped write land a STALE name on a row that now claims the
-- rename's own timestamp — and in a two-plan group that ties the stamped tier and hands the tie to
-- `updatedAt`, which the stale row wins. Refusing both together is the honest reading: the marker
-- and the name it stamps travel as one fact, and a write that carries neither is not a rename.
-- Every real rename path DOES carry a stamp (`rename_site_group`, its pre-migration document
-- fallback in `cloudRename.js`, and `reconcile_site_group_name`), and test/renameStampIntegrity.js
-- fails the build if that ever stops being true — so this refuses nothing legitimate.
--
-- A BEFORE trigger rather than a CHECK constraint, for the same reason db/sites_county_normalize.sql
-- gives: a CHECK would REJECT the write, turning a silent wrong answer into a hard save failure for
-- a user who was only editing their drawing. Correcting the write is the behaviour we actually
-- want, and the correction is VISIBLE in the product — the project keeps its real name — rather
-- than being a silent revert of something the user asked for. Nobody asked for this name change;
-- a stale client did.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   • It never STAMPS a row that has no stamp. Inventing `now()` for an unstamped write would let
--     a stale name win outright — the exact opposite of the fix.
--   • ⛔ CORRECTED 2026-09-12 (B1584512) — the bullet that stood here said "it never enforces
--     monotonicity between two real stamps … refusing it would freeze the project's name." That was
--     the exploited hole (exploit (a) above), not a safe design choice: `number → number` used to
--     pass untouched with NO recency check, so an older real stamp beat a newer one outright. It now
--     REQUIRES the incoming stamp be STRICTLY greater than the row's own stored stamp; an equal or
--     older one is refused exactly like no stamp at all. The "device with a partial cache" concern
--     that justified the old behaviour is real but is answered on the WRITE side instead, where it
--     belongs: `rename_site_group.sql`'s own 2026-09-12 correction computes the stamp it actually
--     writes as `greatest(caller's value, current max real stamp across the group + 1)`, read from
--     the group's own rows at call time rather than trusted from the caller — so the SANCTIONED
--     rename path can never lose a race against itself, while an unrelated write that merely CARRIES
--     an older real stamp (the actual exploit) is correctly refused here.
--   • It never touches `deleted_at`, `team_id`, `user_id` or `version`, and it does not care how a
--     group is keyed — it is strictly per-row, so it neither uses nor worsens the known
--     `group_id` column vs `data->>'groupId'` drift (filed separately, out of scope here).
--   • It does not force the `site` COLUMN to mirror `data->>'site'` in general, and that restraint
--     is MEASURED rather than cautious. Exactly one production row disagrees today
--     (`smrkumgymt65`: the column reads `I-10/HWY 90, TX` while the jsonb still holds the raw
--     `  I-10/HWY 90 , , TX`), and there the COLUMN is the better value — a blanket mirror rule
--     would push the uglier string into the name the owner actually sees. So the column is only
--     ever put back inside the one branch that refuses a non-newer rename, never on its own — as of
--     2026-09-12 that branch reasons about the EFFECTIVE name (`coalesce(old.site, old.data->>
--     'site')`) rather than about which of the two copies the incoming write happened to touch
--     (exploit (b) above), so a column-only write can no longer leave the two disagreeing.
--   • ⛔ CORRECTED 2026-09-12 (B1584512) — the bullet that stood here said this guard "cannot catch a
--     write that carries a STALE-BUT-REAL stamp alongside a stale name … refusing an older stamp
--     here would mean silently freezing the name of any device whose clock runs behind." As of this
--     date it DOES catch that write — that is exploit (a), and freezing a clock-skewed device's own
--     stale rename ATTEMPT is the correct outcome, not a worse one: the device's attempt carries no
--     evidence it is actually newer than what the row already holds, so refusing it and asking the
--     user to retry is safer than trusting an unverifiable claim. The B1440976 family (an ordinary,
--     non-rename SAVE from a device that merely has not pulled a rename made elsewhere) is a
--     DIFFERENT case from a rename ATTEMPT with a stale stamp, and remains correctly handled at the
--     PULL seam by `siteModel.mergeSiteContent` — unchanged by this correction.

begin;

-- ---------------------------------------------------------------------------
-- 1) The SQL mirror of the client's ONE parse (projectName.js `renameStamp`). A stable, immutable
--    function rather than an inline expression, so the trigger below, the backfill file, and any
--    future audit query provably ask the same question. Tolerates a stamp that arrived as a
--    numeric STRING (PostgREST hands `data->>'siteRenamedAt'` back as text, and some older writers
--    round-tripped it that way); everything else — absent, JSON null, a non-numeric string, zero
--    or negative — is UNKNOWN, which is NOT the same fact as "never renamed".
-- ---------------------------------------------------------------------------
create or replace function public.rename_stamp(v jsonb)
returns bigint
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  -- ⛔ HARDENED 2026-09-12 (B1584512) — ONE representation only (a JSON NUMBER; the numeric-STRING
  -- tolerance is gone — no real writer here has ever produced one, see the header) and a plausible
  -- EPOCH-MS RANGE (2024-01-01 through 2100-01-01 inclusive), so an implausible value like the
  -- number `1` reads as UNKNOWN rather than as a real rename time. The floor sits comfortably below
  -- every real stamp on record (all ~2026); the ceiling is a defensive backstop so a write can never
  -- plant a stamp no future genuine rename could ever beat.
  select case
    when v is null then null
    when jsonb_typeof(v) <> 'number' then null
    when (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) then null
    when (v #>> '{}')::numeric < 1704067200000 then null   -- 2024-01-01T00:00:00Z
    when (v #>> '{}')::numeric > 4102444800000 then null   -- 2100-01-01T00:00:00Z
    else (v #>> '{}')::numeric::bigint
  end;
$$;

comment on function public.rename_stamp(jsonb) is
  'Parse a project-rename marker (epoch ms) out of jsonb. Mirrors projectName.js renameStamp for '
  'the empty/absent cases; HARDENED 2026-09-12 (B1584512) to accept exactly ONE representation (a '
  'JSON number, integral, within a plausible epoch-ms range) — absent / JSON null / non-numeric / '
  'a numeric STRING / out-of-range all read as NULL = UNKNOWN, never as "never renamed" and never '
  'as a trivially-small fake stamp.';

-- ---------------------------------------------------------------------------
-- 2) The guard.
-- ---------------------------------------------------------------------------
create or replace function public.sites_preserve_rename_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  prior_at        bigint;
  new_at          bigint;
  eff_name        text;
  name_disagrees  boolean;
  stamp_disagrees boolean;
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then return new; end if;

  prior_at := public.rename_stamp(old.data -> 'siteRenamedAt');
  if prior_at is null then return new; end if;                        -- nothing to protect

  -- ⛔ HARDENED 2026-09-12 (B1584512, exploit (a)) — PRESENCE IS NOT RECENCY. The old guard passed
  -- any write that carried ANY real stamp, so an older (or equal) one beat a newer stored one. It
  -- must be STRICTLY greater than what the row already holds to count as a genuine rename; an equal
  -- stamp loses too, same as no stamp at all — see the file header for why enforcing this is now
  -- safe (rename_site_group.sql computes an authoritative, group-wide stamp on the write side).
  new_at := public.rename_stamp(new.data -> 'siteRenamedAt');
  if new_at is not null and new_at > prior_at then return new; end if; -- a genuine, strictly-newer rename

  -- Not a strictly-newer rename, so this write may neither move the name the stamp belongs to nor
  -- touch the stamp itself — whatever it carried (no stamp, an equal one, or an older one) and
  -- regardless of WHICH copy it tried to change. ⛔ HARDENED 2026-09-12 (B1584512, exploit (b)) —
  -- the old guard only reconciled the `site` COLUMN back inside a branch gated on the JSONB copy
  -- having changed, so a write that changed ONLY the column sailed through untouched. Reasoning
  -- about the EFFECTIVE name instead — whichever copy the row actually shows — means the two can
  -- never be left disagreeing no matter which one the caller touched.
  eff_name := coalesce(old.site, old.data ->> 'site');

  -- ⛔ THE OVERWHELMINGLY COMMON CASE THROUGH THIS BRANCH IS AN ORDINARY CONTENT SAVE MADE AFTER A
  -- ROW WAS ALREADY RENAMED, faithfully carrying the SAME name and SAME stamp forward — that write's
  -- own `new_at` is never `> prior_at` (it's equal), so it reaches this branch on every single save,
  -- not just an attack. Decide what to CORRECT (and whether to say anything) by comparing against
  -- what the write actually PROPOSED, not by re-deriving it from what we are about to force — an
  -- ordinary matching save must stay silent, or every post-rename autosave would warn and log.
  name_disagrees  := (new.site is distinct from eff_name) or ((new.data ->> 'site') is distinct from eff_name);
  stamp_disagrees := (new.data -> 'siteRenamedAt') is distinct from to_jsonb(prior_at);
  if not name_disagrees and not stamp_disagrees then
    return new;   -- nothing to correct: this write already agrees with the stamped state
  end if;

  if new.site is distinct from eff_name then new.site := eff_name; end if;
  if (new.data ->> 'site') is distinct from eff_name then
    new.data := jsonb_set(new.data, '{site}', to_jsonb(eff_name), true);
  end if;
  new.data := jsonb_set(new.data, '{siteRenamedAt}', to_jsonb(prior_at), true);

  -- LOUD-FAILURE (B1584512) — a refused/reverted write must be visible the first time, not the
  -- fifth. RAISE WARNING for immediate operational visibility (Supabase/Postgres logs), plus a
  -- durable row in the existing telemetry sink so it survives past log retention.
  raise warning 'sites_preserve_rename_stamp: refused a non-newer rename on site % (prior_at=%, attempted_at=%, kept_name=%)',
    old.id, prior_at, coalesce(new_at::text, '<none>'), eff_name;

  begin
    insert into public.client_errors (user_id, module, source, message)
    values (
      auth.uid(),
      'site-planner',
      'event:rename-guard-refused',
      format('site=%s prior_at=%s attempted_at=%s kept_name=%s',
             old.id, prior_at, coalesce(new_at::text, 'none'), eff_name)
    );
  exception when others then
    -- Telemetry must never be able to fail the write it is reporting on.
    raise warning 'sites_preserve_rename_stamp: telemetry insert failed: %', sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.sites_preserve_rename_stamp() is
  'An UPDATE that is not a STRICTLY newer rename (HARDENED 2026-09-12, B1584512 — presence alone '
  'used to be enough) may neither clear a stamped row''s marker nor change its project name, on '
  'EITHER the site column or the jsonb copy (B1584512 closed a column-only bypass). Every refusal '
  'raises a warning and logs to public.client_errors (event:rename-guard-refused). See '
  'db/sites_rename_stamp_guard.sql for the production measurement behind it.';

drop trigger if exists sites_preserve_rename_stamp on public.sites;
create trigger sites_preserve_rename_stamp
  before update on public.sites
  for each row execute function public.sites_preserve_rename_stamp();

commit;

-- Verification (run after):
--   select case when not (data ? 'siteRenamedAt') then 'key-absent'
--               else jsonb_typeof(data->'siteRenamedAt') end as marker, count(*)
--     from public.sites group by 1 order by 2 desc;
--   -- the 'null' bucket must never GROW again from here (existing rows are untouched by this file;
--   -- db/rename_stamp_backfill_20260910.sql is the separate, un-run repair for them).
