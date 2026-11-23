# Sessions sign in and verify their own work

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ SESSIONS SIGN IN AND VERIFY THEIR OWN WORK — `Blocker: auth` NO LONGER PARKS A CHECK (owner decision,
2026-10-04, Michael: a session's own live signed-in check on the test account COUNTS as verified; the Cowork
chat must not be the only verifier).** Proven the same day: `node ui-audit/verify-signed-in-session.mjs
https://planyr.io` signs in headlessly as `e2e@planyr.test` and proves it with something only a signed-in
user sees (the account email + its `e2e-fixture-site` row). **THE ONE SHARED HELPER is
`ui-audit/lib/signedInSession.mjs` (`openSignedIn({ base })`) — never write a second sign-in.** It uses the
`E2E_LOGIN_KEY` env var (set in this environment; never print it) against `POST /api/auth/e2e-session`, a
route that can only ever mint a session for the test account. The app's own sign-in
panel sends a real Turnstile token (sign in, sign up and forgot password all do — B2619760), but a headless browser is not expected
to pass Cloudflare's check, so sessions use this route; **turning captcha off is ruled out**. **Trust:** the environment setup
script imports the sandbox proxy's CA into Chromium's NSS store, so HTTPS just works — **NEVER reach for
`--ignore-certificate-errors` / `ignoreHTTPSErrors`** (owner-ruled-out). The test account is `authenticated`
only: no admin row, no team memberships, owns two fixture sites.
**THE RULE:** a session that ships a UI change verifies it **signed in as the test account on planyr.io after
the deploy** (read `/version.json` and match it to your merge commit IN THE SAME CALL as the assertion), and
on the PR preview first where that works. **Only `real-data` (Michael's own saved projects — and first try a
fixture on the test account) and genuinely external-GIS (`live-GIS`) checks may park.** A `V###` carrying
`Blocker: auth` is a mis-classification now: drive it and record ✅/❌ this session.
**⛔ A SESSION DOES NOT END ITS TURN WHILE ITS OWN CHANGE IS MERGED-BUT-UNVERIFIED.** Merge → wait for the
deploy to serve your build → run the signed-in check → record the result. If the route answers 503/404
(`not configured`), say so in one line as a needs-Michael item (Retry deployment in Cloudflare Pages).
(Everything about `verification-inbox/` (now `docs/history/verification-inbox/`) and Cowork below is HISTORY for the checks already queued; the
Cowork chat may still verify, it is no longer the only actor that can.)
