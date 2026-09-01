-- Site-plan overlay raster — team-read storage policy (B972512-HARDENING item 4). Run once in
-- the Supabase SQL editor AFTER site_plan_overlays.sql. Idempotent.
--
-- THE BUG: `site_plan_overlays` is team-visible via its OWN `team_id` column (its SELECT
-- policy — site_plan_overlays.sql). Its cached raster image (the resolution-capped JPEG the map
-- actually paints — shared/sitePlans/lib/overlayRasterStorage.js, stored at
-- `${uid}/site-plan-overlays/${overlayId}.jpg` in the shared `doc-review-files` bucket) is a
-- SEPARATE storage object, and the bucket's only team-read policy —
-- "Team reads shared review files" — is gated on `can_read_shared_review_file(name)`, which
-- checks a DIFFERENT team_id: `doc_reviews.team_id`, and only matches a path that is literally
-- listed in that review's OWN `data->'sources'` array. An overlay raster key is never in that
-- array (it isn't part of the brochure's own source list at all), so that function always
-- returns false for it — a teammate who can see the overlay ROW (team-visible) still gets a
-- storage 403 loading its IMAGE, because the bucket's team-read check was answering a different
-- question ("can you read this doc_reviews's own source file?") than the one that matters here
-- ("can you read this site_plan_overlays's own raster?").
--
-- THE FIX: a second, narrow storage read policy keyed on `site_plan_overlays.team_id` — the
-- SAME predicate its own SELECT policy already uses — so "can see the overlay row" and "can
-- load the overlay's image" can never disagree again. `can_read_shared_review_file` is left
-- completely alone (it's still correct for what it actually governs: the WHOLE BROCHURE's own
-- source file, a distinct storage object with its own path).
create or replace function public.can_read_shared_site_plan_raster(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.site_plan_overlays o
    where o.raster_key = p_name
      and o.team_id is not null
      and public.is_team_member(o.team_id)
  );
$$;
revoke all on function public.can_read_shared_site_plan_raster(text) from public;
revoke all on function public.can_read_shared_site_plan_raster(text) from anon;
grant execute on function public.can_read_shared_site_plan_raster(text) to authenticated;

drop policy if exists "Team reads shared site plan rasters" on storage.objects;
create policy "Team reads shared site plan rasters" on storage.objects
  for select to authenticated
  using ( bucket_id = 'doc-review-files' and public.can_read_shared_site_plan_raster(name) );

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select policyname from pg_policies where tablename = 'objects' and schemaname = 'storage'
--     and policyname = 'Team reads shared site plan rasters';   -- expect 1 row
