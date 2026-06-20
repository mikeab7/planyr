-- User profiles — one row per auth user, keyed to auth.uid() (B297 / NEW-1).
-- Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi). Idempotent:
-- safe to re-run. Private by default, same RLS shape as public.sites / public.doc_reviews
-- (each user only ever sees and edits their OWN row; no cross-user reads).
--
-- Why a table (not just auth user_metadata): the commercial B2B direction will want a
-- real profile record later (org membership, role, display prefs), and a queryable table
-- is the scalable foundation. Names are still seeded into user_metadata at signup
-- (auth.js signUp options.data) — the trigger below copies them into this table so there
-- is one queryable source of truth for display.

-- 1) Table -------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text,
  last_name   text,
  org         text,
  updated_at  timestamptz not null default now()
);

-- 2) RLS — private by default (identical shape to public.sites) ---------------
alter table public.profiles enable row level security;

drop policy if exists "Users select own profile" on public.profiles;
drop policy if exists "Users insert own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;

create policy "Users select own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Users insert own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- No delete policy: a profile row lives and dies with its auth user (on delete cascade).

-- 3) Trigger — create the profile row on signup ------------------------------
-- Runs as SECURITY DEFINER so the insert happens regardless of the (not-yet-existing)
-- caller session, reading the first/last/org the client passed to signUp({ data }).
-- This trigger route (vs. a client-side follow-up insert) avoids a race: the row always
-- exists by the time the user can read it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, org)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'org', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Backfill — existing users get a profile row from their metadata ---------
-- Anyone who signed up before this shipped has names in user_metadata (or nothing).
-- Seed a row so the header never has a missing profile to fall over; null names are
-- fine (the UI falls back to email — see useProfile.js).
insert into public.profiles (id, first_name, last_name, org)
select id,
       nullif(raw_user_meta_data ->> 'first_name', ''),
       nullif(raw_user_meta_data ->> 'last_name', ''),
       nullif(raw_user_meta_data ->> 'org', '')
from auth.users
on conflict (id) do nothing;
