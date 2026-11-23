# Owner product constraint #8

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

8. **(2026-09-11 · SUSPENDED 2026-09-12 · RE-LANDED 2026-09-15, live-verify still PENDING) The
   canvas commits ONE framing per load.** The GOAL was never in doubt; what has changed twice is
   whether a mechanism enforces it.
   **The history, because it is the whole reason this entry is long.** B1574432's original
   `framingCommitted` gate (hide the canvas until a real framing is computed, a 1.5s watchdog as the
   fallback) shipped with its own real-signed-in-boot path explicitly unverified (parked
   `Blocker: auth` — the untested path was exactly the one the sandbox could not sign in to
   exercise) and went on to make the Site Planner canvas **permanently invisible and unclickable on
   planyr.io** for every project, for every signed-in user — a P0 outage, not the two-frame flash it
   was fixing. See **B1594320** for the incident and the revert.
   **⛔ WHAT IS TRUE NOW, so a session does not act on the suspended text above.** The gate is BACK
   as of PR #1696 (2026-09-15), under the same item B1574432. `data-planner-reveal` on the canvas
   says WHY it revealed — `"framed"` (a real framing caused it, the only healthy answer) or
   `"ceiling"` (the wall-clock rescue fired, telemetered as `boot-framing-stalled`). The three
   conditions `docs/incidents/B1594320-CANVAS-VISIBILITY-OUTAGE.md` sets were addressed by name: the
   sandbox can now drive the real signed-in `loadEpoch` remount (`ui-audit/lib/authRemount.mjs`), the
   reveal ceiling is absolute and per-plan so a repeating remount cannot postpone it
   (`lib/bootFramingDeadline.js`), and the live pass is logged as **V1145488**.
   **⛔ THE LIVE-PASS REQUIREMENT IS UNCHANGED AND IS STILL OUTSTANDING — do not read "re-landed" as
   "verified".** A genuine signed-in live pass on a real browser (not the sandbox's harness, however
   faithful) is still owed before this is treated as a settled requirement, and the incident doc
   states it more strictly still — *before merging* — which this re-land did not meet: it shipped
   first and parked the pass, at the dispatcher's explicit direction. That deviation is recorded
   here rather than smoothed over, because reading a shipped gate as a verified one is the exact
   mistake that caused the outage. Until V1145488 records a dated PASS: MERGED ≠ LIVE.
   `ui-audit/verify-boot-framing.mjs` (plus `-auth` and `-cases`) exists, works, and now has a
   shipped mechanism to check — but it is deliberately **still not a required CI gate**, and making
   it one is gated on that same live pass.
