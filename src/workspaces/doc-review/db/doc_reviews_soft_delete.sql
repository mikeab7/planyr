-- Soft-delete for doc_reviews (NEW-F3, delete-safety batch 2026-07-12).
--
-- Deleting a review from the UI now stamps deleted_at instead of hard-DELETEing the row, so
-- the markup work layer survives a mistaken delete: the Library's "Recently deleted" view can
-- restore it (deleted_at -> null) for ~30 days before the client's lazy purge hard-deletes it
-- (and the purged file bytes then get Google Drive's own ~30-day trash — see the NEW-F2 change
-- in server/storage/backends/driveBackend.js).
--
-- RLS note (reviewed): no policy change is made here. The existing doc_reviews UPDATE policy
-- (team_sharing.sql) allows the OWNER or ANY member of the row's team, while DELETE requires
-- owner/team-admin. Soft delete rides UPDATE — so on a shared review, any team member can move
-- it to (and restore it from) Recently deleted. That is DELIBERATE recoverable-trash semantics:
-- an editor who can already rewrite the row's whole data jsonb can bin it, binning is always
-- restorable by any member, and the PERMANENT purge still rides the stricter DELETE policy
-- (owner/team-admin only). The client degrades gracefully if this migration hasn't run
-- (missing-column -> the old immediate hard delete).
--
-- Idempotent — safe to re-run.

alter table public.doc_reviews add column if not exists deleted_at timestamptz;

-- Cheap "Recently deleted" listing: only soft-deleted rows are indexed.
create index if not exists doc_reviews_deleted_at_idx
  on public.doc_reviews (user_id, deleted_at)
  where deleted_at is not null;
