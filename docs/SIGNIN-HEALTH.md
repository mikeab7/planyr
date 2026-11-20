# Sign-in health — how the owner finds out when sign-in breaks

Written 2026-11-02 (NEW-1), after **B2619760**: Supabase's captcha protection was on for every public auth call but the app only
sent a bot-check token with sign-up, so every signed-out person was locked out for days. The owner found it himself, on his
phone. Nothing in the repo noticed. This is the system that would have.

## The pieces (one line each)

| Piece | Where | What it does |
|---|---|---|
| Client events | `src/shared/auth/authTelemetry.js` (+ `Turnstile.jsx`, `lib/auth.js`) | Every sign-in / sign-up / reset reports ok / refused / blocked / widget-error / timeout / network / wrong-password / unexpected through `reportClientEvent` → `client_errors`. **One helper** (`observeAuthCall`); a new auth call uses it. |
| **Fast check** (NEW-1 2026-11-04, B2650848) | `functions/api/ops/signin-heartbeat.js` → `functions/api/lib/signinHeartbeatRoute.js`, `src/shared/auth/db/signin_health_edge_cron.sql` | Every 15 minutes, from Planyr's own server: the three network checks (live bundle's bot-check key · Supabase's gate · the sign-in email route). Called by a Supabase `pg_cron` job through `pg_net`. **No secret** (it takes nothing from the caller). This is the check that actually runs about hourly (4×/hour). |
| Browser check | `scripts/signin-health-check.mjs`, `scripts/lib/signinChecks.mjs`, `.github/workflows/signin-health.yml` | Meant to run hourly on a clean GitHub runner; adds the checks that need a real browser (the form renders; the real sign-in). **Best-effort: GitHub's scheduler delivers it every 5–8 hours here (see below).** |
| Alarm route | `functions/api/ops/signin-health.js` → `functions/api/lib/signinHealthRoute.js` | Stores each report, decides, emails `michael@planyr.io` once per incident (+ one recovery note), writes the `signin` snapshot. Authenticated by GitHub's OIDC token — **no stored secret**. |
| The rules | `src/shared/auth/signinHealth.js` | Pure: thresholds, streaks, `decide`, email copy, `snapshotHealth`. Read by the route, the Ops card and `ops-snapshot.mjs`. |
| Tables | `src/shared/auth/db/signin_health.sql`, `signin_health_edge.sql` | `signin_health_checks` (with `source`: `edge` / `runner`), `signin_incidents` (one open per lane), `signin_stop_alerts` (one row per source that can stop), `signin_event_counts()`, and a fail-open abuse cap on `event:auth-*` inserts. |
| Dead-man's switch | `evaluateStops` in the rules, run by `recordReport` on EVERY report; admin → Ops → "Sign-in health"; `node scripts/ops-snapshot.mjs --signin` | **Each source watches the other and emails the owner once** when it goes quiet: fast check silent > 45 min, browser check silent > 12 h. State in `signin_stop_alerts`. Also read at view time by the Ops card and the daily sweep. |
| Guard | `test/authCallsCaptchaGate.test.js` | Fails CI if a captcha-gated `supabase.auth` call (or raw `/auth/v1/token|signup|recover|otp|resend`) is added without a token, or an unclassified auth method appears. |
| e2e honesty | `scripts/lib/e2eSigninState.mjs`, `e2e.yml` | The scheduled e2e run now passes `E2E_LOGIN_KEY`, and states whether "authenticate once" passed / failed / was skipped and which door it used. |

## Why there are two checks now (NEW-1, 2026-11-04, B2650848)

The hourly GitHub workflow was recorded to run **three times in a day** (19:00, 00:00, 07:00 UTC; none after 07:33 at 13:54). Diagnosis, from the workflow's real run history and the stored rows (all read 2026-11-04):

- **Not the workflow failing, not the report being refused.** Every scheduled run on record (5) finished green and stored exactly one row; the 7 non-drill rows in `signin_health_checks` match the 7 runs (5 scheduled + 2 manual) one-for-one. A run that failed before reporting would show as a red run — there are none.
- **GitHub's scheduler is simply not starting the runs.** Scheduled runs came 8.5, 7.5, 5 and 7 hours apart (03:29, 11:58, 19:31, 00:38, 07:31 UTC), instead of every hour. It is not specific to this workflow: the build-check sweep, scheduled every 10 minutes, ran **50 times in 10.2 days** (≈1,470 expected) with a **median gap of 5.1 h and a maximum of 8.6 h** — the same pattern. The once-a-day, every-other-day and weekly workflows all ran on schedule (10 of 10 nightly runs, 7 weekday e2e runs, 6 reminders, 2 weekly drift runs). So it is **high-frequency schedules that get collapsed to roughly one run per 5 hours** in this repo; why is on GitHub's side and not provable from here, but the measurement is what matters.
- **Why the dead-man did not flag it:** it was computed only *when someone read the snapshot* (the daily sweep), and nothing emailed. A 7-hour gap that ended before anyone looked left no trace.

The fix keeps the check off GitHub's scheduler for everything that does not need a browser: **Supabase's `pg_cron`** (a scheduler inside the database we already run) calls **`/api/ops/signin-heartbeat`** through **`pg_net`** every 15 minutes (`7,22,37,52`); the route runs the three network checks itself. Ruled out: dispatching the workflow from a Cloudflare route (needs a stored GitHub token — a human step and a secret this repo deliberately avoids), a new account (Cloudflare cron Worker), anything paid.

## What the hourly check looks at

`pass` · `fail` · `unknown` (this runner could not tell — **never a pass**) · `skipped` (nothing to run yet).

1. **site-key-in-bundle** — the live JS carries a real Turnstile site key (not a Cloudflare always-pass TEST key).
2. **server-gate** — Supabase's token endpoint, asked with **no** token, answers `captcha_failed`; that must **agree** with check 1. The four combinations: on+key = healthy · on+no key = **the B2619760 outage** · off+key = settings changed · off+no key = unprotected. Either direction is a `fail`.
3. **panel-renders** — a real browser opens `/?app&auth=signin`; fields + button present and usable (the button is disabled until both fields have content, so it is judged after typing a throwaway pair; nothing is submitted); no raw error text; the widget did not report a configuration error (Cloudflare codes 110100/110110/110200/400020).
4. **real-sign-in** — a real sign-in as the test account through the panel (needs `E2E_EMAIL` + `E2E_PASSWORD`; **skipped** cleanly if absent). **Known coverage gap — see below: from GitHub's runner this step cannot finish, because Cloudflare shows the datacenter browser a challenge. It is then recorded as `unknown` + `uncovered`: never a pass, never a break, and not counted toward the blind email.** A rejected test-account password (the bot check passed, the credentials did not) is a different `unknown` and IS counted.
5. **email-link** — `/api/auth/email-link` answers JSON without sending mail. **Skipped** while the route does not exist (a POST to a path with no Function behind it gets a bare 405, so "JSON content-type" is the existence test).

A failed attempt is re-checked ~4 minutes later in the same run (a blip never alarms).

## Thresholds, and why

- **Outside-in: 2 failed attempts in a row.** With the in-run re-check that is reached ~5 minutes after the first failing hourly run — not two hours.
- **Browsers: ≥ 3 server captcha refusals in an hour AND refusals > successful sign-ins.** About 15 accounts → 0–5 sign-ins an hour; a total break refuses every attempt. One person fat-fingering is a count, not an email. Bias is toward alerting.
- **Only `auth-captcha-refused` can alarm from client events.** Wrong passwords, blocked scripts, widget errors, timeouts and network failures are **counts in the sweep**, never an email.
- **24 consecutive `unknown` runs** (every counted step unknown, or any counted step stuck unknown — e.g. the test account's password was rotated) → one "the check can no longer confirm sign-in" email. **A real sign-in that is `uncovered` is NOT counted here** (owner decision 2026-11-03: an alarm that fires because a check can never run is noise); it is reported in the daily sweep instead.
- **1 email per incident; 1 recovery note; 60-minute cooldown** between alerts. The database refuses a second open incident per lane.
- **Two sources, two streaks** (2026-11-04): the fast check and the browser check each keep their own failure streak (`effectiveHistory`). A fast-check pass can never end a browser-check failure (the fast check does not look at the sign-in form), and recovery needs a fresh pass from the source that failed. The 24-unknown "blind" rule follows whichever source is stuck.
- **Dead-man's switch: fast check silent > 45 minutes** (three missed 15-minute beats; one or two late beats never alarm) **· browser check silent > 12 hours** (longer than any GitHub gap measured, 8.5 h, so it fires only on a real outage of that path; the old single 150-minute limit would have fired on every measured gap). **One email per stop, no all-clear note** (the Ops card shows it running again). A source that has never reported is "not armed", not "stopped".
- **The fast-check route takes no secret and ignores its request body** — it can only be made to *look* at the live site, never to record a result it did not observe — and refuses a second run inside 8 minutes (one cheap database read per extra request).

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
| **The check itself stops running** | see the next section — every way, and what catches it | | |
| Cloudflare refuses the datacenter runner for the real sign-in | `real-sign-in` = **unknown** (never a pass); all other checks still run | n/a | counted in the sweep; one "blind" email after 24 unknown runs |
| Test account's password rotated | `real-sign-in` = unknown (bot check passed, credentials rejected) | n/a | same as above |
| Someone floods `client_errors` with fake auth events | fail-open DB cap (60 / source / minute); the outside-in check is unaffected. Client-reported rates are advisory and spoofable (insert-only, signed out by design) | — | a spoofed rate could send one false email; it cannot hide a real outage from the outside-in check |

## Every way the check can silently stop → which signal catches it (NEW-1, 2026-11-04)

Anything with no signal here would be a defect. "Within" is the worst case measured or reasoned, stated honestly.

| # | The check stops because… | Signal that catches it | Within | The owner hears |
|---|---|---|---|---|
| 1 | The `pg_cron` job is deleted / disabled / the extension is off | the **browser check's next report** (and the Ops card, and the daily sweep) sees the fast check silent > 45 min | the next GitHub run — measured 5–8.5 h apart; else the daily sweep ≤ 24 h | **email, once** ("the fast sign-in check has not reported…") |
| 2 | `pg_net` cannot reach planyr.io (Cloudflare challenge / firewall rule / DNS), or the request times out | same as #1 (no rows arrive); `net._http_response` holds the status for diagnosis | as #1 | email, once |
| 3 | The route is missing or broken after a deploy (5xx, build without Functions) | same as #1 | as #1 | email, once |
| 4 | The route runs but its database write fails (migration drift, DB error) | route answers **502**, no row lands → same as #1; the GitHub run's report also fails the same way → workflow **red + GitHub issue** that @-mentions the owner | as #1 / that run | email once; GitHub issue |
| 5 | Supabase is paused or down | the GitHub run cannot store its report → **red + issue**; sign-in itself is down, so people notice first | that run | GitHub issue |
| 6 | The checks themselves break (site unreachable, key gone, gate changed) | that is a **`fail`**, not a stop — the normal alarm (2 in a row ⇒ ~15 min) | ~15–30 min | email, once; recovery note |
| 7 | A check is stuck on `unknown` (Supabase rate-limits the probe for good) | the 24-unknown "cannot confirm" rule now follows **whichever source is stuck** (fast check: 24 beats ≈ 6 h) | ≈ 6 h (fast) | email, once |
| 8 | Gmail is unconfigured/refusing exactly when an alert or stop email is due | the route answers `not-configured`/`failed`, leaves the email **un-sent and un-marked**, and **retries on every later report**; the GitHub workflow goes **red + issue**; the Ops card says "email has NOT gone out" | next beat (retry); next GitHub run (issue) | GitHub issue (second channel) |
| 9 | GitHub's scheduler stops starting the browser runs (the measured case) | the **fast check's next beat** sees the browser check silent > 12 h | 12 h + 15 min | email, once ("the browser sign-in check has not reported…"). Meanwhile the fast check carries the hourly duty |
| 10 | The workflow is disabled, or fails before reporting (`npm ci`, browser install) | a failure before the report leaves `steps.check.outputs.code` empty → the fallback step opens the **GitHub issue** in that run; a workflow that never starts is #9 | that run / 12 h | GitHub issue / email |
| 11 | The workflow's OIDC identity changes or the route refuses it (401) | the script exits non-zero → **red + issue** | that run | GitHub issue |
| 12 | Both schedulers stop (pg_cron AND GitHub) | **nothing inside the system can notice**; the Ops card and `ops-snapshot.mjs --signin` read each source's clock at view time and say STOPPED | the **daily sweep** (≤ 24 h) | the sweep's report |
| 13 | The daily sweep itself stops | outside this system — the owner would see no daily report | — | *Honest limit: no signal. Nothing can email "the thing that emails stopped"; this and #12 are the floor.* |

Rows 1–3 are the weakest in latency: with the fast check dead, the watcher is the *slow* one. That is the price of not storing a GitHub token or adding a paid Worker; it is bounded (row 12), measured, and stated.

## Known coverage gap — real sign-in through the panel is NOT covered from GitHub's runner

Measured 2026-11-02 (runs 41541689588 / 41541968581): Cloudflare's bot check shows GitHub's datacenter browser a visible challenge (widget state `interactive`), so the form never submits a sign-in. **Nothing in this system proves that a person can type a password into the panel and get in.** What does cover the October failure class from the outside: the site key is in the live bundle, Supabase's bot check agrees with it, the form renders with its fields and button, and no raw error shows. What covers the rest: browsers' own `auth-captcha-refused` / `auth-ok` counts (a real person failing to sign in raises the refusal alarm), the guard that fails CI when a gated call lacks a token, and the owner's own use. The gap is reported in the daily sweep and the Ops card every day; it never sends an email and never counts toward the blind email. Closing it would need a runner Cloudflare lets through (a self-hosted or residential one) — a decision, not a bug.

## Owner steps

- **Alarm email** needs the same Gmail setup as team invites (`GMAIL_SERVICE_ACCOUNT_JSON` + `INVITE_SENDER` in Cloudflare Pages Production — see `OWNER-TODO.md`). Until it exists the route reports `not-configured`, the workflow goes red, and a GitHub issue @-mentions the owner.
- **Optional:** `E2E_LOGIN_KEY` as a GitHub Actions secret so the scheduled e2e run uses the session door (the e2e state step says which door ran).

## Running the drill

Actions → **Sign-in health** → Run workflow → tick **drill**. It sends the real `[TEST]` sequence through the real route and Gmail
(clean → two failures → **one** alert → still failing → **no** email → a pass → **one** recovery note; then, since 2026-11-04, a check
going silent → **one** "a sign-in check stopped running" email → still silent → **no** email → reporting again → cleared, no email) in
a synthetic lane that never touches real state, and fails if any step sends the wrong number of emails.

## Setup order for the fast check

1. `src/shared/auth/db/signin_health_edge.sql` — additive (the new column defaults to `'runner'`), safe before the code deploys.
2. Deploy the route (merge). 3. `src/shared/auth/db/signin_health_edge_cron.sql` — creates the `pg_net` extension and the schedule; **only after** the route is live (otherwise the first beats hit a missing page).
4. Read it back: `select * from cron.job_run_details … order by start_time desc limit 10;` and `select status_code, left(content,160) from net._http_response order by created desc limit 10;`.
To stop it: `select cron.unschedule('planyr-signin-heartbeat');` — the browser check's next report will email that the fast check has stopped (row 1), which is the point.
