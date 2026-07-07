-- Element-level sync, phase 3 (B672) — FREEZE the whole-doc blob at the read cutover.
-- Run ONCE (Supabase SQL editor or MCP) at the moment the B672 build deploys, AFTER re-running
-- db/site_elements_backfill.sql (its only-if-older guards make the re-run safe) so the rows
-- capture any blob-side edit made since phase 1. Idempotent.
--
-- What "frozen" means: from this deploy on, signed-in clients write the element collections ONLY
-- as site_elements rows; the sites.data column they push is a SLIM HEADER (elementsInRows: true).
-- `data_backup` below is the last full pre-cutover blob, kept ~30 days as the emergency rollback
-- (db/site_elements_down.sql rebuilds data from rows; this column is the belt to that suspender).
-- Dropping it later is a deliberate one-liner recorded in OWNER-TODO, never automatic.

alter table public.sites add column if not exists data_backup jsonb;

update public.sites
   set data_backup = data
 where data_backup is null;
