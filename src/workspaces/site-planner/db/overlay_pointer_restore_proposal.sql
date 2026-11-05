-- B2244016 — PROPOSAL, NOT APPLIED. Restores overlay pointers that a teammate's client wrongly healed
-- to `storageKey: null, storageMissing: true` while the file was still in the bucket (an RLS refusal
-- read as "file missing"). Needs Michael's explicit go-ahead: the affected plans include Goose Creek and
-- Bain, which no session may touch on its own.
--
-- ORDER MATTERS: run only AFTER (1) the heal guard (lib/overlayHeal.js) is deployed and (2) the
-- follow-the-project read policy (project_follow_sharing.sql) is applied — otherwise a teammate's client
-- would fail to read the file again and (pre-guard) erase the pointer again.
--
-- PART 1 (read-only, safe any time): what would change. One row per healed record whose object is still
-- present, matched by the overlay id the storage key embeds (`<uid>/site-overlays/<plan>/<overlayId>.<ext>`).
-- A record matching zero or several objects is NOT restorable and is listed with restorable = false.
with healed as (
  select s.id plan_id, s.site, s.name, e->>'id' ov_id, e->>'name' ov_name
  from public.sites s, jsonb_array_elements(coalesce(s.data->'sheetOverlays','[]'::jsonb)) e
  where (e->>'storageMissing')::boolean and e->>'storageKey' is null and s.deleted_at is null
), hits as (
  select h.*, (select array_agg(o.name) from storage.objects o
               where o.bucket_id = 'doc-review-files'
                 and o.name ~ ('^[0-9a-f-]{36}/site-overlays/[^/]+/' || h.ov_id || '\.(pdf|png|jpg|dxf|dwg)$')) objs
  from healed h
)
select plan_id, site, name, ov_id, ov_name, objs, coalesce(array_length(objs,1),0) = 1 as restorable
from hits order by site, plan_id;

-- PART 2 (WRITES — leave commented until approved). Puts the found key back, drops the heal flag, and
-- stamps data.updatedAt so the cloud copy wins the client's newer-by-id merge (mergeSiteContent).
-- begin;
-- with fix as (
--   select s.id, jsonb_agg(
--     case when (e->>'storageMissing')::boolean and e->>'storageKey' is null and m.objs is not null and array_length(m.objs,1) = 1
--          then (e - 'storageMissing') || jsonb_build_object('storageKey', m.objs[1])
--          else e end order by ord) ovs
--   from public.sites s
--   cross join lateral jsonb_array_elements(s.data->'sheetOverlays') with ordinality as t(e, ord)
--   left join lateral (select array_agg(o.name) objs from storage.objects o
--                      where o.bucket_id = 'doc-review-files'
--                        and o.name ~ ('^[0-9a-f-]{36}/site-overlays/[^/]+/' || (e->>'id') || '\.(pdf|png|jpg|dxf|dwg)$')) m on true
--   where s.deleted_at is null and s.data->'sheetOverlays' @> '[{"storageMissing": true}]'
--   group by s.id
-- )
-- update public.sites s
--    set data = jsonb_set(jsonb_set(s.data, '{sheetOverlays}', fix.ovs), '{updatedAt}',
--                         to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint))
--   from fix where fix.id = s.id and fix.ovs is distinct from s.data->'sheetOverlays';
-- -- re-run PART 1: every restorable row should be gone. Then: commit;  (or rollback;)
