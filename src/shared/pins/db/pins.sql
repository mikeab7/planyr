-- Library pins — starred folders/files, per-account cloud sync (B675).
-- Run once in the Supabase SQL editor (main app project). Idempotent; safe to re-run.
-- Mirrors public.file_facts / public.doc_reviews RLS exactly — private by default, each
-- user only ever sees and edits their own rows.
--
-- WHY: the Library "Home" pins (the ☆ favorites) were per-device localStorage. This table
-- makes them follow the account, so a folder/file pinned on the office desktop shows up on
-- the laptop too. A pin is one small row; there is no per-item content to merge, so an add
-- is a single upsert and an unpin is a real DELETE (RLS-scoped) — no tombstones needed, an
-- unpin can never resurrect on another device.
--
-- A pin: { type 'folder'|'file', target_id, project_id?, label }.
--   folder pins  → project_folders.id  (clicking navigates to that project + folder)
--   file pins    → doc_reviews.id       (clicking opens the drawing in Review)
-- `label` is a display-name snapshot taken at pin time, so a pin stays legible (and reads
-- loudly as "missing" rather than vanishing) even if its target is later deleted.

-- 1) Table -------------------------------------------------------------------
create table if not exists public.pins (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type       text not null,                       -- 'folder' | 'file'
  target_id  text not null,                        -- project_folders.id (folder) | doc_reviews.id (file)
  project_id text,                                 -- for navigation; null allowed
  label      text not null default '',             -- display-name snapshot taken at pin time
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, type, target_id),          -- matches the store's { type, id } identity
  constraint pins_type_check check (type in ('folder', 'file'))
);

-- Read path: this user's pins, newest first (reproduces the store's unshift order).
create index if not exists pins_user_created_idx
  on public.pins (user_id, created_at desc);

-- 2) RLS — private by default (identical shape to public.file_facts) ----------
alter table public.pins enable row level security;

drop policy if exists "Users select own pins" on public.pins;
drop policy if exists "Users insert own pins" on public.pins;
drop policy if exists "Users update own pins" on public.pins;
drop policy if exists "Users delete own pins" on public.pins;

create policy "Users select own pins" on public.pins
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own pins" on public.pins
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own pins" on public.pins
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own pins" on public.pins
  for delete to authenticated using ((select auth.uid()) = user_id);
