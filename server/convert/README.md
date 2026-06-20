# DWG→DXF conversion service (`/server/convert`) — B238

The **compute** half of Planyr's backend (distinct from the Supabase data layer). A small,
scale-to-zero HTTP service that turns a **DWG** drawing into a **DXF** so the rest of the
pipeline (and eventually the planner overlay) can read it. Targets **Google Cloud Run**.

```
POST /convert   body = DWG bytes        → 200 DXF bytes        (header X-Convert-Engine)
GET  /health                            → 200 { ok, service, engine, apsFallback }
```

## Engines (primary → fallback)

1. **LibreDWG (`dwg2dxf`)** — primary. Free, GPL, native binary compiled into the image
   (`Dockerfile`, built from source — it isn't in the Debian/Ubuntu repos). Handles the
   vast majority of files at zero marginal cost.
2. **Autodesk APS Model Derivative** — fallback for hard LibreDWG failures. **Dormant by
   default** (`APS_ENABLED` off) until the Autodesk account is provisioned. When LibreDWG
   fails and APS is off, the service returns an **explicit error** — never a silent success
   (a silent failure is treated as a crash; see `result.js`).

## No silent failures

Every path returns a result-shaped object and the HTTP layer maps it to an honest status:
`200` (DXF returned), `400` (no/empty body), `413` (over the size cap), `422` (the drawing
couldn't be converted), `503` (the engine binary is missing — an infra fault). A `200` is
**only** ever a real DXF.

## Configuration (server-side env only)

Never a `VITE_` var, never committed, never on the public Cloudflare Pages deploy.

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listen port (Cloud Run injects this). |
| `LIBREDWG_BIN` | `dwg2dxf` | Path/name of the LibreDWG binary (bundled in the image). |
| `CONVERT_TIMEOUT_MS` | `120000` | Per-conversion timeout. |
| `MAX_UPLOAD_BYTES` | `209715200` | Upload size cap (200 MB). |
| `APS_ENABLED` | _off_ | Arm the APS fallback. **Leave off** until APS is provisioned. |
| `APS_CLIENT_ID` / `APS_CLIENT_SECRET` | — | APS app credentials (secret). |

## Run it

```bash
# Local container (build context is /server):
docker build -f server/convert/Dockerfile -t planyr-dwg-convert server/
docker run --rm -p 8080:8080 planyr-dwg-convert
curl -s localhost:8080/health
curl -s --data-binary @drawing.dwg -o out.dxf localhost:8080/convert

# Bare Node (needs a local dwg2dxf on PATH, or set LIBREDWG_BIN):
node server/convert/server.js
```

> **Sandbox build note:** this repo's web sandbox routes HTTPS through a TLS-inspecting
> proxy that `curl` inside a build doesn't trust (see `CLAUDE.md`). Pass
> `--build-arg CURL_INSECURE=1` to build here. Production (Cloud Build) omits it → full TLS
> verification.

## Deploy (follow-on — needs the GCP project)

Cloud Run deployment waits on the GCP project being provisioned in the Google Cloud Console.
Once it exists:

```bash
gcloud run deploy planyr-dwg-convert \
  --source server/ --region <region> --no-allow-unauthenticated
```

The browser/Supabase side calls this service over the network (authenticated) in the backend
tranche; it does not ship in the frontend bundle.
