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

## LIVE MEASUREMENT UPDATE (same day, after the revert shipped) — the hidden-tab case is now a
## MEASURED mechanism, not a hypothesis

A separate Claude session with real signed-in browser access to `planyr.io` (a capability this
sandbox does not have) ran diagnostics directly inside the page on the owner's own account, project
`smtvztgdsp5p`, Site view, fresh load — while the bundle carrying the ORIGINAL (pre-revert)
`framingCommitted` code was still live. Recorded here verbatim because it settles a question this
document's own "why it stuck" section above left open.

**Measured:**
```
document.visibilityState : "hidden"
document.hasFocus()      : false
requestAnimationFrame    : ZERO callbacks fired in 6295 ms — not one
setTimeout(..., 1500)    : fired, at 2291 ms (throttled ~800 ms late, but it fired)
```
Page state, same load: `[data-testid="planner-canvas"]`'s inline `visibility: hidden` never cleared;
computed visibility `hidden`; the canvas box was `969x408` (non-zero — not a degenerate container);
`data-planner-mount="mts62vi"` was present (confirming the OLD bundle, with the reverted mechanism,
was the one live at measurement time); `data-view-ppf/-offx/-offy` read `0.35 / 60 / 60` — still the
literal `useState` boot default, proving the framing genuinely never committed; three `data-el-id`
groups were present (the model loaded fine — this is a paint-only failure, consistent with every
finding elsewhere in this document).

**What this settles.** Re-reading the reverted source with this measurement in hand: BOTH gating
effects — the layout effect and the 1.5 s watchdog — carried an EXPLICIT, identical early return,
`if (typeof document !== "undefined" && document.visibilityState !== "visible") return;` (or
`return undefined;` in the watchdog). This is not an indirect rAF dependency — grep the reverted
diff for the exact line. So the mechanism is direct and now measured end to end: on a document that
boots `visibilityState: "hidden"` and STAYS that way, this line matches on every render, and the
watchdog's own `setTimeout` is **never even scheduled** — not throttled, not delayed, never armed at
all. A LOUD-FAILURE rescue that refuses to arm itself in exactly the condition it exists to catch is
not a rescue. **Correction to a plausible-sounding but incorrect side-hypothesis:** the live
session's own diagnostic reasoned "if the watchdog is driven by `requestAnimationFrame`, or chained
through one, it can never fire here" — reasonable from the outside, but the actual code shows
something more direct and easier to fix: the watchdog is a plain `setTimeout`, gated by one explicit
`if`. The measured fact that stands regardless of that distinction: `setTimeout` demonstrably still
fires in this exact hidden, unfocused document (the diagnostic's own generic probe proved it,
independent of the app's watchdog never arming), so a wall-clock deadline is a viable rescue
mechanism here — it just cannot be gated on `document.visibilityState` the way this watchdog was.

**What remains open, stated as plainly as the live session stated it, and not to be smoothed over:**
the FOREGROUNDED cold load is still UNMEASURED. Every reading above — like every reading Michael's
own original report described — was taken (or occurred) with `visibilityState: "hidden"`. Whether a
genuinely foregrounded load (the ordinary case of someone looking at the tab) also goes permanently
blank is not established by this measurement, and the live session was explicit that it could not
close this from its own position either (it cannot force Michael's OS-level window to the
foreground). **A future re-attempt must not inherit "production is permanently down for every load"
as a premise — that was never measured, only the hidden-tab case was.** It is entirely possible the
ordinary foregrounded case recovers via the layout effect's own re-run (it carries no dependency
array and re-fires on every render, so a later transition to `visible` should let it catch up) and
that the persistently-reported P0 was specifically about tabs that boot or settle into a
backgrounded state and never leave it — still a real, serious bug (browsers restore tabs in the
background routinely, e.g. on OS resume, a phone re-opening a suspended app, or a second window/tab
regaining focus elsewhere), just a narrower one than "always broken."

**Console check (same live session):** filtering for framing/stalled/boot/planner/canvas on two
fresh loads turned up nothing. Weak evidence on its own (the telemetry may not be console-mirrored),
but consistent with the watchdog's `boot-framing-stalled` `reportClientEvent` call never having run
— which is exactly what "never even armed" predicts.

**For a future re-attempt at B1574432, this changes recommendation #2 above from a hypothesis to a
requirement:** the watchdog half of any future fix must fire on a plain wall-clock timer that is
**not** gated on `document.visibilityState`, and must not be reachable only through a code path that
depends on `requestAnimationFrame` anywhere between "boot" and "reveal." The layout effect's own
`document.visibilityState !== "visible"` guard is fine to keep (you genuinely cannot trust a
container measurement taken while hidden) — it is specifically the WATCHDOG, whose entire job is to
rescue the case the layout effect cannot handle, that must not defer to the same condition.

---

## SANDBOX MEASUREMENT UPDATE (B1600352, 2026-09-12 ~01:15) — the foregrounded case is now MEASURED, and the framing failure PREDATES 453623a

This section closes the two questions the sections above left explicitly open, and corrects one
statement in them. Everything here is a harness measurement at 1280×900 on a real fixture plan
(`ui-audit/fixtures/goose-creek-plan1copy.json`, 66 elements), run against builds produced from this
repo's own commits — not a reading of the source.

### 1. THE FOREGROUNDED COLD LOAD IS FINE. This is a hidden-boot bug, not everyone's bug.

The doc above states, correctly and emphatically, that this was never measured and that a future
attempt *"must not inherit 'production is permanently down for every load' as a premise."* Measured
now, on **three different builds**:

| build | foregrounded cold load | hidden boot |
|---|---|---|
| `258abb3` — the PRE-`453623a` world (the 3:40 PM walk) | **plan on screen**, ppf 0.1064540557003681 | **plan OFF-SCREEN**, ppf 0.35 off (60, 60) |
| `453623a` — B1574432, the gate as shipped | **plan on screen**, ppf 0.0831, hit-testable | **canvas BLANK**, ppf 0.35 off (60, 60) |
| reverted `main` (`d30f712e`+) | **plan on screen**, ppf 0.1064540557003681 | **plan OFF-SCREEN**, ppf 0.35 off (60, 60) |

The doc's own guess about the mechanism — that the layout effect's missing dependency array lets a
foregrounded load catch up — is **confirmed**. The defect is specifically *"the load began while the
tab was not frontmost"*, which is narrower than the original premise and still serious.

### 2. ⛔ THE NEVER-COMMITTED FRAMING PREDATES `453623a`. THE REVERT IS FAITHFUL, AND THE WORLD IT RESTORED WAS ALREADY BROKEN.

The obvious reading of "revert the commit that broke it" is that the prior behaviour returns. It did
— **exactly**, which is the problem. Pre-`453623a` and reverted `main` are **byte-identical on both
arms, to the last decimal**: same `ppf 0.1064540557003681`, same offsets, same element rects
(`x -350..-205`, `x -491..-303`, `x -333..-210` on the hidden arm, all `inView: false`).

So `453623a` **never caused the framing failure.** It added the *hiding*, which changed a
pre-existing silent defect into a loud one:

- **before it** — hidden boot paints the aerial with the plan off-screen (silent, plausible, reads as data loss)
- **with it** — hidden boot paints nothing (loud, obviously broken)
- **after the revert** — back to silent

**This matters for what gets fixed next.** The blank canvas and the unframed view are TWO defects,
not one. The revert closed the first. The second is still live on production, is older than this
incident, and is the one the owner is actually looking at.

### 3. THE MECHANISM OF THE SURVIVING DEFECT: the retry is `requestAnimationFrame`-driven.

`SitePlanner.jsx`'s `fitReq` effect asks `mayFrame(..., { visible: isVisible(), … })`. In a hidden
boot that returns `document-hidden`, which is correctly treated as a "not yet" rather than a "no" —
and the retry is:

```js
const poll = () => {
  if (isVisible() && sizeMeasuredRef.current) { requestFit(fitReq.ticket); return; }
  raf = requestAnimationFrame(poll);
};
raf = requestAnimationFrame(poll);
```

Its own comment reasons that *"a background tab's own requestAnimationFrame is suspended
(FOREGROUND-OR-VOID), so polling with it costs nothing while hidden and resumes on its own the
instant the tab is foregrounded — no separate `visibilitychange` listener needed here."* The first
half is true; the second does not follow. The live diagnostic recorded in the section above measured
**`requestAnimationFrame`: ZERO callbacks in 6295 ms** on the owner's tab. A retry that only runs
when the tab is already foregrounded cannot recover a tab that is not.

**This IS the rAF-chained deadline the original 2026-09-11 dispatch brief hypothesised.** That brief
pointed at the *watchdog*, and the watchdog turned out to be a plain `setTimeout` that was simply
never armed (the section above establishes this, and both investigating sessions reached it
independently). The rAF dependency is real — it is on the **retry path**, which nobody looked at,
because the gate was the thing that had just changed.

### 4. CORRECTION to recommendation #2 above: the layout effect's `visibilityState` guard is NOT fine to keep.

The doc says the guard is *"fine to keep (you genuinely cannot trust a container measurement taken
while hidden)."* **That premise is false as stated, and this document's own evidence refutes it.**
The live measurement in the section above records the canvas box as **969×408 while
`visibilityState === "hidden"`** — a real, laid-out container — and the owner's second reading hours
later on a different chunk recorded **x 54..1023, y 56..464**, likewise real. `getBoundingClientRect()`
is layout-accurate in a tab that is merely not frontmost.

What B1234400 actually caught was a container that had **never been laid out**, reporting a
degenerate box that the `Math.max(320, …)` floor then dressed up as a plausible 320×360. The direct
guard for that is the raw rect (`r.width > 1 && r.height > 1`), which refuses it without using "is
the tab frontmost" as a proxy. **Keeping the visibility guard is what forces reliance on a watchdog
at all** — remove the proxy and the framing simply commits at mount, in a hidden tab, correctly, and
the user sees the right picture the instant the tab comes forward.

### 5. "REVEALED" IS NOT "SHOWING THE PLAN" — and any future gate needs that as a guard.

The owner's 01:03 reading is the case to design against: canvas computed `visible`, aerial painted
across it, and all three elements at `x 1195..1405` against a canvas box of `x 54..1023` —
**revealed, and off-screen.** A reveal that fires without a committed framing is not a rescue; it
converts a loud failure into a silent one. Any future hide-until-ready mechanism must either frame
as part of revealing, or never reveal without a framing — and must distinguish *"nothing to frame"*
(a genuinely empty plan, where the boot default is the right answer) from *"could not frame"*.

`ui-audit/verify-boot-framing.mjs` now asserts this directly: every drawn element must land inside
the canvas box after boot, on every arm. It fails against reverted `main`'s hidden arm today, which
is the red-proof for the surviving defect.

### 6. THE RIG THAT CERTIFIED THE BLANK BUILD GREEN — both vacuities fixed in this same change.

`ui-audit/verify-boot-framing.mjs` was a required gate and was **green over a build with a
permanently blank canvas**. Two independent reasons, both now closed:

- **Its verdict could only catch too MANY framings.** "No mount painted more than one framing" is
  structurally blind to *none*: zero painted framings → zero offenders → ✅. The same shape as the
  vacuity its own teeth proof caught once before (no mount stamp → zero attributable mounts → zero
  offenders). It now asserts the canvas is revealed, framed off the boot default, hit-testable, and
  showing the plan — before the arm foregrounds anything.
- **Its headline evidence line asserted the opposite of what it measured.** It printed the
  hidden-phase frame count captioned *"a de-prioritised frame loop, which is what makes the
  suppression real rather than claimed"*. The number on this machine was **280 frames in 5,000 ms —
  56 fps, a full-rate loop.** It now reports what it actually got, and why a full-rate loop makes the
  arm *stricter* (the app had every chance to self-correct and did not).

A third, smaller one was caught by the new watchdog arm's own precondition on its first run: it
scored ✅ over a healthy 430×773 container that framed normally, because its zero-height CSS was
appended by an init script that runs before `<head>` exists and React mounts before
`DOMContentLoaded`. The precondition now fails the arm as VACUOUS if the container is not actually
degenerate.
