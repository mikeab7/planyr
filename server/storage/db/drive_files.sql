-- Durable Planyr-key ↔ Drive-id map (B207 / NEW-2). Run once in the Supabase SQL editor;
-- idempotent. Lets a file saved to Google Drive be fetched back across requests. Bytes
-- live in Drive; this table is just the index/handle. Private-by-default RLS, same shape
-- as public.sites / public.doc_reviews.

create table if not exists public.drive_files (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  planyr_key text not null,
  drive_id   text not null,
  name       text,
  updated_at timestamptz not null default now(),
  primary key (user_id, planyr_key)
);

-- Reverse lookups (Drive id → Planyr key) stay fast + scoped per user.
create index if not exists drive_files_user_drive_idx on public.drive_files (user_id, drive_id);

alter table public.drive_files enable row level security;

-- Private by default: each user only ever sees/writes their own rows.
do $$ begin
  create policy "Users select own drive_files" on public.drive_files for select to authenticated using ((select auth.uid()) = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users insert own drive_files" on public.drive_files for insert to authenticated with check ((select auth.uid()) = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users update own drive_files" on public.drive_files for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users delete own drive_files" on public.drive_files for delete to authenticated using ((select auth.uid()) = user_id);
exception when duplicate_object then null; end $$;
