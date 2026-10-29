-- site_plan_overlays.review_id -> doc_reviews(id): ON DELETE RESTRICT (NEW-2, 2026-10-29).
--
-- site_plan_overlays.sql declared `on delete cascade` for this foreign key, but production has
-- been ON DELETE RESTRICT since B972512-HARDENING (a brochure purge must never silently destroy a
-- placed plan or the comps pinned to it). `create table if not exists` meant re-running the file
-- never flipped production, so the drift was invisible — and a rebuilt/fresh environment would
-- have been created with CASCADE, where the Library's purge would hard-delete live overlays.
-- This file makes the repo declare what production has. Idempotent; a NO-OP on production
-- (the constraint is already RESTRICT, so the block below changes nothing there).
-- Run AFTER site_plan_overlays.sql.
set lock_timeout = '15s';
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'site_plan_overlays_review_id_fkey'
       and conrelid = 'public.site_plan_overlays'::regclass and confdeltype = 'r'
  ) then
    alter table public.site_plan_overlays drop constraint if exists site_plan_overlays_review_id_fkey;
    alter table public.site_plan_overlays
      add constraint site_plan_overlays_review_id_fkey
      foreign key (review_id) references public.doc_reviews(id) on delete restrict;
  end if;
end $$;
