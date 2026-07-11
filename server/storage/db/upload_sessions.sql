-- Chunked-upload sessions (B409 rework — unlimited-size uploads via the Worker proxy).
--
-- One row per in-flight Google Drive RESUMABLE upload. The browser sends ~16 MB chunks to
-- /api/uploads/<id>/chunk (same-origin); the stateless Pages Function forwards each chunk to
-- the Drive session URI stored HERE — the row is what lets chunk N find the session chunk 1
-- opened. drive_session_uri is a CAPABILITY URL (anyone holding it can write that upload):
-- it is never returned to the browser by any endpoint, never logged, and RLS scopes the row
-- to its owner so no other user can read or write it. (A signed-in user reading their OWN
-- row via the anon client only learns a capability they already hold through the API.)
--
-- Run in the Supabase SQL editor (or via the MCP migration) on the main project.
create table if not exists public.upload_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  planyr_key        text not null,            -- the stable Planyr key the finished file records under (drive_files)
  drive_session_uri text not null,            -- SECRET capability URL — server-side only
  file_name         text not null,
  mime_type         text not null,
  total_bytes       bigint not null,
  bytes_received    bigint not null default 0,
  drive_file_id     text,                     -- set when Drive acknowledges the final chunk
  status            text not null default 'in_progress' check (status in ('in_progress','complete','aborted')),
  created_at        timestamptz not null default now(),
  -- Google expires a resumable session URI after ~1 week; expired rows are purged
  -- opportunistically by /api/uploads/start (best-effort, caller-scoped).
  expires_at        timestamptz not null default (now() + interval '7 days')
);

alter table public.upload_sessions enable row level security;

-- Own rows only — the same private-by-default shape as drive_files. The Pages Function
-- talks to this table with the CALLER'S token (anon key + RLS), so an attacker guessing
-- another user's uploadId reads/writes nothing (the B491 IDOR lesson).
drop policy if exists "own sessions" on public.upload_sessions;
create policy "own sessions" on public.upload_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
