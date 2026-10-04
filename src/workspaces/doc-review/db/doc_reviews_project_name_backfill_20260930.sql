-- NEW-1 (B1991040) — heal the STORED project text on doc_reviews after a project rename.
-- DISPLAY no longer depends on this: the app resolves a review's project by project_id at read time
-- and recomposes an auto-generated title (src/workspaces/doc-review/lib/reviewNaming.js). This
-- removes the stale text other readers of the columns would still see.
--
-- Measured 2026-09-29: doc_reviews rvmqzs201bfcc2d — project "Pappadoupolos", project_id
-- smqgpt12zh5o, title "Pappadoupolos - Other - 2026.06.29" — the project is "Papadopoulos".
--
-- THE TITLE RULE (decided from the code that generates it — see reviewNaming.js):
--   a title is AUTO-GENERATED iff it EQUALS what the generator produces from the row's own stored
--   project / item / doc_date, in either shape the generator has had:
--       date-first  "2026.06.29 <Project> - <Item>"   (B659 onward)
--       name-first  "<Project> - <Item> - 2026.06.29"  (before B659 — the measured row)
--   Auto titles follow the rename, in the shape they were found in. ANYTHING ELSE was typed by a
--   person and is NEVER touched — even if it contains the old project name.
--
-- SAFE BY CONSTRUCTION
--   • Only rows whose project_id resolves to a live sites row and whose stored `project` differs
--     from its current name. A row with no link (or a deleted project) keeps its text (fallback).
--   • Touches `project`, `data.project`, and — only when auto — `title`, `data.title`,
--     `data.titleAuto`. Nothing else is read or rewritten. updated_at is NOT bumped (a rename is not
--     an edit of the document), so "last touched" ordering does not move.
--   • Idempotent: a second run finds nothing that differs.
--
-- HOW TO RUN: Supabase SQL editor. Step 1 is a read-only preview; run it first, then step 2.

-- 1) PREVIEW.
with live as (
  select distinct on (coalesce(group_id, id)) coalesce(group_id, id) as gid, site
  from public.sites
  where deleted_at is null and coalesce(nullif(trim(site), ''), null) is not null
  order by coalesce(group_id, id), nullif(data->>'siteRenamedAt','')::numeric desc nulls last, updated_at desc
), r as (
  select d.id, d.project as old_project, l.site as new_project, d.title, d.item,
         replace(left(coalesce(d.doc_date::text, ''), 10), '-', '.') as dd
  from public.doc_reviews d join live l on l.gid = d.project_id
  where d.project is distinct from l.site
)
select id, old_project, new_project, title,
       case
         when dd <> '' and title = dd || ' ' || concat_ws(' - ', nullif(trim(old_project),''), nullif(trim(item),'')) then 'auto (date-first)'
         when dd <> '' and title = concat_ws(' - ', nullif(trim(old_project),''), nullif(trim(item),'')) || ' - ' || dd then 'auto (name-first)'
         else 'typed — left alone'
       end as title_kind
from r;

-- 2) HEAL — snapshot first (this repo's backfill convention: a recovery table you can restore from).
create table if not exists public.recovery_20260930_doc_reviews_project_name_snapshot as table public.doc_reviews;

with live as (
  select distinct on (coalesce(group_id, id)) coalesce(group_id, id) as gid, site
  from public.sites
  where deleted_at is null and coalesce(nullif(trim(site), ''), null) is not null
  order by coalesce(group_id, id), nullif(data->>'siteRenamedAt','')::numeric desc nulls last, updated_at desc
), r as (
  select d.id, d.project as old_project, l.site as new_project, d.title, d.item,
         replace(left(coalesce(d.doc_date::text, ''), 10), '-', '.') as dd
  from public.doc_reviews d join live l on l.gid = d.project_id
  where d.project is distinct from l.site
), k as (
  select r.*,
    case
      when dd <> '' and title = dd || ' ' || concat_ws(' - ', nullif(trim(old_project),''), nullif(trim(item),'')) then 'cur'
      when dd <> '' and title = concat_ws(' - ', nullif(trim(old_project),''), nullif(trim(item),'')) || ' - ' || dd then 'old'
      else null
    end as shape
  from r
), t as (
  select k.*,
    case shape
      when 'cur' then dd || ' ' || concat_ws(' - ', nullif(trim(new_project),''), nullif(trim(item),''))
      when 'old' then concat_ws(' - ', nullif(trim(new_project),''), nullif(trim(item),'')) || ' - ' || dd
    end as new_title
  from k
)
update public.doc_reviews d
   set project = t.new_project,
       title   = coalesce(t.new_title, d.title),
       data    = jsonb_set(
                   case when t.new_title is not null
                        then jsonb_set(jsonb_set(d.data, '{title}', to_jsonb(t.new_title), true), '{titleAuto}', 'true'::jsonb, true)
                        else d.data end,
                   '{project}', to_jsonb(t.new_project), true)
  from t
 where t.id = d.id;
