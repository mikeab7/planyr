-- Model workspace — cloud persistence schema.
-- Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi). Idempotent: safe to
-- re-run. Mirrors doc_reviews.sql's ORIGINAL four-column optimistic-concurrency shape
-- (id/user_id/version/updated_at/data jsonb, four plain-owner RLS policies) — the shape that
-- file itself creates, per src/workspaces/doc-review/db/doc_reviews.sql, NOT the live
-- public.doc_reviews table in production today, which has since grown team_id/project_id/
-- deleted_at/etc. through several LATER migrations (team_storage.sql, doc_reviews_soft_delete.sql,
-- file_facts_category.sql, advisor_hardening.sql) layered on top of that original file. This
-- table intentionally has no team_id and no team-aware policies — it is a private, per-user
-- table, matching the plain payload src/workspaces/model/lib/modelStore.js actually sends
-- (id/user_id/version/data — never team_id). Touches no shared object: no create-or-replace of
-- is_team_member/is_team_admin, no reference to storage.objects, every drop is `if exists` on
-- this migration's own new table only. The guarded-write CONTRACT (optimistic-concurrency
-- compare-and-swap) is still the same proven code every cloud table here uses
-- (src/shared/cloud/optimisticUpsert.js) — it is the RLS/team shape that intentionally differs.
--
-- One row per project's spreadsheet (id = the Site Planner's project/group id). `data` is the
-- whole serialized sheet (columns, formulas, formats, cell values) from
-- src/workspaces/model/lib/sheetModel.js; `version` is the optimistic-concurrency guard.
--
-- NOT YET APPLIED to production as of this PR — the session that wrote this had read-only
-- (SELECT-only) production access, so it is handed to the owner to run rather than applied
-- here (same precedent as the Comps migrations — see src/shared/CLAUDE.md → `comps/`). Until
-- this runs, the Model module saves to this device's local storage only and says so.

create table if not exists public.model_sheets (
  id          text not null,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  data        jsonb not null,        -- serialized sheet (see sheetModel.js)
  primary key (user_id, id)
);

create index if not exists model_sheets_user_updated_idx
  on public.model_sheets (user_id, updated_at desc);

-- Keep `updated_at` honest on every write, the same trigger shape doc_reviews relies on.
create or replace function public.model_sheets_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists model_sheets_touch_updated_at on public.model_sheets;
create trigger model_sheets_touch_updated_at
  before update on public.model_sheets
  for each row execute function public.model_sheets_set_updated_at();

-- RLS — private by default (identical shape to public.doc_reviews / public.sites).
alter table public.model_sheets enable row level security;

drop policy if exists "Users select own model sheets" on public.model_sheets;
drop policy if exists "Users insert own model sheets" on public.model_sheets;
drop policy if exists "Users update own model sheets" on public.model_sheets;
drop policy if exists "Users delete own model sheets" on public.model_sheets;

create policy "Users select own model sheets" on public.model_sheets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own model sheets" on public.model_sheets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own model sheets" on public.model_sheets
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own model sheets" on public.model_sheets
  for delete to authenticated using ((select auth.uid()) = user_id);
