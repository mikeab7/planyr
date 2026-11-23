# Two backends, don't conflate

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

## Two backends — don't conflate
Two layers that talk **over the network** — one for **data**, one for **compute**. Never
conflate them.

1. **Supabase — the data / auth / storage layer (BUILT).** Cloud Postgres, email/password
   auth, row-level security, and cloud save/load of site data **and** Document Review state
   (the `doc_reviews` table + the `doc-review-files` Storage bucket, same anon client +
   private-by-default RLS). The **frontend talks to Supabase directly with the anon key** —
   which is safe to ship in the browser **because RLS protects it** (a request can only
   ever see/write the signed-in user's own rows). This is the **permanent home for user
   data**; little custom server code.
2. **The server-side compute/integration tier — two delivery shapes, DIFFERENT deploy status.**
   Don't lump them: the **Drive storage backend is LIVE on the edge**; the **heavy CAD/AI compute
   is built in-repo but not yet deployed** to Cloud Run.
   - **✅ LIVE & DEPLOYED — Google Drive storage (bytes I/O).** The storage backend
     (`server/storage/`, B206–B209 / B207) runs **IN same-origin Cloudflare Pages Functions** —
     Drive byte-I/O needs no container, and same-origin means no CORS. It is the one home for
     Document Review source files: **uploads go CHUNKED through `/api/uploads/*`** (B409 rework —
     ~16 MB slices relayed to a Drive resumable session held server-side in `public.upload_sessions`,
     so ANY file size works; no whole-file request ever rides through the Worker) and **downloads
     STREAM through `GET /api/files` with Range→206** so huge PDFs open progressively. The old
     Supabase Storage upload fallback was REMOVED (its 50 MB cap caused silent "oversize" failures;
     pre-cutover files still read back). The Planyr-key↔Drive-file-id map persists in **Supabase Postgres**
     (`server/storage/db/drive_files.sql`, own-row RLS) so the stateless Function can't lose it;
     the queryable **file-facts index** also lives in Supabase (`doc-review/db/file_facts.sql`),
     not Drive. The one-time OAuth *consent* callback is a sibling Pages Function
     (`functions/api/auth/google/*`); `functions/api/drive/selftest.js` is a guarded round-trip
     smoke test. **Provisioned + owner-verified 2026-06-22 in Cloudflare Pages Production:**
     `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` + `PLANYR_STORAGE_BACKEND=drive` + `SUPABASE_URL/ANON_KEY`.
     The chunked path **removes every per-file size ceiling** (Worker body/memory caps + the old
     Supabase 50 MB cap all cleared). **⛔ Do NOT attempt browser-direct-to-Drive uploads** — CORS-dead
     (no readable `Location` header, no ACAO on preflight; refuted 2026-07-11). **⛔ Do NOT re-mint
     `GOOGLE_REFRESH_TOKEN`** — a fresh consent no longer matches the deployed secret and would take
     Drive filing offline.
   - **⏳ Built in-repo, NOT yet deployed — Cloud Run.** Scale-to-zero containers (idle = free; a
     request spins one up) for work that genuinely needs a container or a server-only key:
     - **DWG→DXF conversion** — **LibreDWG** primary (free, native binary compiled into the
       container image), **Autodesk APS Model Derivative** fallback for hard LibreDWG failures
       (dormant behind `APS_ENABLED`, **off** until the APS account is provisioned; a LibreDWG
       failure with APS off returns an explicit error, never a silent success). Code:
       `server/convert/` (B238). LibreDWG needs a real container (native binary + filesystem) —
       exactly why this is Cloud Run and not a Pages Function.
     - **Tier-2 AI auto-filing title-block read** — `server/filing/` (B299): reads a dropped
       drawing's title block with the Claude API (key **server-side only**), matches it to a named
       project (**never auto-guesses**), returns a filing decision + placement facts. Dormant
       behind `ANTHROPIC_API_KEY` / `DOC_FILING_URL` / `VITE_AUTOFILE_ENABLED` (the not-yet-deployed
       proxy `functions/api/file.js` 503s → the drawer files manually, no regression). NOTE:
       **Tier-1 auto-filing (B312, plain code in the browser) is LIVE default-on** — this AI tier is
       only the scanned/image-only fallback.

   **All third-party secrets stay server-side only** — the APS key, the **Anthropic read key**
   (auto-filing), the **Google credentials** (Drive), and the Supabase **service-role** key. They live
   in the Cloudflare Pages env as **encrypted secrets read only by the server-side `functions/api/*`
   handlers** (or on Cloud Run) — **never inlined into the public browser bundle** (never a `VITE_`
   var). The only Supabase key that reaches the frontend is the RLS-protected **anon** key.

So the **data** backend (Supabase) and the **Drive storage** backend (the `functions/api/files.js`
Pages Function) are **LIVE**; the **Cloud Run** compute — DWG→DXF conversion + the Tier-2 AI filing
read — is built in-repo but **not yet deployed**. Keep the **data**, **storage**, and **heavy-compute**
layers distinct when reasoning about what exists.

---

# Technical reference — see `docs/REFERENCE.md`

Deep implementation detail (Site Model schema, map-layer plumbing, Supabase DDL/RLS, Document Review persistence, GIS plumbing, the sandbox Playwright quirk) lives in **`docs/REFERENCE.md`**. Pull it up on demand when you touch that subsystem — you do not need it loaded to orient.
