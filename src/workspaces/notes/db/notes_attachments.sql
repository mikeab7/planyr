-- Notes attachments (NEW-5) — THE APPLIED DDL, committed as a record.
--
-- ⛔ THIS FILE IS A RECORD, NOT A SCRIPT FOR THE OWNER TO RUN. Same discipline as
-- `notes_cloud_sync.sql` beside it: the repo must not be the one place the schema does not
-- exist. It is idempotent and safe to re-run against a NEW project; against the live one it
-- has already been applied.
--
-- ═══ WHAT IT DOES, AND WHY IT IS THIS RATHER THAN A NEW BUCKET ═══════════════════════════
-- Notes could hold pictures and nothing else. The `notes-images` bucket carries an explicit
-- image-only MIME allow-list, so a PDF, an XLSX or a DWG was refused at the door — which is
-- exactly the gap this closes.
--
-- The choice was a NEW bucket + a new table, or RELAXING this one and carrying a row per
-- file in the table that already exists. This is the second, deliberately: the picture tier
-- already has a sync plan, a purge cascade, an orphan sweep and a per-notebook ceiling, and a
-- parallel tier would mean a second copy of every one of those — and a second way to leak
-- bytes. An attachment is a picture that is not a picture; it is not a new subsystem.
--
--   1. `notes-images` stops refusing non-image types (`allowed_mime_types = null`) and its
--      per-object ceiling rises to 50 MB. The CLIENT still enforces its own ceiling before a
--      byte is written (`MAX_FILE_BYTES` in lib/notesStore.js), so an oversize file is a
--      NAMED refusal in the app rather than an opaque 400 from storage.
--   2. `public.notes_images` gains `name` (the file's real filename — a picture never needed
--      one) and `kind` ('image' | 'file'). `kind` DEFAULTS TO 'image', which is what every
--      existing row is, so nothing has to be backfilled and no existing row changes meaning.
--
-- Nothing else moves: the bucket stays PRIVATE, the four own-row storage policies are
-- untouched, the objects stay at `<auth.uid()>/<id>`, and RLS on the table is unchanged.
-- No new table, no new policy, no new index.
--
-- ⛔ THE BUCKET NAME STAYS `notes-images` EVEN THOUGH IT NOW HOLDS MORE THAN IMAGES.
-- Renaming a bucket orphans every object already in it, which would break every picture in
-- every existing note for the sake of a more accurate word. The table comment below says
-- what it really holds; do not "tidy" this later.
--
-- ════════════════════════════════════════════════════════════════════════════════════════
-- BEGIN MIGRATION — notes_attachments_new5
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------- the row gains a name
alter table public.notes_images
  add column if not exists name text;

-- 'image' is what every pre-existing row is, so the default backfills the whole table
-- correctly with no UPDATE and no downtime.
alter table public.notes_images
  add column if not exists kind text not null default 'image';

-- A typo in `kind` would silently create a third class nothing reads. Two values, checked.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notes_images_kind_check'
  ) then
    alter table public.notes_images
      add constraint notes_images_kind_check check (kind in ('image', 'file'));
  end if;
end $$;

comment on table public.notes_images is
  'Picture AND attached-file records for notes (kind = image | file). Bytes live in the private notes-images bucket at <auth.uid()>/<id>; this row is the index. Purged only by the note purge cascade.';

comment on column public.notes_images.name is
  'The attached file''s original filename. Null for pictures, which are referenced by id and carry alt text in the document instead.';

-- ---------------------------------------------------------------- the bucket stops refusing files
-- `allowed_mime_types = null` means "no restriction". The client enforces its own ceiling and
-- names an oversize file before anything is uploaded (LOUD-FAILURE), so this limit is the
-- backstop rather than the user-facing rule.
update storage.buckets
   set allowed_mime_types = null,
       file_size_limit    = 52428800          -- 50 MB
 where id = 'notes-images';

-- ════════════════════════════════════════════════════════════════════════════════════════
-- END MIGRATION
-- ════════════════════════════════════════════════════════════════════════════════════════
