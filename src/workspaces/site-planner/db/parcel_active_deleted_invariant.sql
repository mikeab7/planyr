-- B966629 (NEW-6, owner report 2026-08-31) — A SOFT-DELETED PARCEL MAY NEVER ALSO READ
-- `active: true`. "I can't tell if the acreage is being double counted."
--
-- THE MEASUREMENT THAT MOTIVATES THIS. On the owner's Bain site (`smthnjl2cxyg`) the split
-- parent `e1455081kvgdip` ("Parcel 2A1A1", 94.47 AC) is tombstoned by `performSplit`
-- (`deleted_at` set, per B472049 — the parent is removed on a split) but the write never also
-- clears `data->>'active'`, which is left at its pre-split `true`. Today's acreage rollups all
-- filter on BOTH `active !== false` AND `!deletedAt` (`splitIntegrity.isLiveActive`,
-- `SitePlanner`'s ~13 inline sums), so there is NO live double count — verified directly: the
-- live-active set sums to exactly the six acreages the owner sees, 94.47 AC not double-counted.
-- But nothing PREVENTS a rollup that forgets the `deletedAt` half of that filter from silently
-- adding a deleted parent's acreage back on top of its own children — the failure mode
-- `isLiveActive`'s own header calls out: "`active` alone — a vanished piece counts; `!deleted`
-- alone — a superseded parent counts and the sum doubles." A swept account-wide count found this
-- is not rare: 98 parcel rows across the account are soft-deleted AND `active:true` at once.
--
-- THE FIX, at the write path rather than at every future read: a soft-deleted parcel's `active`
-- flag is FORCED to `false` the moment `deleted_at` is set, by a trigger on `site_elements` —
-- so a reader that forgets the `deletedAt` filter and reads `active` alone STILL excludes it.
-- This does not change the app's OWN behaviour (every live rollup already reads both flags and
-- already treats this parcel as excluded) — it is a durable second line of defence for any
-- rollup, present or future, that does not.
--
-- Scoped to kind='parcel' deliberately: `active` gates yield/coverage/detention math only for
-- parcels (siteModel's parcel toggle, B100/B175); other kinds don't carry this field with the
-- same meaning, and this invariant is not claimed for them.
--
-- Idempotent — safe to re-run. The backfill at the end corrects every existing violator once;
-- the trigger keeps it true from here on.

create or replace function public.enforce_parcel_deleted_inactive()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'parcel'
     and new.deleted_at is not null
     and coalesce((new.data->>'active')::boolean, true) is distinct from false
  then
    new.data := jsonb_set(new.data, '{active}', 'false'::jsonb, true);
  end if;
  return new;
end;
$$;

drop trigger if exists parcel_deleted_inactive on public.site_elements;
create trigger parcel_deleted_inactive
  before insert or update on public.site_elements
  for each row
  execute function public.enforce_parcel_deleted_inactive();

-- One-time backfill: every parcel row that is ALREADY soft-deleted and still reads active:true
-- (or has no `active` key at all, which the app treats as active) is corrected now.
update public.site_elements
set data = jsonb_set(data, '{active}', 'false'::jsonb, true)
where kind = 'parcel'
  and deleted_at is not null
  and coalesce((data->>'active')::boolean, true) is distinct from false;
