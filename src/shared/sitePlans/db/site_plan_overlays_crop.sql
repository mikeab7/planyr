-- Site-plan overlay crop (B1134754 NEW-21). Run once in the Supabase SQL editor, AFTER
-- site_plan_overlays.sql / site_plan_overlays_placement.sql. Idempotent.
--
-- WHY: a broker flyer page carries logos, headers, a border and margin around the actual site
-- plan artwork — the owner's own words, "he needs to trim the site plan too, like really just
-- crop, like a basic cropping tool." NON-DESTRUCTIVE by design (mirrors the Site Planner's own
-- reference-image crop, `workspaces/site-planner/lib/overlayCrop.js`, whose pure trim math this
-- feature reuses verbatim): `crop` is additive, in SOURCE-IMAGE PIXELS ({x,y,w,h}), and never
-- touches `raster_key` — the full original raster stays exactly as uploaded, so widening or
-- clearing the crop later recovers the whole picture with no re-upload. NULL (the default for
-- every existing row) means "no crop — the full image", so this migration changes nothing about
-- what any already-placed overlay renders.
--
-- INTERACTION WITH PLACEMENT — the reason this needed no change to center_lat/center_lon/
-- ft_per_px/rotation_deg: those describe the FULL image's placement and are left untouched by a
-- crop, so the georeferencing of every surviving pixel is IDENTICAL before and after cropping —
-- cropping only clips what is PAINTED (a CSS clip-path in image-local pixels, applied under the
-- placement transform — see rotatedImageLayer.js), never what is ANCHORED. Proven in
-- test/overlayGeoref.test.js and test/siteplanOverlayCrop.test.js: imagePointToLatLon(placement,
-- imgW, imgH, x, y) returns the same lat/lon for any fixed (x, y) whether or not `crop` is set.

alter table public.site_plan_overlays add column if not exists crop jsonb;

alter table public.site_plan_overlays drop constraint if exists site_plan_overlays_crop_shape;
alter table public.site_plan_overlays add constraint site_plan_overlays_crop_shape
  check (
    crop is null or (
      jsonb_typeof(crop) = 'object'
      and (crop ? 'x') and (crop ? 'y') and (crop ? 'w') and (crop ? 'h')
      and jsonb_typeof(crop->'x') = 'number' and jsonb_typeof(crop->'y') = 'number'
      and jsonb_typeof(crop->'w') = 'number' and jsonb_typeof(crop->'h') = 'number'
      and (crop->>'w')::double precision > 0 and (crop->>'h')::double precision > 0
    )
  );

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='site_plan_overlays' and column_name='crop';
