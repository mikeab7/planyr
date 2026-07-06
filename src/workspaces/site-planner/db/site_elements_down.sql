-- Element-level sync (B670) — DOWN-MIGRATION: rebuild each site's `data` blob collections
-- from `site_elements` rows, so an emergency revert to the whole-doc pipeline is one
-- command instead of archaeology. Safe + idempotent; leaves `site_elements` intact (a
-- re-cutover loses nothing). Only touches sites that actually have element rows.
--
-- Rebuild rules (inverse of the backfill):
--  • Each collection = its live rows' `data`, ordered by (z_index, id) — z was minted as
--    array_index*1024, so this reproduces the original array order.
--  • deletedIds = the tombstoned row ids, newest deletions first, capped at 5000
--    (MAX_TOMBSTONES in lib/siteModel.js).
--  • updatedAt is re-stamped so clients treat the rebuilt blob as fresh.

update public.sites s
   set data = s.data || jsonb_build_object(
     'els',        coalesce((select jsonb_agg(t.data order by t.z_index, t.id)
                             from public.site_elements t
                             where t.site_id = s.id and t.kind = 'el'      and t.deleted_at is null), '[]'::jsonb),
     'markups',    coalesce((select jsonb_agg(t.data order by t.z_index, t.id)
                             from public.site_elements t
                             where t.site_id = s.id and t.kind = 'markup'  and t.deleted_at is null), '[]'::jsonb),
     'measures',   coalesce((select jsonb_agg(t.data order by t.z_index, t.id)
                             from public.site_elements t
                             where t.site_id = s.id and t.kind = 'measure' and t.deleted_at is null), '[]'::jsonb),
     'callouts',   coalesce((select jsonb_agg(t.data order by t.z_index, t.id)
                             from public.site_elements t
                             where t.site_id = s.id and t.kind = 'callout' and t.deleted_at is null), '[]'::jsonb),
     'parcels',    coalesce((select jsonb_agg(t.data order by t.z_index, t.id)
                             from public.site_elements t
                             where t.site_id = s.id and t.kind = 'parcel'  and t.deleted_at is null), '[]'::jsonb),
     'deletedIds', coalesce((select jsonb_agg(x.id)
                             from (select t.id, max(t.deleted_at) as da
                                   from public.site_elements t
                                   where t.site_id = s.id and t.deleted_at is not null
                                     and not exists (select 1 from public.site_elements l
                                                     where l.site_id = s.id and l.id = t.id
                                                       and l.deleted_at is null)
                                   group by t.id order by da desc limit 5000) x), '[]'::jsonb),
     'updatedAt',  (extract(epoch from now()) * 1000)::bigint
   )
 where exists (select 1 from public.site_elements t where t.site_id = s.id);

-- To fully retire the element store afterwards (NOT part of the automatic revert —
-- deliberate, run by hand only after confirming the rebuilt blobs):
--   drop function if exists public.commit_elements(text, jsonb);
--   alter publication supabase_realtime drop table public.site_elements;
--   drop table if exists public.site_elements;
