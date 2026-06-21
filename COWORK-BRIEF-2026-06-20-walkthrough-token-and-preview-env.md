# Cowork brief — walk Michael through: (A) rotate the exposed GitHub token, (B) cloud-connect the Cloudflare previews

**For:** Claude **Cowork** (signed-in browser + dashboard access), acting as a **guide**, not an autonomous executor.
**Your role here:** Michael does the clicking in his own **GitHub** and **Cloudflare** accounts (only he can — they're his logins). You give **plain, one-step-at-a-time instructions, wait for him to confirm each step, then verify it worked.** Michael is an industrial real-estate developer, not an engineer — no jargon without a plain-English gloss. Dashboard labels move; if what he sees doesn't match, adapt and don't guess.

**Context (already done, for your situational awareness):** B279 error-telemetry is live and verified on planyr.io (`public.client_errors`, V69 ✅). These two tasks are the leftover **owner-only** items. Neither costs any AI/Claude tokens. Do them **one at a time, A then B.**

---

## Task A — Rotate the GitHub personal access token (security)

**Why (tell Michael in plain terms):** his GitHub access token (a password-like key that lets automation act as him on GitHub) showed up in a leftover repo clone's git config and surfaced in logs. Per his own "rotate if exposed" rule, treat it as burned and replace it. **Important reassurance:** Claude Code already confirmed the token is **NOT** committed anywhere in the planyr repo or its git history — so there's nothing to scrub from code; this is purely precautionary credential rotation.

**⚠ Do this carefully — rotating a token that's still in use will break whatever uses it.** So the order is: find where it's used → rotate → update those places → verify.

1. **Find what the token is for, first.** Help Michael figure out where this token is actually used before he revokes it, so nothing silently breaks:
   - the Claude Code / remote environment that pushes to GitHub (may store a token in its settings/secrets),
   - GitHub **Actions secrets** on the `mikeab7/planyr` repo,
   - any local clones' git configs.
   If it turns out to be a **stale leftover** (not used by anything live), rotation is clean and risk-free. If it **is** live, note every place that needs the new value.
2. **Rotate it.** GitHub → top-right avatar → **Settings** → left sidebar bottom **Developer settings** → **Personal access tokens** (check **both** "Fine-grained tokens" and "Tokens (classic)"). Find the planyr/automation token, note its name + scopes (so the replacement matches), then **Regenerate** (or revoke + create new). Copy the new value **once** — GitHub won't show it again.
3. **Update every place from step 1** with the new token.
4. **Verify:** the old token is gone from the list; whatever uses it (a test push, a CI run) still works with the new one.

**Guardrail:** never paste the token value into chat or commit it. If you must handle it, do it in the dashboard only; don't reprint it.

---

## Task B — Cloud-connect the Cloudflare previews

**Why (plain terms):** the throwaway per-branch "preview" links currently come up **"Cloud off"** — they don't carry the database keys, so they behave unlike the real site, and a future automated test would fail against them for the wrong reason. Adding two settings fixes it. **Cost: $0, zero tokens, runs no tests** — it's just two environment variables. (The previews already build automatically today; this only lets them reach the cloud.)

1. Cloudflare dashboard → **Workers & Pages** → the **planyr** Pages project → **Settings** → **Variables and Secrets** (a.k.a. Environment variables).
2. Find the **Production** scope — it already has **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_ANON_KEY`**. Have Michael copy those **two** values.
   - These two are **browser-safe** (the anon key is RLS-protected and already ships in the public app), so they're fine to handle in the UI. **Do NOT** touch or copy the **service-role** key — that one is server-only and must never go near a preview/browser env.
3. Add those **same two variables** (same names, same values) to the **Preview** scope. Save.
4. Trigger a re-deploy of any open branch (push a commit, or "Retry deployment" on the latest preview) so the new vars bake in.

**Caveat to state plainly:** this points preview links at the **production database** — so anything clicked on a preview touches live data. At Michael's scale that's normal and fine; a fully separate staging database is the "purest" setup but more work than it's worth right now.

**Verify (this part is YOURS, Cowork — the live check Michael can't easily do):**
- Open a current branch preview URL (e.g. `https://claude-trusting-hawking-1c4d.planyr.pages.dev` or whatever's latest). In the console fire:
  `window.pfTelemetry.reportClientError(new Error('preview cloud-on check'), { source: 'manual' });`
- Then in the Supabase dashboard SQL editor: `select at, url, message from public.client_errors order by at desc limit 5;`
- ✅ **Success:** the probe row appears with the **preview** URL (before this change the same probe did **not** write — that was the original finding). The preview's "Sign in" should also now actually work, not show "Cloud off."

---

## Wrap-up
- **Cost reassurance for Michael:** neither task increases token usage. The separate "test robot" (Playwright) that would test branches is deferred and, when built, runs on GitHub's free CI — not Claude/Cowork tokens (it was chosen specifically to avoid the expensive Cowork vision tokens).
- **Optional tidy-up:** remove the telemetry probe rows once done — `delete from public.client_errors where message like '%probe%' or message like 'cowork live probe%';`
- **Hand-back to Claude Code (not Michael):** once Task B is verified, the B278 backlog note's "preview env" decision is resolved (option a — secret the preview env); a coding session can update that note and proceed with the test robot whenever Michael wants it.
