-- Admin allowlist (B711904 / NEW-1) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), idempotent, safe to re-run.
--
-- WHY a table + a SECURITY DEFINER function, and not a SELECT policy: this is
-- deliberately NOT a role system yet — it's a short allowlist of user ids permitted to see
-- the internal /admin page, starting with Michael's own account. `admin_users` has RLS
-- enabled and NO policies at all, which means the default-deny applies to every role
-- (anon, authenticated, and even the table owner via PostgREST) — nobody can read or write
-- it directly from the client, ever. The ONLY door in or out is `is_admin()`, a
-- SECURITY DEFINER function that runs as its owner (bypassing RLS internally) and returns
-- nothing but a boolean, so it can never leak the allowlist's contents even to an admin.
--
-- This is intentionally the SAME shape as the client_errors read problem: that table stays
-- INSERT-only by design (B279) precisely so a SELECT policy is never added to make a check
-- "easier" (PR #953). Here the equivalent discipline is: admin_users never gets a SELECT
-- policy either — every future admin-gated read (NEW-2..NEW-5) goes through its own
-- SECURITY DEFINER RPC that calls is_admin() internally, never through a client-side
-- policy on this table or on the data it protects.

create table if not exists public.admin_users (
  user_id  uuid        primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);

alter table public.admin_users enable row level security;
-- Deliberately zero policies — RLS + no policy = no role can select/insert/update/delete
-- this table via PostgREST/supabase-js. Changes to the allowlist happen only via the SQL
-- editor (service role) or a future dedicated admin-management RPC, never a client write.

-- The one door: true iff the CALLING user's own id is on the allowlist. Reveals nothing
-- about who else is on it, and errors closed (any exception is `false` to the caller — see
-- checkIsAdmin() in src/workspaces/admin/lib/adminAccess.js, which treats an RPC error the
-- same as a `false` answer).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Seed: Michael's own account (mikeabmab@live.com), the only entry to start with (see
-- CLAUDE.md — "this is not a role system yet").
insert into public.admin_users (user_id, note)
values ('b147d90d-b610-423d-af65-7e004f0ad72f', 'owner')
on conflict (user_id) do nothing;
