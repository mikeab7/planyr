-- NEW-2 — the `module` column of public.client_errors is a machine SLUG
-- (site-planner / doc-review / scheduler / notes / library / model / food / admin / …), the
-- SAME vocabulary every telemetry source reports (clientErrors.js's setTelemetryModule, fed
-- Shell.jsx's workspace-registry ids). The React error boundary used to report a human-facing
-- display name instead ("Site Planyr", "Sequence Planyr", "Review"/"Document Review", "Notes",
-- "Food") — measured on production 2026-09-05: 182 rows across six display names, none of
-- which matched any other row in the table, so a per-module query/dashboard/alert keyed on
-- the real slug silently missed every React crash.
--
-- Run ONCE, after client_errors.sql exists. Idempotent (the backfill UPDATEs are no-ops once
-- applied; the constraint is dropped-and-recreated so a re-run is safe).

-- Backfill: the six display names measured on production, mapped to the slug the OTHER rows
-- for that same module already use.
update public.client_errors set module = 'site-planner' where module = 'Site Planyr';
update public.client_errors set module = 'scheduler'     where module = 'Sequence Planyr';
update public.client_errors set module = 'doc-review'    where module in ('Review', 'Document Review');
update public.client_errors set module = 'notes'         where module = 'Notes';
update public.client_errors set module = 'food'          where module = 'Food';

-- Going forward: a slug is lowercase letters/digits, hyphen-separated, no spaces and no
-- uppercase — which every real module id already is (site-planner, doc-review, library,
-- scheduler, notes, model, food, admin, design-gallery, …) and which NO display name can ever
-- match (a display name always carries a capital letter, a space, or both). A SHAPE constraint
-- rather than a fixed enum, so a new workspace never needs a migration here to stay legal.
alter table public.client_errors drop constraint if exists client_errors_module_is_slug;
alter table public.client_errors add constraint client_errors_module_is_slug
  check (module is null or module ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
