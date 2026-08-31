-- Site-plan overlays — drop the `review_user_id` column (B972225 NEW-4, filed after every save
-- failed live with `null value in column "review_user_id" ... violates not-null constraint`).
-- Run once in the Supabase SQL editor, AFTER site_plan_overlays.sql / site_plan_overlays_placement.sql.
-- Idempotent. Confirmed zero rows in production before writing this file (`select count(*)`),
-- so nothing is lost.
--
-- THE DECISION, and why it's a drop rather than a default: the column shipped `not null` with
-- no default, so the very first real save hit it. The fix is NOT "default it to auth.uid()" —
-- that quietly assumes the overlay's creator is always the review's owner, which is true today
-- only by construction (see below), not by rule, and a silent default is exactly how a wrong
-- owner gets recorded and only surfaces later on someone else's screen.
--
-- Today an overlay is created in exactly ONE place — SitePlansSection's upload flow — which
-- always calls `fileNewReview` to create a BRAND NEW doc_reviews row in the SAME act as the
-- overlay insert, so the review's owner is, by construction, always identical to the overlay's
-- own `user_id`. There is deliberately no "pick a page from an already-filed document" flow
-- yet (the original PR's own flagged gap #2), so no live path lets a teammate's already-uploaded
-- brochure become the source of someone ELSE's overlay. A column that can only ever duplicate
-- `user_id` is not information worth storing — it's redundancy waiting to drift, so it is
-- dropped rather than defaulted. It was also never part of any FK (review_id alone is a
-- sufficient FK to doc_reviews — see site_plan_overlays.sql's AUDIT-FIRST note) and never read
-- anywhere in the app.
--
-- If "pick an existing document" ever ships, the right question then is "who may SEE this
-- review" — a join through `doc_reviews.user_id`/team, same as any other cross-table
-- visibility check — not a second denormalized owner id carried on this table.

alter table public.site_plan_overlays drop column if exists review_user_id;

drop index if exists public.site_plan_overlays_review_idx;
create index if not exists site_plan_overlays_review_idx on public.site_plan_overlays (review_id);

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='site_plan_overlays' order by ordinal_position;
--   -- expect: no review_user_id row
