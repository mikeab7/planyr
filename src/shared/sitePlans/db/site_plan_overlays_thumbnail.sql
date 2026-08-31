-- Site-plan overlays — add a small inline list-row THUMBNAIL (B972225 NEW-5, the file-size
-- item). Run once in the Supabase SQL editor, AFTER site_plan_overlays.sql. Idempotent, additive.
--
-- WHY INLINE (a data: URL text column) RATHER THAN A SECOND STORAGE KEY: the whole point of a
-- thumbnail is to avoid paying for the full-size raster just to draw a list row — but a second
-- Storage object per overlay would mean a SEPARATE network round-trip per row to show it, which
-- is the exact "waste that will show up as panel lag" the item warns about. Inline, the
-- thumbnail rides along with the SAME `fetchAllOverlays` row fetch every overlay already needs,
-- so N site plans cost one request, not N+1. It's small on purpose — ~320px long edge, JPEG
-- quality 0.7, measured at ~15 KB on the owner's real Airtex site-plan page (see
-- shared/sitePlans/lib/overlayRasterSize.js's header for the full measurement) — cheap even at a
-- few dozen rows in one list payload.

alter table public.site_plan_overlays add column if not exists thumb_data_url text;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='site_plan_overlays' order by ordinal_position;
--   -- expect: a thumb_data_url row
