-- ⛔ NEW-1 — THE DATABASE IS THE AUTHORITY ON "IS ANYONE STILL USING THIS FILE?"
--
-- THE FAILURE (production, 2026-08-13). `⧉ Duplicate plan` copies an overlay record wholesale, so
-- two plans point at ONE storage object. Every client delete path ref-counted that share against
-- the CURRENT plan's overlay list, which cannot see the sibling — so removing the picture from a
-- duplicate hard-deleted the original's image. The owner's Woods Road overlay
-- (…/site-overlays/smsrrlk9u576/e1454691snsene.png) is GONE: the plan row still names it and
-- storage.objects holds zero rows for it. Six further plans were sharing keys at fix time
-- (Goose Creek ×4, Bain ×2).
--
-- WHY A CLIENT-SIDE REF-COUNT IS NOT ENOUGH, and why this file exists. The client's plan list is
-- whatever THIS DEVICE has hydrated. A tab that has not seen a sibling plan, a second device, or a
-- direct Storage API call all reason from an incomplete list and would orphan the bytes exactly as
-- before. This guard reasons from the one place that holds every plan.
--
-- THE RULE: refuse to delete a storage object while ANY of that owner's plans still references its
-- key. Soft-deleted plans COUNT as holders — a binned plan is restorable, so its bytes are owed to
-- it. Fail toward KEEPING the bytes: an orphaned object costs storage, a destroyed one costs the
-- owner's work, and there is no bucket versioning and no point-in-time restore covering storage
-- bytes to undo it.
--
-- ⛔ THE ERROR IS RAISED, NOT SWALLOWED (LOUD-FAILURE). A silent skip would leave the client
-- believing the object was released and drop the last thing pointing at it.
--
-- Applied to production 2026-08-13. Idempotent: safe to re-run.

-- Which of this owner's plans still name `p_key` in an overlay or as the aerial underlay?
-- SECURITY DEFINER so the check reads every plan, not just rows the caller's RLS admits — the
-- whole point is that the caller's view is the thing we do not trust.
create or replace function public.sites_referencing_storage_key(p_key text)
returns table (site_id text, site_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.name
  from public.sites s
  where p_key is not null and p_key <> ''
    and (
      exists (
        select 1
        from jsonb_array_elements(coalesce(s.data->'sheetOverlays', '[]'::jsonb)) o
        where o->>'storageKey' = p_key or o->>'sourceDwgKey' = p_key
      )
      or coalesce(s.data->'underlay'->>'storageKey', '') = p_key
    );
$$;

comment on function public.sites_referencing_storage_key(text) is
  'NEW-1 — every plan (including soft-deleted, which are restorable) still naming a storage object.';

-- The guard itself. BEFORE DELETE on storage.objects: refuse while a plan still holds the key.
create or replace function public.guard_overlay_object_release()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  holders text;
  n int;
begin
  -- Scope: only the site-plan asset paths this app owns. Everything else in the bucket
  -- (doc-review uploads, notes images) is governed by its own lifecycle and must pass through.
  if old.name is null or (old.name not like '%/site-overlays/%' and old.name not like '%/site-underlay/%') then
    return old;
  end if;

  select count(*), string_agg(coalesce(site_name, site_id), ', ' order by site_id)
    into n, holders
    from public.sites_referencing_storage_key(old.name);

  if n > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format('Refusing to delete %s — %s plan(s) still use this file: %s', old.name, n, holders),
      hint = 'Remove the reference from every plan first. A shared source file is released only by the last plan holding it.';
  end if;

  return old;
end;
$$;

comment on function public.guard_overlay_object_release() is
  'NEW-1 — refuses deletion of a site-plan source file any plan still references (client-independent).';

drop trigger if exists guard_overlay_object_release on storage.objects;
create trigger guard_overlay_object_release
  before delete on storage.objects
  for each row execute function public.guard_overlay_object_release();
