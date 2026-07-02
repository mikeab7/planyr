# 📋 Michael's open to-dos (things only the owner can do)

> **For any Claude session:** when Michael asks "what's left / what do I still need to do," SURFACE this list
> in plain English. Keep it current — add an item the moment something needs his decision, input, or a manual
> step; tick/remove it once he's done it. This is the **owner's** plate only. Browser click-throughs and
> signed-in spot-checks are the Claude cohort's job (`VERIFICATION.md`), **never** Michael's — do NOT list
> those here.

_Last updated: 2026-06-27._

## Decisions only Michael can make
- [ ] **Which big feature to build next.** In progress: he picked **Team Workspaces** (find/fix bugs) on
      2026-06-27 — the audit is done and the one real bug (B486, re-home guard) is fixed. Candidates still
      waiting: **Revision compare** (overlay/diff two drawing versions), **Named markup layers** (show/hide/
      lock groups of markups). Tell Claude which is next.
- [ ] **Scheduler backend (B408, decision-gated).** Decide whether to consolidate the embedded Scheduler
      onto the main Supabase project (one backend) or keep it on its own. Blocked until decided.
- [ ] **B326/B328 redeploy call (V85).** The CAD→spatial + on-map badge code is on `main` but was checked
      live 2026-06-21 as not yet deployed. Say the word if you want Claude to run a redeploy pass to
      activate them; otherwise low-value, park.

## Things Claude needs FROM Michael to finish/verify
- [ ] **A second test account.** Blocks the full Team Workspaces round-trip (invite → accept → shared edit
      → member-can't-delete → make-private revokes) and the B486 re-home guard's live check (V147). Claude
      can audit + fix code without it; only the live two-person round-trip needs a 2nd login.
- [ ] **A brand-new signup** (a throwaway email is fine). Blocks the account-name / profile persistence
      check (V73 — first name / last name / org → `public.profiles` → survives reload).
- [ ] **Drop 1–2 real construction PDFs signed-in** on planyr.io (KG B1 ARCH set / Jacintoport FS set).
      Blocks the auto-filing UI round-trip (V99/V79/V74/V66). The readers already score 8/8 on project +
      6/7 on discipline headless; only the signed-in drop UX is owed.
- [ ] **One real, heavy PDF** — to profile the **PDF/map stutter (B484)** and pin exactly where it hangs.
      Without a profile from a real file, the fix would be a guess.
- [ ] **A >50 MB file** (optional). Confirms the "50 MB per-file cloud limit" banner text; the automated
      tester's upload bridge caps at 10 MB, so this one needs a manual drop.

## Quick housekeeping in his account
- [ ] **Name or delete the stray "Untitled site" (~32.8 acres)** sitting in his Site list — it wasn't
      created by testing; Claude left it untouched. He may want to label it or remove it.
- [ ] **Reload planyr.io once** after a deploy to pick up the latest fixes (his open tab runs the old
      build until reloaded). Routine — only matters right after Claude ships something.

## Done — recent (kept briefly for context, wipe next update)
- [x] Ran `db/team_rehome_guard.sql` in Supabase (2026-06-26) → B486 owner step complete.

## Deferred / low-urgency (filed; no action needed unless he wants them sooner)
- B479 — storage performance tweaks (invisible; deferred for stability).
- B483 — a 100%-full browser store can sign him out (self-heals; very unlikely now that big images moved
      to the large drawer).
- B484 — the PDF/map stutter above (needs the heavy PDF to profile).
