# Auto-filing service (`/server/filing`) — B299

The **compute** half of auto-filing (distinct from the Supabase data layer). Drop a drawing →
this service **reads its title block** with the Claude API → **matches it to one of the named
projects** → returns a **filing decision** (auto-route + auto-name, or "needs filing"). A
scale-to-zero HTTP service targeting **Google Cloud Run** — it lives here, not in the browser,
because the read uses an **API key that must never reach the frontend** (KEY DECISIONS).

```
POST /file     body = PDF bytes
               header  X-Planyr-Projects: base64(JSON [{id,name,aliases?}])
               → 200 { ok, decision, placement, facts }
GET  /health   → 200 { ok, service, model, configured }
```

## What it returns

- **`decision`** — `{ matched, projectId, project, discipline, item, revision, docDate,
  suggestedName, confidence, needsFiling, reason, candidates }`. A confident **single** project
  is `matched:true`; **no / multiple / low-confidence** matches come back `needsFiling:true`
  with a `reason` (`no-readable-identifiers` / `no-match` / `ambiguous` / `low-confidence`).
  **It never auto-guesses** — a misfiled drawing is worse than an unfiled one.
- **`placement`** — placement-readiness facts (scale callout, scale bar, north arrow, drawn
  boundary, stated coordinate system, labeled dimensions) in the shape of
  `src/shared/placement/placementFacts.js`, captured in the **same read** so "Place on map"
  works later without reopening the file.
- **`facts`** — the one small index row to persist in Supabase Postgres (project, discipline,
  sheet, revision, date, placement) so files are queryable later without re-reading them.

## One read, two payoffs

The title-block read (`titleBlockReader.js`) mirrors the client `titleReader.js` request shape
(model `claude-opus-4-8`, adaptive thinking, a `json_schema` output, the PDF as a base64
`document` block) but calls the Messages API over **raw `fetch`** with an injectable
`fetchImpl` — like `server/convert/aps.js` — so the container needs no SDK and the read logic
is unit-testable without a key. The same pass fills both the filing fields and the placement
facts.

## No silent failures

Every path returns a result-shaped object and the HTTP layer maps it to an honest status:
`200` (a real decision), `400` (no/empty body), `413` (over the size cap), `422` (the drawing
couldn't be read/parsed), `503` (the API key isn't set — an infra fault). A `200` is **only**
ever a real read.

## Configuration (server-side env only)

Never a `VITE_` var, never committed, never on the public Cloudflare Pages deploy.

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listen port (Cloud Run injects this). |
| `ANTHROPIC_API_KEY` | — | **The read key. Server-side secret only.** Absent → `/file` returns an explicit 503, never a fabricated read. |
| `FILING_MODEL` | `claude-opus-4-8` | Model for the read (matches the client title reader). |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Messages API base. |
| `FILING_MAX_UPLOAD_BYTES` | `33554432` | Upload cap (32 MB — the Claude PDF request limit). |
| `FILING_MIN_CONFIDENCE` / `FILING_MIN_MARGIN` | `0.6` / `0.15` | Matcher thresholds (auto-route only above confidence, and clear of the runner-up). |

## Run it

```bash
# Local container (build context is /server):
docker build -f server/filing/Dockerfile -t planyr-doc-filing server/
docker run --rm -p 8080:8080 -e ANTHROPIC_API_KEY=sk-... planyr-doc-filing
curl -s localhost:8080/health
# File a drawing (projects header is base64 of a JSON array):
PJ=$(printf '[{"id":"g1","name":"Katy Grand"}]' | base64 -w0)
curl -s --data-binary @sheet.pdf -H "X-Planyr-Projects: $PJ" localhost:8080/file | jq .

# Bare Node:
ANTHROPIC_API_KEY=sk-... node server/filing/server.js
```

## How the frontend reaches it (gated, like the Drive backend)

The Project Files drawer files through `src/workspaces/doc-review/lib/autofiling.js`, which
POSTs the dropped PDF to the same-origin **`/api/file`** Cloudflare Pages Function
(`functions/api/file.js`). That function verifies the Supabase session and forwards to this
Cloud Run service at **`DOC_FILING_URL`**. Until `DOC_FILING_URL` is set the function returns
a clear 503 and the drawer **falls back to manual filing** — no regression, exactly the
"dormant until provisioned" contract the convert (APS) and Drive backends use. The queryable
**file-facts index lives in Supabase Postgres** (`doc-review/db/file_facts.sql`), not here.

## Deploy (follow-on — needs the GCP project + the key)

```bash
gcloud run deploy planyr-doc-filing \
  --source server/ --region <region> --no-allow-unauthenticated \
  --set-env-vars ANTHROPIC_API_KEY=sk-...        # secret; prefer --set-secrets in practice
```

Then set `DOC_FILING_URL` (the Cloud Run URL) on the Cloudflare Pages project so `/api/file`
can reach it. The browser never sees the key; it only ever talks to the same-origin proxy.
