-- B1584832 ("NEW-2") — BACKFILL EVERY `public.sites` ROW THAT CARRIES NO VALID RENAME STAMP.
-- ⛔ ALREADY RUN against planyr_production 2026-09-12. OWNER-APPROVED (Michael, verbatim, 2026-09-12:
-- "Yes proceed with the backfill") — that approval covers ONLY seeding this one marker; nothing else
-- was touched. Kept here (idempotent, safe to re-run — it only ever writes a row whose OWN current
-- marker is unknown) as the audit trail and so a fresh environment (a new Supabase project, a branch)
-- gets the same repair without a human re-deriving it.
--
-- ============================================================================================
-- THE HOLE THIS CLOSES, MEASURED ON planyr_production 2026-09-12 (not reasoned about)
-- ============================================================================================
-- db/sites_rename_stamp_guard.sql's trigger opens with "if prior_at is null then return new" — a row
-- with no valid stamp has NO protection at all; the guard can only defend a stamp that is already
-- there. Before this ran:
--
--   select case when not (data ? 'siteRenamedAt') then 'key-absent'
--               when public.rename_stamp(data->'siteRenamedAt') is not null then 'valid-stamp'
--               else 'present-invalid' end, count(*)
--     from public.sites group by 1;
--
--     present-invalid (JSON null / non-numeric)     52
--     valid-stamp     (a real epoch-ms stamp)        37
--     key-absent      (no key at all)                36
--   -----------------------------------------------------
--     total                                         125     (88 of 125 unprotected)
--
-- The `present-invalid` rows are residue from the write path B1440976/NEW-1 already fixed (an
-- ordinary document push replacing the whole jsonb with an explicit `siteRenamedAt: null`), not rows
-- that were never renamed — the guard cannot tell the two apart, which is exactly the gap this fills.
--
-- ============================================================================================
-- THE RULE — two tiers, applied in one pass, NEVER a guess where a fact is already on record
-- ============================================================================================
-- Tier 1 (TRANSCRIPTION): if this row's own group (coalesce(data->>'groupId', id), matching every
--   other rename code path) has ANY live sibling carrying a real stamp, use the group's stamp. This is
--   the exact repair db/rename_stamp_backfill_20260910.sql proposed for the one Silvestri row it found
--   (`sms9c5oc7jnt`, group `smrp1wrgg6u5`) — restoring a fact the database already holds elsewhere,
--   never inventing one. Measured 2026-09-12: exactly ONE row still qualifies, and it is that same row
--   with that same value (1785525795307) — the 2010910 file's proposal is folded into this pass rather
--   than run separately, so there is one backfill, not two that could disagree.
-- Tier 2 (OWN updated_at, for the other 87): where no sibling anywhere holds a real stamp, there is no
--   recorded rename to restore — the group is correctly served today by `nameAuthority`'s legacy
--   majority tier and has no "when" to recover. Per the NEW-2 dispatch brief: seed from the row's OWN
--   `updated_at`, converted to epoch milliseconds. A row's `updated_at` is always AT LEAST as old as any
--   genuine rename that produced its current `data.site` (nothing writes `site` without also touching
--   `updated_at`), so this can only ever make a FUTURE stale write lose on recency — never fabricate a
--   rename time that predates the name the row already carries.
--
-- ============================================================================================
-- ⛔ THE CLOCK-SKEW HAZARD THE DISPATCH FLAGGED — READ BEFORE CHANGING THE SEED RULE
-- ============================================================================================
-- NEW-1 (a concurrent session) is changing `sites_preserve_rename_stamp` from a presence test to a
-- RECENCY comparison. Under a recency guard, seeding every row from `updated_at` means a genuinely
-- later rename from a device whose clock runs BEHIND the server could carry a stamp OLDER than this
-- backfill's seed and lose — reproducing the owner's original symptom for that one user, silently.
-- That hazard is real and is NOT closed by this file. It is closed only by making `rename_site_group`
-- stamp `p_renamed_at` server-side (`now()`) instead of trusting the client's clock — which removes the
-- client clock as a source of truth entirely. That is deliberately NOT done here: `rename_site_group`
-- is the live PRIMARY rename path (B1568880) that every real user's rename goes through right now, its
-- own client half stamps `renameSiteGroup` synchronously into LOCAL storage with the SAME value it then
-- sends to the RPC ("ONE stamp for the whole rename" — storage.js's own header), and switching the RPC
-- to mint its own timestamp would desynchronize that local/cloud pair for every rename made under it —
-- a real behavior change to the live write path, not a data repair, and it deserves its own scoped
-- change with its own tests rather than riding in on a backfill. Filed loudly, not silently: see
-- B1584833 in BACKLOG.md ("rename_site_group trusts the client's clock for its own recency stamp").
--
-- ============================================================================================
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
-- ============================================================================================
--   • `site` / `data->>'site'` (no name is changed — every write here is `data.siteRenamedAt` only).
--   • `updated_at` (the CAS input the client's optimistic-concurrency layer compares against — bumping
--     it would hand every open tab a spurious "changed in another session" conflict on a field the user
--     never touched; same reasoning db/sites_county_normalize.sql and db/rename_stamp_backfill_20260910.sql give).
--   • `version` (same reasoning).
--   • `deleted_at` — this pass runs over EVERY row, trashed included. A soft-deleted row is still a live
--     target of the trigger on any future UPDATE (a restore-and-edit), and a lost stamp on a trashed row
--     is exactly as unprotected as one on a live row; there is no reason to leave 39 of the 88 (measured:
--     31 present-invalid + 8 key-absent) permanently unguarded.
--
-- Verification (run after) — the census above must show ONLY `valid-stamp`, at the SAME total row count:
--   select case when not (data ? 'siteRenamedAt') then 'key-absent'
--               when public.rename_stamp(data->'siteRenamedAt') is not null then 'valid-stamp'
--               else 'present-invalid' end, count(*)
--     from public.sites group by 1;
--   -- run 2026-09-12: {"valid-stamp": 125} — zero present-invalid, zero key-absent.

begin;

-- Full pre-image, in the style of the existing recovery_* tables (site_role_unify_backfill_20260905.sql,
-- library_upload_orphan_backfill_20260905.sql). 125 rows — cheap, kept for as long as this file's own
-- history matters.
create table if not exists public.recovery_20260912_sites_rename_stamp_snapshot as table public.sites;

with group_stamp as (
  select coalesce(data->>'groupId', id) as grp,
         max(public.rename_stamp(data->'siteRenamedAt')) as at
    from public.sites
   where deleted_at is null
   group by 1
  having max(public.rename_stamp(data->'siteRenamedAt')) is not null
)
update public.sites s
   set data = jsonb_set(
                 s.data,
                 '{siteRenamedAt}',
                 to_jsonb(
                   coalesce(
                     g.at,                                                   -- Tier 1: transcribed
                     floor(extract(epoch from s.updated_at) * 1000)::bigint  -- Tier 2: this row's own
                   )
                 ),
                 true
               )
  from (select id, coalesce(data->>'groupId', id) as grp from public.sites) idx
  left join group_stamp g on g.grp = idx.grp
 where s.id = idx.id
   and public.rename_stamp(s.data->'siteRenamedAt') is null;

commit;

-- ⛔ THE TRIGGER DOES NOT BLOCK THIS, by design: every write above carries a real numeric stamp, so
-- `sites_preserve_rename_stamp` passes it straight through (same as the 20260910 file's own note).
--
-- RESULT, run 2026-09-12 against planyr_production (lyeqzkuiwngunutlkkmi):
--   before: valid-stamp 37 · present-invalid 52 · key-absent 36   (88 of 125 unprotected)
--   after:  valid-stamp 125                                       (0 of 125 unprotected)
--   snapshot rows: 125 (matches live row count — nothing added or removed, only `data.siteRenamedAt` written)
--   the one Tier-1 (transcribed) row: sms9c5oc7jnt (group smrp1wrgg6u5, "Silvestri") → 1785525795307
--   the other 87: Tier-2, each row's own `updated_at`
--
-- LIVE-VERIFIED THE SAME SESSION, on a throwaway row (id `test_b_new2_throwaway`, under the dedicated
-- `e2e@planyr.test` account — never one of Michael's real plans), created and hard-deleted within this
-- session: three consecutive `rename_site_group` calls ("First Rename" → "Second Rename" → "Third
-- Rename"), each read back with a fresh, independent SELECT (the DB equivalent of a reload) showing the
-- new name, a fresh numeric stamp, and an incremented `version` every time. The rename path this backfill
-- runs alongside is unaffected by it.
