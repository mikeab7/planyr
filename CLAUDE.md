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
> **⏱ LATE-BIND the real number — assign it as the LAST step before you push, against fresh main (B779).**
> `next-id` reads only YOUR branch, so if you stamp a real `B###`/`V###` at the *start* of a session, a
> concurrent session (branched from the same main, its mint not merged yet) can honestly grab the same
> number — and whoever merges second renumbers. That's the collision that keeps happening; it is NOT a
> `next-id` bug (two branches can't see each other until they merge). To make it rare: **do the work under
> the provisional `NEW-#` / branch label everywhere in code, tests, and commits** (already the house rule —
> code/tests keep the provisional label through any renumber), and **assign the real backlog number only
> when you're about to push**, computed against the just-fetched main:
> ```
> git fetch origin main && npm run next-id -- --against-main    # folds in ids merged after you branched
> ```
> Assigning seconds before merge (not hours) collapses the collision window from the whole session to a
> few seconds, and because only the BACKLOG/VERIFICATION *heading* carries the real number, a rare late
> clash renumbers a couple of heading lines — never code. **A collision that still slips through is caught
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
> **🔍 `VERIFICATION.md` = the live-browser test checklist — KEEP IT LEAN too.** Every run, scan it and
> **verify any ⏳/due items yourself in a headless browser** (Chromium/Playwright is in the environment — see
> "🤖 Self-verification" there), then record the result. **The moment an item fully passes with nothing
> pending, MOVE it to `VERIFICATION-DONE.md`** (same archiving discipline as the backlog). The session that
> ships a UI change drives the live app itself rather than defer it. **Michael does NOT self-test — never wait
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
- **DEDUPE-FIRST** — Search **Open, ⏳ Verify, AND Done** (`^### B` headings + `#tags` + symbols; grep
  `BACKLOG_OPEN.md` for the live set) before minting a `B#`. A matching prior item gets the recurrence
  treatment (back to Open, `Recurrence:` line, `(×N)` title) — never a fresh number. When you DO mint,
  get the number from **`npm run next-id`** (B755) — never grep the archives for the max.
- **TOMBSTONE-DELETES** — Every removal path records tombstones for its **FULL cascade set** before the
  next flush, so a merge / sync can't resurrect the deleted item (or raise a false "changed in another
  session" conflict). Applies to every delete handler, not just the obvious one. (B276 / B556 / B596 / B612.)
- **LIVE-VERIFY** — These classes can only be *confirmed* live, so they file `Verify: live` and park in
  `## ⏳ Verify` until seen working: timing / race bugs · concurrency / multi-writer · GIS endpoint
  behavior · zoom- or data-density-dependent rendering · PDF / export parity · anything whose repro
  cites real project data. Each class maps to ≥1 e2e harness spec (`e2e/`, B278/B280/B281) so the manual
  live gate shrinks over time.

### Definition of Done (every item)
1. **Implemented** — the whole job, including the hard / real part (STANDING RULE #1). No diagnosis-only.
2. **Unit tests** for any pure library touched.
3. Every **applicable named rule** above is satisfied.
4. `BACKLOG.md` updated **and** `BACKLOG_OPEN.md` regenerated (`node scripts/build-backlog-index.mjs`).
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
- **No admin / cross-user data access.** Deliberately omitted, for customer trust and
  liability. Do not add a "god-mode" admin view.
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
