# B1594320 — the Site Planner canvas went permanently invisible in production

**Date:** 2026-09-12. **Severity:** P0 — every plan, for every signed-in user, unusable.
**Cause:** commit `453623a` (B1574432, "the canvas paints ONE framing per load"), merged 2026-09-11
23:08 Central. **Fix:** full revert, same session, this item (B1594320). This doc exists so a
future re-attempt at B1574432 does not re-spend the investigation below.

## What happened

B1574432 added a `framingCommitted` gate to `SitePlanner.jsx`: the drawing SVG and both GIS
backdrop `<div>`s carried `visibility: framingCommitted ? undefined : "hidden"`, where
`framingCommitted` starts `false` and is meant to flip `true` either (a) inside a
`useLayoutEffect` that measures the container and computes the first real framing before paint, or
(b) failing that, inside a 1.5-second watchdog that forces it `true` unconditionally (LOUD-FAILURE:
"this can never leave a blank canvas"). The goal was to stop a real, filmed defect — a hardcoded
default view (`{ppf: 0.35, offX: 60, offY: 60}`) flashing on screen for a couple of frames before
the real framing replaced it, on a signed-in cold load.

It shipped with its riskiest path explicitly unverified: the flash rides a REMOUNT that only fires
on a signed-in boot (`SitePlannerApp.jsx`'s `applyUser` bumps `loadEpoch` when the cloud pull
settles, remounting the keyed `SitePlanner` mid-boot), and the authoring session could not sign in
to Supabase from its sandbox. It substituted a route-change remount as a structural proxy, proved
all its own harness arms green, and parked the real path as `Verify: live, Blocker: auth`
(`VERIFICATION.md` V1127680).

Within hours of merging, the owner reported the Site Planner canvas permanently blank and
unclickable on `planyr.io`, on every project he opened, reproduced twice on two separate projects.
`visibility: hidden` was observed inline on `[data-testid="planner-canvas"]`, sampled every 300ms
for 2.5+ seconds with no change — well past the 1.5s watchdog that was supposed to make this
impossible.

## The bisect (measured, not assumed)

- `453623a` is the ONLY commit in this repo's history to add any visibility-gating to the planner
  canvas or its backdrop hosts. Confirmed by diffing every commit in the reported regression window
  and by `git show <commit>^:SitePlanner.jsx` at the parent revision — before it, this element
  rendered unconditionally.
- PR #1674 (B1575232, click-ownership fix, merged 12 minutes after 453623a) does NOT touch the
  `framingCommitted` region — diffed byte-for-byte, zero changes. `ui-audit/verify-boot-framing.mjs`
  re-run against a fresh build of the current tree confirms the mechanism behaves exactly as its
  author measured at merge time, for every path that harness can drive.
- PR #1675 (B1340512, the "Stack mark" module loader) was **not even merged** at the time this
  incident was investigated (`state: open, merged: false`, checked via the GitHub API) — it cannot
  have caused a production regression, and its diff (once it did merge) touches only
  `ModuleLoader.jsx`/`BrandMark.jsx`/`moduleLoaderTheme.js`, with zero relation to `SitePlanner.jsx`.

**Conclusion: 453623a alone.**

## Why it stuck — investigated, not resolved with certainty

The mechanism has two safety valves. For `framingCommitted` to stay `false` past 1.5 seconds, EITHER
`active` or `document.visibilityState === "visible"` must fail to hold continuously for that whole
window — the watchdog does not check the container at all, only those two things. The owner's own
measurement (every ancestor of the canvas computed visible) rules out the coarse CSS cases
(`display:none` on an ancestor), which narrows it to either a React prop disagreeing with what the
DOM shows, or a genuine repeating remount that keeps resetting the watchdog's clock before it fires.

### Hypotheses tested and REFUTED this session (all in a local sandbox build, offline)

1. **Rapid repeated remounts alone.** Switched the route between two local fixtures every 400ms,
   five times in under 2 seconds (`fixtureSeedMulti` + hash navigation). Every single mount measured
   its container correctly and revealed within its own short window — a fresh mount's container is
   already laid out (same DOM position, same parent), so remount frequency by itself does not
   reproduce the failure.
2. **A heavier real fixture + GIS layers + desktop viewport.** `bain-concept-original.json` (47
   elements, 2 rasters) with 4 GIS layers forced on (`withLayerArm(..., "owner-4")`) at 1600×1000 @
   2.15 dpr. Same clean result — one framing, immediately visible.
3. **The exact reported production shape, driven through the real UI.** `e2e/drawKinds.js`'s
   `startBlank` (open the app → land on Map → click "Draw" → transition into Site mode, exactly the
   "open a project, then click Site tab" shape), draw a real building, then `page.reload()` to force
   a fresh mount reading the saved plan back off storage. Ran this test against BOTH the pre-revert
   (buggy) code and the reverted code — **both pass.** This is the closest local proxy to the real
   repro and it still could not reproduce the failure.

### A real, provable code weakness — found, fixed, but NOT confirmed as the exact trigger

`SitePlannerApp.jsx`'s `applyUser` de-duplicates repeat auth events for the same user via
`if (uid && uid === prevUid.current && event !== "SIGNED_OUT") return;`, but the OLD code only wrote
`prevUid.current = uid` at the very end of a long multi-`await` function (after `claimInvites`,
`pullCloud`, `refreshSites`, etc.). `@supabase/auth-js` (installed 2.108.1, read directly from
`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js`) can legitimately deliver more than one
auth event for the same resumed session close together:

- `_emitInitialSession(id)` fires `'INITIAL_SESSION'` to a NEW subscriber the instant it calls
  `onAuthStateChange`, using whatever session is known in memory at that moment.
- `_recoverAndRefresh()` (called once from `_initialize()` on the client's first use) separately
  reads the persisted session from storage and, for the common case where it is not close to expiry,
  calls `_notifyAllSubscribers('SIGNED_IN', currentSession)` — a BROADCAST to every subscriber
  registered at that moment.

`SitePlannerApp` is a lazy-loaded workspace that subscribes to `onAuthChange` later than `Shell.jsx`
(which mounts unconditionally and subscribes first). If `SitePlannerApp`'s own subscription lands
inside the same window as `_recoverAndRefresh`'s work, its listener can receive TWO events for one
resumed session, and because the old code's dedup marker was written only after several awaits, the
SECOND event could race past the guard and re-run the whole pull+resume+`setLoadEpoch` sequence,
force-remounting the keyed planner a SECOND time mid-boot. This is exactly the mechanism 453623a's
own commit message names as the trigger for its flash bug, just with a path to fire more than once
per boot rather than exactly once.

**Fixed as defense-in-depth** (moved the `prevUid.current = uid` write to immediately after the
dedup check passes, before any `await`), but this session could NOT prove it is the actual
production trigger — that requires a real signed-in session and live browser egress, neither
available here (`net::ERR_CONNECTION_RESET` reaching `planyr.io` from Chromium through the
configured proxy, re-confirmed this session — the same wall B1574432's own author hit).

## The fix actually shipped

A full revert of `SitePlanner.jsx`'s `framingCommitted` mechanism — not a narrower patch — because
this session could not construct a test that proves a narrower fix closes the real gap, any more
than the original session could. A revert is provably correct independent of which exact mechanism
triggers the failure in production: it removes the ONLY code path capable of producing the reported
symptom (confirmed by grep: zero remaining references to `framingCommitted`/`data-planner-mount`/
`mountIdRef` in the file). This deliberately reintroduces the original two-frame boot flash — a real,
lesser, already-filed defect (B1574432, reopened) — as a known, accepted trade: a permanently blank
core module is strictly worse than a two-frame flash.

The `applyUser` TOCTOU fix ships alongside as defense-in-depth (real, general-purpose robustness
against a documented supabase-js behavior), not as "the fix" for the P0.

## What a future re-attempt at B1574432 needs, that this repo did not have

1. **A way to actually exercise the signed-in `loadEpoch` remount from a sandbox with no live
   Supabase access.** Route-interception of the specific GoTrue/PostgREST calls `applyUser` makes
   (fake `INITIAL_SESSION` + a separately-timed fake `SIGNED_IN` broadcast, exactly reproducing the
   two-event race above) would let a sandbox exercise this without real credentials. Nobody has built
   this yet; `ui-audit/lib/planFixture.mjs` seeds LOCAL storage only, never the auth layer.
2. **A hard ceiling on the watchdog that survives a remount**, if the gate returns: right now,
   `framingWatchdogRef`'s `setTimeout` is scoped to one mount's lifetime (its `useEffect` dep array
   is `[framingCommitted, active]`, and a remount tears down and recreates it from zero). A future
   version should track "how long has this PROJECT been trying to get its first framing" using state
   that survives a remount of the innermost `SitePlanner` (e.g. hoisted to `SitePlannerApp`, or a
   `sessionStorage` timestamp keyed by `activeSiteId`), so a repeating remount cannot indefinitely
   postpone the reveal — this was tested and could NOT be shown to reproduce the failure by remounts
   alone (see refuted hypothesis 1 above), but it is still a real structural weakness worth closing
   before re-attempting the hide-until-ready approach at all.
3. **Do not re-ship a hide-until-ready gate on this element without a genuine signed-in live pass
   BEFORE merging.** `Verify: live, Blocker: auth` on the ORIGINAL item was the correct classification
   — the mistake was treating "3/3 clean sandbox arms" as sufficient to ship past that blocker rather
   than as a reason to hold until the blocker cleared.
