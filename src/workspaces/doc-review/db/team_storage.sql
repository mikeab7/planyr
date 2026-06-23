-- Shared team workspaces — let teammates READ each other's shared review PDFs (B-TEAM, phase 3).
-- Run ONCE in the Supabase SQL editor, AFTER site-planner/db/team_sharing.sql. Idempotent.
--
-- The existing own-folder Storage policies (db/doc_reviews.sql) are UNCHANGED — uploads and
-- edits still go to the owner's <uid>/… folder. This ADDS one extra SELECT path so a teammate
-- can read the bytes of a review that's been shared with a team they belong to, WITHOUT moving
-- any files. We grant read on an object iff some shared doc_reviews row the caller can see lists
-- that object's path in its data->sources[].storageKey.
--
-- SECURITY DEFINER so the helper can scan doc_reviews regardless of the storage policy context;
-- it still only returns true for reviews shared with a team the CALLER is in (is_team_member).
create or replace function public.can_read_shared_review_file(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.doc_reviews r
    where r.team_id is not null
      and public.is_team_member(r.team_id)
      and exists (
        select 1 from jsonb_array_elements(coalesce(r.data->'sources','[]'::jsonb)) s
        where s->>'storageKey' = p_name
      )
  );
$$;
grant execute on function public.can_read_shared_review_file(text) to authenticated;

drop policy if exists "Team reads shared review files" on storage.objects;
create policy "Team reads shared review files" on storage.objects
  for select to authenticated
  using ( bucket_id = 'doc-review-files'
          and public.can_read_shared_review_file(name) );

-- NOTE (scale): this scans the caller's shared reviews' sources jsonb per object read — fine at
-- current volume (a few reviews per team). If it ever gets hot, replace the body with a join to
-- file_facts (storageKey + team_id) behind this same policy name; the index table already exists.
