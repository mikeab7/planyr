# server/ — placeholder (NOT built, NOT deployed)

This folder is intentionally empty for now. It will hold **backend code and
secrets** in a later phase (e.g. Autodesk APS, Google Drive integrations) — things
that must run server-side and must never ship in the public frontend bundle.

Rules for when this is populated:
- **Nothing here is built or deployed** by the current frontend pipeline (Vite →
  `dist/`, published by Cloudflare Pages). It is excluded from the static build.
- **Secrets live only here**, in environment/secret stores — never committed, never
  imported by anything under `src/` that auto-deploys to a public URL.
- Keep this isolated from any auto-merge-to-public-URL path.

Until then: frontend is a public static app with no secrets (Supabase anon key is
public-safe and gated by RLS).
