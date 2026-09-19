-- Site-plan overlay polygon crop (NEW-1, B1783328). Run once in the Supabase SQL editor, AFTER
-- site_plan_overlays_crop.sql. Idempotent.
--
-- WHY: site_plan_overlays_crop.sql's own CHECK constraint required every `crop` value to carry
-- top-level x/y/w/h — which is correct for the rect crop it shipped, but would REJECT a polygon
-- crop outright (a poly has no top-level w/h). The column itself needed no change (`crop jsonb`
-- already accepts any shape); only the CHECK constraint needed widening. This is the ONE thing
-- the original NEW-1 dispatch got wrong by claiming "no migration needed" — the column is
-- schema-free, but the constraint on it was not, and this file is the fix, audited before
-- assuming the earlier claim held.
--
-- SHAPE: crop is now a discriminated union — `{kind:'rect', x,y,w,h}` | `{kind:'poly',
-- pts:[[x,y],[x,y],[x,y],...]}` (>=3 points, each a finite [number,number] pair) — OR a legacy
-- row carrying NO `kind` key at all, which is read as rect (see overlayCrop.js `cropKind`).
-- Michael's live row (aa2d8163, version 208) has no `kind` key and this constraint keeps
-- accepting it byte-for-byte; nothing here rewrites any existing row.

-- A Postgres CHECK constraint may not embed a subquery directly, so the "every point is a
-- [number,number] pair" test (which needs jsonb_array_elements — a set-returning function) is
-- pulled into its own IMMUTABLE helper function; the constraint below just calls it.
create or replace function public._site_plan_overlay_crop_poly_valid(pts jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (select bool_and(
       jsonb_typeof(pt) = 'array'
       and jsonb_array_length(pt) = 2
       and jsonb_typeof(pt->0) = 'number'
       and jsonb_typeof(pt->1) = 'number'
     )
     from jsonb_array_elements(pts) as pt),
    false
  );
$$;

alter table public.site_plan_overlays drop constraint if exists site_plan_overlays_crop_shape;
alter table public.site_plan_overlays add constraint site_plan_overlays_crop_shape
  check (
    crop is null
    or (
      -- rect: legacy (no `kind` key) or explicit {kind:'rect', ...}
      jsonb_typeof(crop) = 'object'
      and (not (crop ? 'kind') or crop->>'kind' = 'rect')
      and (crop ? 'x') and (crop ? 'y') and (crop ? 'w') and (crop ? 'h')
      and jsonb_typeof(crop->'x') = 'number' and jsonb_typeof(crop->'y') = 'number'
      and jsonb_typeof(crop->'w') = 'number' and jsonb_typeof(crop->'h') = 'number'
      and (crop->>'w')::double precision > 0 and (crop->>'h')::double precision > 0
    )
    or (
      -- poly: {kind:'poly', pts:[[x,y],...]}, >= 3 points, each a finite [number,number] pair
      jsonb_typeof(crop) = 'object'
      and crop->>'kind' = 'poly'
      and jsonb_typeof(crop->'pts') = 'array'
      and jsonb_array_length(crop->'pts') >= 3
      and public._site_plan_overlay_crop_poly_valid(crop->'pts')
    )
  );

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.site_plan_overlays'::regclass and conname = 'site_plan_overlays_crop_shape';
--   -- Michael's live row must still pass unchanged:
--   select id, crop, version from public.site_plan_overlays where id = 'aa2d8163-7d45-4929-8a05-dad94ba2528d';
