# Cowork brief — finish B279 telemetry go-live + provision the B278/B280/B281 test infra

**For:** a Claude coworker (Cowork) with a **real, signed-in browser** + **Supabase dashboard access**.
**From:** session `claude/trusting-hawking-1c4d6g` (2026-06-20). Background is in `CLAUDE.md`,
`BACKLOG.md`, `BACKLOG-DONE.md` (B279), and `VERIFICATION.md` (V69).

## Why this brief exists
The sandbox coding session that built **B279 (production error telemetry)** runs **logged-out only**
(the egress proxy blocks the Supabase sign-in handshake) and has **no Supabase admin access, no CI
secrets, and no dedicated test login**. So two classes of work were correctly *not* done there and are
handed to you:

- **Part A — small, do-now:** make the shipped telemetry actually record to the cloud, and close the
  signed-in verification (V69).
- **Part B — provisioning:** stand up the test account + preview/secret plumbing that **B278**
  (Playwright harness), **B280** (seeded test account), and **B281** (CI wiring) are blocked on. Once
  this exists, a normal coding session can *build* those three.

What already shipped (live on `main` / planyr.io as of PR #218): the telemetry **code** —
`src/shared/telemetry/clientErrors.js`, wired in `main.jsx` + `ErrorBoundary.jsx` + `Shell.jsx`,
build-id via `vite.config.js`, the SQL in `src/shared/telemetry/client_errors.sql`, unit tests, and
`ui-audit/verify-telemetry.mjs` (6/6 headless). The code is **fail-safe**: until the table exists the
`insert` simply no-ops, so nothing is broken in the meantime.

---

## Part A — Telemetry go-live (≈10 min)

### A1. Run the migration (Supabase dashboard → SQL editor)
Run the contents of **`src/shared/telemetry/client_errors.sql`** once. It is idempotent. It creates
`public.client_errors` with **INSERT-only RLS** for `anon` + `authenticated` (no SELECT/UPDATE/DELETE
policy — clients can write but never read it back; you read via the dashboard). `user_id` defaults to
`auth.uid()` (null when anonymous), with an anti-spoof `WITH CHECK`.

✅ **Success:** the table exists; Table editor shows the columns
`id, at, user_id, build, module, source, message, stack, url, user_agent`.

### A2. Verify the write path on **planyr.io** (production has the Supabase env baked in)
> ⚠️ Verify on **planyr.io**, NOT a bare branch preview — the telemetry sink only writes if the build
> had `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (production does; an un-secreted preview won't).

There's a deliberate diagnostic handle on `window` — no need to cause a real crash. In the browser
console on planyr.io:

```js
// 1) ANONYMOUS / logged-out case (the most important one — logging must not need a session):
window.pfTelemetry.reportClientError(new Error("cowork live probe — anon"), { source: "manual" });

// 2) Then sign in, and repeat so the row carries your user_id:
window.pfTelemetry.reportClientError(new Error("cowork live probe — signed in"), { source: "manual" });

// (optional) confirm capture happened client-side before it hits the network:
window.pfTelemetry.recent();   // should include the two probes
```

Then in the Supabase dashboard (SQL editor — the table is not client-readable by design):
```sql
select at, user_id, build, module, source, message from public.client_errors order by at desc limit 10;
```

✅ **Success:** both probes appear. The **anon** row has `user_id = null`; the **signed-in** row has
`user_id =` your account's UID. `build` is a short git SHA (not "dev"); `url` is the planyr.io page.
(Bonus: switch workspaces — Site Planner / Document Review / Sequence — before firing a probe and
confirm `module` reflects the active workspace.)

### A3. Record the result
Update **`VERIFICATION.md` → V69**: flip the ⏳ to ✅ with the date, noting both the anon and signed-in
inserts landed. If anything fails (e.g., an RLS rejection on the anon insert), that's a real finding —
capture the exact Supabase error and hand it back to a coding session; do **not** loosen RLS to a
readable policy to "fix" it.

---

## Part B — Provision the test infra (unblocks B278 / B280 / B281)

These three are filed Open in `BACKLOG.md`. They can't be *built or verified* without the following,
which only you/owner can set up. None of this is code — it's accounts + secrets + a confirmation.

### B1. Seeded test account + fixture data → **B280**
- Create a **dedicated Supabase user** for automation (e.g. `e2e@planyr.test`) with a strong password.
  **Never** the owner's real login.
- Sign in as that user and create **one known project** with **fixed, documented values** the tests
  will assert on **by exact number** — e.g. a Pearland parcel (for the Brazoria county-resolution
  check), and a saved measurement with an exact length. Write these values down (see B4) — they are
  the *contract* B278's assertions depend on.
- RLS already isolates this user to its own rows (consistent with the no-cross-user design) — no
  schema change needed.

### B2. Confirm the preview + that it's built **with** Supabase env → **B278** gotcha
- Confirm the per-branch Cloudflare preview pattern (this branch deployed at
  `https://claude-trusting-hawking-1c4d.planyr.pages.dev`; production is planyr.io).
- **Critical:** confirm preview builds bake in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. B278's
  first flow asserts the app comes up **"Cloud on"** (the silent missing-env build is a known
  crash-severity incident) — if previews lack the env, that flow will *correctly* fail and look like a
  harness bug. If previews are un-secreted, decide: secret the preview env, or point B278 at a
  dedicated staging deploy.

### B3. CI secrets → **B281**
Add as **GitHub Actions secrets** (never commit): the test account creds (e.g. `E2E_EMAIL`,
`E2E_PASSWORD`), and the base preview URL (or how to derive it per branch). If a seed *script* is used
instead of a hand-built project, a **service-role** key may be needed **server-side in CI only** — keep
it out of any client bundle.

### B4. Document the seed values next to the suite
Put the exact fixture values in a short doc co-located with the future `/e2e` suite (or in B280's
backlog entry) so B278's assertions and the seed stay in lockstep. If a seed value changes, B278's
tests change with it.

✅ **Hand-back:** once B1–B4 exist, a normal coding session can build **B278** (the `@playwright/test`
suite + `data-testid` attributes on the cloud-status pill / save button / parcel-county readout / Site
Analysis rows) and **B281** (the GH Actions job + the auto-file-`@claude`-issue-on-failure step,
deduping repeat failures). Reuse the `ui-audit` cert-proxy launch flag (`--ignore-certificate-errors`)
per `CLAUDE.md`.

---

## Guardrails
- **Secrets stay server-side.** The Supabase **anon** key is fine in the browser (RLS-protected); the
  **service-role** key and any test-account password are CI/dashboard secrets only — never commit, never
  bundle.
- **Don't weaken the telemetry RLS.** INSERT-only with no read policy is intentional (no cross-user
  read hole). If anon insert fails, report it — don't add a SELECT policy.
- **Private-by-default** still holds for the test user — it sees only its own seeded rows.
