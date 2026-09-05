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
-- THE RULE: refuse to delete a storage object while ANY plan — belonging to ANY owner — still
-- references its key. Soft-deleted plans COUNT as holders — a binned plan is restorable, so its
-- bytes are owed to it. Fail toward KEEPING the bytes: an orphaned object costs storage, a
-- destroyed one costs the owner's work, and there is no bucket versioning and no point-in-time
-- restore covering storage bytes to undo it.
--
-- ⛔ THE ERROR IS RAISED, NOT SWALLOWED (LOUD-FAILURE). A silent skip would leave the client
-- believing the object was released and drop the last thing pointing at it.
--
-- Applied to production 2026-08-13. Idempotent: safe to re-run.
--
-- ⛔ B1183153 (NEW-2) — DELIBERATELY GLOBAL, NOT PER-OWNER, AND THE COMMENT BELOW USED TO SAY
-- OTHERWISE. The storage key embeds the UPLOADER's uid (`<uid>/site-overlays/<siteId>/<file>`,
-- overlayStorage.js), but "⧉ Duplicate plan" (the FAILURE case above) can copy an overlay record
-- wholesale onto a NEW site row owned by a DIFFERENT user — a teammate duplicating a team-shared
-- plan keeps pointing at the original uploader's bytes from their own, differently-owned site. A
-- per-owner filter would let that second owner's copy go dark the moment the original owner's plan
-- is cleaned up, which is exactly the class of loss this guard exists to prevent. So the check
-- reasons over every owner on purpose, and `guard_overlay_object_release` below never lets that
-- global reach leak another tenant's plan name to a caller who doesn't own it.

-- Every plan, across EVERY owner (deliberately global — see above), still naming `p_key` in an
-- overlay or as the aerial underlay. SECURITY DEFINER so the check reads every plan, not just rows
-- the caller's RLS admits (soft-deleted plans included) — the whole point is that the caller's view
-- is the thing we do not trust. NO CLIENT CALLER: EXECUTE is revoked from public/anon/authenticated
-- below; only the guard trigger calls it, running as its own SECURITY DEFINER owner.
create or replace function public.sites_referencing_storage_key(p_key text)
returns table (site_id text, site_name text, owner_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.name, s.user_id
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
  'NEW-1/B1183153 — every plan, across every owner (deliberately global, see file header), still naming a storage object. Includes soft-deleted plans, which are restorable. No client caller: EXECUTE is revoked from public/anon/authenticated; only guard_overlay_object_release calls it.';

-- ⛔ B1183152 — NO ROLE MAY CALL THIS DIRECTLY. It exists solely to serve the trigger below, which
-- calls it from inside its own SECURITY DEFINER body (so the function owner's implicit privileges
-- reach it regardless of this revoke). Before this, `revoke ... from public` alone left it
-- EXECUTABLE BY ANON over PostgREST — has_function_privilege('anon', oid, 'EXECUTE') read true — the
-- same gap site_plan_overlays_comp_sync.sql's header already documented for this exact
-- revoke-from-public-only pattern, which this file had not yet been swept for. An unauthenticated
-- caller could hit /rest/v1/rpc/sites_referencing_storage_key directly and read which plans
-- (any owner, soft-deleted included) reference an arbitrary storage key — a real cross-tenant read
-- (plan name, share count, soft-delete state), though not an account-takeover: a caller already
-- needs to know a real key, and a key's own path already reveals its uploader's uid and site id.
revoke all on function public.sites_referencing_storage_key(text) from public, anon, authenticated;

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
  v_uid uuid := auth.uid();
begin
  -- Scope: only the site-plan asset paths this app owns. Everything else in the bucket
  -- (doc-review uploads, notes images) is governed by its own lifecycle and must pass through.
  if old.name is null or (old.name not like '%/site-overlays/%' and old.name not like '%/site-underlay/%') then
    return old;
  end if;

  -- B1183153: the holder list is global (see sites_referencing_storage_key's header), but the
  -- MESSAGE never names a plan the deleting caller doesn't own — a redacted placeholder stands in
  -- for any holder outside the caller's own account (or every holder, when there is no caller
  -- identity at all, e.g. a service-role delete).
  select count(*),
         string_agg(
           case when owner_id = v_uid then coalesce(site_name, site_id) else 'a plan you do not own' end,
           ', ' order by site_id
         )
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
  'NEW-1 — refuses deletion of a site-plan source file any plan still references (client-independent). B1183153: the holder message redacts any plan the deleting caller does not own.';

drop trigger if exists guard_overlay_object_release on storage.objects;
create trigger guard_overlay_object_release
  before delete on storage.objects
  for each row execute function public.guard_overlay_object_release();

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select has_function_privilege('anon', oid, 'EXECUTE') from pg_proc
--     where proname = 'sites_referencing_storage_key';  -- expect false
