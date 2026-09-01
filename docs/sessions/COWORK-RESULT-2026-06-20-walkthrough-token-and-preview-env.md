# Cowork walkthrough result — 2026-06-20 — Task A (token rotated) + Task B (previews cloud-connected)

Cowork guided the owner through `COWORK-BRIEF-2026-06-20-walkthrough-token-and-preview-env.md`
and verified each live. (Committed by Claude Code on Cowork's behalf — the GitHub token Cowork
used was rotated in Task A, so Cowork could no longer push.)

## Task A — GitHub token rotated ✅
- The leaked `github_pat_…` (from a leftover sandbox clone) is a **fine-grained** PAT. Confirmed
  **not** in the repo code or git history (0 hits) and **not** in GitHub Actions secrets (CI
  secrets are only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). Only live consumer = the push
  automation.
- Two fine-grained push tokens existed (`cowork-planyr-push`, `planyr-push-2`). GitHub never shows
  a token's value, so the leaked string couldn't be matched to one by name — so the owner
  **regenerated BOTH** (new expiries Sep 18 2026). The leaked value is now invalidated.
- **Follow-up:** the push automation (Claude Code remote env / git credential) needs one of the new
  token values the next time it pushes.

## Task B — previews cloud-connected ✅ (corrects the earlier "B2 / un-secreted" finding)
- **Correction to the record:** previews were NOT "un-secreted." The Preview scope already had
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, but they were **stale leftovers from the previous
  app version** — pointing at a **defunct Supabase project** `ksetjztkplttbcehyicv` ("Planar",
  legacy `planar_data` / `planar_history` / `planar_suggestions` schema), with a **malformed URL**
  carrying a trailing `/rest/v1/`. So previews were silently talking to a dead project — which is
  why preview telemetry never reached production. (Not missing keys.)
- **Fix (owner, Cloudflare → Workers & Pages → planyr → Settings → Variables and secrets, Preview
  scope):** replaced both with the production values —
  - `VITE_SUPABASE_URL` = `https://lyeqzkuiwngunutlkkmi.supabase.co` (clean origin, no path)
  - `VITE_SUPABASE_ANON_KEY` = production publishable key (`sb_publishable_8SEh…`)
  then redeployed.
- **Verified live:** a fresh preview (`https://3264177e.planyr.pages.dev`, build `acd83c0`) now
  calls `lyeqzkuiwngunutlkkmi.supabase.co` (production) at the network level, and a telemetry probe
  fired from it **landed a row in production `public.client_errors`** (`url` = the preview origin,
  `build = acd83c0`, `user_id` null / logged-out). Pre-fix, the same probe wrote nothing.
- **Caveat (accepted):** previews now read/write the **production** database — preview clicks touch
  live data. A separate staging DB with the *current* schema is the "purest" option for later; the
  old `ksetjztkplttbcehyicv` project is legacy and unsuitable.

## For Claude Code (follow-ups)
- **B278 "preview env" decision = resolved as option (a)** (previews use the production env). Root
  cause for the record: stale/malformed Preview config (old project ref + `/rest/v1/` URL), now
  corrected. (B278 backlog note updated to match.)
- **Optional tidy-up** (probe rows in production `client_errors`, needs dashboard access):
  `delete from public.client_errors where message like '%probe%';`
