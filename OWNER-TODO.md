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

## Run this SQL (one-click in Supabase) — closes a Team-sharing security gap
- [ ] **Run `db/team_rehome_guard.sql`** in the Supabase SQL editor (project `lyeqzkuiwngunutlkkmi`) — Claude hands
      you the file. It closes a gap where a teammate (not the owner) on two teams could move your shared project
      to their other team. Not urgent (no teams are live yet), but **run it before you start actually inviting
      people.** Safe + idempotent. (B486)

## Things Claude needs FROM Michael to finish/verify
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
