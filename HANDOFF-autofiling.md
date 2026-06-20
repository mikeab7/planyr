# Handoff — Auto-filing (B297): drop a drawing → it files itself

**For the next session (Claude Cowork / coworker).** This is the orientation brief for the
auto-filing feature. The code is **built, wired, tested, and merged to `main` — but switched
OFF (dormant)** until the cloud read service is provisioned. Read this top-to-bottom; the
deeper record lives in `CLAUDE.md` (DONE & VERIFIED → "Document Review — auto-filing backend"),
`BACKLOG-DONE.md` (B297), and `VERIFICATION.md` (V73).

---

## The goal (one line)

Drop a PDF/drawing onto Planyr → it reads the **title block** → matches it to one of the named
projects → **auto-names + auto-files** it into the right project + discipline. Anything it
isn't sure about goes to a **"needs filing" tray** for one-click confirm. **It never
auto-guesses** — a misfiled drawing is worse than an unfiled one.

## Current status: BUILT + WIRED + TESTED, gated dormant

Same posture as the convert (B238) and Google Drive (B207) backends: the code is complete and
on `main`, but **off by default** so it ships with zero behavior change. When off, dropping a
PDF files manually exactly as before (a 404/503 from the not-yet-deployed proxy is a graceful
skip, not an error).

- **lint 0 · 602 tests (52 new) · build green**; the doc-review lazy chunk split still holds.
- **Headless self-verified** (`ui-audit/verify-b297-autofiling.mjs`, logged-out): the Project
  Files drawer opens, the new imports evaluate in a real browser, **0 page/console errors**,
  auto-filing dormant by default.

## What's built (the 4 deliverables + the wiring)

1. **Title-block reader** — `server/filing/titleBlockReader.js`. Mirrors the client
   `src/workspaces/site-planner/lib/titleReader.js` request shape (model `claude-opus-4-8`,
   adaptive thinking, a `json_schema` output, the PDF as a base64 `document` block) but runs
   **server-side** (the API key must never reach the browser) and calls the Messages API over
   **raw `fetch` with an injectable `fetchImpl`** (like `server/convert/aps.js`) so the Cloud
   Run image is dependency-free and the read is unit-testable without a key. **One read, two
   payoffs:** the same pass returns the filing fields AND the placement-readiness facts (scale,
   north arrow, boundary, coords, dimensions) in the `src/shared/placement/placementFacts.js`
   shape.
2. **Matcher** — `server/filing/matcher.js` (pure). Scores each project on parcel/account
   (exact) → job number (exact) → address (token overlap) → name (token overlap), combined
   noisy-or. A confident **single** project → `matched`; **no / multiple / low-confidence** →
   `needsFiling` with a reason. Transparent (`scoreProject` lists the signal it matched on).
   Naming via `server/filing/naming.js` mirrors `reviewStore.composeTitle`.
3. **File-facts index (Supabase Postgres, NOT /server)** — `src/workspaces/doc-review/db/
   file_facts.sql` creates `public.file_facts` (one small row per filed drawing: project /
   discipline / sheet / revision / date / match-confidence / needs-filing / placement jsonb),
   RLS private-by-default, indexed for "project → discipline → latest set". Client I/O:
   `reviewStore.upsertFileFacts/listFileFacts` + pure helpers in `lib/fileIndex.js`.
4. **`capturePlacementFacts` wired** — `src/workspaces/doc-review/lib/autofiling.js` is the
   real `createIndexProvider`: `capturePlacementFacts` + `autofile` ride the SAME server read.
   `backendReady` reflects `VITE_AUTOFILE_ENABLED` honestly. Same-origin proxy
   `functions/api/file.js` (503 until `DOC_FILING_URL` is set). The `ProjectFilesDrawer` drop
   handler auto-files when `backendReady`, else the exact prior manual path.

Service/HTTP glue: `server/filing/filingService.js` (read → match → decision + index row) +
`server/filing/server.js` (`POST /file` PDF bytes + `X-Planyr-Projects` base64 header; `GET
/health`; honest status codes — 200/400/413/422/503, never a 200 with a junk decision).
`server/filing/Dockerfile` + `server/filing/README.md`.

### File map
```
server/filing/                         # the Cloud Run service (NEW)
  config.js  titleBlockReader.js  matcher.js  naming.js
  filingService.js  server.js  Dockerfile  README.md
functions/api/file.js                  # same-origin proxy → Cloud Run (gated on DOC_FILING_URL)
src/workspaces/doc-review/
  db/file_facts.sql                     # the index table + RLS (run once)
  lib/autofiling.js                     # the real index provider (capturePlacementFacts + autofile)
  lib/fileIndex.js                      # pure helpers: toFactsRow, mergeFactsIntoReviews
  lib/reviewStore.js                    # + upsertFileFacts / listFileFacts; fileNewReview takes docDate
  components/ProjectFilesDrawer.jsx     # drop handler auto-files when backendReady
  DocReview.jsx                         # passes indexProvider={autofilingProvider}
test/docFiling.test.js (37)  test/autofiling.test.js (15)
ui-audit/verify-b297-autofiling.mjs    # headless smoke
```

## What remains

### A. Owner provisioning — the ONE hard blocker (turns it on)
The read needs the Claude API key on a deployed cloud service; that's account/secret work,
not code. When ready:
1. `gcloud run deploy planyr-doc-filing --source server/ --region <region>
   --no-allow-unauthenticated` and set **`ANTHROPIC_API_KEY`** (server-side secret — prefer
   `--set-secrets`).
2. On the Cloudflare Pages project, set **`DOC_FILING_URL`** = the Cloud Run URL, and
   **`VITE_AUTOFILE_ENABLED=1`**.
3. Run **`src/workspaces/doc-review/db/file_facts.sql`** once in the Supabase SQL editor.
See `server/filing/README.md` for the full deploy notes + the `/api/file` proxy auth wiring
(the Cloud Run service runs `--no-allow-unauthenticated`; wire identity-token/header auth on
the proxy → service hop at deploy time).

### B. Live verification (VERIFICATION V73) — after A
Signed-in, on planyr.io: Markup → **Files** → drop a real construction sheet (e.g. the owner's
KG B1 / Jacintoport sets). Confirm it reads the title block, routes to the right project +
discipline, auto-names it, and a low/ambiguous match lands in the holding area for one-click
confirm. (Can't run headless here — the read needs the key, and the drop UI is signed-in only.)

### C. Sensible follow-ons (not blockers)
- **Project-alias enrichment (high value, small lift).** The matcher already supports
  aliases (`{ names, addresses, parcels, jobNumbers }`) but the client currently feeds it only
  project **names** (`reviewStore.listProjects` returns `{ id, name, status }`). Enrich the
  projects passed to `autofile` with each site's address/parcel from the Site Model
  (`sites.data` carries parcels + origin) so matching gets the strong exact-ID signals. This
  is the single biggest accuracy upgrade.
- **Placement pixel-geometry** is intentionally NOT in the read (the read captures scale-bar
  *presence* + stated scale; measuring the bar's drawn length is the CV step) — that's already
  tracked as **B268 / B183**.
- **Scanned/raster sheets**: the Claude PDF API reads scanned PDFs natively (vision), so the
  read path largely covers it; the in-Markup OCR sibling is **B266 / B267**.

## Key decisions to preserve
- **Never auto-guess.** Confident single match only; otherwise the holding area. The matcher's
  thresholds are tunable via env (`FILING_MIN_CONFIDENCE` / `FILING_MIN_MARGIN`).
- **The API key is server-side only** — never a `VITE_` var, never the browser bundle, never
  committed. That's the whole reason the read is `/server` compute, not Supabase.
- **The file-facts INDEX is Supabase Postgres data**, not `/server`. The `/server` service is
  stateless compute; it returns a decision, the client persists the index row.
- **No regression while dormant** — every "not deployed/enabled" path is a graceful skip, and
  the drawer falls back to today's manual filing.
