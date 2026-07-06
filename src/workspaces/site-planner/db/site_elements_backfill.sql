-- Element-level sync, phase 1 (B670) — backfill: explode every site's `data` blob into
-- `site_elements` rows. Run AFTER db/site_elements.sql. Idempotent AND re-runnable: it is
-- deliberately re-run at the phase-3 (B672) read cutover to capture any blob-side edits
-- made between phases.
--
-- Re-run safety (why rows can't be clobbered):
--  • INSERT passes only add rows that don't exist (`on conflict do nothing`).
--  • UPDATE passes only touch a row when the BLOB is newer (`t.updated_at < s.updated_at`)
--    AND the content actually differs (`is distinct from`) — a row the element write path
--    (B671) advanced past the blob is kept. Mixed clocks (sites.updated_at is client-stamped,
--    site_elements.updated_at is server-stamped) can only err toward KEEPING rows, and the
--    dual-write bridge keeps both sides equivalent anyway.
--  • Tombstone-wins: an id listed in the blob's deletedIds is EXCLUDED from the collection
--    passes (matching mergeSiteContent's filter — the app-side semantics) and lands/stays a
--    tombstone row instead.
--
-- z_index = (array position) * 1024 — gaps so later reorders can insert between neighbors
-- without renumbering (mirrors ensureZ in lib/zOrder.js; keep the two rules identical).

-- 1) INSERT missing rows from each of the 5 vector collections -------------------
insert into public.site_elements (site_id, id, kind, data, z_index, rev, updated_at, updated_by)
select s.id, e.value->>'id', k.kind, e.value, (e.ordinality - 1) * 1024, 1, s.updated_at, s.user_id
from public.sites s
cross join (values ('el','els'), ('markup','markups'), ('measure','measures'),
                   ('callout','callouts'), ('parcel','parcels')) as k(kind, field)
cross join lateral jsonb_array_elements(coalesce(s.data->k.field, '[]'::jsonb))
  with ordinality as e(value, ordinality)
where e.value->>'id' is not null
  and not (coalesce(s.data->'deletedIds', '[]'::jsonb) ? (e.value->>'id'))
on conflict (site_id, kind, id) do nothing;

-- 2) UPDATE existing LIVE rows from the blob — only where the blob is newer AND differs.
--    (Tombstoned rows are never revived here; restore is an explicit client op.)
update public.site_elements t
   set data = e.value, z_index = (e.ordinality - 1) * 1024,
       rev = t.rev + 1, updated_at = s.updated_at
from public.sites s
cross join (values ('el','els'), ('markup','markups'), ('measure','measures'),
                   ('callout','callouts'), ('parcel','parcels')) as k(kind, field)
cross join lateral jsonb_array_elements(coalesce(s.data->k.field, '[]'::jsonb))
  with ordinality as e(value, ordinality)
where t.site_id = s.id and t.kind = k.kind and t.id = e.value->>'id'
  and t.deleted_at is null
  and not (coalesce(s.data->'deletedIds', '[]'::jsonb) ? (e.value->>'id'))
  and t.updated_at <= s.updated_at
  and t.data is distinct from e.value;

-- 3) INSERT tombstone rows for the blob's deletedIds (deletion syncs as a fact).
--    kind='tombstone' + data=null: the blob kept only the id, the element data is gone.
insert into public.site_elements (site_id, id, kind, data, z_index, rev, updated_at, updated_by, deleted_at, deleted_by)
select s.id, d.value, 'tombstone', null, 0, 1, s.updated_at, s.user_id, now(), s.user_id
from public.sites s
cross join lateral jsonb_array_elements_text(coalesce(s.data->'deletedIds', '[]'::jsonb)) as d(value)
where d.value is not null and d.value <> ''
on conflict (site_id, kind, id) do nothing;

-- 4) Re-run reconciliation of deletes: a LIVE row whose id the (newer) blob lists in
--    deletedIds was deleted via the blob path — tombstone it.
update public.site_elements t
   set deleted_at = now(), deleted_by = s.user_id, rev = t.rev + 1, updated_at = s.updated_at
from public.sites s
cross join lateral jsonb_array_elements_text(coalesce(s.data->'deletedIds', '[]'::jsonb)) as d(value)
where t.site_id = s.id and t.id = d.value
  and t.deleted_at is null
  and t.updated_at < s.updated_at;
