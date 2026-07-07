# Cowork runbook — element-level sync live verification (B670–B674 / V229–V231)

**For: a Claude Cowork session with a real browser.** This is the one-sitting runbook for the
live checks the build sandbox couldn't perform (it blocks sign-in). Everything here is already
implemented, unit-tested, built green, and merged to `main`; these are the *observed-working*
confirmations that move V229–V231 (and their B-items) to Done. **None of this is Michael's job.**

> **📌 Status after the first run (2026-07-07) — what's left.** A first Cowork pass ran with two
> SAME-ACCOUNT sessions: V229 #1–4,#6 passed; **#5 found a real lost-update (fixed same day — re-run
> it per its updated step below, with TRUE DevTools offline)**; #12's no-lock half passed; #13's
> missing same-account pill and #18's fresh-client crash were both fixed same day (#13 re-check;
> #18 is now sandbox-covered — a live pass is a quick spot confirmation). **Still entirely open:
> V230 (all of 7–11) — it REQUIRES a second account on a team-shared site** (two windows of one
> account can only ever produce "you (another window)", which exercises none of the named-toast /
> roster logic) — **plus #14–17 and #4's make-3-edits half.** Michael provides the second test
> account / team invite (tracked in OWNER-TODO); everything else here is self-service.

## What shipped (context in 6 lines)
The Site Planner's cloud save moved from ONE whole-plan blob to ONE ROW PER ELEMENT
(`site_elements`: PK `(site_id, kind, id)`, per-row `rev` guards, tombstone deletes, batch RPC
`commit_elements`). Writes stream per element (B671), every open site subscribes to its rows and
applies changes live with a full refetch on every join/rejoin/tab-wake (B672 — the old blob is
frozen as `sites.data_backup`), collisions toast BOTH sides with Show/Restore actions (B673), and
the single-tab edit lock is gone — all tabs/users edit concurrently (B674) with an "N here" pill.

## Setup
- **URL:** https://planyr.io (production; confirm the deploy includes the B674 merge).
- **Two signed-in sessions:** the seeded test account (`e2e@planyr.test`, password = the
  E2E_PASSWORD secret) — a **second browser profile or an incognito window counts as a second
  session**. For the *named*-toast checks use a TEAM-shared site with two different accounts if
  a second account exists; otherwise same-account two-profiles is fine (toasts then say
  "you (another window)" — that's correct behavior, note it as such).
- **A site with history:** at least one check must run on a site that existed BEFORE 2026-07-06
  (it has pre-migration `deletedIds` history). Any of Michael's older plans qualifies; don't
  modify his real geometry — move something, verify, undo it (undo re-commits cleanly).
- **Escape hatch if anything is badly broken:** in the console
  `localStorage.setItem("planyr.multiwriter","off"); location.reload();` restores the old
  single-editor lock client-side. Emergency data rollback (owner-level, don't run casually):
  `src/workspaces/site-planner/db/site_elements_down.sql` rebuilds blobs from rows, and
  `sites.data_backup` holds the pre-cutover copies (~30 days).

## The matrix — run in order, tick each
Sessions: **A** and **B**, same plan open in both.

**V229 — realtime propagation & refetch**
1. A moves a building → lands on B's canvas within **~2s**, no reload. ☐
2. A deletes an element → it vanishes from B. ☐
3. A draws a NEW element → appears in B, stacked on top of its type layer. ☐
4. Background B's tab ≥30s; A makes 3 edits; refocus B → the wake refetch shows all 3 (no gaps). ☐
5. **(RE-RUN — this found the 2026-07-07 lost-update, since fixed.)** Use TRUE **DevTools →
   Network → Offline** on B (NOT `pfSupabase.realtime.disconnect()` — that only severs realtime
   while leaving the write path up, which under-tests the fix). B offline → B edits 2 elements →
   A edits the SAME element + one other → B back online → both sessions converge with A's edits
   intact (B's same-element edit either wins-with-toasts or is kept per LWW — but NOTHING reverts
   to pre-offline geometry). Spot-check revs with the SQL below: no element's data regresses. ☐
6. Reload A mid-session → canvas repaints instantly from the device mirror, then re-trues from
   rows; on the PRE-2026-07-06 site, nothing previously deleted resurrects. ☐

**V230 — conflict toasts (both sides, correct names) — ⚠ REQUIRES the second ACCOUNT on a
team-shared site** (the 2026-07-07 same-account run couldn't exercise any of 7–11's named-toast
logic; don't tick these from same-account windows)
7. A and B edit the SAME element within ~15s → second committer's version shows in BOTH; the
   losing session toasts "…was also just edited by ⟨name⟩ — your version was kept", the other
   "⟨name⟩ changed ⟨element⟩ you just edited — their version is showing"; **Show** zooms+selects. ☐
8. A deletes an element B is editing → B's canvas drops it + toast "…was deleted by ⟨name⟩" with
   **Restore**; Restore brings it back in BOTH sessions with B's edit intact. ☐
9. A edits, B deletes within the window → element stays deleted (delete wins); A gets the removal
   + "…you just edited was deleted by ⟨name⟩". ☐
10. Names: two windows of ONE account → "you (another window)"; two accounts on a team site →
    real first+last names. Never blank/wrong. ☐
11. Quiet pass: A edits elements B hasn't touched → B updates live with NO toast spam
    (burst → cap 4 + "+n more"). ☐

**V231 — multi-writer + presence + regressions**
12. BOTH sessions edit different elements simultaneously → both persist; NO read-only banner, NO
    "only one tab can edit" notice, NO old blue "changed in another session … Take over editing"
    banner — anywhere, at any point in this whole run. ☐
13. The header pill counts **SESSIONS**: two windows of even the SAME account read "**2 here**" in
    both (hover shows "You (2 windows)"); with a second account it's "2 here" with their name; a
    third session makes "3 here". It disappears when back to one session. *(Reworded 2026-07-07 —
    the first run correctly flagged that the people-count showed nothing for same-account windows;
    fixed to session-count.)* ☐
14. Paste/generate a ~30-element group (parking fill) in A → arrives in B complete, one batch,
    never a half-applied state. ☐
15. B goes offline, makes 2 edits, reconnects → badge shows syncing/retrying then clears; edits
    land in A; rejoin refetch leaves both identical. ☐
16. Refresh mid-edit (edit then immediately reload) → nothing lost after the reload settles. ☐
17. The escape hatch: set `planyr.multiwriter` = "off" in B + reload → B takes the old lock role
    (second tab of same browser goes read-only with the take-over banner); remove the key + reload
    → concurrent editing returns. ☐
18. Signed-out regression: log out (or private window, no login) → the Site module RENDERS on a
    completely fresh client (no error card — the 2026-07-07 cold-start crash is fixed as B690 and
    now sandbox-covered; this live pass is a spot confirmation), and drawing/saving works exactly
    as before, purely on-device; no console errors. ☐

## Recording results
- Append a dated ✅ note (date · method · observed result) to **V229/V230/V231** in
  `VERIFICATION.md`; when one is fully clean, move it to `VERIFICATION-DONE.md` and move its
  B-item (B672/B673/B674) from `## ⏳ Verify` to `BACKLOG-DONE.md`.
- **Any failure:** recurrence rule — move the B-item back to 🔲 Open with a `Recurrence:` line and
  the exact repro; if data ever looks WRONG (not just stale), say so loudly in the session and
  point at the rollback pointers above before touching anything.
- SQL spot-checks (optional, Supabase SQL editor, project `lyeqzkuiwngunutlkkmi`): watch commits
  land with `select kind,id,rev,updated_at from public.site_elements where site_id='<id>' order by
  updated_at desc limit 10;` · fidelity report: `src/workspaces/site-planner/db/site_elements_fidelity.sql`
  (expect only sites whose rows are AHEAD of the frozen blob — the blob no longer updates).
