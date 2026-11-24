# CLAUDE.md — Planyr Project Handoff

The always-loaded core: standing rules, how to talk to Michael, owner constraints, named engineering rules,
workflow. Covers the mature **Site Planner** and the **Document Review** module. Last updated 2026-11-23.

> **🗂 SLIMMED 2026-11-23 (audit batch H, owner-approved). NO RULE WAS REMOVED OR WEAKENED.** Every rule, constraint and
> named rule below is still in force, in one to three sentences with the owner's own words where they define it. The
> long backstory (the incident each rule came from, the measurements, the history) moved **verbatim, nothing deleted**
> into `docs/decisions/<slug>.md` (Site Planner folder notes into `docs/site-planner/`); each entry links its file.
> Each rule carries a stable anchor comment (`<!-- rule:NAME -->`, `<!-- constraint:N -->`) that tests check. **Constraint
> numbers are unchanged** (two duplicated numbers are kept and suffixed: 35a/35b, 41a/41b). **When a rule's text changes,
> change the rule here AND its decision file in the same commit; when you add a rule, add its anchor and its decision file.**
> Mapping of every old section to its new home: `docs/decisions/README.md`.

> **Read on demand (only when the task touches it):** `docs/SHIPPED.md` (shipped-feature history) · `docs/ROADMAP.md` (not built yet) ·
> `docs/REFERENCE.md` (Site Model, layer/GIS plumbing, Supabase DDL/RLS, sandbox Playwright quirk) ·
> `docs/VERIFICATION-TRIAGE-2026-11-11.md` (+ `.json`; sort of every pending `V#`: start here for the verification queue, re-read each item's live text) ·
> `docs/ACTIVE-AREAS.md` (weekly per-county sweep ledger) · **`docs/DATA.md`** (data bible) · **`docs/AGENT-RULES.md`** (verification, measurement and merge rules paid for by real incidents: **read before judging whether any change works**) ·
> `docs/decisions/` (full text behind every rule here) · `docs/site-planner/` (Site Planner folder notes).

## Where to read first (pointers; the full text is in `docs/decisions/`)
- **Ledger (`B#` backlog, `V#` verification) lives on its own git branch `ledger`: records need NO PR and NO build.** Never put a `ledger/` file, `BACKLOG.md` or `VERIFICATION.md` in a PR. Read: `npm run ledger -- list open` (checks the branch out to `.ledger/`, gitignored). Write: `npm run ledger -- add backlog --file entry.md` · `add verification` · `put B123 --file …` · `move B123 verify|done|open` · `mint` · `inbox` · `push`; ids are minted by the push itself (compare-and-swap). Never delete an entry; `done` folders are write-only (`show B123`, never read wholesale). A connector-only chat commits to branch `ledger` (new entries as `ledger/inbox/*.md`); a no-push chat hands the text to a Claude Code session. `ledger-record-check.yml` warnings are an instruction: file the record. Guards `test/ledgerBranch.test.js`, `test/ledgerBranchMode.test.js`. <!--rule:LEDGER-BRANCH--> [full](docs/decisions/ledger-branch.md)
- **⛔ Persistence, sync, undo or delete → read `docs/DATA.md` FIRST** (who owns a fact, the numbered invariants and their tests, the "one-answer" functions such as `isOwnWrite`, `assemblyIntegrity`, `nameAuthority` that must never grow a second implementation). [why](docs/decisions/data-bible-pointer.md)
- **⛔ Notes → read `docs/NOTES-CARRY-FORWARD.md` FIRST** (instrument traps that produced false findings, the one fixture that finds real bugs, storage keys, the standing SQL health check, the bug families to suspect first); a new Notes trap goes in that file in the SAME commit. **Notes editor engine / Tiptap version / paste pipeline → read `docs/notes-editor.md`** (BlockNote swap REJECTED 2026-11-05, B2671191; free-OSS only, one exact `@tiptap/*` version 3.33.0; the clipboard regression bank `ui-audit/verify-notes-paste-bank.mjs` is required: a paste bug becomes a fixture first). [carry-forward](docs/decisions/notes-carry-forward-pointer.md) · [engine](docs/decisions/notes-editor-engine.md)
- **🎨 UI work → read `docs/DESIGN.md` FIRST.** Components consume tokens and the `src/shared/ui/controls.jsx` primitives; a raw hex, `borderRadius` or `fontSize` in a component is a defect (`ui-audit/design-drift-audit.mjs` fails CI); a new control extends the primitive set, it is never invented at the call site; preview at `#/design`. [why](docs/decisions/design-bible-pointer.md)
- **📱 Phone testing → read `docs/PHONE-TESTING.md` FIRST** before ever saying a phone cannot be tested: WebKit runs here (`npx playwright install webkit`, harness `ui-audit/verify-phone-orientations.mjs`). Say "WebKit", never "Safari" or "iPhone", for what a run verified. [why](docs/decisions/phone-testing-pointer.md)
- **🔄 Per-folder `CLAUDE.md` pointers:** rename/move/delete a key file → update that folder's pointer in the SAME commit (`node ui-audit/doc-pointer-audit.mjs`, `test/docPointers.test.js`). Keep pointers short signposts. [why](docs/decisions/folder-pointers.md)
- **🗺 Generated indexes: a branch NEVER touches `MAP.md`, `BACKLOG_OPEN.md`, `docs/UI-INVENTORY.md`** (`scripts/generated-doc-touch-guard.mjs` fails the PR); `regen-derived-docs.yml` refreshes them nightly (as of 2026-11-05 it cannot open its own PR: a session opens one from the newest `chore/regen-derived-docs-*` branch and arms auto-merge). Grep `MAP.md` to find a path or symbol; it may lag a day. The tag-legend rule stays enforced on the ledger. [why](docs/decisions/generated-indexes.md)
- **⛔ Re-running a failed `build` does nothing for a PR that is stale against main (B6867): push a new commit, preferably `git fetch origin main && git merge origin/main`.** [why](docs/decisions/stale-pr-rerun.md) (Id minting history, now retired: [minting-history](docs/decisions/minting-history.md).)

## Standing rules (owner rules; each is binding)
<!--rule:STANDING-RULE-1-->
- **⛔ STANDING RULE #1 — when Michael drops in a problem, FIX IT AND SHIP IT this session. Never log-and-defer (2026-06-19).** A bug report or change request = fix, verify and merge it live this session; the backlog is only for what genuinely cannot be done now (a hard blocker, said plainly). Even "add it to the backlog" means: file it AND fix it. **Finish the WHOLE job**: no diagnosis-only, no band-aid, no half; "bigger/riskier" is a reason to do it carefully, not to defer; a multi-part pick means every part before reporting; several at once → fix them all and flag only a genuinely too-big one with its specific blocker. [full text](docs/decisions/standing-rule-1-fix-and-ship.md)
<!--rule:OWNER-CHAT-BLOCKS-ARE-SHIP-ORDERS-->
- **📥 Owner CHAT BLOCKS are SHIP ORDERS, not filing requests (2026-07-15).** (a) Every item in a chat block (bug, feature, task) is implement-in-THIS-session work: file it, ship it, then park per lifecycle (⏳ Verify + `V###` for a live-verify class); filing alone is an incomplete response. (b) An item that truly cannot ship in one session is flagged LOUDLY in the reply and on the item, never silently filed. (c) A diagnosis/handoff doc with no corresponding `B#` is a protocol violation: mint the `B#` on sight (DEDUPE-FIRST applies). [full text](docs/decisions/owner-chat-blocks-are-ship-orders.md)
<!--rule:STANDING-RULE-2-->
- **⛔ STANDING RULE #2 — NEVER-PARK: AN OWNER-REPORTED SYMPTOM IS NEVER CLOSED ON A NULL (2026-08-08).** A first-hand owner report is evidence; a failed reproduction is not a refutation, and **when instrument and owner disagree the INSTRUMENT is on trial.** Only three dispositions are allowed: **reproduce it and fix it · instrument it so it captures itself · ask him whether it is gone and take his answer**; "not currently reproducible" is a finding, never a disposition. Silent de-prioritisation is the offence (say so in plain words if a tractable item is picked over his); "large, dangerous or vague" is no reason to pick a smaller item; every such item carries a STOPPING RULE when opened; archiving one must name the disposition taken. [full](docs/decisions/standing-rule-2-never-park.md)
<!--rule:STANDING-RULE-3-->
- **⛔ STANDING RULE #3 — ONE TASK PER SESSION; COST PER TASK, NOT MODEL TIER (2026-08-15).** (A) One task per session; take new work only if a fresh session would have to REDISCOVER something this one already knows (a built fixture, harness, repro or rig); a warm container or convenience is never a reason; otherwise tell the dispatcher to open a new session. (B) Stop when done: merged and verified; a session cannot archive itself or any session and never says it did or asks Michael to. (C) Sonnet is the default for implementation; Opus only for a root-cause hunt that already defeated one attempt or contradictory evidence. (D) The brief is the cheapest part: put everything measured, and every approach already ruled out and why, in it. [full text](docs/decisions/standing-rule-3-one-task-per-session.md)
<!--rule:NAMES-ONE-SOURCE-->
- **⛔ NAMES HAVE ONE SOURCE OF TRUTH; NEVER COPY A NAME INTO COMPONENT STATE (2026-09-29, B1934528).** A project's name is its group's authoritative `site`, a plan's is its record's `name`; read them only through `src/shared/names/names.js` (`useProjectName` / `usePlanName`), rename only through `renameProjectChecked` / `renamePlanChecked` (empty name refused, failure shown); derived strings (PDF filename, exhibit title, tab title) are computed at render/export time. Stored copies in other tables (`schedules.linked_site_name`, `doc_reviews.project`) are only the fallback for an unresolvable link; resolve by id at read time (B1991040). Guards: `test/namesSingleSource.test.js`, `test/nameCopiesGuard.test.js`, e2e `names-matrix`. [full text](docs/decisions/names-one-source-of-truth.md)
<!--rule:SHARED-DATA-ONE-SOURCE-->
- **⛔ ALL SHARED DATA HAS ONE SOURCE OF TRUTH; NEVER COPY SHARED DATA INTO COMPONENT STATE (2026-09-29).** Any value more than one surface can change lives in ONE home; readers read it through one selector/subscribe (never a `useState`/`useRef`/module cache seeded once); writers use one function doing a fresh read-modify-write of only the keys changed; a derived value is computed at read time, never persisted beside its source; an intentional snapshot (issued revision, history, export) is labelled. A migration column that could hold a copy must be declared in `scripts/denormalisedCopies.json` (B2064896; `npm run drift-report` after adding or moving a copy); a project's STATUS is read only through `projectModel.groupStatusOf`. Guards: `test/entityStateCopy.test.js` (escape: inline `// stale-ok: <reason>`), `test/denormalisedCopies.test.js`. Inventory: `docs/audit-single-source-of-truth.md`. [full text](docs/decisions/shared-data-one-source-of-truth.md)
- **📋 The BACKLOG (`ledger/backlog/` on the `ledger` branch) is the single source for open bugs and feature requests: keep it lean.** Work the 🔲 Open items; the moment an item ships, `npm run ledger -- move B<id> done` (or `verify`) that same session; new ids come from `ledger add`. [why](docs/decisions/backlog-ledger.md)
<!--rule:THREE-STATE-LIFECYCLE-->
- **⏳ THREE-STATE LIFECYCLE (B645): 🔲 Open → ⏳ Verify → ✅ Done.** `Verify: sandbox` (green build + the right unit/headless test) goes straight to Done. `Verify: live` (timing/race, concurrency/multi-writer, GIS endpoint behaviour, zoom/data-density rendering, PDF/export parity, real-project-data repro) parks in `verify` with a `V###` until a live check confirms it; moving it straight to Done is a protocol violation. A recurrence re-opens the ORIGINAL `B#` (`Recurrence:` line, `(×N)` in the title), never a new number. Every item carries a `Verify:` field and `#tags` from the legend. [full text](docs/decisions/three-state-lifecycle.md)
<!--rule:MERGED-IS-NOT-LIVE-->
- **⛔ MERGED ≠ LIVE (B877, 2026-07-17).** An audit may call a `Verify: live` item "live" ONLY with a PASSED `V###` on record. Report three states, never two: **`🔲 Open/unshipped` · `⏳ merged — V### PENDING` · `✅ live (V### PASSED, dated)`**; "merged" is only ever "merged — live-verify pending". A checker that cannot run the live check says so and reports "merged — V### pending", never green. [full text](docs/decisions/merged-is-not-live.md)
- **🔍 The VERIFICATION ledger (`ledger/verification/`) is the live-browser test checklist: keep it lean.** Scan it every run (`npm run ledger -- list pending --v`), verify due items yourself in a headless browser, and the moment one fully passes `npm run ledger -- move V<id> done --file <text-with-the-dated-PASS>`. The session that ships a UI change drives the live app itself; **Michael does NOT self-test: never wait on him or hand him a test to-do.** [full text](docs/decisions/verification-ledger.md)
<!--rule:SESSIONS-VERIFY-OWN-WORK-->
- **⛔ SESSIONS SIGN IN AND VERIFY THEIR OWN WORK; `Blocker: auth` no longer parks a check (2026-10-04).** A session's own live signed-in check on the test account COUNTS. Use `ui-audit/lib/signedInSession.mjs` (`openSignedIn`; `E2E_LOGIN_KEY`, never printed); **NEVER `--ignore-certificate-errors`**; captcha stays on. Verify a UI change signed in as `e2e@planyr.test` on planyr.io after the deploy, reading `/version.json` and matching your merge commit IN THE SAME CALL. Only `real-data` and external `live-GIS` checks may park. **A session does not end its turn while its own change is merged-but-unverified.** [full](docs/decisions/sessions-verify-their-own-work.md)
<!--rule:COWORK-RECORDS-ITS-OWN-VERIFY-->
- **⛔ A COWORK SESSION RECORDS ITS OWN LIVE VERIFY, DIRECTLY (2026-09-01).** A chat that verifies live on Michael's browser commits the result itself to the ledger branch (see ledger bullet above), not via a relay session. Guardrails: ledgers and docs only, never product code or a workflow file; never hand-edit a generated file (`MAP.md`, `BACKLOG_OPEN.md`); never to `main`; the commit message names the chat and the `V#`/`B#`; record only what was observed. [full text](docs/decisions/cowork-records-its-own-verify.md)
- **📦 The ledger `done` folders are write-only archives:** look up one id with `npm run ledger -- show B123`; never read a folder wholesale. [why](docs/decisions/done-folders-write-only.md)

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

## Owner product constraints — decisions already made, do not relitigate

The section above is about TONE — how to talk to Michael. This section is about BOUNDARIES —
decisions he has already made about what may and may not be built. **It is authoritative over
any dispatch brief.** If a brief asks for something an entry below forbids, the session must
**STOP**: say plainly in its reply that the brief contradicts a standing constraint, name the
constraint, and not build the contradicting part. Do not silently comply and do not silently
skip — say so, every time. A brief is an instruction; this section is a boundary.

Each entry is one constraint — a prohibition or a requirement — with the date Michael set it.
No rationale paragraphs here; a constraint that needs one belongs in a decision doc with a
pointer from its entry. If this list passes roughly 40 entries, split the oldest settled ones
into a `docs/` file and leave pointers, the same way `SHIPPED.md`/`ROADMAP.md`/`REFERENCE.md`
were split out of this file.

**The full text and history of constraint N is `docs/decisions/constraint-N.md`** (35a, 41b, …); each entry below carries `<!--constraint:N-->` for the tests.

<!--constraint:1-->
1. **(2026-09-05) Tasks do not need an owner.** No prompt, nag, required field, default or validation pushes an owner onto a task; an unassigned count is never a number that should come down; setting an owner only has to be reachable and round-trip.
<!--constraint:2-->
2. **(2026-07-18) Never quote measurements, units, pixels, thresholds or zoom factors in chat;** describe what he will SEE (see "How to talk to me").
<!--constraint:3-->
3. **(2026-08-04) A Colorado site may never render a Texas-derived number** (no fallback, no blank reading as zero, no plausible band); an unwired capability shows a named "not available in Colorado yet" state. `coloradoRegions.js`, B1422.
<!--constraint:4-->
4. **(2026-07-29) No rate, volume or elevation is displayed without the rule record behind it;** a missing/malformed record fails LOUDLY and shows nothing (RULES-AS-DATA, B1074).
<!--constraint:5-->
5. **(2026-09-05) Project creation is deliberately LAZY:** never create a `sites` row per abandoned "New project" click; a module's first real write materializes it (B1160480).
<!--constraint:6-->
6. **(2026-09-02) On the cloud-write failure banner ✕ means "I have dealt with it" and forgets the durable log; Retry does not.** Never collapse them (B1037952).
<!--constraint:7-->
7. **(2026-08-22) A live check runs on a throwaway duplicate of a real plan, never a real one;** say exactly what was touched; delete the duplicate when done, without asking (#15).
<!--constraint:8-->
8. **(2026-09-11, re-landed 2026-09-15, live-verify still PENDING) The canvas commits ONE framing per load.** The `framingCommitted` gate once made the canvas invisible on planyr.io for everyone (B1594320 P0); re-landed in PR #1696 (B1574432); `data-planner-reveal` = `"framed"` healthy / `"ceiling"` rescue. **V1145488's signed-in live pass is still owed: re-landed is not verified.** `verify-boot-framing.mjs` is deliberately NOT a required gate yet.
<!--constraint:9-->
9. **(2026-09-07) Split stays a phone-width Schedule option; do not remove it, do not re-ask.** Phone Split shows grid and Gantt at once, stacked; a one-pane Split was rejected three times (B1241745, V930736).
<!--constraint:10-->
10. **(2026-09-19) Site elements stack in CREATION ORDER, newest on top (Bluebeam-style),** reversing the 2026-08-09 type-layer default: "whatever I draw should be at the top so I can never lose anything … you can disregard my previous rule." A selected element lifts above all while selected; existing plans re-stack on first open (accepted). **EXCEPTION (2026-11-05): TRAILER PARKING ALWAYS DRAWS ABOVE ROADS,** render order only (`lib/trailerOverRoads.js`; nothing stored; never widened to other pairs). **trailerOverRoads**, e2e trailer-over-roads, B1788912.
<!--constraint:11-->
11. **(2026-09-23) The two overlay systems converge in CODE ONLY, never in storage:** `sheetOverlays` and `site_plan_overlays` stay separate (no store merge, no migration); crop/georeference/scale/raster have ONE shared engine. **AMENDED 2026-10-08:** a sibling plan's overlay is an OPTION whose eye COPIES it into THIS plan only (`lib/siblingOverlays.js`). B1838705.
<!--constraint:12-->
12. **(2026-09-22) Overlay crop is KEEP-INSIDE only;** no keep-outside/hole-punch, on either surface (B1783328).
<!--constraint:13-->
13. **(2026-10-04) Review opens files in TABS, is BLANK when none are open, and the open tabs FOLLOW HIS ACCOUNT between devices** ("just be blank, and act like bluebeam"); stored in `profiles.prefs` (`reviewTabs`), last change wins; no landing screen, no per-device-only tabs (B2058144).
<!--constraint:14-->
14. **(2026-10-04) On a phone the page keeps its THINNER grey margin;** do not widen it to desktop's; box widths/tables/breaks stay identical (`verify-notes-box-width-parity.mjs`, B2078593).
<!--constraint:15-->
15. **(2026-10-05) Test artifacts are ALWAYS cleared, never asked about** ("stop asking to clear test files, always clr"); verify the delete; never touch his real work; keep the `e2e@planyr.test` fixtures (B2103600).
<!--constraint:16-->
16. **(2026-10-11) Food ratings are one slider each, 1 to 10 in quarter steps;** no tap buttons, steppers or whole numbers without his say-so. One component `components/RatingSlider.jsx`, scale `food/lib/ratingScale.js`, `test/foodRatingSlider.test.js` (B626576).
<!--constraint:17-->
17. **(2026-10-05) In Food on a phone held SIDEWAYS the place card docks RIGHT as a side panel, never the bottom sheet,** and the map keeps the pin in view; `LANDSCAPE_PHONE_QUERY`, `verify-food-landscape.mjs` (B2046224).
<!--constraint:18-->
18. **(2026-10-05) Combine and Split on parcels NEVER ask for a name** ("never block on a name"): auto "Tract A", "<name> · A"; rename is an optional pencil; Undo toast, originals restorable. **The map toolbar and the Parcels panel are ONE action** (`lib/parcelOps.js`, `test/parcelOpsParity.test.js`); the table checkbox only SELECTS, the eye includes/excludes (B2134368).
<!--constraint:19-->
19. **(2026-10-08) Unnamed lots stay unnamed** ("Do not derive a name from street address, owner or legal description"). **AMENDED 2026-10-16:** the LIST shows a stable "Parcel 4" number (`siteModel.parcelNumbers`) or "Acct …"; the name FIELD stays empty (B2194745, B2289936).
<!--constraint:20-->
20. **(2026-10-11) The Parcels list is LAYOUT C and stays calm:** grouped by source with active acres; ONE body-size summary line; names wrap, never ellipsised; a real table with one heading row; padlock and eye on every row all the time, only ⋯ waits for hover; fixed icon seats; the total stays the TRUE dissolved area with overlaps disclosed. Judged on real-shaped data at every width in both themes: `verify-parcel-list-layout.mjs` (required) (B2243424).
<!--constraint:21-->
21. **(2026-10-11) A project's OVERLAYS and COMPS follow the project's sharing; REVIEWS do not (undecided).** Derived by additive SELECT policies (`db/project_follow_sharing.sql`), never by rewriting `team_id` or migrating; unshared stays private; a failed overlay download may never erase the pointer (`lib/overlayHeal.js`) (B2244016).
<!--constraint:22-->
22. **(2026-10-11) The Parcel tools ▾ menu has NO "Remove parcels — click to delete" row.** **AMENDED 2026-10-22 (#31): click-to-delete is retired everywhere** (B2243168).
<!--constraint:23-->
23. **(2026-10-11) Parcel & setback styling is three objects (boundary, setback line, dimension labels), one default + one override, weight in SCREEN PIXELS** (never a zoom factor); resolution override → `profiles.prefs.parcelLook` → built-in; a failed write reverts and says so. **Do not build:** presets, a no-build band, envelope styling, swatch palette, dash picker (B2254144).
<!--constraint:24-->
24. **(2026-10-12) Overlay Lock blocks ONLY a direct map drag/resize/rotate;** everything typed or clicked in a panel works when locked, on BOTH surfaces; a panel control is never gated on `locked`. `test/overlayLockPanelControls.test.js` (B2262864).
<!--constraint:25-->
25. **(2026-10-16) The grading layer is OWNER-ONLY** ("only for me to use for now"): renders only when `is_admin()` through the ONE gate `lib/gradingGate.js`; no flag, env var or second gate; nobody added to `admin_users`; everyone else byte-for-byte unchanged. `test/gradingGate.test.js`; rules in [grading-model](docs/site-planner/grading-model.md) (B2312464).
<!--constraint:26-->
26. **(2026-10-20) The Food restaurant panel is the approved mockup: the DISH LIST IS THE ORDER** ("i like it all as is, send it"). **Do not bring back** the "THE ORDER" card + Copy, "Best dish:", VISITS/COST tiles, Sort, per-row ⋮ or eat-again circle; one rating precision (`restaurantPanel.formatRating`) (B2365312).
<!--constraint:27-->
27. **(2026-10-20) While the Parcels tool is up the parcels are the TOP of the drawing** ("show above anything"): `mapStack.parcelsOnTop`, RENDER ORDER only, nothing stored, no toggle, the PDF/PNG sheet keeps normal order (B2370480).
<!--constraint:28-->
28. **(2026-10-20) In the editable PDF ("Flatten markups" OFF) every drawn site element is an editable annotation** (roads, ponds, paving, parking, trailer parking, sidewalks…) with plain-word Subjects; page content (aerial, parcels, GIS layers, overlays, title block, scale bar, north arrow) stays; anything left printed says why (B2384528).
<!--constraint:29-->
29. **(2026-10-20, amended 2026-10-21) The markup/text-box/callout Properties panel is layout "A": three sections (Text · Appearance · Size & position), same names on every kind,** and it covers measurements and EVERY drawn element's panel. No unit on line weight, opacity is a typed % box never a slider, right-aligned pattern selects, FIXED compact Outline|Fill columns (in the shared primitives). Separately approved panels keep their structure. **calloutPanelLayoutA**, e2e markup-panel-layout-a (B2386752).
<!--constraint:30-->
30. **(2026-10-21) The Overlays panel's ROTATION and CROP are the approved layouts:** round DIAL + typed box + ▲▼ and "Turn 90° counterclockwise/clockwise" in ONE compact row (never "left/right", never − / +); crop is a switch in the CROP heading (off keeps the shape; one reset = clear the polygon). Work on a locked overlay (#24). **rotationDial**, **overlayCropOff** (B2400416).
<!--constraint:31-->
31. **(2026-10-22) Parcel delete is ONE path, ONE menu, with Undo, and a locked parcel deletes like any other:** every door ends in `deleteParcels` (`lib/parcelDelete.js`), deletes AT ONCE with an Undo toast and tombstone, no confirm step, Lock never blocks Delete; one menu `lib/parcelMenu.js`; a map right-click never ticks the checkbox. `test/parcelDeleteOnePath.test.js` (B2416672).
<!--constraint:32-->
32. **(2026-10-22) Google Earth (KMZ) export of a SITE PLAN lives in the Site Planner's File ▾ ONLY;** no right-click KMZ on the canvas and none on the empty Map view (a site/comp "Export KMZ", B711329, is a different feature). **fileMenuKmz** (B2380112).
<!--constraint:33-->
33. **(2026-10-21) The editable PDF raises NO hover note box:** no `/Contents` unless a person typed it, no annotation titled "Planyr", no `/Popup`; a translucent measurement fill is never `/IC`. `test/pdfHoverAndRegen.test.js` (B2431296).
<!--constraint:35a-->
35a. **(2026-10-22) The Overlays panel carries NO "Non-standard sheet" note, and Set scale is a Preset | Custom switch where Custom means TYPING the scale** (one short box `1" = [ 40 ] '`; unreadable text kept and flagged; no unit dropdowns). **overlaysPanelRender**, **overlayScale** (B2382049).
<!--constraint:34-->
34. **(2026-10-21) A county with no parcel data says WHY and gives a one-click request,** never the bare "no parcel data wired here yet": four reasons (paywall · locked · unreachable · none) from `lib/parcelGaps.js` + "Email Michael to request it". **michael@planyr.io is public in exactly TWO places;** a third is a new decision (`test/publicContactAddresses.test.js`) (B2428112).
<!--constraint:35b-->
35b. **(2026-10-20) A Notes box shows the MOVE cursor wherever a press really moves it** (a cursor must never lie); open hand only for panning. **AMENDED 2026-10-27 (#37):** the grip is retired, the border is the handle. `move` shows only on a multi-selection member. `test/cursorConventionNotes.test.js` (B2426784).
<!--constraint:36-->
36. **(2026-10-23) A Schedule row-drag has THREE zones and the centre one NESTS** (amends B763472). **The centre zone stays the SMALLEST (30% vs 35/35), never the default;** a dragged row's own centre says "Not allowed"; a new parent is toasted and Ctrl+Z restores it. `rowDropIntent`, `test/scheduleDropNest.test.js` (B2445008).
<!--constraint:37-->
37. **(2026-10-27) A Notes box is moved by its BORDER; the striped grip is retired, do not bring it back or add a second affordance** ("only interacts by the edges"); a middle drag still pans (B2156912). `verify-notes-box-edge.mjs` (B2426788).
<!--constraint:38-->
38. **(2026-10-28) CITY LIMITS OUTRANK ANY ETJ HIT** everywhere (header, Site Analysis, floodplain administrator, ETJ layer): never a city AND another city's ETJ for the same ground ("it can't be both"); a genuine straddle shows the split (B2472944).
<!--constraint:39-->
39. **(2026-10-28) A county's own parcel server is the PRIMARY; when it does not answer DEFAULT TO THE STATE'S LAYER, and never say "No lot here" for a silent county.** Re-check a "down" county for a MOVED server first; `lib/parcelFallbacks.js`; say where the lot came from; a county that answered "no lot" is never second-guessed; measure a new source (B2475216).
<!--constraint:40-->
40. **(2026-10-29) A county row that is a COPY someone else published is KEPT, and the parcel card SAYS so** (publisher + data date, "not the county's own", the one mailto; never guess a date). `test/parcelCopies.test.js` (B2487152).
<!--constraint:41a-->
41a. **(2026-10-29) Every county sits in the state-plane zone its STATE'S STATUTE assigns, no legacy exceptions** (Montgomery County TX = Texas Central, EPSG:2277); `decided:true` only where the statute is silent, with a `decisionNote`; statute beats the EPSG table. `test/statePlaneStatute.test.js` (B2478961).
<!--constraint:41b-->
41b. **(2026-10-29) DeSoto County zoning is real polygons, Olive Branch included, labelled by the jurisdiction the SITE falls in;** never a PDF link, never labelled by layer; do not build an Olive Branch PDF fallback (B2507058).
<!--constraint:42-->
42. **(2026-10-29) EVERY overlay layer starts at 100% opacity when first turned on** (`layers.js`; tier ceilings in `layerWeight.js` are all 1); a user-set opacity is kept; no lower default without a new decision. `test/layerHierarchy.test.js` (B2507060).
<!--constraint:43-->
43. **(2026-10-29) Map layers show their information ONLY ON CLICK: no hover popups on any overlay layer,** on both surfaces; permanent labels, pin name tooltips and the elevation chip stay (B2507061).
<!--constraint:44-->
44. **(2026-10-29) The "Discover DeSoto — I-269 Corridor Study Areas" layer is REMOVED and not to be re-added.** Every esri feature layer passes a DRAW BUDGET (`layerRequest.FEATURE_VERTEX_BUDGET`); `test/layerDrawBudget.test.js` (B2507064).
<!--constraint:45-->
45. **(2026-10-29) A layer's click card is CLEAN:** plain labels, no raw field names, no empty rows, short labelled links never raw URLs, source behind the (i), on every layer (B2507062).
<!--constraint:46-->
46. **(2026-10-29) A zoning code shows its district NAME wherever shown to a user, sourced per jurisdiction from its own ordinance, NEVER from memory;** unsourced shows bare; on-map labels stay codes (B2507063).
<!--constraint:47-->
47. **(2026-10-29, amended 2026-11-05) Counties & Cities is ONE clean display everywhere wired:** every city/ETJ/county name on screen at every zoom, each city its OWN hue (`lib/boundaryPaint.js`), a CLICK anywhere in a shape opens ONE card (`lib/jurisdictionCard.js`), never hover, ⚑ on a site crossing a limit line. Do not shorten the label zoom range, share a colour, or split the card. **countiesCitiesNaming** (B2507065).
<!--constraint:48-->
48. **(2026-10-29) A road connected to a parking field or truck court FOLLOWS it on a small move and LETS GO on a big one** ("200 feet, forget the road … 50 feet, keep it attached"): last control point only, `DRIVE_FOLLOW_MAX_FT` (100 ft), a locked road never follows, one undo; no prompt or toggle (`lib/driveFollow.js`; **driveFollow**; B2498961).
<!--constraint:49-->
49. **(2026-10-29) The Spreadsheet follows Excel for Windows, and its headers are LABELS** ("muscle memory is the spec"): never editable; **Ctrl+C/X/V use the REAL system clipboard**; refused/unusable paste says so; Ctrl+K stays the palette; multi-range ops say Excel's "won't work on multiple selections" (`lib/keymap.js`; B2455072).
<!--constraint:50-->
50. **(2026-11-02) A ZONING layer prints its district code on every polygon, and its legend is HEADED by the jurisdiction with ONE code per row** (`viewLegend` `{ heading: true }` then `{ row: true }`; sourced names; no "(Olive Branch)" suffix). **sugarLandZoning** (B2638208).
<!--constraint:51-->
51. **(2026-11-03) The Task Report toolbar is Filter · Group by · Show · Columns and the Status segmented control is RETIRED;** no Apply button, no second status classification. **taskReportStatusFilter** (B2639169).
<!--constraint:52-->
52. **(2026-11-04) The plan menu is the approved mockup: the current plan is ONE row and IS the rename control; no Storage dialog, no Save now row, no Plan name field, no per-row ✕.** One ⋯/right-click menu; Recently deleted is a bin view. **planMenuChrome**, **planMenuModel** (B2660320).
<!--constraint:53-->
53. **(2026-11-06) Ctrl/Cmd+wheel over the Schedule ZOOMS THE SCHEDULE, never the browser page** ("always work if im hovering over the schedule"), with NO permanent blocking wheel listener (measured +15 ms per notch, B2671192); modifier learned from keys/pointer events/shell forwarding. `test/scheduleCtrlZoomHover.test.js` (B2671192).
<!--constraint:54-->
54. **(2026-11-08) The sign-in panel closes ONLY when the person asked** (Close, an unhandled Escape on the card, press AND release on the backdrop, successful sign-in); every close/unmount path is in `src/shared/auth/panelDismiss.js`; the set-new-password view stays non-dismissable. `test/authPanelClosePaths.test.js` (NEW-1).
<!--constraint:55-->
55. **(2026-11-10) Where two roads of DIFFERENT widths meet, the WIDER road tapers into the narrower one, and that is the whole feature;** curb returns, snap-and-merge and per-end widths were NOT chosen. Derived (`lib/roadTaper.js`), stored only as `road.taper`; no bend warning. **roadTaper** (NEW-1).
<!--constraint:56-->
56. **(2026-11-13) While a Measure tool is armed a left press is ALWAYS a point; an existing measurement never eats it** (amends B910); pick a measurement in Select or by right-click. e2e **measure-first-click** (B2671280).
<!--constraint:57-->
57. **(2026-11-15) Notes boxes the person PLACES may overlap, like PowerPoint; only growth from a box's OWN WORDS pushes the box below clear** (`notesBoxClearPlugin.js` `placedBetween`); no snap or warning. **notesBoxClear** (B2671289).
<!--constraint:58-->
58. **(2026-11-15) In Notes, copying a BOX and copying TEXT are different and must be obvious, Excel's way:** box selected + Ctrl+C = moving dashed outline and a NEW box on paste; any text selection (incl. Ctrl+A in a box) copies TEXT ONLY. **notesBoxClipboard**, `verify-notes-box-copy` (required) (B2671288).
<!--constraint:59-->
59. **(2026-11-15) In Notes Ctrl+A belongs to the thing you are in:** caret in a box = that box's text; table cell steps outward; no caret = EVERY box; one handler (`lib/notesSelectAll.js`). **notesSelectAll**, `verify-notes-select-all` (required) (B2671293).
<!--constraint:60-->
60. **(2026-10-19/22, B2331664) Adding lots from the county NEVER auto-zooms, and county lot lines draw from FURTHER OUT, hiding only house-size lots** (`parcelWideLayer.js`, both surfaces, never a click-a-lot layer without `wide: true`; **addLotsOutlineZoom**).
<!--constraint:61-->
61. **(2026-11-24) An UNFILLED, UNHATCHED shape is clickable ONLY on its visible outline, and the click passes through to what is beneath** ("if something has no fill or hatch I shouldn't be able to click on it where fill / hatch would be, only on its visible part"). Any visible fill (however faint) or hatch keeps the interior clickable; hover and right-click follow the same rule; **locking no longer changes it** (supersedes the 2026-09-07 "or unlocked" interior grab, B920/NEW-1). One rule: `grabsWholeBody` (`lib/markupPick.js`), `measureGrabsInterior` (`lib/measureHit.js`); the canvas sets `pointerEvents` off the same predicates. `test/markupPick.test.js`, `test/measureHit.test.js` (B2671319).
<!--constraint:62-->
62. **(2026-11-24) The Dashboard is OWNER-ONLY** ("get rid of the dashboard for everyone else but me"): gated by the SAME `is_admin()` answer as the admin page (`useIsAdmin`, no new flag, no hardcoded email) through `src/shared/ui/dashboardAccess.js`; anyone else never sees it in the wordmark, breadcrumb root ("Map" instead), "Go to Dashboard" buttons, `#/` or `#/dashboard` (redirect to the Map, `#/site`), and the Dashboard never mounts, so no card data is fetched. Fails closed. `test/dashboardOwnerOnly.test.js`
<!--constraint:63-->
63. **(2026-11-24) A parking or trailer field drawn over a road keeps its full rectangle and TRACES the road** ("curve off and trace the road … a proper design"): only WHOLE stalls, every kept stall REACHABLE from an aisle (no "no way to get into" stalls), a CONNECTING AISLE where the road blocks the aisles, the road's RIGHT-OF-WAY counts as road, and parking KEEPS BACK from a road ("never really be like right against the roads … overhang"): a property of the ROAD, per class in Standards → Roads, overridable per road, drive aisles none. Derived, never stored (`lib/parkingRoadTrim.js`); drawing, count, Yield and PDF read one answer. `test/parkingRoadTrim.test.js` (B2671336).

## Grading model (owner-only; constraint #25)
The full owner rules, rounds 4 to 10, the panel layout, "grade only what the layout needs", the 3D viewer, Fit the biggest building and the drive tie-in rule moved verbatim to **`docs/site-planner/grading-model.md`** (read it before touching grading). The rules that must never be lost: grading renders only when `is_admin()` is true through the ONE gate `lib/gradingGate.js` (#25); per plan, OFF by default; **the app's limit is ALWAYS the layout's own outline and "Limits of disturbance" is a FENCE, not a target (B2655792, 2026-11-04)**; there is exactly ONE limit object (round 9); never grade work in a React render; a drive ties into the road's grade at the property line (B2671228); the "Access and drive grading are OUT OF SCOPE" line was retracted and must not be restored. Code and guards: `src/workspaces/site-planner/CLAUDE.md` and [grading.md](docs/site-planner/grading.md).

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
Few, deliberate runtime deps. **No new dependency for "open an uploaded Excel in Spreadsheet"** (reuses ExcelJS, `fflate`, `xlsx` read client-side for old `.xls` only in the lazy parse worker). **`three` is pinned `0.170.0` exact and loaded ONLY by `lib/grading3d/threeScene.js` → the lazy `Grading3DViewer` chunk** (never statically import it; test **grading3dGate**, `node ui-audit/verify-grading-3d-bundle.mjs`). **`dxf-parser`** is parse-only, runs in the DXF worker behind a lazy `import()`. [full text](docs/decisions/dependency-notes.md)

## Workflow & deploy (operative rules; history in [docs/decisions/workflow-and-deploy.md](docs/decisions/workflow-and-deploy.md))
<!--rule:WORKFLOW-DEPLOY-->
- **`main` is protected, always working, deployed. No direct commits.** Branch per workstream (`doc-review/<feature>`, `site-planner/<feature>`), merge `main` in often, land work by PR with the required `build` check green; the deploy job is gated to `main`.
- **"Commit" means take it LIVE, the whole chain, no stopping, no asking:** commit → push → open the PR → mark it ready → arm auto-merge → babysit to `merged:true`. The only acceptable stop is a hard blocker (conflict, red required check, rejecting protection); report that, not a request for permission.
- **⛔ The harness defaults new PRs to DRAFT; that does NOT apply here. The session that opens the PR marks it ready and arms the merge, every time, by hand** (`update_pull_request` `draft:false`, then `enable_pr_auto_merge`). The sanctioned way to ask Michael to look first is the `hold` label or a `<!-- keep-draft -->` marker in the PR body, which the session checks on its OWN PR before un-drafting. `pr-auto-ready.yml` is deleted and does not come back without a fresh explicit owner go-ahead; if drafts park again the fix is a read-only detector, never a mutating actuator or a PAT. History B781760 → B934401.
- **⛔ After ANY change to a PR title (every renumber), DISABLE AND RE-ENABLE auto-merge**: GitHub freezes the squash message when auto-merge is armed (B225984). No machine guard exists, deliberately.
- **The required `build` check often does not auto-start on a PR opened via MCP: un-stick it yourself, never hand it to Michael.** Check `mergeable_state` FIRST (`dirty` swallows every nudge: merge `origin/main`); read the CHECK RUN (`pull_request_read get_check_runs`), not the commit-status API (`total_count: 0` is normal); nudge on the absence of a RUN only, preferably by `git fetch origin main && git merge origin/main` rather than an empty commit; verify a run appeared and nudge again if not; poll every ~150 s while a PR is open (webhooks do not deliver CI transitions). The "automation app token suppresses triggers" explanation is UNVERIFIED: do not restate it as fact.
- **⛔ Before pushing a fix for a CI failure run `npm run ci-parity`** (never approximate CI by hand; `--list` shows gate order; `--lane <name> [--shard i/n]`; reads `.github/ci-gates.yml`, the one gate list). `build` is an aggregator over parallel lanes (`detect`, `static`, `vitest` ×3, `build-app`, `browser` ×4); the required name is still exactly `build`. Only five `verify-notes-*` gates are required (`REQUIRED_NOTES_GATES` in `ui-audit/lib/ciGates.mjs`); the other 13 run nightly / on demand / on Notes PRs as lane `notes-extra` (`notes-gates.yml`, NOT required, so a red nightly is "go look"); never call a moved gate "a required build step".
- **Deploy = Cloudflare Pages (planyr.io); GitHub Actions only runs the build check.** `functions/` (repo root) is the Pages Functions directory and deploys with every build (`functions/gis-proxy/` allow-list `ALLOWED_HOSTS`: add a host there before wiring a county through it).
- **⛔ A live measurement on planyr.io is only valid if the DEPLOYED CHUNK HASH is read in the SAME call as the assertion** (a tab can silently serve a pre-deploy bundle; one tab's fresh reading never vouches for another).
- Per-branch preview URLs are an optional Cloudflare concern, separate from PR status checks. End commit messages with the session link the harness provides; no model identifier in commits, PRs or code.

## Engineering rules (invoke by name) + Definition of Done (B649)
A chat brief may name a rule ("apply PDF-PARITY, LOUD-FAILURE"): treat it as if its full text were pasted. Named rules are binding shorthand. Each carries `<!--rule:NAME-->`; **the full text, incident evidence and clauses of a named rule are in `docs/decisions/<name-lowercased>.md`** (e.g. `docs/decisions/loud-failure.md`).

<!--rule:LOUD-FAILURE-->
- **LOUD-FAILURE** — No silent failure path: every write/fetch/parse that can fail surfaces visibly (banner, telemetry, thrown error), never a swallowed `catch` that reads as success; crash loudly over degrading quietly (B209/B595/B610).
<!--rule:AUDIT-FIRST-->
- **AUDIT-FIRST** — Before patching, instrument and reconcile prior `B#` claims against the ACTUAL code; where they disagree, record the code reality and flag the discrepancy.
<!--rule:PDF-PARITY-->
- **PDF-PARITY** — Any on-screen render change is mirrored and verified in the export/print path and vice-versa (Scheduler `GanttView` ↔ `buildGanttSVG`; Site Planner canvas ↔ PDF/print). A mandatory LIVE-VERIFY class.
<!--rule:MODULE-SCOPE-COMPONENTS-->
- **MODULE-SCOPE-COMPONENTS** — Define React components at module scope, never inside another component's render body (remount, focus loss, lost input state).
<!--rule:VIEWPORT-STABLE-->
- **VIEWPORT-STABLE** — A panel/rail/divider toggle that changes a render surface's width or edge must neither JUMP nor FLASH: (a) compensate against the MEASURED delta in a `useLayoutEffect` (real DOM edge, never an assumed width or a passive effect); (b) buffer the surface (ghost) across any resize-driven re-layout/re-raster. Precedents B837, B65, B838.
<!--rule:CHROME-NEVER-EATS-A-PRESS-->
- **CHROME-NEVER-EATS-A-PRESS** — Anything painted ABOVE content that stops propagation must be GATED on its own object being selected or FORWARD the press to `isDoubleTap` keyed on the UNDERLYING feature (one key per feature). Handles and `data-chrome` are identity-transparent at the resolver but keep their own press; while a double-click is in flight the feature press 1 selected WINS the hit test; probe the TWO-PRESS INVARIANT (press once, re-ask what a double-click there addresses); when a double-click "does nothing" check the CLOCK and TARGET first. Guards e2e **chrome-swallows-press**, `audit-doubleclick-properties`.
<!--rule:FOREGROUND-OR-VOID-->
- **FOREGROUND-OR-VOID** — A background tab cannot be measured (clock or pixels). Every browser-driving harness asserts `document.visibilityState === "visible"` plus a rAF-liveness probe BEFORE measuring and fails loudly otherwise (`ui-audit/lib/tabTiming.mjs` `assertMeasurable`, `pacedWait`; `test/tabTiming.test.js` requires it of every Chromium harness). Gate diagnostics at CALL time (`?planyrDiag=1`), read-only; never probe between the two presses of a double-click.
<!--rule:DRIVER-SCROLL-IS-NOT-APP-SCROLL-->
- **DRIVER-SCROLL-IS-NOT-APP-SCROLL** — A driver's actionability scroll cannot be used to measure scroll: in a virtualised list click only what a human could see (`ui-audit/lib/visibleClick.mjs`; "programmatic scroll writes: 0" is the tell). And every probe carries an arm whose answer is KNOWN independently and must report it; a harness with only unknown arms is vacuous and says so.
<!--rule:COUNT-EVERY-KIND-->
- **COUNT-EVERY-KIND** — A plan's contents are its five drawn kinds (el · markup · measure · callout · parcel); a count of `[data-el-id]` sees one. Count DISTINCT `data-feature` keys via `ui-audit/lib/featureCensus.mjs`; when a count says nothing happened but the app says it did, Ctrl+Z and diff the feature list. Guards: `test/featureCensus.test.js`, e2e **feature-census**.
<!--rule:NO-ONE-OWNS-A-COMPOSITE-->
- **NO-ONE-OWNS-A-COMPOSITE** — A surface built from several objects (dissolved region, merged outline, cached raster) is owned by none, so no per-object predicate or census reaches it: when adding any per-object hide/exclusion, find the composites that read it and **invalidate them EXPLICITLY**; **THE GUARD IS INK OR PIXELS, NEVER REGISTRATIONS** (`ui-audit/lib/inkCensus.mjs`). Instances B3296, B494050, B503184. `test/compositeSurfaceRule.test.js`, **contentVisibility**, **hiddenContentReads**.
<!--rule:SYNTHETIC-KEYS-DONT-EDIT-->
- **SYNTHETIC-KEYS-DONT-EDIT** — A synthetic keystroke does not mutate the plan (the key handler is on `window`; `new KeyboardEvent` defaults `bubbles:false`). Use real key input or the Delete control, RE-READ until the feature is absent, then reload and confirm. Only driver: `ui-audit/lib/deleteFeature.mjs`; `test/deleteDrive.test.js`.
<!--rule:PERCEPTUAL-PARITY-->
- **PERCEPTUAL-PARITY** — A picture change must be imperceptible at working zoom (2026-08-06), measured as CIEDE2000 on an acuity-filtered pair: **detail ΔE00 ≤ 6.0 · perceived ≤ 1.0 · perceived frame-mean ≤ 0.10**, chosen BEFORE the measurement, never nudged; record before/after crops in the PR (`ui-audit/verify-perceptual-parity.mjs`, `test/perceptualParity.test.js`).
<!--rule:WRONG-CASE-->
- **WRONG-CASE** — When a user says a feature "never works" and it works in your case, you tested the wrong case: write down what differs in the reporter's scene before writing the fixture; a harness for a reported symptom carries a PRECONDITION that refuses to score unless that configuration is present; every `V###` states a closure condition someone other than the owner can meet (`test/verificationClosability.test.js`).
<!--rule:DEDUPE-FIRST-->
- **DEDUPE-FIRST** — Search Open, ⏳ Verify AND Done (`^### B` headings, `#tags`, symbols; grep `BACKLOG_OPEN.md` for the live set) before minting a `B#`; a match gets the recurrence treatment, never a fresh number; mint with `ledger add`.
<!--rule:TOMBSTONE-DELETES-->
- **TOMBSTONE-DELETES** — Every removal path records tombstones for its FULL cascade set before the next flush, so a merge/sync cannot resurrect the item or raise a false conflict (B276/B556/B596/B612).
<!--rule:TIER-BY-REBUILDABILITY-->
- **TIER-BY-REBUILDABILITY** — User work and re-fetchable cache NEVER share a storage tier: re-fetchable data goes in IndexedDB (own budget), localStorage (~5 MB) is for irreplaceable work only; never sum the tiers. No eviction may cost unrebuildable data: every reclaimable class declares a rehydration source in `shared/storage/storageCensus.js`, only `storageReclaim.js` acts on them (B1427). **storageReclaim**, **gisCache**.
<!--rule:ROWS-CANONICAL-ON-SEED-->
- **ROWS-CANONICAL-ON-SEED** — When a plan opens, for an element the server ALREADY HAS the `site_elements` rows win unless a pending local op explains the difference; for an element the server has NEVER seen, local wins. `reconcile(collections, { afterSeed: true })` adopts rows via `onRowsCanonical`; the bonded heal runs AFTER the journal/never-synced folds in `refetchReplace`; never re-order those two (B1113).
<!--rule:DANGEROUS-MEANS-UNOBSERVABLE-->
- **DANGEROUS-MEANS-UNOBSERVABLE** — "Dangerous" is never a reason to avoid work: name the specific observation no guard can make, build that instrument and prove it goes RED on a deliberately wrong build, then do the work; if it cannot be built that is the honest blocker. Irreversible/destructive actions and real product decisions still stop for the owner (2026-08-08, B1449).
<!--rule:LIVE-VERIFY-->
- **LIVE-VERIFY** — Timing/race, concurrency/multi-writer, GIS endpoint behaviour, zoom- or density-dependent rendering, PDF/export parity and anything citing real project data file `Verify: live` and park in ⏳ Verify until seen working; each class maps to at least one e2e spec.
<!--rule:EDITOR-EXIT-CONTRACT-->
- **EDITOR-EXIT-CONTRACT** — Every way out of an editor keeps what the editor shows as FINISHED; a hybrid is the bug. Three classes: **text** (Enter/Tab/click-away COMMIT, Escape abandons the typed text) · **select** (CHOOSING is the commit; every exit closes the menu) · **tokens** (every token is written through the instant it is added/removed/reordered; every exit merely closes). The reported key is never the scope: audit all four exits on every editor. Guards: `ui-audit/verify-cell-editor-exit-contract.mjs`, `test/cellEditorExitContract.test.js`.
<!--rule:PANEL-BREVITY-->
- **PANEL-BREVITY** — "Less is better" (2026-07-28): verdict + number first, at most ONE short line per group, the rest behind the group's `Assumptions & method ▸`; new copy REPLACES (name the sentence removed); prefer a named state to a sentence; numbers over prose; never the same sentence twice; honesty stays reachable, never bought with accuracy; report visible line + character count before/after. Enforced by `node ui-audit/panel-copy-budget.mjs --check` against `ui-audit/panel-copy-budget.json`, `test/panelBrevity.test.js`.
<!--rule:VIEW-INDEPENDENT-ONCE-->
- **VIEW-INDEPENDENT-ONCE** — Work whose inputs are MODEL + SETTINGS must not be recomputed because the VIEW moved; a memo key may never contain a view term unless the value is genuinely view-derived, and then only the scalar it uses (`view.ppf`). Latch approximate view values (`viewCull.cullRectFor`), use `site-planner/lib/pureCache.js` for pure leaves; never propose a screenshot as the guard. Detector `ui-audit/detect-view-recompute.mjs`, gate `ui-audit/verify-view-independent.mjs` (`npm run perf:viewindep`), `test/viewIndependentRegistry.test.js`.
<!--rule:NO-PER-MOVE-WORK-->
- **NO-PER-MOVE-WORK** — No feature may add per-pointer-move work to the planner: a pan move, wheel-zoom step or drag move rebuilds no grading surface, posts no worker job, re-encodes no picture and commits React about once per move; whatever a gesture changes is rebuilt ONCE at release. Budgets in `ui-audit/planner-perf-budget.json` (pan ≤ 16 ms/move; the open and mode-switch budgets are ratcheted, not yet met). Gate `node ui-audit/verify-planner-perf.mjs --counts` (required); timings `npm run perf:planner` before shipping render/grading changes.
<!--rule:NO-RETRYABLE-ERRCODE-->
- **NO-RETRYABLE-ERRCODE** — No SQL function may raise errcode `40001` or `40P01` (PostgREST retries them forever and took planyr.io down on 2026-10-11); a business-rule refusal uses a custom code (`PT409`). Guard `test/noRetryableErrcode.test.js`.
<!--rule:CONSTRAINT-CAPTURE-->
- **CONSTRAINT-CAPTURE** — When Michael states or corrects a product constraint in chat, the session that hears it writes it into `## Owner product constraints` IN THE SAME SESSION, before the work it was dispatched for (2026-09-05). Before opening a PR, confirm nothing built contradicts the constraints and say so.
<!--rule:ONE-SHELL-ONE-TOOLBAR-ONE-SWEEP-->
- **ONE SHELL, ONE TOOLBAR, ONE SWEEP** (2026-10-05, "I want the frame to always work regardless of the size of computer or screen") — Browser zoom and OS scaling shrink the CSS viewport. Any new header/tab-row/toolbar control goes through the shared shell: `AppHeader` rows never wrap, every action row is a `PriorityToolbar` (`src/shared/ui/PriorityToolbar.jsx`, `toolbarPlan.js`: labels drop to icons, then low-priority items fold into More; declare each item's `priority`; no per-module media query or hard-coded chrome width; ResizeObserver on the element's own box). The width sweep `ui-audit/verify-width-sweep.mjs` is a required gate: a NEW MODULE ROUTE MUST BE ADDED to its `ROUTES`, and an intentionally scrolling strip says why with `data-sweep-exempt="<reason>"`; a control owning a shared ref or portaled menu honours `render({ measuring })`.

### Definition of Done (every item)
1. **Implemented** — the whole job, including the hard / real part (STANDING RULE #1). No diagnosis-only.
2. **Unit tests** for any pure library touched.
3. Every **applicable named rule** above is satisfied.
4. **No contradiction with `## Owner product constraints`.** Before opening a PR, confirm nothing
   built in this item contradicts a listed constraint, and say so in the session reply. If a
   contradiction was caught, **CONSTRAINT-CAPTURE** governs — the offending part is not built, and
   the reply names the constraint it collided with.
5. The backlog entry filed/moved **on the `ledger` branch with `npm run ledger -- add|move|put`** (see the LEDGER section — no PR, never a `ledger/` file in your diff, never `BACKLOG.md`). **Do NOT regenerate or commit `BACKLOG_OPEN.md` yourself** — the Generated-
   index touch guard rejects a PR that touches it (NEW-1, B<PENDING>, 2026-09-08); it's refreshed by
   `.github/workflows/regen-derived-docs.yml` instead. Touched yield / pond panel copy?
   **PANEL-BREVITY** applies: run `node ui-audit/panel-copy-budget.mjs` before and after, and put
   both numbers on the item.
6. **Do NOT regenerate or commit `MAP.md`** even if files were added/removed/renamed or a primary
   export changed — same guard, same reason, same replacement job.
7. The `Verify:` field is honoured — a sandbox note appended (→ Done), or the item parked in `## ⏳ Verify`
   with the pending live steps **and** a `V###` logged in `VERIFICATION.md`.
8. **Committed and merged** ("commit" = shipped live via PR + merge — see Workflow & deploy).

## What's already built — see `docs/SHIPPED.md`

The full catalog of shipped-and-verified work (Site Planner, Supabase backend, multi-workspace foundation, Document Review) lives in **`docs/SHIPPED.md`**. Read it only when you need the history of a specific feature — it is not needed to orient.

## KEY DECISIONS (must persist; full text in `docs/decisions/key-decision-*.md`)
<!--rule:KEY-DECISIONS-->
- **Theming: Light / Dark / System (2026-06-21).** `data-theme` on `<html>` + CSS tokens in `src/index.css`, mirrored for SVG/canvas in `src/shared/theme/palette.js` (keep in sync). Chrome themes WITH the app; build hierarchy through weight, size and uppercase letter-spacing, NEVER by fading text; low-contrast gray body text is disallowed; new UI uses tokens never raw hex and clears WCAG AA 4.5:1 in both themes (`ui-audit/contrast-audit.mjs`, `test/contrast.test.js`); text on the accent fill uses `--on-accent`, saving/unsaved/offline labels `--warn-text`. The picker lives in the row-1 Settings gear. [full](docs/decisions/key-decision-theming.md)
- **Project-status palette + map markers (B433/B434; source `src/shared/ui/statusTokens.js`).** Markers are always solid-filled with a white keyline (precision pin `sitePinIcon`), never hollow; salience is MONOTONIC Pursuit loudest → Dead quietest, never inverted; RED is reserved for genuine alert/error (Dead is neutral gray ✕ + strike, Active blue, Pursuit coral; colorblind glyphs only on settled stages). [full](docs/decisions/key-decision-project-status.md)
- **No dialog-box edits (2026-06-17):** never `window.prompt/confirm/alert`; edit in place with an inline editor (`numEdit`, the callout `foreignObject` textarea); commit on Enter/click-away, cancel on Esc. [full](docs/decisions/key-decision-no-dialog-box.md)
- **Brand spelling: Planyr (P-L-A-N-Y-R)** in human text, lowercase `planyr` in identifiers; Michael's "Planner"/"Planner Fit" means the brand Planyr (and the old Planar_Fit). Never reintroduce "Planner"/"Planar" as the brand. [full](docs/decisions/key-decision-brand-spelling.md)
- **Module naming (B418, 2026-06-23):** the Document Review workspace is user-facing **"Review"** (internal id `doc-review`, folder, route `/markup` and the `markups` field do not change; accent `--accent-review` #EF9F27). **"Library" is its own top-level workspace** (B496, `src/workspaces/library/`, route `#/library`, `--accent-library` #0E7490); the file-storage data layer stays in `doc-review/lib`; the Site Planner's old Files drawer is gone (B542). "Markup"/"Document Review" in old text mean Review. [full](docs/decisions/key-decision-module-naming.md)
- **Private by default:** sharing is always a deliberate, explicit act. **No cross-customer admin view** (amended 2026-08-30): the owner-only `#/admin` surface (allowlist `admin_users` via `is_admin()`) may read operational data only, never other users' plans, projects or files, and `admin_users` never gets a SELECT policy. [sharing](docs/decisions/key-decision-private-by-default.md) · [admin](docs/decisions/key-decision-no-cross-customer.md)
- **Secrets stay in env/secrets, never committed;** the Supabase anon key is RLS-protected and safe in the client, the service-role key and every third-party key stay server-side only, never a `VITE_` var. [full](docs/decisions/key-decision-secrets.md) · Logged-in users' data lives in the cloud. · Monorepo, one repo, a folder per workspace; `/server` secrets are walled off from the public deploy.
- **DWG (Document Review):** auto-convert DWG → DXF on the backend, LibreDWG first with a hard-failure fallback to Autodesk APS (never ask consultants for DXF). **Auto-filing never auto-guesses:** confident single-project matches auto-route, everything else goes to "needs filing"; a misfiled drawing is worse than an unfiled one. [DWG](docs/decisions/key-decision-dwg.md) · [filing](docs/decisions/key-decision-auto-filing.md)
- **Screening fetches (B860):** recompute (pure math over held geometry) is free, automatic and live; re-fetch (network) is stale-while-revalidate, triggered ONLY by a user action (a boundary/element edit outgrowing the fetched envelope, or TTL), never by panning/zooming, and always displays the data's age; `lib/factRevalidation.js`. [full](docs/decisions/key-decision-screening.md)

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

## Two backends — don't conflate (full text: [docs/decisions/two-backends.md](docs/decisions/two-backends.md))
1. **Supabase = data/auth/storage, LIVE.** The frontend talks to it directly with the RLS-protected anon key; it is the permanent home for user data (`doc_reviews`, the `doc-review-files` bucket, the Drive key↔file-id map and the file-facts index).
2. **Server-side compute/integration tier, two shapes with DIFFERENT deploy status.** **LIVE: Google Drive byte I/O** in same-origin Cloudflare Pages Functions (`server/storage/`, `functions/api/files.js`; uploads CHUNKED through `/api/uploads/*` into a Drive resumable session held in `public.upload_sessions`; downloads STREAM with Range→206). **⛔ Never browser-direct-to-Drive uploads (CORS-dead, refuted 2026-07-11); ⛔ never re-mint `GOOGLE_REFRESH_TOKEN`.** **BUILT, NOT DEPLOYED: Cloud Run** for DWG→DXF (`server/convert/`, LibreDWG, APS fallback dormant behind `APS_ENABLED`) and the Tier-2 AI filing read (`server/filing/`, dormant behind `ANTHROPIC_API_KEY` / `DOC_FILING_URL` / `VITE_AUTOFILE_ENABLED`; Tier-1 browser auto-filing B312 is LIVE). All third-party secrets stay server-side only.
