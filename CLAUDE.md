# CLAUDE.md — Planyr Project Handoff

Complete handoff for any future session. Read this file top to bottom to orient — it's
the always-loaded core. This merges two tracks of work: the mature **Site Planner**
(basemap, GIS layers, Supabase backend) and the **Document Review** module. Last updated
2026-07-02.

> **🗂 How this handoff is organized (keep it token-lean — owner rule, 2026-07-02).**
> `CLAUDE.md` holds only what EVERY session needs to orient: the standing rules, how to
> talk to Michael, the architecture spine, the KEY DECISIONS, and the workflow. The bulky
> reference material moved to on-demand docs — **read one only when the task touches it:**
> - **`docs/SHIPPED.md`** — the full catalog of shipped-and-verified features (history).
> - **`docs/ROADMAP.md`** — what's not built yet (read when planning new work).
> - **`docs/REFERENCE.md`** — deep implementation detail (Site Model schema, layer/GIS
>   plumbing, Supabase DDL/RLS, persistence internals, the sandbox Playwright quirk).
>
> **⛔ WORKING ON NOTES? READ `docs/NOTES-CARRY-FORWARD.md` FIRST — before the module pointer, before
> the code.** It is the one file that makes starting a FRESH session on this module cheap: the eight
> instrument traps that have each produced a confident FALSE finding about working code, the one
> fixture that finds real bugs (simplifying it hides them — measured), the storage keys and the
> standing SQL health check, the verification bar, and the three recurring bug families to suspect
> first. **It exists because the alternative was tried and failed:** everything a fresh session
> needed lived only in one long-running session's memory, so continuing always looked cheaper than
> starting — until that session was re-reading ~500k tokens of history on every dispatch. A
> carry-forward filed anywhere a session does not automatically read is the same mistake.
> **When a new instrument trap or bug family turns up, it goes in that file in the SAME commit** —
> never left in a session.
>
> **⛔ Never slurp a giant tracking file to find one thing.** `BACKLOG.md`, `VERIFICATION.md`,
> and the two `*-DONE.md` archives are large. To pick work, **Grep the item headings**
> (`^### B` / `^### V`) — a few KB — then **Read only the one block** you'll act on. Reading a
> whole 250 KB file into context to find a 5-line item is the single biggest avoidable
> token burn here. The `*-DONE.md` archives are **write-only — never Read them** except to
> look up one specific past ID.
>
> **🔢 To MINT a new B# or V#, run `npm run next-id` — never grep the archives for the max (B755).**
> It prints `Next free → B### · V###` in one line, scanning `BACKLOG.md` + `BACKLOG-DONE.md` (and the
> two `VERIFICATION*.md`) **on disk, at zero model-token cost**. This is the fix for the recurring
> "which number do we ship/merge with?" tax: the highest id routinely lives on a *Done* item in the
> 1.4 MB archive, so reading files into context to eyeball the max was pure waste. `--json` for a
> machine-readable object, `--b`/`--v` for just the paste-ready label. Multi-mint runs consecutively
> from `nextB` (e.g. B755, B756). (This finds the *number*; **DEDUPE-FIRST** below still governs
> *whether* to mint at all — a recurrence re-opens the original B#, it doesn't take a new one.)
>
> **🧱 SUPERSEDED 2026-08-06 (B6864–B6867) — YOU NOW MINT FROM YOUR OWN RESERVED BLOCK, and the
> high-water-mark rule that everything below describes IS GONE.** Read the rest of this section as
> history; this paragraph is the live rule. `npm run next-id -- --against-main` prints **your block** —
> a range reserved to your branch by name, e.g. `Your block → B6864–B6879 · V6144–V6159` — and you mint
> from its low end. Two sessions minting at the same instant get **different blocks**, so they cannot
> draw the same number; there is no allocator to race and none to be down (the block is a pure function
> of the branch name). **`check-mint` now fails ONLY on a genuine collision** (`TAKEN` — someone really
> holds that id); an id merely *below* what some other branch picked is **green**, and an id outside
> your block is **reported, never fatal**.
> **Why this changed:** the `BELOW` rule was a ratchet with **no fixed point at any speed**. It passed a
> branch only if its ids were strictly above the highest id any *other* in-flight branch held — so with
> two branches, A is green iff `a > b` and B is green iff `b > a`, and both can never hold at once. With
> `n` branches, `n − 1` are red by construction, and the only remedy the rule offered (renumber upward)
> turns the one green branch red. On 2026-08-06 that produced a **livelock**: seven PRs open, none
> mergeable, every one reading `build — Expected — Waiting for status to be reported` with **no merge
> control available to anyone**, and one PR's ids moved six times. Main's max was B1449; the claimed mark
> passed **B100002**. Full diagnosis, including every hypothesis that was refuted:
> **`docs/CI-REQUIRED-CHECK.md`**. That the shape can never come back is now a guard, not a memory —
> `test/mintFatality.test.js` (B226401) fails the build if a fatal mint verdict is ever again a function
> of an aggregate of peer state (a max, a mean, a high-water mark) rather than a present, proven collision.
> **The practical consequences for you:** (a) mint from your block and you will never need to renumber;
> (b) **a run normally starts within SECONDS of the push** — corrected 2026-08-07 (B226400) from the old
> "half an hour is normal, wait it out", which measured a four-hour Actions outage and stated it as a
> standing property; eight samples the next day ran 3–5 s for a push to main and 11–44 s for a
> `pull_request` event. So a minute or two of `Expected` is just delivery, longer is worth *looking* at
> (is the run being created at all?), and **renumbering is never the response either way** — the verdict
> no longer changes with time; (c) gaps are still free; (d) the steel-man for the block scheme, including
> where it concedes a real cost, is the header of `scripts/idBlocks.mjs`.
> **⛔ AND ONE MEASURED FACT THAT CONTRADICTS THIS REPO'S NUDGE LORE (B6867): RE-RUNNING A FAILED
> `build` DOES NOTHING FOR A PR THAT IS STALE AGAINST MAIN.** A re-run replays the merge commit the run
> was created against — it does **not** recompute `refs/pull/<n>/merge` against main's current tip. Tried
> on four stuck PRs the minute the fix landed; all four failed again, reproducing the OLD gate's wording
> verbatim. **A stuck PR needs a NEW PUSH** — prefer `git fetch origin main && git merge origin/main`
> (it also brings the corrected gate into the branch, so the pre-push hook and CI agree) over an empty
> `Nudge CI` commit. Resolve the inevitable `BACKLOG.md` conflict by keeping both sides and renumbering
> nothing.
> **⚖ AMENDED (B36051, owner decision 2026-08-06): a PEER BRANCH holding your number is an ADVISORY too,
> not a failure.** Owner, verbatim: *"a number is taken only if main has it. A guess made from stale
> information about an unmerged branch is not a collision and must not fail a build."* That branch may be
> renumbered, rebased or abandoned, and whoever merges SECOND renumbers — so the gate NAMES the peer and
> lets the build through. **`origin/main` already holding the id is now the ONE fatal case**, and it is
> untouched: two headings, one number, guaranteed the moment you merge.
>
> **⏱ LATE-BIND the real number — assign it as the LAST step before you push, against fresh main (B779).**
> `next-id` reads only YOUR branch, so if you stamp a real `B###`/`V###` at the *start* of a session, a
> concurrent session (branched from the same main, its mint not merged yet) can honestly grab the same
> number — and whoever merges second renumbers. So: **do the work under the provisional `NEW-#` / branch
> label everywhere in code, tests, and commits** (code/tests keep the provisional label through any
> renumber), and **assign the real backlog number only when you're about to push**, computed against the
> just-fetched main:
> ```
> git fetch origin main && npm run next-id -- --against-main    # main + every in-flight branch
> ```
> **⚠ CORRECTED 2026-07-30 (B779 ×2) — the earlier claim here, that late-binding "collapses the window to a
> few seconds," was WRONG as originally shipped, and six consecutive dispatches collided under it.** Late
> binding closes `mint → push`; the collisions happen in **`push → merge`** — PR open, CI nudge, build,
> auto-merge — which is minutes to hours, and other sessions merge during it. Reproduced in a two-clone lab:
> both sessions fetch a fresh main, both run `--against-main`, **both get the same number.** The rule was
> being followed and the tool was blind. Two things changed so the claim is now true:
> - **`--against-main` reads the in-flight PEER BRANCHES too**, not just `origin/main` — the ids other
>   sessions have claimed are on the remote and readable *now*. It also **PROVES `origin/main` is freshly
>   fetched and REFUSES (exit 2) rather than return a stale number** (this clone was measured 7 days / 169
>   ids behind while still printing "[incl. origin/main]"), and reports the commit + fetch age it read.
> - **`npm run check-mint` is a pre-push hook + a required-build step** that BLOCKS a push whose new ids
>   are already claimed, naming the branch and the id to move to. It checks the property, not the
>   ceremony, so a correct late mint passes untouched and a **recurrence mints nothing and never trips
>   it.** Gaps are free — leaving one beats a second renumber pass (B1140). **The hook INSTALLS ITSELF —
>   `npm install` / `npm ci` runs `scripts/install-hooks.mjs` from npm's `prepare` step (B1164), so a
>   fresh container is armed with no manual step.** It is idempotent, it never clobbers a `core.hooksPath`
>   you set yourself (it reports and leaves it), and it never fails `npm install` — every outcome that
>   leaves the gate un-armed prints a loud named block instead. `npm run hooks:install` still works (add
>   `-- --force` to take over a foreign hooksPath); `-- --check` verifies without writing.
>   **The gate's REJECTION path is a permanent CI self-test, not a field hope (B1165):**
>   `test/mintGateE2E.test.js` drives the real CLI against real git refs in throwaway repos (a bare
>   remote in a temp dir — hermetic, no network) and asserts all four outcomes plus the resilience case:
>   taken-on-main → rejected · taken-on-an-unmerged-peer-branch → rejected · below-the-mark → rejected ·
>   clean mint → allowed · recurrence → allowed · unreachable remote → warns and PASSES under `--ci`
>   (a guard that becomes an outage is worse than the collision).
>
> Because only the BACKLOG/VERIFICATION *heading* carries the real number, a late clash renumbers a couple
> of heading lines — never code. **A collision that still slips through is caught
> LOUDLY:** `test/idUniqueness.test.js` fails the build if two ACTIVE items share a `B#`/`V#` (in
> `BACKLOG.md` / `VERIFICATION.md`), **and** (B780) if any NEW collision appears across the live+archive
> pair — the race where one session ships-and-archives its item while the other's same-numbered item stays
> open. So a colliding PR goes red *before* it merges — renumber the newer item then (the reconcile-on-merge
> rule in *Workflow & deploy* is now the rare, loud backstop, not the routine tax). `next-id` also prints a
> `⚠ DUPLICATE ACTIVE ids` line if the live files already collide. The 58 historical cross-file dupes that
> merged before the guard existed are GRANDFATHERED at their exact counts in `KNOWN_LEGACY_ID_COLLISIONS`
> (`scripts/next-id.mjs`) — audited 2026-07-11: every one is two different features sharing a number,
> comments/provenance only, zero runtime dependence; renumbering them would break archive cross-refs, so
> the baseline may only SHRINK (clean a dup → delete its row in the same commit).
>
> **🔄 Keep the per-folder pointers fresh.** Some module folders carry a short `CLAUDE.md`
> pointer (what's here + key files) that auto-loads only when you work in that folder. **When
> you rename, move, or delete a key file, update that folder's pointer in the SAME commit.**
> This is machine-enforced: `node ui-audit/doc-pointer-audit.mjs` (in the `/improve` gate +
> `test/docPointers.test.js`) fails CI if a pointer names a code file that no longer exists.
> Keep pointers short — signposts, never duplicated detail — so they don't drift.
>
> **🗺 Two generated, committed indexes save you from cold-searching — regenerate each in the SAME
> commit that changes its inputs (machine-enforced, like the pointers).**
> - **`MAP.md`** (repo root) — every source file → its module owner, one-line responsibility, and
>   exported symbols. **Grep `MAP.md` to find a path or symbol** instead of sweeping `src/`. Regenerate
>   with `node scripts/build-map.mjs` whenever you add/remove/rename a file or change a primary export;
>   `--check` fails CI on drift (`test/mapDrift.test.js`). Descriptions are preserved across regens; a
>   new file arrives as `TODO — describe` and the check stays red until you fill in its one-liner.
> - **`BACKLOG_OPEN.md`** (repo root) — one line per Open / ⏳ Verify item (B#, title, module, `#tags`,
>   Verify status) + a by-tag rollup so a theme's members are visible at a glance. Regenerate with
>   `node scripts/build-backlog-index.mjs` in the same commit as any `BACKLOG.md` edit; `--check` fails
>   CI on drift (`test/backlogIndex.test.js`).

> **⛔ STANDING RULE #1 — when Michael drops in a problem, FIX IT AND SHIP IT this session. Never log-and-defer.**
> A bug report or change request = **fix it, verify it, and merge it live this same session.** Parking it in
> `BACKLOG.md` for "a future session" turns his one request into homework he has to chase — the opposite of
> what he wants. The backlog is ONLY for what genuinely can't be done now (blocked on a decision, an external
> dependency, or too large to finish this run) — never a parking lot for his requests. Even if he says "add it
> to the backlog," read the intent: he wants it **handled** — file it for the record **and fix it the same
> session.** Default to action. The one acceptable reason to leave something merely filed is a hard blocker —
> then say so plainly, don't go quiet. Several at once → fix them all; if one is genuinely too big, fix the
> rest and flag that one with its specific blocker. (Owner rule, 2026-06-19.)
>
> **Finish the WHOLE job — no diagnosis-only, no band-aid, no half.** "Fix it" means implement **every** part,
> including the harder/real one: go through the code, make the actual change, and verify it (build green + the
> right self-test/headless check). A diagnosis or a backlog note is never a substitute for the work. If Michael
> picks a multi-part option ("do both"), do **every** part before reporting — don't ship part 1 and describe
> part 2. "Bigger/riskier" is NOT a reason to defer — it's a reason to do it carefully (own branch, verify,
> merge). Stop early ONLY for a true blocker: a hard technical blocker, a destructive/irreversible action
> needing confirmation, or a genuine either/or product decision only Michael can make; a fix too large for one
> session is itself a blocker — raise it with a plan, never a silent stop after the easy half. (Owner rule,
> 2026-06-19, after a session shipped only the quick half.)
>
> **📥 Owner CHAT BLOCKS are SHIP ORDERS, not filing requests (owner rule, 2026-07-15 — after the 7/14
> multiwriter-cascade handoff was diagnosed, filed nowhere, and fixed by no one).** Three binding intake rules:
> **(a)** every item in an owner chat block — bug, feature, or task — is **implement-in-THIS-session work**:
> file it, ship it, then park it per the lifecycle (⏳ Verify + V### for a live-verify class). Filing alone is
> an INCOMPLETE response, whatever the block's header says. **(b)** an item that genuinely can't ship in one
> session (a hard unshipped dependency, a true blocker per STANDING RULE #1) must be **flagged LOUDLY** — in
> the session reply AND on the filed item — never silently filed and left. **(c)** a **diagnosis/handoff doc**
> reaching the repo or the project **without a corresponding B# is itself a protocol violation — mint the B#
> on sight** (DEDUPE-FIRST still applies), so no diagnosis can go un-owned again. (Protocol doc:
> `claude/protocol-2026-07-15-bug-blocks-are-fix-orders.md` in the owner's project.)
>
> **⛔ STANDING RULE #2 — NEVER-PARK: AN OWNER-REPORTED SYMPTOM IS NEVER CLOSED ON A NULL (owner rule,
> 2026-08-08, instructed verbatim after a session broke it: *"Make a rule so that that never happened
> again … there is, like, good information to act on and you just skipped over it. That should never
> happen. Make a hard rule … I just can't believe you were gonna archive that."*).**
> **THE FAILURE IT COMES FROM, recorded so the rule is not read as an abstraction.** B1121 — his *"reload
> is quick then a minute later it's lagging"* — had been reported unchanged for weeks. A battery returned an
> honest null. The session wrote it up, archived it with *"the honest position is that it is not currently
> reproducible"*, and dispatched the next item on a list. The in-app recorder that finally addressed it
> (B255200) exists ONLY because he asked whether anything was going to be done with it. **The mechanism of
> the mistake:** a null READS like a closed item — it has a number, a document and a conclusion — but
> *"we could not reproduce it"* and *"it is not happening"* are different statements, and the first was
> filed as though it were the second.
> **THE RULE, five clauses:**
> **(1) A first-hand owner report is EVIDENCE; a failed reproduction is not a refutation of it. When the
> instrument and the owner disagree, THE INSTRUMENT IS THE THING ON TRIAL.** This repo has proved that three
> separate times: three harnesses silently contaminated by an undisposed `ElementHandle` (B1439), a fixture
> seeder that made B749's whole cost path unreachable, and a growth harness whose "plan B" was plan A
> truncated in half. **A clean number from an instrument that could not have seen the effect is not evidence
> of absence.**
> **(2) An owner-reported symptom may NEVER be closed, archived or de-prioritised on the strength of a null.**
> There are exactly THREE admissible dispositions: **reproduce it and fix it** · **instrument it so it
> captures itself when he hits it** · **ask him whether it is gone and take his answer as the verdict**.
> *"Not currently reproducible"* is a **FINDING**. It is never a **DISPOSITION**.
> **(3) SILENT DE-PRIORITISATION IS THE OFFENCE.** Judging that something else is more urgent is legitimate;
> doing it without telling him is not. If a tractable item is picked over an owner-reported one, that choice
> is stated to him in plain words at the moment it is made.
> **(4) "The remaining work is large, dangerous or vague" is not a reason to pick a smaller item.** (See
> DANGEROUS-MEANS-UNOBSERVABLE in the named rules — "dangerous" is a missing instrument, and building it is
> the work.)
> **(5) Every such item carries a STOPPING RULE when it is opened** — a stated condition under which it
> closes. An item with no stopping rule rots, and rotting is how this failed.
> **ENFORCEMENT: any session archiving a shipped record for an owner-reported symptom must state which of the
> three dispositions it took, BY NAME**, on the item and in the session reply.
>
> **⛔ STANDING RULE #3 — ONE TASK PER SESSION; COST PER TASK, NOT MODEL TIER (owner rule, 2026-08-15, after a
> review found unrelated work being grafted onto long-running sessions because a container happened to be
> warm).** **WHY, stated plainly:** every turn re-sends the whole accumulated conversation, so a long session
> pays for its entire history on every subsequent tool call. Unrelated work grafted onto it is therefore
> charged at the long session's context price while sharing none of its context — pure waste, and it's the
> dispatcher's doing, not the session's.
> **(A) ONE TASK PER SESSION.** A session takes one item, ships it, and archives (clause B). If new work
> arrives that doesn't depend on what this session has already learned, do **not** accept it — say so plainly
> and tell the dispatcher to open a new session. **THE TEST, verbatim: would a fresh session have to
> REDISCOVER something this session already knows?** If yes — it built a fixture, a harness, a reproduction,
> a measurement rig the new work needs — continuing is correct and cheaper. If no, it is a new session. A
> warm container is NOT a reason. Convenience is never a reason.
> **(B) ARCHIVE WHEN DONE.** Don't idle open once the PR merges and the follow-ups are filed — an open
> session invites exactly the grafting (A) forbids. (This is STANDING RULE #2's never-park discipline turned
> on the session itself; it doesn't restate that rule, it cross-references it.)
> **(C) MODEL SELECTION — Sonnet is the default.** Use Sonnet for implementation work: a well-specified item
> with a known defect and a stated expected result. Reserve Opus for a root-cause hunt that has **already
> defeated one attempt**, or where the session must reconcile contradictory evidence rather than execute a
> plan. Worked example: the B1121 memory hunt earned Opus because it had to reconcile the owner's own
> recording against its own harness and catch its instrument lying twice; a parcel-naming fix, an aerial
> reword, and a layering fix did not, because each had a measured defect and a stated expected result.
> **(D) THE BRIEF IS THE CHEAPEST PART.** Everything already measured belongs in the brief, including the
> approaches already ruled out and WHY. A few hundred tokens of specification routinely saves a session from
> rediscovering a dead end at full price. A brief that says what to do without saying what has already been
> tried is an incomplete brief.
>
> **📋 `BACKLOG.md` = the single source of truth for open bugs & feature requests — KEEP IT LEAN.** Every run,
> work the **🔲 Open** items. **The moment an item ships, MOVE its whole block to `BACKLOG-DONE.md` that same
> session — never mark it done in place** (marking-done-in-place is exactly what bloated this file). The next
> B# = highest `B#` across **both** files + 1 — **get it with `npm run next-id`** (don't grep for it).
> (Product backlog; distinct from the "Deferred / maintenance backlog" near the end of this file.)
>
> **⏳ THREE-STATE LIFECYCLE (B645): items move 🔲 Open → ⏳ Verify → ✅ Done, not straight to Done.** A
> `Verify: sandbox` item (green build + the right unit/headless self-test proves it) goes straight to Done. A
> **`Verify: live`** item — the **LIVE-VERIFY** classes: timing/race, concurrency / multi-writer, GIS endpoint
> behavior, zoom-/data-density-dependent rendering, PDF/export parity, or a real-project-data repro — is
> implemented this session but then **parks in the new `## ⏳ Verify` section** (with a matching `V###` in
> `VERIFICATION.md`) until a live check confirms it; moving it straight to Done is a protocol violation. A
> **recurring** report re-opens the ORIGINAL `B#` (`Recurrence:` line + `(×N)` in the title) — never a new
> number (**DEDUPE-FIRST**). Every item carries a `Verify:` field and one or more `#tags` from the legend at
> the top of `BACKLOG.md`.
>
> **⛔ MERGED ≠ LIVE — a reconciliation/audit may call a `Verify: live` item "live" ONLY when it has a PASSED
> `V###` on record (B877, 2026-07-17, after the B873 pre-pass audit blessed B867/B868/B869/B875 as
> "shipped-and-live" off their MERGE presence, and the Cowork pass then found them dead on the page).** No
> static audit can see runtime behavior: checking that code merged to `main` and that Cloudflare deployed a
> build proves the bytes are *served*, NOT that the feature *works* — a real ambient bug (B874's stuck
> flood-refresh) can starve or freeze features that merged clean. So a reconciliation report has THREE
> distinct states per item, never two, and never conflates the middle one with the last:
> **`🔲 Open/unshipped` · `⏳ merged — V### PENDING` · `✅ live (V### PASSED, dated)`.** "Merged" is only ever
> reported as **`merged — live-verify pending`**; the word **"live"** (or "confirmed", "working") requires the
> dated PASS note in `VERIFICATION.md`. When an audit can't run the live check itself (sandbox / signed-in /
> real-project-data), it says so and reports the item as `merged — V### pending`, never green.
>
> **🔍 `VERIFICATION.md` = the live-browser test checklist — KEEP IT LEAN too.** Every run, scan it and
> **verify any ⏳/due items yourself in a headless browser** (Chromium/Playwright is in the environment — see
> "🤖 Self-verification" there), then record the result. **The moment an item fully passes with nothing
> pending, MOVE it to `VERIFICATION-DONE.md`** (same archiving discipline as the backlog). The session that
> ships a UI change drives the live app itself rather than defer it. **⛔ ATTEMPT-BEFORE-YOU-PARK (owner rule,
> 2026-07-18): a logged-out, no-external-GIS UI check — draw / reshape / select / toggle / keyboard / export a
> blank site, the landing page, a dropped LOCAL file, a boot-recovery flow — is Claude-doable HERE and must
> NEVER be filed as "needs a live pass." Drive it headless and record ✅/❌ THIS session. You may only defer an
> item that hits a named `Blocker:` — `auth` (proxy CORS-blocks Supabase sign-in), `live-GIS` (external map host
> the egress blocks), or `real-data` (a signed-in saved project like Tsakiris/Bain); a `V###` with no `Blocker:`
> wall is a mis-classification, not a to-do (`VERIFICATION.md` rule 4).** **Michael does NOT self-test — never wait
> on him or hand him a test to-do**; if no browser is reachable, log the item and move on (after CI-green +
> build-green). Self-tests run **logged-out** (the sandbox blocks sign-in), so auth-only features (cloud sync)
> still need a signed-in check. **⛔ STANDING RULE — when you ship a UI change with any path you CANNOT verify
> here (auth-only / cloud / signed-in-only / needs the live edge), you MUST add a numbered `V###` entry to
> `VERIFICATION.md` for that check, every time, unprompted.** A `⏳` note buried in the BACKLOG item is NOT a
> substitute: `VERIFICATION.md` is the single canonical list of "builds green but never clicked," and it's the
> only place a browser-equipped teammate looks for the click-through. The entry records what you DID verify
> (lint/test/build/headless) **and** the precise signed-in steps still pending — so the gap is visible, not lost.
> (Owner rule, 2026-06-26, after a session captured an auth-only check only in the backlog and nearly skipped
> the verification log.) **Interrupt Michael only for a CRITICAL failure** — won't build, won't render,
> or a shipped feature visibly crashing. (Recurring 🌐 endpoint-liveness checks still run from any session.)
>
> **📥 `verification-inbox/` is the write path FROM the Cowork thread INTO `VERIFICATION.md` (B825232,
> 2026-08-28) — it names an actor split the rules above never named.** A Claude Code session can push to
> this repo but cannot sign in (the sandbox proxy CORS-blocks the Supabase auth handshake, the same wall
> behind every `Blocker: auth` item above). The **Cowork thread** can drive Michael's real signed-in
> browser but cannot push here (its git proxy refuses to inject a credential for `mikeab7/planyr`). So:
> **the Cowork thread is the only actor that can close a `Blocker: auth` / `real-data` / `live-GIS` item,
> and a check it closes is not closed until it lands in `VERIFICATION.md` via this inbox.** Before this,
> that split had no exit — it's the reason 79 `Blocker:`-walled items had piled up unclosable as of
> 2026-08-28. Mechanically: the Cowork thread appends a dated `verification-inbox/<date>-<label>.md` file
> recording each live pass/fail it ran on Michael's browser (**append-only — nothing is ever deleted from
> an inbox file**, only added); a session then drains it into `VERIFICATION.md` (⏳ → passed or ❌, per
> what was actually found), moves any now-fully-passed item on to `VERIFICATION-DONE.md`, and marks the
> drained inbox entry with the PR number that did the draining, so the same entry is never drained twice.
> An item the inbox itself records as **NOT** closed (a stated residual, a leg not separately performed)
> stays exactly as open in `VERIFICATION.md` as it was before — draining is a transcription, never a
> rubber stamp, and a session that drains a partial pass says explicitly which parts it is accepting and
> why (STANDING RULE #2 — no closing an owner-reported symptom on a null still applies here).
>
> **📦 `BACKLOG-DONE.md` / `VERIFICATION-DONE.md` are write-only archives — do NOT read them** unless looking
> up a specific past item; they are historical record only, and exist so the two live files above stay small.

## How to talk to me (Michael) — IMPORTANT, applies to every reply
Michael is an industrial real-estate developer, not a software engineer. In chat,
explain everything in plain English — the way you'd explain it to a smart person who
doesn't write code. This is a standing rule, not a one-off.
- **Lead with what it means for me or the product** — what I'll see, do, or get — not
  how it's built.
- **No bare jargon, but teach me a little.** Never leave me to decode a term cold. DO
  deliberately drop in the occasional real technical term so I build up the vocabulary
  over time — just always pair it with its plain meaning the first time it appears,
  e.g. "a service worker (a small background helper in your browser that quietly keeps
  copies of things so they load instantly next time)" or "caching (remembering the last
  copy so it loads fast)". A term here and there with its meaning = good; a wall of
  unexplained acronyms (SWR, blob store, raster, IndexedDB, RLS…) = not.
- **When you offer options, describe each by what actually happens for me and the real
  trade-off**, not by the technique. Make the difference between options concrete
  ("this one makes the wetlands map itself pop up instantly, even when the county
  server is down; that one only remembers a little 'worked 5 min ago' label").
- **Plainer, not vaguer.** Simpler words, but stay honest and precise. If you're unsure
  or a thing is risky, say so in plain terms.
- **NEVER quote measurements or units in chat — describe what I'll SEE, not the numbers
  behind it (owner rule, 2026-07-18: "I don't ever want to know how many pixels equals
  anything").** No pixels / "px", no widths, offsets, thresholds, zoom factors, or "X ft of
  padding" — ever. Say "the little tag hops onto its own line so nothing overlaps," never
  "below 360px it reflows." The raw numbers belong in code, commits, and the backlog; in
  chat they're noise. This applies to every reply.
- If I seem confused, it usually means the explanation had too much jargon — re-explain
  in simpler terms, don't just repeat.
- **Whenever we discuss merging, shipping, or "making it live," end by stating plainly
  whether there's anything left for _me_ to do** — e.g. "nothing on your end, it's done"
  or "the one thing I need from you is X." Don't leave me to ask. (Browser click-throughs
  in `VERIFICATION.md` are the Claude cohort's job, never mine — those never count as my to-do.)
- **📋 Keep `OWNER-TODO.md` current and SURFACE it whenever I ask "what's left / what do I
  still need to do" (owner rule, 2026-06-27).** It's the single list of things only _I_ can do
  — decisions, inputs you need from me (a 2nd test account, a heavy PDF, a big file), and quick
  account housekeeping. Add to it the moment something lands on my plate; remove an item once I've
  done it. Read it back to me in plain English when I ask. (Distinct from `VERIFICATION.md`, which
  is the cohort's click-throughs, never mine.)
- **If a step is on MY side, HAND ME THE FILE — never just name a repo path (owner rule,
  2026-06-22).** When I need to run a SQL file, upload something, or paste something into a
  console, deliver the actual file(s) to me directly (the harness `SendUserFile` tool), in the
  order I should use them, with the one-line "do this first" note. I don't know where things are
  saved in the repo and shouldn't have to hunt. Make my part copy-paste / one-click easy.

This plain-language rule is about how you talk **to me** in chat. Keep commit messages,
PR descriptions, code comments, and the backlog technical and precise as usual.

## What Planyr is
A proprietary, TestFit-style web app for industrial real estate site work, built by
Michael (industrial developer, Dallas/Houston). It is becoming a multi-workspace
suite: the existing **Site Planner** (site yield analysis and layout) plus a new
Bluebeam-style **Document Review** workspace for reviewing construction drawings and
surveys.

The two workspaces are **one product, not two apps.** They share a single
real-world coordinate system, so work flows between them (a parsed deed lands on the
planner's map; an engineer's drawing overlays the planner's layout).

## Architecture
- **One product, multiple workspaces.** Each workspace is its own folder/module. The
  app shell switches between them; you do not run two separate apps.
- **Lazy-loaded workspaces.** A workspace's code loads only when opened, so Document
  Review never slows the Site Planner. (Verified: `SitePlannerApp` and `DocReview`
  are separate lazy chunks.)
- **Shared coordinate spine.** One real-world coordinate system underpins everything:
  **EPSG:2278 — NAD83 / Texas State Plane, South Central zone, US survey feet**
  (correct for the Houston/Katy area). This is what lets a deed polygon, an overlay,
  and the site layout all live in the same space. `src/shared/coordinates/` now has a
  **real EPSG:2278 ↔ WGS84 projection** (`projectToGrid`/`gridToProject`, Lambert
  Conformal Conic, validated vs pyproj <1e-4°); its first consumer is the **layer
  coverage engine** (B283), which reprojects each GIS service's published extent to
  test whether its data reaches the view. This is a **read-only screening use** — the
  Site Planner still keeps its own per-site feet frame for drawn geometry; grow the
  shared grid additively, not via a big-bang planner rewrite.
- **Document Review layer model.** The imported drawing is an **immutable backdrop**
  (a fixed background, never altered). The user's measurements, markups, test-fit
  massing, and parsed polygons live on **editable layers stacked over it.** "Editing
  CAD" here means building your own analysis layer over the engineer's drawing —
  never altering or writing back their geometry.
- **Heavy work off the main thread.** CAD/PDF parsing and large geometry ops belong
  in **Web Workers** (background threads) so the UI never freezes.
- **Monorepo.** One repository (`planyr`), a folder per workspace, plus a
  walled-off `/server`. Repo count buys nothing on performance; isolation comes from
  module boundaries + lazy-loading inside the one repo.

## Repository layout (after the foundation restructure)
```
src/
  main.jsx                # renders the shell
  index.css               # global styles
  app/
    Shell.jsx             # shell: lazy-loading workspace registry + header switcher
  workspaces/
    site-planner/         # all existing Site Planner code (moved here, history preserved)
      SitePlannerApp.jsx  # was App.jsx
      MapFinder.jsx, SitePlanner.jsx, components/, lib/
    doc-review/
      DocReview.jsx       # "Document Review (coming soon)" placeholder
  shared/
    coordinates/          # project-grid stub (EPSG:2278); minimal interface; not yet wired
server/                   # placeholder README only — NOT built or deployed; backend + secrets later
```
- Build command: `npm run build` → output `dist/`. Dev: `npm run dev`.
- `vite.config` has `base: "./"` (for the GitHub Pages subpath); works unchanged at a
  domain root too.

### Dependency notes (client bundle)
Runtime deps are kept few and deliberate. New client dependency added 2026-07-10:
- **`dxf-parser` (B747, ~380 KB, one transitive dep `loglevel`)** — parse-only DXF tokeniser used by
  the site-plan overlay's CAD import. Justified over hand-rolling: DXF group-code parsing has to
  survive many real-world exporter/version quirks, and a robust hand-rolled full parser fails the
  cost/benefit test. We hand-roll ONLY the entity→SVG rendering (the civil subset), never the parse.
  It's **parse-only** (no DOM), so it runs inside the DXF Web Worker, and it's imported lazily behind
  a `?worker` specifier + a dynamic `import()` in `openOverlayFile` — so the CAD parser never rides
  the initial planner bundle (loads only on the first `.dxf`/`.dwg` drop).

## Workflow & deploy
- **Branch per workstream; `main` is the protected, always-working, deployed line.
  No direct commits to `main` from here on.**
- Branch naming: `doc-review/<feature>`, `site-planner/<feature>`. Branch from the
  latest `main`; merge the latest `main` back into long-lived branches as you go.
- **Merge often** — the longer a branch drifts, the larger the eventual merge
  conflict. Per-workspace work in separate folders rarely conflicts; keep edits to
  genuinely shared files (the coordinate module, the shell) small.
- **Land work via pull requests; require a passing build check to merge.** The GitHub
  Actions workflow runs the build on every PR (a green "it builds" check) and on
  pushes to `main`; the deploy job is gated to `main` only.
- **"Commit" means take it LIVE — the whole chain, no stopping, no asking.** When the
  owner says "commit" (or "ship it", "make it live"), do _all_ of: stage → `git commit`
  → push the branch → open the PR into `main` → merge it (enable auto-merge if a check
  must go green first). Merging to `main` is what ships it. Do **not** stop at a local
  commit, and do **not** ask "want me to open the PR?" — opening and merging the PR is
  part of what "commit" already authorized. The only acceptable stop short of live is a
  hard blocker (merge conflict, red required check, protection that rejects the merge) —
  report _that_, not a request for permission.
- **⛔ THE CLAUDE CODE WEB SESSION HARNESS DEFAULTS EVERY NEW PR TO DRAFT — THAT DEFAULT DOES
  NOT APPLY HERE, AND IT IS ENFORCED MECHANICALLY, NOT BY REMEMBERING TO OVERRIDE IT (B781760,
  2026-08-26, after #1157/#1162/#1166/#1180 each sat as a green, conflict-free PR parked in
  draft waiting for a button the owner was never going to press).** The harness instruction
  to open PRs as draft lives outside this repo — not in `CLAUDE.md`, not in any file here, not
  editable from a session — so a session that both reads "commit means ship it live" above
  AND that harness default resolves the conflict inconsistently. `.github/workflows/pr-
  auto-ready.yml` closes it in the repo instead of in a sentence: on every
  opened/reopened/synchronize event for a `claude/*` head branch, it marks the PR ready for
  review and arms squash auto-merge automatically, whatever draft state the harness opened it
  in. **A session opening a PR here should not treat draft-vs-ready as a meaningful signal —
  don't stop because a PR reads "Draft," and don't hand-run `gh pr ready` as a workaround; the
  automation already does it.** The one supported way to genuinely ask a human to look before
  it merges is the **`hold` label** (or a `<!-- keep-draft -->` marker in the PR body) — apply
  either and the workflow leaves that PR alone on every future run too, not just the next one.
  It only ever *enables* auto-merge; the required `build` check (below, and the nudge-commit
  note that follows it) still has to go green before anything actually merges.
- **⛔ AFTER ANY CHANGE TO A PR TITLE — which every renumber causes — DISABLE AND RE-ENABLE
  AUTO-MERGE. GitHub snapshots the squash commit message when auto-merge is ARMED, not when it
  fires, and a later title edit does NOT update that frozen copy (B225984, 2026-08-07).** PR #931
  armed auto-merge while its ids read `B3001–B3004`, was renumbered three more times, merged with
  a correct title and correct files — and `main` still carries `fdcb02d`, whose subject announces
  **retired ids that name no heading anywhere**. That is the #865/#866 defect arriving through the
  one door B779's announcement check cannot see: that check guards the commit **you** push, and
  this message never passed through your branch. Re-arming is the whole remedy; it costs two API
  calls. **No machine guard exists for this and one was deliberately not built** — scanning `main`'s
  log needs full history, and CI checks out depth 1, so the guard would pass trivially and rot green
  (the failure mode VIEW-INDEPENDENT-ONCE §6 names). The reasoning is on B225984 so it is not
  re-litigated.
- **The required `build` check often does NOT auto-start on a PR you open via the GitHub
  MCP / automation — un-stick it yourself with a nudge commit; NEVER hand this to Michael.**
  GitHub suppresses `pull_request`/`push` workflow triggers for PRs opened or pushed by the
  automation's app token, so the required `build` check sits **"Expected — Waiting for status
  to be reported"** and **auto-merge waits forever** (it will NOT merge on its own). A
  `workflow_dispatch` build _runs_ but its check does **not** satisfy the required context, and
  a direct merge is rejected with `Required status check "build" is expected`. **Fix:** after
  opening the PR + enabling auto-merge, push a tiny **empty nudge commit** to the PR branch
  (`git commit --allow-empty -m "Nudge CI" && git push`) — that fires the real `pull_request`
  build, it passes in ~40s, and the armed auto-merge then completes on its own with zero owner
  involvement. This is a known, self-serviceable hiccup — **do the nudge automatically as part
  of shipping; do NOT report it as a blocker.** (Learned 2026-06-22 on PR #274.)
  **⛔ AND READ THE RIGHT ENDPOINT BEFORE CONCLUDING THE CHECK NEVER STARTED (measured 2026-08-14, and this
  session got it wrong twice before checking).** `pull_request_read method=get_status` returns the COMMIT
  STATUS API; this repo's `build` reports a **CHECK RUN**. So `{"state":"pending","total_count":0}` there is
  the NORMAL reading for a run that is queued or in progress, and it is **NOT evidence that the trigger was
  suppressed**. Acting on it cost two unnecessary `Nudge CI` commits and a hunt through `build.yml` for a
  `paths:` filter that does not exist — while three runs were already `in_progress` for those very shas. The
  authoritative read is the CHECK RUN, and there is a purpose-built endpoint for it that this session
  only found on its third attempt: **`pull_request_read method=get_check_runs`** returns the head
  commit's check runs directly — a handful of lines, no pagination, no matching on `head_sha`. Prefer
  it. `actions_list method=list_workflow_runs event=pull_request` matched on `head_sha` answers the
  same question but returns tens of thousands of characters and has to be parsed out of a file.
  Nudge on the absence of a RUN, never on `total_count: 0`.
  **⚠ AND WHEN A NUDGE IS GENUINELY OWED, PREFER MERGING `origin/main` OVER AN EMPTY COMMIT** — it
  fires the same real push event AND refreshes a branch that has drifted, so it fixes the stale-merge
  case at the same time. Resolve the inevitable `BACKLOG.md` conflict by keeping both sides.
  **`MAP.md` / `BACKLOG_OPEN.md` conflicts now self-resolve automatically on `git merge` (B904992)** —
  a committed `.gitattributes` hands both paths to a custom merge driver
  (`scripts/merge-driver-ledgers.mjs`), backed by a `post-merge` hook
  (`scripts/post-merge-regen.mjs`) that corrects the driver's necessarily-partial mid-merge view once
  the working tree is complete (see that pair's own headers for why a merge driver alone cannot always
  be correct, and why the fix is two layers). Both are wired by `npm install` /
  `npm run hooks:install` alongside the mint-gate hook; if a conflict on either file DOES still show
  markers, the local config is missing — run `npm run hooks:install` (or `node
  scripts/install-hooks.mjs --check` to confirm) rather than resolving by hand. **The manual path is
  not gone** — it is still the only route for `BACKLOG.md` / `BACKLOG-DONE.md` / `VERIFICATION.md` /
  `VERIFICATION-DONE.md` (a merge driver is per-file and cannot run `resolve-ledgers.mjs`'s cross-file
  duplicate-id rollback), and it is still the correct fallback if the driver itself ever refuses
  (LOUD-FAILURE — it leaves ordinary conflict markers rather than guess): `node
  scripts/resolve-ledgers.mjs` regenerates all four hand-merged files AND both generated ones in one
  pass.
  **⚠ CHECK `mergeable_state` FIRST — a "dirty" (merge-conflicted) PR silently swallows EVERY nudge
  (learned 2026-07-06 on PR #518).** GitHub only creates `pull_request` build runs against the PR's
  test-MERGE ref; while the PR conflicts with `main` that ref can't exist, so nudges, close/reopen —
  nothing fires, with no error anywhere. Four nudges did nothing; merging `origin/main` into the branch
  fixed it instantly. So: nudge once → if `actions_list` shows NO run for the branch, fetch the PR
  (`pull_request_read get`) and look at `mergeable_state` BEFORE nudging again — `dirty` means resolve
  the conflict first (main moves fast here), then the next push fires CI on its own.
  **⚠ One nudge is often NOT enough, and a PR never merges itself — BABYSIT it to `merged:true`
  (learned 2026-06-27 on PR #379).** Automation-token pushes (PR-open + a single nudge) frequently
  still don't fire the `pull_request` build — recent PRs have needed **two** `Nudge CI` commits — so
  after nudging, **verify a run actually appeared** (`actions_list list_workflow_runs` for the branch
  / `pull_request_read get_status`) and **nudge again** if not. Separately, `main` moves fast (many
  concurrent sessions) so a PR often goes `mergeable_state:dirty` on `BACKLOG*.md`/`VERIFICATION*.md`
  — resolve by merging `origin/main` in (keep both sides' done-entries; renumber only a genuinely
  colliding new B#/V#), re-run the gate, push. **Poll every ~150s while a PR is open** (webhooks do
  NOT deliver CI-success / merge / conflict transitions — always re-fetch), never on a 20-min idle tick.
- **Deploy = Cloudflare Pages (production), serving planyr.io.** Because the suite is one
  app with an in-app workspace switcher, "seeing both live" is one URL — you switch tabs
  inside it. (The old GitHub Pages deploy was retired — see "Retire the old GitHub Pages
  deploy pipeline — ✅ DONE" near the end of this file; GitHub Actions now only runs the
  build status check, it doesn't publish.)
- **Per-branch preview URLs** (seeing an unmerged branch live without merging to `main`)
  are a separate, optional Cloudflare concern — not required to build or to see both
  workspaces. (Don't conflate this with PR status checks, which are a separate GitHub
  Actions concern.)
- End commit messages with the session link the harness provides. Don't include the
  model identifier in commits/PRs/code.

## Engineering rules (invoke by name) + Definition of Done (B649)

A chat brief may reference any rule below **by name** ("apply PDF-PARITY, LOUD-FAILURE") — treat a
named rule as if its full text were pasted into the brief. This is the **session contract**: named
rules are binding shorthand, not optional style. (Full-text home so briefs stay short.)

### Named rules
- **LOUD-FAILURE** — No silent failure path. Every write / fetch / parse that can fail must surface the
  failure visibly (a banner, a telemetry event, a thrown error) — never a silent no-op or a swallowed
  `catch` that reads as success. When in doubt, crash loudly over degrading quietly. (The B209 / B595 /
  B610 class: a "saved ✓" that didn't save is exactly the bug this rule exists to prevent.)
- **AUDIT-FIRST** — Before patching, instrument and reconcile the prior `B#` claims against the ACTUAL
  code. Build understanding from what the code does now, not from what a comment / backlog note says it
  does. Where they disagree, record the code reality and **flag the discrepancy**. (Stops you "fixing" a
  bug a prior B# already fixed, or trusting a stale claim.)
- **PDF-PARITY** — Any change to an on-screen render must be mirrored and verified in the export / print
  path, and vice-versa; the two must not drift. Scheduler `GanttView` ↔ `buildGanttSVG`
  (`public/sequence/index.html`); the Site Planner canvas ↔ its PDF / print export pipeline. A render fix
  that skips the export path is half-done. (This is a mandatory **LIVE-VERIFY** class.)
- **MODULE-SCOPE-COMPONENTS** — Define React components at module scope, **never inside another
  component's render body**. An inner-defined component is a brand-new type every render → React
  remounts it → focus loss, lost input state, thrashing. (The remount / focus-loss regression class.)
- **VIEWPORT-STABLE** — When a panel / rail / divider toggle changes a render surface's width or
  left/top edge, the surface must neither **JUMP** nor **FLASH**. **(a) Compensate against the
  MEASURED delta in a layout effect:** read the real DOM edge (e.g. `wrapRef.offsetLeft`) in a
  `useLayoutEffect` (before paint) and fold the exact delta into the view transform in the SAME frame
  as the reflow — never an ASSUMED width, never a passive (after-paint) `useEffect` (that skips the
  content sideways for one-plus frames). Measuring the real edge **self-gates**: overlay / portaled /
  right-side panels steal no layout width → zero delta → no shift. **(b) Buffer the surface across any
  resize-driven re-layout / re-raster / reload:** hold the current pixels (a ghost/buffer) across the
  reflow and drop them only when the new render is ready, so it never wipes to blank; fold any separate
  un-buffered relayout (or an un-rastered remount) into the buffered path. Precedents: the Leaflet
  basemap pan-compensation + tile ghost (**B837** `SitePlanner.jsx` `panelShiftRef` / geo `sizeChanged`;
  **B65** `geoGhostRef`) and the Doc Review sheet-rail compensation + stitch-return re-raster
  (**B838** `DocReview.jsx`).
- **CHROME-NEVER-EATS-A-PRESS** — **Anything that paints ABOVE the content and stops propagation must either be
  GATED on its own object being selected, or FORWARD the press to `isDoubleTap` keyed on the UNDERLYING
  feature.** In SVG, paint order IS hit-test order, so a late-painted node with `pointerEvents` on wins every
  press inside it — and a handler that stops propagation without calling `setSel` or `isDoubleTap` makes that
  press *invisible*: nothing selects, no double-tap can pair, and an undo frame is often burnt for nothing.
  Three corollaries, each learned the hard way:
  1. **A private double-tap key on chrome that sits over its own object is a POISON.** `isDoubleTap` keeps ONE
     tap record, so `eldim:${id}` / `${id}:label` over a footprint both dissolved the pair AND clobbered the
     record, so a third press had nothing left to pair with. **One key per feature**; branch the ACTION on
     which surface took the press, never the key.
  2. **Chrome that only EXISTS once selected is the worst case, because it is invisible to a static reading.**
     The dimension grab band renders `if (dimSel)`, so press 2 of a real double-click lands on a layer press 1
     just created — dead by construction, and no source scan can see it.
  3. **A guard that names one component protects one component.** Assert it STRUCTURALLY, on the real render:
     with nothing selected, every element's own centre must answer to that element via `elementFromPoint`.
  4. **⛔ CHROME MOUNTED BY THE FIRST PRESS IS INVISIBLE TO ANY CHECK THAT READS THE DOM BEFORE THE INTERACTION
     (B233153) — so the probe shape is the TWO-PRESS INVARIANT: press once, RE-ASK what a double-click at that
     point now addresses, and require the same feature.** Corollary 2 said chrome that only exists once selected
     is the worst case; B233153 is that case at its worst, because the chrome was the feature's OWN vertex
     handle — pressing the pond mounted the 18px hit square that then ate press 2, at the point the pointer had
     not moved from. **And the variable that hid it was not the SHAPE but VERTEX COUNT against handle size at
     the probe point:** six realistic four-vertex sandbox ponds all passed, because their grips sit at four
     distant corners while a surveyed ring peppers its own basin edge. Two things make this observable rather
     than lucky: the app exposes its own resolution read-only (`window.__plannerHitTarget`, E2E-gated — a
     harness re-implementing the rule tests its own copy), and a harness must deliver a **native** `dblclick`
     (`clickCount: 1` then `2`; two bare down/up pairs leave the counter at 1 and Chromium synthesises nothing,
     so the whole root-resolver path goes unexercised while every row reads green).
  5. **The fix belongs at the RESOLVER, not on the object that was reported.** A handle is chrome belonging to
     the selected feature, so it is TRANSPARENT to "which feature was double-clicked" — one rule closes every
     element type that renders grips at once. Identification only: grips keep their own pointer events and
     their own `onPointerDown`, and **a vertex must still drag** — assert that in the same commit, counting how
     many vertices moved (a press falling THROUGH an inert grip moves the whole object, which passes any
     "the geometry changed" check).
  6. **⛔ AND THE FIFTH INSTANCE'S CLAUSE — WHEN THE FEATURE IS SMALLER THAN ITS OWN CHROME, "WHAT IS
     BENEATH THIS GRIP" AND "WHAT IS THIS GESTURE ABOUT" STOP BEING THE SAME QUESTION.** Clause 5 fixed
     identification at the resolver by looking THROUGH the handle layer, which answers the first
     question. It does not answer the second, and those coincide only while the feature is bigger than
     the chrome it summons. Captured live on the owner's Bain plan: a road stub whose whole rendered
     body is **6×12 CSS px**, wearing a 12 px endpoint handle inside a 15×22 px handle box. Press 1
     selected it; press 2, at the same point, addressed **a different, larger road**, and the panel
     open after press 1 was gone after press 2. **The control matters as much as the capture** — on a
     LARGE road, a point where press 1 mounts an endpoint handle directly over the press point still
     resolves to the road and still opens Properties, so looking through the handle layer works and the
     endpoint handle is not the differentiator. **The SIZE RATIO is.** The rule: **while a double-click
     is in flight, the feature press 1 selected WINS the hit test at that point** — anchored on the
     native double-click's own time and distance budgets, so one press outside them is not a gesture and
     resolves off the stack exactly as before (`featureTarget.gestureAnchorTarget`). Two corollaries:
     **(a)** a "prefer it on a tie" rule is not enough — it still loses to whatever the stack puts on
     top, which is the failure; **(b)** the same size ratio makes REVIEW chrome dangerous, not just
     grips — the min-radius flag's 7 px corner dot is wider than that stub, and it swallowed the press
     entirely AND ran the corner fix on press 2, **silently re-cutting the alignment**. Chrome that
     paints ON its feature's body identifies AS that feature and forwards the press; chrome offset into
     clear space keeps its own action and does NOT claim to be the feature. **A gesture whose contract
     is "open Properties" must never edit the plan, and never CLOSE a panel that was already open** —
     both are now asserted for every feature by `audit-doubleclick-properties`.
  7. **⛔ THE SIXTH INSTANCE — CHROME ARMED BY THE CURSOR MERELY *RESTING* ON IT (B280402), and it is
     the one clause 4 cannot reach.** Clause 4 says chrome mounted by the FIRST PRESS is invisible to
     any check that reads the DOM before the interaction. This is worse: the parcel acreage badge
     becomes a hit target on HOVER (B1327/NEW-4 moved the gate from selection to hover so the badge
     could be dragged at all), and **a cursor resting on a point is exactly what a cursor does between
     the two presses of a double-click**. Measured on the owner's plan and reproduced: at one point,
     nothing selected, the stack reads `["el:<stub>"]` after touching another feature and
     `["parcel:<lot>", "el:<stub>"]` after resting on it — **the parcel does not move above the
     element, IT ENTERS**, and the element is still there, second, unchanged. It is not paint order and
     not a pointer-events flip on the element (both proven identical across the two states). **So the
     probe shape is: park the cursor, let it arm whatever it arms, and RE-ASK** — every other check in
     this repo reads after a click, never after a plain hover. Fix shape: chrome that is a manipulation
     affordance is IDENTITY-TRANSPARENT wherever it lives — `data-chrome` joins `data-handle-layer` in
     the resolver — while keeping its own press, so the badge still drags.
  Precedents: **B1174** (measurement chips), **B1327** (the parcel acreage badge — the third instance, and the
  reason this is a named rule; regressed by B1186 moving the badge anchor to `polylabel`), and **B50010** (an
  element's own DIMENSION NUMBER — a road's is anchored to the centreline midpoint, so it is painted ON the
  pavement and a double-click aimed at the road cannot miss it; the general fix is that chrome sitting over
  its own object's BODY forwards the press to the body, asked once for every type rather than special-cased), and
  **B233153** (a detention pond's OWN vertex handle — the fourth instance, and the one that produced clauses 4 and 5
  above; captured live on the owner's Bain plan after six realistic sandbox reproductions all came back green), and
  **B806082** (a callout's own leader re-aim grips — the tip and elbow handles paint exactly where a right-click
  naturally lands, and neither carried an `onContextMenu`, so the press fell through in total silence to the
  empty-canvas map menu instead of the leader's own "Delete Leader" row; fixed by forwarding both grips' right-click
  to the same handler their leader body already uses).
  **⛔ AND THE COROLLARY B50008/B50009 ADD: A GESTURE CAN DIE WITH NOTHING EATING IT.** This rule is about
  chrome swallowing a press, and reading every failure through it is how two other causes survived for
  months — the pair being measured on a WALL CLOCK read inside the handler (so a busy plan spends the whole
  budget on queueing delay), and the native `dblclick` retargeting to the root because press 1 re-rendered
  the node the browser was holding. When a double-click "does nothing", check the CLOCK and the TARGET
  before hunting for what covered it. The deliberate
  EXCEPTION is user-placed content the user opted into putting on top — a promoted reference (B1198), a markup
  with `behindEls: false` — which is selectable, lockable and demotable in one click from the menu that put it
  there. Guard: the e2e spec **chrome-swallows-press** (mutation-checked both ways).
- **FOREGROUND-OR-VOID** — **A BACKGROUND TAB CANNOT BE MEASURED: NOT ITS CLOCK, AND NOT ITS PIXELS.
  A browser-driving harness MUST assert `document.visibilityState === "visible"` BEFORE it measures
  ANYTHING — time or geometry — and FAIL LOUDLY if it is not.** (Owner rule, 2026-08-09, filed with
  both measurements that produced it. **ONE precondition rather than two rules, deliberately: one
  cause produces both failures, and a harness must not be able to satisfy it by halves.**)
  0. **⛔ CLAUSE 2 — GEOMETRY, AND IT IS THE MORE DANGEROUS OF THE TWO. Any DOM measurement taken
     after a VIEW CHANGE on a background tab is void, because rAF is SUSPENDED and the drawing never
     repaints.** Measured on the owner's live tab at `visibilityState === "hidden"`: `requestAnimation
     Frame` **did not fire once** when raced against a MessageChannel loop for two full seconds. A CDP
     wheel then updated the app's STATE correctly — `data-view-ppf` and `data-render-ppf` both
     0.0501 → 0.1062, a clean 2× zoom in — while the pond's DOM geometry **did not move at all**:
     centre (892.9, 248), width 143.4 px, identical to three wheel gestures earlier, to one decimal
     place. **A throttled timer gives you a wrong NUMBER; a suspended rAF gives you a wrong PICTURE
     THAT IS INTERNALLY CONSISTENT** — boxes, positions, sizes and hit tests all agree with each other
     and all describe a view the app already left, and the app's own state attributes will confirm the
     view you asked for. Anything built on `elementFromPoint`, `getBoundingClientRect` or a screenshot
     inherits it silently. **It cost a false lead before it was caught:** an apparent anchored-zoom
     defect (a wheel-out at pointer x=900 leaving the drawing at x=104, moving AWAY from the pointer)
     was flagged against **B1449 / B258992 / V56000** and is **REFUTED — a stale frame, not a broken
     anchor. The anchored-zoom work is not implicated; do not re-open it on that evidence.**
     **THE rAF LIVENESS PROBE IS PART OF THE ASSERTION, not an extra:** race one rAF against a
     MessageChannel loop, because it catches the case `visibilityState` cannot — a tab that claims to
     be visible while its frame loop is wedged anyway.
  1. **CLAUSE 1 — TIMING.** A probe of one double-click gesture on the owner's real plan reported **3,156 ms and
     2,992 ms**. The tab was `document.visibilityState === "hidden"` throughout (it was being driven
     from another tab) and the harness paced itself with `setTimeout`, which Chrome CLAMPS in a hidden
     tab. It was timing the clamp. **The control — same gesture, same build, same tab, same hidden
     state, ONLY the pacing primitive changed to a MessageChannel yield: 138–182 ms** end to end, 13–63
     ms of synchronous handler time. Four elements measured honestly: 111 / 138 / 154 / 182 ms. There
     was never a multi-second interaction cost to chase.
  2. **WHY IT IS A GUARD AND NOT A NOTE.** This trap's FIRST appearance produced an obvious failure and
     cost one round of probing. This one produced a **plausible number** — self-consistent, repeatable,
     in the right units, off by a factor of twenty — that reached the owner and was on its way onto two
     perf backlog items. A wrong number that looks right is strictly more dangerous than a crash, and
     nothing downstream can tell them apart, so the check belongs at the source.
  3. **MACHINE-ENFORCED, because a rule nobody's code consults is not a guard.**
     `ui-audit/lib/tabTiming.mjs` — **`assertMeasurable(page, harness)`** is the one precondition
     (visibility THEN rAF liveness, both throwing and both named), plus `pacedWait` (a MessageChannel
     loop; unthrottled, and the drop-in for a `waitForTimeout` INSIDE a timed section) and
     `timingProvenance`. **Wired into ALL 347 ui-audit harnesses that drive a browser — universal, not
     a list.** The first version named the 28 that read a clock; clause 2 swept in nearly all the rest
     for a real reason rather than a loose heuristic — almost every harness here clicks "Zoom to fit"
     and then measures a bounding box, which is exactly the pattern that returns a stale frame. So
     `test/tabTiming.test.js` requires it of every harness that launches Chromium, and requires the
     call to NAME itself so a failure says which run is void. **There is no list left to rot, and a new
     harness cannot be written without it.**
  4. **An "unreadable" visibility state is refused too** — a harness that cannot check cannot vouch.
  5. **⛔ AND AN INSTRUMENT BUILT TO ANSWER "WHY DID IT FAIL ON HIS MACHINE" HAS TO BE ARMABLE ON HIS
     MACHINE (B280403).** A read-only diagnostic hook shipped gated on `window.__PLANYR_E2E` — read
     ONCE AT MOUNT by an effect with `[]` deps — so it was unreachable on the owner's signed-in
     production tab, which is the only place the defect it was built for exists. The session that
     needed it armed the flag by hand and forced a remount by switching plans and back; that is
     folklore, not a feature. **Rule: gate a diagnostic at CALL time, never at mount, and give it a
     way in that needs no console — `?planyrDiag=1` (latched into `sessionStorage`, so an in-app
     navigation does not disarm it mid-diagnosis) or the session key.** The boundary that makes this
     safe and must not be widened: arming exposes READ-ONLY answers, writes nothing, changes no
     behaviour, and is session-scoped. It is not a debug mode and may never gate anything that
     mutates. (`lib/diagArm.js`; guards in `test/diagArm.test.js`.)
  6. **⛔ AND ITS SIBLING: A PROBE THAT OBSERVES THE MIDDLE OF A GESTURE HAS CHANGED THE GESTURE.**
     A reading taken BETWEEN the two presses of a double-click costs hundreds of ms and pushes the
     pair past `DBLTAP_MS` — at which point it is two clicks, not a double-click, and it will
     "reproduce" failures that mean nothing. Measured: a 900 ms read between presses manufactured
     exactly such a failure and nearly became a bug report. **So a harness either takes its reading
     only at the END of the gesture, or it MEASURES the press-to-press interval from the events' own
     `timeStamp`s and asserts it is inside the budget** — never assumes it. The deliberate exception
     is the TWO-PRESS INVARIANT, which is a single press followed by a question and does not claim to
     be a double-click. `audit-doubleclick-properties` now measures and asserts its own gap, and that
     assertion caught a defect in ITSELF on its first run (it was timing deselect→press-1, not
     press-1→press-2), which is the argument for measuring rather than assuming in one line.
- **DRIVER-SCROLL-IS-NOT-APP-SCROLL** — **AN AUTOMATION TOOL THAT SCROLLS TO REACH AN OFF-SCREEN TARGET
  CANNOT BE USED TO MEASURE SCROLL BEHAVIOUR. In a VIRTUALISED list, "the first rendered row" is NOT
  "a row on screen."** (B463922, 2026-08-13 — the sixth instrument failure of the day, and the first
  that survived long enough to be reported to the owner as a finding about his product.)
  1. **THE CASE.** `diagnose-grid-view-anchor.mjs` clicked the fold triangle on the FIRST RENDERED row
     of the scheduler grid. A virtualiser renders a buffer of rows ABOVE the viewport, so that toggle
     sat 75 px off screen; Playwright — like every browser driver — scrolls a target into view before
     clicking it, **through CDP, where a patched `scrollTop` setter cannot see it.** The harness then
     reported its own scroll as the app throwing the edited row 477 px down the screen and out of view.
  2. **⛔ "PROGRAMMATIC SCROLL WRITES: 0" IS THE TELL, NOT THE CORROBORATION.** That reading was taken
     as proof the app was innocent of *causing* the scroll, and used to argue the row was "abandoned".
     It actually meant the scroll came from OUTSIDE the page's JavaScript entirely. Whenever a
     container moves with no app write, the first two suspects are **the driver** and **the browser** —
     not a subtle app defect.
  3. **THE DISCRIMINATOR IS ONE LINE: drive the same control from inside the page.** `.click()` in page
     JS performs no actionability scroll. Same toggle, same build: driver click **+477 px**, page-JS
     click **−24 px**, a click on a toggle genuinely inside the viewport **−48 px** — and a target
     BELOW the viewport moved it the other way (+459). **Magnitude and sign follow where the target
     sat**, which is the driver's signature.
  4. **THE RULE.** Inside a scroll container, click only what a human could actually see. Enforced by
     `ui-audit/lib/visibleClick.mjs`: `visibleClick` proves the target is inside the container's
     viewport BEFORE clicking and THROWS if it is not, naming how far outside it sat;
     `installScrollWitness` + `assertNoDriverScroll` catch the same lie from the other side (the
     container moved during an action with no app write → the measurement is void). Pure verdict
     unit-tested in `test/visibleClick.test.js`; the refusal path is re-proved against the real app on
     every run of `ui-audit/verify-grid-row-hold.mjs`, aimed at the very toggle that produced the false
     finding — a guard nobody has seen fail is not a guard.
  5. **IT WILL BITE AGAIN ON ANY VIRTUALISED LIST** — the scheduler grid, the Gantt, the Library file
     list, any future long table. It is not specific to scrolling either: a driver's actionability
     scroll changes what is on screen, so ANY geometry read taken across it is suspect. Sibling of
     FOREGROUND-OR-VOID (a background tab cannot be measured) and SYNTHETIC-KEYS-DONT-EDIT (a
     synthetic keystroke does not mutate the plan): three ways for a harness to believe its own
     instrument.
  6. **⛔ AND THE FOURTH WAY, WHICH IS THIS RULE ONE STEP FURTHER: THE HARNESS'S OWN *QUERY* PRODUCED
     THE READING. POINT A PROBE AT A CASE WHOSE ANSWER IS ALREADY KNOWN, AND REQUIRE IT TO REPORT THAT
     KNOWN ANSWER, BEFORE TRUSTING IT ON THE UNKNOWN CASE.** (B532112, 2026-08-14, owner-adopted.)
     Clauses 1–5 are *the harness's own ACTION* changed what it then measured; this is *the harness's
     own QUESTION* was never about the thing it claims. Same species, same remedy shape as clause 3 —
     ask a second, known way and compare the two answers.
     - **⛔ WHY THIS REPO DID NOT ALREADY HAVE IT, and it is the sharpest part: EVERY DISCIPLINE HERE
       PROVES A GUARD CAN GO *RED* ON KNOWN-BROKEN CODE, AND NOTHING FORCES A PROBE TO GO *GREEN* ON
       KNOWN-GOOD CODE.** The teeth proof (NO-ONE-OWNS-A-COMPOSITE), the mutation check,
       `mintGateE2E`'s rejection path, VIEW-INDEPENDENT-ONCE §6's never-OBSERVED failure — all of them
       guard the red side. **That asymmetry is not incidental: it is exactly why both failures below
       landed on the unguarded side**, each reporting a defect in code that was correct.
     - **THE TWO CASES**, from one session's aerial-backdrop diagnostic: a page-wide
       `document.querySelectorAll('label input[type=range]')` swept in a slider belonging to a
       DIFFERENT panel and reported the row as carrying a control it does not have; and a control that
       only renders once its row is SELECTED was read COLLAPSED, reporting a working row broken. A
       third the same day is the same species one level up — a position check compared the empty state
       against the OCCUPIED one and reported those two branches' *intended* difference as a regression.
     - **WHAT CAUGHT ALL THREE was a known-good arm sitting beside the unknown ones** — it stayed green
       while the others failed, which is what localised each fault to the probe rather than to the app.
       **It was there by luck of the question's shape, not by rule.** That is what this clause fixes.
     - **THE CHECKABLE FORM, because a caution rots and a check does not:** a harness asserting a
       property must carry **at least one arm whose expected value is known INDEPENDENTLY of the code
       under test**, and must FAIL if that arm does not report its known value. **A run that exercises
       only the unknown arms is VACUOUS and must say so rather than print a score.** The vocabulary
       already exists — `MUST_BE_PRESENT` in `count-pond-invocations`, the vacuity guards in
       `verify-hidden-content-behaviour` — this makes it the default rather than a per-harness habit.
     - Scope every query to the element under test, and put a surface into the state the assertion is
       about before measuring it. Precedent harnesses: `ui-audit/verify-aerial-empty-state-copy.mjs`
       (its with-an-aerial arm is the known case) and `ui-audit/diagnose-aerial-backdrop-row.mjs`.
- **COUNT-EVERY-KIND** — **A PLAN'S CONTENTS ARE ITS FIVE DRAWN KINDS. A count that reads `[data-el-id]`
  sees ONE of them and reports the other four as NOTHING HAPPENED.** (NEW-2, 2026-08-09.) Measured live on
  the owner's Silvestri pair: a cross-plan paste landed three markup objects, the app correctly said so, and
  the element count read **120 before, 120 after** — a false "paste succeeds silently but writes nothing"
  was one keystroke from being filed against a working feature. The plan holds **145 distinct features**
  against those 120 elements. Every feature stamps `data-feature="<kind>:<id>"` (el · markup · measure ·
  callout · parcel); count **DISTINCT KEYS, never NODES** — chrome carries its owner's key too, so a node
  count drifts with selection and hover. Use `ui-audit/lib/featureCensus.mjs`; a targeted
  `[data-el-id="b3"]` lookup is untouched, and a genuine element-tier read says so with an `el-tier:`
  marker naming why. Enforced by `test/featureCensus.test.js` (source sweep + the counting rule) and
  `e2e/feature-census.spec.js` (one of each kind = five, with an el-only counter answering ONE beside it).
  **⛔ AND THE THING THAT RESCUED IT: Ctrl+Z, then diff the feature list. WHEN A COUNT SAYS NOTHING HAPPENED
  BUT THE APP SAYS IT DID, THE UNDO KNOWS** — an undo frame exists only if something was really committed,
  and undoing it names exactly what went in. A counter can be blind to a kind; the model's own history cannot.
  The same trap applies to picking a "blank" canvas point: free of ELEMENTS is not free of FEATURES, and a
  pan started on a markup DRAGS IT (`BLANK_POINT_EXCLUDE`).
- **NO-ONE-OWNS-A-COMPOSITE** — **A SURFACE BUILT FROM SEVERAL OBJECTS AT ONCE IS OWNED BY NONE OF THEM,
  SO NO PER-OBJECT PREDICATE CAN REACH IT AND NO FEATURE CENSUS CAN SEE IT.** (B505664, 2026-08-14, after
  the same species surfaced THREE times in one day.) A composite is a dissolved region, a merged outline,
  a union, or a **cached raster** — anything drawn once on behalf of many.
  1. **THE OBLIGATION.** When you add a hide, an exclusion, or **ANY** per-object state, ask separately
     **what composites read that object**, and invalidate them EXPLICITLY. A per-object filter applied at
     the object's own draw site is not enough and never was: the composite has already been built.
  2. **⛔ THE GUARD IS INK OR PIXELS, NEVER REGISTRATIONS.** A census counts things that REGISTERED
     themselves — `data-feature` keys, `[data-el-id]` nodes, model entries. A composite registers nothing,
     so it is invisible to every count by construction. Assert on what is PAINTED
     (`ui-audit/lib/inkCensus.mjs` attributes every painted node; a canvas pixel count answers where even
     that cannot).
  3. **⛔ AND THIS IS EXACTLY WHERE `COUNT-EVERY-KIND` STOPS, WHICH IS WHY THE TWO ARE NAMED TOGETHER.**
     That rule guarantees you counted every FAMILY of object, and it is the closest thing this repo had —
     so the next reader will reach for it and believe they are covered. **They are not.** COUNT-EVERY-KIND
     is the instrument half, and it is the very rule that certified the road pavement green: every road's
     own node correctly left the canvas, `4 drawn → 0`, ✓, while four unbroken grey ribbons stayed on the
     drawing. A rule about counting every kind of object says nothing about ink belonging to several at once.
  4. **THE THREE INSTANCES, so this entry carries its own evidence rather than reading as theory:**
     · **B3296 — the dissolved road pavement.** Hiding Roads removed every road's hit target, label and
       dimension and left the merged pavement painted, because `roadNet` unions the cluster from `els`.
     · **B494050 — the export crop.** `devExtent`/`exportFeetExtent` framed the printed sheet from the whole
       model, so a hidden group left blank paper where it used to be (PDF-PARITY).
     · **B503184 — Doc Review's cached sharp tile.** `renderDetail`'s `tileCovers` check asks *"does what I
       already drew still cover this view"* and knows nothing about the drawing having changed, so a
       switched-off PDF layer stayed on screen: backdrop 0 blue px, the tile above it **579,121** — exactly
       that shape's share of the page.
  5. **⛔ THE SHAPE THEY SHARE, and it is why each survived review: IN EVERY ONE, THE PER-OBJECT SIDE WAS
     CORRECT AND LOOKED CORRECT.** The filter was applied, the predicate was asked, the object's own node
     left the DOM, the unit tests passed. Nothing in the per-object code reads as wrong on inspection —
     which is precisely why "I checked the filter" is not evidence here.
  ⚠ **PROSE, WITH PER-INSTANCE GUARDS — there is no generic detector and this entry does not imply one.**
  "Is this surface a composite?" is not decidable from source, so the enforcement is behavioural and lives
  with each instance: the repo-root `test/` suites **contentVisibility** (the seam sweep), **hiddenContentReads**
  (the declaration table + its teeth proof) and **docReviewLayerVisibility**, plus the ui-audit harnesses
  **verify-content-visibility** (per-family ink), **verify-hidden-content-behaviour** and
  **verify-pdf-layer-hiding** (canvas pixels). `test/compositeSurfaceRule.test.js` guards the ENTRY itself:
  that the rule is still stated with its operative line, and that every guard it cites still exists —
  a rule whose evidence has been deleted has rotted, and reads as covered.
  **⛔ AND THE PREFERRED FORM OF THE TEETH PROOF, learned on B503184: point the new check at UNTOUCHED
  code and require it to go RED there BEFORE writing the fix.** That is stronger than planting a synthetic
  defect, because a planted one only proves the check can see the thing you already built it to see.
- **SYNTHETIC-KEYS-DONT-EDIT** — **A SYNTHETIC KEYSTROKE DOES NOT MUTATE THE PLAN, AND ONE DOM READ IS NOT
  A CHECK. Drive the real input, then RE-READ UNTIL THE FEATURE IS GENUINELY ABSENT.** (NEW-3, 2026-08-09.
  Sits beside FOREGROUND-OR-VOID because it is the same species: a harness that believes its own instrument.)
  1. **THE COST, which is the reason it is a rule and not a note.** This has taken **two cleanup rounds on
     the owner's LIVE plans** — a stray easement left on Bain / "Concept - Original" (2026-08-08) and three
     pasted markups left on Silvestri (V27088, 2026-08-09). Both times the harness "deleted" the object,
     **reported success, and the object was still on his plan**, so a human had to finish it by hand.
  2. **THE MECHANISM, MEASURED rather than reasoned** (build 7307342, one selected building, count before →
     after). The planner's key handler is bound to **`window`**, and `new KeyboardEvent(…)` defaults
     **`bubbles: false`** — a real key event never does — so a synthetic event dispatched on `document` or
     `document.body` never propagates to it:

         document.dispatchEvent(new KeyboardEvent("keydown", {key:"Delete"}))        1 → 1  ✗
         document.body.dispatchEvent(…)                                              1 → 1  ✗
         window.dispatchEvent(…)                    (the listener's own target)      1 → 0  ✓
         …any of the three with { bubbles: true }                                    1 → 0  ✓
         page.keyboard.press("Delete")              (a real key event)               1 → 0  ✓

     So it is NOT that the app rejects untrusted events — it never checks `isTrusted`. It is one missing
     option, and it fails in **total silence**: no error, nothing in the console, the object still selected.
  3. **AND TWO MORE GATES SWALLOW THE KEY BY DESIGN**, so a driver can do everything right and still no-op:
     a **FOCUSED FIELD** (while `activeElement` is an input/select/textarea/contentEditable the handler
     returns early so you can type — correct product behaviour, invisible to a driver that did not blur),
     and an **INACTIVE PLANNER** (`if (!active) return` — a keep-alive planner behind another workspace
     must never eat keys).
  4. **THE RULE.** Never dispatch a synthetic keystroke to mutate the plan. Use the driver's real key input
     (`page.keyboard.press` / CDP `Input.dispatchKeyEvent`), or press the control that does the job — the
     Properties panel's **Delete element**, or the right-click menu's. **And RE-READ BETWEEN ATTEMPTS:** the
     DOM read races the re-render, which is exactly how a pass was reported for an object still present.
     Poll until the feature is ABSENT, then **reload and confirm** — a removal that never reached storage
     comes back.
  5. **MACHINE-ENFORCED, both halves.** `ui-audit/lib/deleteFeature.mjs` is the only supported deletion
     driver (`deleteFeatureUntilGone` escalates key → panel → menu, re-reading between each, and **THROWS
     rather than reporting a pass it did not earn**); `test/deleteDrive.test.js` pins the verdict table and
     **sweeps `ui-audit/` + `e2e/` for the banned shape**. The claim itself cannot become folklore:
     `ui-audit/verify-delete-drive.mjs` re-measures the table above against the real app every run and
     **fails if the banned shape ever starts working** — the day the key wiring changes, the rule says so
     instead of quietly going stale.
- **PERCEPTUAL-PARITY** — **The bar a change to the PICTURE has to clear is that the owner cannot SEE it at
  working zoom — not that the file is unchanged.** (Owner amendment, 2026-08-06, verbatim: *"imperceptible at
  working zoom assuming that one makes the most sense"*, and *"I've got a 2K display, so I'm not gonna see
  certain levels of detail."*) **This SUPERSEDES the B1345 bar — byte-identical, or one unit of 255 on one
  channel — for every LOD-class change.** B1345's bar measured the FILE, and it cost real work twice: B1350's
  dock-door leaves were refused at 12–23/255 and 424 DOM nodes stayed on the table, the second time for a
  cause that turned out to be that Chromium does not rasterise a `<rect>` and a rectangular `<path>` to the
  same antialiased edge at any zoom — so no gate could ever have saved it.
  1. **THE METRIC IS CIEDE2000 (ΔE00) ON AN ACUITY-FILTERED PAIR**, not a channel delta — 10/255 in a dark
     blue and 10/255 in a light yellow are nothing alike to a viewer. Both renders are low-pass filtered
     first, at **two scales**, because a raw diff cannot tell *the same ink moved a sub-pixel* (invisible)
     from *a line of ink removed* (a downgrade) — both read ~23/255, and refusing both is what byte-identity
     did. Engine: `ui-audit/lib/perceptualDiff.mjs`, driven by `ui-audit/verify-perceptual-parity.mjs`. The
     **measurement did not go away** — the pixel-diff harness and its dependency-free PNG decoder are the
     same ones; the threshold and the metric changed.
  2. **THE BAR, three magnitudes, all pinned by unit test** (`test/perceptualParity.test.js`, whose CIEDE2000
     is checked against Sharma/Wu/Dalal's published vectors): **detail ΔE00 ≤ 6.0** near acuity (what stops a
     fine texture being replaced by its own local average) · **perceived ΔE00 ≤ 1.0** — the classical JND —
     and **perceived frame-mean ΔE00 ≤ 0.10** (what stops a thousand invisible differences adding up).
     Coverage is REPORTED but does not gate: for an antialiasing-class change the pixels touched scale with
     total edge length, i.e. with how much is drawn, not with how much changed.
  3. **THE VIEWING GEOMETRY IS STATED, NOT ASSUMED, and it is a parameter.** 20/20 acuity (1 arcmin), 600 mm
     viewing distance, 0.50 mm per CSS pixel (a 27″ 2560-wide panel at the owner's measured dpr ~2.15) → one
     CSS pixel subtends ~2.9 arcmin. The two numbers this repo cannot measure — his panel's physical width
     and how far he sits from it — are on `OWNER-TODO.md`, and every run prints the geometry it used.
  4. **⛔ THE THRESHOLD IS CHOSEN BEFORE THE MEASUREMENT, NEVER AFTER.** Picking a bar to suit a result you
     have already seen is not a measurement. Moving one of the three numbers is a product decision about
     drawing quality: argue it on the item, name the price, never nudge it to make a run pass. The first real
     use of this bar REJECTED the change it was introduced for (B1350's fold: perceived ΔE00 1.20–2.19), and
     the bar was left alone — that is the standard.
  5. **EVERY change that alters the picture records a before/after crop in the PR**, so the owner sees what
     he approved. `--shots` writes them.
  6. **The old bar is not gone, it is DEMOTED**: byte-identical is still the right claim to make when a change
     genuinely is byte-identical (B1437's dock-plan cache), and saying so is stronger than a ΔE00 of 0.

- **WRONG-CASE** — **WHEN A USER SAYS A FEATURE "NEVER WORKS" AND IT DEMONSTRABLY WORKS IN THE CASE YOU
  TESTED, YOU TESTED THE WRONG CASE. Go and find the case they are in. Do not close the loop on your own
  fixture.** (B548064–B548066, 2026-08-14, owner-instructed after the sixth report of one symptom.)
  1. **THE CASE IT COMES FROM, and the cost is the argument.** "Send to back / layers never work" was
     reported **six times** and "fixed" **four times** — B421, B820, B671, B293072/B293073 — and **every
     one of those fixes was correct**. All four tested MARKUP AGAINST MARKUP, which already worked before
     any of them. His case was a markup over a **BUILDING**: two markups share a band, so "back" moves
     within it and the picture changes, while a markup over a building is a question about the OTHER band
     — which the command could not address at all. It ran, changed nothing visible, and **greyed itself**,
     which reads as "already done".
  2. **THE VARIABLE IS NEVER THE COMMAND — IT IS WHAT THE COMMAND IS BEING ASKED ABOUT.** Before writing a
     fixture for a reported symptom, write down what is DIFFERENT about the reporter's scene: what is
     underneath, what is selected, what is on top, how many, how big, which band. A fixture built to make
     the mechanism observable is usually built to make that difference disappear.
  3. **A HARNESS FOR A REPORTED SYMPTOM CARRIES A PRECONDITION THAT REFUSES TO REPORT A SCORE** unless the
     reported configuration is really present. `verify-markup-over-building.mjs` asserts the markup is
     painted over the building AND that a point exists where the app's own hit stack holds both, and
     throws otherwise. Without that, a tidy fixture reports PASS on a dead implementation — which is
     precisely what happened four times. (Same shape as DRIVER-SCROLL-IS-NOT-APP-SCROLL §6's known-good
     arm: prove the instrument can see the thing before believing its verdict.)
  4. **AND THE PROCESS HALF, which is where this actually failed: A LIVE CHECK MUST STATE A CLOSURE
     CONDITION SOMEONE OTHER THAN THE OWNER CAN MEET.** V91632 said *"only he knows which objects he
     tried"* — not a blocker, a check nobody but him could close, so four sessions closed it on the case
     they could think of. A named `Blocker:` (`auth` / `real-data` / `live-GIS`) is the LEGITIMATE form:
     it names a configuration someone can obtain and leaves every step runnable. Deferring to what is in
     the owner's head names nothing. Every `V###` gets concrete steps with a **named expected result per
     step**. Guard: `test/verificationClosability.test.js`, whose mutation check flags V91632's real
     sentence verbatim and clears an honest `Blocker:` item.
  5. **RELATION TO THE NEIGHBOURING RULES, so this is not read as a duplicate.** ATTEMPT-BEFORE-YOU-PARK
     says a Claude-doable check may not be deferred; **STANDING RULE #2** says an owner-reported symptom
     may not be closed on a null. **Both were followed here** — V91632 was run, by the cohort, on his real
     plan, and it passed honestly. Neither asks *was the check pointed at the case that was reported?*
- **DEDUPE-FIRST** — Search **Open, ⏳ Verify, AND Done** (`^### B` headings + `#tags` + symbols; grep
  `BACKLOG_OPEN.md` for the live set) before minting a `B#`. A matching prior item gets the recurrence
  treatment (back to Open, `Recurrence:` line, `(×N)` title) — never a fresh number. When you DO mint,
  get the number from **`npm run next-id`** (B755) — never grep the archives for the max.
- **TOMBSTONE-DELETES** — Every removal path records tombstones for its **FULL cascade set** before the
  next flush, so a merge / sync can't resurrect the deleted item (or raise a false "changed in another
  session" conflict). Applies to every delete handler, not just the obvious one. (B276 / B556 / B596 / B612.)
- **TIER-BY-REBUILDABILITY** — **User work and re-fetchable cache NEVER share a storage tier, and anything
  that can be re-fetched belongs in the LARGE one** (B1427, 2026-08-06, after a disposable map cache
  crowded the owner's saved plans out of a ~5 MB store — the B473 "your work is safe in the cloud, this
  device's storage is full" banner, with 400 KB terrain tiles keeping their space while a real plan was
  refused). Four parts, all binding:
  1. **THE TWO TIERS ARE DIFFERENT BY THREE ORDERS OF MAGNITUDE AND ARE NEVER REASONED ABOUT AS ONE.**
     Measured on the owner's own Chrome: **localStorage 3.88 MB across 156 keys against a hard ~5 MB
     per-origin cap (~78% full)** · **IndexedDB 35.9 MB against a 10,275.9 MB quota (0.3%), persisted.**
     Never sum them, never report a combined figure, never call the large one "uncapped" or "a store that
     can't fill" (`localDb.js`'s header said exactly that, and that framing is what let the mistake live
     for a year). A combined "4 MB of 10 GB" reads as empty while the store that matters is about to throw.
  2. **THE SMALL STORE IS FOR IRREPLACEABLE WORK ONLY** — saved plans, the cloud index, the version ring,
     the autosave. A cache that competes with it is a **priority inversion**: pure cache holding room that
     irreplaceable user work needs. Put the cache in IndexedDB (`gisCache.js`'s persistent tier, B1427)
     and keep its own budget there — bounded is still right, it was just bounded against the wrong ceiling.
  3. **A BUDGET IS NOT OPTIONAL, EVEN IN THE LARGE STORE.** `SitePlannerApp.jsx` calls `idbPersist()`, so
     this origin is **PERSISTENT** — the browser will never evict it for us. That is correct for data safety
     and it makes the app solely responsible for its own size.
  4. **NO EVICTION MAY EVER COST DATA THAT CANNOT BE REBUILT.** Every reclaimable class must **declare a
     rehydration source** (cloud Storage, the source PDF, a re-fetchable GIS service) before anything is
     removed; a class that cannot name one for EVERY member is not reclaimable at any pressure. B474's
     hazard is the precedent — "a raster whose src had been dropped (idbKey set) was then unrecoverable" —
     so reference images declare `rebuild: null` and are never bulk-cleared. Declarations live in
     `shared/storage/storageCensus.js`; `shared/storage/storageReclaim.js` is the only module allowed to
     act on them, and it refuses the whole pass if any class claims to be reclaimable with no way back.
  - **Corollary — MEASURE, don't reason.** Nothing knew its own size before B1429, which is why the first
    diagnosis of this crisis blamed IndexedDB and was wrong by three orders of magnitude. Both tiers are
    now surfaced (the planner's plan menu → Storage, reachable signed-out) and both ride every storage-failure telemetry
    row, tier-labelled `local_*` / `idb_*`. Guards: the repo-root `test/` suites **storageReclaim** (incl.
    the raster-with-no-cloud-copy case) and **gisCache**.
- **ROWS-CANONICAL-ON-SEED** — **Which ledger wins when a plan is opened, decided explicitly (B1113,
  2026-07-29, after the ambiguity cost a real plan three times).** A signed-in plan has THREE copies of
  every element: the `site_elements` ROWS, the on-device CACHE (localStorage mirror), and the pending-edit
  JOURNAL. The rule: **for an element the server ALREADY HAS, the rows win** the moment the engine seeds
  from them — unless there is a *pending local op* to explain the difference, which is a real edit and is
  kept. **For an element the server has NEVER seen, local wins** — that, and only that, is what the
  B124 / B756 "never drop local work" guarantee covers. The trap this closes: after a seed the shadow
  holds the FRESH rev, so a stale cached copy commits **cleanly** — the rev guard cannot help, because the
  client legitimately holds the current rev. Mechanically: `reconcile(collections, { afterSeed: true })`
  on the seeder's own diff (`elementSync.js`), which adopts rows via `onRowsCanonical` instead of
  enqueueing; and the bonded heal runs **AFTER** the journal / never-synced folds in `refetchReplace`, so
  no fold can put a geometrically impossible assembly on the canvas. Never re-order those two.
- **DANGEROUS-MEANS-UNOBSERVABLE** — **When work is called DANGEROUS, NAME WHAT IS MISSING that makes it so.
  If the answer is "nothing can observe whether it is correct", that gap is itself a DEFECT — and it is
  usually the more valuable thing to fix.** (Owner rule, 2026-08-08, verbatim: *"I'm not really worried about
  any path just because one is dangerous. I don't know that that's a good reason. If it is dangerous, then,
  like, we should probably be fixing it in the first place because why is it dangerous?"* He was right and he
  overruled the framing.)
  **THE CASE IT COMES FROM.** B1449 (smooth zoom) was called too dangerous to ship for weeks, and the stated
  reason was that at rest `renderView.ppf === view.ppf`, so a correct implementation and a broken one produce
  IDENTICAL output in every existing test, e2e spec and pixel harness. **That is not a property of the
  refactor — it is a hole in the harness.** The repo could not observe MID-GESTURE rendering at all, and that
  hole bites every future interaction change, not just that one. So "it is dangerous" was never a reason to
  avoid the work; it was a reason to **build the missing instrument first**, which was already step 1 of the
  plan and is worth having on its own merits.
  **HOW TO APPLY IT, three steps:** (a) write down the specific observation the guards cannot make — not
  "this is risky" but *"no check in this repo can distinguish X from Y"*; (b) build that instrument and
  **prove it goes RED on a deliberately wrong build** (a guard nobody has seen fail is a guard that rots
  green — VIEW-INDEPENDENT-ONCE §6 names the same failure mode); (c) then do the work. If the instrument
  cannot be built, THAT is the honest blocker to report — never the vague "dangerous".
  **Do not confuse this with genuine caution.** Irreversible/destructive actions and real product decisions
  still stop for the owner. This rule is about ENGINEERING risk that is really an observability gap.
- **LIVE-VERIFY** — These classes can only be *confirmed* live, so they file `Verify: live` and park in
  `## ⏳ Verify` until seen working: timing / race bugs · concurrency / multi-writer · GIS endpoint
  behavior · zoom- or data-density-dependent rendering · PDF / export parity · anything whose repro
  cites real project data. Each class maps to ≥1 e2e harness spec (`e2e/`, B278/B280/B281) so the manual
  live gate shrinks over time.

- **PANEL-BREVITY** — **LESS IS BETTER. The default view is the scarcest space in the product; every
  line must earn its place.** (Owner rule, 2026-07-28, verbatim: *"you keep adding words to the yield
  panel. So make a rule somewhere in the repo that that's not what we want to do. Less is better. I just
  want the information literally as brief as it can be."* Written after three consecutive sessions each
  added individually-correct copy — the honest storage explainer, the five-case berm state, the
  reconciliation paragraph — and nobody consolidated, so the panel became a wall of text.)
  1. **VERDICT + NUMBER FIRST, then at most ONE short line per group.** Everything else collapses
     behind the group's existing `Assumptions & method ▸` disclosure (the B862 pattern).
  2. **New copy REPLACES, it does not ACCUMULATE.** A change that adds a sentence to a panel must
     **name the sentence it removed**, in the commit and on the item.
  3. **Prefer a NAMED STATE over a sentence explaining the state.** A short labelled chip beats a
     clause: `berm ring 17.4 · below flood 12.2` beats *"17.4 ac-ft is taken up by the earthen berm
     ring built inside the outline, and 12.2 sits below the flood level…"*.
  4. **Numbers over prose; absolute values over percentages** (a percentage against a near-zero
     denominator is noise — B1034).
  5. **Never render the same sentence in more than one place.** State it once; elsewhere reference it.
  6. **Honesty stays REACHABLE, not VISIBLE.** Collapsing is the tool — deleting facts is not.
     **Brevity is never bought with accuracy.** If you find yourself removing a fact to shorten a
     panel, you have taken the wrong branch: shorten the DEFAULT VIEW, not the information.
  7. **Measure it.** Any change touching yield / pond panel copy reports the visible line + character
     count per group **before and after**. A net increase requires explicit justification on the item.
  - **MACHINE-ENFORCED, because a markdown rule rots.** `node ui-audit/panel-copy-budget.mjs --check`
    (in the `/improve` gate + `test/panelBrevity.test.js`) measures the visible default-view copy of
    each panel region against **zero-headroom budgets** in `ui-audit/panel-copy-budget.json`, so an
    accumulating change goes **red in CI** instead of relying on a reviewer noticing. Copy inside a
    `<Collapse>`, in a `title=` / `basis=` hover, or in a `keyedNote(...)` method note is **exempt** —
    those are the sanctioned escape valves, which is why collapsing gets you under budget and deleting
    is never necessary. Raising a budget number is allowed but never silent: justify it on the item.
    (Extends the per-line caps this repo already had — B823's 110-char `warnNote` cap in
    `test/drainageNoteLength.test.js`, and `test/pondCopyLint.test.js` — from *"no one line may be a
    paragraph"* to *"no group may accumulate lines."*)

- **VIEW-INDEPENDENT-ONCE** — **Work whose inputs are MODEL + SETTINGS must not be recomputed because
  the VIEW moved. A memo key may never contain a view term unless the value is genuinely view-derived
  — and then only the term it actually uses.** (Named 2026-08-06 after the owner, verbatim: *"since
  you're saying it's the same bug, it's like, alright. Well, we didn't find it for this, so find it for
  all the other times. or all the other scenarios."*)
  1. **THE CLASS, and why intuition will not find it.** The same defect had been found TWICE by
     accident: **#926/B1440** — `f2p` was `worldToScreen(view, …)`, so every element's pixel geometry
     was a function of the live view and a pan re-derived all of it (fixing it took DOM mutation
     records per gesture from 101,267 to 2,194) — and the pond **label fit**, re-solved every frame
     with the fit question asked in FEET, so a pan recomputed an identical answer sixty times. One
     class, two accidents. The third was found by an instrument, not by looking.
  2. **⛔ IT IS INVISIBLE TO EVERY VISUAL TEST IN THIS REPO, WHICH IS WHY THE GUARD COUNTS.** #926 said
     it plainly: *"a pan that silently goes back to baking the view is invisible to every screenshot
     and behavioural test in this repo; only a frame counter would notice."* Both instances draw the
     **identical picture** when broken — pixel diffs, DOM assertions, e2e paths and PERCEPTUAL-PARITY
     all pass on the defect. Never propose a screenshot as the guard for this class.
  3. **THE DETECTOR IS THE DELIVERABLE, not a case list.** `ui-audit/detect-view-recompute.mjs` drives
     a gesture that changes ONLY the view on a plan whose model and settings are frozen, through a
     build instrumented by `scripts/vite-plugin-recompute-probe.mjs` (**inert without
     `PLANYR_PROBE=1`** — no probe byte reaches production), and records per computation: identity
     (`file:line:name`, assigned at transform time), call count, ms, and **a structural fingerprint of
     its INPUTS and of its RESULT**. The fingerprint has to be STRUCTURAL: every instance of this bug
     returns a FRESH object holding an IDENTICAL answer, so `Object.is` — which is all React's memo
     does — reports "changed" on 100% of them. Four verdicts (`ui-audit/lib/viewIndependence.mjs`):
     **`once`** ✅ · **`redundant`** (same inputs, same answer, ran N times — a missing memo) ·
     **`view-churned`** (inputs moved, answer did not — a view term in the key) · **`productive`**
     (the answer genuinely moved — the cull rect, the scale bar, the north arrow, the LOD gates, and
     NOT a violation). It runs four scenarios, because the owner asked for all of them: **pan** ·
     **zoom** (correct answer: once per ppf step, not once per frame) · **single-element edit**
     (correct answer: only what depends on that element) · **panel open/close**.
  4. **THE INVERSE IS ALSO CHECKED AND IS NEVER "FIXED" HERE.** Something memoised so hard it fails to
     change when the view legitimately should change it is a correctness bug in the other direction.
     Reported separately (`inverseFindings`), never merged into the violation list.
  5. **THE FIX IS ALWAYS THE SAME SHAPE — extend the resolve-once boundary B1352/B1437/B1440
     established; do not invent a fifth mechanism.** Memoise by a MODEL + SETTINGS key. Where a value
     IS view-derived, key it on the SCALAR it uses (`view.ppf`) rather than on `view`, and where a
     view-derived value only needs to be *approximately* current, LATCH it (`viewCull.cullRectFor`
     keeps the rect it already holds while the true viewport is proven inside it) — holding the same
     OBJECT is half the fix, because a fresh object with identical numbers still invalidates every
     memo downstream. For pure library leaves with no hook to hang a memo on, use
     `site-planner/lib/pureCache.js` (a signature cache, or a `WeakMap` identity cache when the input
     is a large array that is rebuilt rather than mutated).
  6. **MACHINE-ENFORCED, in two halves, because the browser half cannot run in this repo's CI.**
     `ui-audit/verify-view-independent.mjs` is the **counter-based gate**: it drives a real pure pan
     and fails if any computation in its `REGISTRY` ran more than once — **and fails if a registered
     one was never OBSERVED**, which is exactly how a guard of this shape rots into a permanent green.
     `npm run perf:viewindep`; mutation-proven (disabling the cull latch takes it from ✅ to four
     failures at 186 calls each). The CI-runnable half is `test/viewIndependentRegistry.test.js`,
     which asserts every registered memo still exists and that **no dep array carries a raw view
     term**. Pure core unit-tested in `test/recomputeProbe.test.js`, the fixes in
     `test/pureCache.test.js`.

### Definition of Done (every item)
1. **Implemented** — the whole job, including the hard / real part (STANDING RULE #1). No diagnosis-only.
2. **Unit tests** for any pure library touched.
3. Every **applicable named rule** above is satisfied.
4. `BACKLOG.md` updated **and** `BACKLOG_OPEN.md` regenerated (`node scripts/build-backlog-index.mjs`).
   Touched yield / pond panel copy? **PANEL-BREVITY** applies: run `node ui-audit/panel-copy-budget.mjs`
   before and after, and put both numbers on the item.
5. `MAP.md` regenerated (`node scripts/build-map.mjs`) **if** files were added / removed / renamed or a
   primary export changed.
6. The `Verify:` field is honoured — a sandbox note appended (→ Done), or the item parked in `## ⏳ Verify`
   with the pending live steps **and** a `V###` logged in `VERIFICATION.md`.
7. **Committed and merged** ("commit" = shipped live via PR + merge — see Workflow & deploy).

## What's already built — see `docs/SHIPPED.md`

The full catalog of shipped-and-verified work (Site Planner, Supabase backend, multi-workspace foundation, Document Review) lives in **`docs/SHIPPED.md`**. Read it only when you need the history of a specific feature — it is not needed to orient.

## KEY DECISIONS (must persist)
- **Theming: light / dark / system + the text-hierarchy rule (owner rule, 2026-06-21).** The app
  has three themes — **Light / Dark / System** — driven by `data-theme` on `<html>` + CSS tokens
  in `src/index.css`, mirrored to JS for the SVG canvas in `src/shared/theme/palette.js` (var()
  can't be used in SVG attributes / canvas export — keep the two in sync). **Chrome themes WITH
  the app** (light theme = light chrome) — never a permanently-dark bar over a light app (the
  constant pupil readjustment is the worst case for eye strain). **Build text hierarchy through
  weight, size, and uppercase letter-spacing — NEVER by fading text toward the background.**
  Low-contrast gray body/label text is **disallowed** (eye strain in bright offices); subtle grays
  are correct ONLY for borders, the drafting grid, and the semantic "Complete" status badge. New UI
  must reference **theme tokens, never raw hex**, and clear **WCAG AA (≥ 4.5:1)** for body text on
  its surface in **both** themes. This is now **machine-enforced**: `ui-audit/contrast-audit.mjs`
  (parses the real `index.css`) + `test/contrast.test.js` fail CI if any defined token pair drops
  below its floor — so a palette edit can't silently re-introduce a low-contrast pair. Text/icon ON
  the global accent fill uses **`--on-accent`** (white in light, near-black in dark — the dark accent
  is too light for white); saving/unsaved/offline labels use **`--warn-text`** (AA amber). The common
  trap (the B341 regression): a chrome-region component that **hardcodes a color instead of a token**
  reads fine until the chrome flips theme — always repoint to tokens. **The Light/Dark/System picker
  lives in the row-1 Settings gear (⚙) popover** (`AppHeader`), reachable signed-out; the "System"
  live OS listener is in `ThemeProvider`, independent of where the control mounts. (B316–B320, B341, B342)
- **Project-status palette + map markers (owner rules, B433/B434; the single source is
  `src/shared/ui/statusTokens.js`, mirrored to the `--status-*` CSS vars in `index.css`).** Three
  standing rules govern how a deal stage looks, everywhere (map pins, left-rail chips, list markers,
  section headers, the status menu):
  1. **Map markers are always solid-filled with a white keyline — never a transparent/hollow primary
     marker on the aerial** (a thin hollow ring vanishes over green imagery). The zoomed-out marker is
     the **precision pin** (`sitePinIcon`, B434): a color **bulb** on a short **stalk** seated over a
     **ground ring**, the ring center being the anchor (it sits exactly on the site coordinate). Progress
     (derived from status until a real `progress_pct` lands — B161/B163) folds into the ground-ring
     **sweep** (pursuit 10 · active 60 · onhold 30 · complete 100 · dead 0).
  2. **Status salience is MONOTONIC, Pursuit loudest → Dead quietest** — size + opacity track importance;
     settled stages (Complete, Dead) are smaller + dimmed. Never invert this.
  3. **RED is reserved for genuine alert/error** (the `--danger` CSS token — cloud-off badge, a failed
     layer dot, a destructive ×), **never an inert state.** Dead is therefore neutral **gray** (✕ +
     strike), the same gray as Complete (distinguished by glyph + strike, not hue). Active is **blue**
     (not green — green blends into green imagery and coral+green is the red-green-colorblind confusion
     pair); Pursuit is **coral**. Pursuit/Active are glyphless solid discs; the colorblind-safe glyph
     (‖/✓/✕) rides only on the settled stages.
- **No dialog-box edits — inline editors only (owner rule, 2026-06-17).** NEVER edit a value
  with `window.prompt`/`confirm`/`alert` (owner: "that is horrible UI"). Editing a number/text
  on the canvas must use an **inline editor in place** — e.g. the shared `numEdit` inline
  `<input>` overlay in `SitePlanner.jsx` (road width, per-edge setback, overlay trace length) or
  the callout `foreignObject` `<textarea>`. Commit on Enter / click-away, cancel on Esc. Applies
  to any new editing affordance.
- **Brand spelling — Planyr (P-L-A-N-Y-R).** Human-readable text → **Planyr** (capital
  P); package name + technical identifiers → lowercase `planyr`. Michael often
  says/dictates "Planner" (or "Planner Fit") — read these as the brand **Planyr** (and
  the old name **Planar_Fit**), not the literal word "planner." Don't reintroduce a
  "Planner"/"Planar" spelling for the brand.
- **Module naming — the Document Review workspace is user-facing "Review" (owner rule, B418, 2026-06-23).**
  The canonical **user-facing** name for this module is **"Review"** — the row-2 tab, the loader caption, the
  empty-state heading, and the error-boundary label all say "Review". The **internal id stays `doc-review`**,
  the folder is `src/workspaces/doc-review/`, the route is `/markup`, and the data-model field is `markups` —
  none of those change (renaming them would orphan routes/storage). The module accent token is
  **`--accent-review`** (JS mirror `accentReview`), amber **#EF9F27** (B419). Historical names **"Markup"**
  and **"Document Review"** mean this same Review module — don't treat them as separate features.
  Distinct from this: the Site Planner's **"Markup line/rect"** drawing tools are their own thing — leave
  their labels alone.
  - **⚠ UPDATE (B496, 2026-06-27): "Library" is now its OWN top-level workspace, NOT the Review module.**
    The file browser (`FileBrowser`, was Review's landing screen) was lifted into a dedicated **Library** tab
    (`src/workspaces/library/`, internal id `library`, route `#/library`, teal accent `--accent-library`
    **#0E7490** / JS `accentLibrary`). Review is now purely "open one drawing + mark it up" — with nothing
    open it shows a "No drawing open" empty state with a **Browse the Library** button. Clicking a file in
    Library opens it in Review via the existing Shell `onOpenReviewInDocReview` intent. The file-storage
    **data layer (`reviewStore`/`autofiling`/`fileIndex`) stays in `doc-review/lib`** (project-scoped,
    canvas-independent) and Library imports it cross-workspace — no new backend/tables/keys. So pre-B496
    text below that calls `FileBrowser` "the Document Review landing surface" now means the **Library**
    tab. **(B542 update:)** the Site Planner's old slide-over `ProjectFilesDrawer` + its row-1
    **🗂 Files** button were **removed as redundant** once the Library tab shipped — `ProjectFilesDrawer.jsx`
    is deleted and the Library tab is the one and only file browser now.
- **Private by default.** Any future sharing or shared workspaces default to private;
  sharing is always a deliberate, explicit act — never automatic.
- **No cross-customer admin view — amended 2026-08-30 (owner go-ahead), superseded by B711904 /
  B877442.** The original absolute form of this line ("no admin view, do not add one") stopped being
  true in practice once B711904 shipped Michael's own internal operator page and B877442 added a
  section to it — the docs were catching up to reality, not granting new permission. What actually
  holds: an **owner-only internal admin surface** exists at `#/admin` (`src/workspaces/admin/`),
  allowlisted to a single account (Michael's) through `admin_users` + the `is_admin()` SECURITY
  DEFINER RPC — see that workspace's `CLAUDE.md`. It may read **operational** data about how the
  product is running (telemetry / error rows from `client_errors`, feature-request queues like
  B877442's county criteria requests) — never a per-customer support-agent view. It still may **NOT**
  become a cross-customer view of other users' **plans, projects, or files**, and `admin_users` still
  **never** gets a SELECT policy — the zero-policy RLS design (client can't read/write the allowlist
  directly; `is_admin()` is the only door) stays load-bearing. The customer-trust reasoning behind the
  original line is unchanged; only its absoluteness was wrong.
- **Secrets stay in env/secrets, never committed.** Covers Supabase keys, the Autodesk
  APS key, and Google Drive credentials. The Supabase **anon key is RLS-protected and
  safe to ship in the client**; the Supabase **service_role key and all third-party
  API keys must stay server-side only** and never reach the browser.
- **Logged-in users' data lives in the cloud.**
- **Monorepo, one repo, folder per workspace.** The `/server` folder's secrets and
  deploy pipeline are walled off from the public GitHub Pages deploy, so no
  credential can ride along to a live URL.
- **DWG handling (Document Review):** Michael normally receives DWG (and PDF) and will
  not ask consultants for DXF. The tool auto-converts DWG → DXF on the backend. Start
  with free **LibreDWG** + a hard-failure fallback to **Autodesk APS Model Derivative**
  (~$0.30/file, pay-as-you-go). Optional later verification layer (proxy-object
  pre-screen, header/extents sanity checks, embedded-preview diff) decides when to
  pay. Reserve **ODA** (~$6k first yr / $3.6k/yr) or **Apryse** (~$10k+/yr) only for
  high volume or to keep files off third-party clouds. (Pricing mid-2026 — re-verify.)
- **Auto-filing never auto-guesses.** Files matched confidently to one of the 4 named
  projects (via title block + aliases) are auto-routed and auto-named; no-match /
  multi-match / low-confidence files go to a "needs filing" holding area with
  one-click confirm. A misfiled drawing is worse than an unfiled one.
- **Screening fetches: recompute is free, re-fetch is user-action-driven — never map-view-driven
  (B860, chat NEW-1; amends the "explicit request only" fetch rule).** The drainage/floodplain
  "facts pass" has two halves and they behave differently. **Recompute (no network)** — the
  detention / mitigation / pond-split / buildability math over already-held geometry and inputs —
  runs **automatically and live** on every edit off the cached context; pure math never goes stale
  by a click's worth, so there is no "numbers reflect the old boundary" banner and no manual
  re-check for it (changed verdicts flash instead). **Re-fetch (network)** — GIS geometry (flood
  zones, reviewing authority, WSE rasters, 3DEP) — stays **stale-while-revalidate**: serve the
  cached pull instantly, background-refresh only when a **user action** (a boundary/element edit)
  makes the drawn footprint outgrow the fetched envelope (or the cached snapshot ages past its
  TTL), and **always display the data's age** ("flood data 16h ago"). The deliberate amendment:
  fetches remain **user-action-driven** — a boundary edit is a user action — and are **never
  triggered by panning/zooming the map** (map-view-driven fetching stays banned; `mapillary` /
  `evidenceLayers` remain the only view-driven vectors). The pure decision layer is
  `lib/factRevalidation.js` (`revalidationNeed` / `fetchStaleForEdit`); the manual ↻ Re-check is a
  force-refresh of the fetch half only.

## DEFERRED (with reasons — waiting creates no rework debt)
- Per-site sharing, shared team workspaces, and a possible commercial/SaaS direction.
  The selling question reshapes the sharing/workspace model, so design these together
  if/when selling becomes real.
- Planner single-reducer rewrite (state-management refactor) — deliberately deferred.
- AI corridor scan — parked.
- **Rebrand the `planarfit:*` localStorage keys → `planyr:*`** (leftover from the
  Planar_Fit→Planyr rename). Deferred because these are client-side storage keys:
  renaming them in code without a migration would orphan every existing user's saved
  sites/settings. Do it with a one-time read-old → write-new migration so nothing is lost.

## What's not built yet — see `docs/ROADMAP.md`

The two-track roadmap (Site Planner maturation + Document Review buildout) lives in **`docs/ROADMAP.md`**. Read it when planning new feature work.

## KNOWN ISSUES
- Houston utilities ride on the City's `geogimstest` **TEST** host — works, but could
  change without notice.
- Storm-sewer service name still needs confirming once the COH services are up.
- GIS layer status: honest per-layer status + ~45s self-heal re-probe; at last note
  roughly 10 of 14 layers were live.

## Two backends — don't conflate
Two layers that talk **over the network** — one for **data**, one for **compute**. Never
conflate them.

1. **Supabase — the data / auth / storage layer (BUILT).** Cloud Postgres, email/password
   auth, row-level security, and cloud save/load of site data **and** Document Review state
   (the `doc_reviews` table + the `doc-review-files` Storage bucket, same anon client +
   private-by-default RLS). The **frontend talks to Supabase directly with the anon key** —
   which is safe to ship in the browser **because RLS protects it** (a request can only
   ever see/write the signed-in user's own rows). This is the **permanent home for user
   data**; little custom server code.
2. **The server-side compute/integration tier — two delivery shapes, DIFFERENT deploy status.**
   Don't lump them: the **Drive storage backend is LIVE on the edge**; the **heavy CAD/AI compute
   is built in-repo but not yet deployed** to Cloud Run.
   - **✅ LIVE & DEPLOYED — Google Drive storage (bytes I/O).** The storage backend
     (`server/storage/`, B206–B209 / B207) runs **IN same-origin Cloudflare Pages Functions** —
     Drive byte-I/O needs no container, and same-origin means no CORS. It is the one home for
     Document Review source files: **uploads go CHUNKED through `/api/uploads/*`** (B409 rework —
     ~16 MB slices relayed to a Drive resumable session held server-side in `public.upload_sessions`,
     so ANY file size works; no whole-file request ever rides through the Worker) and **downloads
     STREAM through `GET /api/files` with Range→206** so huge PDFs open progressively. The old
     Supabase Storage upload fallback was REMOVED (its 50 MB cap caused silent "oversize" failures;
     pre-cutover files still read back). The Planyr-key↔Drive-file-id map persists in **Supabase Postgres**
     (`server/storage/db/drive_files.sql`, own-row RLS) so the stateless Function can't lose it;
     the queryable **file-facts index** also lives in Supabase (`doc-review/db/file_facts.sql`),
     not Drive. The one-time OAuth *consent* callback is a sibling Pages Function
     (`functions/api/auth/google/*`); `functions/api/drive/selftest.js` is a guarded round-trip
     smoke test. **Provisioned + owner-verified 2026-06-22 in Cloudflare Pages Production:**
     `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` + `PLANYR_STORAGE_BACKEND=drive` + `SUPABASE_URL/ANON_KEY`.
     The chunked path **removes every per-file size ceiling** (Worker body/memory caps + the old
     Supabase 50 MB cap all cleared). **⛔ Do NOT attempt browser-direct-to-Drive uploads** — CORS-dead
     (no readable `Location` header, no ACAO on preflight; refuted 2026-07-11). **⛔ Do NOT re-mint
     `GOOGLE_REFRESH_TOKEN`** — a fresh consent no longer matches the deployed secret and would take
     Drive filing offline.
   - **⏳ Built in-repo, NOT yet deployed — Cloud Run.** Scale-to-zero containers (idle = free; a
     request spins one up) for work that genuinely needs a container or a server-only key:
     - **DWG→DXF conversion** — **LibreDWG** primary (free, native binary compiled into the
       container image), **Autodesk APS Model Derivative** fallback for hard LibreDWG failures
       (dormant behind `APS_ENABLED`, **off** until the APS account is provisioned; a LibreDWG
       failure with APS off returns an explicit error, never a silent success). Code:
       `server/convert/` (B238). LibreDWG needs a real container (native binary + filesystem) —
       exactly why this is Cloud Run and not a Pages Function.
     - **Tier-2 AI auto-filing title-block read** — `server/filing/` (B299): reads a dropped
       drawing's title block with the Claude API (key **server-side only**), matches it to a named
       project (**never auto-guesses**), returns a filing decision + placement facts. Dormant
       behind `ANTHROPIC_API_KEY` / `DOC_FILING_URL` / `VITE_AUTOFILE_ENABLED` (the not-yet-deployed
       proxy `functions/api/file.js` 503s → the drawer files manually, no regression). NOTE:
       **Tier-1 auto-filing (B312, plain code in the browser) is LIVE default-on** — this AI tier is
       only the scanned/image-only fallback.

   **All third-party secrets stay server-side only** — the APS key, the **Anthropic read key**
   (auto-filing), the **Google credentials** (Drive), and the Supabase **service-role** key. They live
   in the Cloudflare Pages env as **encrypted secrets read only by the server-side `functions/api/*`
   handlers** (or on Cloud Run) — **never inlined into the public browser bundle** (never a `VITE_`
   var). The only Supabase key that reaches the frontend is the RLS-protected **anon** key.

So the **data** backend (Supabase) and the **Drive storage** backend (the `functions/api/files.js`
Pages Function) are **LIVE**; the **Cloud Run** compute — DWG→DXF conversion + the Tier-2 AI filing
read — is built in-repo but **not yet deployed**. Keep the **data**, **storage**, and **heavy-compute**
layers distinct when reasoning about what exists.

---

# Technical reference — see `docs/REFERENCE.md`

Deep implementation detail (Site Model schema, map-layer plumbing, Supabase DDL/RLS, Document Review persistence, GIS plumbing, the sandbox Playwright quirk) lives in **`docs/REFERENCE.md`**. Pull it up on demand when you touch that subsystem — you do not need it loaded to orient.
