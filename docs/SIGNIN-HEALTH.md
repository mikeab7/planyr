# Sign-in health — how the owner finds out when sign-in breaks

Written 2026-11-02 (NEW-1), after **B2619760**: Supabase's captcha protection was on for every public auth call but the app only
sent a bot-check token with sign-up, so every signed-out person was locked out for days. The owner found it himself, on his
phone. Nothing in the repo noticed. This is the system that would have.

## The pieces (one line each)

| Piece | Where | What it does |
|---|---|---|
| Client events | `src/shared/auth/authTelemetry.js` (+ `Turnstile.jsx`, `lib/auth.js`) | Every sign-in / sign-up / reset reports ok / refused / blocked / widget-error / timeout / network / wrong-password / unexpected through `reportClientEvent` → `client_errors`. **One helper** (`observeAuthCall`); a new auth call uses it. |
| Outside-in check | `scripts/signin-health-check.mjs`, `scripts/lib/signinChecks.mjs`, `.github/workflows/signin-health.yml` | Hourly, from a clean runner, needs no client to report anything. |
| Alarm route | `functions/api/ops/signin-health.js` → `functions/api/lib/signinHealthRoute.js` | Stores each report, decides, emails `michael@planyr.io` once per incident (+ one recovery note), writes the `signin` snapshot. Authenticated by GitHub's OIDC token — **no stored secret**. |
| The rules | `src/shared/auth/signinHealth.js` | Pure: thresholds, streaks, `decide`, email copy, `snapshotHealth`. Read by the route, the Ops card and `ops-snapshot.mjs`. |
| Tables | `src/shared/auth/db/signin_health.sql` | `signin_health_checks`, `signin_incidents` (one open per lane), `signin_event_counts()`, and a fail-open abuse cap on `event:auth-*` inserts. |
| Dead-man's switch | admin → Ops → "Sign-in health"; `node scripts/ops-snapshot.mjs --signin` | Computed at read time: no report for ~2.5 h = **the check itself has stopped**. The daily data-risk sweep runs the second command. |
| Guard | `test/authCallsCaptchaGate.test.js` | Fails CI if a captcha-gated `supabase.auth` call (or raw `/auth/v1/token|signup|recover|otp|resend`) is added without a token, or an unclassified auth method appears. |
| e2e honesty | `scripts/lib/e2eSigninState.mjs`, `e2e.yml` | The scheduled e2e run now passes `E2E_LOGIN_KEY`, and states whether "authenticate once" passed / failed / was skipped and which door it used. |

## What the hourly check looks at

`pass` · `fail` · `unknown` (this runner could not tell — **never a pass**) · `skipped` (nothing to run yet).

1. **site-key-in-bundle** — the live JS carries a real Turnstile site key (not a Cloudflare always-pass TEST key).
2. **server-gate** — Supabase's token endpoint, asked with **no** token, answers `captcha_failed`; that must **agree** with check 1. The four combinations: on+key = healthy · on+no key = **the B2619760 outage** · off+key = settings changed · off+no key = unprotected. Either direction is a `fail`.
3. **panel-renders** — a real browser opens `/?app&auth=signin`; fields + button present and usable (the button is disabled until both fields have content, so it is judged after typing a throwaway pair; nothing is submitted); no raw error text; the widget did not report a configuration error (Cloudflare codes 110100/110110/110200/400020).
4. **real-sign-in** — a real sign-in as the test account through the panel (needs `E2E_EMAIL` + `E2E_PASSWORD`; **skipped** cleanly if absent). Cloudflare withholding the check from a datacenter browser → **unknown**, not a pass and not a break.
5. **email-link** — `/api/auth/email-link` answers JSON without sending mail. **Skipped** while the route does not exist (a POST to a path with no Function behind it gets a bare 405, so "JSON content-type" is the existence test).

A failed attempt is re-checked ~4 minutes later in the same run (a blip never alarms).

## Thresholds, and why

- **Outside-in: 2 failed attempts in a row.** With the in-run re-check that is reached ~5 minutes after the first failing hourly run — not two hours.
- **Browsers: ≥ 3 server captcha refusals in an hour AND refusals > successful sign-ins.** About 15 accounts → 0–5 sign-ins an hour; a total break refuses every attempt. One person fat-fingering is a count, not an email. Bias is toward alerting.
- **Only `auth-captcha-refused` can alarm from client events.** Wrong passwords, blocked scripts, widget errors, timeouts and network failures are **counts in the sweep**, never an email.
- **24 consecutive `unknown`** → one "the check is blind" email (e.g. the test account's password was rotated, or Cloudflare refuses the runner for good).
- **1 email per incident; 1 recovery note; 60-minute cooldown** between alerts. The database refuses a second open incident per lane.

## Adversarial table — every way sign-in can break → which check catches it → how fast → how the owner hears

(Any row with no catch would be a defect, not a note. The one honest limit is stated on the "check stops running" row.)

| Way sign-in could break | Caught by | Within | Owner hears |
|---|---|---|---|
| Captcha switched **off** at Supabase | `server-gate` (key present, gate off → "settings change") | next hourly run + 5 min re-check | email (outside-in, 2 in a row) |
| Captcha switched **on** with no key in the site (= B2619760) | `site-key-in-bundle` + `server-gate` ("nobody can sign in"); browsers' `auth-captcha-refused` rate | ≤ ~65 min by the check; sooner if ≥ 3 people try | email |
| Site key removed / wrong build shipped | `site-key-in-bundle`, `server-gate` | ≤ ~65 min | email |
| Turnstile **hostname list** changed (planyr.io removed) | `panel-renders` + `real-sign-in` read Cloudflare's error code 110200 from `data-turnstile-error`; browsers' `auth-captcha-widget-error` counts | ≤ ~65 min | email |
| **Cloudflare outage** / bot-check host blocked | `panel-renders` (script did not load; the runner has open egress, so unreachable ⇒ real) | ≤ ~65 min | email |
| **Supabase outage** | `server-gate` (5xx / no answer), `real-sign-in` | ≤ ~65 min | email |
| **Mail route down** (Gmail refuses / not configured) | the route answers `delivery: failed|not-configured` → the workflow goes **red** and opens a GitHub issue that @-mentions the owner | same run | GitHub issue notification (a second channel that does not use Gmail) |
| **Alarm route unreachable / 401 / 502** (OIDC claims changed, tables missing, DB down) | the workflow cannot post → red + the same GitHub issue | same run | GitHub issue notification |
| **Bundle regression** (form missing, button gone, raw error text, JS crash) | `panel-renders`, `real-sign-in` | ≤ ~65 min | email |
| **A new auth call without a token** | `test/authCallsCaptchaGate.test.js` fails CI before merge; if it slipped, browsers' `auth-captcha-refused` rate | at PR time; else ≤ 1 h of real attempts | CI red; else email |
| **The check itself stops running** (Actions outage, workflow disabled) | Ops "Sign-in health" card + `ops-snapshot.mjs --signin` read `lastCheckAt` > 2.5 h as **STOPPED** | the **daily sweep** (≤ 24 h) | the sweep's report. *Honest limit: nothing can email "the thing that emails stopped"; the dead-man's switch is the daily sweep.* |
| Cloudflare refuses the datacenter runner for the real sign-in | `real-sign-in` = **unknown** (never a pass); all other checks still run | n/a | counted in the sweep; one "blind" email after 24 unknown runs |
| Test account's password rotated | `real-sign-in` = unknown (bot check passed, credentials rejected) | n/a | same as above |
| Someone floods `client_errors` with fake auth events | fail-open DB cap (60 / source / minute); the outside-in check is unaffected. Client-reported rates are advisory and spoofable (insert-only, signed out by design) | — | a spoofed rate could send one false email; it cannot hide a real outage from the outside-in check |

## Owner steps

- **Alarm email** needs the same Gmail setup as team invites (`GMAIL_SERVICE_ACCOUNT_JSON` + `INVITE_SENDER` in Cloudflare Pages Production — see `OWNER-TODO.md`). Until it exists the route reports `not-configured`, the workflow goes red, and a GitHub issue @-mentions the owner.
- **Optional:** `E2E_LOGIN_KEY` as a GitHub Actions secret so the scheduled e2e run uses the session door (the e2e state step says which door ran).

## Running the drill

Actions → **Sign-in health** → Run workflow → tick **drill**. It sends the real `[TEST]` sequence through the real route and Gmail
(clean → two failures → **one** alert → still failing → **no** email → a pass → **one** recovery note) in a synthetic lane that
never touches real state, and fails if any step sends the wrong number of emails.
