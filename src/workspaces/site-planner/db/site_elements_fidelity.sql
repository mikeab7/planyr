-- Element-level sync (B666) — FIDELITY CHECK (read-only). Run after the backfill (and
-- again at the B668 cutover re-run). Rebuilds every site's collections from rows and
-- compares them to the blob. MUST return ZERO rows; any row is a mismatch to investigate
-- before proceeding.
--
-- Comparison semantics:
--  • Rebuilt array = live rows' data ordered by (z_index, id) — z was array_index*1024,
--    strictly increasing, so rebuild order == original array order.
--  • The blob side is filtered by deletedIds (tombstone-wins), matching both the backfill's
--    exclusion and the app's mergeSiteContent filter.
--  • jsonb equality is semantic (key order inside an element doesn't matter).
--  • deletedIds compare as SETS (sorted, deduped) against tombstoned row ids.

with kinds as (
  select * from (values ('el','els'), ('markup','markups'), ('measure','measures'),
                        ('callout','callouts'), ('parcel','parcels')) as k(kind, field)
),
collection_check as (
  select s.id as site_id, k.kind,
    coalesce((select jsonb_agg(t.data order by t.z_index, t.id)
              from public.site_elements t
              where t.site_id = s.id and t.kind = k.kind and t.deleted_at is null), '[]'::jsonb) as from_rows,
    coalesce((select jsonb_agg(e.value order by e.ordinality)
              from jsonb_array_elements(coalesce(s.data->k.field, '[]'::jsonb))
                with ordinality as e(value, ordinality)
              where not (coalesce(s.data->'deletedIds', '[]'::jsonb) ? (e.value->>'id'))), '[]'::jsonb) as from_blob
  from public.sites s
  cross join kinds k
),
tombstone_check as (
  select s.id as site_id, 'deletedIds' as kind,
    coalesce((select jsonb_agg(x.id order by x.id)
              from (select distinct t.id from public.site_elements t
                    where t.site_id = s.id and t.deleted_at is not null) x), '[]'::jsonb) as from_rows,
    coalesce((select jsonb_agg(x.value order by x.value)
              from (select distinct d.value
                    from jsonb_array_elements_text(coalesce(s.data->'deletedIds', '[]'::jsonb)) as d(value)
                    where d.value is not null and d.value <> '') x), '[]'::jsonb) as from_blob
  from public.sites s
)
select site_id, kind,
       jsonb_array_length(from_rows) as row_count,
       jsonb_array_length(from_blob) as blob_count
from (select * from collection_check union all select * from tombstone_check) all_checks
where from_rows is distinct from from_blob
order by site_id, kind;
