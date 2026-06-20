-- Client error telemetry (B279) — public.client_errors
-- Run ONCE in the Supabase SQL editor. Idempotent (safe to re-run). Mirrors the
-- doc_reviews.sql migration style.
--
-- The app's global error/unhandledrejection/preloadError handlers and the React
-- ErrorBoundary insert one row per captured runtime error (see
-- src/shared/telemetry/clientErrors.js). The point is to make silent production
-- failures visible, so the write path must work even for an anonymous or half-broken
-- (mid-login, logged-out) session.

create table if not exists public.client_errors (
  id         uuid        primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  user_id    uuid        default auth.uid(),  -- null for anonymous / pre-login errors
  build      text,                            -- build identifier (git short SHA)
  module     text,                            -- active workspace (site-planner / doc-review / scheduler)
  source     text,                            -- window.onerror | unhandledrejection | vite:preloadError | react
  message    text,
  stack      text,
  url        text,
  user_agent text
);

alter table public.client_errors enable row level security;

-- INSERT-only for everyone (anon + authenticated). No SELECT/UPDATE/DELETE policy, so
-- clients can WRITE a report but can never READ the table back — there is no read hole,
-- and no cross-user visibility (admins read via the dashboard / service role, which
-- bypasses RLS). The WITH CHECK lets a row be attributed only to the caller (or left
-- anonymous), so a client cannot forge someone else's user_id; the column default fills
-- in auth.uid() when the client omits it (which it does).
drop policy if exists "anyone can log a client error" on public.client_errors;
create policy "anyone can log a client error"
  on public.client_errors
  for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- Triage by recency.
create index if not exists client_errors_at_idx on public.client_errors (at desc);
