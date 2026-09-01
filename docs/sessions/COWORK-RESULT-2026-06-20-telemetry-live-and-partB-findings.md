# Cowork result — 2026-06-20 — Part A done (telemetry live) + Part B findings

Executed against `COWORK-BRIEF-2026-06-20-telemetry-and-test-infra.md` (branch
`claude/trusting-hawking-1c4d6g`) from a **signed-in browser** (mikeabmab@live.com) +
**Supabase dashboard** (project `lyeqzkuiwngunutlkkmi` → org "Planar" / "Site Planar" / main · PRODUCTION).

---

## Part A — B279 telemetry go-live — DONE ✅

**A1 — migration run.** Ran `src/shared/telemetry/client_errors.sql` once in the Supabase SQL editor.
`public.client_errors` now exists: 10 columns (`id, at, user_id, build, module, source, message,
stack, url, user_agent`), **RLS enabled**, a single **INSERT-only** policy
(`anyone can log a client error` `[a]`), and **0 SELECT/UPDATE/DELETE** policies — clients write but
can never read it back. (The "destructive operation" dialog was only the idempotent
`drop policy if exists` guard.)

**A2 — live write-path verified on planyr.io** (production build, Supabase env baked in):
- **Signed-in probe** (`window.pfTelemetry.reportClientError`) → row stamped `user_id =
  b147d90d-b610-423d-af65-7e004f0ad72f` (the real account UID — matches the app's
  `planarfit:sites:cloud:…` key), `build = 113e820` (real git short SHA = current `main` HEAD, **not
  "dev"**), `module = site-planner`.
- **Anonymous insert** issued as the `anon` role (the same role a logged-out browser uses) → row with
  **`user_id = null`**. RLS accepted the anon write — no rejection. (I deliberately did NOT sign the
  real account out: re-login needs a password I can't enter. The `anon`-role insert tests the exact
  RLS path that was the open risk; PostgREST connectivity itself is already proven by the signed-in
  probe.)
- Both rows read back via the dashboard.

**A3 — recorded.** `VERIFICATION.md` → V69 flipped ⏳ → ✅ and pushed (`b4228d8`, branch
`claude/trusting-hawking-1c4d6g`).

**Cleanup note (optional):** the probe rows are tagged by message and can be removed any time:
`delete from public.client_errors where message like 'cowork live probe%';`

---

## Part B — findings + owner actions (unblocks B278 / B280 / B281)

### B2 (preview env) — ⚠️ FINDING: the branch preview is NOT cloud-connected
Tested `https://claude-trusting-hawking-1c4d.planyr.pages.dev`. The app renders fully and shows a
"Sign in" button, and `window.pfTelemetry` is present — **but a telemetry probe fired from the
preview did NOT land a row** in `public.client_errors`, while the identical probe on planyr.io did
(confirmed twice).

**Conclusion:** the Cloudflare **preview build is un-secreted** — it does not bake in
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, so it comes up effectively **"Cloud off."** This is
exactly the trap the brief flagged: **B278's first flow ("app comes up Cloud on") would FAIL against
this preview URL — and would look like a harness bug, not an env bug.**

**Decision required (owner):** either
(a) add `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` to the Cloudflare Pages **preview/build env**
so previews come up Cloud on (the anon key is browser-safe — RLS-protected — so this is fine), **or**
(b) point B278 at a deploy that already has the env (production planyr.io, or a dedicated staging).

### B1 (seeded test account) — OWNER-ONLY (I can't create accounts or set passwords)
- Create a dedicated Supabase auth user, e.g. `e2e@planyr.test`, strong password — **never** your real
  login. (Supabase dashboard → Authentication → Users → Add user.)
- Sign in as that user and create one known project with **fixed, documented** values B278 asserts on
  by exact number — e.g. a Pearland parcel (Brazoria county-resolution check) + a saved measurement at
  an exact length. RLS already isolates this user to its own rows.

### B3 (CI secrets) — OWNER-ONLY (secrets must never pass through chat or be committed)
- Add as **GitHub Actions secrets**: `E2E_EMAIL`, `E2E_PASSWORD`, and the base preview URL (or how to
  derive it per branch). If a seed *script* is used, a **service-role** key may be needed
  **server-side in CI only** — never in a client bundle.

### B4 (seed-values doc) — blocked on B1
Once B1 is seeded, document the exact fixture values co-located with the future `/e2e` suite (template
below). These values ARE the contract B278 asserts on; if a value changes, B278's test changes with it.

| Fixture | Value (fill after B1) | Asserted by |
|---|---|---|
| Test account email | e2e@planyr.test | login |
| Project name | _____ | site-list row |
| Parcel (county resolution) | Pearland → Brazoria | parcel-county readout |
| Saved measurement length | _____ | Site Analysis row |
| Cloud-status expectation | "Cloud on" | cloud-status pill |

### Hand-back
Once B1–B4 exist, a normal coding session can build **B278** (the `@playwright/test` suite +
`data-testid`s on the cloud-status pill / save button / parcel-county readout / Site Analysis rows)
and **B281** (the GH Actions job + auto-file-`@claude`-issue-on-failure, deduped). Per the brief,
reuse the `ui-audit` `--ignore-certificate-errors` launch flag.
