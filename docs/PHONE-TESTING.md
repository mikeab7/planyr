# Testing Planyr on a phone — what this repo can actually do (B1447440)

Read this before telling anyone (including yourself) that "nobody in this pipeline can test an
iPhone." That statement is **false as broadly stated**, and it cost a real correction from the
owner (2026-09-09) after a session made it. This file is the phone/orientation-specific companion
to the fuller **"⛔ WEBKIT INSTALLS ON DEMAND HERE"** note already in `VERIFICATION.md`'s
Self-verification section (written 2026-09-05, B1168128) — **read that note too**; it covers the
WebKit install mechanics and its engine-level limits in more depth than this file repeats. This
file adds the device/orientation/surface matrix and the harness that drives it.

## The one-line answer

**Yes: WebKit — materially closer to Safari's real layout and pointer-event engine than Chromium,
though not Apple's own build and not Mobile Safari's browser chrome — runs at real iPhone screen
sizes, in both orientations, against the real production site, from a Claude Code web session with
normal outbound network access.** Per `VERIFICATION.md`'s own house style: **say "WebKit" in a
report, never "iPhone" or "Safari" or "Mobile Safari."** Four specific things it still cannot prove
are named below — read them before citing a clean run as proof a phone issue is fixed.

## What actually runs, and where

Playwright ships three browser engines: Chromium, Firefox, and **WebKit**. Two things have to both
be true for a WebKit run to work here:

1. **The environment needs a WebKit browser installed** (`npx playwright install webkit`) **and**
   the OS shared libraries it links against (`npx playwright install-deps webkit` — on Debian/Ubuntu
   this pulls in `libgtk-4`, `libgraphene`, `libwoff2dec`, `libmanette`, and roughly two dozen more
   media/graphics libraries this container doesn't ship by default). Both steps succeeded in a
   Claude Code web session with normal outbound network access on 2026-09-09 — same two-step fix
   `VERIFICATION.md` already documents from its own 2026-09-05 pass, reproduced independently here.
   **Do both installs before assuming WebKit is unreachable** — a session that tries only the browser
   download, sees a launch failure, and stops there will wrongly conclude WebKit doesn't work.
2. **The environment needs to be able to reach `planyr.io`.** Some Claude Code sandboxes run behind
   an egress policy that blocks arbitrary outbound hosts (confirmed elsewhere in this repo: Supabase
   sign-in is CORS-blocked from the default dev sandbox, and a session on 2026-09-09 hit a
   `403 CONNECT tunnel failure` reaching `planyr.io` and a WebKit download error, from its own more
   restricted container). **Neither failure means "this is impossible" — it means that particular
   container's network policy doesn't allow it.** A session running with a more open network policy
   (this file's own author, same day) reached `planyr.io` over plain HTTPS with no proxy trouble and
   downloaded WebKit with no trouble either, and `webkit.launch({})` needed no explicit proxy option
   to reach it (unlike a case `VERIFICATION.md` records elsewhere where an explicit
   `proxy: { server: process.env.HTTPS_PROXY }` launch option was needed against a different
   sandbox's egress path — the exact plumbing can differ session to session; if a bare launch can't
   reach the target, try that option before concluding the network is closed).

**So: before concluding phone/Safari testing is unreachable, actually try both installs and an
actual `curl` to the target site, in the session that will do the work — do not assume a previous
session's sandbox limits are this one's.** If `npx playwright install webkit` genuinely fails, or
the target site is genuinely unreachable, say so with the exact error and fall back to Chromium's
mobile device emulation, **clearly labelled as a fallback** — never silently reported as "tested on
WebKit."

## Devices and orientations available

Playwright ships named device descriptors (`playwright.devices['<name>']`), not bare pixel
viewports. A descriptor bundles the four things that actually change how the app behaves, together:
- the viewport size (**already net of Safari's own browser chrome** — e.g. "iPhone 15" resolves to
  a 393×**659** viewport, not the phone's full 393×852 screen, because Mobile Safari's address bar
  and tab strip eat real vertical space)
- `deviceScaleFactor` (2 or 3 — matters for anything that reads `devicePixelRatio`)
- `isMobile: true` and `hasTouch: true` (matters for `navigator.maxTouchPoints` and for
  `window.matchMedia("(pointer: coarse)")` — **this is exactly the media query
  `src/workspaces/site-planner/lib/propertiesSheet.js`'s `isPhoneSheetMode` reads** to decide
  whether to show the phone bottom sheet at all, so a bare Chromium viewport resize would never
  arm it)
- the Mobile Safari user-agent string

This harness uses six: **iPhone SE** / **iPhone SE landscape**, **iPhone 15** / **iPhone 15
landscape**, **iPhone 15 Pro Max** / **iPhone 15 Pro Max landscape** — smallest-current-shape,
common-case, and largest, each in both orientations. Playwright ships many more (iPhone 6 through
15, several Android devices) if a different one is ever needed — `Object.keys(playwright.devices)`
lists all of them.

**A real, load-bearing consequence of "viewport is net of Safari chrome," measured, not
theoretical:** the app's own phone/desktop layout switch is a single 760px width breakpoint
(`useNarrow()`, reused everywhere as `FLOAT_MIN_WIDTH`). Three of six device/orientation
combinations in this harness resolve BELOW that breakpoint in landscape (iPhone SE landscape 568px,
iPhone 15 landscape 734px) and get the phone layout — but **iPhone 15 Pro Max landscape resolves to
814px, which is ABOVE 760 and gets the full DESKTOP layout instead**, small toolbar icons, docked
side panel and all. That is not a bug in this harness — it is the app's actual behavior on the
actual largest current iPhone in landscape, and the run below found real breakage that only happens
in exactly that state (see the findings section).

## Running it

```
npx playwright install webkit          # once per environment; report the exact error if it fails
npx playwright install-deps webkit     # once per environment; needs root / apt
node ui-audit/verify-phone-orientations.mjs
```

Env var `PLANYR_URL` overrides the target (defaults to `https://planyr.io/`). Results land in
`ui-audit/.artifacts/phone-orientations/` (gitignored, regenerated on demand, like every other
ui-audit artifact folder — see `/CLAUDE.md`'s "🗺 Two generated, committed indexes" section for why
generated output never lives in git): a `results.json` with every check's raw detail, and one
screenshot per device × orientation × surface.

## How it reaches a signed-in-shaped project without real credentials

Project-scoped surfaces (Site / Schedule / Review / Library / Notes / Spreadsheet) need a project
to open. This session had no `E2E_EMAIL`/`E2E_PASSWORD` (those are GitHub Actions secrets used by
`.github/workflows/e2e.yml`'s scheduled signed-in run — see `OWNER-TODO.md`'s "one 2-minute paste"
item — and are not available inside a Claude Code session). Rather than skip those six surfaces
entirely, this harness reuses `ui-audit/lib/fixtureSeeding.mjs` (the same mechanism
`verify-v91632-real-plan.mjs` already uses against a local build) to seed the owner's real **Bain**
plan into `localStorage`/IndexedDB as a **local, signed-out** project, then points it at the real
`https://planyr.io/` origin instead of a local build.

**What that does and does not prove:** it exercises the real deployed bundle and the identical
workspace-chrome layout code (header, module tabs, left rail, bottom sheet) a signed-in user's
browser runs for those six surfaces. It does **not** exercise anything auth-gated — the signed-in
account pill, cloud-sync badges, or any control that only appears once a real session exists. Any
phone-layout defect specific to those signed-in-only elements is out of this run's scope and would
need a real `E2E_EMAIL`/`E2E_PASSWORD`-driven run (the scheduled GitHub Action, or a session that
has those secrets) to check.

## What this CANNOT prove — read before citing a clean run as "verified on iPhone"

Four specific gaps, because "close enough" claims are exactly how a real defect survives review:

1. **The collapsing Mobile Safari toolbar mid-scroll is not emulated.** A real iPhone shrinks its
   own address-bar/toolbar chrome as the page scrolls, which *grows* the usable viewport height by
   roughly 50px partway through an interaction — Playwright's WebKit viewport is fixed for the
   whole session at the pre-computed "chrome already subtracted" height. A layout that only breaks
   at the transient *larger* mid-scroll height is invisible here.
2. **`env(safe-area-inset-*)` resolves to zero, with no way to override it on WebKit.**
   `VERIFICATION.md`'s own note confirms this by trying, not assuming: Chromium exposes a CDP
   override (`Emulation.setSafeAreaInsetsOverride`) that can inject a synthetic non-zero inset;
   Playwright exposes no WebKit equivalent. So any code path that only activates with a real
   notch/Dynamic-Island/home-indicator inset (the phone bottom sheet's own `safeAreaInsets()` read
   is exactly such a path) is exercised with an all-zero value here on WebKit, and only as a
   *simulated* value on Chromium — never a value confirmed to match a real device.
3. **No real held-and-moved touch drag.** Playwright's `touchscreen` API exposes only a
   single-point `.tap()` on both WebKit and Chromium — there is no cross-engine drag primitive.
   (Chromium alone can fake one via `Input.dispatchTouchEvent`, a Chromium-only CDP call with no
   WebKit equivalent.) This harness only selects/taps; nothing here proves a drag gesture — a
   resize handle, the properties sheet's own drag-to-resize handle, a canvas pan — behaves
   correctly under a real finger.
4. **It is not a finger on real glass.** `hasTouch: true` makes `matchMedia("(pointer: coarse)")`
   and `navigator.maxTouchPoints` read correctly, and Playwright can dispatch touch events, but
   there is no real capacitive touch, no real momentum-scroll physics, and no real on-screen
   keyboard — anything gated on the ACTUAL iOS keyboard's real height (rather than the
   `visualViewport` resize event, which WebKit does emulate reasonably) is unverified.

A clean run through this harness means: **verified in WebKit's layout/rendering/pointer-event
engine, at real iPhone screen dimensions, in both orientations** — not "verified on an iPhone" and
not "verified in Safari." Say which one you mean.

## The 2026-09-09 baseline run — headline results

Full detail lives in the backlog item this file was filed under (B1447440) and in
`ui-audit/.artifacts/phone-orientations/results.json` from the most recent run (regenerated on
demand, not committed). Three findings worth knowing before touching phone layout code:

- **The largest current iPhone in landscape (iPhone 15 Pro Max, 814px effective width) exceeds the
  app's 760px phone breakpoint and silently gets the full desktop layout** — small toolbar icons,
  a fixed left icon rail that does not fit the shallow landscape height, and the phone-only
  Properties bottom sheet never appears at all (only the docked desktop panel does). This is not
  itself a bug (it is the breakpoint working as designed) but it means "phone" and "landscape" are
  not one guarantee — the widest landscape phones get treated as desktop.
- **The left icon rail on that same device/orientation get bottom-clipped** — "Overlays" and
  "Standards" sit partly below the visible viewport with no scroll affordance to reach them, because
  the rail is not inside a scrolling container.
- **In the Notes workspace, the global "?" help/report button sits on top of the Bin control** on
  every device/orientation except one — 82% of the smaller control's area overlapped. Both are
  always-on-screen chrome, not something a scroll reveals apart.
- **On the smallest phone in landscape only (iPhone SE, 568×320), the map's "Layers" button and its
  "Zoom in" control fully overlap** (100% of the smaller one's area) — reproduces on iPhone SE
  landscape specifically, not on iPhone 15 or iPhone 15 Pro Max landscape, so it is a narrow-width
  clustering defect rather than a general landscape one.
- **A likely app-wide, not landscape-specific, finding**: most of the app's header/toolbar chrome
  (module tabs, undo/redo, the account pill, map toolbar buttons) render at roughly 22–32px tall on
  every phone size and orientation tested, below the 44×44 CSS px touch-target floor. This reads as
  a standing density choice for a data-dense professional tool rather than a regression, but it is
  the single largest category of findings by volume and is recorded here rather than left as 1,000+
  buried lines.

The phone Properties bottom sheet itself (`propertiesSheet.js`) came back **clean** on every
combination where it actually renders (5 of 6) — it opens, and the app's own "shift the map so the
selection stays visible" behavior held in every case measured.

## Permanent case: a Site-map hint must not follow you off Site (B2050816)

`PLANYR_CASES=notice-leak node ui-audit/verify-phone-orientations.mjs` drives iPhone SE and iPhone 15
(portrait + landscape) × six destinations: fresh load of `#/site` → Select parcels → hint visible →
switch tab → hint gone. Two things a future session would otherwise rediscover: the sandbox's blocked
GIS hosts put the map in its error state, which occupies the hint's render slot, so the harness answers
non-target-origin requests locally; and the hint expires on its own a few seconds after arming, so a
"gone" reading taken late is VOID (the case enforces a 4 s window). Results are WebKit-emulated, never
"on device". Last run: 24/24 PASS on production; 0/24 on the pre-fix build (red-proof).
