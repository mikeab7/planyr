-- Scheduler connector — allow the anon role to INSERT and SELECT pending suggestions,
-- while keeping anon DELETE blocked. Idempotent: safe to run more than once.
--
-- Run this ONCE in the SQL editor of the SCHEDULER Supabase project
-- (ref ksetjztkplttbcehyicv — the one hardcoded in public/sequence/index.html, NOT the main app).
-- It lets the MCP connector drop suggestions into the Review panel; you still approve each one.
-- Nothing here can edit your live schedule (planar_data) — only the suggestions queue.

alter table public.planar_suggestions enable row level security;

-- INSERT: the connector (anon key) may file a suggestion.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'planar_suggestions' and policyname = 'anon can insert suggestions'
  ) then
    create policy "anon can insert suggestions"
      on public.planar_suggestions for insert to anon
      with check (true);
  end if;
end $$;

-- SELECT: the Scheduler page (anon key) reads pending suggestions to render the Review panel.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'planar_suggestions' and policyname = 'anon can read suggestions'
  ) then
    create policy "anon can read suggestions"
      on public.planar_suggestions for select to anon
      using (true);
  end if;
end $$;

-- UPDATE: Approve / Dismiss / Undo flips the status column (done by the Scheduler page).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'planar_suggestions' and policyname = 'anon can update suggestion status'
  ) then
    create policy "anon can update suggestion status"
      on public.planar_suggestions for update to anon
      using (true) with check (true);
  end if;
end $$;

-- NOTE: deliberately NO delete policy for anon — suggestions are only ever resolved by flipping
-- status to approved/dismissed, never hard-deleted via the public key.
