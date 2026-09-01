# Cowork verification run — 2026-07-17 (Scheduler cluster, batch 3 of the V281–V340 pass)

Follow-up to `COWORK-RESULT-2026-07-17-tsakiris-waller-batch.md` (PR #659) and
`COWORK-RESULT-2026-07-17-bain-batch2.md` (PR #660) — same 50-item target batch. This batch covers
the **Scheduler meeting-cadence cluster** (V305/V306/V307) plus two quick single-/two-tab banner
checks (V308, V335), driven live and signed in on the real **Goose Creek** project (`smqfy48tlk9j`).

## ✅ V305 — B815: Settings → Meeting calendars editor (FULL PASS, all 5 steps)

Opened Schedule → ⚙ Settings → Meeting calendars on Goose Creek (2 real bodies already existed:
"TCEQ MUD Creation", "Baytown City Council"). Added a new body, **"Baytown P&Z Commission"** /
jurisdiction "Baytown, TX", to exercise all 5 steps live:

1. **+ Add meeting body** — new body created, defaulted to Monthly · Tue · 2nd & 4th (exactly the
   item's own example cadence).
2. **Next 6 meetings → file by, 10 · business days before:** confirmed the real preview table (found
   after scrolling past the cadence/deadline sections — it's below "+ Add cadence rule", not an
   inline one-liner): **Aug 4, 2026 → file by Jul 21, 2026 · Aug 11 → file by Jul 28 · Aug 25 → file
   by Aug 11 · Sep 8 → file by Aug 24 · Sep 22 → file by Sep 8 · Oct 13 → file by Sep 29**, all at
   12:00 PM, labeled **"rule-derived, unverified."** Hand-checked the business-day math on Aug 4,
   2026 (a Tuesday): 10 business days back lands exactly on Jul 21, 2026 — matches.
3. **Setpos → Last, in a 5-Tuesday month:** selecting only "Last" (deselecting 2nd/4th) resolved to
   **"last Tue monthly — next: Jul 28, 2026 · Aug 25, 2026 · Sep 29, 2026."** September 2026 has 5
   Tuesdays (1, 8, 15, 22, 29); the engine correctly picked **Sep 29** (the 5th/last), not Sep 22
   (what would be the 4th) — confirms the setpos-vs-weekday-count logic is real, not a static list.
4. **Blackout + extra date:** added blackout `2026-07-28` (one of the then-upcoming meeting dates)
   and extra/special-called `2026-08-04`. The Next-6 list immediately reflected both: Jul 28
   disappeared from the list, and Aug 4 appeared first, in chronological order, with its own
   correctly-computed file-by date (Jul 21).
5. **Verified toggle + persistence:** setting "Verified on" to 07/17/2026 flipped the header label
   from "rule-derived, unverified" to "verified Jul 17, 2026" live. Saved, reloaded the page
   from a cold URL nav, reopened Settings → Meeting calendars → "Open Meeting calendars (3)"
   (count correctly incremented from 2→3) → reselected "Baytown P&Z Commission" → name, jurisdiction,
   cadence, blackout/extra dates, and the verified date all rode the reload intact.

**Verdict: full PASS, every sub-step in the item's own acceptance steps confirmed live with real
computed dates matching hand-checked business-day math.**

**Note for Claude Code / Michael:** this leaves a real (test) meeting body, "Baytown P&Z Commission",
on the live Goose Creek project's Meeting calendars — it doesn't affect any task or the schedule
itself (no task was left bound to it — see V306 below), but you may want to Remove it via Settings →
Meeting calendars if you don't want it sitting in a real project's config.

## 🟡 V306 — B816: bind a task to the meeting body (PARTIAL — bind mechanism confirmed, snap/cascade not exercised)

Right-clicked task #45 "Submit to Baytown P&Z" (a real, live Goose Creek task with a real successor,
#46) → "Bind to meeting calendar" → submenu listed all 3 real bodies plus "— none —", "+ Add
deadline row (call/file-by date)", and "Manage meeting calendars…". Selected "Baytown P&Z
Commission": the row picked up a small institution/calendar-bound glyph next to its lock icon, and
the right-click menu's top line changed to "Meeting: Baytown P&Z Commission" with a ✓ next to the
selected body in the snap submenu — confirms the bind itself is real and persists on the row.

**Did not** exercise the deeper live behaviors — snap-to-cadence actually moving the task's START
date, the cascade-drift full-cycle-jump toast, the infeasible-pin red glyph, or the two-reading
chain — because all of those require actually changing dates on a real, live task that has a real
downstream successor on Michael's Goose Creek schedule, and forcing that (then verifying the
cascade) risks leaving the real project's dates in a bad state if anything didn't revert cleanly.
Instead, after confirming the bind worked, unbound it back to "— none —" and confirmed the row
returned to its exact pre-bind state (status flipped back from "In Progress" to "Not Started", glyph
gone) — this at least confirms bind/unbind is scoped to the one targeted row with no side effect on
neighboring rows (a slice of the "no-regression on existing unbound tasks" claim).

**Verdict: PARTIAL. Bind mechanism + no-regression-on-unbind confirmed; snap-to-cadence date-move,
cascade-drift toast, infeasible-pin glyph, and two-reading chain not exercised (held off to avoid
mutating a real task's schedule dates).**

## 🟡 V307 — B817: Float/Cost-if-missed columns, at-risk/infeasible dots (NOT FULLY RUN)

Opened the grid's COLUMNS panel on Goose Creek — it lists only the 10 currently-shown columns (ID,
Task name, Start, Finish, Duration, Predecessors, Successors, Health, Status, Owner, Notes) with no
visible "add a column" catalog entry for Float or Cost-if-missed. These may be columns that only
appear once a task actually has a bound deadline row attached (via the "+ Add deadline row"
option surfaced in V306's bind submenu) rather than being manually addable — I didn't create a
deadline row this pass (same production-data caution as V306), so I couldn't confirm either the
columns' existence or the at-risk/infeasible status-dot rendering.

**Verdict: not fully run — worth a dedicated follow-up pass that actually adds a deadline row to a
disposable/test task (not a real production task) to see the Float/Cost-if-missed columns and status
dots render.**

## ✅ V308 — B819: Library shows no banner with one tab, even after Review round-trip (PASS)

Opened a single fresh tab to Goose Creek → Library: no "open in another tab" banner. Clicked into
Review, then back to Library (same tab, kept alive) — still no banner. Matches the item's core claim
exactly.

## 🟡 V335 — B850: Scheduler has NO two-tab banner; Doc Review's banner unchanged (PARTIAL — Scheduler half confirmed)

Opened two fresh tabs, both signed in as Michael Butler, both on Goose Creek's Schedule. Neither
tab showed any "open in another tab" / "only one tab can edit" banner — confirms the Scheduler is
"genuinely safe for two tabs" as the item claims. Navigated both tabs to Review (Doc Review) next —
with no drawing open in either tab ("No drawing open" empty state), there was nothing to compare a
banner against; opening a real PDF for markup in both tabs to check Doc Review's own banner is
unchanged wasn't attempted, to avoid touching real drawing/markup data.

**Verdict: PARTIAL. Scheduler no-banner claim confirmed live with two real signed-in tabs (also
surfaced a presence indicator — "2 here" — in the top bar on the Site view, which appears to be the
real mechanism instead of a blocking banner). Doc Review's-banner-is-unchanged comparison not
exercised.**

## 🌐 V336 — B851: route/crumb/grid alignment (incidental reconfirmation)

While driving the above, repeatedly reloaded and re-navigated Goose Creek's Schedule from cold URL
nav — the route (`#/project/smqfy48tlk9j/schedule`), the breadcrumb ("Goose Creek"), and the grid
contents (real PUD/DA/PID tasks) stayed consistent on every load, including the two-tab case. This
wasn't a dedicated V336 pass (no deliberate slow-cold-load throttling was used), so treat this as a
light incidental data point, not a full V336 verification.

---

## Running tally across all three batches (PR #659 + PR #660 + this one)

**Confirmed full PASS (15):** V337, V338, V339, V340 (full), V311, V313, V314, V317, V318, V320,
V321, V325 (partial-pass), V305 (full), V308, plus the V288/V290 GIS happy-path spot-check.

**Partial / needs a closer look (5):** V316, V322, V306, V307, V335.

**Not yet run (~32):** V281, V282, V284, V285, V286, V287, V289, V291, V292, V293, V301, V302, V303,
V304, V309, V310, V312, V319, V324, V326, V327, V328, V329, V330, V331, V332, V333, V334, V336 (needs
a dedicated pass), plus a genuine V307 follow-up (deadline-row columns) — two-tab/timing-race items
still flagged best-effort (no network-throttle tool available in this session to force a real socket
reconnect/timeout), items needing a different county/PDF download/Drive check, and Site-Planner setups
needing a heavy project / multi-sheet stitch / two buildings / etc.

On pass: fold each ✅ into `VERIFICATION.md` → `VERIFICATION-DONE.md` per the file's own protocol;
leave V316/V322/V306/V307/V335 flagged ⏳ with the partial notes above rather than closing them.
