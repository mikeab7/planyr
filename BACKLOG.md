# Planyr — Backlog

Single source of truth for bugs and feature requests. Repo: `planyr` (product: **Planyr**).

> *"Single source of truth"* = the one file everyone trusts for what's done and what's left, so status never has to be tracked in anyone's head or in a chat thread.

---

## How this file works — Claude Code, read this first

- **On each run:** address every item under **🔲 Open**. Do **not** action anything under **🕓 Later / Roadmap** unless it's been moved up to Open. Completed items live in `BACKLOG-DONE.md` — do not read it unless looking up a specific past item.
- **IDs are permanent.** The next B# = highest `B#` across **both** `BACKLOG.md` and `BACKLOG-DONE.md` + 1. Never renumber or reuse a number, even after items are done.
- **Items pasted from another chat are "blind" to this file** and may carry provisional `NEW-#` (or stale/colliding `B#`) labels — treat those as scratch references only and assign the real next `B#` when filing.
- **Before filing, dedupe.** If an arriving item already exists here (reported from another chat), merge it into the existing item or skip it — never create a duplicate or a colliding ID.
- **When you finish an item:** move its whole block to **`BACKLOG-DONE.md`**, flip `[ ]` to `[x]`, and append a one-line note — what changed, the date, and the PR/commit if there is one.
- **Always commit after editing this file or finishing a fix** — never leave the working tree dirty. A fix that isn't committed doesn't count as done.
- **Never delete items.** Completed ones stay in `BACKLOG-DONE.md` as a record.
- **If an item is ambiguous,** don't guess. Mark it `[?]`, add your question inline, and leave it in Open.
- **Bracket tags** like `[Site Planner]` mark the module. `(bug)` / `(feature)` / `(task)` marks the type.

---

## 🔲 Open

### B491 — Security pen-test pass (2026-06-27): cross-user PDF read in team storage + OAuth token-page hardening `[Security / RLS + edge]` (security)  *(owner-requested "exhaustive penetration tests"; 5 parallel surface audits — edge Functions, edge proxies, OAuth, Supabase RLS, client XSS/secrets; minted **B491** = highest real B# (B490) + 1 — renumbered from a provisional **B488** a concurrent `main` (#377) took for the PDF-viewer-quality audit; the original commit message still reads B488)*
`[x]` **Filed + the two real fixes shipped + lower-priority items triaged the SAME session (branch `claude/resume-planner-persistence-36zqh1`, PR into `main`).** Owner SQL/dashboard steps in `OWNER-TODO.md`.
- **Overall verdict (honest, not padding): the app is well-built.** Edge Functions verify a real Supabase JWT and derive the tenant uid from the *token* (no IDOR); the GIS/Mapillary proxies have a robust WHATWG-host allowlist (no SSRF, token only ever goes to the fixed Mapillary host); client XSS is neutralised by React auto-escaping + consistent `esc()`/`escapeHtml()` in the three string-templated SVG/HTML builders; no server-only secret reaches the bundle (the `sk-ant-`/`ANTHROPIC`/`refresh_token` hits in `dist/` are placeholders / SDK var-names / grant-field names); and the team **management/invite** RLS correctly blocks self-escalation (admin-gated invites, SECURITY DEFINER funcs pin `search_path`, recursion avoided). Most surfaces returned SAFE.
- **`[x]` SHIPPED — Finding A (the one serious bug): cross-user PDF read via `can_read_shared_review_file` (`doc-review/db/team_storage.sql`).** The team-shared-file Storage SELECT policy granted read on any object whose path appeared in *some* team-shared review's `data->sources[].storageKey` — but `data` is attacker-writable on one's OWN rows, so a user could create a review they own, share it to a team they're on, and list a **victim's** path (`<victim_uid>/…`) to read the victim's private PDF (confused-deputy IDOR on the private `doc-review-files` bucket). **Fix:** require `(storage.foldername(p_name))[1] = r.user_id::text` so a readable object must belong to the review's true owner; a fabricated source can then only ever resolve to the attacker's own files, while legit shares still resolve. **Live impact today is gated** (needs the victim's exact path — uid + project + discipline + a 7-char random `srcId` — realistically known only to a *former* teammate; and no teams are live yet) → **run `team_storage.sql` before inviting anyone** (OWNER-TODO, with B486). HIGH severity if exploited; not actively exploitable by an outsider today.
- **`[x]` SHIPPED — Finding B (hardening): OAuth consent callback (`functions/api/auth/google/callback.js`)** now HTML-escapes every interpolated value (the refresh token + Google's error strings) and sends `Cache-Control: no-store` + `Referrer-Policy: no-referrer` on the one page that can render a secret. Pure-win, zero functional change. (These routes are a dormant one-time owner bootstrap — the token is already minted and must NOT be re-minted — so this is latent-risk reduction.)
- **Deliberately NOT auto-fixed (real but lower-priority / would risk regressions or are owner/infra actions — left here, not shipped, to avoid bloat):**
  - **Email-confirmation trust (config).** Invite-claim trusts the JWT email as verified; if Supabase "Confirm email" were OFF, a user could claim a co-worker's invite. Primary fix = the dashboard setting (OWNER-TODO); a SQL `email_confirmed_at` gate on the signup trigger was NOT added (the trigger fires *before* confirmation, so gating it would break invite-at-signup — needs careful design, deferred).
  - **OAuth CSRF `state` + caller authz** on the dormant consent routes (`start.js`/`callback.js` are unauthenticated). Standard hardening, but the routes shouldn't be exercised at all in steady state (don't re-mint the token), and a JWT gate on a top-level browser redirect is architecturally awkward (no Authorization header on a navigation). Deferred as latent-only.
  - **Optimistic-concurrency `version` reset.** A teammate can write an arbitrary `version` on a shared row, defeating the compare-and-swap anti-clobber guard (integrity, within-team only). A monotonic-`version` BEFORE-UPDATE trigger would fix it but risks breaking *all* saves if the client increment ever diverges — deferred pending a safe rollout.
  - **`client_errors` telemetry:** anon INSERT has no rate-limit/size-cap (spam/cost; READ side is correctly closed — no cross-user read). Length caps could silently drop large stacks → left to platform rate-limiting.
  - **Public proxy rate-limit** (`/api/mapillary/*`, `/api/gis-cache/*`): no code-level rate limit (quota-abuse ceiling only; targets are public agency hosts). Best as a Cloudflare WAF rule (infra, not code).
  - **`underlay.src` import scheme** not validated (a crafted import/shared plan could load a remote tracker image — content-spoof/privacy, NOT XSS; React keeps it inert). Optional `^data:image/|^https?:` allowlist if teams share plans widely.
  - **Scheduler separate Supabase project RLS** (`public/sequence/index.html`, ref `ksetjztkplttbcehyicv`): its hardcoded key is confirmed **anon** (not service_role), but that project's table RLS can't be verified from the repo → owner confirm `planar_*` tables have RLS enabled (ties to the B408 consolidation decision).
- **Dedup:** net-new security item; the shipped Finding A is distinct from B486 (re-home guard) — both are team-sharing RLS gaps to run before going live, different policies.
### B489 — PDF viewer crispness: remaining render-engine refinements (sub-pixel seam, continuous-pan re-raster, useSystemFonts) `[Doc Review / Markup]` (task — quality, follow-on to B488)  *(surfaced by the B488 PDF-viewer-quality audit 2026-06-27; minted **B489** — renumbered from a provisional B487 a concurrent `main` (#374) took)*
`[ ]` Lower-priority polish on the B415 two-layer renderer from the B488 audit. (B488 already shipped the high-value, low-risk set: asset wiring + detail supersampling + snappier settle + deeper zoom + **backdrop-floor budget 8e6→16e6 + pan margin 0.25→0.40 + retina density cap 2→2.5**.) The three below were deliberately held back — each is subtle/medium-risk and wants its own focused pass; verify each headlessly:
- **Sub-pixel detail/backdrop seam** *(highest-value remaining)* — the sharp detail tile is placed at the *unrounded* page origin while its pixels were rendered at the *rounded* device origin, so it can sit ≤0.5 CSS-px off the backdrop beneath it → faint ghosting on thin lines/text on every detail re-raster. Fix = snap the tile to whole device pixels (in `pdf.js renderInto` return `region: {rx: ox/S, ry: oy/S, rw: bw/S, rh: bh/S}`; in `DocReview` build the tile from `d.region`, not `reg.rect`). Touches displayed geometry → needs a real before/after pixel diff (a hairline crossing the seam should be one band, not a doubled echo), which the existing interaction harness (markup overlay only) won't catch — hence held for a focused pass.
- **Continuous-pan leading-edge re-raster** — the 90 ms settle still holds the soft backdrop during a long *continuous* flick; a leading-edge / rAF-throttled detail re-raster during a slow pan would keep it sharp mid-motion.
- **useSystemFonts:false** — with the standard fonts now wired (B488), forcing pdf.js's bundled metric-compatible substitutes over `local()` system fonts would render text identically across devices (a drawings-review tool wants that consistency), at the cost of not matching a font the user actually has installed. Low impact; a deliberate product call for Michael.

### B490 — PDF viewer: optional-content (OCG) layer toggle `[Doc Review / Markup]` (feature)  *(surfaced by the B488 PDF-viewer-quality audit 2026-06-27; minted **B490** — renumbered from a provisional B488)*
`[ ]` CAD-exported surveys/civil sheets often carry optional-content layers (OCGs). pdf.js honours the document's *default* visibility (off-by-default layers stay hidden — correct), but there's no way to turn a hidden layer ON. Add a small Layers control: after `loadPdf`, call `pdf.getOptionalContentConfig()`; if it has groups, list them with checkboxes and pass the edited config into render via `optionalContentConfigPromise` on `page.render`. Net-new UI + render wiring — sized as its own item, not part of B488.

### B485 — Phone header clips its controls instead of scrolling sideways `[Shared header / mobile]` (bug)  *(surfaced 2026-06-27 driving the Cowork batch-4 V11 phone-layout item under REAL mobile emulation, which the Cowork `resize_window` tool couldn't produce; minted **B485** = highest real B# across both files (B484) + 1 — renumbered from a provisional **B481** that a concurrent `main` (#373) took for the overlay-rehydrate / cold-Review-switcher fix)*
`[x]` **Filed AND fixed + headless-verified the SAME session per STANDING RULE #1 (branch `claude/resume-planner-persistence-36zqh1`, PR #376 into `main`, auto-merge armed).** *Moves to BACKLOG-DONE on merge.*
- **Repro (headless, iPhone-13 emulation at 390px):** open a site in the planner on a phone-width viewport. The shared two-row `AppHeader` overran 390px and **clipped its controls** under `overflow:hidden` + flex-shrink: the Row-1 project/plan switcher and save/settings/auth badges, and the **entire Row-2 toolbar** (undo/redo/fit/Snap/Select-parcels) — only the tail "…cels" (clipped "Select par**cels**") + "File ▾" survived. So controls were truncated into unreadable fragments and some unreachable. This directly contradicted V11's own spec: *"the top header should scroll sideways, not wrap onto two lines."*
- **Root cause:** the B113 phone work fixed the planner **body** (side rails → overlays, the "✎ Tools" button) but never touched the **shared** `AppHeader`. Its flex zones (`flex:1` + `minWidth:0`, and the toolbar zone's `overflow:hidden`) compress to clipped slivers below the breakpoint — the header was still a desktop layout squeezed into a phone.
- **Fix (scroll sideways, exactly as the spec asks):** new `useNarrow()` in `AppHeader.jsx` (matchMedia `max-width:760px`, mirroring the planner's own `narrow` so header + body flip together). Below the breakpoint each header row gets `overflow-x:auto` (bar hidden via new `.no-hscrollbar` in `index.css`) and its zones keep natural width (no flex-shrink, `overflow:visible`) so nothing is clipped — you swipe to reach it; the brand drops to the mark (no wordmark) to reclaim width; the Schedule Row-2 (B387 center slot) switches `wrap`→`nowrap`+scroll. Every change is `narrow ?`-gated, so **desktop is byte-identical**.
- **Verified:** lint **0 errors** · **full test suite green** · build green · new headless `ui-audit/verify-phone-layout.mjs` (REAL iPhone-13 emulation) **10/10, stable 3×** — incl. a regression guard that FAILS on the pre-fix build (`maxRowOverflow=0px`, content clipped) and PASSES on the fix (`360px`, content scrolls). Screens confirm: phone Site/Review/Schedule scroll cleanly with no clipped fragments and no page errors; **desktop header unchanged**. Re-verified after merging the latest `main` (#373/#374, which also touched `AppHeader.jsx`/`index.css` — auto-merged with no overlap).
- **⏳ One physical-device check (V11):** real-finger touch + rotation/landscape on an actual phone (the sandbox has no touch device / can't rotate). Logged in VERIFICATION.md V11.
- **Dedup:** net-new; the shared header's mobile responsiveness. Distinct from B113 (planner-body phone mode, already live), from B475/B476 (header *data*-source / save-messaging bugs, not layout), and from B481/B482 (#373 overlay-rehydrate / cold-Review-switcher — unrelated, just the colliding number).

### B483 — A 100%-full localStorage boots the app signed-out (auth-token refresh write fails) `[Auth / Storage]` (bug — hardening; low real-world risk post-B474)  *(Cowork signed-in verification 2026-06-26, "NEW-4"; minted **B483** = highest real B# (B482) + 1)*
`[ ]` **Repro:** fill localStorage to a literal ~100% (Cowork's snippet B + a fine-grained top-up), then reload → the app boots **signed-out** (header "Sign in", empty site list) because Supabase's session-token refresh can't write to a full localStorage. Self-heals once space is freed; data intact.
- **Why low real-world risk now:** B474 moved the heavy rasters off localStorage into IndexedDB, so in real use localStorage sits ~700 KB even with big images — a literal 100%-full localStorage is essentially only reachable by an artificial fill. B473's amber "saved to your account" path itself behaved correctly throughout.
- **Fix (when picked up):** ensure a device-full condition can't drop the auth session — e.g. proactively evict our own large caches (gis cache / history mirror) on a QuotaExceededError to keep headroom for the Supabase auth write, or keep the session in memory so a failed localStorage refresh-write doesn't sign the user out. Deferred (edge + self-healing + low real-world likelihood post-B474); filed for the record.

### B484 — Renderer freezes (~30 s main-thread stalls) during PDF title-block reading and heavy map/parcel ops `[Doc Review + Site Planner / perf]` (task — perf)  *(Cowork signed-in verification 2026-06-26, "NEW-5"; minted **B484**)*
`[ ]` **Observed:** repeated multi-second tab-unresponsive stalls while the Review module reads a dropped PDF's title block on import, and during statewide-parcel selection / map zoom over a new area. Didn't fail a test, but it's a real responsiveness issue (and slowed the signed-in pass).
- **Cause:** the vector title-block read (pdf.js `extractPageText`/`extractPageItems` + the pure parsers) runs on the MAIN thread on import (OCR for scanned sheets is already in a worker — B352 — but the vector-text path isn't); heavy parcel geometry/render also blocks.
- **Fix (when picked up):** move the PDF title-block read + heavy geometry off the main thread (Web Worker / chunked yielding) per the CLAUDE.md "heavy work off the main thread" rule, so the tab stays responsive during PDF intake and parcel loads. Larger task — deferred, filed.

### B477 — Active project does NOT carry into the Schedule module (lands on the all-projects report) `[Schedule / cross-module nav]` (bug)  *(surfaced 2026-06-25 by a Cowork signed-in verification pass against planyr.io — see VERIFICATION.md V100; minted **B477** = highest real B# across both files (B476) + 1)*
`[ ]` **Repro (Cowork, signed-in on planyr.io):** select a project in the Site Planner, then switch to **Schedule**. The project id IS carried in the URL hash (`#/project/<id>/schedule`), but the embedded scheduler (`/sequence/`) ignores it and lands on its **own all-projects report** with the breadcrumb reading **"Select a project"** instead of opening the carried project. The same carry works correctly Site→Review (Review shows the project + its file browser), so this is Schedule-specific.
- **Likely cause (to confirm):** the active-project carry (Work Items A & B, V100) was wired for the store-backed workspaces (Site / Review), but the Schedule module is the embedded `/sequence/` iframe with its OWN project state/backend — the carried id has to be handed across the **postMessage bridge** (same bridge B440 used for rename/delete) and have the scheduler select that project on load, which it currently doesn't do.
- **Scope:** cross-module nav only — no data risk; the scheduler still works, it just doesn't auto-open the project you came from. Fix = on Schedule mount with a carried `project_id`, postMessage the id into the iframe and have the embedded app select it (mapping the planner's `group_id`/site to the scheduler's project key).
- **Dedup:** net-new; distinct from B440 (rename/delete bridge) and B439/V130 (those are verified working). This is the *project-selection* half of the bridge.

### B473 — DATA LOSS: a NEW site's edits vanish on reload when signed in — ROOT CAUSE PINNED (localStorage full) `[Site Planner / Persistence]` (bug, DATA-LOSS)  *(owner repro 2026-06-25 on planyr.io, signed in; renumbered from a provisional B472 a concurrent `main` (#355) took)*
`[ ]` **PINNED from the owner's LIVE telemetry (the B473 safety net caught it on planyr.io):** `save-verify-failed {want:7, got:6, ok:false}` + a console dump showing localStorage at **4,873 KB of the ~5,120 KB (5 MB) cap** (the 2 KB `canWrite` probe fit; a real ~1.6 MB store rewrite did not). `ok:false` = `saveSite`→`writeSites` threw QuotaExceeded and returned false. Three site stores held ~4.7 MB of largely-duplicated data: history 1,664 KB + cloud cache 1,615 KB + the **DEAD logged-out store** 1,442 KB. So a new edit can't fit on-device; worse, the settle-tick did `if(!ok) return` BEFORE the cloud push, so a full DEVICE store also blocked the CLOUD save → lost in both → gone on reload. NOT signed-in-LOGIC-specific — it's storage-FULL-specific; the signed-in cache was just the store that had filled (why the clean sandbox never reproduced it).
- **`[x]` Shipment 1 (LIVE) — the cure + pressure relief:** (1) a local write failure NEVER blocks the cloud save — `pushModelToCloud(payload)` ships the LIVE model (cloud has no 5 MB cap; `pushSiteToCloud`→`loadSite` would re-read the failed store and ship the stale pre-edit copy); settle-tick + `saveNow` reworked; honest **AMBER** "saved to your account, free up space" banner vs red "at risk". (2) `writeSites` quota-slim now sheds rasters from sheetOverlays/parcelDrawings too (shared `stripDataUrls`), so ALL geometry persists on-device. (3) `pruneMigratedLegacy` frees the dead ~1.4 MB logged-out duplicates after a successful `pullCloud`. (4) version ring bounded by bytes (`capHistoryBytes`, 700 KB). +6 tests (`test/saveFallbackCloud.test.js`); lint 0 · 1565 tests · build green · `verify-new-site-save.mjs` 10/10.
- **`[~]` Shipment 2 (ATTEMPTED → reverted this session; the IndexedDB *capacity* upgrade is spun out to B474).** Built an `LS` façade + in-memory mirror + a `localDb.js` IndexedDB kv layer, but it broke TWO load-bearing guards (9 tests red), so I reverted rather than trade one data-loss class for another: (1) the **B127 cross-tab stale-write guard** relies on localStorage being *synchronously shared across tabs* to spot another tab's save — a per-tab in-memory mirror can't, and IndexedDB has no synchronous read to replace it; (2) `writeSites`' quota-slim retry relies on the write THROWING on a full store, which the façade swallowed. **The data-LOSS cure is Shipment 1 (cloud-authoritative), which is sufficient on its own;** the cap-removal is now a future-proofing enhancement → **B474.**
- **⏳ One signed-in spot-check (owner, planyr.io):** with storage full, an edit shows the amber "saved to your account" banner and survives reload (the cloud-fallback path can't run in the sandbox — no auth).

### B474 — Move the Site Planner on-device cache off the 5 MB localStorage cap onto IndexedDB `[Site Planner / Persistence]` (enhancement)  *(spun out of B473 Shipment 2, 2026-06-25; owner: "do the best long-term solution now")*
`[~]` Give the on-device cache **gigabytes (IndexedDB)** instead of localStorage's hard ~5 MB. Data-safety is already fixed (B473 Shipment 1: cloud authoritative + dead-store purge + history byte-cap + raster-shed), so this is future-proofing — done carefully, NOT a drop-in swap.
- **`[x]` Stage A (SHIPPED) — version-history ring → IndexedDB.** The biggest local store (~1.6 MB) and the SAFE one (a one-way backup, never read for cross-tab coordination). New `lib/localDb.js` (promisified IndexedDB kv; no-ops when IndexedDB is unavailable). In `storage.js` the ring is an in-memory cache (`historyMem`, the synchronous source of truth) written through to IndexedDB (uncapped → undo depth no longer byte-throttled) + a byte-capped localStorage fallback; `initHistoryStore()` (called from `SitePlannerApp`) hydrates + merges + one-time-migrates the old localStorage ring. Public API unchanged + synchronous (`snapshotVersion`/`listVersions`/`getVersion`/`backupNow`). IndexedDB-ABSENT path is byte-for-byte the old behavior — the 1565 existing tests prove it. +6 unit tests (`test/historyIdb.test.js`, fake-indexeddb) · lint 0 · **1571 tests** · build green · headless **V139** (`ui-audit/verify-b474-history-idb.mjs`, 7/7: ring lands in IndexedDB + survives reload).
- **`[~]` Stage B — heavy RASTERS → IndexedDB (the actual cap pressure), NOT the cross-tab-coordinated map.** Investigation (2026-06-26) found the literal sites map is tiny (geometry, kilobytes) and bound to the two-window guard; the thing that fills the cap is the attached IMAGES. So the safe path moves rasters to IndexedDB and leaves the small map + its guard untouched.
  - **`[x]` Underlay raster → IndexedDB (SHIPPED).** Stashed on drop (`idbPut("raster:<siteId>:underlay", …)` in `onUnderlayFile`); the persisted record drops the heavy data-URL `src` via `dropIdbBackedSrc` in `writeSites` (proactive off-cap, conditional on an `idbKey` so non-backed rasters keep `src` — safe), rehydrated on load by a new effect in `SitePlanner.jsx`. Fixes the ONE raster with no recovery path (it used to need a re-drop after a strip). +2 unit tests (`saveFallbackCloud.test.js`) · lint 0 · **1573 tests** · build green · headless **V141** (`ui-audit/verify-b474-underlay-idb.mjs`, 7/7: stash → off-cap record → rehydrate after reload).
  - **`[x]` sheetOverlays / parcelDrawings → IndexedDB (SHIPPED).** Stashed on creation (`addOverlayFile` / `addDrawingFromRaster`, keyed `raster:<siteId>:overlay|drawing:<id>`); the rehydrate effects now try **IndexedDB first** (fast, offline) and fall back to cloud Storage (cross-device); `dropIdbBackedSrc` slims them off the cap on persist. +1 unit test; headless **V142** (`ui-audit/verify-b474-overlay-idb.mjs`, 7/7 — overlay stash → off-cap record → rehydrate after reload). Drawings share the identical pattern (storage unit-tested; same rehydrate code, parcel-attach path).
  - **`[ ]` The live sites-MAP itself stays on localStorage (deferred).** Its two-window guard (B127/B314) needs synchronous cross-tab visibility + the `storage`-event merge; moving it = a BroadcastChannel rebuild (`src/shared/presence/` — the editor lock already serializes editing) + two-window/signed-in testing. Not worth the risk now that the cap is non-binding — **owner agreed**. Cloud (Supabase) stays the single source of truth.

### B479 — Persistence "state-of-the-art" perf refactors (the deferred tail of the B485 review) `[Site Planner / Persistence]` (enhancement/perf)  *(spun out of the B485 adversarial review, 2026-06-26; renumbered **B478→B479** on merge — a concurrent `main` (#368) took B478 for the resume-into-planner fix; these are the findings the verifiers marked fixNow=false — real but larger/riskier than a same-session patch, NOT data-loss. B485 shipped all the data-loss + honesty fixes.)*
`[ ]` Quality/perf upgrades to the IndexedDB persistence layer. None is a correctness bug; each is a worthwhile optimization once it can be done carefully (its own branch + verification).
- **`[ ]` Per-site IndexedDB history keys, not one full-ring blob (#25/#28).** `writeHistoryAll` JSON-serializes the ENTIRE multi-site version ring to a single IndexedDB key on every snapshot (O(all history) per save). Move to per-site keys (`history:<siteId>`) so each write is O(one site). Medium risk (touches the hydrate/merge/migrate path); needs the fake-indexeddb suite extended.
- **`[ ]` Store rasters as native Blobs, not base64 data-URL strings (#27).** ~33% size + memory overhead + structured-clone cost; Blobs are the idiomatic IndexedDB image store. Requires object-URL lifecycle management (create on read, `revokeObjectURL` on unmount/replace) in the rehydrate effects — the reason it's deferred.
- **`[ ]` Don't let raster rehydration re-fire the autosave/cloud-push (#29).** On reload, `setUnderlay`/`setSheetOverlays` adding `src` back triggers the autosave effect → a redundant local write (B460's contentSig already suppresses the cloud RE-push, so this is local churn, not loss). Guard rehydrate-driven setState from the edit-driven path.
- **`[ ]` Honest "space left" UI via `StorageManager.estimate()` (#34) + amber self-clear after space is freed (#33).** Today "device full" is only learned by catching QuotaExceededError after a write fails; `navigator.storage.estimate()` could show usage proactively, and the amber "saved to your account" banner could self-clear once space returns instead of waiting for the next edit/Retry.
- **`[ ]` `mergeHistory` dedup by `at`+`sig`, not `at` alone (#32/#35).** Two genuinely-different snapshots sharing one millisecond collapse to one on merge. Tiny, but doing it right also needs `getVersion` to disambiguate same-`at` rows (it currently keys on `at` only) — so it's a small paired change, not a one-liner.

### B471 — Revision compare (current vs. previous version), state-of-the-art `[Doc Review / compare]` (feature) — umbrella, IN PROGRESS  *(owner-dropped 2026-06-25 "plan that … like Procore but state of the art"; planned + approved; minted **B471** = highest real B# across both files (B470) + 1 — renumbered from a provisional B464 that a concurrent `main` took for the read-only-lockout cluster while this was in flight; plan: `/root/.claude/plans/for-document-review-if-luminous-lampson.md`)*
`[ ]` Compare two revisions of the same drawing and **see exactly what changed** — color-wash overlay
(removed one color / added another / unchanged dimmed), an auto **change-list** that finds/counts/jumps
to every change, smart **text/dimension diff** on vector PDFs, and **flattened compare-PDF export**.
Owner decisions: pick versions from BOTH the filed library (it already tracks revisions) AND ad-hoc;
color-wash is the core view (swipe/fade/side-by-side deferred); all three "beat-Procore" layers in scope.
- `[x]` **Phase-1 CORE engines — DONE this session (branch `claude/wizardly-mccarthy-oi8xl7`), 24 unit tests, lint 0, build green, lazy chunks intact.** All PURE + Node-tested; reuse-not-rewrite (registration is `overlayAlign.solveSimilarityLSQ` + `matchLineFit`). Code tagged **B471**:
  - `src/shared/files/rasterDiff.js` — 2-D dilation (tolerance), per-pixel classify (removed/added/unchanged), connected-components → navigable change regions. 10 tests incl. the 1px-jitter-must-not-flag guard.
  - `src/shared/files/rasterRegister.js` — coarse-offset (profile cross-corr, reuses `slideRefine`) + ink-bbox similarity (`solveSimilarityLSQ`) + ink-agreement confidence gate + manual 2-point fallback (`manualRegister`). 8 tests incl. honest low-confidence → manual.
  - `src/shared/files/rasterCompare.js` — pure register→resample→diff pipeline (`compareBinaries`). 6 tests incl. "a shift registers away to ~zero changes; a real addition still surfaces."
  - `src/workspaces/doc-review/lib/compareRegister.js` — browser glue (PDF render + binarize via existing `renderPageToImageData`/`binarizeImageData`), re-exports the pure core.
- `[ ]` **Phase 1 UI (NEXT):** `CompareView.jsx` (a `mode:"compare"` in DocReview) — color-wash canvas over rev A + change-list panel (click → recenter via `centerOn`) + manual-align mode; ad-hoc "Compare ▸" entry; `kind:'compare'` persistence (additive, no migration). Reuses `renderBudget`/`viewportTransform`/`MarkupRenderer`.
- `[ ]` **Phase 2:** library entry (FileBrowser "Compare revisions") + multi-sheet pairing (`comparePairing.js` via `sheetGroups`).
- `[ ]` **Phase 3:** semantic text/dimension diff (`semanticDiff.js`, vector PDFs, reuses `extractPageItems`).
- `[ ]` **Phase 4:** flattened compare-PDF export.
- `[ ]` **Phase 5 (optional):** swipe / fade+blink / side-by-side views.
- Verification ahead: `ui-audit/verify-compare.mjs` (headless, seed two PDFs via `make-sample-pdf.mjs`).

<!-- 2026-06-25: owner-dropped read-only-lockout cluster "NEW-1…NEW-7" (one chat; SUPERSEDES the earlier
     NEW-1/2/3 block in the same chat — filed from THIS block only, no double-enter). Highest real B#
     across both files was B463, so minted **B464–B470**. Per STANDING RULE #1 all seven were filed AND
     fixed the SAME session on branch `claude/exciting-wright-yb6ruz` — full [x] blocks live in
     BACKLOG-DONE.md. lint 0 · 1528 tests (+11) · build green · headless V (`ui-audit/verify-readonly-takeover.mjs`, 7/7).
     AUDITED-FIRST per the brief, and FLAGGED a contradiction: on current main (post-B458/B455) a read-only
     tab's LOCAL mirror + version snapshots run UNCONDITIONALLY (only the CLOUD push is gated), so the
     report's "snapshots froze / nothing persisted anywhere" is NOT reproducible on current main — it
     predates B458 (shipped earlier 2026-06-25, the immediate-mirror fix). The green-indicator-while-
     read-only (NEW-2) WAS reproducible in code and is fixed.
       • B464 (NEW-1) read-only tab no longer silently non-syncing — LOUD actionable banner; EXTENDS B455/B458.
       • B465 (NEW-2) headerSaveState gained a "readonly" badge state (amber lock) — never green while not saving.
       • B466 (NEW-3) editorLock.takeOver() (Web Locks steal + cross-tab bus yield) + "Take over editing here" force-push.
       • B467 (NEW-4) Restore verifies the pre-restore backup persisted + is lock-gated (a read-only tab can't Restore).
       • B468 (NEW-5) reportClientEvent → public.client_errors: readonly enter/leave/takeover, save-suppressed,
         cloud-conflict, cloud-write-failed, delete-zero-rows (tab-id stamped); EXTENDS B279, no schema change.
       • B469 (NEW-6) probeService direct-first → proxy-on-CORS-failure through the existing B445 proxy (Fort Bend).
       • B470 (NEW-7) pdf.worker Trusted Types warning — triaged benign (no enforced CSP in the repo), no code change.
     Deduped/folded, not duplicated: B464/B466 EXTEND B455 (lockout) + B458 (immediate mirror); B468 EXTENDS
     B279; B469 reuses B445; NONE is a re-file of B313/B314/B459. Three live checks (signed-in indicator
     read-only state, telemetry rows, Fort-Bend-parcel no-CORS) are logged in VERIFICATION.md for Cowork. -->

<!-- 2026-06-25: owner-dropped trio "NEW-1/NEW-2/NEW-3" (overlay right-click menu + "align to base" +
     replace the rotation slider with a numeric stepper). Highest real B# across both files was B460, so
     minted **B461 / B462 / B463**. Deduped: B463 is NOT B428 (property-set completion — that added
     stroke/fill/text controls, never a rotation control); it REUSES the B431 element NumInput+spinner
     pattern as the shared widget. B461 EXTENDS the B421 Arrange context menu (does not duplicate it) +
     reuses the B158/B127 right-click-menu+portal pattern. B462 reuses the existing align primitive
     (`overlayAlign.solveSimilarityLSQ` + the SitePlanner building→parcel `alignToParcelEdge`), not a
     second one. Distinct from B422 (named markup Layers, parked).
       • **B463 (NEW-3) — SHIPPED this session** per STANDING RULE #1; full [x] block lives in
         BACKLOG-DONE.md (branch `claude/wizardly-mccarthy-oi8xl7`). The one rotation SLIDER in the app
         (the Site Planner overlay "Rotate") is retired for a shared numeric stepper; the markup +
         element rotation NumInputs now use the same widget. lint 0 · 1517 tests (+11) · build green ·
         headless V (`ui-audit/verify-b463-rotation-stepper.mjs`, 12/12).
       • **B461 (NEW-1) + B462 (NEW-2) — SHIPPED this session** per STANDING RULE #1; full [x] blocks
         live in BACKLOG-DONE.md (branch `claude/wizardly-mccarthy-oi8xl7`). The flagged assumption
         ("'overlay' = Document Review's overlay & version-compare surface") was WRONG against the code —
         Document Review has no overlay/version-compare surface yet — so the owner was asked which surface
         and **chose the Site Planner's site-plan overlays** (`sheetOverlays`). B461 = a portalled
         right-click menu (Copy / Duplicate / Paste / Bring-to-front / Send-to-back / Lock / Align-to-base /
         Delete) on the canvas overlay + its panel row, count-verified Delete, ref-counted shared source on
         Duplicate/Paste, Ctrl+C/V/D parity. B462 = "Align to base edge" reusing the building→parcel
         `snapParallel`/`segDist` primitive (click a parcel boundary → the overlay snaps parallel to it).
         lint 0 · 1517 tests · build green · headless V (`ui-audit/verify-b461-b462-overlay-menu.mjs`, 13/13). -->

<!-- 2026-06-24: owner-dropped data-loss + deploy-hygiene batch "NEW-1…NEW-9" (one chat, tied to the
     8 South / Plan 1 building-loss that happened DURING a stale-chunk deploy crash). Highest real B#
     across both files was B448, so minted **B449–B457**. Per STANDING RULE #1 the eight CODE items
     (B449–B456) were filed AND shipped the SAME session on branch `claude/youthful-volta-ns1n75` —
     full [x] blocks live in BACKLOG-DONE.md. lint 0 · 1468 tests · build green · lazy chunks intact.
     Three brief premises were CORRECTED against real code (flagged, not silently followed): NEW-5
     (B453) boot reconciliation already union-merges → became verify+regression-test; NEW-4 (B452) the
     local flush already runs → the real gap was the keepalive CLOUD push; NEW-1 (B449) the prescribed
     `/* → index.html` catch-all would CAUSE the masking → used a no-catch-all `_redirects` (hash routing).
     Live-edge paths (Cloudflare 404, deploy-escape screen, survive-forced-reload, the read-only lockout)
     are delegated to Cowork on preview/prod — see VERIFICATION.md; NOT marked done on the sandbox alone.
       • B449 (NEW-1) `public/_redirects` (+`404.html`) — missing /assets/* now 404s honestly, no SPA catch-all.
       • B450 (NEW-2) chunk-recovery "stuck" escape (`recoveryStage`) when the fresh build is ALSO missing the chunk.
       • B451 (NEW-3) Vite `base:"/"` for the Cloudflare root deploy.
       • B452 (NEW-4) keepalive cloud push on a forced reload (`flushRegistry` + version-guarded `keepaliveCasPush`).
       • B453 (NEW-5) verified boot reconciliation already unions local mirror ∪ cloud; locked with a regression test.
       • B454 (NEW-6) written root cause — ruled out CAS-bypass; most-likely conflict-then-strand, closed by B452+B455.
       • B455 (NEW-7) conflict loud+blocking · Web Locks single-active-editor read-only lockout · 6s save watchdog.
       • B456 (NEW-8) Version History real building counts + content summary + distinguishable timestamps. -->

<!-- 2026-06-24: owner-reported (screenshot) — the Site-plan overlay panel "does not allow anything to
     actually be dropped in, should work like enterprise software". Highest real B# across both files was
     B444, so minted **B445**. Per STANDING RULE #1 filed AND fixed + headless-verified
     (V131, `ui-audit/verify-overlay-dnd.mjs`, 7/7) + shipped the SAME session on branch
     `claude/hopeful-turing-1x24sg` — full [x] block lives in BACKLOG-DONE.md.
       • B445 — the canvas already had a working onDrop→addOverlayFile, but no drag affordance + the left
         panel (where the cursor goes) wasn't a drop target + the browser default swallowed off-target
         drops. Fix = panel is now a dashed-border dropzone w/ hover highlight, a full-canvas "drop to
         place" hint during a drag, and a window-level guard against the browser opening the dropped PDF.
         Reused `addOverlayFile` + the Doc-Review FileBrowser dropzone pattern; theme tokens only.
     lint 0 errors · 1425 tests · build green. -->
<!-- 2026-06-24: owner-dropped trio "NEW-1/NEW-2/NEW-3" — the Document Review open/switch state &
     feedback bugs (drop gives no signal · switching files loses state · backdrop vanishes mid-upload).
     Highest real B# across both files was B445, so minted **B446 / B447 / B448**. Per STANDING RULE #1
     all three were filed AND fixed + verified the SAME session on branch `claude/vibrant-pascal-wkg50i`
     — full [x] blocks live in BACKLOG-DONE.md.
       • B446 (NEW-1) — a GAP in B294 (drop-over-open) + the docIntent/B405 open paths, NOT a duplicate:
         B294 wired the drop handler but the "Opening…" text only rendered in the empty state, so the
         drop-over-open and Files-panel/openReview paths showed no loading signal. Added a canvas-level
         "Opening <name>…" overlay (data-testid="opening-overlay") driven by `busy`, set on EVERY entry
         path (openFile / openReview / loadSingleReview). openErr/err now fire on every no-op/null/invalid
         branch (null drop, non-PDF reject, loadReview→null) so an open is never silent. Headless V131
         (`ui-audit/verify-open-feedback.mjs`, 6/6, logged out).
       • B447 (NEW-2) — a GAP in B52 (load-supersede token) + the resume effect: B52 stops a late load
         landing on the wrong review, but a switch never FLUSHED the outgoing review's pending write, and
         openReview didn't reconcile with the local mirror — so the cancelled debounce left the last edit
         only in localStorage and a switch-back loaded the stale cloud copy (the "forgets which file"
         clobber). Fix: openReview `await saveNow()` (flush outgoing) THEN `reconcile(loadReview, readDraft)`
         (incoming picks up its newer local mirror), exactly like resume. The lazy-mount resume effect was
         confirmed to already stand down for an in-workspace switch (booted-once + projectId + bootDocIntent
         guards). Auth-only (two saved cloud reviews) → signed-in live check logged V131.
       • B448 (NEW-3) — net-new safety net under B447: a session byte cache (pure `lib/sessionBytes.js`,
         5 unit tests) keyed by srcId holds the dropped File, so a switch/reload BEFORE the Drive/Supabase
         upload resolves (source still keyless) re-opens the backdrop from memory instead of the re-drop
         banner / a blank canvas. `fetchSourceBytes` checks the cache before classifySource/Drive/Supabase.
         Logged-out render-from-cache verified V131; the keyless-mid-upload path's signed-in confirm logged.
     lint 0 errors · 1434 tests · build green. -->

<!-- 2026-06-24: owner-reported trio (screenshot + voice) on the parcel-MERGE banner — "NEW-1/NEW-2/NEW-3".
     Highest real B# across both files was B441, so minted **B442 / B443 / B444**. Per STANDING RULE #1
     all three were filed AND fixed + headless-verified (`ui-audit/verify-merge-banner.mjs`, 6/6) +
     shipped the SAME session on branch `claude/gallant-euler-sk8kwd` — full [x] blocks live in BACKLOG-DONE.md.
       • B442 (NEW-1) — merge/easement banner buttons were unclickable (canvas grab-cursor + pan bled
         through) because the banner had no z-index over the SVG (`zIndex:1`). Fix = `zIndex:6` + a
         defensive stopPropagation; same guard applied to the sibling easement banner. Deduped: NOT B271
         (interrupted-gesture recovery), NOT B441 (MapFinder identify latency).
       • B443 (NEW-2) — Shift-click multi-select "needed several tries": B420 makes a parcel interior
         click-through, so a body Shift-click fell to `onBgDown` and started a marquee instead of a
         merge-toggle. Fix = onBgDown ray-casts the parcel under a shift-press and toggles it; the
         vertex-insert capture handler yields to a merge-pick on a neighbor.
       • B444 (NEW-3) — the "4 parces selected" garble was a SYMPTOM of B442 (canvas painting over the
         behind-z-index banner), not a flex bug; resolved by B442's z-index, hardened with nowrap + a span.
     lint 0 errors · 1421 tests · build green. -->

<!-- 2026-06-24: owner-dropped trio "NEW-1/NEW-2/NEW-3" (status-marker palette + the precision-pin
     map marker + drop the saved-row element count). Highest B# was B422 when filed, but a concurrent
     `main` (#321, the Shared markup engine batch) took B423–B432 while this was in flight, so
     renumbered to **B433 / B434 / B435** = the real next free band. Per STANDING RULE #1 all three
     were filed AND fixed + headless-verified
     (V123, `ui-audit/verify-precision-pin.mjs`, 18/18) + shipped the SAME session on branch
     `claude/stoic-albattani-8bmtp0` — full [x] blocks live in BACKLOG-DONE.md.
       • B433 (NEW-1) — AMENDS B234 (the shared status tokens, edited IN PLACE — not a parallel set) +
         touches B320 (dark `--status-*`). Mostly already LIVE via B365 (coral Pursuit / blue Active /
         fixed salience were drafted against the pre-B365 baseline); the residual shipped here = Dead
         off red → gray, a dedicated `--danger` alert-red token (cloud-off badge / failed-layer dot /
         delete × repointed to it), glyphless Pursuit/Active solid discs, solid (not hollow) Dead, and
         the chip/section-header discs. `ProjectLibrary.jsx STATUS_COLOR` was already gone (no dup to
         reconcile). The three standing rules were added to CLAUDE.md (KEY DECISIONS).
       • B434 (NEW-2) — AMENDS B161 (the marker shape), depends on B433. `buildingPinIcon`→`sitePinIcon`
         (bulb + stalk + ground ring, ring-center anchor); B161's progress arc was restored as the
         ground-ring sweep (it had been silently dropped by B365's shield), same status-derived source.
         Superseded `verify-b365-markers.mjs`.
       • B435 (NEW-3) — net-new; dropped the ` · N elem` suffix from the left-rail site rows.
     Deduped: B433 is the residual of B365 (not a re-file); B434 replaces B161's shape (progress kept).
     lint 0 errors · 1335 tests · build green. -->

<!-- 2026-06-24: B439 (rename/delete from the breadcrumb switcher) + B440 (the Schedule iframe-bridge
     half) were filed AND built + verified the SAME session per STANDING RULE #1 — full [x] blocks live
     in BACKLOG-DONE.md (branch `claude/beautiful-archimedes-0qjr3w`). Site (uncontrolled) path proven
     headless 7/7 (`ui-audit/verify-b439-b440-project-manage.mjs`) + 4 store unit tests; the Schedule
     (controlled/bridge) path is symmetric command-plumbing reusing the embedded app's existing
     renameProject/deleteProject — it can't boot headless in the offline sandbox (CDN + its own backend
     blocked), so it's logged for a signed-in live check in VERIFICATION.md. The brief's "verify first"
     was confirmed: the embedded scheduler ALREADY had internal renameProject/deleteProject, so B440 was
     just plumbing (+ a skipConfirm flag so the breadcrumb's inline confirm doesn't double-prompt). -->

### B423 — Shared markup/measure tool engine + Bluebeam-parity refinement loop `[Site Planner + Doc Review / Markup]` (umbrella)  *(owner-dropped 2026-06-23 as the "Shared Markup/Measure Tool Engine" brief; first minted B421 but RENUMBERED to **B423** on merge-in of main — the concurrent PR #320 had already taken B421 (Arrange) + B422 (Layers); B423 = highest real B# across both files (B422) + 1; plan — `/root/.claude/plans/planyr-shared-tidy-avalanche.md`)*
One shared markup/measure engine in `src/shared/markup/` that BOTH workspaces (and the Stitcher) consume, bringing every tool to Bluebeam-equivalent behavior, plus a committed machine-checkable tool×property matrix + an automated tester so future tool work converges on its own. The brief's "NEW-#" are scratch labels; real filed IDs are B424+. Owner decisions locked: tools RIGHT / properties LEFT in both; Arrow = an arrowhead toggle on Line; verifier = the full cloud rig (B278/B280/B281) built first. Sub-items, in dependency order:
- `[x]` **B424 (NEW-1) — the tool×property matrix as data. DONE this session.** (see BACKLOG-DONE.md)
- `[x]` **B425 (NEW-2) — the shared engine's PURE layer. DONE this session.** (see BACKLOG-DONE.md)
- `[x]` **B426 (NEW-2 cont./NEW-3) — shared `MarkupRenderer.jsx` + `PropertyPanel.jsx` + host wiring; DocReview gains left property panel.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`, commit 5842a78). (see BACKLOG-DONE.md)
- `[x]` **B427 (NEW-4) — Document Review parity tools: Line, Polyline, Polygon, Ellipse.** DONE same commit as B426. (see BACKLOG-DONE.md)
- `[x]` **B428 (NEW-5) — property-set completion to the matrix in both (stroke/width/style/opacity, fill+fill-opacity, full text controls, set-as-default, Reuse mode, keep inline Calibrate).** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`, commit 192c63a). (see BACKLOG-DONE.md)
- `[x]` **B429 (NEW-6) — new tools: Arc, Dimension, Pen, Highlight, Eraser (pen/highlight only), Snapshot; Arrow = arrowhead toggle on Line.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`). (see BACKLOG-DONE.md)
- `[x]` **B430 (NEW-7) — Count as a first-class measure in the Site Planner.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`, commit 285836b). (see BACKLOG-DONE.md)
- `[x]` **B431 (NEW-8) — unified interaction model + edit handles (reuse `shouldPan`; convert ParcelDrawing's residual `window.prompt` calibrate to inline `numEdit`).** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`). (see BACKLOG-DONE.md)
- `[x]` **B432 (NEW-9) — per-tool matrix assertions extending the B278 suite, landed as each tool row lands; encode the loop driver into CLAUDE.md.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`). (see BACKLOG-DONE.md)
- **Prereq harness (Phase 0):** `[x]` **B278 (Playwright e2e — built, smoke green) + B281 (CI auto-`@claude` loop — built) DONE this session** (see BACKLOG-DONE.md). `[x]` **B280 (seeded test account) — DONE by owner 2026-06-24** (account + seed.sql + the 3 CI secrets `E2E_EMAIL`/`E2E_PASSWORD`/`E2E_BASE_URL` are live); the auth-gated loop now runs in CI. (see BACKLOG-DONE.md)

<!-- B438 (browser-side GIS imagery cache: service worker + IndexedDB) was SUPERSEDED mid-session by
     B445 (server-side, Drive-backed cache) on the owner's call "I don't want it to live in the browser"
     — a per-browser cache doesn't follow you between computers + isn't the professional home for
     outage resilience. The SW/IndexedDB code was retired (gis-sw.js → self-unregistering tombstone;
     gisImageCache.js/gisSwRules.js deleted). Both B438 (superseded) + B445 (shipped) blocks live in
     BACKLOG-DONE.md. (Renumbered B439→B445 on 2026-06-24: a concurrent session had also minted B439
     for the breadcrumb rename/delete feature — see BACKLOG-DONE.md B439/B440 — so this GIS item took
     the next free B# to clear the collision.) -->

### B445 — GIS layer imagery caching, server-side (Drive-backed, cross-device) `[Site Planner / GIS]` (feature) — roadmap Track-1 #1; SHIPPED  *(2026-06-24; renumbered from B439 to clear a collision)*
`[x]` Government layer *pictures* (FEMA flood, wetlands, utilities) keep painting when the agency server is down, follow the user between devices, and are stored off the user's machine — replacing the browser-side B438. The map points raster (export-image) layers at a same-origin Cloudflare Function `/api/gis-cache/*` that fetches the agency server-side (no CORS wall), keeps a durable copy in the existing Google Drive, refreshes in the background (stale-while-revalidate), and FAILS OPEN (302 → agency) on any miss-and-failure / missing creds / error. Client also one-shot falls back to the direct agency URL if the proxy isn't serving, so a layer always renders (caching is pure enhancement). Default ON; `VITE_GIS_PROXY=0` is the kill switch. Pure core `src/shared/gis/gisProxyCore.js` (svc-URL encode/parse + cache key + freshness, 15 tests) + testable handler `functions/api/gis-cache/_handler.js` (SWR/fail-open, 12 tests, in-memory Drive). Age badge via the proxy's `?meta=1` sidecar → existing onStatus `{ts,stale}` channel. Reuses the live Drive creds (`GOOGLE_*`, server-side only) — no Supabase, no new secret. DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`, PRs #328 + #329); see BACKLOG-DONE.md. **Bring-up fix (#329):** the gov host (`hazards.fema.gov`) 403s a bare server-side User-Agent → every request fail-opened (nothing cached); fixed by sending a browser UA on upstream fetches (root cause isolated live via a temporary `?diag=1` probe; the datacenter-IP-block fear was disproven). **✅ VERIFIED LIVE on planyr.io:** real FEMA export → 200 image/png and `?meta=1` → `cached:true` with a ts (fetch → Drive store → serve → age, end-to-end). Only an in-app visual glance remains (V129).

- `[x]` **B436 — e2e: open a PDF in the per-tool rail-arm specs so Section B actually executes.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`). (see BACKLOG-DONE.md)

<!-- 2026-06-23: owner-dropped pair "NEW-1/NEW-2" (Markup z-order + named markup Layers). Highest B#
     across both files was B420, so minted **B421** (NEW-1) + **B422** (NEW-2). Deduped: both net-new
     (NOT B397 Scheduler-Gantt z-order, NOT the CSS stacking-context fixes, NOT B33/B374 markup
     hit-testing — B421 REUSES that). Per the brief's per-item disposition:
       • B421 (NEW-1) was BUILD-AND-MERGE — filed AND built + verified + shipped to main the SAME
         session per STANDING RULE #1 (branch `claude/gallant-turing-mcempv`); full [x] block lives in
         BACKLOG-DONE.md. New pure `doc-review/lib/arrange.js` + 14 unit tests; keyboard chords (e.code,
         before the `if (mod) return` early-out) + a portalled right-click menu in DocReview.jsx;
         Stitcher skipped (measures-only). Headless V122 (`ui-audit/verify-b421-arrange.mjs`) 17/17 ·
         lint 0 · 1335 tests · build green.
       • B422 (NEW-2) is LOG-ONLY — a ROADMAP STUB (named markup Layers) that needs a design pass
         BEFORE any build; it stays Open below, unbuilt. -->

### B422 — Named markup Layers (show / hide / lock / rename / reorder) `[Doc Review / Markup]` (feature) — ROADMAP STUB, design pass required before build  *(owner-dropped 2026-06-23 as "NEW-2"; minted **B422**)*
`[ ]` **PARKED — file only, do NOT build yet (a design pass must land first).** CAD-/Bluebeam-style named layers for the markup surface: group markups into named layers ("Existing", "Demo", "My redlines", "GC's markups"), each with show/hide, lock, rename, delete, and reorder. Distinct from & complementary to the Arrange z-order ops (**B421**, shipped): Arrange controls draw order **within** a layer; Layers organize the whole sheet. Strategic value is organizational — isolate one reviewer's markups, lock an as-built, separate civil from architectural — which maps onto the multi-reviewer / multi-customer direction.
- **Why it can't be a quick handoff (the open design questions):**
  - **Data-model change + migration.** Each markup gains a `layerId`; the review gains a `layers` collection (`id, name, visible, locked, order`). Old saved reviews migrate on load — markups with no `layerId` fold into a default "Markup" layer. Use the existing version-bump + `migrate` discipline (same pattern as the Site Model `SITE_MODEL_VERSION` migrations), not an ad-hoc reshape.
  - **Active-layer concept.** New markups land on the active layer → needs a clear, always-visible indicator of which that is.
  - **Render + hit-testing.** The render path filters out hidden layers; `hitTest` (B33) must skip markups on hidden OR locked layers so you can't grab what you can't edit.
  - **Arrange interplay.** B421's four reorder ops become "arrange **within** the active layer" — reuse them, don't fork.
  - **New UI surface.** A Layers panel in the right rail (alongside Takeoff); reuse the portal-menu pattern (`AnchoredMenu`/B127) for per-layer menus.
  - **Delete-layer is a "silence is a crash" hazard.** Deleting a layer must force an explicit choice for its markups (reassign to another layer vs. delete with the layer) via a loud confirmation — never silently drop markups.
- **Next step before any code:** a design pass — a Layers-panel mockup **plus** a written data-model + migration proposal — reviewed and approved first. Do NOT assign to a build session until that lands.

<!-- 2026-06-23: owner-dropped bug "NEW-1" (live) — a parcel grabbed by its empty INTERIOR, not just its
     boundary/setback, so a press in the open interior near (but not on) a footprint selected the LOT
     instead of letting you work on a building sitting there. Highest real B# across both files was B419
     (B416 Split-a-parcel, B417 paste-at-cursor/trailer-parking, B418 building-depth/"Review" label, B419
     token rename — all taken by concurrent PRs #313/#314/#316 while this was in flight), so minted
     **B420** = the next free ID. (The branch/commits/harness/code tags first read B417 per the
     collision-renumber convention, renamed to B420 on the merge-in of main.) Deduped: net-new — the
     INVERSE of B155/B156 (those make small markup-shape interiors grabbable, correct for annotations; a
     parcel is a CONTAINER, so boundary-grab is the right inverse, not a contradiction). LAYERS ON
     B310/B311 (does not replace them): their click-vs-drag intent + "Select parcels" toggle are keyed on
     startMoveParcel, which now simply fires from the boundary hit-stroke instead of the whole fill.
     Reuses B146's fat-invisible-hit-stroke; NOT B213 (inactive parcels already draw no setback line).
     Per STANDING RULE #1 filed AND fixed + headless-verified the SAME session on branch
     `claude/vigilant-cerf-6rvxga` — full [x] block lives in BACKLOG-DONE.md.
     FIX (boundary-only hit model, SitePlanner.jsx): the visible parcel <polygon> is now
     pointerEvents="none" (its fill never grabs, even with a translucent fill toggled on) + a companion
     transparent fat hit-stroke (rgba(0,0,0,0.001), 12 px, pointerEvents="stroke") on the same ring is the
     only grab target; the setback outline gets the same fat hit-stroke (owner: "boundary OR setback"); a
     shared onParcelContext opens the menu from either. Interior = click-through → falls to whatever
     element is painted on top, else the background pan. ~12 px is zoom-independent because f2p already
     projects feet→screen pixels (matches the existing easement-edge picker's flat 12). Preserved +
     re-verified: B310/B311, Shift-merge, align-edge pick, unlocked drag-to-move, B230 vertex editing
     (hit-tests at the svg root, independent of the fill). B311 tooltip reworded "click a lot" → "click a
     lot's edge or setback line" (label only). New regression harness
     `ui-audit/verify-b420-parcel-boundary-grab.mjs` 7/7; repointed verify-b310-b311 / verify-edge-runs /
     verify-edge-runs-irregular off the now-dead interior / `pointer-events="all"` selectors → all green,
     plus verify-b221-b222 / verify-parcel-split-control / verify-b383-add-parcel /
     verify-parcel-resilience still pass. lint 0 · 1320 tests · build green. -->

### B413 — Auto-stitch scanned, scale-less survey sheets that carry NO match-line text `[Doc Review / stitching]` (feature)  *(owner-dropped 2026-06-23 with a real upload "get it to stitch these together correctly"; owner picked approach (A) "build the real OCR auto-stitch"; minted **B413** = highest B# (B412) + 1; IN PROGRESS)*
`[ ]` **Phase 1 (foundation) BUILT + unit-tested (`src/shared/files/ocrMatchLines.js`, 8 tests); NOT yet wired into the live stitch — see remaining blockers below. Do NOT present a topology-only placement as "aligned" (a wrong stitch is worse than an unstitched one).** The owner's GPL topo slice (C-2/C-3/C-4, "TOPO SURVEY I/II/III", NOT TO SCALE, FOR REFERENCE ONLY, 9-item text layer) carries its "MATCH LINE … SHEET N" labels only in the RASTER — so `autoPlaceGroup` (B337) gets nothing.
- **DONE — OCR match-line recovery design, proven on the real pages.** `recoverMatchLines(passes, dims)` runs `parseMatchLines` in EACH orientation pass's own upright frame, then maps the label centre back to page space to pick the edge (`framePointToPage`). Verified against real Tesseract reads: C-2's bottom "MATCH LINE ~ SHEET 2" → side bottom; C-4's left (rotated 90°) "MATCH LINE ~ SHEET 2" → side left. Adjacency for the L-layout (C-2 over C-3, C-4 right of C-3) is fully recoverable.
- **✅ DONE (2026-06-23) — blocker #3, the hard CV tail: pixel-precise seam alignment. BUILT, tested, wired, proven seamless on the owner's real C-2/C-3 scans.** New pure module `src/shared/files/matchLineFit.js` (1-D horizontal CLOSE bridges the dashes → OPEN drops text/crossing strokes → RANSAC fits the line over the full width, with a span guard so a short horizontal note can't masquerade as the seam) + browser glue `doc-review/lib/matchLineRefine.js` (`refineGroupPlacements`: BFS the seam graph, re-derive each neighbor's matrix from the REAL match line via `solveM`, then `slideRefine` connects the crossing linework). Handles the ~1° inter-sheet skew (recovered −0.938° on the real pair, matching a Python reference exactly) and the inset/dashed line. Wired into `Stitcher.jsx` (`renderPageToImageData` → binarize → refine) as a **best-effort, fail-safe** pass: any sheet it can't fit confidently — or whose correction isn't a plausible nudge (`plausibleRefine`) — keeps its label-based placement, so it only ever improves a seam, never breaks one. 24 unit tests; verified end-to-end through the real exported functions on the actual sheets (seamless composite). Removes the old "topology-only ⇒ keep aligned:false" limitation for any set that reaches the refiner.
- **REMAINING blockers (only the RECOGNITION layer that feeds the now-working aligner; needed for fully-automatic on these specific compressed scans):**
  1. **OCR reliability/perf.** Tesseract on these COMPRESSED scans is inconsistent across scale/orientation/PSM (a label read at one render setting is missed at another) and OCR-ing every sparse page at 3 orientations is slow. Needs tuning (edge-band crops at a fixed legible scale, per-orientation PSM) + a conservative trigger (only a sparse-text drawing with no text match-lines) and likely a worker budget. Until labels are read, `autoPlaceGroup` builds no adjacency → the aligner isn't invoked → sheet stays manual-Align.
  2. **Sequence-target resolution.** Labels reference by SEQUENCE ("SHEET 2" = the 2nd sheet = C-3), not the "C-3" code — `autoStitch.buildAdjacency` keys on `sheetNumber`, so a numeric target must resolve to the Nth group member (prototyped, not yet in code).
- **Honest note for the owner:** the seamless-join ENGINE is done and proven on your sheets. For it to run hands-free on these "FOR REFERENCE ONLY / NOT TO SCALE" compressed scans, the app must also reliably recognize which scanned sheet neighbors which (blockers #1–#2 above). A vector CAD set (or sheets whose match-line text + numbers read cleanly) auto-stitches AND now gets the pixel-perfect seam today.

<!-- 2026-06-23: owner-dropped pair "NEW-1/NEW-2" (with screenshots) — trailer parking generated on a
     building's NON-dock sides + the building "depth" reading the truck-court depth. First minted B416/B417,
     but a concurrent `main` (PR #313) took **B416** for the Split-a-parcel control while this was in flight,
     so **renumbered B417** (trailer on non-dock sides) + **B418** (building depth reference) — the real next
     free IDs. (The branch `claude/exciting-allen-i2eq2k`, PR #314, the commits, and the code/test tags + the
     `ui-audit/verify-b416-b417.mjs` harness still read B416/B417, per the collision-renumber convention.)
     Per STANDING RULE #1 BOTH were filed AND fixed + unit-tested + headless-verified (V120) the SAME session
     — full [x] blocks live in BACKLOG-DONE.md. Root cause (evidence-first, the filed hypothesis was off):
     a dock-zone stack stays pinned to the side it was created on, so a reshape / dock-preset change stranded
     the court→trailer→buffer on a now-non-dock side; the named legacy opp-trailer suspect was already dead
     code (removed). lint 0 · 1285 tests · build green. Deduped: net-new. -->

<!-- 2026-06-23: owner-dropped bug "NEW-1" (live) — "no way to reach the Split tool; the 'Split a parcel'
     control is not shown on screen." Highest B# across both files was B415, so minted **B416** = the next
     free ID. Deduped: net-new — NOT B128 (concave-cut split GEOMETRY, intact), NOT B96 (the shared
     Enter/double-click finisher), NOT B130 (which created the rail "Boundary" menu). Per STANDING RULE #1
     filed AND fixed + headless-verified the SAME session on branch `claude/affectionate-wright-gf3kgt` —
     full [x] block lives in BACKLOG-DONE.md.
     GROUNDED THE REPORT FIRST: the rail Boundary ▾ → Split a parcel was NEVER deleted (unchanged since
     2026-06-21 per git blame; scenario A passed on the UNFIXED build), so none of the three suspected
     failure shapes held. Real cause = a discoverability regression from B383: parcel ops (＋ Add parcel,
     Merge) were surfaced into the Parcel PANEL, but Split — the inverse of Merge — was left only in the
     rail. FIX: added "✂ Split a parcel" to the Parcel panel beside Merge (same selectTool("split"), no
     second pipeline; rail menu kept). Smoke-tested the full activate→capture→finish→commit split live.
     Regression guard `ui-audit/verify-parcel-split-control.mjs` (rail + panel reachability + e2e cut)
     11/11. 1273 tests · lint 0 · build green. -->

<!-- 2026-06-23: owner-dropped chat pair "NEW-1/NEW-2" — the Document Review drawing render vs Bluebeam
     (white flash on zoom + softer linework on big sheets). First minted B412/B413, but a concurrent
     `main` (PR #311) took **B412** (title-block reader) + **B413** (auto-stitch surveys) while this was
     in flight, so **renumbered B414** (NEW-1, the flash) + **B415** (NEW-2, the sharpness) — the real
     next free IDs. Per STANDING RULE #1 BOTH were filed AND fixed + unit-tested + headless-verified the
     SAME session on branch `claude/confident-edison-lpbco9` — full [x] blocks live in BACKLOG-DONE.md.
     Deduped: net-new; B415 SUPERSEDES the whole-page raster path B247/B265/B327/B329 (extends it, not a
     fork). Headless harness `ui-audit/verify-b414-b415-render.mjs` 11/11 (detail 2.00× vs would-be
     whole-page 0.95× = 2.11× sharper; backdrop never re-rasters on zoom; detail never blanks through a
     settle) + the B329 viewport harness still 13/13. 1273 tests · lint 0 · build green. -->

### B411 — Auto-filing residual gaps after the multi-discipline split (B410) `[Doc Review / auto-filing]` (bug/task)  *(spun off from B410, 2026-06-23; minted **B411** = B410 + 1)*
`[ ]` Three honest gaps surfaced while testing real Drive files against the new splitter (B410, shipped) — none blocks the shipped feature, but each is a real recognition weakness:
- **(a) Scanned/image-only sets read as nothing in FILING.** A no-text-layer drawing (e.g. "2023.11.06 Mesa - Electrical B1.pdf") has no embedded text, so the local read returns nothing and the file lands in the holding tray. OCR already exists in the STITCHER (B352, `doc-review/lib/ocr.js`, Tesseract); wire that same OCR into the filing read (`localRead.js`) so scanned sheets classify too. Bigger lift (renders pages to canvas), so it's its own item.
- **(b) Date sometimes grabs an old BASE date over the issue/revision date.** "Mesa - Site Plan 2025.09.17.pdf" filed with `2023-04-07`; the latest-date picker isn't preferring the issue/rev date in the title block. Tighten the date selection (prefer a date adjacent to "ISSUED/REV/IFC", and weight the title-block zone).
- **(c) Big combined sets weren't validated here — Drive connector caps downloads at 10 MB.** The richest split cases (GPL Civil IFP 125 MB, Jacintoport MEP 13.6 MB, full Mesa COH sets) couldn't be pulled in-session. Needs a signed-in spot-check on planyr.io (drop a big combined set → expect separate per-discipline PDFs) or a higher-limit fetch path.

### B409 — Large files (>~100 MB) now upload to Drive via a browser-direct resumable path — no more silent "oversize" `[Doc Review / storage]` (bug)  *(owner-dropped 2026-06-23 as "NEW-1"; minted **B409** = highest B# across both files (B408) + 1)*
`[ ]` **Code shipped on branch `claude/quirky-galileo-dm786x` — lint 0 · 1238 tests · build green. ONE step left: a signed-in, deployed ≥100 MB Drive round-trip to confirm the live browser→Google CORS PUT (the sandbox can't sign in or reach Drive — same live-verify gate as B405/B406).** Deduped: net-new — NOT B405 (that's the file-OPEN/read-back taxonomy; this is the WRITE/upload path) and NOT B207 (the Drive cutover, which this completes for big files).
- **Repro (owner, signed in):** a ~125 MB civil PDF ("GPL - Civil IFP 2026.06.19.pdf", 125,176,019 B) flagged "over the 50 MB … couldn't be stored online" and wrote **no** drive_files row; the bytes fell back to Supabase and were rejected as oversize, so the owner's only copy is a manual My Drive upload, not the app's `project-<id>/<discipline>` tree.
- **Root cause (code-confirmed):** `functions/api/files.js` buffered the whole upload in the Cloudflare Worker (`request.arrayBuffer()` → capped by the ~100 MB request-body limit + 128 MB memory) **and** `driveClient.create()` used `uploadType=multipart` (Google's ≤5 MB path) — so a 100 MB+ file could reach neither backend.
- **Fix (additive + regression-safe — only files >50 MB take the new path; ≤50 MB untouched on the proven multipart path, Supabase fallback preserved so behaviour is never worse than today):**
  - `driveClient.createResumableSession()` mints a Drive **resumable** session bound to the browser's `Origin` (for the cross-origin PUT); `createViaResumable()` is the server-side variant (selftest + future server use).
  - New Pages Function `functions/api/files/resumable.js`: `POST` = init (returns the pre-authorized session URL), `PUT` = commit (records the Planyr-key↔Drive-id map). Same Supabase-auth + drive-backend gating as `/api/files`.
  - Client `reviewStore.uploadLargeToDrive()`: init → **PUT bytes straight to Google (never through the Worker)** → commit; `storeSource()` routes >50 MB blobs to it, so neither the body limit nor the memory cap applies (multi-GB works).
  - **Distinct message (part b):** `sourceState` adds a `too-large` state ("re-open to upload — large files now go to Drive"), separate from the legacy 50 MB "oversize" wording; `fileWarn` gets a matching large-file warn.
  - **Recovery (part c):** re-dropping a previously-oversize file re-stores it to Drive **in place** (same `srcId`/`reviewId` → markups stay attached). DocReview already re-stored on open; the Stitcher's `bindSource` now does too. (No bulk byte-migration is possible — oversize bytes were never stored anywhere — so the re-drop, which now works, IS the migration.)
  - **Guard (part a):** `selftest.js` gains a resumable round-trip step (`?mb=N`) so the large-file transport can't regress on the deploy. +9 unit tests (resumable request shapes incl. the `Origin` binding; `too-large` state/copy/warn).

<!-- 2026-06-23: owner-dropped logging task "NEW-1" — record the agreed Supabase org/project naming
     convention in CLAUDE.md so the "Planar vs Planyr" confusion is documented as resolved and future
     env work references the right project. Highest B# was B405 when filed, but a concurrent `main`
     (PR #305/#306) took **B406** for Shared team workspaces while this was in flight, so **renumbered
     to B407** (the real next free ID). Deduped: net-new (no existing Open/Done item covered Supabase
     naming). The owner had already applied the Supabase-side rename himself (org → Planyr, live
     project → planyr-production), so the only work left was the doc — per STANDING RULE #1 it was not
     merely logged but DONE the same session: the convention + the "renaming a display label is
     cosmetic; the client rides the immutable 20-char project ref in VITE_SUPABASE_URL, so no rebuild"
     safety fact were written into CLAUDE.md's "## Supabase" section (beside the build-time-env gotcha).
     A mid-session code check then found the **Scheduler hardcodes a DIFFERENT project ref
     (`ksetjztkplttbcehyicv`) than the main app (`lyeqzkuiwngunutlkkmi`)**, so the doc was corrected to
     flag that the us-west-2 "Planar" project is most likely the Scheduler's LIVE backend (match refs
     before any delete), NOT a deletable spare. README "Deploy secrets" names Supabase only via "the
     anon key" → nothing to reconcile. Doc-only, no code paths. Full [x] block in BACKLOG-DONE.md
     (branch `claude/blissful-hopper-zcijkh`). -->

### B408 — Decide &, if chosen, consolidate the Scheduler onto the main Supabase project `[Infra / Scheduler]` (task) — DECISION-GATED  *(filed 2026-06-23 as the follow-up to B407; minted **B408**)*
`[?]` **Open — BLOCKED on an owner decision; do NOT start any data migration until Michael chooses.** The suite runs on TWO separate Supabase projects: the main app (Site Planner + Doc Review) on ref `lyeqzkuiwngunutlkkmi` (via the Cloudflare `VITE_SUPABASE_URL` build env), and the **Scheduler** (`/sequence/`) on a DIFFERENT ref `ksetjztkplttbcehyicv`, **hardcoded** in `public/sequence/index.html` (tables `planar_data` / `planar_history` / `planar_suggestions`, own anon key). This split predates the "one product" direction — see CLAUDE.md "## Supabase" → the two-project note (B407).
- **The decision (Michael's call):** **consolidate** the Scheduler onto the main project (one backend + one auth/RLS surface; the natural fit for the one-product direction and the new team-sharing work) — OR **keep them split on purpose** and just NAME them per-component (`planyr-production` for the main app, e.g. `planyr-scheduler` for the Scheduler). Both are valid; consolidation is more work and carries live-data risk.
- **Why this is not a same-session fix (the blocker):** if "consolidate" wins it is a real **live-data migration** — stand up `planar_*` tables + RLS on the main project, copy existing rows with zero loss, repoint the Scheduler's ref/key (ideally off the hardcode and onto the build env like the main app), and cut over with a rollback path. A planned migration over production schedule data, not a quick edit — the genuine "needs a decision + too large for one run" case the backlog exists for.
- **Scope when greenlit (consolidate path):** (1) `planar_*` table + RLS parity on the main project; (2) one-time data copy + row-count verify; (3) repoint the Scheduler (prefer env over the hardcode); (4) keep the old project read-only as a fallback until confirmed; (5) flip the CLAUDE.md two-project note to "consolidated". **If "keep split" wins:** no migration — just finish B407's rename-by-ref cleanup (name each project for what it is) and close this.

### B406 — Shared team workspaces: invite by email, share a project with a team `[Site Planner + Doc Review]` (feature)  *(2026-06-22; "B-TEAM" in the cowork handoff. Filed B365 in-session, but a concurrent `main` had taken B365–B405 — renumbered to the real next free B#406. PR #305 title still says B365.)*
`[ ]` **Shipping — code merged via PR #305; DB phase-2 migrated + verified in PRODUCTION (`lyeqzkuiwngunutlkkmi`); remaining owner step: run `team_storage.sql` (phase 3) for shared-PDF reads.**
Lets a team share a workspace: invite people by email (activates on signup/sign-in even if they had no account yet), admins vs members, and a project stays **private until deliberately shared** (and can revert to private). Additive + private-by-default preserved — a row with `team_id IS NULL` behaves exactly as before.
- **DB (done + verified in prod):** `db/profiles.sql` (email mirror), `db/teams.sql` (teams/team_members/team_invites + `is_team_member`/`is_team_admin` SECURITY-DEFINER helpers + `claim_team_invites`/`list_team_members` RPCs + signup auto-claim), `db/team_sharing.sql` (`team_id` on sites/doc_reviews/file_facts; PK `(user_id,id)`→`(id)`; RLS rewritten to "own OR shared-with-my-team", delete = owner-or-team-admin). Verified end-state: 3 `team_id` cols, `sites` PK = `id`, 12 RLS policies, both helpers present. Pre-flight done (snapshot tables `backup_*_20260622`; 0 dup ids) — **drop the backup tables once confirmed good.**
- **DB (still to run):** `doc-review/db/team_storage.sql` (phase 3) — extra Storage SELECT policy so teammates can open each other's **shared review PDFs**. Until run, that one sub-path is inert (graceful); everything else works.
- **Client:** `optimisticUpsert.casUpsert` updates by `(id,version)` only + stamps `user_id` on INSERT only (creator never re-stamped on a teammate edit); `cloudSync`/`reviewStore` carry `team_id`, delete by id (RLS scopes), team_id-missing graceful degrade; `siteModel` `teamId`/`ownerId` + `teamShareOf` (SITE_MODEL_VERSION→8); `storage.mergePulledSites` doesn't re-push teammates' rows; `lib/teams.js` + `lib/sharing.js`; `SitePlannerApp` claims invites on sign-in; **UI** = Team tab (`TeamPanel`) + account-menu entry, Share-with-team control in the Project Files drawer.
- **Left:** run `team_storage.sql`; signed-in live check (create team / invite / accept / share / concurrent-edit conflict / member-can't-delete) — auth-only, so not headless-testable in the sandbox. See VERIFICATION V118.

<!-- 2026-06-23: owner-dropped COMBINED chat brief (it explicitly supersedes three earlier separate briefs —
     the Markup→Library rename, "open any file fails", and the standalone oversize-banner-copy item — so filed
     from the combined version to avoid double-filing; deduped: no existing Open item covered these). Highest
     B# across both files was B400 when filed, but a concurrent `main` (#297) took B401–B403 for a Scheduler/
     Export batch while this was in flight, so **renumbered B404–B405** (the real next free IDs); the brief's
     B207 item was an AMENDMENT (no new B#). Per STANDING RULE #1 both new items were filed AND fixed + verified
     + merged the SAME session (branch `claude/brave-brown-jb1n2l`) — full [x] blocks live in BACKLOG-DONE.md:
       • B404 (NEW-1) — module tab "Markup" → "Library" (label ONLY; route id `doc-review`/`/markup`, storage
         keys, and the amber accent token names unchanged). The only user-facing "Markup" string was the tab;
         the SitePlanner "Markup line/rect" tool hints are a different feature, left alone. Finish-the-job tail:
         ~15 ui-audit harnesses selected the tab by visible text → repointed to "Library". New
         `verify-b404-library-tab.mjs` 4/4 + repointed `verify-new1-header-integration` 5/5.
       • B405 (NEW-2) — the Files-browser "open any file fails" was ONE conflated banner + a SILENT missing-source
         path. Grounded against real code FIRST: the brief's "the browser reshape drops storageKey/driveKey"
         hypothesis was REFUTED at the open hop (`openReview` → `loadReview(row.id)` re-fetches the full Postgres
         record by id, so the lightweight browser row is never the src) — flagged, not rebuilt. Real fix = a
         4-state taxonomy (oversize / not-stored / fetch-failed / signed-out) in new pure `lib/sourceState.js`
         (15 unit tests), wired through `DocReview.fetchSourceBytes` + the FileBrowser/drawer warns. The
         universal-failure ROOT is a LIVE storage/auth class the logged-out sandbox can't reproduce (most likely
         the `doc-review-files` bucket/RLS unprovisioned, or legacy keyless rows) → a signed-in deploy pass is
         pending (cohort/owner), but the code now names every cause precisely + offers a working re-open recovery
         regardless.
     B207 AMENDMENT (no new B#): the brief assumed Drive was at "scaffold", but the repo already had it
     CODE-COMPLETE + TESTED (advanced past the brief by a concurrent session) — confirmed by a full ground-truth
     read and the B207 entry below was updated to match; the one remaining step is the owner's Google/Cloudflare
     provisioning. lint 0 · 1228 tests · build green. -->

<!-- 2026-06-22: owner-dropped chat batch (exported Gantt QUALITY) — arrived NEW-1..NEW-4, first minted
     B393–B396, but a CONCURRENT session shipped its OWN B393–B396 (Gantt labels + curved connectors) to
     `main` while this was in flight, so **renumbered B397–B400**. Per STANDING RULE #1 filed AND fixed +
     headless-verified (V115, 12/12) + merged the SAME session on branch `claude/gifted-hypatia-na62be`:
     B397 (vertical rules behind bars), B398 (one continuous left edge), B399 (light two-tier Year▸Month
     header + weighted year>quarter>month grid rules, owner-art-directed), B400 (viewBox fit-to-width +
     Move/zoom drag-pan in the preview). The owner approved ELBOW connectors here, but the concurrent
     session had already settled connectors with later, more-informed owner feedback ("the serpentine ones
     were fine, I preferred those, revert — they just weren't bound to the bars"), so on owner confirmation
     this session the elbow work was DROPPED and main's curved-bound connectors (their B396) kept. Full [x]
     blocks in BACKLOG-DONE.md. -->

<!-- 2026-06-22: owner-dropped chat trio "NEW-1/NEW-2/NEW-3" — Gantt label alignment + uniform ink,
     printed-Gantt missing names, and serpentine dependency arrows. First minted B390/B391/B392, but a
     concurrent `main` (PR #293, the PDF/Print Exhibit table-layout batch below) took B390/B391/B392
     while this was in flight, so **renumbered B393 / B394 / B395** (the real next free IDs). Deduped:
     all NET-NEW — no existing item covered Gantt label alignment / in-chart PDF names / orthogonal
     connectors; the prior "NEW-1"s (B383/B385–B388) were Site-Planner or Schedule-toolbar items, and
     the B390–B392 collision is the exhibit batch (a different surface). Per STANDING RULE #1 all three
     were filed AND fixed + headless-verified + shipped the SAME session (branch
     `claude/zen-ramanujan-14sak9`) — they share ONE label/render pass in GanttView + buildGanttSVG, so
     landed together. Full [x] blocks live in BACKLOG-DONE.md; headless harness V114
     (`ui-audit/verify-gantt-labels-deps.mjs`, all checks across right/center/left). -->

<!-- 2026-06-22: owner feedback right after B393/B394/B395 shipped — "the serpentine things were fine,
     i preferred those, revert, the issue was just that they weren't bound to anything". Minted **B396**:
     reverted B395's orthogonal elbow back to the curved bézier in both render paths AND fixed the real
     defect (the curves floated at the row mid-line; now bound to each bar's vertical center). Full [x]
     block in BACKLOG-DONE.md; verified via the updated V114 harness. -->

<!-- 2026-06-22: owner-dropped chat batch (PDF/Print Exhibit table layout) — three items from one
     screenshot+voice note. Filed B385/B386/B387, **renumbered B390/B391/B392** — concurrent `main`
     (PRs #290/#291/#292) took B385–B389 while this was in flight, so B390–B392 are the real next free
     IDs (branch commit/PR titles still read B385/B386/B387). Per STANDING RULE #1 all three were filed
     AND fixed + headless-verified (V113, 10/10) + merged via PR #293 the SAME session on branch
     `claude/practical-edison-ggcm1k` — full [x] blocks live in BACKLOG-DONE.md:
       • B390 (bug)  — exhibit columns mis-sized: oversized Task-Name gap + truncated Start/End/Dur.
                       Split table used table-layout:fixed at hardcoded ~50% width with fixed per-column
                       px and Name at w:null (absorbed the slack → the gap; dates clipped in the
                       too-narrow fixed cols). Replaced with a content-fit model (pure approxTextPx +
                       layoutExhibitCols); dates/dur never flex.
       • B391 (feat) — year-boundary divider lines on the exhibit Gantt (month lines were hidden behind
                       the opaque row bands). Heavier slate line at each Jan 1, drawn over the bands;
                       January labels emphasized.
       • B392 (feat) — drag-to-resize columns in the preview (mirrors the live grid's col-resize),
                       reflowing live + persisted (data.exportColWidths) + a Reset.
     Deduped: net-new. B392 RECONCILED with B160 (see its note) — complementary, not a dup. -->

<!-- 2026-06-22: owner-dropped chat item — "put the light v dark option under profile settings".
     Minted **B389**. Per STANDING RULE #1 fixed + headless-verified (V112, 7/7) the SAME session on
     branch `claude/inspiring-bohr-46gql9` — full [x] block in BACKLOG-DONE.md.
     WHAT SHIPPED: the Light/Dark/System picker moved from the row-1 ⚙ gear into account → Settings
     (AuthPanel), next to Change password. Extracted a shared `src/shared/theme/ThemePicker.jsx`
     (one picker, used by both the Settings panel and the gear). The row-1 gear is KEPT only when
     signed out (`{!accountActive && <SettingsMenu/>}`) so a logged-out visitor can still switch
     (B342 preserved) without duplicating it for signed-in users. Pure relocation — ThemeProvider /
     data-theme / System listener unchanged. lint 0 · 1201 tests · build green; B387/B388 harnesses
     still green (the logged-out gear they rely on is preserved). -->

<!-- 2026-06-22: owner-dropped chat item "NEW-2" — lift Schedule's toolbar up into the unified
     AppHeader so Schedule has ONE header like Site/Markup (built on the B387 center slot). Filed
     B386, **renumbered B388** — a concurrent `main` (PRs #289/#290) took B385/B386 while this was in
     flight, so B387/B388 are the real next free IDs (branch commit titles still say B385/B386).
     Owner GREENLIT building it the same session, so per STANDING RULE #1 it was fixed + headless-
     verified (V111, 17/17) on branch `claude/inspiring-bohr-46gql9` — full [x] block in BACKLOG-DONE.md.
     WHAT SHIPPED: the embedded Gantt app's action toolbar now renders up in the shell's Row-2 header —
     Grid/Split/Gantt + review inbox in B387's `toolbarCenter`; zoom/export/save/history/contacts/
     automation/format/settings in `toolbarContent`. The feared popover-anchoring blocker was
     UNFOUNDED: the embedded app already renders its panels as self-positioned fixed modals/drawers
     (never anchored to buttons), so lifting the trigger buttons is clean — buttons post `planar:*`
     commands, panels still open in the iframe. The B203 bridge was extended (planar:toolbar-state +
     command messages), strict same-origin guards kept, iframe stays source-of-truth (badge = reported
     count, never fabricated). `.in-iframe .app-header{display:none}` hides the whole in-embed header
     (re-widening what B381 narrowed); standalone /sequence/ untouched (inShell-gated). Two settings
     gears kept separate (B342 vs Schedule view); "share" = the existing Contacts control. SUPERSEDES
     B381's harness `verify-schedule-toolbar.mjs` (retired). New `ScheduleToolbar.jsx`; edits to
     Scheduler.jsx + index.html. lint 0 · 1201 tests · build green · JSX OK · lazy chunks intact. -->

<!-- 2026-06-22: owner-dropped chat item "NEW-1" — add an optional CENTER toolbar zone to AppHeader
     Row 2 (a third slot between the module tabs and the right toolbar, mirroring how Row 1 centers
     the project name). Filed B385, **renumbered B387** — concurrent `main` (PR #289) took B385 while
     this was in flight; canonical IDs for this pair are B387 + B388. Per STANDING RULE #1 it was fixed +
     headless-verified (V110, 9/9) the SAME session on branch `claude/inspiring-bohr-46gql9` — full [x]
     block lives in BACKLOG-DONE.md.
     WHAT SHIPPED: a new optional `toolbarCenter` ReactNode prop on AppHeader. When provided, Row 2
     becomes 3 zones — tabs (flex:1) | center group (shrink) | toolbar (flex:1 end) — center TRULY
     centered like Row 1 (mid-x 719 vs 720); it wraps on narrow widths and never overlaps. Absent
     (Site/Markup) → the original 2-zone layout renders byte-for-byte unchanged. Generic + additive;
     B388 (the Schedule toolbar lift) is its first consumer. Deduped: net-new — NOT the CloudSyncBadge
     "NEW-1" (a Row-1 saveState concern), NOT the Markup toolbarContent move. lint 0 · 1201 tests ·
     build green · AppHeader/Scheduler/SitePlannerApp lazy chunks intact. -->

<!-- 2026-06-22: cross-chat "NEW-1" — Schedule Gantt drew phantom dependency arrows into empty
     space, pointing at unscheduled (blank-date) tasks. First filed B385, **renumbered B386** — a
     concurrent `main` (PR #289) took B385 for the Site Planner parcel-identify feature while this
     was in flight, so B386 is the real next free ID. Filed AND fixed + headless-verified (V109) +
     SHIPPED the same session per STANDING RULE #1 — merged to `main` via PR #290 (branch
     `claude/gifted-rubin-0adp7h`). Full [x] block lives in BACKLOG-DONE.md. -->

<!-- 2026-06-22: owner-dropped chat item "NEW-1" — add an "Add parcel" front-door to the Parcel
     left-hand panel so you never have to back out to the map to assemble more land. Highest B#
     across both files was B382, so minted **B383** (+ filed the deferred "Add by address" stretch
     as **B384**, still Open). Per STANDING RULE #1 B383 was filed AND fixed + headless-verified
     (V108, 14/14) + merged the SAME session on branch `claude/determined-volta-hzjxmc` — full [x]
     block lives in BACKLOG-DONE.md.
     WHAT SHIPPED: a primary **＋ Add parcel** control (accent chip) at the top of the Parcel
     `Section` opens an `AnchoredMenu` with (1) "Identify from county GIS" (arms the existing
     `identifyMode`; disabled-copy gate when `origin` is null) and (2) "Draw a new boundary"
     (`selectTool("parcel")`, always enabled — the no-GIS-frame fallback). The standalone
     "🔍 Identify parcel" toggle was CONSOLIDATED into that menu (no duplicate entry point); the
     armed-status row (the off-switch) + the identify result card / ＋ Add to plan / ⚖︎ Jurisdiction
     stay intact as the body of that path. Pure surfacing — reuses `addIdentifiedParcel` /
     `setParcels` / `identifyMode` / the parcel draw tool (no new add pipeline; same single-pipeline
     rule as B232/B233); added parcels keep `locked:true` (B99).
     Deduped: net-new. NOT B233 (that's the *map's* address→select+info card), NOT B231/B36c (the
     multipart-import pipeline it reuses), NOT B99/B100 (the lock/active model it inherits). lint 0
     · 1201 tests · build green · `SitePlannerApp` lazy chunk intact. B384 (Add by address) left Open
     by design — the geocode logic lives in MapFinder and needs a clean extraction, not a rush. -->

<!-- 2026-06-22: owner follow-up on B383 — "it should work like the map select parcel tool where the
     parcel boundaries light up and you can easily click to add one or multiple." Minted **B385**.
     Per STANDING RULE #1 filed AND fixed + headless-verified (V108 extended, 22/22) the SAME session
     on branch `claude/determined-volta-hzjxmc` — full [x] block in BACKLOG-DONE.md.
     WHAT SHIPPED: the "Identify from county GIS" path now behaves like the map's Select-parcels tool —
     while it's armed, the county parcel OUTLINES light up on the aerial (the SAME magenta esri-leaflet
     `makeParcelLayer`, extracted to shared `lib/parcelDisplay.js` so map + planner share one source),
     and each CLICK adds that lot straight to the plan (one or many); a re-click toggles a just-added
     lot off; a drag pans (click-vs-drag resolved in onUp, mirroring B310). The old preview-card-then-
     "＋ Add to plan" button is gone — the card now shows the just-added lot's appraisal + the kept
     jurisdiction lookup. Reuses the single add path (`parcelsFromRings`) + the existing query; outlines
     load at zoom ≥14 like the map (a "zoom in" hint below). Deduped: the headline-UX completion of B383
     (same item family), NOT B233 / B231. lint 0 · 1201 tests · build green · lazy chunk intact. -->

### B384 — "Add by address" inside the Parcel panel (geocode → identify) `[Site Planner]` (feature) — the deferred stretch of B383  *(filed 2026-06-22; minted **B384**)*
`[ ]` **Open.** Follow-up to B383's ＋ Add parcel menu: a third add method that takes a typed address, geocodes it, and runs the identify pipeline on the resulting point — so a user can add a parcel by address without leaving the planner. **Why not in B383:** the geocode→camera→select logic (`goAddress`/`geocodeAddress`/`selectParcelAt`) currently lives in `MapFinder.jsx` and is wired to the map camera; surfacing it in the planner is a clean-extraction job (pull the geocode + point-identify into a shared helper both surfaces call), not a one-liner — doing it carelessly would fork the address pipeline, the opposite of B383's reuse rule. Scope: extract the geocode + point-query into `lib/` (or reuse `addIdentifiedParcel`'s `identifyAt` with a geocoded point), add an inline address input to the ＋ Add parcel menu, verify it lands the parcel in the site frame.

<!-- 2026-06-22: cross-chat "NEW-1" — the Schedule Gantt/timeline toolbar was reduced to a single
     floating Columns button (timeline zoom, Contacts, Export PDF/print, Version History, the
     Grid/Split/Gantt view switcher, Automation, Settings, Review all gone). First filed B380,
     renumbered **B381** — concurrent main (PR #284) took B380 for the Schedule render-crash fix while
     this was in flight, so B381 is the real next free ID. Per STANDING RULE #1 filed AND fixed +
     headless-verified (V106, 15/15) + merged the SAME session on branch `claude/vigilant-newton-rovl4l`
     — full [x] block lives in BACKLOG-DONE.md.
     ROOT CAUSE (hidden, NOT deleted): the Schedule module embeds /sequence/ in an iframe; the shell's
     Row-1 breadcrumb takes over project nav, so the sequence app hides its own duplicated nav when
     `.in-iframe`. But the rule was `.in-iframe .app-header{display:none}` — it hid the ENTIRE header,
     and the whole action toolbar lives in that header. Only the in-grid Columns button (in GridView,
     not the header) survived — exactly the reported symptom. Handlers were intact throughout; a pure
     CSS over-reach.
     FIX (public/sequence/index.html): narrowed the rule to hide ONLY the duplicated branding/nav —
     the logo (new .hdr-logo class), .hdr-mode (Dashboard/Projects toggle) and .hdr-project (project
     picker), all provided by the shell breadcrumb via the B203 postMessage bridge. The action toolbar
     is visible again, original position + original handlers. Restored exactly the shipped set — the
     brief's speculative fit-to-view / today-jump / status-filter controls do NOT exist in this app, so
     none were invented (no rebuild-from-guess).
     Verified: V106 `ui-audit/verify-schedule-toolbar.mjs` 15/15 (zoom % changes 17→33, Contacts opens
     — proven not no-ops); Site + Markup checked, NOT affected (not iframes; they use the shell's
     toolbarContent slot, which `.in-iframe` can't reach). lint 0 · tests green · build green ·
     `Scheduler` lazy chunk intact.
     Deduped: NET-NEW, the completion of B203 (DONE) — B203 bridged the NAV half of the same hidden
     header; B381 restores the ACTION-TOOLBAR half it left dark. NOT a dup of main's B380 (a separate
     Schedule render-crash race in Scheduler.jsx — different file, different cause), nor B341 (chrome
     token regressions), nor the Markup toolbarContent move. -->

<!-- 2026-06-22: cross-chat diagnosis brief "NEW-1" — intermittent render crash on Schedule load
     ("Cannot read properties of undefined"), caught by the workspace ErrorBoundary (the non-chunk
     "Try again" variant), recovers on re-render. Highest B# across both files was B379, so minted
     **B380**. Per STANDING RULE #1 filed AND fixed + headless-verified (V105, regression net proven
     to FAIL with the guard off) the SAME session on branch `claude/relaxed-dijkstra-sokq4a` — full
     [x] block lives in BACKLOG-DONE.md.
     ROOT CAUSE confirmed by reproduction, not guessed: the Schedule shell derives its breadcrumb's
     current project with `projects.find(p => p.id === activeId)` over the project list bridged from
     the embedded /sequence/ iframe (the brief's #1 candidate, Scheduler.jsx). The embedded app can
     transiently post a sparse/not-yet-resolved list (an `undefined`/null entry) during its own data
     load; one such entry makes `p.id` throw inside the Scheduler's render → the workspace boundary.
     A pure re-render recovers because the steady-state list is well-formed. (The brief's other
     candidates — AppHeader/ProjectBreadcrumb p.id/p.name, useProfile/displayName — were verified
     already null-safe; the deref that actually throws is the Scheduler's `.find`.)
     FIX (guard at the source, not optional-chaining everywhere): new pure `scheduler/lib/navState.js`
     — `parseNavState` validates + `sanitizeProjects` coerces the inbound list to plain `{id,name}`
     objects (drops the throwing entries) and `deriveCurrentProject` never throws / never returns
     undefined; Scheduler.jsx routes the message + current-project derivation through them; one
     data-entry guard in the shared `ProjectBreadcrumb` (`.filter(Boolean)`) hardens its own `p.id`/
     `p.name` map for any controlled caller. NOT a chunk fix (not B221/B239) and NOT an ErrorBoundary
     auto-retry — the race is removed so a genuine future crash still stays visible.
     Deduped: net-new. NOT B221/B239 (stale-chunk family — the brief's two tells rule that out), NOT
     B315 (undo-after-move stale-ref race, a different surface). 12 new unit tests
     (`test/schedulerNavState.test.js`), 1198 green, lint 0, build green, `Scheduler` lazy chunk
     intact; existing `verify-schedule-picker.mjs` still 8/8 (no regression). -->

<!-- 2026-06-22: owner report "the sheet labeling is atrocious" (a structural general-notes set)
     arrived with a two-item investigation brief (NEW-1 garbage labels, NEW-2 false auto-calibration).
     Highest B# across both files was B373, so minted **B378–B379**. Per STANDING RULE #1 BOTH were
     filed AND fixed + headless-verified (V104) the SAME session on branch `claude/ecstatic-maxwell-6y8aq1`
     — full [x] blocks live in BACKLOG-DONE.md:
       • B378 (NEW-1) — text-dense sheets labelled garbage: body boilerplate as the title, a body
         cross-reference ("S202") read as the sheet number on several rows, weak sidebar gate. Fixed
         the shared `sheetMeta` reader — title scorer now prefers short+large type (+ boilerplate
         filter), the sheet number is read from the title-block ZONE only (band, else edge strip),
         `reconstructLines` splits on a large horizontal gap so a title can't merge into a body line,
         a `trustedTitle` sidebar gate, and a `markAdjacentDuplicateNumbers` dedup. SHIPPED.
       • B379 (NEW-2) — a pure-text notes/specs sheet auto-calibrated off a stray body scale string.
         Added a `textDense` classification; `statedCalibration` returns 0 for it (leaves it
         uncalibrated, never silently mis-scaled). SHIPPED.
     +10 unit tests, 1153 green · lint 0 errors · build green · `DocReview` lazy chunk intact ·
     headless `ui-audit/verify-notes-sheet-labels.mjs` 9/9 + the B266/B348, B335–B339, B350 markup
     harnesses still green. -->

<!-- 2026-06-22: owner-dropped chat item — "the fact that I don't have an easy way to delete this little
     triangle that I put there is insane … go through all the tools and figure out what we need to debug."
     The "triangle" was an UNCALIBRATED Area measurement (its label falls back to "set scale"). Highest B#
     across both files was B373, so minted **B374–B377**. Per STANDING RULE #1 all filed AND fixed +
     headless-verified + shipped the SAME session (branch `claude/youthful-mccarthy-xjcotz`) — full [x]
     blocks live in BACKLOG-DONE.md:
       • B374 (bug) — the Area's FILLED interior was a DEAD click target (DocReview hitTest tested area by
         vertex/segment only, while rect/cloud already had an interior test, B33), so the triangle couldn't
         be selected to delete it. Added area point-in-poly to hitTest (reusing the now-exported
         takeoff.pointInPoly) + a smaller-shape tie-break + the perimeter/area closing edge. SHIPPED.
       • B375 (feature) — added an on-canvas × delete on the selected markup (deletion had been keyboard-only
         + a button buried in the collapsible Takeoff panel). SHIPPED.
       • B376 (feature) — the Takeoff list now lists + deletes EVERY markup (not just measures); the Stitcher
         — which had NO committed-measure delete at all — gets a deletable measure list. SHIPPED.
       • B377 (bug, found while verifying) — the B352 Tesseract OCR worker threw "logger is not a function" on
         every no-text page (defaultMakeWorker passed logger:undefined, clobbering Tesseract's default no-op);
         defaulted it to a no-op. Stitcher harness uncaught JS errors 13 → 0. SHIPPED.
     Verified: `verify-delete-markup.mjs` 10/10 + `verify-stitch-delete-measure.mjs` ALL PASS (chromium-1228,
     0 page errors); no regression (V72 13/13, B300–B302 green, V88 green). lint 0 · 1144 tests · build green. -->

<!-- 2026-06-22: coworker live-investigation brief (Site Analysis GIS failures on Grand Port /
     Mont Belvieu) arrived as NEW-1..NEW-4. Highest B# across both files was B365, so minted
     **B366–B369**. Per STANDING RULE #1 all four were filed AND fixed + verified + (about to be)
     merged the SAME session on branch `claude/nice-cori-ghm37q` — full [x] blocks live in
     BACKLOG-DONE.md:
       • B366 (NEW-1) — screening resilience + honest error taxonomy: a shared resilient ArcGIS
         fetch (timeout + jittered-backoff retry + GET→POST), a concurrency pool (3) that ends the
         burst, and a new UNAVAILABLE state (retryable, Retry control) — never the misleading
         "network or CORS". SHIPPED.
       • B367 (NEW-2) — GIS screening cache: keep last-good on a failed refresh + "couldn't refresh"
         age badge (stale-while-revalidate), never blank a layer. The existing roadmap "GIS layer
         caching" item, Phase 1. SHIPPED. (Phase 2 = regional snapshot → B371, Later.)
       • B368 (NEW-3) — repointed Wells/Pipelines from the Harris-County republication (Chambers
         14-vs-8,014 false-clean) to the authoritative statewide **RRC** service (wells L1, pipes L13);
         Wetlands pinned as a registered monitored-exception. SHIPPED.
       • B369 (NEW-4) — GIS Source Registry (`src/shared/gis/sources.js`) + a CI tier/inline-URL guard
         + live coverage/schema fixtures (the 14-vs-8,014 catch) + a weekly @claude drift workflow.
         SHIPPED for the analysis+jurisdiction surface. (Map-display-layer migration tail → B370, Open.)
     Deduped: NEW-2 folded into the existing "GIS layer caching" roadmap item (not a duplicate). lint 0
     · 1129 tests · build green · `SitePlannerApp` lazy chunk intact · headless V101 11/11. RRC's own
     live coverage fixtures run in CI / on planyr.io (host not on the sandbox egress allow-list). -->

### B370 — Migrate the remaining MAP-DISPLAY layer endpoints into the GIS source registry `[Site Planner / Platform]` (task) — the tail of B369  *(filed 2026-06-22; minted **B370**)*
`[ ]` **Open.** B369 made `src/shared/gis/sources.js` the single source of truth for the **Site Analysis screen + jurisdiction identify** endpoints (zero inline URLs there, CI-guarded). The **map-display** layers — the Leaflet/esri-leaflet tile + vector overlays in `lib/layers.js`, `lib/counties.js` (`JURISDICTION_LAYERS`, incl. the COH `geogimstest` host), `lib/evidenceLayers.js`, `lib/vectorLayers.js` — still hold their service URLs inline. Migrate them into the registry too, so the tier-guard (no `/Test/`/`geogimstest` without an acknowledged exception) and the drift/coverage checks cover the **whole** GIS surface, not just the screen.
- **Why not done in the B366–B369 session:** the map-tile path is a **separate, large surface** (many layers across 4 files) and is explicitly **out of the reported bug's blast radius** — the brief notes map tiles load as `<img>` (no CORS, no screening logic) and says to leave them alone. Rushing a live-map-wide URL refactor into the same session risked breaking a working map with no fast headless way to re-verify every layer. Filing it as its own focused pass (own branch, per-layer verify) is the safe call, not a silent omission.
- **Plan:** add map-layer rows to the registry (reuse the same `tier`/`provider`/`coverage` shape); repoint `layers.js`/`counties.js`/`evidenceLayers.js`/`vectorLayers.js` to read `serviceUrl` from the registry; extend `ui-audit/gis-source-audit.mjs`'s inline-URL scan to those files; re-verify the map renders every layer (the existing `gis-verify/coverage-picker-verify.mjs` + a tile-load check). The known COH `geogimstest` **TEST** host (a long-standing KNOWN ISSUE) becomes a registered `monitored-exception` — finally machine-tracked.

<!-- 2026-06-22: owner-dropped chat item "NEW-1" — a deleted site (HOLLISTER) reappears (delete not
     persisting), both on reload (path A) AND mid-session without a reload (path B). First filed B366,
     renumbered **B372** — a concurrent `main` (PR #277) took B366–B371 (GIS Site Analysis resilience +
     source registry) while this was in flight, so B372 is the real next free ID. **Filed AND fixed +
     headless-verified + pushed THIS session per STANDING RULE #1** (branch `claude/cool-ride-pm0m2l`) —
     full [x] block in BACKLOG-DONE.md.
     KEPT AS ONE ITEM (owner said split only if path B has an independent cause): both paths share ONE
     root cause — the site you delete from the map is the one whose planner is still MOUNTED (you opened
     it, then went Back to map; it renders hidden, not unmounted). Deleting it unmounts that planner,
     whose persist-on-leave / beforeunload flush fired AFTER the delete and RE-WROTE the row → it returns
     mid-session on the next list refresh (B), and pullCloud's heal-the-split then re-pushes that
     local-only row to the cloud so it survives a reload too (A). Explains "only that project" — it's the
     one he had open. Deduped — NOT a dup of B276 (per-ITEM overlay tombstones inside one site) nor B127
     (cross-tab stale-write fold); this is whole-SITE delete durability + a loud cloud-delete failure.
     Fix: a per-tab delete tombstone in storage.js (saveSite refuses to re-create a deleted, absent row —
     the single chokepoint every resurrection path funnels through), deleteSite returns the cloud result,
     the App AWAITS it and shows a LOUD banner + re-pulls on a genuine cloud-delete error, and cloudDelete
     uses `.select()` so a 0-row no-op is distinguishable from a real removal. 9 new unit tests +
     headless V102 (`ui-audit/verify-b372-delete-durable.mjs`, 6/6, proven to FAIL with the guard off). -->

<!-- 2026-06-21: cross-chat "NEW-1" — redesign the project-status MAP markers for correct visual
     hierarchy (Pursuit was a thin dashed cool-blue hollow outline that vanished into the aerial while
     Complete shouted). Minted **B365** (a concurrent `main` took B362–B364 — bump-out resize, bonded-child
     rotation, scanned/DWG — while this was in flight, so B365 is the real next free ID; renumbered from a
     first-filed B362). Filed AND shipped + headless-verified (19/19, V98) THIS session per STANDING RULE #1
     — full [x] block in BACKLOG-DONE.md
     (branch `claude/trusting-cori-rkn2x3`). Deduped — NET-NEW, a redesign of (not a dup of): B161 (the
     building-marker shape kept; its inverted hollow-dashed Pursuit treatment replaced), B234 (the shared
     status token set — extended IN PLACE, the single source of truth the item asked for), B163/B236 (the
     progress-arc encoding — a separate concern, untouched). Re-hued statusTokens.js (Pursuit→coral,
     Active→blue-not-green) + index.css --status-* mirrors (contrast-audit green both themes); rebuilt
     MapFinder.jsx buildingPinIcon (solid fill, white halo, size tiers, SVG flag/pulse/pause/check glyphs,
     z-order by importance, fixed hit box); Dead hidden by default. -->

### B364 — Enable the scanned / image-only + DWG reading path for the no-text-layer minority `[Doc Review]` (feature)  *(2026-06-21, follow-up to B360's corpus tuning — owner asked to note it)*
`[ ]` **Open.** B360's Tier-1 reader (free, in-browser text) files the owner's vector PDFs well (project **8/8** on the real corpus), but a minority of his sets have **no usable text layer**, so Tier-1 can't read them: image-only/scanned PDFs (e.g. Mesa Plumbing / Electrical extract ~nothing — "ARCO / REGENCY / JOHNSON DEVELOPMENT" + OCR noise, no project/discipline) and the **.dwg** files (Bergstrom / Mesa CAD). Today they correctly fall to the **holding tray** (never misfiled — the "never auto-guess" gate), but they can't auto-file. Making them auto-fileable means standing up the **already-built-but-dormant** backends:
- **Tier-2 AI/OCR** (B299 `server/filing/` + B352 OCR) — server-side title-block read for scanned sheets. Owner deploy: `gcloud run deploy server/filing/` + `ANTHROPIC_API_KEY` + `DOC_FILING_URL` + `VITE_AUTOFILE_ENABLED=1` + run `db/file_facts.sql` once. The proxy 503s until then (graceful skip) — purely additive, no regression.
- **DWG → DXF** (B238 `server/convert/`, LibreDWG → APS) — so a `.dwg` drop can be read at all.
Both are walled-off compute (Cloud Run); keys server-side only. Scope: provision + deploy + verify the read on a real scanned set and a real `.dwg`. Until then the text path covers the common case and the rest holds safely.

### B360 — Title-block intelligence: unify the readers, expand the discipline taxonomy, tune on the real corpus (V79 filing + V67 scale) `[Doc Review]` (task)  *(2026-06-21; filed B356, renumbered **B360** — `main` #268 took B356–B359 while in flight)*
`[x]` **Done + tuned on the owner's real drawings — merging via PR #270 (branch `claude/bold-cori-okbxu5`).** The Drive connector was re-authed to michael@planyr.io mid-session, so the empirical tuning ran here (no second session needed). 1078 tests, lint 0, build green, lazy chunks intact.

**Unify (one reader, one extractor).** Relocated `parseSheetScale` → `src/shared/files/sheetScale.js` (re-exported from `overlayScale.js` for back-compat); `sheetMeta` imports it from shared (removes the shared→workspace import). `readTitleBlockText` returns `scale` in the same pass; `readSheetMeta` consumes that one read. `firstPagesText` folded into `doc-review/lib/pdf.js`. Civil-only `parseScaleNote` untouched.

**Scale-reader bug (V67).** `parseSheetScale` returned null on an architectural scale when a number (a date) was printed right before it (`…10/24/2025  1/8"=1'-0"`) — the mixed-number branch swallowed the date digits + fraction. Fixed with `(?<!\d)` + a ≤2-digit mixed whole-inch.

**Discipline taxonomy (owner decision 2026-06-21).** Added dedicated buckets in the owner's order: Architectural, Structural, Civil, Mechanical, Electrical, Plumbing, Landscape, Fire Alarm, Fire Sprinkler (+ Survey/Environmental/Geotech/CAD/Other). Fire split (Alarm vs Sprinkler); Structural/M/E/P out of "Other"/"MEP". Canonical list now in `titleBlockParse.js`, re-exported by `reviewStore` (+ the walled-off server reader kept in lockstep) so the reader / store / filing-UI can't drift.

**Corpus tuning** (`ui-audit/lib/filingScore.mjs` + `score-filing.mjs`; Jacintoport + Mesa sets read via the Drive connector, ground truth = the descriptive filename). Reader fixes the real sheets drove:
- `classifyDiscipline` → WEIGHTED dominance (a definitive sheet-type like "floor plan"/"foundation plan" ≫ a bare cross-reference name like "structural"); dropped bare "elevation(s)" as a keyword (a structural sheet is full of spot elevations). Fixes a real STRUCTURAL set misfiled Civil (deep stray "grading") **and** the inverse ARCH case.
- `findDates` requires a consistent separator → a dimension "5-29/32" no longer parses as 2032 and poisons the latest-date pick.
- `parseRevision` maps "ISSUE FOR CONSTRUCTION" (no "D") → IFC, and no longer reads the heading "REVISIONS" as "Rev S".
**Result (8 readable sheets): project 8/8, discipline 6/7, date 3/6, revision 3/5.** Remaining misses are ground-truth nuances (a sheet's latest revision date vs the owner's package date; a mixed-revision "make-ready" package) or genuine data gaps (image-only scans with no text layer) — not reader bugs. Real-snippet unit tests lock every fix in.

**Remaining tail (separate, not a regression):** image-only / scanned sets (e.g. Mesa Plumbing/Electrical have ~no text layer) and the `.dwg` files can't be Tier-1 text-read — they fall to the already-built-but-dormant Tier-2 AI/OCR (B299/B352) + the DWG→DXF server path. Eligible to move to BACKLOG-DONE on merge.

### B309 — Retire client-side Mapillary token paths once the proxy lands `[Site Planner]` (task) — depends on B308  *(arrived as coworker-chat "NEW-2" 2026-06-20; first filed B304 then renumbered **B309** — concurrent `main`'s Doc Review batch took B303–B307)*
`[~]` **Partly done via B308 (2026-06-21).** The same-origin proxy is now the DEFAULT path and the in-app `MLY|…` box is already reframed as an **optional power-user override** (no token entry required). **Remaining, only AFTER B308 is confirmed live on Production:** drop the now-dead `VITE_MAPILLARY_TOKEN` read in `evidenceLayers.mapillaryToken()` (a baked VITE var would re-expose a token — the audit finding), and make the final call on the override box (keep as advanced, or remove). Held until B308's live confirm so the only working path isn't removed before the proxy is proven.
> **Dedup:** the cleanup half of B308; strictly **depends on B308 verified live**. Net-new.

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-3 — Document Review STITCH + MARKUP safety
     guards. Minted **B300–B302** (highest B# across both files was B299 after concurrent `main`'s
     B288–B299 batches landed; my first-filed B288–B290 collided with main's single-sheet-viewer
     B288–B296, then a second filing at B299–B301 collided with main's auto-filing **B299** (PR #222),
     so renumbered to the next clear band **B300–B302** — the rules forbid two items sharing a number).
     **Filed AND fixed + headless-verified + pushed THIS session** (branch
     `claude/admiring-hypatia-xjv8a1`), per Standing Rule #1 — full [x] blocks live in BACKLOG-DONE.md:
       • B300 (NEW-1) — Stitcher Align had no degenerate-baseline guard; coincident clicks flung the
         sheet because solveM's `Math.hypot(vb)||1` masked a zero baseline → extreme transform. FIXED.
       • B301 (NEW-2) — measuring over a not-yet-aligned sheet silently used the composite (sheet-1)
         scale. FIXED — per-sheet `aligned` state + visual flag + a warn-on-measure banner.
       • B302 (NEW-3) — a 2-point Area (0 sf) / 2-point Perimeter (single segment) was committable via
         Enter AND double-click. FIXED — both finish paths now need ≥3 pts via `canCommitMeasure`.
     Deduped — all net-new: NOT duplicates of main's single-sheet-viewer **B288–B296** (zoom/pan/markup-
     edit on the SAME DocReview.jsx, a different concern — the stitcher + the measure-commit guards are
     untouched there) nor its auto-filing **B299** (server-side title-block read), nor B181/B182/B183
     (the *map* placement cascade) or B130/B131 (parking). B300/B301 added a pure `lib/stitchGeom.js`
     (extracted from Stitcher.jsx so the transform math is unit-testable); B302 extended `lib/takeoff.js`
     and tightened main's B291 double-click finish to the same ≥3 gate. lint 0 · build green · headless
     `ui-audit/verify-b300-b302.mjs` 14/14 (chromium-1228, per main's V72 note). -->

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-9 — Document Review SINGLE-SHEET (Markup) viewer
     interaction: zoom/pan/navigation + drawing correctness + markup editing. Minted **B288–B296**
     (renumbered from a first-filed B273–B281: by merge time concurrent `main` had consumed B273–B281
     outright — the Infra/E2E tranche B278/B280/B281 + telemetry B279, the data-integrity B274/B275, and
     filing/lockout B271–B273/B276/B277 — so two items would share a number, which the rules forbid; this
     batch lands at the next clear band **B288–B296**). NOTE: a SEPARATE, earlier 2026-06-20 batch already
     landed as B265–B269 (devicePixelRatio render, title-block sheet labels, scale-callout calibration,
     scale cross-check, fixture cleanup); same file (DocReview.jsx), different concern.
     Deduped before filing — none duplicate an existing Open or Done item:
       • B288/B289/B290 (wheel/ctrl/pinch zoom · drag-pan · cursor-anchored ±) — NO open item covers the
         single-sheet viewport nav. The Stitcher already ships exactly this (cursor-anchored `onWheel`
         L171 + pointer-drag pan L158/L168) — PORT it, adapted to DocReview's re-rasterize/scroll model
         (it redraws the PDF to a `<canvas>` at `scale` inside an `overflow:auto` scroller rather than
         transforming a fixed-res image, so anchor via `scrollLeft/Top`, not a pan/zoom matrix). Distinct
         from B265 (DONE — devicePixelRatio render fidelity, a different "blurry" bug). The pan work cross-
         references B271 (main: frozen grab/hand cursor after an interrupted gesture) — release
         pointer-capture + clear state on pointerup/pointercancel so we don't reintroduce it.
       • B291 (double-click phantom points) — net-new; takeoff-correctness, HIGH. Mirror the Site Planner
         finish path (`finishActiveDrawing()`/`removeLastVertex()` L2747/L2761; `finishMkPoly` already
         filters consecutive-coincident vertices L2066).
       • B293 (move + edit a placed markup) — ADJACENT to the open B155 (shared interior hit-testing) +
         B156 (hover highlight): B155 makes a markup SELECTABLE, B293 makes a selected one MOVABLE +
         (text) EDITABLE. B155's end-state vision already lists "interior drag moves / double-click edits";
         B293 ships that on the Doc Review surface now (B155's cross-surface shared-`hitTest` refactor stays
         open). B293 also moves Doc Review's text create/edit off `window.prompt` to an inline editor —
         satisfying the KEY DECISION "no dialog-box edits" rule + the B155 note (calibrate's prompt stays,
         tracked under B155).
       • B292/B294/B295/B296 — net-new, no overlap.
     Per STANDING RULE #1 filed AND fixed the same session, then SHIPPED via **PR #220 → `main`** (branch
     `claude/amazing-fermi-e2xul4`). Headless-verified 13/13 in a real browser (VERIFICATION **V72**,
     `ui-audit/verify-docreview-viewer.mjs`, 0 page errors) — incl. cursor-anchored wheel zoom (0.4px drift),
     exact drag-pan, the B291 phantom-point fix (3 dots not 5), markup move, and inline text create/edit;
     B296 has a unit test, B294 reuses the proven `openFile` path. lint 0 · 563 tests · build green. NB the
     older sandbox Chromium-1194 can't raster pdf.js (it throws `getOrInsertComputed`); the newer
     **chromium-1228** build runs it — Doc-Review headless checks must use 1228 (corrects the V63/V65
     "can't run pdf.js" note). These 9 are shipped — eligible to move to BACKLOG-DONE.md on a future pass. -->

<!-- 2026-06-20: owner-dropped chat batch NEW-1..NEW-4 (data-integrity / multi-session safety +
     overlay lifecycle). ALL FOUR fixed + shipped this session → BACKLOG-DONE.md. Numbers churned hard
     under a very hot `main`: the overlay pair landed as **B276** (delete persistence) + **B277**
     (visibility), merged via PR #217 (LIVE); the data-integrity pair — first filed B274/B275, briefly
     B297/B298 — was renumbered to **B314** (optimistic concurrency / reject stale saves) + **B313**
     (multi-tab warning) once `main`'s numbering reached B312. ✅ The B314 migration
     (src/workspaces/site-planner/db/optimistic_concurrency.sql) was RUN by the owner 2026-06-20, so the
     guard goes active on deploy; remaining is one signed-in two-session check — VERIFICATION V79. -->

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-4 for Document Review (Markup) — sheet labels,
     render fidelity, scale intelligence. Provisionally B246–B249; concurrent `main` repeatedly advanced
     and re-used every ID in between (dock-zone build-out, the Scheduler backlog + its B261–B264 renumber,
     the B260 overlay-scale bug), so this batch landed at the real next-free IDs after B264: **B265**
     (render fix, shipped) + **B266** (sheet labels) + **B267** (auto-calibrate) + **B268** (cross-check)
     + **B269** (sample-fixture cleanup). Deduped — Markup-facing siblings of an EXISTING tranche, REUSE
     not duplicate:
       • B266 (sheet labels from title block) ↔ B180/B181 title-block read pass; page.getTextContent() + detectSheet() (B73).
       • B267 (auto-calibrate from stated scale) ↔ B73's parseScaleNote/ftPerPointForScale (same feet-per-point unit as calByPage) — extend for architectural/ratio forms; ↔ B181.
       • B268 (cross-check vs graphic scale bar) ↔ B182/B183 (geometry-beats-printed-scale + "flag disagreement, never silently choose" already locked); B181 captures the scale-bar facts.
     **B265 (NEW-2, the PDF render-fidelity / devicePixelRatio bug) — FIXED, headless-verified (verify-new2-dpr.mjs, V65), SHIPPED via PR #205; full block in BACKLOG-DONE.md.**
     **Corpus in hand (blocker lifted):** owner supplied two real sets 2026-06-20 (KG B1 ARCH IFP 19pp @36×24″; Jacintoport Fire-Sprinkler IFC 9pp @42×30″; PR #207 / branch mikeab7-patch-1) — both vector text, real architectural scales (1/16″=1′-0″, 1/4″=1′-0″) + "NOT TO SCALE" + standard plot sizes — so B266/B267/B268 are ready to build/verify. OCR fallback required for scanned sheets (owner). B269 tracks removing the sample binaries after the features are verified. -->

<!-- ✅ B266 (Sheet sidebar labels — real sheet # + title, not "Sheet N") SHIPPED 2026-06-21 as a
     follow-up to #242, together with B348 (collapse the Markup sidebar into logical sheets). Built on
     #242's shared reader/grouping engines; full [x] blocks in BACKLOG-DONE.md. The OCR-for-scanned slice
     stays tracked under B267 (`[~]`) + #242's dormant OCR seam. -->

### B267 — Auto-calibrate a sheet from its stated scale callout `[Doc Review / Markup]` (feature)  *(arrived as "NEW-3" 2026-06-20; renumbered **B267**; batch B265–B269)*
`[~]` Detect a stated-scale callout and **auto-set that sheet's calibration**, replacing the **"Sheet N not calibrated — use Calibrate"** prompt (`DocReview.jsx`) when confidently found. **Per-sheet** (a set mixes scales; a sheet with no graphic scale stays uncalibrated, **never inherits a neighbour's**). **"NOT TO SCALE"/"AS NOTED"/unparseable → leave uncalibrated and say so explicitly** (*not present* ≠ *couldn't parse*).
- **✅ Shipped this session — embedded-text path (branch `claude/friendly-euler-hw8v1t`).** New **`parseSheetScale()`** (`overlayScale.js`) reads engineer's (1″=50′), **architectural fractional** (1/4″=1′-0″ → 4 ft/in), **ratio** (1:200), and explicit **NOT TO SCALE / AS NOTED** — each with its own sane range; the civil `parseScaleNote` is left untouched (Site Planner overlay). `pdf.js` `extractPageText()` reads the page text; `DocReview.jsx` runs a **background per-sheet scan** on open → fills `calByPage` (gated on `detectSheet()` standard plot size) + a new `calInfo {src,label}` driving the sidebar (·≈ auto / ·✓ manual) and the badge ("scale from sheet … verify" / "NOT TO SCALE" / "calibrated"). Per-sheet, never overwrites a manual/loaded cal, persisted; opening a different file resets cals (a cross-document bleed bug found + fixed during verification). **7 unit tests + verified on the owner's real sets** (`ui-audit/verify-new3-autoscale.mjs`, **V67**): KG B1 **17/19** auto-calibrated (no-scale cover left alone), Jacintoport all **NOT TO SCALE**, 0 bleed. lint 0 · 569 tests · build green.
- **⏳ Remaining slice — OCR fallback for scanned/raster sheets (owner: REQUIRED).** `extractPageText()` returns "" on a scanned page (the seam); the fallback (Tesseract.js in a Web Worker / server-side → rasterize → OCR → `parseSheetScale`) needs a **scanned sample** to build + verify (the owner's two sets are vector, so the shipped path covers them today). Kept `[~]` until OCR lands; shared OCR path with **B266**.
- **Design (as built):** extended `parseScaleNote`'s domain via a sibling `parseSheetScale` rather than loosening the civil 10–1000 floor (architectural ft/in fall below it). A title-block "SCALE: NOT TO SCALE" wins outright; otherwise a real numeric plan scale beats a stray "NTS" detail note. Gated on `detectSheet()` + labeled "from sheet scale — verify". Co-designs with **B268** (the geometry cross-check that catches a non-1:1 plot) / B181 / B182 / B183.

### B268 — Independent scale cross-check against on-sheet geometry (verify the stated scale) `[Doc Review / Markup]` (feature) — depends on B267  *(arrived as "NEW-4" 2026-06-20; renumbered **B268**; batch B265–B269)*
`[ ]` After B267 sets a scale from text, **independently check** it by measuring a known on-sheet reference — primarily the **graphic scale bar** (the printed ruler), which survives plotting/resizing where stated-scale text doesn't. Agree within tolerance → **"verified"**; disagree → **surface loudly, make the user choose — never silently pick one** (silent wrong-calibration is crash-severity; it poisons every downstream takeoff). No scale bar → report **"no reference found"**, don't fail.
- **Decision recorded (owner's lean, matches the locked principle):** on disagreement **default to the scale bar (geometry) but flag it loudly**, one-click override to the stated scale — *not* a silent choice. Matches **B182** ("geometry beats printed scale") + **B183** ("flag disagreement as a distinct state, never silently average/choose"). Flip to "always force a manual pick" if preferred.
- **Reuse:** **B183** already shipped the cross-check *primitives* for the Site Planner cascade; this is the **Markup-canvas application** to scale-bar-vs-stated-scale. **B181** captures the scale-bar facts. The owner's sets also carry **labeled dimensions** ("38′-7 3/4″") — a second independent reference.
> **Ready to build (largest of the three).** Needs **graphic-scale-bar detection/measurement** (locate the printed ruler on the raster + read its annotated length — light CV), now testable on the owner's sets; depends on B267; ships *with* the loud-surface UI.

### B269 — Remove the uploaded sample drawing PDFs from GitHub (test fixtures, not for `main`) `[Doc Review / repo hygiene]` (task)  *(owner-requested 2026-06-20; renumbered **B269**; batch B265–B269)*
`[ ]` The owner uploaded two real construction sets as build/test fixtures — **"2025.06.30 KG B1 - ARCH IFP REDLINE.pdf"** (6.2 MB) + **"Jacintoport - Fire Sprinkler IFC.pdf"** (6.4 MB) — on branch **`mikeab7-patch-1`** (PR **#207**). Needed to build/verify **B266/B267/B268**, but **NOT for merging into `main`** (12 MB+ of binaries would bloat the repo history permanently). **Do NOT merge PR #207.**
- **Disposition:** keep the fixtures reachable until B266/B267/B268 are verified against them, **then close PR #207 + delete the `mikeab7-patch-1` branch** (or relocate fixtures to the private Supabase `doc-review-files` bucket). The owner plans to drop **more** sample files on the same branch for filing-workflow practice — same disposition.
> Tracked explicitly so the big binaries don't silently ride into `main` (owner ask).

### B273 — Filing-workflow practice: read a dropped file's title block → propose its project / discipline / sheet / date `[Doc Review / filing]` (task)  *(owner-requested 2026-06-20; minted **B273** — concurrent `main` took B270–B272 while this was in flight)*
`[ ]` The owner is dropping sample files specifically to **practice filing** them. Until the backend auto-filer (B180/B181) is deployed, demonstrate the *logic* in-session: for each dropped PDF, **read its title block** (reuse B266's title-block reader + the `extractPageText` / `parseSheetScale` plumbing already shipped for B267), extract **{project, discipline, sheet #, revision, doc date}**, and **propose the filing** — which project + discipline folder + the `"<Project> - <Item> - YYYY.MM.DD"` name — for one-click confirm. This serves the owner's practice request AND **exercises/validates the title-block reader** that B266 and the real auto-filer depend on. **No-auto-guess:** low-confidence / no-match → a "needs filing" proposal the owner confirms, never a silent route.
- **Heads-up (owner, 2026-06-20):** more sample files are incoming on `mikeab7-patch-1` for this — run the prototype on them (and the existing KG B1 / Jacintoport sets), report the proposed filing, don't auto-commit.
> **Dedup:** NOT a new filing system — a manual/prototype run of the **existing auto-filing spec (B180/B181)**; findings feed those. Distinct from **B270** (the persistent drop-zone + upload queue — the ingestion *plumbing*, already shipped); this is the title-block→routing *intelligence* on top. Dropped files follow **B269**'s fixture disposition (don't ride into `main`).

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-4 — the "deliberate Group" tranche for the Site
     Planner. Minted **B261–B264** (highest B# across both files was B246, so these are the real next free
     IDs). Deduped before filing: no prior OPEN item covers a Group tool / snap-alignment-only / snap-pref-
     stickiness / per-plan delete. The relevant prior art is the DONE **B114** (Shift-drag snap+bond + the
     S-key snap toggle) — B261 replaces its *bonding* half with an explicit Group, B262 strips the bond so
     snap only aligns, and B263 fixes the snap pref's global stickiness; B114's toggle + Alt-bypass survive.
     The owner-mentioned "earlier split-snap item" was that B114 family (done), not a separate open item.
     The still-open, owner-gated **B115** (keyboard-shortcuts pass) referenced the now-removed ⇧-drag bond
     gesture; its in-app shortcut table was updated here (B115 itself stays open for the deliberate remap
     pass). All four filed AND shipped this same session on branch `claude/eager-keller-1ueisx` — full
     blocks moved to BACKLOG-DONE.md; self-verified headless (ui-audit/verify-b261-b264.mjs, 14/14, 0 page
     errors), VERIFICATION **V64**. lint 0 · 537 tests · build green. -->
<!-- 2026-06-20: owner dropped his old "Planar — Engineering Backlog" (2026-05-26 code review, re-verified
     2026-06-19) for the **Scheduler** app (`public/sequence/index.html`), said "log this" + "don't worry
     about the email feature." Filed under `[Scheduler]` as B247–B259. The safe wins (B247–B253) were filed
     AND shipped this session → BACKLOG-DONE.md. Remaining below: B255 (a refactor); B256–B259 are
     gated/optional/project items under 🕓 Later / Roadmap. B254 (the 5s Snap/Free chip) was resolved —
     owner said leave it as-is (2026-06-20) → moved to BACKLOG-DONE.md. Email excluded per owner; the
     doc's already-shipped items (orig B2/B6/B8) were not re-filed. -->

### B255 — Collapse the duplicate indent/outdent + column-autosize functions `[Scheduler / code health]` (task)  *(orig "M2"; minted **B255**)*
`[ ]` Two near-identical copies each of: indent/outdent — keyboard `indentTask`/`outdentTask` vs right-click `indentTaskById`/`outdentTaskById` — and column autosize — `autoSizeCol` (grid) vs `autoSizeMCol` (master). Merge each pair into one helper that takes the task id / column set as a parameter (keyboard passes `selectedId`, menu passes the ctx id). **Verify equivalence first** (the doc warns they may have drifted; if they have, decide which behaviour is canonical before merging) and verify keyboard vs menu produce identical results. Pure maintainability — no user-visible change — so it was kept *out* of the B247–B252 bug-fix shipment to isolate refactor risk on a live tool; pick it up as its own focused pass.

<!-- 2026-06-20: filed from chat (arrived as "NEW-1"/"NEW-2") — resilient county parcel fetch. Minted
     **B244** (NEW-1: resilient fetch + TxGIO statewide fallback) + **B245** (NEW-2: validate the ArcGIS
     response BODY, not just HTTP status) — concurrent `main` took B239–B243 while this was in flight, so
     B244/B245 are the real next free IDs after B243. Deduped before filing: B244 is the RESILIENCE layer
     on top of the already-done **B137** (which made TxGIO a queryable *candidate* — coverage); B244 adds
     the 8s AbortController timeout (the ~45s freeze fix), a per-source circuit breaker, honest "statewide
     backup" labeling, the search-side county-scoped fallback, and TxGIO field normalization. B245 extends
     **B233**'s "unavailable vs no-parcel" split down into the fetch layer (typed ParcelFetchError) and
     reuses the `probeService` body-parse principle (HTTP 200 + .error = failed). Distinct from **B36e**
     (AbortControllers on the busy-gated evidence-fetch path). Both filed AND shipped this same session —
     full blocks moved to BACKLOG-DONE.md; live headless verified with FBCAD simulated down → Fort Bend
     lot selected from TxGIO in 1.2s + backup notice shown (VERIFICATION V61). -->

<!-- 2026-06-20: owner-reported (chat, w/ 3 screenshots) that "Print" opens a blank `about:blank`
     window and routes through the BROWSER's print dialog — which stamps a date/time header, the
     about:blank URL, and a page number onto the output, bleeds a cream page background (more ink),
     and (Letter content dropped on a Tabloid sheet) doesn't fill the page. Filed **B243** (arrived
     as "NEW-1"; minted B228, renumbered **B243** — concurrent `main` took B228–B242 while this was
     in flight, so B243 is the real next free ID after B242).
     **Inspected the current print code first (as the owner asked):** the path ALREADY composes the
     whole sheet as ONE SVG at the exact page size (B200/B197/B201) — the only problem is the final
     DELIVERY step (`window.open` + `win.print()` hands it to the browser's print dialog; the cream
     is `PAL.paper` bleeding into the sheet fill + the plan-clone bg rect). Fix keeps the composition,
     replaces only the delivery: rasterize the sheet at 300 DPI → JPEG → a Planyr-built PDF download.
     **Deduped:** NO existing open item covers this (the owner-suspected dupes — "per-layer print
     inclusion list", "PDF export embedding plan data for re-importability" — do not exist as open
     items; JSON re-import already ships as Export JSON). RELATED: **B131** (overlay-in-print toggle,
     done) is PRESERVED — the `printOverlay` checkbox still gates the placed overlay in the export;
     **B50** (export/print robustness) is partly SUPERSEDED for the print path (the old "don't strand
     a blank Preparing… window" guard is moot — there's no window now). **B361/B160** are the
     *Scheduler* Gantt PDF/Print export (a different module), not this. Filed AND shipped this same
     session — moved to BACKLOG-DONE.md; browser-verified (VERIFICATION **V60**). -->

<!-- 2026-06-20: owner-reported (chat, with finished artwork + brief) the new Planyr coral brand
     mark — the favicon/app-icon swap + coral tokens/BrandMark component. Arrived as "NEW-1"/"NEW-2";
     provisionally B230/B231, but `main` advanced repeatedly during the work (B230–B239: Bluebeam
     vertex editing, detention pond, map-finder tranche, stale-chunk hardening, dock-zone fixes),
     so renumbered to the real next free IDs **B240/B241** at merge time. Deduped: no prior favicon/
     app-icon or brand-token/BrandMark item (B3 = brand *spelling*; B104/B10 = the unified-header
     consolidation that B241's logo slot plugs into — orthogonal). Both filed AND shipped this same
     session — moved to BACKLOG-DONE.md. Canonical artwork + the dependency-free icon generator live
     in brand/. -->

<!-- 2026-06-20: owner-reported (chat) "my scheduling module not working — this is obviously a huge
     deal." Filed B228, renumbered B239 — concurrent `main` took B228–B238 while this was in flight, so B239 is the real next free ID.
     Root cause confirmed = the SAME stale-chunk-after-deploy family as B221 (the open/returning tab
     holds a previous build's index.html → its content-hashed Scheduler-<hash>.js 404s after redeploy),
     NOT a Scheduler/iframe logic bug — ruled out: the embedded Gantt renders 44 task rows the instant
     its chunk loads (ui-audit/diagnose-scheduler.mjs). B221 already auto-reloads, but two recovery gaps
     let it still dead-end: (1) a plain location.reload() can be served the browser's OWN hard-cached
     stale index.html → same dead chunk → cooldown → error screen (the no-cache _headers can't retro-fix
     an already-cached HTML); (2) the ErrorBoundary's PRIMARY button was "Try again" (re-renders the same
     dead lazy import — a no-op for this error). Deduped against B221 (this hardens it, same family) and
     the PDF.js import() items (B72/B67/B180 — unrelated on-demand library loads). Filed AND shipped this
     same session — moved to BACKLOG-DONE.md: B239 (reloadFresh cache-busting reload + chunk-aware
     ErrorBoundary "A new version of Planyr is ready / Reload to update", in src/app/chunkReload.js +
     ErrorBoundary.jsx; _headers unchanged). Browser-verified (VERIFICATION V58). -->

<!-- 2026-06-20: filed from chat (arrived as "NEW-1"/"NEW-2"). Concurrent main took B227–B236 while
     this was in flight, so these renumbered to **B237** (two-backend architecture doc) + **B238**
     (DWG→DXF conversion service) — the real next free IDs after B236. Deduped before filing: NEW-1
     RECONCILED the existing "Two backends — don't conflate" section in CLAUDE.md in place (no
     duplicate section); NEW-2 ADDED server/convert/ to the ALREADY-EXISTING /server scaffold (the
     B206–B209 Drive storage layer was there — /server was not absent), reusing the shared
     no-silent-failure result.js. Both filed AND shipped this same session — full blocks moved to
     BACKLOG-DONE.md. -->

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-5 for the Site map finder. Renumbered twice
     under a hot `main` (B225–B229 → B230–B234 → **B232–B236**; concurrent PRs #188–#191 + #190
     took B225–B231). Filed AND shipped this same session on branch `claude/tender-goldberg-ax4n5w`
     — all five moved to BACKLOG-DONE.md: B232 (address search recenters — Esri geocoder biased to
     the map, replaces the no-bias Nominatim that returned nothing for bare street addresses), B233
     (address search selects the parcel + shows its appraisal info, reusing the click pipeline + the
     planner's appraisal labeller; source-unavailable ≠ no-parcel-here), B234 (one shared status-
     token set — color + glyph per state — across chips, list markers, and map pins; module accents
     confined to the tab row; amends B161's pins), B235 (left rail: chips-as-filters + type-to-filter
     + collapsible status groups, Complete/Dead collapsed by default; consumes B234), and B236
     (per-layer source-vintage stamp, distinct from refreshed-age; "vintage unknown" never
     fabricated; the ship-now half of B96's data-age surfacing). All self-verified headless (V57). -->

<!-- 2026-06-20: B230 (Bluebeam vertex editing — drop the always-on "+" midpoint handles; Shift-click /
     right-click an edge inserts a control point; right-click a vertex / Delete removes one; candidate
     dot on edge-hover; portal-mounted menu; built once in a shared layer for parcels / polygon elements /
     measures / markup poly-line / easements) + B231 (cartographic detention pond — radial steel-teal
     gradient, constant teal outline, no orange, no wavy hatch, Inter slate label). Both arrived as
     "NEW-1"/"NEW-2"; provisionally B221/B222, renumbered **B230/B231** — concurrent `main` (PRs #184/#186/
     #188/#189/#191) took B221–B229 (lazy-chunk recovery, Schedule fixes, building-button gating, Yield-
     panel redesign, dock-zone stack) while this was in flight, so B230/B231 are the real next free IDs
     after B229. Filed AND shipped this same session — moved to BACKLOG-DONE.md; self-verified headless
     (ui-audit/verify-b221-b222.mjs), V56. -->

<!-- 2026-06-20: B228 (building-anchored dock-zone stack with LIFO +/−) + B229 (Dock Features
     panel reorg) — owner-reported (chat), arrived as "NEW-1"/"NEW-2"; filed provisionally as
     B221/B222 but concurrent `main` took B221–B227 (PRs #186 lazy-chunk reload, #188 B225/B226
     feature-button visibility, #189 B227 yield panel, #184 B222–B224 Schedule) while this was in
     flight, so renumbered to the real next free IDs **B228/B229** at merge time. Filed AND shipped
     this same session — moved to BACKLOG-DONE.md. Deduped vs B71 (trailer curb) / B78 (stall-layout
     freeze) AND vs main's B225/B226 (#188 size-GATES these feature buttons — orthogonal: that's
     button visibility, this is the zone stack the buttons drive). REUSES the existing court /
     far-side-trailer / bump-out machinery rather than re-adding it. -->

<!-- 2026-06-20: owner-reported (chat, w/ screenshot) the building feature-edit buttons spill
     into an unreadable cluster past the footprint edges when zoomed out. Filed B225 (NEW-1:
     size-gate the buttons) + B226 (NEW-2: only on the selected/hovered building) — highest B#
     across both files was B220, so B225/B226 are the real next free IDs. Deduped: the buttons
     ALREADY rendered only on the selected building (never all), so NEW-2 folded into NEW-1 as
     ONE visibility rule (footprint-size gate AND selected-or-hovered, hover added). Both filed
     AND shipped this same session — moved to BACKLOG-DONE.md; browser-verified (VERIFICATION
     V53). -->

<!-- 2026-06-20: owner-reported (chat) "Document Review (and all lazy modules) fail to load after a
     deploy — Failed to fetch dynamically imported module." Arrived as "NEW-1"; provisionally B218,
     renumbered **B221** — concurrent `main` (PR #183) took B218 (dead header controls) + B219
     (map-furniture restyle) and a parallel session took B220 (map-finder over-zoom) while this was in
     flight, so B221 is the real next free ID after B220 (the branch's first commit + the PR say "B218").
     Root cause confirmed = the standard Vite stale-chunk-after-deploy problem (an open tab holds the
     previous build's index.html → references the old content-hashed chunk filenames, which 404 once the
     new deploy replaces them), NOT a DocReview logic bug and NOT a broken build. Deduped against the
     PDF.js import() items (B72/B67/B180 lazy-load a heavy library on demand — unrelated). Filed AND
     shipped this same session — moved to BACKLOG-DONE.md: B221 (global vite:preloadError reload-once
     guard with a sessionStorage loop-guard, in src/app/chunkReload.js + src/main.jsx, applied to every
     lazy workspace; Cloudflare public/_headers — no-cache HTML / immutable hashed assets). -->

<!-- 2026-06-20: B220 (map-finder Esri imagery over-zoom placeholder — recurrence of B182,
     the planner-canvas fix that missed the map-finder call site). Minted B218, renumbered
     B220 — concurrent `main` PR #183 took B218 (dead header controls) + B219 (map-furniture
     restyle) while this was in flight. Filed AND shipped this same session — moved to
     BACKLOG-DONE.md. -->

<!-- 2026-06-19: owner-reported (chat) "can't access my scheduling projects — this is imperative."
     Filed B203–B205 (arrived as B194–B196, but concurrent `main` #169–#172 minted B194–B202 for
     the project switcher / trailer labels / scale bar / print tranche, so renumbered to the real
     next free IDs at merge time). ALL THREE filed AND shipped this session — moved to
     BACKLOG-DONE.md: B203 (Schedule picker showed Site projects — CRITICAL data-access), B204
     (module-contextual home crumb: "Map" in Site, "Dashboard" in Schedule), and B205 (the owner
     clarified via screenshot that the "center map" he meant was the planner's redundant center
     "‹ Map" back-button — now that B204 renamed the breadcrumb crumb to "Map" there were two;
     removed the center one). -->

<!-- Filed 2026-06-19 from the Cowork storage-backend chat (arrived as "NEW-1".."NEW-4"). Provisionally
     B203–B206 (highest was B202 when filed), but concurrent `main` shipped B203/B204 (Schedule picker,
     home crumb) + filed B205 (center map) while this was in flight, so renumbered at merge time to the
     real next free IDs **B206–B209**. These are the /server file-storage tranche UNDER the file-filing
     UI (B180) + auto-filing. Per the owner: live Google Drive wiring is blocked on his manual Workspace
     + OAuth setup (being done in parallel with Cowork), so the architecture (B206), the link abstraction
     (B208), and the no-silent-failure contract (B209) are BUILT + tested now, with the Drive backend
     (B207) scaffolded behind them. Code in server/storage/ (walled off from the public Pages build); see
     server/storage/README.md for the exact env/credentials the Drive backend needs from Cowork. -->

<!-- 2026-06-23: B207 (Google Drive storage backend) — ✅ DONE, moved to BACKLOG-DONE.md. The code was
     already complete + unit-tested (a prior session advanced it past the brief's "scaffold"), and the owner
     CONFIRMED all Drive env vars present + deployed live in Cloudflare Pages Production — GOOGLE_CLIENT_ID /
     GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / PLANYR_STORAGE_BACKEND=drive / SUPABASE_URL /
     SUPABASE_ANON_KEY — verified 2026-06-22 against deploy 912de2b (green), with the temporary
     PLANYR_SELFTEST_TOKEN correctly removed. ⛔ DO NOT re-run the OAuth setup / re-mint GOOGLE_REFRESH_TOKEN:
     a fresh consent would mint a new token that no longer matches the deployed one and could take Drive
     filing offline. Only optional follow-up = a signed-in end-to-end re-confirmation (already passed
     2026-06-20). Full [x] block in BACKLOG-DONE.md. -->

### B180 — Project Files repository as a tagged-index with saved views `[Document Review / Files]` (feature)  *(arrived as "NEW-1"; provisionally B176, renumbered **B180** — #159 took B176–B179)*
`[~]` A project-level **file repository** opened from **Row 1 (the project-name area), NOT a fourth module tab.** Rationale (owner): tabs are *workspaces* (modes of working — Site / Schedule / Markup); **Files is a shelf every workspace reaches into**, so it must be openable from inside any of them. "Folders" are **saved views over a tagged index, never a hand-maintained tree** — "All surveys", "All title commitments", "this project's civil set" are all *queries* against file facts. Two document classes: **spatial** (can live on the map — drawings, surveys, legal descriptions) vs **reference** (geotech, environmental, contracts — pulled and read, never a map object); a **title commitment is BOTH** (a reference document, but Schedule A's legal description feeds the boundary polygon and Schedule B's exceptions feed easement objects). Drawer: files grouped by discipline; per-file state **Filed** (automatic) vs **On map** (calibrated once); a **drop zone** (auto-file by title block) and a **"needs filing"** holding area with one-click confirm for low-confidence / no-match.
- **✅ Shipped this session (browser-first tranche, branch `claude/laughing-ritchie-k5narx`):**
  - **View-model engine** `src/shared/files/fileFacts.js` (pure, browser-free, **15 unit tests**): `classifyDocClass` (spatial / reference / **both** for title commitments + legal descriptions), `toFileFact`/`buildFileFacts` (normalizes the existing `listReviews` rows + defaults the NEW-2 placement facts), **`SAVED_VIEWS` + `runView`** (the saved-view query engine — per-project in the drawer, **cross-project by dropping the project filter**, same query), `groupByDiscipline`, `fileState` (Filed vs On-map), `needsFiling` (holding area), and the **index-provider interface** `createIndexProvider`/`stubIndexProvider` — the seam the auto-filing backend slots into with **no UI change** (`backendReady` flag keeps the UI honest about "auto-detected" vs "by hand").
  - **Drawer UI** `doc-review/components/ProjectFilesDrawer.jsx`, opened from **Row 1** (a 🗂 Files pill next to the project name in `DocReview.jsx`'s `centerContent`): saved-view chips, project picker + cross-project toggle, discipline groups, per-file **document-class tag** + **Filed/On-map** badge, a **drop zone** (files under the active project; auto-file-by-title-block flagged as backend), a **"needs filing"** holding area, and a **"Place on map"** action that runs the NEW-3 cascade (B182). lint 0 · **290 tests** · build green; the doc-review lazy chunk split still holds.
- **⏳ Follows the backend tranche (sanctioned by the owner's sequencing note — stubbed behind `createIndexProvider`, not deferred work):** the **auto-filing index itself** (drop → read title block → match against the named projects + aliases → auto-route/auto-name; low-confidence → the holding area) — this is the existing **auto-filing + lightweight-index** roadmap item and the **Google Drive auto-routing** item; **merge, do not duplicate.** Title-commitment → boundary polygon **reuses B25/B26's metes-and-bounds parser**; exceptions → easements **reuses B147's easements-as-first-class-objects** work. Privacy-first: **private by default** (rides the existing RLS).
> **Dedup:** generalizes **B14** (the `ProjectLibrary.jsx` explorer — project → discipline → files), which stays as the in-workspace explorer; B180 is the **saved-views / tagged-index** surface reachable from Row 1 and adds document-class + Filed/On-map state. Distinct from **B67** (parcel-attached *pixel-space* markup). The "drop to open a PDF for viewing" roadmap item is the low-effort sibling; the title-block auto-filing is the backend feature — two different timelines, kept separate.

### B181 — Capture placement-readiness flags in file facts at filing time `[Document Review / Files]` (feature)  *(arrived as "NEW-2"; provisionally B177, renumbered **B181** — #159 took B176–B179)*
`[~]` At filing/index time, capture **more than discipline** so "Place on map" (B182) can pick its method **without reopening the file.** Per-drawing flags: **embedded real-world coordinates** present (+ source CRS); detectable **graphic scale bar** (yes/no + measured length + real length); **stated scale text** from the title block; **north arrow** present (+ orientation); visible **parcel/property boundary** present; **labeled dimensions** found (value + on-sheet endpoints). All cheap to capture during the title-block read pass.
- **✅ Shipped this session:** the **fact schema + contract** `src/shared/placement/placementFacts.js` (pure): `emptyPlacementFacts()` (every sub-fact carries `present` so **"looked, found none" ≠ "never captured"** — the silent-failure rule applied to placement), `PLACEMENT_FLAG_KEYS`, `mergePlacementFacts` (a partial/legacy capture is always a complete, safe object), and `longestDimension` (rung-3 baseline preference). Wired through `toFileFact` (every file fact carries a well-formed `placement`) and exercised by the cascade tests.
- **⏳ Follows the backend tranche (stubbed behind `createIndexProvider.capturePlacementFacts`):** the **actual capture** — the title-block read pass that fills these in — runs server-side as part of B180's auto-filing index. Until then the stub returns the empty shape and the cascade honestly lands on manual calibration (B183).
> **Dedup:** the capture piggybacks on B180's title-block read (one pass, not two). The scale-text parse reuses **B73's `parseScaleNote`/`detectSheet`** (`overlayScale.js`); embedded-coords/GeoPDF handling is B73's de-emphasized GeoPDF path.

### B182 — "Place on map" auto-placement cascade `[Site Planner / Files]` (feature)  *(arrived as "NEW-3"; provisionally B178, renumbered **B182** — #159 took B176–B179)*
`[~]` On placing a filed drawing, walk methods **best → fallback** and **stop at the first that runs with confidence**; route every result through B183's verification before commit. Rungs: **(1) Embedded coordinates** → land exactly, no scaling (reproject to EPSG:2278); **(2) Fit to known boundary** → solve scale + rotation + translation in one affine/Helmert fit by matching the drawing's boundary to the held parcel/survey geometry — **preferred over any stated scale** (a printed scale is a claim about original plot size and breaks under "fit to page"/copier resize; geometry is ground truth); **(3) Measure a graphic** → scale bar or labeled dimension, drawn length ÷ annotated real value (resize-invariant), **prefer the longest baseline** (a 2 ft error over a 240 ft face is <1%; over a 24 ft bay it's 8%), use the north arrow for rotation then position to parcel; **(4) Manual calibration** → last resort (B183). Use the B181 flags to choose the rung; **never silently fall through a failed high rung without surfacing why.**
- **✅ Shipped this session:** the **cascade orchestrator** `src/shared/placement/placeOnMap.js` (pure, **10 unit tests**): `RUNGS` (the 4 rungs in priority order, each with an `evaluate(facts, ctx)`), `choosePlacement(facts, ctx)` → `{ method, label, detail, skipped:[{method,reason}], confident, reason }` — picks the best rung that runs **and lists every skipped higher rung with its reason** (the hard "no silent fall-through" rule), reads the B181 flags, prefers fit-to-boundary over stated scale, picks the **longest** dimension baseline, and carries the north-arrow rotation hint. Surfaced live in B180's drawer ("Place on map" → a plan panel naming the method + why higher ones were skipped).
- **✅ Shipped this session — rung-2 geometry:** the **fit-to-boundary solver** `src/shared/placement/fitToBoundary.js` (pure, **7 unit tests**): `fitToBoundary(source, target)` solves the one similarity (uniform scale + rotation + translation) that lands the drawing's boundary on the held parcel. Two paths — **equal vertex counts** → exact correspondence search (every index rotation × both winding directions, closed-form Procrustes per candidate, lowest landing error wins; recovers sub-foot fits even when the rings start at a different corner and run the opposite way); **unequal counts** → an oriented-bounding-box fallback (match centroids, scale by √area ratio, best principal-axis rotation by nearest-vertex distance) for a sane starting placement. Returns `{ ok, transform:{scale,rotDeg,apply}, residual, residualFrac, confident, method, reason }`; `residualFrac` over √area flags a **distorted (non-rigid)** drawing a rigid fit can't honor (CONFIDENT_FRAC = 2%), per the silent-failure rule. Self-contained (its own Procrustes mirroring B73's `solveSimilarityLSQ`, no shared→workspace import). This is the geometry the cascade invokes when `choosePlacement` returns the **fit-boundary** rung.
- **⏳ Still follows the backend tranche / EPSG spine:** **(1)** reprojection of embedded coords to EPSG:2278 (needs the coordinate spine wired, currently a stub in `src/shared/coordinates/`) and the **executor wiring** that takes the chosen rung's transform and actually repositions the overlay on the planner canvas; the **inputs** for rung 2 (the drawing's detected boundary + the held parcel geometry) come from B181's title-block read pass. **Rungs 3–4 already exist** as the live B72/B73 overlay machinery (`overlayScale.js` scale/trace, `overlayAlign.js` similarity/affine fit) — the cascade routes to them today. `choosePlacement`'s `ctx` (`canReproject`, `targetBoundary`) is the capability gate, so a rung only fires when its infra is present and otherwise reports *why* it's skipped.
> **Dedup:** this is the **decision layer over B72/B73**, not a second overlay engine. B72 = drop a PDF on the map + place by hand; B73 = scale calibration + trace + 2-point/N-point precise align (both shipped). B182 chooses *which* of those to apply automatically from the B181 facts. Severity: a confidently-wrong placement looks done and produces silently-wrong measurements — **placement accuracy is HIGH severity** (the silent-failure rule), which is why every skipped rung is surfaced and every result is verified (B183).

### B183 — Dimension-based calibration + auto-verification probe `[Site Planner / Document Review / Files]` (feature)  *(arrived as "NEW-4"; provisionally B179, renumbered **B183** — #159 took B176–B179)*
`[~]` Resolves the open "precise-align / trace-a-known-dimension" question — **answer: build it, and make it pull double duty.** **Calibration:** trace the two endpoints of a labeled dimension + type its value → derive scale (preferred over two arbitrary calibration points: it anchors to a value the drawing itself certifies); this is cascade rung 4. **Auto-verification:** after ANY placement method, find a labeled dimension, **measure it on the placed result, compare to the printed value, and surface a NUMBER** ("column grid measures 24.0 ft, label 24'-0" — 0.1% off") — not an eyeball confirmation. **Cross-check:** read two independent graphics (scale bar + a dimension, or two dimensions on different axes) and compare them **to each other**. Agreement → confident. Disagreement → **flag non-uniform scaling** (sheet stretched more in one axis, so no single uniform scale is valid) as a **distinct state — do NOT silently average the two.**
- **✅ Shipped this session:** the **calibration + verification primitives** `src/shared/placement/verifyPlacement.js` (pure, **8 unit tests**): `calibrateFromDimension` (rung-4 scale from a traced dimension), **`verifyDimension(measuredFt, labeledFt)`** → `{ pct, deltaFt, ok, severity:"ok|warn|bad", message }` (the probe that returns a number, with tight 1%/3% thresholds because takeoff rides on it), and **`crossCheckScales(samples)`** → `confident` (agree, reports the mean) / **`non-uniform`** (disagree → flags stretched-in-one-axis, **`meanScale:null` so it can never silently average**) / `insufficient`. The trace-a-known-dimension calibration itself already ships live in B73 (`overlayAlign.scaleOverlayAbout` + the canvas trace flow + Doc Review's calibrate-to-scale).
- **⏳ Follows the backend tranche:** the **auto-probe's data source** — automatically *finding* a labeled dimension to measure on the placed result — comes from B181's captured dimensions (read at filing time). Until then verification is available as the tested primitives (and can be driven by a hand-traced dimension); the auto-find runs once the title-block read pass lands. (A browser-only "trace a second dimension → cross-check" affordance on the live overlay is a small follow-on once the canvas flow is touched again.)
> **Dedup:** the calibration half is **B73's trace fallback** (don't rebuild it); B183 adds the **verification + cross-check** layer on top and is the function the B182 cascade calls after every placement. Reuses B73's `solveSimilarityLSQ` residual as the *rigid-fit* quality signal; `crossCheckScales` is the complementary *non-uniform-scale* signal (residual high **and** axes disagree → rubber-sheet needed, the B73 affine follow-on).

### B179 — Backend per-account exact tax fetch `[server]` (feature) — precision upgrade  *(arrived as "NEW-4"; filed provisionally as B170, renumbered **B179** — concurrent `main` took B167–B175, so this is the real next free ID after B175. This is the "A" path of the old B165 A/B decision — built AFTER the browser "B" path, B176–B178, ships.)*
`[ ]` Per-county tax-office / appraisal-district account fetch that returns the **authoritative** taxing-unit list + rates matching the actual tax statement; upgrades the B177 panel from *screening* to *underwriting-grade*. **Server-side only** (lives in `/server`, the not-yet-built CAD/filing backend — keep distinct from Supabase). Per-county field mapping (same registry pattern as parcel-source naming in `lib/counties.js`). Credentials/keys stay server-side, never in the browser bundle (KEY DECISIONS).
- **Why a backend:** HCAD's jurisdiction-rate page + per-account record pages return **HTTP 403 to automated clients** and there's no public CORS-open per-parcel rate REST endpoint (confirmed 2026-06-19) — so authoritative rates can only be fetched server-side, where there's no CORS and the fetch can present a browser-like client.
- **Contract:** given county + account, return `{ units:[{name, rate}], total, asOf, source }`; the B177 panel swaps its screening rates for these and flips its header to "Verified · <tax office>, <year>." On failure, the panel stays on screening (never blank).
- **Acknowledged multi-session:** depends on standing up `/server` first; may span its own session — but implement, don't just file.
> **Supersedes the "A" half of B165.** Pluggable seam already exists (`TAX_RATE_SOURCES`/`resolveTaxRates`).

### B178 — Combined-rate choropleth `[Site Planner]` (feature)  *(arrived as "NEW-3"; filed provisionally as B169, renumbered **B178** — main took B167–B175. Build AFTER B176 + B177 land.)*
`[ ]` Optional map shading: color each parcel by its combined tax rate (light = low, dark = high) for across-area scanning. Click a shaded parcel → opens the **B177** tax-breakdown panel. Same screening caveat + data-age surfacing as every other GIS layer (rides `gisCache` SWR + honest per-layer status). Depends on B177's combined-rate derivation (which depends on B176's district overlays). Browser-only.
> **Dedup:** reuses the layer system (`lib/layers.js`) + `gisCache` (B96); not a parallel renderer.

### B177 — Parcel tax breakdown panel `[Site Planner]` (feature)  *(arrived as "NEW-2"; filed provisionally as B168, renumbered **B177** — main took B167–B175. This is the browser/screening "B" panel of the old B165 A/B decision.)*
`[ ]` Click a parcel → a panel section listing **each taxing entity** with its **rate per $100 of taxable value** (Texas convention — not mills), combined rate at the bottom. Columns: entity + rate only (no annual-dollar column). **ISD stays as a line item** (largest component; the combined rate is wrong without it) even though school is dropped from the jurisdiction chips/overlay. **Highlight the MUD line** — it's the variable that drives the underwriting delta. Browser phase = entities spatially derived from the overlapping districts (reuse `identifyJurisdiction` in `lib/jurisdiction.js`; add MUD + ISD identify sources) + rates from published district rate tables → **screening**; header reads **"Screening · verify against tax statement."**
- **Builds on B176's identify/overlay sources.** The existing **Taxes** `Section` in `SitePlanner.jsx` (~L6441, fed by `resolveTaxRates`) is the seam — extend it, don't add a parallel panel. Likely folds into the future **Site Analysis** tool (B147) as its "tax" category once that lands; until then it lives in the parcel panel.
- **Rates data is the open risk (the old B165 blocker):** no verified machine-readable statewide district rate table is wired yet. Until one is, the panel **lists the entities it can derive and marks rates "screening source pending"** — it must NEVER fabricate a rate (KEY DECISIONS). B179 (backend) is the authoritative upgrade.
> **Supersedes the "B" panel half of B165.** (B176 — the jurisdictions overlay this builds on — shipped 2026-06-19; see `BACKLOG-DONE.md`.)

### B171 — Evaluate license-clean high-res imagery sources `[Site Planner]` (feature)  *(arrived as "NEW-3"; filed provisionally as B169, renumbered **B171** — concurrent `main` took B167 + B168 for unrelated map items, so with the paired B169 (diagnostic) + B170 (retina fix) this is the real next free ID)*  — GATED, do NOT action yet
`[ ]` **Gated on B169's finding + a confirmation step.** Only pick this up **if**, after B170's retina/HiDPI fix ships, the Esri World Imagery backdrop still looks **genuinely soft / stale** over the Houston metro on a real display. B169 showed the dominant blur causes were **(a) no HiDPI tiles and (b) the planner's fractional zoom — NOT a low-res source** (Esri World Imagery is ~0.3 m/px native at z19), so this evaluation should **not** start until B170 is confirmed insufficient by eye. Add a **selectable** high-res basemap from a source that permits **tracing/measuring/derivative work** (Planyr users draw + measure site geometry over the aerial — a hard licensing constraint).
- **Hard exclusion (licensing):** do **NOT** use **Google Maps satellite** (scraped `mt.google.com` tiles = TOS violation; even the paid Map Tiles API forbids tracing building outlines off satellite) or **Mapbox satellite** as the tracing backdrop (commercial derivative tracing needs a paid Commercial Satellite license). Both are ruled out for Planyr's core use case regardless of sharpness.
- **Candidate sources, in order:** (1) **Texas Imagery Service** (formerly TNRIS) state orthoimagery; (2) **Houston-metro county appraisal-district orthos** (public record, often 6-inch, very current); (3) **NAIP** (federal, public domain) as a national fallback. All are traceable + license-clean.
- **Verify each endpoint against a known Katy parcel** for coverage, resolution, and recency **before** wiring it in — don't assume availability (county/state GIS hosts move and stop often; rely on the existing probe + honest error surfacing).
- **Premium AEC imagery** (Nearmap / Vexcel / Maxar, properly licensed) is a **future paid-tier** upgrade, **not in scope** here.
- Treat **imagery age/source as surfaceable metadata** (consistent with the "always surface data age" principle for the GIS layers).
> **Dedup:** distinct from **B162** (street-label zoom gating) and **B65** (white-flash on zoom/pan); this is about the *imagery source/resolution itself*. Builds on the swappable-basemap registry that already exists (`BASEMAPS` in `MapFinder.jsx` — Esri + USGS today), so adding a source is a registry row + a picker entry, not bespoke plumbing.

### B163 — Project `progress_pct` field on data model `[Site Planner]` (task)
`[ ]` Follow-on to B161 (Path A). Add `progress_pct SMALLINT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100)` to the projects/sites data model and wire it to the building marker's arc. Exact storage: either a column on the `sites` Supabase table via migration, or a field in the `Site Model` `data` jsonb. UI for editing (slider or inline input on the map pin or site list) TBD — scope separately. Until then, the arc continues to derive from status (Path B, B161).

### B159 — Task-names visibility toggle on PDF/Print export `[Scheduler / UI]` (feature)  *(arrived as "NEW-1"; minted B159 — highest B# across both files is B158, so this is the real next free ID)*
`[ ]` On the PDF/Print Exhibit export panel, task names in the Gantt preview are currently not shown (or shown inconsistently). **Target:** task names visible by default on export, with a toggle in the export sidebar to suppress them.
- **Default on.** Task names should render on the exported Gantt bars/rows by default — the toggle starts checked.
- **Toggle placement.** Add a labeled control (e.g. "Task names") in the export sidebar alongside the existing controls (Gantt, Today line, Dep. arrows). On = names visible; off = names suppressed from the exported output only. The live schedule display is never affected.
- **Persistence.** Toggle state persists for the session (or per-project export preference if that pattern already exists in the codebase).
- **Acceptance:** default export includes task names; unchecking the toggle produces an export with names removed; the live Gantt is unchanged in both states.

### B155 — Markup selection hit-testing: grab unfilled shapes by their interior, consistently at any zoom `[Document Review + Site Planner / UI]` (bug)  *(arrived as "NEW-1"; minted B155 — `main` concurrently took B147–B154 (easement tool, multipart parcel, Delete-key fix), so this is the real next free ID; provisionally B150 then B154 in earlier drafts — both numbers were taken by `main` while this was in flight)*
`[ ]` **Repro (owner-reported 2026-06-18):** drawing markups are too finicky to select — an **unfilled rectangle only selects when you click its border stroke** (the thin line), not its interior, so you have to "grab exactly on the line." At low zoom even the stroke is hard to land. **Expected:** forgiving, predictable selection for **every** markup type — clicking anywhere inside a closed shape grabs it, and the "grab feel" is the same whether zoomed way in or out.
- **Rendering approach (inspected — fix differs by surface, all THREE confirmed SVG):**
  - **Document Review (`DocReview.jsx`)** — *already correct, the reference implementation.* A centralized `hitTest(p)` (added under **B33**) already does interior-selection for `rect`/`cloud` (point-in-expanded-bbox), bbox for `text`, and nearest-vertex-OR-segment for measures, with a **screen-space tolerance** (`tol = 10/scale`). **Generalize THIS pattern; don't reinvent it.**
  - **Site Planner main canvas (`SitePlanner.jsx`, markup render ~L4698)** — neutral shapes (`rect`/`ellipse`/`polygon`) rendered `fill:"none"` with selection wired to each element's own `onPointerDown` → interior was dead, **stroke-only**. (Filled `els` and the special `utilRoute`/`encumbrance`/`traced` markups already select fine because they paint a real fill.)
  - **Parcel-drawing markup (`components/ParcelDrawing.jsx`, B67)** — the **Box** tool, identical defect: rect `fill:"none"` + element-level `onPointerDown` = stroke-only. (Text markups are positioned `<div>`s, so their box already selects.)
- **✅ Increment 1 — interior-grab for CLOSED shapes — DONE 2026-06-18 (branch `claude/busy-knuth-3q9cyn`):** the minimal, owner-requested rectangle fix. `pointerEvents:"all"` on closed markup shapes (`rect`/`ellipse`/`polygon` in `SitePlanner.jsx`; the `rect`/Box in `ParcelDrawing.jsx`) makes the **fill area a hit target even when unfilled**, so a click anywhere inside selects (and drags — both surfaces' move handlers already `stopPropagation`, so an interior grab won't also pan). This is the **same `pointerEvents="all"` technique B142 already shipped for text/callout boxes**, now extended to the neutral shape markups that B142 missed; Doc Review had the equivalent via B33. Open paths untouched (see below). **Self-verified headless on the Site Planner (V41): drew an unfilled markup rect → Escape deselects (handles vanish) → clicking its INTERIOR centre re-selects it (resize/rotate handles reappear) → PASS.** ParcelDrawing's identical one-attribute change was not separately driven (needs a drawing attached + rasterized), logged under V41 as low-risk-by-analogy.
- **🔲 Remaining (the "all the other elements" tranche — the actual handoff):**
  1. **Shared `hitTest`, one source of truth.** Lift Doc Review's hit-test into shared code (`src/shared/` — alongside the coordinate stub) as `hitTest(point, element, { tolerancePx, zoom }) → boolean|distance`, and route **all three** surfaces' selection through it, replacing the per-type/per-element click logic. The ported Site-Planner measurement tools (B116) and Doc Review share the same coordinate spine and should select identically — don't fork per workspace.
  2. **Tolerance is screen-space, converted at test time.** Default **6px**, `tolerance_world = tolerancePx / zoom` (Doc Review already does `10/scale`; standardize). This is what makes the grab feel zoom-independent.
  3. **Per-element rules:** *closed* (rect/ellipse/polygon/cloud) → point-in-shape **+** stroke buffer (cloud hit-tests its underlying polygon, not the scalloped path); *line/arrow* → point-to-segment ≤ tol, arrowhead included; *polyline/freehand/pen* → nearest-segment ≤ tol (factor in stroke width); *text* → full bounding box (single-click select, double-click edit), even with no border/fill; *callout* → text-box bounds OR leader line; *point/count* → generous ~8px screen radius (no area to aim at); *measurements* (linear/polyline/area) → matching shape rule **and** the value label is part of the hit region. **Measurements are takeoff-critical — treat hard-to-select or wrong-element selection as HIGH severity (same as a wrong number).**
  4. **Open-path forgiving hit area.** `line`/`polyline`/`pen` are still stroke-only after Increment 1. **Reuse the "fat invisible hit-stroke" technique already shipped in B146** (the dimension-callout grab line: a transparent wide-stroke duplicate over the visible line) rather than inventing a new one.
  5. **Z-order resolution:** hit-test top-of-stack downward, select the first hit; tie-break **smaller-area wins** (a small shape on/inside a large unfilled one stays grabbable). Empty-canvas click deselects.
  6. **Move-by-interior-drag vs. pan** stays explicit: select-mode interior drag = move element; pan-mode drag = pan. (Already true post-Increment 1; keep it true in the shared path.)
  7. **Resize/move handles win** over anything behind them, with a few px of screen-space slop.
- **Acceptance:** click inside an unfilled rect → selects; within ~6px of any stroke at any zoom → selects; zoom 10× in then out → identical grab feel; two overlapping shapes → topmost, and a small shape inside a big unfilled one → the small one; line/polyline/pen segment within tol → selects; anywhere in a text box → selects, double-click → edits; interior drag moves and never pans; empty click deselects.
> **Dedup / reconciliation — build on what's shipped, don't fork:**
> - **B142 + B143 (DONE) — the direct precedent.** B142 already set `pointerEvents="all"` on the **text/callout box** so its whole interior selects even with no fill (explicitly "to match Doc Review's shape-aware hit test"); B143 finished the Bluebeam-style text editing (Enter = newline, click-away/Esc to finish, via a `pointerEvents:"all"` click-out catcher). So **text-box selection + editing is already done on the Site Planner side — do NOT redo it here.** Increment 1 is the same fix applied to the shape markups B142 didn't cover. B141 likewise added measurement vertex-editing "consistent with Doc Review's shape-aware select."
> - **B33 (DONE)** is the reference hit-test — Increment 1 brought the other two surfaces up to its rectangle behaviour; the shared-`hitTest` tranche generalizes B33 rather than replacing it.
> - **B146 (DONE)** already introduced (a) the **transparent fat hit-stroke** for grabbing a thin line and (b) the shared inline **`numEdit`** on-canvas editor that replaced `window.prompt`. Reuse (a) for open-path markups here.
> - **Owner "no dialog boxes" rule (KEY DECISIONS, 2026-06-17):** Doc Review's **Text** tool is inline (B293) and **Calibrate** (Doc Review + Stitcher) is now inline with validation (**B304**) — no more `window.prompt` in those flows. **Only remaining:** **ParcelDrawing's calibrate** (`window.prompt`) → convert to the inline `numEdit` pattern; fold in here, don't file separately.
> - **Distinct from B149/B121 (LOD + label collision):** those govern what's *drawn* at a given zoom; this governs what's *selectable* when clicked. Keep separate.

### B156 — Hover highlight on the markup under the cursor (pre-click affordance) `[Document Review + Site Planner / UI]` (feature)  *(arrived as "NEW-2"; minted B156 — next free ID after B155)*
`[ ]` In **Select** mode, highlight the markup currently under the cursor — the element that *would* be selected on click — before the click lands, so you can see what you're about to grab. Subtle outline/glow; never disturbs the immutable PDF/drawing backdrop layer. **Depends on B155's shared `hitTest`** and must use the **same topmost/smaller-area resolution**, so the hover preview always matches what a click selects. Out of scope for B155 (a separate, lower-priority affordance) — minted net-new so B155 can ship without it.

### B148 — Site-summary readout renders as an oversized world-space banner over the map `[Site Planner / UI]` (bug)  *(arrived as "NEW-1"; minted B148 — highest existing ID was B147, so this is the real next free ID)*
`[ ]` **Repro:** open a site with buildings placed and zoom out to fit the parcels. The site summary (total SF / acreage / perimeter) draws as a giant stroked-orange monospace banner floating across the aerial, dwarfing and overlapping the site geometry. **Expected:** a compact, fixed-size readout pinned to the viewport (the visible map area) — a small corner chip or slim stats bar — that stays the **same size at every zoom level** and never overlaps geometry. **The values are correct — do NOT touch the SF/acreage/perimeter math; presentation only.**
- **Check first (world-space vs screen-space):** determine whether the summary is drawn into the map/canvas layer in **world coordinates** (positioned in real-world feet, so it scales with zoom — which would explain the ballooning) versus a **screen-space DOM/overlay** (fixed pixels regardless of zoom). Building labels render at a sane size, so they're likely already screen-space and the summary is the outlier.
- **Fix:** render in **screen pixels at a normal UI font size, decoupled from zoom**, matching the app's existing type treatment rather than the heavy monospace stroke.
> **Dedup / reuse (build on what's shipped, not a parallel pattern):** **B144 (scale bar) + B145 (north arrow)** already solved this exact class of bug for **print/export** — furniture that was sized in screen pixels then screenshotted into a differently-sized frame. They introduced `lib/sheetFurniture.js` with a **screen variant** (`buildScreenFurnitureSvg`) that anchors furniture to the viewport at a fixed modest size; the site-summary chip is the on-screen sibling of that work — reuse the viewport-anchored approach. **Distinct from B144/B145** in surface (the live canvas, not the print/PNG sheet) and element (the SF/acre/perimeter readout, not the scale bar or compass), so it's filed net-new rather than folded. **Interacts with B149 (LOD tiering):** the site-summary chip is explicitly one of the few "overview-tier" things that must stay visible when zoomed out — keep it on-screen as the high-level readout while fine dimensions drop away.

### B147 — Site Analysis tool: multi-parcel constraint & context screen `[Site Planner / Site Analysis]` (feature)  *(arrived as "NEW-2"; minted **B147** — highest existing ID was B146, so this is the real next free ID. "NEW-2" is only a scratch label from the arriving chat — B120/B134/B145 also "arrived as NEW-2".)*
`[ ]` A dedicated **Site Analysis** tool (working name — module naming not finalized) that runs environmental, regulatory, and infrastructure screening against the **combined footprint of the selected parcels** and presents findings **grouped by category**, presence-first. This is the **single home** for the checks currently buried in the parcel-info popup and for the **Tier 1 "site-killer" roadmap** in CLAUDE.md — build it as ONE surface; do **NOT** spin up a parallel one (see the reconciliation flags below).
- **Input geometry:** the **dissolved union of the active parcels** (the "site") — never a centroid, click point, or single parcel. Reuse **B100**'s `activeParcelsOf` selector so the screened footprint matches the same parcels yield/coverage/detention already use; exclude inactive parcels. **DECIDED 2026-06-17 (Michael): screen the ACTIVE-only union** (not all selected parcels) — confirmed consistent with the yield/coverage/detention math, so no remaining ambiguity here.
- **Finding categories** (v1 = presence + the single most decision-relevant attribute; detail-on-expand):
  - **Floodplain** — FEMA NFHL (National Flood Hazard Layer = FEMA's digital flood maps). Zone designation(s) intersecting the site + rough extent. *(Maps to the Tier 1 "finished-floor vs. base-flood" item — reconcile, don't duplicate; reuses the FEMA overlay already wired in B129/B133.)*
  - **Wetlands** — USFWS NWI (National Wetlands Inventory = the federal desktop wetlands map). Presence + classification. **Hard caveat: screening only — NOT a jurisdictional delineation;** a consultant delineation + USACE verification is required for any real determination. *(Reuses the NWI overlay from B133/B135.)*
  - **Pipelines** — PHMSA NPMS (PHMSA = the federal pipeline-safety agency; NPMS = its National Pipeline Mapping System) + RRC. **Caveat: public NPMS is deliberately low-resolution for security** — a flag to trigger 811/one-call + operator outreach, never a precise alignment.
  - **Oil & gas features** — RRC (Railroad Commission of Texas — the state oil/gas regulator, despite the name). Well bores (active / plugged / abandoned) + surface locations. **Caveat: historic well locations can be inaccurate or unmapped;** an RRC records search (possibly a survey) is the real check. High relevance for Houston-area sites (orphaned wells).
  - **Environmental contamination** — TCEQ LPST (Texas Commission on Environmental Quality, Leaking Petroleum Storage Tank database) + EPA sites. *(Maps to the Tier 1 "environmental screen (TCEQ LPST / EPA)" item — reconcile, don't duplicate.)*
  - **Jurisdiction** — city limits / ETJ / county / road authority. **This is B93 (shipped) + B94 (open) re-homed as a SECTION here, not a standalone Identify-panel button or popup field** — the discoverability fix (see below).
  - **Zoning / entitlement** — jurisdiction-dependent; pulled from the jurisdiction context. **Note: City of Houston has NO zoning — don't build as if every jurisdiction has it;** ETJ-area and other cities vary. *(Maps to the Tier 1 "entitlement/zoning" item; the per-jurisdiction rules are B95's "development-consequence summary" — reconcile.)*
- **Presentation:** findings grouped by category, **presence-first** — a clear **present / not-present / unknown** state per category, detail on expand. **Each finding carries its own data source + data-age stamp + a category-specific screening caveat — NOT one blanket disclaimer.**
- **★ Silent-error principle (HIGH severity):** **"Unknown / source unavailable" is a DISTINCT state from "not present."** A failed or timed-out source must **never** render as "no constraint." Reuses the existing honest per-layer status (B96/B129) — surface the failure, don't swallow it.
- **Architecture reuse (no parallel system, no new credentials):** runs on the **existing generic ArcGIS-REST connector + source registry** (`lib/jurisdiction.js` / `lib/vectorLayers.js`) + the **GIS stale-while-revalidate cache (B96)** + honest per-layer status. Each new source (NFHL, NWI, NPMS, RRC, TCEQ/EPA) is **a registry row, not bespoke code.** Browser-only where the sources are public REST services.
> **Dedup / reconciliation — these are NOT new items; fold this work into / build it on top of them (each aware of the other, never a forked parallel surface):**
> - **B93 (jurisdiction identify — DONE, shipped + verified live) + B94 (road authority — open):** **re-home the jurisdiction/road-authority identify as a SECTION inside Site Analysis**, not the standalone "⚖︎ Jurisdiction & road authority" Identify-panel button it ships as today (and never a popup field). This is the **discoverability fix** the arriving note asks for — same engine, surfaced inside the analysis tool.
> - **CLAUDE.md Tier 1 "site-killer" roadmap** (storm outfall, sanitary sewer, fire flow, finished-floor-vs-base-flood, environmental screen, entitlement/zoning): these are **Site Analysis sections, not a parallel surface** — reconcile so they render in THIS tool. (Storm outfall / sanitary sewer / fire flow are infrastructure sections to add alongside the v1 categories above.)
> - **B95 (jurisdiction → development-consequence summary — DEFERRED):** its per-jurisdiction rules (who regulates platting, whether zoning applies, who reviews drainage/detention + fire flow, who permits access) feed the **Zoning/entitlement + Jurisdiction sections** here — the consequence layer surfaces *in* Site Analysis when it's picked up.
> - **B96 (GIS SWR cache — open):** the cache + honest-status mechanism this tool rides on; B96 stays the foundation (sequence accordingly).
> - **B98 (parcel-popup declutter — DONE) + B100 (active/inactive parcels — DONE):** **heavy analysis moves OUT of the parcel-info popup into Site Analysis; the popup keeps only lightweight parcel identity (owner/name, ID, area).** Input footprint = B100's active-parcel union (see Input geometry above).
> - **FEMA/NWI overlay layers (B129/B133/B135):** the Floodplain + Wetlands findings reuse those already-wired overlays as their data source — read them, don't re-plumb them.
> **★ v1 SHIPPED 2026-06-19 (branch `claude/trusting-allen-xatlua`) — the tool now exists as ONE surface; remaining categories are registry rows.** Built the whole Site Analysis surface on the existing infra (no parallel system, no new credentials): a new registry-driven connector `lib/siteAnalysis.js` rides the same SWR cache (B96) + the verified jurisdiction engine (B93/B94, `jurisdiction.js`) + EPSG:4326 boundary as the parcel identify, and a new `components/SiteAnalysis.jsx` panel opened from a new **"⚐ Analysis"** left-rail tab. It screens the **dissolved footprint of the ACTIVE parcels** (B100's `active !== false`, converted to lon/lat rings via `feetToLatLng`) as a single multipolygon intersect, and presents findings **presence-first, grouped by category**, each with its own source + data-age + a category-specific caveat (no blanket disclaimer).
> **★ The silent-error principle is enforced in code + unit-tested (HIGH severity):** a finding is `present` / `absent` / `unknown` / `info` / `pending`, and `classifyStatus` only reports a confident **"None found"** for a `verified` source returning empty — an unverified or errored source reads **UNKNOWN, never a fabricated all-clear**. Pending categories read **"source not connected"** (distinct from "none").
> **Categories wired in v1:** **Floodplain** (FEMA NFHL layer 28, `verified`), **Jurisdiction** (city/ETJ/county) + **Road authority** + **Zoning/entitlement** (derived: Houston→no zoning, other city→zoning likely, unincorporated→no county zoning) — all reusing `jurisdiction.js`. **Wetlands** (NWI staging split layers 1,2), **Oil & gas wells** + **Pipelines** (TxRRC via the Harris County GIS host) are wired but `verified:false` (their /query reliability is unconfirmed, so empty → honest unknown). **Environmental contamination** (TCEQ LPST / EPA) is a `pending` registry row (no confirmed CORS-clean endpoint yet) → reads "source not connected." Adding/verifying any source later = flipping a registry row, not new code.
> **Tests + verification:** new `test/siteAnalysis.test.js` (28 cases: geometry/query building, summarizers, the present/absent/unknown guard, multi-sublayer query, cache ride, jurisdiction-throw resilience, full orchestration order). lint **0 errors** · **285 tests** · build green · `SitePlannerApp` lazy chunk intact. **Self-verified headless on the built app** (`gis-verify/site-analysis-verify.{mjs,png}`): seeded a georeferenced Katy parcel → Analysis tab → **Floodplain = PRESENT "Zone AE, X"** (live FEMA), **Jurisdiction = Fort Bend / Katy**, **Road = State (TxDOT)·City**, **Zoning = "Within Katy — city zoning applies"** (live), and the sandbox-blocked Wetlands/Pipelines/Wells correctly read **UNKNOWN ("Failed to execute query")**, Environmental **"Not connected"** — the honest-state path confirmed.
> **🔲 Remaining (kept open — the additional-categories + polish tranche):** (1) **verify + flip** Wetlands / Pipelines / Oil&gas to confident `absent`-capable once their /query + correct sublayers are browser-confirmed (today they degrade to unknown, which is safe but conservative); (2) wire a real **TCEQ LPST / EPA** contamination source (the pending registry row); (3) add the **Tier-1 infrastructure sections** (storm outfall, sanitary sewer, fire flow) as registry rows in this same tool; (4) **re-home the in-Identify "⚖︎ Jurisdiction & road authority" button** fully into Site Analysis (today it still also lives on the point-identify result — kept to avoid regressing that flow); (5) signed-in/live planyr.io click-through (the sandbox proved the path with live FEMA + TxDOT, but a real-display pass is worth logging).

### B115 — Revisit keyboard shortcuts: memorability + let the owner remap them `[Site Planner / UI]` (task) — owner-gated
`[ ]` Owner note (2026-06-16): the planner's single-key shortcuts are hard to remember and Michael may want to change them — **park this for a deliberate pass with him; do NOT unilaterally rename keys.** Decide together: (a) whether the current assignments stay, (b) whether to make them **user-remappable** (a small settings screen + persisted overrides) vs. just keep a fixed, better-surfaced set, and (c) whether any are non-obvious / collide with muscle memory (e.g. **S** could read as "save"). Current bindings, for reference when picked up: **V** Select · **H** Pan (+ hold **Space** = temp pan) · **S** toggle Snap (new, B114) · **Q** Callout · **T** Text · **L** Line · **R** Rect · **E** Ellipse · **⇧P** Polygon · **⇧N** Polyline · **Ctrl/⌘ Z / ⇧Z / Y** undo/redo · **Ctrl/⌘ C / X / V / D** copy/cut/paste/duplicate · **Delete/⌫** delete · **Esc** cancel · **?** shortcuts panel; gestures **⇧-drag** bond-to-neighbour, **Alt-drag** bypass-snap (B114). All are already listed in-app under the **?** panel. No code change yet — awaiting the owner's preferences.

### B13 — Refine B11 county resolution: precise boundaries + per-area jurisdiction `[Site Planner / map]` (feature)
`[ ]` Follow-up to **B11** (shipped in PR #13) — two interim simplifications captured here so they aren't forgotten. Neither is urgent; both are screening-only conveniences today and degrade gracefully.
- **Coarse bbox pre-filter → real point-in-county.** B11 routes a parcel click to a CAD service using *approximate* per-county bounding boxes (a coarse screen; the CAD that actually returns a lot is the source of truth, with a fall-back to querying all counties). Fine for the 3 configured counties (Harris / Fort Bend / Chambers), but as more counties are added, switch to true point-in-county boundary polygons so the pre-filter stays accurate and cheap. **(STILL OPEN.)**
- **Layers panel jurisdiction is hardcoded to Harris/Houston.** ~~With no county pre-picked, the map's Layers panel defaults to the Harris/Houston jurisdiction…~~ **DONE** — the map Layers panel jurisdiction now follows the map's current area.
> Progress 2026-06-15 (this PR): **point 2 done** — the map's Layers panel jurisdiction is no longer hardcoded to Harris; `MapFinder` resolves `viewCounty` from the view centre via `candidateCountiesForPoint` on every `moveend`, so the correct utility overlays are offered outside Houston (falls back to Harris when the centre is outside all configured counties; per-site jurisdiction still follows the opened site's county). **Point 1** (true point-in-polygon county boundaries vs. the bbox pre-filter) remains open — the bbox screen is still adequate for the 3 configured counties, so this is deferred until more counties are added.
>
> **What this is (plain English, 2026-06-15) — the "county resolution" theme.** B13-pt1 + **B36(a)** + **B36(d)** are really one piece of work: *how the app decides which county's appraisal-district (CAD) service to query when you click the map.* Today it screens by approximate per-county **bounding boxes** — fine for interior clicks in the 3 configured counties (Harris / Fort Bend / Chambers). The gaps, all near a county border or when a 4th+ county is added: **B13-pt1** the bboxes overlap/approximate → replace with true county **boundary polygons** (point-in-polygon); **B36(a)** the statewide TxGIO fallback can mislabel a Harris/FB lot's `county` when the primary CAD returns nothing; **B36(d)** a click on a county line should query both CADs and merge (only the first hit is used today). **Needs a county-boundary GIS dataset** to load + test points against — a data-source decision, so it's **feature-scale, not a quick fix**, and **low urgency** (interior clicks in the current 3 counties are fine). When picked up: choose/confirm the boundary source first, then point-in-polygon resolution + straddle merge fall out of it.
>
> **Progress 2026-06-15 (branch `claude/festive-davinci-0oco2n`): the point-in-county primitive now exists.** B72 landed the verified TxDOT county-boundary layer, and `lib/jurisdiction.js` `countyAtPoint(lng,lat)` resolves the true county (cached) and maps it to a configured CAD key — exactly the dataset/primitive this item was waiting on. **Pt 1's routing SWAP is deliberately NOT done:** the existing parallel "query candidate CADs, answerer wins" identify is faster + more resilient than a blocking point-in-county lookup before every click, so replacing the bbox pre-filter would regress, not improve. The primitive is instead used additively for the **B36(a)** label correction (see B36's note). The data gap pt 1 cited is closed; the bbox pre-filter stays by choice.

### B124 — Data loss: saved work disappeared / reverted to a prior state on Schiel Road and JFK `[Persistence]` (bug) — DATA-LOSS, critical
`[ ]` Repro: the owner had work on both **Schiel Road** and **JFK**; after a reload/redeploy, recent work is missing — Schiel reverted to an earlier saved state, JFK work gone. Exact trigger TBD (likely a recent deploy). Expected: saved work persists across reloads and deploys, with no silent loss. **Investigate root cause before any fix:** (a) confirm whether `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` were present in the Cloudflare build currently live (the known build-time-env gotcha — a build missing them ships a cloud-off client that silently falls back to device-only storage, so cloud edits look "lost"); (b) check whether the in-flight Document-Review cloud-persistence branch touched shared save/load. **Critical first step — verify cloud state, don't act on assumptions:** confirm whether the Schiel/JFK rows still exist in Supabase Postgres (data intact, connection broken) vs. actually overwritten or deleted (needs backup/PITR). **Do NOT push a destructive fix before confirming the cloud state.**
> Dedup/cross-refs (filed as net-new — this is the incident report, distinct from the prior root-cause items): related candidates already on file are **B54** (`pullCloud` blind-overwrites the per-user cache with `{}` on a fetch error → scary empty state) and **B18** (last-debounce-window edits flush local-only, then `pullCloud` blind-replaces on next login); the build-time-env gotcha also underlies **B111** (no sign-in affordance when Supabase is unconfigured). If the investigation pins the cause to one of those, note it both here and there rather than re-fixing. The guardrail in **B125** would have surfaced this immediately instead of after the loss.
> **Diagnosis 2026-06-16 (branch `claude/optimistic-knuth-51cjwg`): NOT deletion — data confirmed safe in Supabase.** Two findings: (1) **Two un-bridged stores.** Logged-OUT work lives in `planarfit:sites:v1`; signed-IN work in the per-user cache `planarfit:sites:cloud:<uid>` (mirrors Supabase). `sitesKey()` swaps between them on auth state and they NEVER auto-merge — so on-device work looks "gone" once you sign in (you're viewing the other drawer), and reload bounces to the map because the resume's `loadSite(cur)` misses in the active store. (2) **Transient reload churn** (supabase-js `^2.108.1` re-emits SIGNED_IN on tab focus → `applyUser`→`pullCloud`+resume). Audited EVERY delete path: `cloudDelete` fires only on an explicit user delete (`deleteSiteGroup`) or dropping a truly blank **and** un-located site (`persistOrDrop`); a site with content is never auto-deleted. Owner confirmed the work reappears across sign-in/out toggles (consistent with the two-drawer read, not loss). Fix proceeding under **B125**.
> **★ ROOT CAUSE FOUND + FIXED 2026-06-16 (branch `claude/optimistic-knuth-51cjwg`).** The core defect was in `pullCloud` (`storage.js`): it rebuilt the local cache from the **cloud list ALONE** (`const map={}; for (const m of models) map[norm.id]=…`) then overwrote the cache — so **any local site the cloud didn't return was silently dropped.** A site whose push hadn't landed (slow network / stale session / brand-new) thus vanished from the cache on the next pull; the resume's `loadSite(cur)` then missed → `applyUser` bounced to the map → "my work disappeared." It re-fired on a background tab-focus `SIGNED_IN` re-emit → "disappears on its own a couple minutes later"; it "came back" on sign-out (legacy drawer) or re-sign-in (re-fetch). Fix (all additive, on the branch): (1) **`pullCloud` now MERGES** local+cloud via the new pure, unit-tested `mergePulledSites` — local-only work is kept **and re-pushed**, never dropped (newer-wins on overlap); (2) a **redundant same-user `SIGNED_IN`** re-emit is skipped (no re-pull/bounce churn); (3) **sign-out no longer wipes** the per-user cloud cache (a transient token-refresh `SIGNED_OUT` can't vanish work; privacy-neutral — logged out reads the legacy store); (4) a **loud cloud-save-failure banner** + Retry (B125); (5) a **one-click on-device→account import** bridges the two stores (B125 pt1). lint 0 err · **144 tests** (6 new) · build green. **NOT merged to `main` — owner verification first.** Follow-up (lower priority): a per-record synced-marker to also respect a true cross-device delete (the current single-device-safe trade-off can reappear a delete made on another device).
> **★ Status corrected 2026-06-17 (this session):** this root-cause fix is NOT unmerged — it **shipped to `main` via PR #81 and is DEPLOYED to live planyr.io** (verified in the deployed bundle), with **cloud ON** (Supabase URL baked in). So this specific `pullCloud`-drop defect is fixed + live; the ongoing-loss *incident* continues under **B134** as a different, still-open cause (not this drop, not cloud-off).

### B125 — Make cloud save status visible and write failures loud — no silent failures `[Persistence]` (feature)
`[ ]` Add a persistent save-status indicator (saved / saving / offline). When a cloud write fails, or the client can't reach Supabase, show a **blocking, visible banner** rather than failing silently — so a "Cloud off" state is never invisible again. Keep a local fallback copy of unsaved work and warn before any action that could discard it. This is the guardrail that would have surfaced **B124** immediately instead of after data loss.
> Dedup/cross-refs (partially built — keep open for the net-new asks): **B108** already folded the floating cloud diagnostic into one header save/sync badge (Syncing / Synced ✓ / Saved ✓ device / Offline / Unsaved), **B111** added a "⊘ Cloud off" pill when Supabase is unconfigured, **B112** gave Document Review a status-dot save badge, and **B54** surfaces a "showing your last synced copy" banner on a pull error. **Net-new here:** make a cloud *write* failure **blocking/loud** (not just a quiet pill), guarantee the offline / cloud-off state is impossible to miss, keep an explicit local fallback of unsaved work, and warn before any action that could discard unsaved edits. Build on B108/B111/B112/B54 rather than duplicating them.
> **Progress 2026-06-16 (branch `claude/optimistic-knuth-51cjwg`): part 1 landed — additive + non-destructive.** Bridges the two-store gap from B124: `storage.js` gains `legacySitesList` / `importLegacyIntoCloud(uid)` / `pendingLegacyCount(uid)`; `SitePlannerApp` shows a map-view banner when signed in with on-device sites not yet in the account ("saved on **this device**" vs "your account") + a one-click copy-up that KEEPS the originals (newer-wins, then re-pull + refresh). No existing save/load/merge/auth logic changed. lint 0 err · 138 tests · build green. **Still open (part 2):** a loud/blocking save-write-failure indicator, and stop the silent reload bounce-to-map (the trust + stability half). Not yet merged to `main` — owner review first.
> **Progress 2026-06-16 (part 2 + the real fix landed, same branch):** (a) **loud cloud-save-failure banner** — `SitePlanner` tracks a precise `cloudSaveFailed` (set only when a signed-in cloud write actually fails, not the normal logged-out device-save) and shows a dismissible red banner with **Retry now**, so a failed save is never a silent tiny badge again; (b) the **bounce-to-map / "disappears on its own" root cause is fixed at the source** — see B124's ROOT CAUSE note (the `pullCloud` drop). Together with B125-pt1's store bridge, this is the comprehensive fix. lint 0 err · 144 tests · build green. Still **not merged** — owner verification first.
> **Merged in 2026-06-17: arriving item "NEW-3" (Make save state visible and never fail silently `[Persistence]` feature) — a near-verbatim restatement of THIS item, folded in here rather than minting a new B# (it would be a duplicate).** It reinforces the existing asks: a persistent **Saved / Saving… / Unsaved / Save failed** indicator tied to *real write success*, not optimistic UI (never show "saved" before the write confirms); loud surfacing of every save error instead of swallowing it; a `beforeunload` "leave site?" warning while unsaved edits exist; and never sitting silently in a "Cloud off" state — show a clear banner and fall back to a durable local store. **One emphasis to carry into the build:** make that durable fallback **IndexedDB**, not localStorage (see B134 #2 — the ~5 MB localStorage cap is itself a suspected data-loss cause), and treat silent persistence failure as **HIGH severity, same as a crash.** No scope change — same feature as already specced above.
> **★ Status corrected 2026-06-17 (this session):** the loud save-failure half **shipped via PR #81 and is DEPLOYED** — the live planyr.io `SitePlannerApp` chunk contains the **"Retry now"** banner + the on-device→account import, so "not merged" above is stale for that part. Still genuinely OPEN: the **IndexedDB durable fallback** + the **`beforeunload` unsaved-edits warning** (NEW-3's emphasis) aren't built yet — and the live "Retry now" banner did NOT surface the 2026-06-17 SCHIEL loss, so this item must also ensure a save that silently no-ops (never visibly attempts/fails) still trips the indicator (see B134 #3/#4).

### B128 — Import reported 3 sites but the account total rose by 2 — confirm all imports land `[Persistence]` (bug) — low, needs repro
`[ ]` From the V15 cohort run (T4, signed-in): the `importLegacyIntoCloud` banner said "**3** sites brought into your account" but the account count went **15→17** (not 18). Non-destructive (local copies kept) so **no loss**, but one import may not have landed. Investigate: a failed push counted optimistically, an id collision/dedupe, or just a stale display count. Needs a clean repro on throwaway sites — check `importLegacyIntoCloud`'s `copied/skipped/failed` against the actual account-list count, and confirm all three rows are queryable in `public.sites`.

### B121 — Site element labels and dimension callouts overlap into an unreadable pile `[Site Planner / UI]` (bug) — medium  *(arrived as "NEW-1"; filed provisionally as B117 then B119, renumbered B121 after concurrent merges took B117/B118 (#75) and B119/B120 (#77) — this item's own #76 merged a moment before #77, colliding on B119; moved here rather than the parking pair, which cross-reference each other)*
`[ ]` **Repro:** lay out a site with adjacent elements (building + trailer-parking strip + detention pond + sidewalks) and view at a zoom where the parcel fills the screen. Every element's label, area, and dimension annotation renders at the shape's centre with no collision handling, so they pile on top of each other — `"Building 193,000 sf (+2 bump-outs) 300′ × 638′"` runs straight into `"Trailer Parking 53 trailers 638′ × 50′"`, and the `"5′ Sidewalk"`, `"300′"`, `"638′"`, and `"37.86 ac"` callouts all overprint each other. **Expected:** labels stay legible at any zoom, with no two text blocks overlapping.
- **Collision handling** (code that detects when two labels would overlap and resolves it): when labels collide, nudge them apart, stack them, or hide the lower-priority one rather than overprinting.
- **Narrow shapes need an escape hatch.** The trailer strip is ~50′ wide but its label is far wider, so a centred label can't fit. When a label exceeds the shape's width, pull it outside the shape with a **leader line** (a thin line connecting the label to the element it names) instead of cramming it inside.
- **Label priority / level-of-detail.** Zoomed out, show only the element name (or name + area); reveal the full dimension callouts (`"300′ × 638′"`, `"5′ Sidewalk"`) only when zoomed in enough that they fit without colliding. **Dimension annotations and area annotations should be separately toggleable** so a crowded view can drop one tier.
- **Separate dimension lines from name labels.** The edge-dimension callouts (the red `"300′"`, the `"638′"`, the `"5′"`) are a different layer than the centred element names — they should not share the same collision pool or overlap the name labels.
- **Sanity check** against this exact layout (building 300′ × 638′ beside a narrow trailer strip beside a 9-ac pond) — if all of those read cleanly, the fix holds.
> **Progress 2026-06-16 (increment 1 — branch `claude/determined-brown-bf86l7`): the shared label level-of-detail + collision engine is in.** New pure module `lib/labelLayout.js` (`fitLines` + `layoutLabels`, unit-tested in `test/labelLayout.test.js`) now drives the **centred element labels** (`SitePlanner.jsx`): each label is a priority-ordered stack (name → area/sf → dimensions, name last to drop) handed to the engine, which (a) **level-of-detail** drops the lowest lines first to fit the shape's smaller on-screen dimension — so a label can't spill past a narrow trailer strip and falls back toward just the name when zoomed out — and (b) **collision** places labels most-important-first (buildings, then larger area), shrinking or hiding a label that would overprint a higher-priority one instead of stacking on top. Zoomed in, shapes are large and spread out, so all lines show as before. lint 0 · 173 tests · build green · lazy split intact. **This is the shared engine B123 plugs into** (its building stack feeds the same pool, no parallel renderer). Browser-verify logged as **V19**.
> **Progress 2026-06-16 (increment 2a): the red edge-dimension layer now thins on zoom-out too.** The per-edge dimension callouts (the `"300′"`/`"638′"` ticks in `renderElPx`) are gated by `dimCalloutVisible(ppf)` (`lib/labelLayout.js`, unit-tested) — shown at working zoom, hidden once zoomed out past ~0.18 px/ft — so they no longer shrink onto the centred names when zoomed out (mirrors the label engine's zoom-out thinning). lint 0 · 175 tests · build green. Browser-verify logged as **V22**.
> **Progress 2026-06-17 (increment 2b): leader lines — the narrow-shape escape hatch.** `layoutLabels` now returns a placement `{lines, x, y, leader}`: a label too wide for its shape (a small building / narrow strip) is pulled OUTSIDE, centred just above the shape, with a thin leader back to the centroid and a white halo so it reads on the paper; labels that fit stay inside, unchanged. Rotation-aware shape half-extents drive the fit. **Self-verified in a headless browser** (Playwright on the production build): a 131′×131′ building lifts its "Building 1 / 17,274 sf / 131′×131′" label above the square with a leader, while a 686′×486′ building keeps its label inside — screenshot eyeballed (the same shot also showed B122 numbering and B123's stack rendering correctly). `lib/labelLayout.js` + `SitePlanner.jsx`; unit-tested (leader placement + inside-stays-inside). lint 0 · 204 tests · build green. Verified as **V31**.
> **Still open (increment 2, remaining — minor):** (a) at *working* zoom the dimension callouts are still a separate layer (zoom-gated, but not in the centred-label collision pool), and there's no explicit **dimension/area toggle** yet; (b) live-browser tuning of the `pad` / importance / `DIM_CALLOUT_MIN_PPF` thresholds + the leader gap/placement against busy real layouts.
> **Re-report 2026-06-18 (owner, arrived as "NEW-2" — folded HERE, NOT separately minted, per the no-duplicate rule: same bug, same surface, same fix as this open item).** Fresh instance: at a fit-to-parcels zoom the **"37.36…" dimension**, the **"5′ Sidewalk"** callout, and the **"Building 1 / 198,000 sf"** label stack on top of each other near the buildings and become unreadable. The ask sharpens increment-2's still-open work: (1) **fold the edge-dimension callouts into the centred-label collision pool** (today they're only zoom-gated, not collision-resolved against the name/area labels — the cause of this pile-up), and (2) **place dimension text OFF the line it measures** (offset + leader), not centred on it. Anti-overlap can be "leader lines or simple nudging." **Split from LOD:** the owner explicitly separates zoom-based show/hide, now tracked as the new **B149** (LOD tiering). Build B149's tier tags first so this collision pass only has to run on whatever's still visible at detail zoom.

### B131 — Clip a generated parking field to the parcel boundary `[Site Planner]` (feature) — large lift  *(split out of B130; minted B131 — next after B130)*
`[ ]` When a parking field (and its double-loaded module fill) extends past the parcel / usable-area boundary, clip the generated stalls + aisles to that boundary instead of drawing and counting pavement outside it — so stall yield reflects only what actually fits on the site. Called out as **out of scope** in B130 (that layout engine fills a drawn rectangle; this trims the fill to an arbitrary boundary). Large lift: needs rectangle-vs-polygon clipping of the stall bands, a yield recount on the clipped set, partial-stall handling at the cut, and the curb rule re-applied to the clipped perimeter. Builds on the existing parking generator (`carStalls` / `lib/parking.js`) + the parcel / usable-area polygon.

### B136 — Recover the lost SCHIEL plan (10-building state) before it's overwritten `[Persistence]` (task) — DATA-LOSS RECOVERY, TIME-SENSITIVE  *(arrived as "NEW-1"; minted B132 → B133 → B136 across concurrent merges — #99 took B132 (detention) and a wetlands PR also landed a B133, so this is the real next free ID after B135)*
`[ ]` **TIME-SENSITIVE — do this before any further edits to SCHIEL, since the next successful save may overwrite the only surviving copy.** The owner's work was a SCHIEL site plan with **Buildings 1–10 + a detention pond** (per his exported PDF "SCHIEL · Plan 1", 2026-06-17; site stats **461.19 ac, 4,035,128 sf building, 2,519 car stalls**). After a `Ctrl+Shift+R` hard reload the app reverted to a **6-building** state (Buildings 1–6). Using the signed-in headless browser: **(a)** query Supabase for ALL plan/site records on his account and look for a row or version containing 10 buildings — it may live under a different record id, plan version, or an autosave/history table than the loader reads; **(b)** inspect `localStorage` and IndexedDB for a serialized plan with 10 buildings; **(c)** check any autosave/snapshot/version history. If found, restore it as the active plan and confirm it loads. If found nowhere, report that the editable data is unrecoverable (the PDF remains a visual record only). Corroborating detail that these are two genuinely different saved states, not a render glitch: **Building 1 differs** — the 10-bldg PDF shows 471,750 sf / 450′×1,019′; the 6-bldg state shows 499,200 sf / 450′×1,080′.
> **Dedup / cross-refs — filed net-new because this is a one-time RECOVERY action, distinct from the bug-fix items.** Same SCHIEL data-loss thread as **B124** (Schiel/JFK reverted after reload; root cause = the `pullCloud` thin-merge) and **B126/B127** (content-preserving merge + automatic local version history). Two facts decide whether recovery is even possible: (1) **B126's `Plan ▾ → Version history…` restore is exactly the recovery tool this needs — and ★ corrected 2026-06-17 (this session): it IS LIVE on planyr.io** (the deployed `SitePlannerApp` chunk carries the `planarfit:sites:history:v1` key + the "Version history" dialog; B126 merged via PR #83). **So the owner can likely restore SCHIEL himself in a few clicks — Plan ▾ → Version history… → pick the 10-building snapshot — but ONLY on the exact computer + browser where that work was done** (the snapshot ring is local/per-device, never cloud). Try that FIRST if he is on the same machine. (2) B124's investigation found the cloud copies were *safe in Supabase* in that incident, so **check Supabase first** — a fuller SCHIEL row/version may still be there. Recovery order: Supabase rows/versions → this device's `localStorage`/IndexedDB → the B126 history ring *if* that code ever ran here. Recovery only — the durable fix is **B134**, the visible-status guardrail is **B125**.

### B134 — Edits silently lost on reload; app loads a stale earlier state `[Persistence]` (bug) — DATA-LOSS, critical  *(arrived as "NEW-2"; minted B133, renumbered B134 amid concurrent merges; its sibling SCHIEL-recovery item ultimately landed at B136)*
`[ ]` **Repro:** (1) open planyr.io, sign in; (2) load/build a Site Planner plan and make edits (e.g. add buildings until the plan is materially larger); (3) hard-reload with `Ctrl+Shift+R`. **Observed:** the plan reverts to an earlier saved state, recent edits gone, no error shown. **Expected:** after ANY reload (normal F5 or hard `Ctrl+Shift+R`), the most recent saved state loads intact — newer work is never silently replaced by an older state.
> **Diagnostic note:** `Ctrl+Shift+R` bypasses the HTTP cache but does NOT clear localStorage, IndexedDB, sessionStorage, or cookies. Work vanishing on a hard reload therefore means it was never durably saved (or the loader prefers a stale source) — the reload did not delete it. Isolate the layer first by testing F5 vs `Ctrl+Shift+R` vs a fresh tab vs tab-close; that tells you whether the gap is in-memory-only, local storage, service-worker cache (the background script that can cache the app), or cloud.
> **Candidate causes, rough priority** (confirm with the signed-in headless browser; capture network + console):
> 1. ~~**Supabase "Cloud off"**~~ — **RULED OUT 2026-06-17 (this session):** the live planyr.io shell bundle has the Supabase URL `lyeqzkuiwngunutlkkmi.supabase.co` baked in, so cloud IS configured/on. (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are baked in at BUILD time, not runtime; a build missing them ships a cloud-off client that silently falls back to device-only storage — "has bitten twice" — but that is NOT the case on the current deploy.)
> 2. **Browser-storage quota** — if cloud is off and the app falls back to localStorage, a growing plan can cross the browser's ~5 MB local-storage cap and writes start throwing `QuotaExceededError`, silently dropping saves. Fits the symptom exactly (smaller plan saved, larger one did not). If so, move plan state to IndexedDB (far larger limit) and/or fix cloud.
> 3. **Save not firing / debounce race** — if autosave is debounced (waits for a pause in editing before writing), reloading before the timer fires loses the last edits. Flush on `visibilitychange`/`beforeunload` and on explicit navigation.
> 4. **Save firing but erroring silently** — the Supabase write returns 401/403 (expired auth token, or a row-level-security rule blocking the write), 409 (conflict), or a swallowed network error. Surface and log every save failure.
> 5. **Wrong load precedence / record mismatch** — newer work saved locally but on boot the loader fetches the cloud copy and the stale cloud version clobbers it (or vice versa); or edits save under a different plan id/version/key than the loader reads. Make load deterministic: newest-wins by timestamp, single source of truth.
> Likely lives in the shared cloud save/load layer, so fix it workspace-agnostically even though it surfaced in Site Planner.
> **Dedup / cross-refs — filed net-new: same SYMPTOM class as B124, but a fresh live recurrence that raises two UNINVESTIGATED root causes.** Same "data loss on reload" symptom as **B124** (Schiel/JFK), whose root cause (the `pullCloud` thin-merge + the two-store split) was found and fixed in **B126/B127**, with the loud-failure half in **B125** — and **★ corrected 2026-06-17 (this session): all of B124/B125/B126/B127 are MERGED (PRs #81/#83/#85/#89) AND DEPLOYED to live planyr.io** (the live `SitePlannerApp` chunk carries the B126 version-history key `planarfit:sites:history:v1` + the "Version history" dialog + the B125 "Retry now" banner; the shell has the Supabase URL baked in → **cloud is ON**). So the recurrence is **NOT unmerged code and NOT cloud-off — both ruled out**, which eliminates candidate #1 and #2's cloud-off premise. Refocus on the causes the shipped fixes do NOT cover: **#3** (the 10-building state never durably persisted — a debounced cloud push that didn't fire before the reload, so the loader fell back to the older 6-building cloud copy; B126's union-merge only recovers work that reached a store, not work that never persisted — the closest fit), **#4** (a silent save error — expired auth token / RLS 401–403 / 409), or **#5** (load precedence). Also overlaps the historical **B18** (last-debounce-window edits flush local-only) and **B54** (`pullCloud` overwrites the cache with `{}` on a fetch error). If the investigation pins the live cause to one of those, note it both here and there rather than re-fixing. The visible-status guardrail is **B125** (it would have surfaced this immediately); the SCHIEL recovery action is **B136**.
> **Progress 2026-06-17 (this session, branch `claude/nice-ptolemy-9j0u7g`): the load-precedence half (#5) is FIXED in code.** Root cause pinned in the boot sequence: `SitePlannerApp` renders the planner `key={activeSiteId}` and the planner snapshots its plan from storage **once at mount**; the first synchronous render runs BEFORE auth resolves (`activeUser` still null → reads the legacy/local store), so a signed-in user can paint a stale copy — and the authoritative copy that `applyUser`'s `pullCloud` merges in is a **same-tab `localStorage` write (fires no `storage` event)**, so the already-mounted planner never refreshes. Exactly the owner's "showed 6 buildings, then came back to 10 on its own." Fix: a `loadEpoch` bumped after the boot/sign-in pull and folded into the planner's `key`, forcing a one-time remount so the resumed plan re-reads the freshly-merged store. **Display/load-timing only — the save/merge/version-history logic is untouched, so it cannot worsen data safety** (worst case is a sub-second remount). lint 0 errors · 191 tests · build green · lazy split intact. **Still OPEN:** causes **#3 (never-persisted / debounce-flush gap)** and **#4 (silent save error)** — the true-loss cases where work never reached any store — need the visible/honest save-status + flush work tracked in **B125/NEW-3**. **Verification gap:** the sandbox browser can't sign in, so the signed-in boot path needs a signed-in click-through to confirm end-to-end; the change is gated to the signed-in resume branch, so logged-out behavior is unchanged. **The signed-in end-to-end browser confirmation is logged as VERIFICATION V28** — the "limit" this session couldn't self-run (sandbox can't sign in); a signed-in coworker runs it down.
## 🎨 UI audit pass — 2026-06-16

Full UI workstream from `UI_AUDIT.md` (re-authored this session: the predecessor 58-item
audit lived only in a parallel chat and was never committed, and several of its findings
were already implemented on `main`, so it was redone against HEAD + headless screenshots in
`ui-audit/screens/`). The brief's "coordinate-with" B-numbers (B2/B3/B10/B15/B16/B18/B19) were
that chat's provisional numbers — reconciled in `UI_AUDIT.md` (they map to real B2/B3/B10/**B65**/**B66** + two net-new). **Renumbered on merge:** these were minted B93–B99 on the branch, but `main` had meanwhile spent B93–B107 on its own UI/GIS work, so they are **B108–B113** here — and a couple are now superseded by main's parallel changes (noted inline; the legend item was dropped entirely).

## 🐞 Bug audit — 2026-06-15 (overnight sweep)

Systematic read-through of the whole codebase (5 parallel audits, each finding verified against the source). Severity/confidence noted per item. Items tagged **🔧 fixed in audit PR** were fixed in the same PR that added this section; the rest are triaged for review. IDs are permanent (B15+).

> **✅ Fixed in PR #27 (2026-06-15).** The remaining net-new items not already covered by #19–#26:
> **B25** curve calls flagged `curve:true` + kept as a chord approximation + UI warns (tessellation still deferred); **B31** `splitPolygon` falls back to the widest distinct-edge crossing pair; **B61** two-click road clamps its length axis ≥ cross axis; **B37d** `testConnection` accepts custom Supabase domains; **B48** `printPDF` escape also handles `>`/`"`. (Items duplicated by the parallel PRs — B26/B28/B30/B32/B47/B54/B58/B59/B60/B29/B62 — were dropped, not re-landed. **B18** left open: the merge-by-`updatedAt` half is a deliberate trade-off best reviewed, not auto-applied.)
>
> **✅ Fixed in PR #29 (2026-06-15).** **B43** `applyUser` captures a monotonic token before its `await pullCloud` and bails stale completions, so overlapping auth events can't apply to the wrong user; **B46** the Mapillary token is now a same-tab pub/sub so both `LayerPanel` copies stay in sync; **B55** the `probeService(...)` overlay continuation gets a `.catch` and guards `addTo` with `map._loaded` (the `uploadSource`/flush halves shipped in #17).
>
> **Follow-up (this session).** Completed: **B18** (`pullCloud` keeps a strictly-newer local copy of a still-present cloud record — recovers a missed last-second push, no cross-device-delete resurrection; the `sendBeacon` alternative was unnecessary). Partial within grouped items (which stay `[ ]`): **B36(b)** evidence opacity re-renders so per-feature fill ratios survive the slider; **B56(a)** address-search Enter gated on `busy`; **B56(d)** evidence layers do a trailing-edge refresh for a view that moved mid-fetch; **B57(a)** manual Calibrate disabled for a from-map underlay; **B36(c)** parcel import now picks the outer ring + an area-weighted centroid (shared `largestRing`/`ringCentroid` helpers, deduped across the three parsers); **B57(c)** the account/address lookup projects via the same 365223 equirectangular model as map-click (was true EPSG:2278 feet, a ~0.3% size mismatch).
> Still open: **B36** (a/d/e — a/d are county-resolution that ties to **B13**, e is fetch AbortControllers), **B56** (b broad warn-timer refactor; c/e are doc-review), **B57** (b only — a cosmetic ~2 ppm foot-constant nicety), **B13**, and the doc-review items (parallel session's area).

### B20 — `setProjectStatus` rewrites every plan in the group via `cloudUpsert` (strips inline underlay, heavy, clobber risk) `[Document Review]` (bug) — correctness, medium
`[ ]` Flipping a project's status from the library round-trips each site row's whole `data` through `cloudUpsert`, which `slimForCloud`-strips any still-inline `data:` underlay and bumps `updated_at` on every plan (can clobber a concurrent edit). Cloud copies are usually already slimmed so true loss is unlikely, but a status dropdown shouldn't rewrite full site blobs. Fix: a minimal status-only write (jsonb patch/RPC) or guard the underlay before re-upsert.
> Deferred 2026-06-15 (future reference): the clean "status-only write" needs a Postgres RPC / `jsonb_set` — a backend/migration change, same class as B47a's `ESCAPE`, so not done client-side. Low-risk in practice today: cloud `data` is already underlay-slimmed (the strip is usually a no-op), and the serial→parallel + partial-failure reporting landed in B56c. Revisit when the `/server` backend exists.

### B36 — Map/GIS minor robustness `[Site Planner / map]` (bug) — minor
`[ ]` Grouped low-severity items: (a) statewide TxGIO (Chambers) can mislabel a Harris/FB lot's `county` when the real CAD returns nothing (ties to B13 pt 1 — true point-in-county); (b) evidence-layer (OSM/Mapillary) opacity slider flattens per-feature `fillOpacity`; (c) `featureToParcel`/`largestRingLngLat` pick the largest ring by |area| ignoring winding (a big hole can win on multipart) and use a vertex-average instead of polygon centroid for the recenter/projection origin; (d) the documented multi-county straddle "merge" is unimplemented (only `hits[0]` used); (e) no `AbortController` on address search / evidence fetches → a slow response can apply after a newer action.
> **Status 2026-06-15:** (b) shipped in PR #33, (c) shipped in PR #37. (e) is effectively moot — evidence fetches are serialized (busy-guard + `lastKey` + the B56d trailing-edge) and address search is busy-gated (B56a), so a stale response can't apply; an AbortController would only save bandwidth. Remaining **(a)** + **(d)** are the county-resolution theme — see the consolidated note under **B13** (needs a county-boundary dataset; feature-scale, low urgency). Item stays `[ ]` for (a)/(d).
> **Progress 2026-06-15 (branch `claude/festive-davinci-0oco2n`): (a) addressed; (d) resolved as moot.** **(a)** — the statewide TxGIO (`chambers`) source mislabelling a Harris/FB lot is now corrected: when a click's answer came from that source, `MapFinder.handleClick` runs `countyAtPoint` (true point-in-county via the verified TxDOT county layer) and relabels the saved entry to its real CAD key — non-blocking + additive (only the label, never the select/hilite flow). Live CNTY_NM strings verified to map cleanly (Harris / Fort Bend / Chambers / Galveston→no-CAD). **(d)** — a single click's "straddle merge" is moot: a point lies in ONE county, so `hits[0]` (first answerer) is correct, and a multi-PARCEL selection crossing a line already adds each lot on its own click. Both remaining sub-items handled; only live browser confirmation of the correction path is left.

### B38 — SQL/RLS & data-integrity audit (mostly clean) `[Document Review / DB]` (bug) — minor
`[ ]` A dedicated schema/RLS pass **verified the new code is sound**: both `doc_reviews` and the `sites`/storage policies are owner-scoped (all 4 verbs, `to authenticated`, no `public`/anon/admin), the bucket is private, every client storage path hardcodes uid as the leading segment (so `(storage.foldername(name))[1]` RLS can't be bypassed), both migrations are idempotent, the `(user_id,id)` PK matches every `onConflict`, and the `doc_date` empty-string→`null` boundary holds. Remaining minors: (a) **storage orphaning** — `uploadSource` uses `upsert:true` on a path derived from current project/discipline, so re-filing + re-uploading a source leaves the old object behind (key in `sources[]` is overwritten, so cleanup can't find it); fix by keying objects on the immutable `srcId` only, or deleting the prior key first. (b) `upsertReview`'s pre-migration fallback never **back-fills** the index columns for rows saved before the migration (a later normal edit self-heals that row; values always live in `data` jsonb meanwhile); the fallback regex (`/column|.../`) is also broad. (c) `setProjectStatus` writes rows back through `cloudUpsert` without `createSiteModel` normalization (lossless passthrough, but a status edit could also heal a legacy row if normalized). (`deleteReview` user-scoping — fixed in the audit PR alongside B37a.)
> Deferred 2026-06-15 (future reference): (a) the clean fix changes the Storage object-key scheme (or deletes the prior key on re-file) — migration/orphan implications, wants a live repro before shipping; an orphaned object only wastes quota, nothing breaks. (b)/(c) are trivial/self-healing (a later normal edit backfills the index columns / normalizes the row). Low urgency — pick up when storage cleanup is worth a dedicated pass.

### B57 — Coordinate/units consistency (core verified clean) `[Site Planner]` (bug) — low
`[ ]` A dedicated units/coordinate audit **verified the core is sound** — `FT_PER_DEG` usage (365223 lat, `×cos(lat)` lon), lat/lng argument order at every call boundary, the aerial aspect/`ftPerPxY` stretch, `ppfToZoom` Mercator inversion, the doc-review takeoff unit-squaring (px²→ft²), metes-and-bounds az/quadrant math, and the north-up Y-flip are all correct, and the 365223 equirectangular model is a true-ground ~0.3% approximation (not Mercator inflation). Three low-severity items: (a) the underlay **Calibrate** applies a single diagonal-derived scalar to both axes, so it mis-sizes a divergent-axis *from-map* underlay (disable Calibrate when `underlay.fromMap`, or derive per-axis factors); (b) `FT_PER_M = 1/0.3048` is the **international** foot while the CRS is labeled `us-ft`/EPSG:2278 (~2 ppm, cosmetic); (c) address-search ingests true EPSG:2278 feet while map-click/identify use the 365223 equirectangular feet (~0.3% diff for the same lot) — unify the ingestion paths to prevent future drift.

### B63 — Parallel-session merge safety: branch → PR → green-build gate `[repo / workflow]` (task)
`[ ]` Guardrail so two concurrent Claude Code sessions can't silently break `main`. git already catches *same-line* collisions (it refuses — the safe, loud case); the real risk is two sessions editing *different but interdependent* files → clean merge, broken app, which only re-building the **combined** result catches. **Active practice (already followed; make it explicit in CLAUDE.md):** each session works on its own branch, never commits to `main`; finishes via a PR; before merge, restacks on the latest `main` and re-runs the build, merging only if green; one PR per backlog item where practical. The *enforced* GitHub branch-protection half is parked under 🕓 Later (needs a paid plan on this private repo + a one-time owner toggle).

### B64 — Clicking into a site is unreliable / won't register `[Site Planner / map]` (bug) `[?]`
`[ ]` Intermittently, clicking a saved site on the map to open it does nothing — the click never registers and you can't get into the planner. Repro and fix the click/hit handling so opening a site is reliable every time. `[?]` confirm whether this is clicking a *saved-site marker to enter the planner* vs. a *parcel to select*; likely shares a root cause with the already-logged click races (B22 parcel-click race) — check marker hit-area / overlapping panes / the select-mode guard. Needs a runtime repro to fix confidently.
> Progress 2026-06-15 (branch `site-planner/b64-b66-runtime-ui-fixes`): investigated fully. Ruled out the easy explanations — the zoomed-out site pin has a generous 30×40 px `divIcon` hit box (not a near-miss), and `onOpenSiteRef` is kept in sync (`MapFinder.jsx:182`, so not a stale-callback no-op). **Confirmed mechanism:** the entire saved-site Leaflet layer is torn down + rebuilt (`MapFinder.jsx:311`) whenever any of `[sites, activeSiteId, selectMode, zoom, hidden]` changes. A rebuild that lands between mousedown and mouseup destroys the SVG path that received the press, so Leaflet emits no `click` and the open is silently dropped — most often in the common "zoom/pan to the site, then immediately click it" flow (the zoom fires the rebuild). **Partial fix applied:** the layer now rebuilds only when the pin↔plan threshold (`showPlans`) is actually crossed, not on every zoom step — so same-level zoom/pan no longer rebuilds mid-click (also a perf win). **Remaining (kept Open; needs a runtime repro to confirm + validate):** a background `sites`/cloud-sync update can still rebuild mid-click; the robust complete fix is a once-bound, never-torn-down map-level click fallback that hit-tests saved-site footprints, or incremental in-place layer updates instead of full teardown.
> ⏳ **HANDOFF — do this before any more code (assign to a coworker with a live browser):** the mitigation above is shipped but UNVERIFIED. Repro live first — open a saved site, zoom/pan to find it, then click repeatedly (especially right after a zoom) — to see whether the open still drops. Only invest in the map-level hit-test fallback once a reliable repro confirms it's still happening.
> Progress 2026-06-16 (branch `claude/laughing-babbage-hrxgct`): **root-cause fix applied** — instead of a hit-test fallback (false-positive risk), the saved-site layer now **never rebuilds while a pointer is pressed**. `MapFinder` tracks pointerdown/up on the map container (`pressedRef`); the rebuild effect wraps its work in `build()` and, if a press is in flight, parks it in `pendingRebuildRef` and runs it a tick after release (so the pending Leaflet click dispatches first). This closes the remaining gap the partial fix left (a background `sites`/cloud-sync update rebuilding mid-click) at the source — no rebuild can land between mousedown and mouseup. No change to the click model, so no accidental opens. Verified no render regression (saved-site markers/footprints still draw). ⏳ Still wants one **live** confirmation on planyr.io (the race is timing-dependent and can't be reproduced headless), but the mechanism is now closed; keeping `[ ]` only until that quick live check.

### B72 — Overlay tool: drag-drop a site-plan PDF onto the map and place it by hand `[Site Planner]` (feature)
`[ ]` New left-toolbar tool (working name **Overlay**) to drop a site-plan PDF onto the live map and position it by hand. **Why by hand:** a civil site-plan PDF carries linework + text but **no real-world coordinates** — the scale notation (e.g. `1″=100′`) only says how big to draw the sheet, not where on Earth it sits or how it's rotated. So the model is *scale gets the size right (see B73); the user places/rotates it onto the site by eye.* Precise pin-to-map alignment and embedded-coordinate (GeoPDF) handling are opt-in extras (B73), never the default.
- **Entry + dropzone.** New tool in the left toolbar → a drop panel (drag a file in, or click to browse). Accept **PDF first**, but build the dropzone so images (PNG/JPG) and later CAD slot in without a rewrite.
- **Initial placement.** On drop, render the page and drop it onto the **current map view, roughly centered** — position can't be known yet, so "land it where the user is looking" is the right default.
- **Rendering.** Rasterize the page to a high-res **transparent** image for MVP (vector rendering later). Knock out the white paper background / use a **multiply blend** so the map shows through the linework instead of a white sheet hiding it.
- **Manipulation handles.** Move (drag), scale (corner handles, proportional by default), rotate, plus an **opacity slider** so GIS layers stay visible underneath (the "expand / contract / fade" behavior).
- **Multi-page PDFs.** Page 1 by default, with a **page picker** when the file has more than one sheet (plan sets usually do).
- **Layer model.** The overlay is an **immutable backdrop** layer in the project's **shared real-world coordinate system (EPSG:2278 — Texas State Plane / project grid)** — above the basemap, below markup/massing — consistent with the existing imported-drawing-as-backdrop invariant.
- **Off the main thread.** Run the PDF parse/rasterize in a **Web Worker** so a big file never freezes the UI.
- **Persistence.** Persist the overlay + its transform (position, scale, rotation, opacity, page) with the **project** so it reloads (additive Site Model field → bump `SITE_MODEL_VERSION`, extend `migrate`, expose via a selector, per the conformance rule).
- **Storage decision (picked, per request):** store the **original source PDF** in Supabase **Storage** — the immutable source of truth, so we can re-rasterize at higher DPI / vectorize later and keep big rasters out of the jsonb row — and keep only the **transform + page + a file reference** in the project's `sites.data` jsonb; the rasterized image is a regenerable cache, not the source of truth. Mirrors Document Review's split (source PDFs in the private `doc-review-files` bucket, work layer in jsonb); reuse that bucket/RLS pattern (uid-first path) rather than a parallel store.
> **Dedup / shared machinery.** This IS the "overlay the drawing onto the live map/aerial" follow-on that **B67** explicitly carved out as out-of-scope-v1. B72 stays **distinct from B67**: B67 attaches a drawing to a *parcel* and marks it up in *pixel-relative* space (a document canvas); B72 places a drawing onto the *map* in *real-world* coordinates. They **share machinery** — PDF rasterize, immutable-backdrop layer model, multipage page-picker, Supabase Storage persistence — as does the Document Review **overlay/compare + `Stitcher.jsx`** work; build on those primitives, don't fork a second engine. **B73** adds scale calibration + precise alignment on top; B72 ships without it.
> Progress 2026-06-15 (branch `claude/nice-dirac-029jok`, this session): **browser-only MVP shipped.** New left-rail **Overlay** panel + drag-drop a PDF/image onto the planner map: it rasterizes the page (reusing the doc-review PDF.js engine via a **dynamic import**, so PDF.js still loads only on first use — its own lazy `pdf-*.js` chunk — and parses off the main thread on PDF.js's worker), drops it centered in the current view as an **immutable backdrop in feet space** (above the basemap/underlay, below parcels/massing/markup, shown over the aerial). Manipulation: **drag to move**, panel **opacity / rotation / width(ft) ± / lock / remove**; multi-page PDFs get an **in-session page picker**; near-white paper is knocked to transparent so the map shows through. Persists with the project as an additive Site Model field **`sheetOverlays`** (`SITE_MODEL_VERSION` 3→4, `sheetOverlaysOf` selector); the raster persists locally and the **transform** syncs to the cloud (the raster is stripped from the cloud row like the aerial — shows a "re-add on this device" placeholder, matching doc-review). Additive + guarded: an empty `sheetOverlays` is a no-op, so **existing sites/users are unaffected**. **lint 0 errors · 30/30 tests · build green.** ⏳ **UNVERIFIED in a live browser** — please try it on planyr.io and report glitches. **Deferred (kept Open):** the **B73** scale-calibration / 2-pt precise-align tranche; storing the **original PDF in Supabase Storage** for true cross-device reload (today only the transform syncs); **on-canvas corner/rotate handles** (panel controls for now); multiply-blend white-knockout for colored sheets. Because these remain, B72 stays `[ ]`.
> Progress 2026-06-16 (same session): **Supabase Storage cross-device reload shipped** (the picked storage decision). On add, a PDF overlay's **original file uploads** to the existing private `doc-review-files` bucket at `<uid>/site-overlays/<siteId>/<id>.pdf` (uid-first → existing RLS unchanged) and its `storageKey` saves with the overlay. The cloud row still strips the big raster (small rows), but on another device the overlay now **re-fetches the PDF from Storage and re-rasterizes** (showing "Loading drawing from cloud…" meanwhile) instead of "re-add." `lib/overlayStorage.js` (`uploadOverlayPdf` / `downloadOverlayBytes`, mirrors doc-review's `reviewStore`) + `rasterizeStoredPdf`; **fully additive & fallback-safe** — logged-out / oversize (>50 MB) / any error → stays inline exactly as before, so persistence can't regress. 3 unit tests pin the uid-first key. **lint 0 · 54/54 · build green.** ⏳ Runtime-unverified (needs a live Supabase session). **Remaining B72 polish:** on-canvas resize/rotate handles; Storage-backing image overlays (PDF-only today); deleting the Storage object on overlay remove (orphan only wastes quota).
> Progress 2026-06-16 (same session): **on-canvas resize + rotate handles shipped** (completes the original B72 manipulation spec — "scale via corner handles, rotate"). A selected, unlocked overlay shows 4 corner handles (uniform scale about the center) + a rotate handle above the top edge (rotate about the center); both compose with any existing rotation and ride inside the overlay's rotated group, with the panel sliders kept as an alternative. New `ovScale` / `ovRotate` drag modes mirror the existing `moveSheetOverlay` pattern; scaling reuses the already-tested center-scaling math. **lint 0 · 55/55 tests · build green.** ⏳ UNVERIFIED in a browser. **Remaining B72 polish:** Storage-backing image overlays (PDF-only today) + Storage-object cleanup on remove. **Remaining B73:** true affine/skew (matrix model) + GeoPDF.
> Progress 2026-06-16 (same session): **B72 Storage polish done.** (1) **Image overlays now Storage-back too** — `overlayStorage.js` generalized to `uploadOverlayFile` (PDF/PNG/JPG via `fileKind`; key carries the extension) + `downloadOverlayDataUrl`; the reload effect branches PDF (re-rasterize) vs image (restore the data-URL src, dims already known), so a PNG/JPG overlay reloads cross-device instead of "re-add." (2) **Remove cleans up the cloud copy** — `deleteOverlayObject` fires on overlay removal so Storage objects don't orphan. Still additive & fallback-safe (unsupported type / logged-out / error → stay inline). 7 storage unit tests (key ext + `fileKind` MIME/extension/unsupported). **lint 0 · 105/105 tests · build green.** ⏳ Runtime-unverified. **B72 polish now empty;** only **B73** true affine/skew + GeoPDF remain (both niche, deferred by decision).

### B73 — Calibrate the overlay to the drawing scale (default), with optional precise alignment `[Site Planner]` (feature)
`[ ]` Get the **B72** map overlay to correct **real-world size** automatically from the drawing scale. Builds on B72 (which ships first, eyeballed); **position and rotation stay by-hand by default** ("just get it in the area, let me nudge it"). Why a separate calibration step exists: a site-plan PDF has a scale (how big to draw) but no coordinates (where / how rotated), and the scale math is exact only when the page is at its true plot size.
- **Default path — scale calibration.**
  - On import, try to **auto-read the scale notation** via **PDF text extraction** (site plans usually carry selectable text like `1"=100'` or `SCALE: 1"=100'`).
  - Before trusting it, **check the PDF page's physical dimensions against standard sheet sizes** (ARCH D 24×36, ANSI D 22×34, ARCH E, …). **Why it matters:** the scale is exact only at the true intended plot size — if someone shrank the sheet to letter paper, the "1 inch" assumption breaks and the scale comes out wrong. **Apply the detected scale silently only when the page is a recognizable plot size**, and show it in a small readout the user can **override**.
  - If the scale text can't be read, or the page isn't a recognizable plot size (likely shrunk), **don't guess** — surface a single scale control (dropdown of common civil scales `1"=20'/30'/40'/50'/60'/100'/200'` + free entry) and/or route to the trace fallback.
- **Fallback — trace a known dimension (always reliable).** User draws a line over a labeled dimension on the sheet (e.g. a building edge labeled `570' DEEP`) and enters its real length; the tool sets overlay scale so drawing-feet = map-feet. Sidesteps the page-size problem entirely — the backstop whenever auto-scale is missing or untrustworthy.
- **Optional precision — 2-point alignment (NOT the default).** Opt-in "**Align precisely**" action for when eyeballing position/rotation isn't good enough: click two known points on the overlay + the matching two on the map → solve a **similarity transform** (uniform scale + rotation + shift; moves/resizes as one rigid piece, no distortion). **3+ points → affine fit** (allows slight stretch/skew = rubber-sheeting). Show a **fit/residual readout** (how closely the clicked points landed on their targets) so the user can judge the result or re-pick.
- **GeoPDF — opportunistic only.** A GeoPDF carries embedded map coordinates (rare for civil site plans). If one happens to carry that reference, offer to **auto-place** at true location/scale/rotation; otherwise stay silent. De-emphasized.
- **Result.** However it's set, the final overlay lives in the project's **shared coordinate system (EPSG:2278)** so its geometry matches the GIS layers and the other workspaces.
> **Dedup / shared machinery.** Reuse, don't rebuild: the Document Review **calibrate-to-scale** measure tool and the **`Stitcher.jsx` 2-point pairwise align** (the precise-alignment math is the same similarity / affine fit), and relate to the existing underlay **Calibrate** — see **B57(a)**, which notes that calibrate's single diagonal-derived scalar mis-sizes a divergent-axis underlay, so derive the overlay's scale per the cleaner model here (per-axis / known-dimension), not one diagonal scalar. Distinct from **B67** (pixel-space parcel markup); built on **B72** (the map overlay itself).
> Progress 2026-06-15 (branch `claude/nice-dirac-029jok`, this session): **default scale path shipped.** On import the overlay reads the engineer's scale note from the PDF text (`parseScaleNote` — `1"=100'` / `SCALE: 1"=100'` / `1 inch = 100 ft`) and classifies the page against standard plot sizes (`detectSheet` — ANSI A–E, ARCH A–E1); when the page **is** a recognizable plot size **and** a scale was read, it's **auto-applied silently** to true real-world feet (`ftPerPx = S/72`, the points basis), otherwise it lands at the by-hand B72 default. The overlay panel gains a **Scale** control: detected sheet + read scale (with **Apply**), a common-civil-scale dropdown (`1"=10..200'`) + custom entry, and a live "now ≈ 1"=N′ · W′ wide" readout; non-standard pages are flagged "may be shrunk." The scale math lives in a pure, browser-free `lib/overlayScale.js` with **9 unit tests** (sheet detection both orientations, ANSI-D ≠ ARCH-D, note parsing + range guards, the points↔feet conversion). **lint 0 errors · 39/39 tests · build green.** ⏳ **UNVERIFIED in a browser.** **Still deferred (B73 stays `[ ]`):** the **trace-a-known-dimension** fallback and the opt-in **2-point similarity / 3+-point affine precise-align** (both need a canvas-click mode — a focused next increment), plus GeoPDF. Position/rotation stay by-hand per spec.
> Progress 2026-06-15 (same session, follow-up): **trace + 2-point precise-align shipped.** Per-overlay **Trace a length** (click two ends of a known dimension on the drawing → enter its real length → rescales, pinned at the first click) and **Align to map** (click two points on the drawing, then the matching two on the map → a **similarity transform** that moves + rotates + uniformly scales the sheet so those points land on the map). Both are opt-in canvas modes with an instruction bar + Esc/Cancel + on-canvas point markers; the default placement stays by-hand. The geometry is a pure, browser-free `lib/overlayAlign.js` with **7 unit tests** (similarity maps p1→q1 / p2→q2 with the right scale + rotation; trace pins its anchor; 2-pt align lands **both** drawing points on their map targets **even for a rotated overlay**). **lint 0 errors · 46/46 tests · build green.** ⏳ **UNVERIFIED in a browser.** **Only the optional extras remain (B73 stays `[ ]`):** **3+-point affine / rubber-sheeting** with a fit-residual readout, and **GeoPDF** auto-placement.
> Progress 2026-06-16 (same session): **N-point alignment + residual readout shipped.** "Align to map" is now pair-based — click a point on the drawing, then its spot on the map, repeat; **Apply** at ≥2 pairs. 2 pairs = the exact similarity; **3+ pairs = a least-squares best-fit** (closed-form Procrustes) robust to a sloppy click, reporting an **RMS fit residual** (ft) in a toast so a poor/distorted fit is visible. Math added to `lib/overlayAlign.js` (`solveSimilarityLSQ`, `applySimilarityToOverlay`) with **5 more unit tests** (exact 2-pt match; recovers a known scale+rotation from 4 points at ~0 residual; non-zero residual on a perturbed point; null guards; all points land via the fit on a rotated overlay). **lint 0 errors · 51/51 tests · build green.** ⏳ **UNVERIFIED in a browser.** **What's genuinely left (B73 stays `[ ]`):** **true affine / skew rubber-sheeting** — deliberately NOT rushed blind, because it needs the overlay to carry a full 2×3 matrix (a new render + manipulation path), a focused refactor rather than an additive change; and **GeoPDF** auto-placement (rare for civil plans; needs low-level PDF georef parsing). The new N-point residual already surfaces *when* affine would help.
> Fix 2026-06-16 (user reported "Align to map does not work at all"): **fixed — it now captures points.** Root cause: the calibration click-capture lived in the SVG-root `onBgDown`, but clicking the overlay / parcels / elements hit their own pointer handlers (which `stopPropagation`), so a point only registered on empty canvas — picking points *on the drawing itself* did nothing. Fix: while trace/align is active, a transparent full-canvas capture layer intercepts **every** click and turns it into a calibration point (no accidental move/selection). Apply stays an explicit button at ≥2 pairs. lint/test/build green; please re-test on the preview.

---

## 🐞 Bug audit follow-up — 2026-06-16 (net-new safe batch + feature-break sweep)

Two further audits (a "Cowork" cross-check and a feature-break sweep) were triaged against the
code at HEAD. **Most items were already fixed in B15–B73** (markups-only delete B16, JSON import
B15, cloud-flush B18, render-cancel B40/B34, error boundary + lint/test gate B68, RLS-scoped
delete B37a, etc.). The verified **net-new** items are fixed here on branch
`claude/blissful-babbage-liboyn`. **lint 0 errors · 39 tests · build green.** IDs B74+.

#### UI fuzz / adversarial-input sub-pass (same session, B87–B92)

A researched fuzz pass (boundary/overflow, type-confusion, concurrency, special-chars) found a
fresh cluster — fixed here.

### B94 — Road / right-of-way maintenance authority `[Site Planner / GIS]` (feature)
`[ ]` For the road(s) fronting the site — or a clicked road segment — return **who maintains it (TxDOT, county, or city).** A different question from which jurisdiction the *parcel* sits in (**B93**).
- **Why it matters:** the maintaining authority controls the driveway/access permit, the right-of-way, traffic, and utility cuts. A TxDOT state highway, a Harris County road, and a City of Houston street fronting the same parcel each send you to a different permitting desk.
- **Data:** TxDOT roadway inventory as backbone — flags **on-system** (state-maintained highways) vs **off-system** (locally maintained) plus a jurisdiction attribute; supplement with county-road and city-street layers where published.
- **Interaction:** these are **line** features, not polygons — use a **nearest-segment** query within a small tolerance from the click or the parcel frontage; return road name, route ID, and maintenance authority.
- **Patchiness expected:** road-jurisdiction data is less complete than boundary polygons. Returning **"unknown" with honest status is correct** and far better than a wrong guess (same never-auto-guess-on-low-confidence rule as auto-filing).
- **Reuse:** the **same one generic ArcGIS-REST connector** + registry + cache (**B96**) + honest status/age as B93 — no per-source code paths.
> **Progress 2026-06-15 (branch `claude/festive-davinci-0oco2n`): built on the shared connector, verified + calibrated.** Backbone = TxDOT `TxDOT_Roadway_Inventory/FeatureServer/0` (polyline). `identifyRoadAuthority(lng,lat)` buffers the click by 40 m, then returns the **nearest** segment (`polylineDistMeters` — a local-equirectangular point-to-segment distance) with its maintenance authority. **`RDWAY_MAINT_AGCY` calibrated from the live distinct HSYS×agency cross-tab:** 1 = State/TxDOT (IH/US/SH/FM/RM…), 2 = County (CR), 4 = City (LS), 7–15 = Federal (all ride HSYS=FD), 5/6/16 = toll/managed-lane; an unrecognized code falls back to the HSYS class and otherwise reads an honest **"Unknown"** (never a guess). Shares B93's registry + connector + B96 cache + status/age, and is wired into the same Identify-panel button. Covered by the B93 test file (nearest-segment pick among several, honest-unknown when nothing's within tolerance, server-error → null not throw). **Remaining (kept `[ ]`):** identify off the **parcel frontage** (today it's the click point); supplement with county-road / city-street layers where published; live browser confirmation.
> **Parcel-frontage added 2026-06-15 (same branch):** `identifyRoadAuthority` now also takes the parcel ring → returns EVERY distinct fronting authority (buffers the parcel polygon by the tolerance, dedupes by route), not just a clicked point's nearest segment — so a lot that fronts a state highway AND a city street shows both permitting desks. **Validated live** against the TxDOT endpoint: a downtown-Houston parcel box → 8 segments within 40 m, distinct authorities **City + State (TxDOT)** (the exact multi-desk case the item calls out). Point mode (nearest segment) is retained for a bare click; the planner now passes the active parcel's ring. +3 tests (72 total). Remaining: optional county-road / city-street supplement layers where published; live browser confirmation.

### B95 — Jurisdiction → development-consequence summary `[Site Planner / GIS]` (task, downstream — DEFERRED)
`[ ]` Optional downstream layer: translate the raw boundary facts from **B93 / B94** into the questions that drive a deal — who regulates platting/subdivision (city directly / city-via-ETJ / county), whether zoning applies (Houston has none; most others do), who reviews drainage/detention and fire flow, which property-tax jurisdictions apply, and who issues the access permit (from B94).
- Plugs into the existing **verdict-engine** concept (the `developableArea()` synthesis stub); stays a **screening aid, not legal advice.**
- **Defer until B93 / B94 are solid.** Rules are per-jurisdiction and accrue over time — start with Houston plus the 2–3 most common cities and expand as hit.

### B96 — GIS layer cache (stale-while-revalidate) `[Site Planner / GIS]` (feature)
`[ ]` Browser-local cached copy of each GIS layer's last-good response so lookups are **instant and survive a source being slow or offline.** Plain-English: a "cache" = a stored copy of the last good answer, reused instead of re-asking the server every time.
- **Pattern:** on load, paint last-known-good from cache immediately → fire a background refresh → swap in fresh data when it returns → **always display the data's age** on screen.
- **Scope:** all GIS layers, **including the new jurisdiction + road-authority layers (B93 / B94)** — this is the mechanism that makes those feel seamless rather than laggy.
- **Storage:** browser-local so it persists across reloads; no server, no new credentials — stays in the browser-only tranche. Per-user privacy already covered by the existing model.
- **Screening-only:** always surface age so a stale boundary is never mistaken for current. **Extends** the existing per-layer honest status + ~45 s self-heal re-probe — doesn't replace them.
- **Build order:** **do this first in the batch** — B93 / B94 ride on it for the "instant + survives a source outage" behavior. Formalizes the CLAUDE.md roadmap item "GIS layer caching — next immediate item."
> **Step 0 — current-state finding (2026-06-15, this filing): stale-while-revalidate is NOT implemented today; it remains only planned.** What exists in the GIS path is adjacent but different: **(1)** an **in-memory** service-*health* probe cache (`lib/layers.js` `_probeCache`, 40 s `PROBE_TTL`) that feeds the ~45 s self-heal re-probe — it caches *whether a service is up*, not its response data, and is lost on reload; **(2)** an **in-memory, per-session** memoization of Overpass/Mapillary vector results keyed per rounded bbox (`lib/evidenceLayers.js` `_cache`) — also lost on reload, with no background refresh and no age shown. The raster overlays (`syncOverlayLayers` → esri `dynamicMapLayer`/`imageMapLayer`/`featureLayer`) and parcel queries (`lib/arcgis.js` `fetch`) hit the network live on every view. No `localStorage`/IndexedDB persistence of any GIS response exists. **Conclusion: build the SWR cache from scratch** — a browser-local, request-keyed store (paint-stale → background-revalidate → show age) — then have B93/B94's connector read/write it and retrofit the evidence-layer memoization onto it.
>
> **Progress 2026-06-15 (branch `claude/festive-davinci-0oco2n`): cache mechanism built + unit-tested; first consumer wired.** New `src/workspaces/site-planner/lib/gisCache.js` — a generic stale-while-revalidate primitive: synchronous `swr(key, fetcher, {ttl})` returns the cached copy to paint *now* **plus** a background `fresh` promise that revalidates and swaps in, with browser-local persistence (namespaced + byte-capped localStorage, oldest-evicted on quota, every storage touch guarded so a failure degrades to a plain live fetch), an in-process L1 memo, and a `formatAge` helper. **15 unit tests** (`test/gisCache.test.js`, deterministic via an injected store + clock) cover staleness, age buckets, paint-stale→revalidate, failed-refresh-keeps-last-good, quota eviction, total-budget trim, and namespace isolation (it never evicts the `planarfit:*` site data). **First consumer wired:** the Overpass evidence layer now rides the cache — it **persists across reloads** (the old in-memory Map did not) — and the Layers panel shows each cached layer's **data age** ("refreshed 3m ago", amber while showing last-good during a refresh), threaded `onStatus(id,state,msg,{ts,stale})` → `layerStatus` → `LayerPanel` (30 s ticker so the age keeps counting). `lint` (0 errors) / `test` (45 pass) / `build` all green. **Remaining (kept `[ ]`):** the *primary* consumers are **B93/B94**'s ArcGIS-REST connector (not built — egress-blocked here); and **live runtime confirmation** of cross-reload persistence + on-map age needs the GIS hosts on the network egress allowlist (same caveat as B93). Server-rendered raster overlays (FEMA/NWI/3DEP image exports) aren't SWR-cacheable *as data* and keep their existing probe-based status.
>
> **Progress 2026-06-15 (this session, branch `claude/festive-davinci-0oco2n`): the primary consumer landed.** Egress is now unblocked (the allowlist took effect in a fresh session — see B93), so B93/B94's `lib/jurisdiction.js` ArcGIS-REST connector is built and rides this cache (`gisCache.swr`, per-source TTLs, `formatAge` age shown in the Identify panel). The cache primitive + both consumers are `lint` / `test` (68 pass) / `build` green together. Still `[ ]` only for **live runtime confirmation** (cross-reload persistence + on-panel age in a real browser) — the one piece that needs the app actually running, not just the hosts reachable.
>
> **Progress 2026-06-16 (branch `claude/nice-dirac-029jok`): vector-tier for the raster overlays — directly closes the "raster overlays aren't SWR-cacheable _as data_" gap noted above.** Instead of caching FEMA/NWI flat image exports, pull the actual POLYGONS and cache those (smaller, owned, re-stylable, queryable). New `lib/vectorLayers.js` (pure, Web-Worker-movable, dependency-injected) hits each MapServer's `/query` (Esri JSON, `outSR=4326`) for **FEMA flood (NFHL sublayer 28)** + **NWI wetlands (0)**, rides `gisCache.swr` (paint-stale → revalidate → show age), styles each zone/wetland-type locally, and `decideVectorOrImage` **falls back to the existing `dynamicMapLayer` image** when a source is image-only, the vector pull errors (e.g. CORS), the view is below `minVectorZoom`, or the bbox exceeds `maxAreaDeg` — so a layer never goes blank. Registry-driven (one row per layer, à la `jurisdiction.js`); paging on `exceededTransferLimit` + a `maxFeatures` cap; Douglas–Peucker simplify before store; screening `note` on every source. **31 unit tests** (`test/vectorLayers.test.js`; injected fetch + cache + clock — query/paging/truncate, Esri→GeoJSON, simplify, FEMA+NWI symbology, vector-vs-image decision, SWR cold/warm-fresh/warm-stale). `lint` 0 / `test` 136 / `build` green. **This is piece 1 of 2 — the pure engine, not yet wired into the map (no behavior change).** Piece 2 (next): an `L.geoJSON` view-driven overlay + one `syncOverlayLayers` dispatch branch + a **cloud tier** (`public.gis_vector_cache`, RLS private-by-default, keyed per project) so the polygons are owned in the cloud per project, not browser-only. Live planyr.io verification required — **CORS on the `/query` endpoints is the key runtime unknown** (a host that served image tiles may still block a `fetch`; the image fallback is exactly the safety net).
>
> **Progress 2026-06-16 (piece 2 — rendering + wiring landed): the vectors now DRAW on the map (browser-cached) with the image fallback.** New `lib/vectorOverlay.js` — a view-driven `L.layerGroup` (modeled on `evidenceLayers.js` `overpassLayer`) that, on each move, runs `decideVectorOrImage` then either draws the cached polygons (`L.geoJSON` styled per zone/type through `fetchCached`/`gisCache.swr` — instant repaint + data-age, opacity scaled keeping relative fills) OR falls back to the existing `EL.dynamicMapLayer` picture (image-only / zoomed out / large area / **the `/query` fetch failed, e.g. CORS**). `layers.js`: FEMA + NWI flipped to `kind:"vector"` (+ a `VECTOR_SOURCES` ref) and ONE `cfg.kind==="vector"` dispatch branch — the only shared-file edits (kept tiny on purpose; a parallel session edits `layers.js`). `lint` 0 / `test` 136 / `build` green. **Browser-only — NOT verifiable from the container (FEMA/NWI hosts are egress-blocked here); filed `VERIFICATION.md` V8 (feature) + V9 (endpoint liveness).** Still browser-cache only; **piece 3 = the per-project cloud tier** (`gis_vector_cache` table + `lib/vectorCache.js`), deliberately sequenced AFTER a live CORS confirmation — if the `/query` is CORS-blocked the vector path just falls back to image and the cloud tier would be moot, so validate the fetch works in a browser first.
>
> **Progress 2026-06-16 (live preview testing — OUTCOME: vector rendering reverted; the shipped win is CORS-resilient image layers).** Live testing on the preview revealed two things: (a) the NWI `/query` actually **succeeds** from the browser (its data endpoint is NOT CORS-blocked — only the root `?f=json` *probe* is), but at area-scale it returns few/no features while FEMA pulls thousands of polygons (slow); and (b) the custom `vectorOverlay` (an esri image/raster layer nested inside an `L.layerGroup`) reported "loaded" yet **never rendered** — an esri raster layer must be added **directly to the map** (as the original `else`-branch code does), not into a layer-group. Rather than keep debugging map rendering blind (no browser in the container), **reverted FEMA/NWI to the proven `dynamicMapLayer` image path and deleted `lib/vectorOverlay.js` + the `kind:"vector"` wiring.** **Kept the real, working win — the probe-resilience fix:** `probeService` now flags a CORS/network probe failure as `unreachable`, and `syncOverlayLayers` adds the image layer anyway (its `f=image` export renders via a CORS-exempt `<img>`), so a host whose probe is CORS-blocked (e.g. NWI) no longer dies with a scary "network / CORS error" banner — it just shows the picture. `lib/vectorLayers.js` (the pure, 31-test fetch/paging/style/decide/cache engine) stays as **groundwork** for a future browser-testable attempt; it is not wired into the app. `lint` 0 / `test` 136 / `build` green. **Lesson: these agency screening overlays are used at area-scale, where the server-rendered image is the right tool; vector polygons only pay off zoomed in tight and need a real browser to debug the Leaflet rendering.** Net effect of the merged PR vs `main`: just the probe-resilience fix.

---

## 🎨 UI/UX & parcel-interaction overhaul — 2026-06-16 (product walkthrough)

Filed from a product walkthrough of the map + planner chrome and the parcel-interaction
model. Provisional **NEW-1…NEW-8** were minted B93–B100, but **B93–B96 collided** with the
same-day GIS batch (PR #46, which had already shipped code under B93–B96); per the dedupe
protocol they are **renumbered B104–B107** here (B97–B100 were unique and keep their IDs; the
GIS batch keeps B93–B96). Deduped against existing items — **B10** (two-header consolidation +
product switcher) already shipped for the *planner* context bar and explicitly left "a single
physical row is a later polish," so **B104** is that remaining polish for the *map* view
(net-new, not a re-file); the rest have no existing Open counterpart. All eight are `[ ]` Open.

<!-- 2026-06-22: owner-dropped corrected chat batch (Scheduler PDF/Print Exhibit export quality) —
     amended NEW-1/NEW-2/NEW-4/NEW-5 (NEW-3 unchanged). Minted **B401/B402/B403**; the amended NEW-1
     folded into **B361** (its explicit home — "the continuous companion to B159's discrete selector").
     Per STANDING RULE #1 all four were filed AND fixed + headless-verified (V116, 16/16) + committed
     this session on branch `claude/vigilant-brown-5dqcog`. All touch ONE surface:
     public/sequence/index.html (buildGanttSVG + PDFExportModal + buildPDFHtml). Full [x] blocks live
     in BACKLOG-DONE.md:
       • B361 — export time-axis controls: a discrete Days/Wk/Mo/Qtr selector (sidebar) + a continuous
                Time −/+ (toolbar) wired to the SAME span state + Pan (renamed from Move, drags the
                time window, today-centered default) + FIXED the dead/intermittent floating toolbar
                (rebuilt as a pinned absolute overlay). Page Zoom + Fit kept.
       • B401 — the default time window auto-fits so every start/end label sits on the sheet (extend the
                frame, never move a label; capped at ~22% of span/side so a long label can't crush it).
       • B402 — dependency connectors stay CURVED but now terminate at 12 o'clock (descend into the bar/
                diamond TOP, clearing the endpoint date) + a vertical de-collision pass for co-dated names.
       • B403 — silently persist & restore ALL export-screen state (orientation/size/margins/columns/
                name-align/header/section-collapse/timescale/pan) via localStorage `planar:exportPrefs:v1`,
                synchronously, NO badge. Column width keeps riding data.exportColWidths (B392).
     B160 (the whole-split table-vs-chart divider ratio) left Open by design — distinct from B361's
     in-chart time axis; B392's per-column drag-resize already covers most of the need. -->

---

### B160 — Gantt horizontal width control on PDF/Print Exhibit export `[Scheduler]` (feature)

- [ ] Add a control to the PDF/Print Exhibit export sidebar that lets the user adjust how much of the total page width the Gantt chart occupies vs. the task name/info columns.
- Recommended implementation: a **horizontal split slider** or a **numeric percentage field** (e.g., "Gantt width: 60%") that shifts the column-to-chart ratio.
- Preview updates in real time as the user drags/adjusts.
- **Interacts with B361 (time scale):** wider Gantt + finer time scale = more bars visible; narrower + coarser = summary view. Both controls must co-exist without conflict.
- Export-only; live schedule layout unaffected.
- **Amended-NEW-1 boundary (2026-06-22):** the owner's corrected NEW-1 explicitly keeps this item DISTINCT from the in-chart time-axis controls (timescale zoom + pan) — those live in **B361**. B160 is purely the **panel divider** (one ratio handle for the whole table-vs-chart split). The per-column drag-resize (**B392**, shipped) already lets a user trade table width against chart width column-by-column; B160 remains the single whole-split ratio handle if still wanted.

<!-- Filed 2026-06-18 from owner-submitted NEW-3. Deduped against B361 (related but distinct control). Annotated 2026-06-22 with the amended-NEW-1 boundary (time-axis controls → B361; divider → here). -->
<!-- RECONCILE w/ B392 (DONE 2026-06-22, PR #293): B392 shipped per-column drag-resize in the exhibit.
     Because the table block is now exactly the sum of its (content-fit or dragged) column widths and
     the Gantt auto-takes the remainder (never < EXHIBIT_MIN_GANTT=240px), dragging columns already
     shifts the column-block-vs-Gantt ratio — so B392 PARTIALLY covers this item's user need without a
     slider. B160 remains a distinct control (one ratio handle for the whole split). If built, implement
     it as the OVERALL budget that B392's per-column widths fit within (don't fight: B392 already clamps
     the table total so the Gantt keeps its floor). Not a duplicate; reconciled, left Open. -->

---

## 🕓 Later / Roadmap

*Deliberately deferred. Do **not** action these unless moved up to 🔲 Open.*

### B371 — GIS screening cache Phase 2: regional Houston-metro snapshot / offline pre-cache `[Site Planner / Analysis]` (feature) — Phase 2 of B367  *(filed 2026-06-22; minted **B371**)*
`[ ]` **Later (gated behind B367 Phase 1, which shipped).** Phase 1 (B367) keeps the last-good answer per parcel+layer and never blanks a layer on a transient outage. Phase 2 is the owner's "cache most of Houston" idea: a **regional pre-cache/snapshot** of the Houston-metro source layers (+ a coverage mask), refreshed on a schedule, so a **never-seen** parcel with no features resolves **offline** to "No <layer> mapped (source vintage <date>)" instead of waiting on (or failing) a live query. Heavier — needs storage (a Supabase table or a static snapshot) + a refresh job + a coverage mask so "no features in the snapshot" is trustworthy only inside the cached extent. Deferred deliberately behind Phase 1 per the brief; pick up once Phase 1 proves out in the field.

### B340 — Auto-assembly CV tails behind the B335–B339 seams `[Doc Review / Stitch]` (feature) — the hard minority  *(filed 2026-06-21 as the deferred remainder of the B335–B339 batch; minted **B340** — a hot `main` took B325–B334)*
`[ ]` The B335–B339 headline flow (drop a set → auto-group → auto-stitch → crop → auto-calibrate) is **shipped + verified** for the common case — CAD vector PDFs with a real text layer. (Scanned-sheet **OCR** was the 4th tail and is now **DONE → B352**, shipped + verified this session.) Three computer-vision tails remain, deferred behind clean injectable seams because each needs vector-graphics analysis we can't yet headless-verify — and the manual-Align safety net already covers them:
  1. **Graphic scale-bar reading (B339 tail)** — when there's no stated scale text, measure the drawn scale bar to set `ftPerUnit`. Needs vector-graphics/CV analysis, not text.
  2. **Geometric edge-line match (B337 middle fallback)** — when match-line *labels* are missing, match the cut geometry across two sheets' edges. Today, label-less sheets correctly drop to the 2-point manual Align **pre-seeded** with detected seam endpoints (the spec's final safety net, already wired) — this is the CV step between labels and manual.
  3. **Legend symbol-union (B338 tail)** — extract each sheet's graphical legend entries and union them into the pinned Composite key (today the key lists the grouped plan + auto-scale; the crop + pinned panel ship). Needs symbol/vector extraction.
> Each is gated behind a seam exactly like the app's other not-yet-provisioned heavy compute (the AI title-block reader, the APS converter). Pick up when there's a way to verify (a CV pass we can headless-check). Coupled to the ★ north-star "map → drawings → latest set."

### B256 — Scheduler recompute is O(n²); will lag past ~500 tasks `[Scheduler / perf]` (task)  *(orig "P2"; minted **B256**)*
`[ ]` `cascadeDates`/`rollupParentDates` re-filter the task list repeatedly on each edit; `depLines` calls `tasks.indexOf` inside its loop; `rolledHealthMap`/`progressMap` recurse with `.filter`. Fine at the current ~180 tasks; will start to feel laggy past ~500. Fix: build an `id → index` map and a `parent → children[]` map once per recompute and reuse them — behaviour-preserving. **Verify** every task's start/end/duration is byte-identical before/after on the real production dataset. Gated by board size → Later until a board actually grows that large.

### B257 — Optional: instant cross-device "newer version" banner via Supabase realtime `[Scheduler / cloud]` (feature)  *(orig "B2 follow-up"; minted **B257**)*
`[ ]` The version-stamp guard + 20s polling already ship and work (the "newer version — Reload" banner appears within ~20s). Optional upgrade: enable Supabase **realtime** on the Scheduler data table and subscribe to row changes so the banner shows within ~1s; keep the 20s poll as a fallback if the channel drops. Needs a one-line SQL toggle on the Supabase project (owner/dashboard) — an external dependency — and it's polish, not a bug, so it sits in Later.

### B258 — Incremental cleanup of inline styles / inner-defined helpers `[Scheduler / code health]` (task)  *(orig "P4"; minted **B258**)*
`[ ]` Standing, opportunistic cleanup: as each Scheduler panel is touched for other work, hoist any helper components defined inside their parent to module scope (props-only) and lift repeated literal `style={{…}}` objects to module consts; memoize hot row renderers. B247 (the `Field` hoist) was the user-visible tip of this. Do it incrementally as code is touched — explicitly **not** one big sweep (UI must stay identical at each step), which is why it lives here rather than as a discrete Open task.

### B259 — Scheduler off in-browser Babel → a real build step `[Scheduler / build]` (project)  *(orig "P1/M1"; minted **B259**)*
`[ ]` The entire Scheduler (`public/sequence/index.html`, ~9.6k lines) is compiled by `@babel/standalone` in the browser on every load. Project-level work: move to a real build step / modularize. **Entangled** with the file's ability to save its own data back into itself (the File System Access auto-save rewrites the `<script id="planar-data">` block inside the HTML), so any change must preserve self-save. Plan deliberately; not required for any other Scheduler item. Deferred by design.

### B272 — Rule out a main-thread stall from non-Workerized heavy parsing `[Core / Site Planner]` (bug, low priority)  *(owner-dropped 2026-06-20 via chat; arrived as "NEW-2"; minted **B272** — secondary hypothesis to B271)*
`[ ]` Secondary hypothesis for the same "unclickable canvas" symptom: heavy CAD/PDF parse (or other compute) running on the **main thread** instead of a Web Worker, jamming the tab. **Investigated 2026-06-20 (B271 session):** PDF parsing already runs **off** the main thread — PDF.js uses its worker (a separate `pdf.worker` chunk in the build); DWG→DXF conversion is a **backend** (`/server`) concern, never in the browser. The reported incident's symptom (a frozen grab/hand cursor + clicks swallowed, with **no** Chrome "Page Unresponsive — Wait/Exit" prompt) is the signature of stuck pointer state, not a CPU stall, and is fully explained + fixed by **B271**. **No actionable main-thread-stall bug found.** Per the owner's note this drops to **low priority** now that B271 resolves the lockout — kept here (not closed) so it stays on the radar. **Escalate only** if an actual stall is ever observed: then instrument long-task timing, reproduce with a large drawing, and move any straggler heavy compute into a Worker per the standing architecture rule.

- **Enforced merge gate via GitHub branch protection** (the settings half of **B63**): require a PR + a passing build check + "branch up to date before merging" on `main`, plus repo auto-merge. On the **private** repo this only *enforces* on a paid plan (GitHub Pro+); on Free the rules save but don't block — so B63's branch → PR → green discipline is the backstop until then. Keep it a manual owner toggle rather than granting the Claude Code app admin rights on a credential-bound repo.

- **B150 — Wire dedicated county appraisal districts (CADs) for the Austin & DFW metros** `[Site Planner / map]` (feature) — *filed 2026-06-18 as a later-feature note (owner asked to park it).* Today only **Harris / Fort Bend / Chambers** have dedicated CADs in `lib/counties.js` (`COUNTIES` + `COUNTIES_MAP`). Austin (Travis/**TCAD**, Williamson, Hays) and DFW (Tarrant/**TAD**, Dallas/**DCAD**, Denton, Collin) parcels currently work **only via the statewide TxGIO fallback** (B137) — coverage is complete (verified: Travis 835K, Tarrant 757K, Dallas 694K, Williamson/Hays/Denton/Collin all present) and returns owner/situs/market-value/acreage, but the statewide copy can **lag** a county's live CAD and carries a **thinner field set** than the district's own service. Wire each county's dedicated CAD (verify it publishes a reachable, **CORS-clean** parcel service first — same vetting as the ETJ sources; some counties publish cleanly, some don't) so Austin/DFW get the same first-class, most-current parcel/appraisal data Houston has via HCAD/FBCAD; add per-county bbox routing to `candidateCountiesForPoint` as each lands.
  - **Bundle the county-mislabel fix:** a parcel in a non-configured county is presently tagged `chambers` (the statewide source's key) because the **B36(a)** `countyAtPoint` relabel only maps to the 3 wired CAD keys — so an Austin/DFW lot saves with the wrong `county`. Record the **true** county name even when no dedicated CAD is wired (cosmetic today; matters for the saved Site Model + which jurisdiction defaults show).
  - Coupled to **B11 / B13 / B36 / B137** (the county-resolution theme). **Not urgent** — the statewide fallback keeps Austin/DFW functional meanwhile; pick up when the owner is actively working those metros (start with Travis, Tarrant, Dallas).

---

## ✅ Done

> Completed items have been archived to **`BACKLOG-DONE.md`** to keep this file fast to load.
> When finishing an item, append its block to `BACKLOG-DONE.md` (do not add it here).
> The next B# = highest `B#` across **both** files + 1.
