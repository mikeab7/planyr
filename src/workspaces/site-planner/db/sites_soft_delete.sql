-- Soft-delete for `sites` (NEW-1, 2026-07-28) — the fix for "I delete sites and they don't
-- actually delete".
--
-- THE BUG THIS CLOSES. Record-delete tombstones were client-local
-- (`planarfit:sites:deltomb:v1:<uid>` in ONE browser's localStorage) and were never replicated,
-- so a SECOND signed-in client had no way to learn a row had been deleted. Its `pullCloud` →
-- `mergePulledSites` builds the merged map from its LOCAL cache first (the B124 never-drop-
-- local-work guarantee), sees `!(id in cloudAt)`, classifies the absence as "a push that didn't
-- land", and heal-the-split `cloudUpsert`s the row straight back. Worse, the resurrection is
-- GUTTED: `site_elements_site_id_fkey` is ON DELETE CASCADE, so the hard delete destroyed every
-- element row and the re-push restored only the slim `elementsInRows` header — the project card
-- comes back and the site plan inside is empty. That is silent data loss, not a cosmetic bug.
--
-- THE FIX. Stop hard-DELETEing on a user delete. Stamping `deleted_at` makes the delete a FACT
-- EVERY CLIENT CAN READ (`cloudList` filters it out, and the merge is additionally handed the
-- server-deleted id set, so "the cloud is missing this row" becomes "the cloud says this row is
-- deleted" — heal-the-split can never resurrect it). It also means no cascade fires, so the
-- elements survive and a "Recently deleted → Restore" returns the site WHOLE. A lazy 30-day
-- purge does the real DELETE (the cascade is correct at that point).
--
-- RLS note (reviewed; identical situation to doc_reviews_soft_delete.sql / B792): no policy
-- change is made here. The live `sites` policies are UPDATE = owner OR any member of the row's
-- team, DELETE = owner OR team-admin. Soft delete rides UPDATE, so on a SHARED project any team
-- member can bin it and any member can restore it — deliberate recoverable-trash semantics: a
-- member who can already rewrite the row's whole `data` jsonb can bin it, binning is always
-- restorable, and the PERMANENT purge still rides the stricter DELETE policy (owner/team-admin).
--
-- `guard_team_rehome` (BEFORE UPDATE on sites) is unaffected: this write never touches team_id.
-- The soft-delete UPDATE also deliberately does NOT bump `version`, and no content push carries
-- a `deleted_at` key — so even a stale tab's CAS upsert re-writing the row leaves it binned.
--
-- The client degrades gracefully if this migration hasn't run (missing-column → the old
-- immediate hard delete), so deleting never regresses on a pre-migration DB.
--
-- Idempotent — safe to re-run.

alter table public.sites add column if not exists deleted_at timestamptz;

-- Cheap "Recently deleted" listing + the per-pull server-deleted id fetch: only soft-deleted
-- rows are indexed, so the common case (nothing in the bin) costs an empty index scan.
create index if not exists sites_deleted_at_idx
  on public.sites (user_id, deleted_at)
  where deleted_at is not null;

-- Keep the ordinary "my live projects" list fast now that every read carries
-- `deleted_at is null`: a partial index over exactly the rows that read returns.
create index if not exists sites_live_updated_at_idx
  on public.sites (user_id, updated_at desc)
  where deleted_at is null;
