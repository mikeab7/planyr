-- Comps — fix the schema hazard where deleting a site_plan_overlays row while a comp is still
-- pinned to it aborts the whole DELETE transaction (B1114992, adversarial review "NEW-5"). Run
-- once in the Supabase SQL editor AFTER comps_site_plan_anchor.sql and
-- site_plan_overlays_soft_delete_version_and_review_visibility.sql. Idempotent.
--
-- ROOT CAUSE (confirmed live against production, `db/test/site_plan_overlays_delete_with_pinned_comp.test.sql`):
-- `comps_site_plan_overlay_id_fkey` is `ON DELETE SET NULL` — when an overlay row is deleted,
-- Postgres tries to null out `site_plan_overlay_id` on every comp still pinned to it.
-- `comps_parcel_anchor_has_identity` (comps_site_plan_anchor.sql) requires that column to be
-- NOT NULL whenever `anchor_kind = 'site_plan'`. The FK's own cleanup action writes exactly the
-- value the CHECK forbids, so the DELETE aborts mid-transaction — and because it's a genuine
-- Postgres abort, anything batched with it (a bulk delete, a larger transaction) fails too.
--
-- DECISION (see BACKLOG.md B1114992 for the full writeup — one of three candidates, this one
-- chosen and justified there): a comp SURVIVES the deletion of the plan it's pinned to, and
-- reverts to a plain 'pin' anchor at its already-current lat/lon. `comps.lat`/`comps.lon` are
-- NOT NULL on every comp and are kept current for a 'site_plan' anchor by every placement move
-- (`commit_site_plan_overlay_placement`, site_plan_overlays_comp_sync.sql) — so they are always
-- a valid, up-to-date fallback location, never a stale one. The comp is never soft-deleted
-- alongside the plan, and the delete is never refused for having comps pinned to it — replacing
-- the app-level `blockedByPinnedComps` proactive block (SitePlansSection.jsx,
-- B972512-HARDENING item 5), which contradicted the row's own confirm-dialog copy ("Comps pinned
-- to it keep their location but lose the link back") by refusing the delete outright instead.
--
-- MECHANISM: a BEFORE DELETE trigger on site_plan_overlays does the multi-column flip
-- (anchor_kind + site_plan_overlay_id + site_plan_point) in ONE UPDATE, atomically, for every
-- comp referencing the row about to be deleted — so comps_parcel_anchor_has_identity never sees
-- an intermediate state that violates it. SECURITY DEFINER is required (not optional): comps'
-- own UPDATE policy is owner-only, and a comp pinned to a shared overlay is routinely owned by a
-- teammate, not the person deleting the plan (the same cross-owner problem
-- site_plan_overlays_comp_sync.sql's header names for the placement-move recompute). The FK's
-- action is changed from SET NULL to NO ACTION (Postgres's default): if the trigger ever failed
-- to clear every reference (a bug, a future schema change it doesn't know about), NO ACTION
-- surfaces a plain, honest "still referenced" foreign-key error instead of SET NULL silently
-- re-triggering the exact CHECK-violation abort this migration exists to fix.
--
-- SOFT DELETE TOO, not just the hard one: the trigger only fires on a real DELETE, but the
-- app's ordinary "Delete site plan…" action is a SOFT delete (an UPDATE stamping `deleted_at`,
-- site_plan_overlays_soft_delete_version_and_review_visibility.sql) and never fires a DELETE
-- trigger at all. Its own confirm-dialog copy already promises pinned comps "lose the link
-- back," so `soft_delete_site_plan_overlay` below does the identical comp-detach UPDATE inline,
-- in the same function as the `deleted_at` stamp — one atomic operation, not two writes a client
-- crash could split. This is a deliberate, permanent detach (matching the promised copy): restoring
-- a soft-deleted overlay via `restoreOverlay` brings the PLAN back, never the comp's link to it —
-- the link is stated as lost, not hidden, the moment "Delete site plan…" is confirmed.

create or replace function public.comps_detach_from_deleted_site_plan_overlay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comps
  set anchor_kind = case when anchor_kind = 'site_plan' then 'pin' else anchor_kind end,
      site_plan_overlay_id = null,
      site_plan_point = null
  where site_plan_overlay_id = old.id;
  return old;
end;
$$;
revoke all on function public.comps_detach_from_deleted_site_plan_overlay() from public;
revoke all on function public.comps_detach_from_deleted_site_plan_overlay() from anon;
revoke all on function public.comps_detach_from_deleted_site_plan_overlay() from authenticated;

drop trigger if exists site_plan_overlays_detach_comps on public.site_plan_overlays;
create trigger site_plan_overlays_detach_comps
  before delete on public.site_plan_overlays
  for each row execute function public.comps_detach_from_deleted_site_plan_overlay();

alter table public.comps drop constraint if exists comps_site_plan_overlay_id_fkey;
alter table public.comps add constraint comps_site_plan_overlay_id_fkey
  foreign key (site_plan_overlay_id) references public.site_plan_overlays(id); -- default action: NO ACTION

-- `soft_delete_site_plan_overlay` — the RPC `sitePlanOverlayStore.deleteOverlay` now calls
-- instead of a plain client-side `.update({deleted_at})`. Ownership-checked exactly like the
-- existing `update own site plan overlays` RLS policy (`user_id = auth.uid()`), since SECURITY
-- DEFINER bypasses that policy inside the function body. Returns nothing on success; raises
-- 42501 if the overlay isn't the caller's or is already gone.
create or replace function public.soft_delete_site_plan_overlay(p_overlay_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ok integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  update public.site_plan_overlays
    set deleted_at = now()
    where id = p_overlay_id and user_id = v_uid and deleted_at is null;
  get diagnostics v_ok = row_count;
  if v_ok = 0 then
    raise exception 'Not deleted — you can only remove site plans you uploaded' using errcode = '42501';
  end if;

  update public.comps
  set anchor_kind = case when anchor_kind = 'site_plan' then 'pin' else anchor_kind end,
      site_plan_overlay_id = null,
      site_plan_point = null
  where site_plan_overlay_id = p_overlay_id;
end;
$$;
revoke all on function public.soft_delete_site_plan_overlay(uuid) from public;
revoke all on function public.soft_delete_site_plan_overlay(uuid) from anon;
grant execute on function public.soft_delete_site_plan_overlay(uuid) to authenticated;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.site_plan_overlays'::regclass and not tgisinternal;
--     -- expect site_plan_overlays_detach_comps, O(rigin=enabled), alongside site_plan_overlays_touch
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'comps_site_plan_overlay_id_fkey';
--     -- expect no "ON DELETE SET NULL" clause (NO ACTION is the implicit default, printed bare)
--   select proname, prosecdef from pg_proc where proname in
--     ('comps_detach_from_deleted_site_plan_overlay', 'soft_delete_site_plan_overlay'); -- prosecdef = true for both
