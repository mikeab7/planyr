# 📋 Michael's open to-dos (things only the owner can do)

> **For any Claude session:** when Michael asks "what's left / what do I still need to do," SURFACE this list
> in plain English. Keep it current — add an item the moment something needs his decision, input, or a manual
> step; tick/remove it once he's done it. This is the **owner's** plate only. Browser click-throughs and
> signed-in spot-checks are the Claude cohort's job (`VERIFICATION.md`), **never** Michael's — do NOT list those here.

_Last updated: 2026-07-04._

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
- [x] ~~Run `doc-review/db/team_storage.sql`~~ — **DONE (SQL applied, live 2-account test PASSED 2026-07-01).**
      Cowork's signed-in run in the real browser confirmed the fix holds live: attacker A denied HTTP 400 / no bytes
      when trying to read victim B's private PDF via a fabricated `sources.storageKey`; legit team-share still
      returns 200 + real PDF. `can_read_shared_review_file(text)` on `lyeqzkuiwngunutlkkmi` carries the owner-path
      bind. Archived as V150 in `VERIFICATION-DONE.md`. (B491)
- [x] ~~Run `db/team_rehome_guard.sql`~~ — **DONE 2026-06-26.** Closed a gap where a teammate on two teams could
      move your shared project to their other team. (B486)
- [x] ~~**(2-min dashboard check) Confirm "Confirm email" is ON** in Supabase → Authentication → Providers → Email.~~ — **DONE (Cowork verified 2026-07-01).** Supabase Dashboard → Authentication → Sign In / Providers → Email shows **Confirm email: Enabled**. Email is the only enabled sign-in provider (Phone, SAML 2.0, Web3 Wallet, Apple, Azure, etc. all Disabled; no third-party OAuth or magic-link providers on). (B491 tail check.)

## Run this SQL (one-click in Supabase) — turns on the new project **Folders** feature (B645)
> **One file, for the main app project `lyeqzkuiwngunutlkkmi`; safe + idempotent (re-run the whole file
> anytime). This creates the table that stores each project's folder tree. Until it's run, the Folders tab
> just shows an empty tree — nothing breaks, the feature simply isn't on. Claude hands you the file.**
- [ ] **Run `project_folders.sql`.** After this, every project gets the standard 12-category folder tree
      (01. Hillwood … 12. Bldg Acq) that you can edit in **Library → Folders**, and it mirrors one-way into
      your Google Drive. Nothing else needed from you — the Drive credentials are already set. (The live
      Drive click-through is the Claude cohort's job — `VERIFICATION.md` V208/V209, not yours.)

## Things Claude needs FROM Michael to finish/verify
- [x] **Drainage-manual transcription (B636 tail) — DONE (Cowork pulled the PDFs itself 2026-07-05; nothing needed from you).**
      Cowork reached the signed manuals directly (the sandbox couldn't, but Cowork can), so you never had to drop them
      in. It replaced the placeholder "screening band" values with primary-sourced numbers for **City of Houston**,
      **Fort Bend**, **Montgomery**, and **Chambers**, and caught two real corrections the trade press had blurred:
      Houston's flat **0.8 ac-ft/ac applies to the paved/roofed (impervious) area, not the whole tract** — so required
      detention on a Houston site is meaningfully lower than the first build showed — and the single-family cutoff is
      **15,000 SF**, not 7,500. Fort Bend & Montgomery now give an exact number (not a range) once a test-fit sets
      impervious %. Shipped + verified (2,577 tests green). **One loose end, and it's the cohort's job not yours:**
      **Waller** likely publishes rates too, but the web PDF reader kept cutting off before the rate section, so it was
      left as an honest range pending a clean read (tracked in `VERIFICATION.md` V204).
- [ ] **Add the six drainage-authority websites to the periodic Cowork re-verification checklist.** Every
      detention rule record now carries a "verified on" date so staleness is visible; a recurring Cowork pass
      over hcfcd.org, houstonpermittingcenter.org, fortbendcountytx.gov, the Montgomery DCM page, the Chambers
      (Mont Belvieu-hosted) DCM, and Waller's subdivision regs is the refresh mechanism. (Houston already changed
      its rules once — June 2026 — between the owner's verification and this build; the engine caught it because
      records are versioned.)
- [x] **Turn on the parcel-cache builder (B629) — 3 GitHub Actions secrets — DONE (Cowork, 2026-07-04).** The
      `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` Actions secrets are in place (fresh
      refresh token minted via OAuth Playground on a NEW client secret; Cloudflare untouched, original secret still
      Enabled). The Chambers/Waller data source has since been fixed too (B650 — the state `/query` had gone dark;
      the builder now pulls the 2025 AGO StratMap layer). Nothing left for Michael here — Claude/Cowork triggers the
      first build + does the live click-through (V199).
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
