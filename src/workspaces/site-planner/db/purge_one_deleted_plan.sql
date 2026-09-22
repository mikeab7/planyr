-- B1767168 — permanently purge exactly ONE soft-deleted plan out of an otherwise-LIVE project
-- (a project is a `sites` GROUP — `coalesce(data->>'groupId', id)` — sharing several plan rows).
-- Run ONCE in the Supabase SQL editor, AFTER db/sites_block_delete_live_group.sql. Idempotent;
-- safe to re-run. ADDITIVE: adds one function; changes no table, no column and no policy.
--
-- ============================================================================================
-- THE BUG THIS CLOSES
-- ============================================================================================
-- Owner report 2026-09-18: the ✕ beside a RECENTLY DELETED row in the plan menu (SitePlanner.jsx's
-- own per-project plan trash — see storage.js's `listDeletedPlansInGroup` header) arms, the click
-- runs, and the row never disappears — every time, on every plan that surface can even show. That
-- is not a broken control: `handlePurgeDeletedPlan` → `purgeDeletedProject([p.id], groupId)` →
-- `cloudHardDelete` → `sites_block_delete_live_group`'s BEFORE DELETE trigger (B1517888) raises
-- 'PLYR1', and `cloudSync.js` maps that straight to the toast the owner sees. The refusal is
-- UNCONDITIONAL for this one surface BY CONSTRUCTION: the plan menu is only ever reachable while a
-- LIVE sibling in the same group is the open plan, so the trigger's "does a live sibling remain"
-- test can never pass from here — it was built to protect exactly the opposite case (a stale tab's
-- unattended 30-day sweep reaching into an active project, B1517888's own incident) and correctly
-- refuses every deliberate single-plan purge too, because it cannot tell the two apart.
-- `sites_block_delete_live_group.sql`'s own header named this outcome as "a distinct, deliberate
-- follow-up feature — not built here." This file is that feature.
--
-- ============================================================================================
-- WHY A NEW RPC, NOT A LOOSENED TRIGGER
-- ============================================================================================
-- The trigger is the ONLY server-side backstop against a stale client vintage running the
-- pre-B1469872 unguarded 30-day sweep (see that incident). Narrowing or removing its predicate —
-- or letting a plain `DELETE` of a soft-deleted row in a live group succeed unconditionally — would
-- reopen that hole for every client, including a tab loaded days ago that has no idea this feature
-- exists. So the trigger's default stays exactly as strict as it was; this adds ONE deliberate,
-- narrowly-scoped door through it, reachable only by calling this function.
--
-- ============================================================================================
-- SECURITY — SECURITY DEFINER, WITH THE DELETE RLS POLICY'S OWN PREDICATE RE-IMPLEMENTED BY HAND
-- ============================================================================================
-- `rename_site_group()` and `set_site_group_role()` are SECURITY INVOKER, deliberately, because
-- they lean on the existing UPDATE RLS policy to decide who may act — the right shape when RLS
-- already permits exactly the write being made. This function is different: it does not merely
-- perform a permitted write, it also has to SIGNAL the trigger (via a transaction-local
-- `set_config`) that this ONE delete may bypass a refusal RLS has nothing to do with. A
-- SECURITY DEFINER function runs as its owning role, which is exempt from RLS by default — so it
-- must re-implement, explicitly, the exact predicate `team_sharing.sql`'s
-- "delete own or team-admin sites" policy already enforces (`user_id = auth.uid() OR
-- (team_id is not null AND is_team_admin(team_id))`), rather than relying on it. That check runs
-- FIRST, before anything else in this function, and a caller who fails it gets the same refusal an
-- ordinary RLS-blocked DELETE would have produced — just as a raised exception instead of a silent
-- zero-row no-op (LOUD-FAILURE; a SECURITY DEFINER function that let RLS filter its own internal
-- DELETE would instead read as "nothing matched", which is exactly the silent failure this codebase
-- keeps a named rule against).
--
-- `search_path` is pinned so the function body can't be redirected by a caller's search_path.
--
-- ============================================================================================
-- THE THREE PRECONDITIONS — ALL MUST HOLD, CHECKED IN THIS ORDER, EACH NAMED IN ITS OWN RAISE
-- ============================================================================================
--   0. The caller is actually signed in (auth.uid() is not null) — see the
--      "B<PENDING> — THE NULL-AUTH HOLE" section below. Checked before precondition 1, because
--      precondition 1's own disjunction cannot detect this case by itself.
--   1. The row exists and the caller owns it under the SAME rule the DELETE RLS policy uses.
--   2. `deleted_at is not null` — this function purges from the trash, never a live row (the base
--      trigger's own belt-and-suspenders case already asks this too; asking it here as well means
--      a caller gets this function's own clearer message rather than falling through to the
--      trigger's generic one).
--   3. At least one LIVE (deleted_at IS NULL) sibling remains in the row's group AFTER the delete —
--      which, since this row is already soft-deleted, is simply "does the group have a live member
--      other than this row, right now". This is the one that makes the feature SAFE: a group with
--      no live sibling means this row is the project's last plan (or the group is already fully
--      dead), and destroying it here would destroy the whole project — exactly what the EXISTING
--      whole-project "Delete forever" path (`purgeDeletedProject` with no live-group guard to pass,
--      because there IS no live sibling) already handles correctly. This function refuses rather
--      than duplicate that path, so there is exactly one way to destroy a whole project and exactly
--      one way to destroy one dead plan out of a live one, and they can never trade places.
--
-- Any failure here raises with errcode 'PLYR2' (distinct from the base trigger's 'PLYR1', so a
-- caller — or telemetry — can tell "this function's own precondition failed" from "the trigger's
-- unconditional refusal fired anyway", e.g. under a race where a concurrent restore removes the
-- last live sibling between this function's check and its DELETE). FAIL-SAFE: every check runs
-- inside the same transaction as the DELETE it gates, so an inconclusive read aborts the whole
-- statement rather than falling through to a destructive default.
--
-- ============================================================================================
-- B<PENDING> — THE NULL-AUTH HOLE (found by the 2026-09-19 daily data-risk sweep, re-proved
-- 2026-09-20; fixed same day). READ BEFORE TOUCHING PRECONDITION 1 AGAIN.
-- ============================================================================================
-- Precondition 1 originally read `auth.uid()` INLINE, three times, inside the disjunction:
--   if not ( v_row.user_id = auth.uid() or (v_row.team_id is not null and is_team_admin(...)) )
-- With no JWT, `auth.uid()` is NULL. `v_row.user_id = NULL` is SQL NULL, not false, and Postgres's
-- three-valued logic makes the whole `or` chain NULL too (a null team_id path evaluates to NULL as
-- well, so there is no way for the disjunction to land on a definite FALSE here). plpgsql's
-- `if not (NULL) then` treats NULL as "don't run the body" — same as `if false` — so the refusal
-- silently never fired. Nothing else here checks the caller's identity: this function is
-- SECURITY DEFINER (runs as its owner, RLS does not apply — see this file's own SECURITY section
-- above), so a request with no `Authorization` header at all sailed straight through precondition
-- 1, straight past precondition 2 (a real soft-deleted row satisfies it) and precondition 3
-- (a real live sibling satisfies it), into a genuine, permanent DELETE — and
-- `site_elements_site_id_fkey` is `ON DELETE CASCADE`, so the plan's elements went with it.
-- Measured against production 2026-09-19 (`lyeqzkuiwngunutlkkmi`), inside a `DO` block that
-- re-raises so the statement rolls back: `set local role anon;` with no
-- `request.jwt.claims` set, then `select id from public.purge_one_deleted_plan('smsdrvzr9gzx')`
-- returned `PURGED` and deleted Richfield's anchor row plus its 243 `site_elements` rows before the
-- rollback discarded it. A SIGNED-IN NON-OWNER is correctly refused (precondition 1's disjunction
-- lands on a definite FALSE once `auth.uid()` is a real, non-matching uuid) — this is specifically
-- the missing-JWT path, not a flaw in the ownership rule itself.
-- Compounding it: the deployed grantees on this function were `PUBLIC, anon, authenticated,
-- postgres, service_role` — wider than this file, which only ever granted `authenticated`
-- (Supabase's default privileges hand EXECUTE to PUBLIC, hence anon, on a newly created function
-- unless a migration explicitly revokes it — nothing here did until now).
-- THE FIX, two independent layers (defense in depth — ship both, not either):
--   (a) hoist `auth.uid()` into `v_uid` and refuse `v_uid is null` EXPLICITLY, before precondition
--       1's ownership disjunction ever runs — the same shape `set_plan_lock` (team_share_default.sql),
--       `soft_delete_site_plan_overlay` (comps_site_plan_overlay_delete_reverts_to_pin.sql) and
--       every other owner-checking SECURITY DEFINER function in this codebase already uses;
--   (b) `revoke execute ... from anon` below, so even a future regression of (a) is not
--       anon-reachable at all.
-- Guard: `src/workspaces/site-planner/db/test/sites_block_delete_live_group.test.sql` case 10
-- (anon role, no `request.jwt.claims` at all, against a live-group row — must raise and the row
-- must still exist afterward).
--
-- ============================================================================================
-- WHAT THIS FUNCTION DELIBERATELY DOES NOT DO
-- ============================================================================================
-- It deletes exactly the ONE named `sites` row — `site_elements_site_id_fkey`'s ON DELETE CASCADE
-- correctly takes that row's own element rows with it, the same as any other permanent plan
-- deletion — and nothing group-scoped. It does NOT touch `project_folders`, a Drive folder tree, or
-- `doc_reviews` filing: those belong to the project's shared identity, and this project is, by the
-- third precondition above, still very much alive. The client caller (storage.js's
-- `purgeOnePlanFromLiveGroup`, NOT `purgeDeletedProject`) must not run `purgeProjectFoldersFor` /
-- `unfileReviewsForDeletedProject` on this path either — see that function's own header.

create or replace function public.purge_one_deleted_plan(p_id text)
returns table (id text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_row     public.sites%rowtype;
  v_gkey    text;
  v_live_id text;
begin
  if p_id is null or p_id = '' then
    raise exception 'purge_one_deleted_plan: p_id is required' using errcode = 'PLYR2';
  end if;

  -- Precondition 0 — the caller must actually be signed in. See "THE NULL-AUTH HOLE" above: with
  -- no JWT, auth.uid() is NULL, and NULL = anything is NULL rather than false, so precondition 1's
  -- disjunction below could never land on a definite refusal without this explicit check first.
  if v_uid is null then
    raise exception 'purge_one_deleted_plan: not signed in' using errcode = 'PLYR2';
  end if;

  select * into v_row from public.sites s where s.id = p_id;
  if not found then
    raise exception 'purge_one_deleted_plan: no such plan %', p_id using errcode = 'PLYR2';
  end if;

  -- Precondition 1 — the SAME predicate team_sharing.sql's "delete own or team-admin sites" RLS
  -- policy enforces on an ordinary DELETE. Re-implemented explicitly because SECURITY DEFINER runs
  -- exempt from RLS — see this file's header. v_uid is guaranteed non-null here (precondition 0).
  if not (
    v_row.user_id = v_uid
    or (v_row.team_id is not null and public.is_team_admin(v_row.team_id))
  ) then
    raise exception 'purge_one_deleted_plan: not permitted to delete %', p_id using errcode = 'PLYR2';
  end if;

  -- Precondition 2 — this function purges from the trash only.
  if v_row.deleted_at is null then
    raise exception 'purge_one_deleted_plan: % is not in the trash (deleted_at is null)', p_id
      using errcode = 'PLYR2';
  end if;

  -- Precondition 3 — a live sibling must survive, so this can never destroy a whole project.
  v_gkey := coalesce(v_row.data->>'groupId', v_row.id);
  select s.id into v_live_id
    from public.sites s
   where coalesce(s.data->>'groupId', s.id) = v_gkey
     and s.id <> p_id
     and s.deleted_at is null
   limit 1;

  if v_live_id is null then
    raise exception 'purge_one_deleted_plan: refusing — % has no live sibling in group % (that would destroy the whole project; use the account-wide "Delete forever" for a fully-dead project instead)', p_id, v_gkey
      using errcode = 'PLYR2';
  end if;

  -- All three preconditions hold. Signal the base trigger to stand down for exactly this row, for
  -- exactly this transaction, then perform the real delete through the ordinary DELETE path so
  -- every other trigger/cascade on public.sites still fires normally.
  perform set_config('planyr.single_plan_purge', p_id, true);

  return query
  delete from public.sites s where s.id = p_id returning s.id;
end;
$$;

comment on function public.purge_one_deleted_plan(text) is
  'Permanently purge exactly ONE soft-deleted plan out of an otherwise-live project (B1767168). '
  'SECURITY DEFINER — requires a signed-in caller, re-implements the "delete own or team-admin '
  'sites" RLS predicate by hand (see header), then requires deleted_at is not null and that a live '
  'sibling survives in the same group before signalling sites_block_delete_live_group to stand '
  'down for this one row. Raises errcode PLYR2 on any precondition failure (incl. no auth.uid()); '
  'never destroys a whole project.';

-- B<PENDING> — defense in depth, independent of the NULL-auth fix above: even if precondition 0
-- ever regresses, anon cannot reach this function at all. Supabase's default privileges grant
-- EXECUTE to PUBLIC (and therefore anon) on a newly created function unless explicitly revoked —
-- this is what left the deployed grantees as PUBLIC, anon, authenticated, postgres, service_role
-- despite this file only ever granting `authenticated` below. Revoke first, then re-grant, so
-- re-running this file is idempotent and always ends in the same state regardless of what a prior
-- version left behind.
revoke execute on function public.purge_one_deleted_plan(text) from public, anon;
grant execute on function public.purge_one_deleted_plan(text) to authenticated;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select proname, prokind, provolatile, prosecdef from pg_proc where proname = 'purge_one_deleted_plan';
--     -- expect 1 row, prokind='f' (function), prosecdef=true (SECURITY DEFINER)
--   select pg_get_functiondef(oid) from pg_proc where proname = 'purge_one_deleted_plan';
--     -- expect `language plpgsql`, precondition 0 (v_uid is null) ahead of all three preconditions
--   select grantee, privilege_type from information_schema.routine_privileges
--     where routine_name = 'purge_one_deleted_plan';
--     -- expect ONLY authenticated (plus the routine owner) — never anon or PUBLIC
--
-- Verification (run after): db/test/sites_block_delete_live_group.test.sql — self-rolling-back,
-- exercises this function against a real live-group fixture, a real last-member-of-its-group
-- fixture, a non-owner caller, and an anon (no-JWT) caller (cases 6-10), alongside the base
-- trigger's own six cases.
