-- Site-plan overlays: soft delete (item 6), revision guard (item 7), and derived doc_reviews
-- visibility (new finding 3, corrected) — B972512-HARDENING. Run once in the Supabase SQL
-- editor AFTER site_plan_overlays.sql. Idempotent.

-- ---- Item 6: soft delete, mirroring sites.deleted_at / doc_reviews.deleted_at ------------------
-- A "Delete site plan…" no longer permanently destroys the row — it stamps `deleted_at`, drops
-- out of the ordinary list (fetchAllOverlays), and stays recoverable via a "Recently deleted"
-- trash view (restoreOverlay) for as long as it's left there — there's no lazy auto-purge job
-- for this table yet (unlike doc_reviews' 30-day sweep); "Delete forever" in that trash view is
-- the only way to permanently remove a row, and it's still subject to the SAME comp-reference
-- guard as the soft delete (see comps_parcel_anchor_has_identity in comps_site_plan_anchor.sql —
-- the constraint doesn't care which path reached it).
alter table public.site_plan_overlays add column if not exists deleted_at timestamptz;

create index if not exists site_plan_overlays_deleted_at_idx
  on public.site_plan_overlays (user_id, deleted_at)
  where deleted_at is not null;
create index if not exists site_plan_overlays_live_created_at_idx
  on public.site_plan_overlays (user_id, created_at desc)
  where deleted_at is null;

-- ---- Item 7: revision guard, mirroring sites.version / doc_reviews.version ---------------------
-- Optimistic concurrency (shared/cloud/optimisticUpsert.js's casUpsert, the same primitive
-- sites/doc_reviews use) for ordinary field edits (opacity/visible/locked/doc_title/etc. via
-- sitePlanOverlayStore.updateOverlay), and a matching version guard baked directly into
-- commit_site_plan_overlay_placement (site_plan_overlays_comp_sync.sql) for the placement-drag
-- commit path — two live sessions on the same plan (the owner's own stated common case: "3
-- here") can no longer silently last-write-wins over each other with zero signal.
alter table public.site_plan_overlays add column if not exists version integer not null default 1;

-- ---- New finding 3 (CORRECTED direction) — doc_reviews visibility DERIVES from a shared -------
-- ---- overlay, rather than forcing the two team_id columns to always be equal ------------------
-- `site_plan_overlays.team_id` is the ONE deliberate, user-facing sharing choice for this
-- feature (SitePlansSection.jsx's upload-flow team picker) — `doc_reviews.team_id` is left null
-- by fileNewReview and was never meant to drive or be driven by it. An EARLIER version of this
-- migration tried forcing them to mirror each other with a trigger and got the direction wrong
-- (it silently discarded the user's chosen team on every overlay insert) — caught live before
-- shipping, see the corrective migration's own note. Forcing exact equality also breaks down the
-- moment one review backs SEVERAL overlays shared with DIFFERENT teams (the schema explicitly
-- allows this — "one brochure can carry several overlay pages"), since a single doc_reviews.team_id
-- can't simultaneously equal two different values.
--
-- So instead: a teammate who can already see an overlay (via ITS OWN team_id — the existing
-- site_plan_overlays SELECT policy) can now also open the document it was built from ("Open
-- source brochure" in MapFinder.jsx), without doc_reviews.team_id needing to independently
-- agree. This is purely ADDITIVE to doc_reviews' own existing team-sharing feature (its
-- "select own or team reviews" policy, keyed on doc_reviews.team_id, is untouched) — it only
-- ever WIDENS visibility, and only for a review some overlay the caller can already see is
-- built from. The two team_id values can no longer "diverge" in any way that matters, because
-- nothing depends on them being equal any more.
create or replace function public.can_read_review_via_site_plan_overlay(p_review_id text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.site_plan_overlays o
    where o.review_id = p_review_id
      and o.team_id is not null
      and public.is_team_member(o.team_id)
  );
$$;
revoke all on function public.can_read_review_via_site_plan_overlay(text) from public;
revoke all on function public.can_read_review_via_site_plan_overlay(text) from anon;
grant execute on function public.can_read_review_via_site_plan_overlay(text) to authenticated;

drop policy if exists "Team reads reviews via a shared site plan overlay" on public.doc_reviews;
create policy "Team reads reviews via a shared site plan overlay" on public.doc_reviews
  for select to authenticated
  using ( public.can_read_review_via_site_plan_overlay(id) );

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns where table_name = 'site_plan_overlays'
--     and column_name in ('deleted_at', 'version');   -- expect 2 rows
--   select policyname from pg_policies where tablename = 'doc_reviews'
--     and policyname = 'Team reads reviews via a shared site plan overlay';  -- expect 1 row
