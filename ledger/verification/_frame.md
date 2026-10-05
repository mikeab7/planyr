# VERIFICATION.md — live-browser test checklist

> **⛔ THIS FILE IS GENERATED — DO NOT EDIT IT (NEW-1, 2026-10-05).** It is a view of `ledger/verification/_frame.md` (the prose and the checklist preamble below) plus one file per entry in `ledger/verification/<pending|checklist|done>/V<id>.md`; a nightly job refreshes it, so it can **lag** by up to a day. The entry folders are the truth.
> - **Log a check:** create `ledger/verification/pending/V<id>.md` (the whole `### V<id> — …` block). **Record a result:** edit that file. **Archive a fully-passed item:** `npm run ledger -- move V<id> done`.
> - Where this file's text below says "append to / move its block to `docs/archive/VERIFICATION-DONE.md`", read it as the `move … done` command. Never edit this file; the build fails a PR that does.


Some changes pass every check we can run **without a browser** — `npm run lint`,
`npm test`, `npm run build`, and server-side endpoint calibration — but still need a
human (or a Claude coworker with a real browser) to confirm they actually work **in the
running app**. This file is the running list of those, so nothing that "builds green but
was never clicked" quietly ships broken.

> **Production app:** https://planyr.io (Cloudflare Pages, deploys from `main`).
> **This is the runtime counterpart to `BACKLOG.md`.** An item can be `[x]` done in the
> backlog and still ⏳ unverified here — the code landed; the click-through hasn't.

> ## ⚠️ Testing policy (updated 2026-06-17 — read this)
> **Michael does NOT click through to test things himself. Ever.** Don't wait on him, don't ask
> him to verify, don't end a turn expecting him to go look.
> **Claude self-verifies in a headless browser — in the same session, no separate "cohort."**
> A headless Chromium is available in the environment (see "🤖 Self-verification" below), so a
> session that ships a UI change should **drive the live app itself** and record the result rather
> than file the click-through for someone else. The working rhythm:
> - After a change is **CI-green + build-green**, **run the headless-browser check yourself**, then
>   record the outcome here (✅/❌ + date). Don't punt it.
> - **⛔ A session does not end its turn while its own change is merged-but-unverified** (merge → deploy serves your build → signed-in check → record).
> - **Only if no browser is reachable** (rare), log the item below and move on — never block on Michael.
> - **Do NOT surface "these N are unverified" to Michael as a to-do for him.**
> - **Only interrupt Michael for a genuinely CRITICAL problem** — the app won't build, won't render
>   (blank screen), or a shipped feature is visibly crashing in production. Everything else: note it
>   here, keep moving.
>
> ### 🤖 Self-verification — how (proven 2026-06-17 against planyr.io + per-branch preview URLs)
> Write a short Playwright script and run it with Node:
> - Browsers live at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; the module is the global
>   `/opt/node22/lib/node_modules/playwright` (require it by absolute path).
> - **TLS is already trusted** — the environment setup script imports the sandbox proxy's CA into Chromium's
>   NSS store. **NEVER pass `--ignore-certificate-errors` / `ignoreHTTPSErrors`** (owner-ruled-out).
> - **SIGNED IN is available (2026-10-04):** `import { openSignedIn } from "./ui-audit/lib/signedInSession.mjs"`
>   (`openSignedIn({ base: "https://planyr.io" })` or a PR preview URL) signs in as the throwaway test account
>   `e2e@planyr.test` via `/api/auth/e2e-session` using `E2E_LOGIN_KEY` (never print it), and returns the page +
>   the served `/version.json` build + a proof object (account email + `e2e-fixture-site`). Smoke:
>   `node ui-audit/verify-signed-in-session.mjs https://planyr.io`. Password sign-in is captcha-refused by design.
>   **A session's own signed-in check on the test account COUNTS as verified.**
> - Enter the planner via the map toolbar's **"Draw"** button — `getByTestId("map-toolbar-draw")`,
>   ONE click (⚠ CORRECTED 2026-09-08, B1368144: this used to be a two-step
>   `map-start-blank-menu-btn` → `map-start-blank-menu-item` caret click, and "Start blank" is now
>   the first-class "Draw" button on a ground-first toolbar. The old testids no longer exist —
>   58 such pairs across 80 harness files were collapsed in that item's own commit); drive the SVG
>   canvas with `page.mouse` (CDP mouse events fire React's pointer handlers); `page.screenshot({clip})`
>   then read the PNG back to eyeball it.
> - **⛔ WEBKIT INSTALLS ON DEMAND HERE (amended 2026-09-05, B1168128 fourth pass) — USE IT for any
>   iOS-class bug, not just Chromium's phone-device emulation.** An earlier version of this note said
>   WebKit was unavailable in this sandbox; that was true when written and is now WRONG — don't let a
>   future session read this note, see "no WebKit", and settle for Chromium when the real engine is
>   one command away. It is still not Safari (see the specifics below), and getting it running needs
>   two steps most sessions will miss on the first try. `npx playwright install chromium` does NOT
>   install WebKit — that part of the old note still holds, and a fresh container starts with
>   Chromium only. But `npx playwright install webkit` DOES work from here: the download hits a 403
>   on its first two CDN mirrors
>   (`cdn.playwright.dev/dbazure/...`, `playwright.download.prss.microsoft.com` — a real, narrow
>   block on those two hosts specifically) and then succeeds on Playwright's own third fallback
>   mirror automatically — no manual retry needed, just let the command finish. The binary then
>   FAILS TO LAUNCH the first time, not from network/permissions but from ~27 missing OS shared
>   libraries (`libgtk-4.so.1` and similar — normal Ubuntu packages this container doesn't ship by
>   default). Fix: `npx playwright install-deps webkit` (this container runs as root) installs them;
>   `webkit.launch()` then succeeds. **Do both installs before assuming WebKit is unreachable.**
>   Once launched, this is Playwright's Linux WebKit build — the real WebKit rendering + pointer-event
>   engine, materially closer to Safari than Chromium — but it is still **not** Apple's WebKit and
>   **not** Mobile Safari's browser chrome: no real notch, no real collapsing address bar, and
>   Playwright exposes no CDP-equivalent for WebKit (no `Emulation.setSafeAreaInsetsOverride`
>   analog), so `env(safe-area-inset-*)` still resolves to 0 here with no way to override it —
>   confirmed by trying, not assumed (Chromium's CDP override IS available and DOES let you inject a
>   real inset value; that asymmetry is real and worth knowing before reaching for WebKit expecting
>   parity with the Chromium simulation path). Playwright's `touchscreen` API on WebKit (like
>   Chromium) exposes only a single-point `.tap()` — no drag primitive on either engine — so a real
>   held-and-moved touch gesture still can't be produced through Playwright's public API; Chromium's
>   "genuine touch drag" tests use Chromium-only CDP (`Input.dispatchTouchEvent`), which has no WebKit
>   equivalent. **Say "WebKit" in a report, never "iPhone" or "Safari" or "Mobile Safari."** A
>   synthetic safe-area value can still only be exercised as a SIMULATION on Chromium (via its CDP
>   override), never on WebKit here. Closing a real notch/gesture-bar or true Mobile-Safari-chrome
>   question still needs an actual iPhone; that gap is Michael's own device, not a task for a
>   self-check here.
>
> - **⛔ AND WEBKIT REACHES EXTERNAL HOSTS WHERE CHROMIUM CANNOT (2026-09-05, B1215536) — this
>   REFINES the "standing wall" below (line ~823/V477 and its siblings), it does not repeat it.**
>   Those entries measured Chromium alone dying with `net::ERR_CONNECTION_RESET` /
>   `ws_closed_mid_exchange` against `planyr.io` and a Cloudflare preview URL, and read that as
>   "no browser here can open an external URL, only `curl` can." Measured directly this round: the
>   SAME proxy-side failure (`ws_closed_mid_exchange`, tunnel closed ~6s in, ~39 bytes received)
>   reproduces identically against unrelated third-party hosts too (`accounts.google.com`), which is
>   the tell that this is Chromium's own TLS handshake shape tripping something in the egress
>   proxy's TLS termination — not a policy block on this app's domains specifically. `webkit.launch()`
>   with the SAME `proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }` launch
>   option (Chromium reads `HTTPS_PROXY` only via this explicit option too, never on its own — see the
>   WebKit note above) reached both a Cloudflare Pages preview URL and `https://planyr.io/` cleanly,
>   repeatedly, including a full real-UI flow (create a note, type, click through several controls) —
>   not just a bare page load. **So: a same-session live check against a real deployed URL is
>   possible here, it just needs WebKit, not Chromium, for the network hop** — reach for it before
>   filing "no browser reachable" against a deployed build.
>
> ### 🚚 Confirming a change is actually SERVED (B1119) — use the script, not a hand grep
> `node ui-audit/verify-deploy.mjs <marker> [marker…]` (`--origin=` for a preview URL, `--json` for
> a machine-readable result). It walks the REAL module graph — index.html → entry chunk → every
> hashed chunk the entry names — and reports which chunk carries each marker, exiting non-zero if
> any is missing. **Do not hand-grep `assets/index-*.js`.** Two facts make that wrong here and it has
> already produced a confident false "never deployed" that cost a 2.5-hour deploy chase (2026-07-29):
> **(a)** Vite content-hashes every chunk SEPARATELY, so the entry's hash is UNCHANGED across a
> deploy whenever its own bytes didn't change — a stable index hash is evidence of nothing; and
> **(b)** almost all planner code lives in the LAZY `SitePlannerApp-*.js` chunk, so a string added to
> `lib/elementApi.js` was never going to appear in the entry at all.
> **Pick a MINIFY-SAFE marker** or you get the same false negative in a new costume: safe = a
> wire-level object key (`p_atomic`), user-visible copy, or a public-API property name; unsafe = any
> local function or variable name (`closeAssemblies` is renamed away by the build).
> **A green build check and the served bytes are DIFFERENT CLAIMS** — only ever report "deployed"
> off the bytes.

---

## How to use this — Claude Code / coworkers, read on every run

1. **Scan the 🔲 list below** — items waiting to be confirmed in the running app. Per the testing
   policy above, do **not** hand this list to Michael as his to-do; only escalate a **critical**
   (won't build / won't render / crashing) issue.
2. **Verify it yourself in a headless browser** (see "🤖 Self-verification" above): run the
   **Steps**, compare to **Expect**, then record the outcome.
3. **⛔ CLEAR OUT what you finish — don't leave passed items piling up here (owner rule, 2026-07-02).**
   This is the #1 reason this file bloats. Whoever runs a check (usually Claude Cowork on the live app —
   NOT Michael) archives it the SAME session, by item type:
   - **One-off item** (`Cadence: once` — a bug/feature acceptance check): once it **fully passes with
     nothing pending**, **MOVE its entry to `ledger/verification/done/`** (`npm run ledger -- move V### done`) — do not just mark it ✅ and
     leave it here. (Same archiving discipline as `BACKLOG.md → docs/archive/BACKLOG-DONE.md`.) If it only *partly*
     passes (some steps still owed), it **stays** with the passed parts noted and the remainder ⏳.
   - **Recurring item** (`🌐` endpoint-liveness / any `Cadence: every N days`): it **stays here** —
     don't archive it. Just record the run: flip the status, set `Last checked`, bump `Next check` by
     the `Cadence`. These are meant to be re-run forever.
   - A **❌** stays ❌ (with the date + what broke) until it's re-fixed and re-run — never archive a fail.
4. **⛔ ATTEMPT before you PARK — a logged-out, no-external-GIS UI check is NEVER a valid "needs a live
   pass" item (owner rule, 2026-07-18, after too many Claude-doable checks were parked for a human).**
   Before you file OR leave a `V###` as pending, you must FIRST drive the headless self-verify. You may
   only defer an item if it hits one of exactly THREE hard walls — and it must NAME which, in a
   `Blocker:` field on the entry:
   - ~~**`Blocker: auth`**~~ **RETIRED 2026-10-04 (owner decision, Michael).** Sessions sign in as the test
     account (`ui-audit/lib/signedInSession.mjs`) and verify signed-in checks themselves; `auth` no longer
     parks a check. A `V###` still carrying it is a mis-classification: drive it signed in and record ✅/❌.
     Park ONLY if the check needs Michael's own data (`real-data`) — and first try a fixture on the test account.
   - **`Blocker: live-GIS`** — needs a live external map/GIS host the sandbox egress blocks (county
     flood / parcel / TxGIO services, etc.).
   - **`Blocker: real-data`** — needs a specific SIGNED-IN saved project (Tsakiris / Bain) that only
     exists in Michael's real account (try a fixture on the test account first).
   - **`Blocker: print-engine`** *(added 2026-07-31 with **V631**, and flagged rather than smuggled in:
     this is a FOURTH wall, and the rule above says three.)* — needs the browser's real PRINT pipeline.
     Headless Chromium's `window.print()` is a **no-op**: it produces no paginated output at all, so
     nothing in this sandbox can judge how a document breaks across sheets or what "Save as PDF"
     actually yields. The DOCUMENT we hand the browser is fully drivable here and **must** be driven
     (its content, its images, its styling, what chrome it drops) — only the step after our code is
     walled. Use this ONLY for that step; a print feature parked without its sheet having been driven
     is still a mis-classification.
   - **`Blocker: live-deploy`** *(added 2026-07-31 with **V669**, and flagged rather than smuggled in:
     this is a FIFTH wall.)* — needs a REAL deploy to land under an already-open tab. The sandbox can
     fabricate a newer build stamp and a route its build cannot resolve (and **must** — both halves of
     the mechanism are drivable here and are driven in `verify-notes.mjs` §21); what it cannot do is
     publish to Cloudflare Pages and watch a live tab notice. Use this ONLY for the step after our
     code: the edge's caching of the stamp file, and the reload landing on the new build.
   Everything else — draw / reshape / select / toggle / keyboard / export a blank site, the landing
   page, a dropped LOCAL file, a boot-recovery flow — is Claude-doable HERE: **drive it and record
   ✅/❌ this same session; do NOT park it.** A `V###` with no `Blocker:` wall is a mis-classification,
   not a to-do. (Still: never mark ✅ from reading code — confirming-in-the-running-app is the point.)
5. **Endpoint-liveness items (tagged 🌐) are the exception to "needs a browser"** — a `curl`/REST
   probe, runnable without a browser. Run those when due (and per rule 3 they stay, they don't archive).

`CLAUDE.md` points every session here, so this list is consulted automatically.

---

## 🔲 Needs verification

<!-- ledger:entries pending -->

## THE CHECKLIST — run this on Michael's signed-in Chrome, on `planyr.io`

**⛔ STEP 0, and it is not optional (owner correction, 2026-09-03, B1112449/B1112450).** A tab can silently keep serving a pre-deploy cached bundle, and a stale tab's own reload can reload the SAME stale chunks. So the chunk name is read **in the same `evaluate` as every result below** — never in a separate call, and never inherited from another tab that was "confirmed fresh" minutes earlier. **Open a brand-new tab**, go to a real project's Site view, let it settle, then run the single expression below.

```js
(() => {
  const c = document.querySelector('[data-testid="planner-canvas"]');
  const chunks = [...document.querySelectorAll('script[src]')].map(s => s.src.split('/').pop())
    .filter(n => /SitePlanner|index/.test(n));
  if (!c) return { PASS: false, why: 'no planner canvas on the page', chunks };
  const cb = c.getBoundingClientRect();
  const els = [...document.querySelectorAll('[data-el-id]')];
  const first = els[0];
  let hit = null;
  if (first) {
    const b = first.getBoundingClientRect();
    const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    const owner = t && t.closest ? t.closest('[data-el-id]') : null;
    hit = owner ? owner.getAttribute('data-el-id') : (t ? '<' + t.tagName.toLowerCase() + '>' : null);
  }
  const onScreen = els.filter(e => {
    const b = e.getBoundingClientRect();
    return b.right > cb.x && b.x < cb.right && b.bottom > cb.y && b.y < cb.bottom;
  }).length;
  return {
    chunks,                                   // ⟵ READ IN THE SAME OBSERVATION AS EVERYTHING BELOW
    gatePresent:  c.hasAttribute('data-planner-reveal'),
    revealReason: c.getAttribute('data-planner-reveal'),
    visibility:   getComputedStyle(c).visibility,
    inlineVisibility: c.style.visibility || '(none)',
    mount:        c.getAttribute('data-planner-mount'),
    ppf: +c.getAttribute('data-view-ppf'),
    off: [+c.getAttribute('data-view-offx'), +c.getAttribute('data-view-offy')],
    elements: els.length, onScreen, elementFromPoint: hit,
    visibilityState: document.visibilityState, hasFocus: document.hasFocus(),
  };
})()
```

**PASS conditions — every one of these, on a plan that HAS drawn content:**

| # | Field | Required | Why it is the condition |
|---|---|---|---|
| 1 | `chunks` | contains a `SitePlanner*` name that is **NOT** `SitePlannerApp-Bz_McZ8T.js` | That is the pre-fix chunk measured on production 2026-09-15. Still seeing it means the tab is on the old bundle and **nothing below counts** — hard-reload and re-run. |
| 2 | `gatePresent` | `true` | The attribute only exists in a build carrying this fix. `false` means the gate is not deployed; stop. |
| 3 | `revealReason` | **`"framed"`** | The reveal was caused by a real framing. `"ceiling"` = the rescue fired and the normal path failed — report it, it is a real (lesser) defect. `""` = never revealed → **STOP, this is the B1594320 outage, tell the session immediately.** |
| 4 | `visibility` | `"visible"` | The outage direction. |
| 5 | `elements` / `onScreen` | `onScreen > 0`, and equal to `elements` on an ordinary plan | "Revealed" is not "showing the plan": the reverted build painted an aerial with every element off-canvas, which reads as *"my plan is gone."* |
| 6 | `elementFromPoint` | an element id, **not** `null` and not a `<tag>` | The plan must be clickable where it is drawn. |
| 7 | `ppf` / `off` | **not judged** | ⛔ `ppf 0.35 off (60,60)` is BOTH the boot default AND the honest answer for an empty plan. **Never use that triple alone as a failure signature.** Row 3 is what distinguishes the two. |

**And the thing only Michael's eyes can answer — the report itself:** on a **cold load of a real project on his iPhone**, does the canvas still cut to one building at extreme zoom for about two video frames before settling? Expected: **no flash — the drawing appears once, already framed.** A brief blank instant before it appears is the gate working as designed and is not a failure; a wrong picture that then corrects itself is.

**Worth doing twice:** once on a tab brought to the FRONT before loading, and once on a load that begins with the window backgrounded (the case that produced the P0). Row 3 must read `"framed"` both times.

**If anything fails, capture `revealReason` + `chunks` together** — those two fields are what tell a session whether it is looking at a real defect or a stale bundle, and the absence of exactly that pairing is what sent the 2026-09-03 false alarm down the wrong path.

---

**What WAS verified here (sandbox, this session, on real builds — not by reasoning).**
1. **The flash reproduced on `main` before anything was changed** (`verify-boot-framing.mjs`, phone width, 66-element Goose Creek fixture): `visible` arm **2 painted framings** — `ppf 0.35 off (60,60)` held **106 ms over 6 frames**, then `ppf 0.0831`; `remount` arm **4**, the boot default once per mount.
2. **With the fix:** `visible` 1 framing · `backgrounded → foregrounded` 1 framing, revealed + framed + hit-testable BEFORE the arm foregrounds anything (so B1600353 is intact) · `remount` 2 mounts / 2 framings · watchdog arm revealed at **2237 ms** on a wall clock in a document reading hidden, with a container forced degenerate.
3. **The signed-in `loadEpoch` remount, driven in the sandbox for the first time** (`verify-boot-framing-auth.mjs`, incident condition #1): **2 real planner mounts**, no boot default painted on either, revealed by its framing, plan on screen and hit-testable. Ceiling arm: **7 remounts ~700 ms apart** on a degenerate container and the canvas is still revealed by the ceiling at **2325 ms**, within the ceiling of the FIRST mount.
4. **Red-proofed three ways, each against a real build:** (a) `main`, no gate → the repaired rig exits 1, naming the flash on all three arms (it exited **0** before the repair, printing the flash and declaring it "not applicable"); (b) the P0 reintroduced (a `visibilityState` guard back on the ceiling) → watchdog arm RED, *"still unrevealed after 6349 ms"*; (c) the per-mount deadline (#1686's shape, which the incident doc says is explicitly not good enough) → auth ceiling arm RED, canvas permanently hidden.
5. **Adjacent cases** (`verify-boot-framing-cases.mjs`), all green: foregrounded phone + desktop · hidden boot · no parcel · no elements · genuinely empty plan · Map / Schedule / Notes / Review via the real visible tab.
6. `test/bootFramingDeadline.test.js` 8/8; full suite green; `npm run ci-parity` green.
<!-- ledger:entries checklist -->

## ✅ Verified / ❌ Failed — history

> Passed/failed items are archived to **`ledger/verification/done/`** to keep this file fast.
> Move a fully-passed item there (do not add it here).
