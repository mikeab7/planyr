# 📋 Michael's open to-dos (things only the owner can do)

> **For any Claude session:** when Michael asks "what's left / what do I still need to do," SURFACE this list
> in plain English. Keep it current — add an item the moment something needs his decision, input, or a manual
> step; tick/remove it once he's done it. This is the **owner's** plate only. Browser click-throughs and
> signed-in spot-checks are the Claude cohort's job (`VERIFICATION.md`), **never** Michael's — do NOT list those here.

_Last updated: 2026-07-11._

## 🌐 Open your environment's network so I can load real Houston road data (thoroughfare epic — needs a NEW session)
- [ ] **Allow the GIS servers, then start a fresh session.** The thoroughfare-plan feature — loading Houston's
      real major-road network so it can drive right-of-way / setback analysis — is built, tested, and shipped
      (B720 + B721), but the current work session's network policy **blocks the City of Houston's servers**, so I
      can't pull the live data from here. The best-practice way to finish it is to run the importer I built from a
      session that can reach Houston (that also lets me read Houston's live data so the road-category translations
      and the exact right-of-way widths are correct, not guessed). **What to do:** in your Claude Code environment's
      network settings, switch to a policy that allows outbound web access (or add these hosts to the allowlist) —
      for Houston now: `mycity2.houstontx.gov` and `www.houstontx.gov`; for the surrounding counties later:
      `*.arcgis.com` plus the Harris / Fort Bend / Pearland / Montgomery / H-GAC GIS hosts. **Network changes only
      take effect in a NEW session**, so after changing it, start a fresh session and tell me *"load the Houston
      thoroughfare data."* Docs: https://code.claude.com/docs/en/claude-code-on-the-web (network policy). Nothing is
      exposed by this — it only lets me READ public government map data. (Tracked as VERIFICATION V274; the
      next session's full step-by-step is in `THOROUGHFARE-HANDOFF.md` at the repo root.)

## 🩹 Optional — a few older sites lost their parcels before today's fix (B756)
- [ ] **Nothing required; read only if you want an older site back.** A bug (fixed + shipped 2026-07-10)
      made brand-new sites you created from the map **lose their parcel boundary** when signed in. Going
      forward this can't happen again. Four sites created since 2026-07-06 were hit — the **Katy "27211 Hoyt
      LN"** one you just made (re-create it in 10 seconds: open the map, select the parcels, click "Plan
      parcels"), plus **GREEN RIVER, HOLLISTER, WAYSIDE**. If any of those three held real work, open it on
      the **same computer/browser you first created it on** and check the planner's **version history (↺)** —
      the pre-loss copy may still be saved locally there and can be restored. If they were just quick
      attempts, ignore this.

## 🔌 Turn on the new Claude connector (B675 — ~5 minutes, copy-paste)
- [ ] **Add 3 settings in Cloudflare Pages, then add the connector in Claude.** Claude handed you the
      walkthrough file in chat (2026-07-06) with the exact values ready to paste: (1) in Cloudflare Pages →
      your planyr project → Settings → Environment variables (Production), add `PLANYR_MCP_TOKEN` (the random
      secret from the file), `PLANYR_MCP_OWNER_ID` (your account id, in the file), and
      `SUPABASE_SERVICE_ROLE_KEY` (copied from the Supabase dashboard — the file shows exactly where);
      (2) redeploy; (3) in claude.ai → Settings → Connectors → add the connector web address from the file.
      Until this is done the new endpoint stays invisible (it answers "Not found" to everyone) — nothing is
      exposed by waiting. After you add the settings, the Claude cohort runs the technical checks (V220).

## 🗓 Calendar note — old save-format safety copy expires ~Aug 6 (B674, no action until then)
- [ ] **Around 2026-08-06, tell a Claude session "drop the old blob backup" (or just ignore this — a
      session will re-raise it).** When the live-editing upgrade shipped (2026-07-06), the old
      one-big-file save format was frozen and kept as a safety copy (`sites.data_backup`) for ~30 days
      in case anything needed rolling back. Once a month passes with the new per-element saving working
      live, the copy is dead weight; a Claude session removes it with one command (plus the follow-ups
      noted in B674). **Nothing to do before then.** If saving ever looks wrong in the meantime, say so —
      the rollback (`db/site_elements_down.sql` + that backup) is exactly what the copy is for.

## Decisions only Michael can make
- [ ] **Which big feature to build next.** In progress: he picked **Team Workspaces** (find/fix bugs) on 2026-06-27.
      The other candidates still waiting: **Revision compare** (overlay/diff two drawing versions), **Named markup
      layers** (show/hide/lock groups of markups). Tell Claude which is next when Team Workspaces is in good shape.
- [ ] **Scheduler backend (B408, decision-gated).** Decide whether to consolidate the embedded Scheduler onto the
      main Supabase project (one backend) or keep it on its own. Claude can't proceed on this until he chooses.

### 🔧 Optional data confirmation (not blocking anything)
- [ ] **Confirm the detention rainfall table (B655).** The new per-pond "Required detention (screening)" card uses an
      area-representative NOAA Atlas-14 rainfall table for the Houston area. It's clearly labelled "screening — pending
      primary verification" and is fine to use as-is. If/when you want exact numbers for a specific site, you (or your
      engineer) can pull the official Atlas-14 values for that site's coordinates and Claude will drop them in. No rush —
      nothing breaks meanwhile.

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

## Run this SQL (one-click in Supabase) — turns on the new project **Folders** feature (B650)
> **One file, for the main app project `lyeqzkuiwngunutlkkmi`; safe + idempotent (re-run the whole file
> anytime).**
- [x] ~~Run `project_folders.sql`.~~ — **DONE (owner ran it 2026-07-05; Claude verified the live schema in
      prod the same day: table + 4 RLS policies + sibling-unique index + drive_* guard trigger + SECURITY
      DEFINER RPC all present).** Every project now gets the standard 12-category folder tree in the
      unified **Library** view, mirrored one-way into Google Drive. The first live seed surfaced a 502 in
      the mirror sync — fixed same-day (B662, chunked sync). Nothing on Michael's plate; the live Drive
      click-through is the Claude cohort's job (`VERIFICATION.md` V208/V209/V214, not his).

## Run this SQL (one-click in Supabase) — syncs your Library **pins** across your devices (B676)
> **One file, for the main app project `lyeqzkuiwngunutlkkmi`; safe + idempotent (re-run the whole file
> anytime). Claude hands you the file.**
- [x] ~~Run `pins.sql`.~~ — **DONE (owner ran it 2026-07-06; Claude verified the live schema in prod the
      same day: `public.pins` table + all 7 columns + RLS enabled + all 4 own-row policies + the
      `pins_user_created_idx` index all present).** Your Library pins (the ☆ folders/files on the Library
      home) now **follow your account to any device you sign in on** — this computer's existing pins copy up
      automatically on your first signed-in visit (safe + non-destructive). Nothing left on your plate; the
      signed-in cross-device click-through is the Claude cohort's job (`VERIFICATION.md` V222), not yours.

## Things Claude needs FROM Michael to finish/verify
- [x] **Drainage-manual transcription (B636 tail) — DONE (Cowork pulled the PDFs itself 2026-07-05; nothing needed from you).**
      Cowork reached the signed manuals directly (the sandbox couldn't, but Cowork can), so you never had to drop them
      in. It replaced the placeholder "screening band" values with primary-sourced numbers for **City of Houston**,
      **Fort Bend**, **Montgomery**, and **Chambers**, and caught two real corrections the trade press had blurred:
      Houston's flat **0.8 ac-ft/ac applies to the paved/roofed (impervious) area, not the whole tract** — so required
      detention on a Houston site is meaningfully lower than the first build showed — and the single-family cutoff is
      **15,000 SF**, not 7,500. Fort Bend & Montgomery now give an exact number (not a range) once a test-fit sets
      impervious %. Shipped + verified. **Waller is now closed too (2026-07-05):** you supplied the full Waller PDF,
      so Cowork read Appendix E directly and confirmed Waller DOES publish rates — a 0.65 ac-ft/ac coefficient method
      for small sites and a 0.55 ac-ft/ac floor — so its range tightened from a wide guess to a correct **0.55–0.65**.
      All six authorities are now primary-sourced. Nothing left on your plate here.
- [ ] **Add the six drainage-authority websites to the periodic Cowork re-verification checklist.** Every
      detention rule record now carries a "verified on" date so staleness is visible; a recurring Cowork pass
      over hcfcd.org, houstonpermittingcenter.org, fortbendcountytx.gov, the Montgomery DCM page, the Chambers
      (Mont Belvieu-hosted) DCM, and Waller's subdivision regs is the refresh mechanism. (Houston already changed
      its rules once — June 2026 — between the owner's verification and this build; the engine caught it because
      records are versioned.)
- [x] **Turn on the parcel-cache builder (B629) — 3 GitHub Actions secrets — DONE (Cowork, 2026-07-04).** The
      `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` Actions secrets are in place (fresh
      refresh token minted via OAuth Playground on a NEW client secret; Cloudflare untouched, original secret still
      Enabled). The Chambers/Waller data source has since been fixed too (B661, first labeled B650 — the state `/query` had gone dark;
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
- [x] ~~**A second test account**~~ — **DONE (confirmed 2026-07-08): `michael.butler@hillwood.com` exists and
      is an admin on team "HIP Houston" alongside your main account.** Your share attempt on Goose Creek
      surfaced a real bug — any autosave from your open tab silently reverted the share (B714, fixed +
      shipped 2026-07-08; the site was re-linked to the team for you). Nothing left on your plate here —
      the two-account click-throughs (V244 share round-trip + V230 named conflict notices) are the Claude
      cohort's job. **One habit that matters: after a Planyr update ships, reload your open Planyr tabs**
      (an old tab runs the old code until reloaded).
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
- **B364 (remaining half) — two optional server backends, only if/when wanted.** The scanned-drawing reading
      now runs FREE in the browser (shipped 2026-07-05 — scanned sets get real sheet labels + auto-filing with no
      server). Two already-built backends stay parked until Michael provisions accounts (Claude can't create these):
      **(a) DWG reading** — drop a `.dwg` straight in (today: export a PDF from CAD, which works fine). Needs a
      Google Cloud Run deploy of `server/convert/` (LibreDWG container). **(b) AI fallback read** for the rare scan
      the free path can't read — needs `server/filing/` on Cloud Run + an Anthropic API key (~pennies per file).
      When wanted, say so and Claude will hand over the exact one-page deploy steps + env vars.
- B479 — storage performance tweaks (invisible; deferred for stability).
- B483 — a 100%-full browser store can sign him out (self-heals; very unlikely now that big images moved to the
      large drawer).
- B484 — the PDF/map stutter above (needs the heavy PDF to profile).
