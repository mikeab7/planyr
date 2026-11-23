# server/ — what is live, what is not

This folder holds server-side code that must never ship in the public frontend bundle. It is
excluded from the static Vite build. Secrets live only in environment/secret stores (Cloudflare
Pages env, Cloud Run), never committed and never imported by anything under `src/` that deploys.

**Status of each subfolder** (so audits stop counting dormant code as live):

| Folder | Status | Notes |
|---|---|---|
| `auth/` | **Live** | Imported by the Cloudflare Pages Functions under `functions/api/` (files, file, mailbox-proof, share). |
| `oauth/` | **Live** | Google OAuth consent start/callback (`functions/api/auth/google/*`). Do not re-mint the refresh token. |
| `storage/` | **Live** | Drive-backed file storage, id maps, folder mirror; used by `functions/api/files`, `drive/selftest`, the gis-/parcel-cache proxies. |
| `uploads/` | **Live** | Chunked resumable upload relay (`functions/api/uploads/*`). |
| `convert/` | **Built, NOT deployed** | DWG→DXF (LibreDWG, APS fallback) for a Cloud Run container. Frontend client `convertClient.js` 503s gracefully until deployed. |
| `filing/` | **Dormant** | Tier-2 AI title-block read (Claude API) for Cloud Run; off until `ANTHROPIC_API_KEY` / `DOC_FILING_URL` / `VITE_AUTOFILE_ENABLED` are set. Tier-1 auto-filing runs in the browser and does not use this folder. |
| `ingest/thoroughfare.mjs` | **Manual CLI** | One-off ingest script run by hand to regenerate thoroughfare data; not part of any deploy or runtime path. |
