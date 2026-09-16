-- NEW-2 (2026-09-16) — public.sites.site (the COLUMN) is now a DATABASE-ENFORCED MIRROR of
-- data->>'site' (the jsonb), closing the first of the two duplicate copies B1584528 (2026-09-12)
-- named and deliberately left for a later session ("a name/group-key consolidation across every
-- mirror is real, open, unshipped work"). Run ONCE in the Supabase SQL editor (or via the
-- Supabase MCP). Idempotent; safe to re-run. ADDITIVE: adds one function and one trigger. Changes
-- no table, no column, no policy, and rewrites no existing row (none needed one — see below).
--
-- ============================================================================================
-- THE PREMISE, MEASURED 2026-09-16 (not reasoned about)
-- ============================================================================================
--   select count(*) as total_rows,
--     count(*) filter (where coalesce(nullif(btrim(site),''),null)
--                       is distinct from coalesce(nullif(btrim(data->>'site'),''),null)) as mismatches
--   from public.sites;
--     total_rows=135  mismatches=0
-- Every row already agrees. This migration does not need to correct a single row — it exists to
-- make the agreement a property of the schema instead of a property of every writer's discipline.
--
-- ⛔ WHICH COPY IS THE SURVIVOR, AND WHY — follows how the existing readers are actually written,
-- not aesthetics. Grepped every `.select(...)` this client issues against `public.sites`: the
-- PRIMARY hydration path the whole app runs on (`cloudSync.js`'s cloud-pull, `select("id, data,
-- version, team_id, user_id, share_locked")`) never selects the `site` column at all — every
-- in-memory Site Model's `.site` field comes from `data.site`, exclusively. The `site` COLUMN is
-- read only by a handful of narrow, column-list SELECTs that exist purely to avoid a jsonb
-- extraction in SQL (`dashboardSitesFetch.js`, `doc-review/lib/reviewStore.js`,
-- `cloudSync.listDeletedPlansInGroup`, `functions/api/mcp/_tools.js`) — none of them is a second
-- WRITER. So `data->>'site'` is what "the project's name" has always actually meant to this
-- codebase; `site` is a read-optimization that happened to also be independently writable, which
-- is the "too many sources of truth" the owner named on 2026-09-12.
--
-- ⛔ WHY A TRIGGER-MIRRORED COLUMN, NOT A `GENERATED ALWAYS AS (...) STORED` COLUMN — TESTED, NOT
-- ASSUMED, because the generated-column route looks obviously cleaner and is the wrong answer
-- here. Verified live (against a throwaway project, `zfrpznlpticjkjslfyyw`, never this database):
-- inside a BEFORE UPDATE trigger, `OLD.<generated column>` reads the correct prior value, but
-- `NEW.<generated column>` is NULL — Postgres computes a generated column's value AFTER every
-- BEFORE ROW trigger has run, so nothing fired earlier in the chain can see what it is about to
-- become. `sites_enforce_version_monotonic` (db/sites_version_monotonic_guard.sql) — explicitly
-- OFF LIMITS for this item — runs FIRST among this table's BEFORE UPDATE triggers and reads
-- `new.site is not distinct from old.site` to decide whether a write is content-changing and
-- therefore owes a strictly-greater `version`. Had `site` become generated, that read would
-- silently become `NULL is not distinct from old.site` — FALSE on every single UPDATE, including
-- the soft-delete/restore, `group_id` backfill and team-share/lock-flip paths that guard's own
-- header lists as DELIBERATELY version-exempt — and those would start being refused outright, a
-- production incident that CI could not catch (the guard's own SQL test file does not exercise a
-- generated `site` column, because none exists today). A generated column is therefore
-- incompatible with a trigger this item is instructed not to touch; a plain column kept in sync by
-- a NEW, separate trigger is not.
--
-- ⛔ WHY A NEW TRIGGER RATHER THAN EXTENDING `sites_preserve_rename_stamp` — that trigger already
-- reconciles `site`/`data.site` inside its own narrow "not a strictly-newer rename" branch (case 4
-- in db/test/sites_rename_stamp_guard.test.sql), but only there: a GENUINE newer rename (case 3)
-- returns immediately, trusting the caller to have written both copies together — which every
-- CURRENT writer does, but nothing enforces it for a future one, and neither BEFORE UPDATE trigger
-- runs on INSERT, so a brand-new row was completely unguarded against this specific mismatch.
-- Revisited rather than left unread (the item's own instruction): the two triggers do not compete
-- for authority over the SAME decision — `sites_preserve_rename_stamp` decides whether an incoming
-- name change is honored at all (an orthogonal question), and by construction ends every path with
-- `new.site`/`new.data.site` already equal (branch 4 forces them equal when it corrects; branch 3
-- trusts a caller that, for every existing writer, already sent them equal). This trigger's own
-- derivation is a no-op in both cases — it is pure defense-in-depth for writers that do not (yet,
-- or ever) keep the two copies in step, INSERT included, where nothing else in this table's trigger
-- set even looks at `site`.
--
-- WHY THIS IS A BEFORE TRIGGER RATHER THAN A CHECK CONSTRAINT — same reasoning as
-- `sites_normalize_county`/`sites_preserve_rename_stamp`: a CHECK would REJECT a write that merely
-- forgot to keep the column in step, turning a silent-but-harmless divergence into a hard save
-- failure. Correcting silently is the correct behaviour — the project's name is right either way,
-- the caller just no longer needs to have sent the same value twice.
--
-- TRIGGER ORDER (Postgres fires same-event ROW triggers in NAME order). Existing BEFORE UPDATE set,
-- confirmed live: sites_enforce_version_monotonic < sites_normalize_county < sites_preserve_rename_
-- stamp < sites_team_share_guard. `sites_site_column_mirror` sorts between `..._preserve_...` and
-- `..._team_...`, i.e. strictly AFTER `sites_enforce_version_monotonic` (so it can never affect what
-- that off-limits guard reads) and AFTER `sites_preserve_rename_stamp` (so it always sees that
-- trigger's own corrected `new.data`, never a value it is about to overwrite). Existing BEFORE
-- INSERT set: sites_normalize_county < sites_stamp_rename_on_insert; this trigger's name sorts
-- after both, for the same reason.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   • It never invents a name. If `new.data` has no `site` key at all (a shape that should not
--     exist — every Site Model always carries one — but is not assumed away here), the column is
--     left exactly as the statement proposed it, same as today.
--   • It does not touch `data` in the other direction — the jsonb is never corrected FROM the
--     column. `data->>'site'` is the one write surface every reader of this repo's own client model
--     already trusts; making the column authoritative in reverse would reintroduce a second source
--     of truth by the back door.
--   • It does not touch `group_id`/`data->>'groupId'` — a different axis, already tracked
--     separately (B1584528's own residual, `nameGroupIntegrity.groupKeyMismatch`), explicitly out
--     of this item's scope.

begin;

create or replace function public.sites_mirror_site_column()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.data is not null and jsonb_typeof(new.data) = 'object' and new.data ? 'site' then
    new.site := new.data ->> 'site';
  end if;
  return new;
end;
$$;

comment on function public.sites_mirror_site_column() is
  'Derives public.sites.site from data->>''site'' on every INSERT/UPDATE, so the column can never '
  'disagree with the jsonb copy the client model actually reads (NEW-2, 2026-09-16). Runs after '
  'sites_preserve_rename_stamp so it always sees that trigger''s own corrected data, and after '
  'sites_enforce_version_monotonic (never touched by this change) so that off-limits guard keeps '
  'reading new.site exactly as the caller proposed it.';

drop trigger if exists sites_site_column_mirror on public.sites;
create trigger sites_site_column_mirror
  before insert or update on public.sites
  for each row execute function public.sites_mirror_site_column();

commit;

-- Verification (run after):
--   select tgname from pg_trigger where tgrelid = 'public.sites'::regclass and not tgisinternal order by tgname;
--   -- sites_site_column_mirror must sort strictly after sites_enforce_version_monotonic and
--   -- sites_preserve_rename_stamp among the BEFORE UPDATE set.
--   select count(*) from public.sites
--    where coalesce(nullif(btrim(site),''),null) is distinct from coalesce(nullif(btrim(data->>'site'),''),null);
--   -- must read 0, forever — including rows written by any FUTURE caller that forgets to send `site`.
-- Mutation proof: db/test/sites_site_column_mirror.test.sql (self-rolling-back; run it, then
-- `drop trigger sites_site_column_mirror on public.sites;` and re-run — the column-only and
-- INSERT-time cases must FAIL. Restoring this file must turn them green again.)
