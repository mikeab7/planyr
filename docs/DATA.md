# docs/DATA.md — the data bible: one owner, one write path, one invariant per fact

Audited and written 2026-09-01, against the code actually on `main` — not against a prior
session's notes about that code. Read this before touching persistence, sync, undo, or delete.

## 0. Provenance — read this before trusting anything else in this file

This document was commissioned by a dispatch that named six source files as required reading:
`claude/DOCTRINE-2026-09-01-the-data-bible-draft-one-owner-one-write-path-one-invariant.md`,
`claude/finding-2026-08-false-conflict-banners-round-seven-and-why-six-fixes-did-not-hold.md`,
`claude/handoff-2026-07-14-multiwriter-cascade-false-conflict.md`,
`claude/handoff-2026-08-04-parcel-menu-inventory-and-project-rename-half-lands.md`,
`claude/incident-2026-08-21-teammate-deleted-57-of-95-elements-and-no-indicator-said-the-plan-was-not-his.md`,
`claude/handoff-2026-07-29-tsakiris-building-assembly-tears-on-move-sync-split.md`.

**None of the six exist anywhere this session could reach**: not in the working tree, not
anywhere in `git log --all` across every branch and the reflog, not in the connected Google
Drive. The repo's root was reorganized on 2026-08-31 (PR #1288) and its own commit message says
the only files that had ever lived in a stray top-level `claude/` folder were two `COWORK-RESULT-*`
files, now under `docs/sessions/` — never the six named here. Whatever produced those filenames
(most plausibly documents living in "the owner's project" outside this repo — `CLAUDE.md` itself
draws that distinction for `claude/protocol-2026-07-15-bug-blocks-are-fix-orders.md`) is not
reachable from a Claude Code session scoped to this repository.

So this document is built by **auditing the current code directly** (elementSync.js,
projectName.js, the DB migrations, and the existing test/backlog record) rather than by trusting
the dispatch's paraphrase of documents that could not be read. Wherever the dispatch's own prose
quoted a specific claim (line numbers, mechanism counts, "fifty call sites"), that claim is
checked against the present code below and the result is stated plainly, including where it no
longer holds.

**The single largest finding of this audit: the dispatch's premise is stale.** Its two named bugs
— the delete-authorship hole behind false conflict banners, and the project-rename half-land —
are **already fixed, tested, and (for the delete bug) merged**, by sessions dated 2026-08-04 and
2026-08-23 respectively — i.e. by the same "round seven" work the dispatch's finding describes,
whose fix apparently landed after that finding was written and before this dispatch was issued.
Re-implementing either would have been redundant at best and a regression risk at worst (see
`WRONG-CASE` and `AUDIT-FIRST` in root `CLAUDE.md`). §7 below gives the exact evidence.

---

## 1. Entity table

The scope here is the entity family this repo's own record identifies as the repeat offender —
site-planner persistence and sync (`public.site_elements`, `public.sites`, and the project-name
layer over it). Doc Review / Library / admin / notes each have their own, much smaller, write
paths and are noted only at the boundary.

| Entity | Authoritative home | Derived mirrors | Write path(s) | Precedence when writers disagree |
|---|---|---|---|---|
| **A drawn feature** (element / markup / measurement / callout / parcel) | one row in `public.site_elements`, keyed `(site_id, kind, id)` — `db/site_elements.sql` | the client **shadow map** (`elementSync.js`'s `shadow`, last-committed json+rev per key); the on-canvas React collections (`els`/`markups`/…); the localStorage save cache (`storage.js`) | per-op RPC `commit_elements` (single element), `commit_elements_atomic` (a whole bonded assembly, one transaction), `commit_elements_group_cas` (assembly write gated on every LIVE member's rev, B1341 stage 2, currently OFF by default) | **rows canonical on seed** for anything the server already has (§2 inv. 3); after that, **monotonic `rev`** is the optimistic-concurrency token — last write at the higher rev wins, loser is told (or silently reconciled — §2 inv. 5–7) |
| **A bonded child's position/span** (`attachedTo`, `sideParkFit`, dock-zone span fields) | **nothing** — it is DERIVED from the host's geometry across the shared wall; the stored fields are a cache of that derivation, never an independent fact, unless a gesture explicitly pinned it (`sideParkFit`/`alongAnchor` stamps) | the stored `el.sideParkFit` / `el.dockAxis` / zone-span fields on the child row | `assemblyIntegrity.js`'s heal, re-run at every seam (canvas, undo/redo, commit, flush-override, load, post-commit) | the **heal's own diff wins** — a stored value that disagrees with the derivation is a tear, reported and corrected, never trusted over the recomputation |
| **A project's name** (a "site group") | **nothing textual** — it is the *majority/stamped* answer computed by `projectName.nameAuthority()` over every plan in the group | every plan's `site` column / `data.site` field (denormalized on purpose, for read paths that only ever see one plan) | `storage.renameSiteGroup` → `cloudSync.cloudRenameGroup` → **one** `rename_site_group()` SQL statement, `UPDATE … WHERE coalesce(data->>'groupId', id) = p_group_id` | `siteRenamedAt` (a stamp, schema v13) — **never `updatedAt`**, which the record shows disagrees with reality on real accounts |
| **A plan record** | one row in `public.sites` | the localStorage mirror (`planyr:*` keys), the in-memory model | `storage.saveSite` → Supabase update, `version`-gated | server `version`/`updated_at`, resolved at load (`loadSitesList`/`loadSite`) and re-asserted at every `saveSite` (the write choke point — see `projectName.js` header) |
| **A parcel's lineage** (`parentId`) | the **stamp is historical only** — a split child's parent id is never re-read as a live pointer once `performSplit` deletes the parent (deliberately, B472048/B472049) | `lineageDepth` (only for split-letter naming) vs. `depth` (the CURRENT resolvable tree — the one indentation must walk) | `performSplit` | current resolvable tree wins for every live-facing purpose; the stamp is provenance only |
| **A Doc Review file** | one row in `public.doc_reviews` + the byte payload in Google Drive (`server/storage/`) + a queryable fact index in `public.file_facts` | none — the Drive file id is the one pointer, held in Postgres so a stateless Cloudflare Function can't lose it | chunked upload through `/api/uploads/*`, resumable-session-backed | not multi-writer today (single uploader per file); out of this audit's depth |
| **Account prefs / admin allowlist** | `public.profiles.prefs` (jsonb, own-row RLS) / `public.admin_users` (zero client SELECT policy, `is_admin()` RPC only) | `planStyle`'s in-memory "account layer" | direct row write / not client-writable at all | not multi-writer; out of scope here |
| **A note page's SCOPE** (org vs. project vs. none — NEW-1, org scope) | the page's own ROOT node in the Notes tree: `orgScope: true` (omitted when false) or `projectId` (`null`/a real id) — mutually exclusive, never both, never a sentinel `projectId` value | none — a subpage's scope is derived from its root (`projectOfPage`), never stored a second time | `setPageOrgScope`/`setPageProject`/`movePage`/`addPage` (`lib/notesModel.js`), synced as part of the whole tree blob via `notesCloud.js`'s `mergeTrees` | **`filedAt` recency** — the newer side's whole filing decision (project id + org flag, together) wins when both sides are roots; on a tie, **local wins** (same rule the project half already used, B421493, now covering both destinations) |
| **A Doc Review file's SCOPE** (org vs. project vs. unfiled — NEW-1, org scope) | the review's `orgScope` flag, carried inside `doc_reviews.data` (the record jsonb) exactly like every other record field — no new migrated column, extracted back out via `data->orgScope` (the same trick `placed`/`sfile`/`folderId` already use) | none | `fileNewReview`/`refileReview` (`doc-review/lib/reviewStore.js`); the Drive byte path is `organization/<discipline>/…`, a real top-level folder sibling to `project-*`, never folded into `project-unfiled` (which means "not yet classified", a different fact) | last write wins (same as every other `doc_reviews` field — CAS-guarded by the row's `version`, §1's existing row) |

---

## 2. Invariants

Each is phrased as a testable sentence, followed by what proves it and its **current** status
(verified against the code on `main`, not assumed from a prior write-up).

1. **No plan row may ever hold a `site` value that contradicts its own group's authoritative
   name.** — `test/projectName.test.js` (23 tests, run against real production-shaped rows) +
   e2e `project-rename` (mutation-checked). **✅ holds**, enforced at both read (`applyGroupNameAuthority`)
   and write (`saveSite`'s `resolveNameFor` choke point).
2. **A project rename is one atomic statement over the whole group; it can never half-land.** —
   `rename_site_group()` is a single `UPDATE … WHERE coalesce(data->>'groupId', id) = …`, applied
   to production. **✅ holds** for the write itself; the pre-migration per-row fallback path is
   documented as deliberately non-atomic and does not apply on a migrated project.
3. **Rows are canonical across a seed** — an element the server already has wins over a diverging
   local canvas copy unless a pending local op explains the difference; an element the server has
   *never* seen still keeps local's copy. — `elementSync.js` `reconcile()`'s `rowsWin` branch;
   `ROWS-CANONICAL-ON-SEED` in root `CLAUDE.md`; covered by `test/elementSync.test.js`. **✅ holds.**
4. **A remote tombstone is never resurrected by a local undo.** — `applySnapshot` drops buffered
   *upserts* on restore but keeps buffered *removes*. **✅ holds** (B1098).
5. **Exactly one function answers "did this row originate from my own ACCOUNT?"** —
   `isOwnWrite(row, selfUid)`, `elementSync.js` (new in this session — a pure, standalone
   extraction of what was already the sole account-ownership primitive, `foreignAuthor`, which
   every one of its ~10 call sites still calls; see §3 and §7). **✅ holds**, and is
   machine-enforced: `test/elementSyncOwnWriteGate.test.js` fails the build if a new
   self-attributable `onEvent(...)` call in `elementSync.js` is not gated on it (or isn't on the
   test's stated EXEMPT list, with a reason).
6. **A delete is classified by the identical direct-vs-derived rule an edit already is** — a
   cascaded child's tombstone must never stamp its own authorship. — `elementSync.js` `reconcile()`
   reconstructs the pre-delete element from the shadow's last-known json before calling
   `directTag`, so a delete asks the caller's `isDirectEdit` exactly as an edit would. **✅ holds**
   (`test/elementSync.test.js`, describe block "NEW-0 round 7 — a DELETE is classified the same as
   an EDIT").
7. **A stale delete may not re-apply onto a row created after the delete was formed.** —
   `births`/`remoteOnly` maps in `elementSync.js`; `test/deleteVsCreate.test.js` (both directions,
   every seam). **✅ holds** (B377888).
8. **A bonded child's world position/span is derived, never an independently-trusted stored
   fact.** — `assemblyIntegrity.js`; `test/assemblyIntegrity.test.js`,
   `test/assemblyMissingSibling.test.js`. **✅ holds**, with an honest `unhealable` state for a
   geometry the heal cannot repair (B377890) — it reports rather than fabricates a layout.
9. **A bonded assembly's write either lands whole or is provably torn and re-driven — never
   silently half-settled.** — client-side: `closeAssemblies` at flush time; server-side:
   `commit_elements_atomic.sql` (all-or-nothing group commit, applied to production); optional
   stricter mode: `commit_elements_group_cas.sql` (B1341 stage 2, gated OFF by default, digest =
   every LIVE member's `id:rev`, never a stored column). **✅ holds** —
   `test/assemblyGroupCas.test.js`, `db/test/commit_elements_group_cas.test.sql`.
10. **One gesture producing N element writes is reported to the user as ONE notice, never N.** —
    `SitePlanner.jsx`'s toast-batch correlation keys on `(event type, the shared updated_at/
    deleted_at timestamp, the writer)` — a bonded commit's members share that timestamp to the
    microsecond by construction (the same atomic commit inv. 9 describes). **✅ holds** — this is
    exactly "direction 4" from the 2026-07-14 handoff the dispatch cites as dropped; see §7.
11. **Delete is unconditional, and silence is impossible.** — `deletePlan.js`'s three invariants
    (anything visibly selected is deletable; the target is the union of `multi`/`sel` at any
    count; nothing removed always returns a reason the caller must show). **✅ holds** —
    `test/deletePlan.test.js` (38), e2e `delete-unconditional`.
12. **Every delete records tombstones for its full cascade set before the next flush**
    (`TOMBSTONE-DELETES` in root `CLAUDE.md`) — so a sync/merge can't resurrect a deleted item or
    raise a false "changed elsewhere" conflict. **✅ holds** (B276/B556/B596/B612).
13. **Hard row `DELETE` is never used for ordinary deletion** — deletion is a tombstone `UPDATE`
    (`deleted_at`/`deleted_by` set, `data` retained for Restore); a real `DELETE` is reserved for a
    future purge and RLS-gated to the owner/a team admin. — `db/site_elements.sql`. **✅ holds.**
14. **A note page or a Doc Review file has exactly ONE destination — a project, the Organization,
    or nowhere — never two at once, and Organization is never spelled as a sentinel project id.**
    (NEW-1, org scope.) `setPageOrgScope`/`setPageProject` each clear the other's field on write;
    `movePage`'s root-placement branch treats an explicit `orgScope:true` and an explicit
    `projectId` as mutually exclusive destinations; `fileNewReview`/`refileReview` do the same for
    Doc Review. Reads agree: `pagesInScope(tree, projectId, SCOPE_ORG)` and a file's `orgScope`
    flag are checked *before* the "no project" fallback everywhere a page/file's home is
    captioned, so an org item never reads as "Not in a project" / "unfiled" (the two are different
    facts — the first is a deliberate destination, the second is "nobody has said yet"). **✅
    holds** — `test/notesModel.test.js`, `test/notesSync.test.js` (the merge's `orgScope`/
    `projectId` pair travels together under `filedAt` recency), `test/fileFacts.test.js` (`unfiled`
    is false for an org-scoped file). No migrated column exists for either kind of content's org
    flag by design (§1's own rows) — Notes rides the existing tree-blob sync, Doc Review rides the
    existing `data` jsonb extraction — so there is nothing for a partial migration to disagree
    with.

---

## 3. One-answer functions

The short list of questions this codebase has decided must have **exactly one** implementation,
with where that implementation lives and what keeps a second one from growing back.

| Question | The one function | What enforces "only one" |
|---|---|---|
| "Did this row originate from my own **account**?" | `isOwnWrite(row, selfUid)` (`elementSync.js`) — standalone, pure; the engine's `foreignAuthor(row)` is this same logic pre-bound to one instance's `selfUidNow()` | `test/elementSyncOwnWriteGate.test.js` greps `elementSync.js` itself for every `onEvent({type:"…"` call and fails unless each is gated on `foreignAuthor(`/routes through it, or is on a named, reasoned EXEMPT list |
| "Have I already put these exact bytes / this exact rev on the wire (a per-**tab** echo)?" | *(deliberately not one function — see the note below)* `sentMatches`/`recentSent` (byte match), `isOwnRev`/`atOrBelowOwnHighWater` (rev match), the `sent.epoch < localEpoch` check (undo-staleness) | none needed today — each is used at exactly one call site in `applyRemoteRow`, not scattered; see the note below for why merging them was considered and rejected |
| "Where should this bonded child actually sit?" | `assemblyIntegrity(els)`, built on the *existing* derivation (`siteModel.normalizeBondedChildren`) | its own header: *"the detector IS the healer's own diff — never write a second 'where should this child be', that is the next bug in this family"* |
| "Was this op the gesture's actual target, or an app-derived cascade?" | `isDirectEdit`/`directTag` — one predicate, injected once into `createElementSync`, asked at enqueue time | single injection point; `SitePlanner.jsx`'s `isDirectEdit` implementation is the only caller-side definition |
| "What is this project's one true name?" | `projectName.nameAuthority(plans)` | pure function, single call site at both read (`applyGroupNameAuthority`) and write (`resolveNameFor` in `saveSite`) |
| "Did a commit's result line up with the op that produced it?" | `pairCommitResults` (positional pairing, verified, with a reported fallback) | one function, called from both `processResults` paths |

**Why the per-tab echo question is not folded into `isOwnWrite`, even though the dispatch asked
for "exactly one function… covering per-tab AND per-account":** these are different questions
used for different decisions, and each of the per-tab signals exists **because it catches a
specific, separately-dated production failure the others provably miss** — collapsing them would
not simplify the code, it would delete the redundancy that closes those gaps:

- **rev match** (`isOwnRev`/`atOrBelowOwnHighWater`) survives a stale refetch rolling the shadow's
  rev *backward*, which byte matching cannot detect (B812).
- **byte match** (`sentMatches`) catches a committed-but-unacked write echoing back *after* a
  transport failure requeued a newer edit, when no rev has been learned yet (B757).
- **epoch match** (`sent.epoch < localEpoch`) catches an echo of bytes sent *before* the user
  undid them — a case where the rev is still valid and the bytes still match, but the write itself
  describes a world that no longer exists (the straggler-re-tear class).

Each is asked once, at one control-flow point, for one reason stated in its own header. This is
the accurate correction to the dispatch's "six overlapping mechanisms… consulted in different
combinations… at roughly fifty sites": the **actual** current count of call sites combining these
primitives with local business logic is **one function** (`applyRemoteRow`, ~200 lines), not
fifty scattered sites — see §7 for the grep that established this.

---

## 4. Causal units

**How a multi-element gesture is formed, committed, echoed, and reported as one thing** — the
"direction 4" the dispatch says was identified over a month ago and dropped. It was not dropped;
it shipped, in three layers that each own one seam:

1. **Formed, at write time.** `closeAssemblies` (called from `flush()`, `elementSync.js`) folds in
   every bonded member whose live data disagrees with the shadow *before* the batch is built, and
   every op is re-read from the live canvas at flush time (`liveCollections`) rather than from a
   payload captured when the gesture started — so a drag can't tear a building off its truck court
   by committing stale per-member coordinates.
2. **Committed, atomically.** `commit_elements_atomic.sql` runs the whole batch as one Postgres
   transaction — `applied:false` means *nothing* landed, including ops whose own per-row status
   reads `ok`. The stricter `commit_elements_group_cas` additionally refuses the call whole if any
   LIVE member's rev has moved under it (B1341 stage 2).
3. **Echoed and reported as one thing.** A batch's rows share one `updated_at`/`deleted_at` to the
   microsecond (a fact the DB already guarantees from step 2, not a second id threaded through).
   `SitePlanner.jsx`'s toast layer keys a short coalescing window on `(event type, that timestamp,
   the writer)`, so a 14-member cascade produces one toast, not fourteen — the batching comment
   names this explicitly: *"`elementSync` commits a bonded assembly … ATOMICALLY, so every row in
   one commit batch shares a single `updated_at`/`deleted_at` to the microsecond."*

What is **not** unified into this, on purpose: an event type with no shared commit timestamp (a
commit-*result*-driven type — `edit-vs-edit-lost-race`, `restore-conflict`, …) falls back to
flushing alone, immediately — there is nothing to correlate it with.

---

## 5. The failure contract

`LOUD-FAILURE` (root `CLAUDE.md`) governs every write/fetch/parse in this layer: no silent no-op,
no swallowed `catch` that reads as success. Concretely, in the sync engine:

- Every irregular outcome calls `report(...)` (telemetry, `client_errors`-bound) with a named
  event string before doing anything else — `element-delete-fabricated`,
  `element-rows-canonical`, `element-assembly-split`, `element-stale-own-echo`, etc. — so a
  reconciliation decision is always observable after the fact, not just in the moment.
- A user-facing consequence goes through `onEvent(...)` → the B673 conflict-toast matrix
  (`conflictToasts.js`), which is itself gated by `isOwnWrite`/`foreignAuthor` per §2 inv. 5 — the
  same event vocabulary that feeds telemetry feeds the toast, so the two can't disagree about what
  happened.
- A batch that cannot converge after repeated attempts (`maxRejectStreak`, `splitStreak`) does not
  loop forever — it reports `client-stale`/`element-assembly-split-unresolved` and surfaces a
  "you're out of date" state rather than retrying silently.
- A repair (`assemblyIntegrity`'s heal) is loud by contract: every correction emits
  `assembly-tear-detected`/`-healed`/`-persisted` with ids and the delta — its own header states
  this was learned the hard way, after "eight merged PRs each closed one interleaving" with no
  observer, so nobody but the owner noticed a ninth recurrence.

---

## 6. The destructive-action contract

- **Soft-delete only, at the database.** `site_elements` deletion is a tombstone `UPDATE`
  (`deleted_at`/`deleted_by`, data retained) — never a row `DELETE`, so "did I actually lose this"
  is always answerable and Restore is always possible. Hard `DELETE` is reserved for a
  future purge, gated to owner/team-admin (`db/site_elements.sql`).
- **Delete is unconditional and never silently no-ops** (`deletePlan.js`, §2 inv. 11) — anything
  visibly selected is deletable regardless of pin state; the target is always the union of
  `multi`/`sel`; a delete that removes nothing still returns an owner-facing reason.
  `DELETE_ENTRIES` names every entry point, and each reports `delete-attempt`/`delete-outcome`.
- **A cascade's tombstones are recorded for its full closure set before the next flush**
  (`TOMBSTONE-DELETES`), so a delete can never be partially resurrected by a merge landing
  mid-cascade.
- **A stale delete cannot outrun a row it predates** (§2 inv. 7, `births`/`remoteOnly`) — a delete
  formed before a row's own creation is a decision about a row that no longer exists, and is
  dropped rather than re-applied.
- **Delete-vs-edit is delete-wins; delete-vs-create is create-wins** — asymmetric on purpose, and
  each direction has its own guard (the B673 matrix for the former, `births`/`remoteOnly` for the
  latter). Do not "simplify" these into one rule; they answer different questions ("is the row I'm
  deleting the row I think it is" vs. "did I lose a race against an edit").

---

## 7. This session's findings, stated plainly (so a ninth round is never scheduled on stale evidence)

**NEW-2 (isOwnWrite consolidation)** — already shipped. `git log` / the archived backlog show
`B712224 (×3)` (owner chat block 2026-08-23) diagnosing exactly the delete-authorship hole the
dispatch describes, live on production data, fixed in `elementSync.js`'s `reconcile()`, and moved
to `docs/archive/BACKLOG-DONE.md`. `test/elementSyncOwnWriteGate.test.js` — dated the same day —
is the machine-enforced guard the dispatch asks for, and its own header quotes the *identical*
sentence the dispatch's brief quotes: *"as long as fifty call sites each re-derive this question,
round eight is already scheduled."* The exact regression the dispatch's NEW-2 asks to be added
already exists and passes: `test/elementSync.test.js` → describe **"NEW-0 round 7"** → *"REGRESSION:
this account's OTHER tab writing a cascaded CHILD after the delete produces NO notice."* Grepping
the real call-site count (as instructed, rather than trusting the "fifty" figure): `foreignAuthor(`
is called at **10** sites, all inside one ~200-line function (`applyRemoteRow`/`processResults` in
`elementSync.js`), not fifty sites system-wide. This session additionally extracted the standalone
`isOwnWrite(row, selfUid)` export (§2 inv. 5, §3) — a pure, behavior-preserving refactor (verified
by the full existing suite, 219 tests, before and after) that gives the exact function name the
dispatch asked for without touching any of the ten proven call sites or the CI guard keyed to them.

**NEW-3 (project rename)** — already shipped in code and sandbox-tested; **honestly parked**, not
neglected. `B1415–B1418` (owner chat block 2026-08-04) built exactly the fix this dispatch
describes (`projectName.js`, `rename_site_group.sql`, the `siteRenamedAt` stamp) and it sits in
`## ⏳ Verify` with `V698`–`V700` in `VERIFICATION.md`, each correctly walled with a named
`Blocker: auth` / `Blocker: real-data` — this coding session cannot sign in to `planyr.io`
(the sandbox proxy CORS-blocks the Supabase auth handshake), so it cannot perform the one thing
still outstanding: watching a real cross-device rename on the owner's signed-in account. This is
the correct, non-lazy disposition under this repo's own three-state lifecycle
(`## ⛔ MERGED ≠ LIVE`) — re-implementing it here would not be able to do anything the shipped code
doesn't already do, and would not close the live-verify gap either. It needs a Cowork-thread pass
against `planyr.io`, via the `verification-inbox/` mechanism, not more code.

**Direction 4 (causal batching)** — already shipped (§4). The 2026-07-14 handoff's own framing —
that this was "identified over a month ago… dropped… never done" — no longer describes the code:
`closeAssemblies` + `commit_elements_atomic`/`group_cas` + the toast-batch timestamp correlation
in `SitePlanner.jsx` together deliver exactly this, end to end.

**What is genuinely new from this session:** this document; the `isOwnWrite` export + its unit
tests; the pointer from root `CLAUDE.md`. Everything else audited above was already correct,
tested, and (bar the two live-verify items, which are blocked on capabilities this session does
not have) already live.
