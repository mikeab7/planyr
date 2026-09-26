-- Model workspace — ORGANIZATION-scoped spreadsheet schema (NEW-1, B1912209).
-- Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi). Idempotent: safe to re-run.
--
-- "Organization scope" in this app is NOT a multi-tenant team entity — per B1020928 (org scope for
-- Notes/Library) and B1020930 (the org-scoped Schedule agenda), it is the SAME per-account
-- ownership every other table here already uses (auth.uid() = user_id), just not tied to any one
-- project. Private by default (root CLAUDE.md's "Owner product constraints") — sharing this table
-- with anyone else is a deliberate later act, never assumed here.
--
-- Unlike public.model_sheets (exactly ONE workbook per project, id = the project id), an account
-- can hold SEVERAL organization workbooks (a portfolio pro forma, a pipeline tracker, a cost
-- database), so this table has a real, independent `id` (client-generated, crypto.randomUUID() —
-- never a project id) and a `name` a person actually reads. Soft-delete (`deleted_at`), matching
-- doc_reviews' own convention and this repo's own invariant (docs/DATA.md §13 — deletion is a
-- tombstone UPDATE, never a row DELETE) rather than a hard DELETE; the store does not expose a
-- restore UI yet (no trash browser was asked for), but a deleted row stays recoverable by hand.
--
-- Same guarded-write CONTRACT as model_sheets.sql (src/shared/cloud/optimisticUpsert.js's
-- compare-and-swap) and the SAME plain per-user RLS shape — no team_id, matching the payload
-- src/workspaces/model/lib/modelStore.js actually sends.
--
-- NOT applied to production by this session — handed to the owner to run (see the PR body / the
-- file sent alongside it). Until it runs, every cloud call below degrades to "not-provisioned"
-- and local-only editing keeps working — the same dormant-until-migrated shape model_sheets.sql
-- itself used before it was applied.

create table if not exists public.org_model_sheets (
  id          uuid not null default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'Untitled workbook',
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  data        jsonb not null,        -- serialized workbook (see sheetModel.js) — same shape model_sheets.data holds
  primary key (user_id, id)
);

create index if not exists org_model_sheets_user_updated_idx
  on public.org_model_sheets (user_id, updated_at desc);

-- Keep `updated_at` honest on every write, the same trigger shape model_sheets/doc_reviews rely on.
create or replace function public.org_model_sheets_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists org_model_sheets_touch_updated_at on public.org_model_sheets;
create trigger org_model_sheets_touch_updated_at
  before update on public.org_model_sheets
  for each row execute function public.org_model_sheets_set_updated_at();

-- RLS — private by default (identical shape to public.model_sheets).
alter table public.org_model_sheets enable row level security;

drop policy if exists "Users select own org model sheets" on public.org_model_sheets;
drop policy if exists "Users insert own org model sheets" on public.org_model_sheets;
drop policy if exists "Users update own org model sheets" on public.org_model_sheets;
drop policy if exists "Users delete own org model sheets" on public.org_model_sheets;

create policy "Users select own org model sheets" on public.org_model_sheets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own org model sheets" on public.org_model_sheets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own org model sheets" on public.org_model_sheets
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own org model sheets" on public.org_model_sheets
  for delete to authenticated using ((select auth.uid()) = user_id);

alter function public.org_model_sheets_set_updated_at() set search_path = public, pg_temp;
