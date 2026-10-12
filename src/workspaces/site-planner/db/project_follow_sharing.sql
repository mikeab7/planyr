-- B2244017 / B2244018 — A PROJECT'S OVERLAYS AND COMPS FOLLOW THE PROJECT'S SHARING (owner constraint
-- #21, decided 2026-10-05, repeated 2026-10-11). Additive SELECT policies only: no row is rewritten, no
-- team_id changes, no data migration, nothing granted beyond SELECT, and the sharing guard trigger
-- (guard_team_share) is untouched. Reviews are NOT made to follow the project (still undecided).
-- Idempotent. Applied to production by the shipping session; test: db/test/project_follow_sharing.test.sql.
--
-- THE ONE PREDICATE. "Can read a plan" is the plans table's own SELECT policy, verbatim:
--     s.user_id = auth.uid() or (s.team_id is not null and is_team_member(s.team_id))
-- Every function below asks exactly that of a LIVE plan (deleted_at is null), so "can see the plan" and
-- "can load what is on it" cannot disagree, and a binned plan grants nothing.

-- 1. SITE TAB OVERLAY FILES (`sheetOverlays` inside sites.data; object `<uid>/site-overlays/<plan>/<id>.<ext>`).
--    Readable when the caller can read a live plan whose sheetOverlays names this exact key, AND the key's
--    ORIGIN plan (its third path segment, the plan it was uploaded from) EXISTS, is one the caller can also
--    read (in any bin state), AND the UPLOADER (first segment) is that origin plan's owner or on its team.
--    Anyone may write `storageKey` into a plan they can edit, so the origin check is what stops a plan
--    naming a key it never uploaded (a colleague's file from that colleague's PRIVATE plan). The uploader
--    binding stops PLAN-ID SQUATTING: `sites.id` is client-chosen, so without it a stranger could create a
--    plan whose id matches a purged/never-synced origin folder and read another account's file through it
--    (adversarial review, B2244017 #1). There is deliberately NO fallback for an origin plan that no longer
--    exists (#2): such a file stays readable by its uploader only (own-folder policy). Production at
--    apply time: 0 keys on shared live plans with a missing origin, 0 objects whose uploader is foreign
--    to its origin plan — nothing legitimate loses access.
create or replace function public.can_read_shared_site_overlay_file(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[2] = 'site-overlays'
     and p_name !~ '(^|/)\.\.?(/|$)'
     and exists (
       select 1 from public.sites s
       where s.deleted_at is null
         and (s.user_id = auth.uid() or (s.team_id is not null and public.is_team_member(s.team_id)))
         and jsonb_typeof(s.data->'sheetOverlays') = 'array'
         and s.data->'sheetOverlays' @> jsonb_build_array(jsonb_build_object('storageKey', p_name))
         and exists (
           select 1 from public.sites f
           where f.id = (storage.foldername(p_name))[3]
             and (f.user_id = auth.uid() or (f.team_id is not null and public.is_team_member(f.team_id)))
             and ((storage.foldername(p_name))[1] = f.user_id::text
                  or (f.team_id is not null and exists (select 1 from public.team_members tm
                       where tm.team_id = f.team_id and tm.user_id::text = (storage.foldername(p_name))[1])))
         )
     );
$$;
revoke all on function public.can_read_shared_site_overlay_file(text) from public, anon;
grant execute on function public.can_read_shared_site_overlay_file(text) to authenticated;

drop policy if exists "Readers of a shared plan read its overlay files" on storage.objects;
create policy "Readers of a shared plan read its overlay files" on storage.objects
  for select to authenticated
  using ( bucket_id = 'doc-review-files' and public.can_read_shared_site_overlay_file(name) );

-- 2. "CAN READ THE PROJECT" for a row (a Map/Comps overlay or a comp) attached to it by `project_id`
--    (a sites.id). The project is the plan group `coalesce(data->>'groupId', id)` of that row — the same
--    key set_project_team_state shares by — restricted to plans owned by the PROJECT'S OWNER, because
--    `data.groupId` is writable by anyone on their own plans: without the owner binding, a stranger could
--    graft a plan into someone's group and widen who sees it. And the ROW'S owner must hold that same plan
--    (own it, or be on its team), so nobody can push their own row into a team they are not in by naming
--    someone else's project.
create or replace function public.can_read_via_project(p_project text, p_row_owner uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_project is not null and p_row_owner is not null and exists (
    select 1
    from public.sites ref
    join public.sites s
      on coalesce(s.data->>'groupId', s.id) = coalesce(ref.data->>'groupId', ref.id)
     and s.user_id = ref.user_id
    where ref.id = p_project
      and s.deleted_at is null
      and (s.user_id = auth.uid() or (s.team_id is not null and public.is_team_member(s.team_id)))
      and (s.user_id = p_row_owner
           or (s.team_id is not null and exists (select 1 from public.team_members m
                                                 where m.team_id = s.team_id and m.user_id = p_row_owner)))
  );
$$;
revoke all on function public.can_read_via_project(text, uuid) from public, anon;
grant execute on function public.can_read_via_project(text, uuid) to authenticated;

drop policy if exists "read site plan overlays of a readable project" on public.site_plan_overlays;
create policy "read site plan overlays of a readable project" on public.site_plan_overlays
  for select to authenticated
  using ( deleted_at is null and public.can_read_via_project(project_id, user_id) );

drop policy if exists "read comps of a readable project" on public.comps;
create policy "read comps of a readable project" on public.comps
  for select to authenticated
  using ( deleted_at is null and public.can_read_via_project(project_id, user_id) );

-- 3. A MAP/COMPS OVERLAY'S RASTER, for a reader who sees the overlay through its project. The raster key
--    must sit in the overlay OWNER'S folder: `raster_key` is writable by the row's owner, so without that
--    binding a row could name another account's file (the B491 confused-deputy shape).
create or replace function public.can_read_project_site_plan_raster(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.site_plan_overlays o
    where o.raster_key = p_name
      and o.deleted_at is null
      and (storage.foldername(p_name))[1] = o.user_id::text
      and public.can_read_via_project(o.project_id, o.user_id)
  );
$$;
revoke all on function public.can_read_project_site_plan_raster(text) from public, anon;
grant execute on function public.can_read_project_site_plan_raster(text) to authenticated;

drop policy if exists "Readers of a project read its site plan rasters" on storage.objects;
create policy "Readers of a project read its site plan rasters" on storage.objects
  for select to authenticated
  using ( bucket_id = 'doc-review-files' and public.can_read_project_site_plan_raster(name) );

-- 4. B2244018 — HARDENING the two B978273 functions found by this item's adversarial review. Neither
--    bound the file/row to the overlay's OWNER, and both columns are owner-writable: a member could set
--    `raster_key` to a teammate's private file path, or `review_id` to a teammate's private review id,
--    share the overlay with the team, and read it. Measured on production 2026-10-11: ZERO rows rely on
--    either mismatch, so every legitimate reader keeps exactly what they see today — review visibility is
--    unchanged for every real row; only the forged case is closed.
create or replace function public.can_read_shared_site_plan_raster(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.site_plan_overlays o
    where o.raster_key = p_name
      and o.team_id is not null
      and public.is_team_member(o.team_id)
      and (storage.foldername(p_name))[1] = o.user_id::text
  );
$$;

create or replace function public.can_read_review_via_site_plan_overlay(p_review_id text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.site_plan_overlays o
    join public.doc_reviews r on r.id::text = o.review_id
    where o.review_id = p_review_id
      and o.team_id is not null
      and public.is_team_member(o.team_id)
      and r.user_id = o.user_id
  );
$$;
