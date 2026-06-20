# Storage subsystem (`/server/storage`) — B206–B209

The single seam the app uses for **file bytes** (drawings, surveys, PDFs). The app talks
ONLY to the adapter and references files ONLY by Planyr's own stable keys; the concrete
backend (memory stub today, Google Drive next) swaps in one place with zero app changes.

```
app  ──>  adapter.js  ──>  backend (memory | drive)
                │
                ├── idMap.js        Planyr-key ↔ backend-id (only translator; no id leaks)
                ├── linkProvider.js  share links (Drive-native now → Planyr signed later)
                └── result.js        every op returns {ok} — never a silent failure
```

- **B206 / NEW-1** — adapter discipline: `adapter.js` is the only entry point; `idMap.js`
  is the only Planyr↔backend translator. Acceptance: point at a different backend and
  nothing outside this folder changes (see `test/storageAdapter.test.js`).
- **B207 / NEW-2** — `backends/driveBackend.js`: Google Drive, **bytes only**. The index
  of file facts lives in Supabase Postgres, not Drive. Scaffolded; **blocked on the manual
  Google setup below.**
- **B208 / NEW-3** — `linkProvider.js`: all share links from one interface (Drive-native
  today, Planyr `planyr.io/s/<token>` later — a one-place switch).
- **B209 / NEW-4** — `result.js` + `attempt()`: every op reports visible success/failure.

## What I need from you (the part code can't do) — for Cowork

The Drive backend is fully scaffolded; to make it **live**, I need these from the Google
side (Cowork can produce them). Drop them into the server environment — **never** into the
frontend build, never a `VITE_` var, never committed (same rule as the APS key):

| Env var | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client id — from a Google Cloud project, OAuth app set to **Internal** (Workspace user type, so no Google verification + no 7-day token expiry) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (server-side only) |
| `GOOGLE_REFRESH_TOKEN` | A refresh token minted once with scope **`drive.file`** (least privilege — the app only touches files it creates; broader Drive scope only if Planyr must read pre-existing files, which is a deliberate decision, not a default) |
| `PLANYR_DRIVE_ROOT_FOLDER` | The Drive folder id under which Planyr files everything |
| `PLANYR_STORAGE_BACKEND` | set to `drive` to flip off the memory stub |

Once those exist, the only remaining code is the thin Drive REST `client` (the interface
is documented at the top of `driveBackend.js`) — a fill-in, not a rebuild — plus a
Supabase-Postgres-backed `idMap` store in place of the in-memory one. No app changes.

Note: moving file storage to Drive **removes the Supabase free-tier 50 MB-per-file ceiling**.

## OAuth client — the redirect (callback) URI to register

When creating the OAuth **client** (Application type = Web application), Google asks for
**Authorized redirect URIs**. These must match what the backend sends byte-for-byte, so
they are pinned in code at `server/oauth/config.js` — register these exact strings:

| Authorized redirect URI | When |
|---|---|
| `https://planyr.io/api/auth/google/callback` | **Production — register this** (the live integration) |
| `http://localhost:8788/api/auth/google/callback` | Optional — only for exercising the flow against a local backend |

Hosting decision (2026-06-19): the backend runs at the **same origin** as the app under
`/api` (Cloudflare Pages Functions / Worker on the planyr.io domain), so the callback is
same-origin — no second host, no CORS. Reversible: if hosting moves, edit the authorized
URIs in Google **and** `server/oauth/config.js` together. The OAuth client also yields the
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` above; the `GOOGLE_REFRESH_TOKEN` is minted
once by completing the consent flow through that client.

