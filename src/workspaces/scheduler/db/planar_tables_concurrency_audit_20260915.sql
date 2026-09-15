-- NEW-2 concurrency audit (B1629616, 2026-09-15) — THE APPLIED DDL, committed as a record.
--
-- ⛔ THIS FILE IS A RECORD, NOT A SCRIPT TO RUN AGAIN. Applied to production (Supabase project
-- `lyeqzkuiwngunutlkkmi`) via the Supabase MCP on 2026-09-15. `planar_data` is the third of the
-- four tables an owner dispatch named as apparently lacking a version column, and it is the one
-- genuinely nuanced case: the client already embeds a revision inside `value` (`__rev`, checked
-- read-then-write against the cloud before every save, per the long `_saveQueue` comment in
-- `public/sequence/index.html`), so the raw material is NOT absent — only the DATABASE-LEVEL
-- enforcement is. `planar_history` and `planar_suggestions` were pulled into the same audit
-- because they were touched by the same ownership migration (`planar_tables_owner_*.sql`) and
-- turned out to be SAFE by construction — see `docs/DATA.md` §8 for the full write-path evidence
-- and `BACKLOG.md` B1629618 for the filed (not implemented here) database-backstop fix for
-- `planar_data`. `comment on table` is idempotent; re-running this file is harmless.

comment on table public.planar_data is
  'B1629616 (NEW-2 concurrency audit, 2026-09-15): PARTIAL GAP, filed as B1629618 (not implemented in B1629616). The write pattern already carries an application-level revision (value->>''__rev'', checked client-side against the cloud''s current rev before every save, with same-tab writes serialized via the _saveQueue in public/sequence/index.html -- see the long comment above it) -- so the raw material is NOT absent, the enforcement is: the one write call site (_rawSet) issues a plain upsert with no WHERE clause tying it to the expected rev, so two overlapping cross-tab/cross-device saves can still race between the read-check and the write. Every current write funnels through that one call site, which makes a database-backstop trigger (refusing an UPDATE whose value->>''__rev'' does not exceed the stored one) mechanically simple to add -- but this table drives the owner''s live, actively-used Schedule, so the fix is filed for its own reviewed session rather than folded into an audit item.';

comment on table public.planar_history is
  'B1629616 (NEW-2 concurrency audit, 2026-09-15): SAFE BY CONSTRUCTION. Insert-only ledger -- no UPDATE policy exists on this table and no UPDATE call site anywhere in the app. A lost update is structurally impossible because there is no update path at all.';

comment on table public.planar_suggestions is
  'B1629616 (NEW-2 concurrency audit, 2026-09-15): SAFE. Every UPDATE call site (public/sequence/index.html, the mark-approved/dismissed/pending handlers) sets the "status" column alone, scoped to one row''s id -- never a whole-row replace. patch/note_text/email_* are written once at INSERT by the ingestion pipeline and never rewritten afterward. A lost update here means at most "the wrong of two clicked verdicts stuck" on one enum field -- harmless, never destroys recorded content.';
