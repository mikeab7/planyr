-- Notes cloud sync (B1291) — THE APPLIED DDL, committed as a record.
--
-- ⛔ THIS FILE IS A RECORD, NOT A SCRIPT TO RUN. It is the byte-for-byte DDL that was
-- APPLIED TO PRODUCTION (Supabase project `lyeqzkuiwngunutlkkmi`, planyr_production) on
-- 2026-07-31 as migration `notes_cloud_sync_b1291` (version 20260731150712). It lives here
-- for the same reason `server/storage/db/drive_files.sql` and
-- `src/workspaces/doc-review/db/file_facts.sql` do: the repo must not be the one place the
-- schema does not exist. Read it to know what the client is coding against; re-run it only
-- to stand up a NEW project (it is written idempotently, but the `create policy` statements
-- are not `drop`-guarded, so a re-run against the live project will error on the policies —
-- which is the correct, loud outcome for a file nobody should be re-running there).
--
-- Nothing about this lands on the owner's plate: the migration was applied by the session
-- that shipped B1291, via the Supabase MCP. He runs no SQL.
--
-- Verified live at apply time: three tables, RLS enabled on each, four own-row policies
-- each, four storage policies on the private `notes-images` bucket, security advisors
-- clean (no new findings).
--
-- WHAT THE CLIENT MUST HONOUR (see src/workspaces/notes/lib/notesCloud.js):
--   • `public.notes_touch_rev` is a BEFORE INSERT OR UPDATE trigger on all three tables. It
--     bumps `rev` and stamps `updated_at`/`updated_by` SERVER-SIDE, so the client must
--     never send a `rev` on an update — it sends the guard `and rev = <the rev it read>`
--     and reads the new one back with `.select("rev")`.
--   • Zero rows updated = another device moved first. That is the
--     "this note also changed on another device" signal. Never clobber, never blind-retry.
--   • `deleted_at` = binned and recoverable (body still present, the 30-day bin);
--     `purged_at` = bytes freed (doc NULL, the page's image rows purged in the same
--     cascade). The client NEVER hard-deletes a row, which is what makes it impossible for
--     a sync to resurrect a delete or raise a false conflict for one.
--
-- ════════════════════════════════════════════════════════════════════════════════════════
-- BEGIN APPLIED MIGRATION — notes_cloud_sync_b1291 (20260731150712), verbatim
-- ════════════════════════════════════════════════════════════════════════════════════════

-- Notes cloud sync (B1291) — the durable home for the Notes workspace.
--
-- Shape mirrors the Site Planner split that already works here:
--   notes_trees  = one opaque structure blob per user (notebooks / sections / page nodes /
--                  the 30-day bin). Holds NO bodies, so a keystroke never rewrites it.
--   notes_pages  = one row per page BODY (ProseMirror JSON), with a rev counter.
--   notes_images = one row per picture; the bytes live in the private notes-images bucket.
--
-- Concurrency contract (the client MUST honour it):
--   every UPDATE carries `and rev = <the rev the client read>`. Zero rows updated means
--   another device moved first -> surface the "changed on another device" state, never
--   clobber. The trigger below bumps rev + updated_at + updated_by server-side so a client
--   cannot forget to advance them.
--
-- Delete contract (TOMBSTONE-DELETES):
--   deleted_at set  = binned (recoverable, 30 days). Body still present.
--   purged_at set   = bytes freed. doc is NULL, the image rows for that page are purged too.
--   Rows are never hard-deleted by the client, so a sync can never resurrect a delete.
--
-- Private by default: own-row RLS only. No team columns and no team policies — sharing is a
-- deliberate, separately-designed act (KEY DECISIONS). To extend later, mirror the
-- `sites` policies (own OR is_team_member(team_id)).

-- ---------------------------------------------------------------- rev/touch trigger
create or replace function public.notes_touch_rev()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT') then
    new.updated_at := now();
    new.updated_by := auth.uid();
    if new.rev is null or new.rev < 1 then
      new.rev := 1;
    end if;
  else
    new.rev := old.rev + 1;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- notes_trees
create table if not exists public.notes_trees (
  user_id    uuid        not null default auth.uid(),
  data       jsonb       not null,
  rev        bigint      not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (user_id)
);

comment on table public.notes_trees is
  'Notes workspace structure (notebooks/sections/page nodes + the 30-day bin) — one row per user. Bodies live in notes_pages.';

alter table public.notes_trees enable row level security;

drop trigger if exists notes_trees_touch on public.notes_trees;
create trigger notes_trees_touch
  before insert or update on public.notes_trees
  for each row execute function public.notes_touch_rev();

create policy "select own notes tree"
  on public.notes_trees for select
  using (user_id = (select auth.uid()));

create policy "insert own notes tree"
  on public.notes_trees for insert
  with check (user_id = (select auth.uid()));

create policy "update own notes tree"
  on public.notes_trees for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "delete own notes tree"
  on public.notes_trees for delete
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- notes_pages
create table if not exists public.notes_pages (
  user_id    uuid        not null default auth.uid(),
  id         text        not null,
  doc        jsonb,
  rev        bigint      not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  purged_at  timestamptz,
  primary key (user_id, id)
);

comment on table public.notes_pages is
  'One row per note BODY (ProseMirror JSON). deleted_at = binned and recoverable; purged_at = bytes freed (doc NULL). Never hard-deleted by the client.';

alter table public.notes_pages enable row level security;

drop trigger if exists notes_pages_touch on public.notes_pages;
create trigger notes_pages_touch
  before insert or update on public.notes_pages
  for each row execute function public.notes_touch_rev();

-- incremental pull: "everything of mine that changed since my last sync"
create index if not exists notes_pages_user_updated_idx
  on public.notes_pages (user_id, updated_at desc);

create policy "select own notes pages"
  on public.notes_pages for select
  using (user_id = (select auth.uid()));

create policy "insert own notes pages"
  on public.notes_pages for insert
  with check (user_id = (select auth.uid()));

create policy "update own notes pages"
  on public.notes_pages for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "delete own notes pages"
  on public.notes_pages for delete
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- notes_images
create table if not exists public.notes_images (
  user_id    uuid        not null default auth.uid(),
  id         text        not null,
  path       text        not null,
  mime       text        not null,
  bytes      bigint      not null,
  width      integer,
  height     integer,
  page_id    text,
  rev        bigint      not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (user_id, id)
);

comment on table public.notes_images is
  'Picture records for notes. Bytes live in the private notes-images bucket at <auth.uid()>/<id>; this row is the index. Purged only by the note purge cascade.';

alter table public.notes_images enable row level security;

drop trigger if exists notes_images_touch on public.notes_images;
create trigger notes_images_touch
  before insert or update on public.notes_images
  for each row execute function public.notes_touch_rev();

create index if not exists notes_images_user_updated_idx
  on public.notes_images (user_id, updated_at desc);

create index if not exists notes_images_user_page_idx
  on public.notes_images (user_id, page_id);

create policy "select own notes images"
  on public.notes_images for select
  using (user_id = (select auth.uid()));

create policy "insert own notes images"
  on public.notes_images for insert
  with check (user_id = (select auth.uid()));

create policy "update own notes images"
  on public.notes_images for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "delete own notes images"
  on public.notes_images for delete
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notes-images',
  'notes-images',
  false,
  26214400,
  array['image/png','image/jpeg','image/gif','image/webp','image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Users read own note images"
  on storage.objects for select
  using (bucket_id = 'notes-images'
         and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "Users upload own note images"
  on storage.objects for insert
  with check (bucket_id = 'notes-images'
              and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "Users update own note images"
  on storage.objects for update
  using (bucket_id = 'notes-images'
         and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "Users delete own note images"
  on storage.objects for delete
  using (bucket_id = 'notes-images'
         and (select auth.uid())::text = (storage.foldername(name))[1]);

-- ════════════════════════════════════════════════════════════════════════════════════════
-- END APPLIED MIGRATION
-- ════════════════════════════════════════════════════════════════════════════════════════
