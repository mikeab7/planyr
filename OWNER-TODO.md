# 📋 Michael's open to-dos (things only the owner can do)

> **For any Claude session:** when Michael asks "what's left / what do I still need to do," SURFACE this list
> in plain English. Keep it current — add an item the moment something needs his decision, input, or a manual
> step; tick/remove it once he's done it. This is the **owner's** plate only. Browser click-throughs and
> signed-in spot-checks are the Claude cohort's job (`VERIFICATION.md`), **never** Michael's — do NOT list those here.

_Last updated: 2026-06-27._

## Decisions only Michael can make
- [ ] **Which big feature to build next.** In progress: he picked **Team Workspaces** (find/fix bugs) on 2026-06-27.
      The other candidates still waiting: **Revision compare** (overlay/diff two drawing versions), **Named markup
      layers** (show/hide/lock groups of markups). Tell Claude which is next when Team Workspaces is in good shape.
- [ ] **Scheduler backend (B408, decision-gated).** Decide whether to consolidate the embedded Scheduler onto the
      main Supabase project (one backend) or keep it on its own. Claude can't proceed on this until he chooses.

### ❓ From the improve loop (2026-06-27)
- [ ] **Landscaping in the yield numbers (B553).** A deep audit of the yield/takeoff math (building SF, coverage %,
      parking ratios, acreage, impervious %, detention volume) came back **clean — no wrong calculations.** One
      judgment call surfaced: drawn **landscaping** (green buffer strips) currently counts as pervious "open/green"
      space and isn't broken out on its own line. Options: **(a, recommended)** add a "Landscaped SF" line to the
      breakdown but keep it pervious (impervious %, coverage, detention all unchanged); **(b)** leave as-is (lumped
      into open/green — numbers already correct); **(c)** count it as impervious (unusual — landscaping is normally
      pervious for stormwater, so this would raise impervious % and affect detention sizing). Default until he says:
      **(b) leave as-is** (the numbers are correct today). Claude implements (a) on request — it's a small additive change.
- [ ] **Loop direction.** ~27 fixes shipped across 8 hunt rounds + a clean yield audit; the easy-bug pool is thinning.
      Pick one: **(a)** keep the loop hunting (deeper/focused laps); **(b)** pivot to a roadmap feature (e.g. GIS layer
      caching — the documented Track-1 next item); **(c)** wind the loop down for now. Default until he says: **(a) keep
      hunting** at a focused, lower-cadence pace.

## Run this SQL (one-click in Supabase) — closes Team-sharing security gaps
> **All for the main app project `lyeqzkuiwngunutlkkmi`; safe + idempotent (just re-run the whole file). These
> matter ONLY once you actually start inviting teammates — no teams are live yet, so nothing is exposed today —
> but run them BEFORE you invite anyone.** Claude hands you the files.
- [ ] **Run `doc-review/db/team_storage.sql`** — closes a gap where a teammate could read **another person's
      private PDF**. The old rule let a teammate's own shared review "claim" any file path (including yours); the
      fix ties a readable file to its true owner, so a teammate can only read files that genuinely belong to a
      review shared with them. **Run before inviting people.** (B491 — found in the 2026-06-27 security pass.)
- [x] ~~Run `db/team_rehome_guard.sql`~~ — **DONE 2026-06-26.** Closed a gap where a teammate on two teams could
      move your shared project to their other team. (B486)
- [ ] **(2-min dashboard check) Confirm "Confirm email" is ON** in Supabase → Authentication → Providers → Email.
      Team invites trust a person's email; if confirmation were off, someone could sign up as a co-worker's
      address (without owning it) and auto-join their team. On by default — this is just a didn't-get-turned-off
      check, again before inviting people. (B491)

## Things Claude needs FROM Michael to finish/verify
- [x] **Reference drawings — DONE (2026-06-30, found in Google Drive, defaults validated).** Measured the
      **Grand Port** approved arch set (1,005,560 SF cross-dock, 40′ clear): the **56′** typical bay is the
      single dominant grid dimension (~130 callouts) and the slab plan literally labels a **60′ SPEED BAY** —
      so the column-grid defaults (**56′ along the docks · 60′ speed bay**) are confirmed against your real
      plans. Depth bays read **~45–50′** (my 50′ default sits at the top of that range). Pinnacle/Urban
      Logistics are small (~85k SF) and Goose Creek's set is 141 MB (too big for the text reader) — neither
      changes the conclusion. **One optional call for you:** the Grand Port depth bays run as tight as 45–48′,
      below the current 50–58′ flex band floor. Want me to drop the band floor to ~45′ so a building's *depth*
      can flex tighter to match? Default = leave it at 50–58′ (your stated range). Say the word and it's a one-liner.
- [ ] **A second test account** — to verify Team Workspaces end-to-end (invite → accept → shared edit → member
      can't delete → make-private revokes). Claude can audit the code + fix bugs without it, but the live
      two-person round-trip needs a 2nd login.
- [ ] **One real, heavy PDF** (a big construction set) — to profile the **PDF/map stutter (B484)** and pin exactly
      where it hangs. Without a profile from a real file, the fix would be a guess.
- [ ] **A >50 MB file** (optional) — to confirm the "50 MB per-file cloud limit" banner text. The automated
      tester's upload bridge caps at 10 MB, so this one needs a manual drop.

## Quick housekeeping in his account
- [ ] **Name or delete the stray "Untitled site" (~32.8 acres)** that's sitting in his Site list — it wasn't
      created by testing; Claude left it untouched. He may want to label it or remove it.
- [ ] **Reload planyr.io once** after a deploy to pick up the latest fixes (his open tab runs the old build until
      reloaded). Routine — only matters right after Claude ships something.

## Deferred / low-urgency (filed; no action needed unless he wants them sooner)
- B479 — storage performance tweaks (invisible; deferred for stability).
- B483 — a 100%-full browser store can sign him out (self-heals; very unlikely now that big images moved to the
      large drawer).
- B484 — the PDF/map stutter above (needs the heavy PDF to profile).
