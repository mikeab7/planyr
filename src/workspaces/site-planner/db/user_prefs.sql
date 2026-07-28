-- Account-level user preferences (NEW-3) — the store the Standards panel's "All projects"
-- default scope hangs on. Run ONCE in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi).
-- Idempotent: safe to re-run.
--
-- WHY A COLUMN ON public.profiles, NOT A NEW TABLE
-- `public.profiles` is already the one-row-per-auth-user record with own-row RLS (db/profiles.sql),
-- and its own header anticipated exactly this ("org membership, role, display prefs"). A jsonb bag
-- keeps preference growth additive — a new preference is a new key, never a migration — and it
-- inherits the profiles RLS policies unchanged, so a request can still only ever read/write the
-- caller's own row. No new table, no new policy, no new client.
--
-- WHY IT MATTERS (the thing localStorage cannot do)
-- The owner works from two machines. A default set at the office has to follow him home, so
-- "default for ALL projects" must live on the ACCOUNT, not the browser. localStorage would make it
-- silently per-machine — a wrong answer dressed as a right one. Signed-out sessions fall back to a
-- local mirror and say so; the cloud row is the source of truth the moment you sign in.

-- 1) The column ---------------------------------------------------------------
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.prefs is
  'Account-level user preferences (NEW-3). Additive jsonb bag; own-row RLS inherited from public.profiles. Current keys: planStandards (cross-project element/parcel style defaults).';

-- 2) RLS ----------------------------------------------------------------------
-- Nothing to do: public.profiles already has SELECT/INSERT/UPDATE policies scoped to
-- (select auth.uid()) = id, and a new column is covered by them automatically. Verified by the
-- checks below rather than assumed.

-- 3) Verify (read-only; safe to run any time) ---------------------------------
-- Expect one row: prefs | jsonb | NO | '{}'::jsonb
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles' and column_name = 'prefs';
-- Expect RLS on and the three own-row policies still present:
--   select relrowsecurity from pg_class where oid = 'public.profiles'::regclass;
--   select polname from pg_policy where polrelid = 'public.profiles'::regclass;
