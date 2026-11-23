# docs/decisions: the full text behind every rule in CLAUDE.md

On 2026-11-23 (audit batch H, owner-approved) `/CLAUDE.md` was slimmed from ~37,000 words to a short rulebook. **No rule was removed or weakened.** Each rule, constraint and named rule is stated in a sentence or two in CLAUDE.md under a stable anchor comment, and its original text, history and evidence were moved **verbatim** into the file listed below. The Site Planner folder pointer was slimmed the same way into `docs/site-planner/`.

**Convention:** constraint N → `constraint-N.md` (35a/35b, 41a/41b are the two duplicated numbers, both kept). Named rule NAME → `<name-lowercased>.md`. Tests (`test/rulebookAnchors.test.js`) check every anchor exists in CLAUDE.md and its file exists here. **When you change a rule, change CLAUDE.md and its file together.**

## Old CLAUDE.md section → new location
| Old lines | Old section | Now |
|---|---|---|
| 1-7 | # CLAUDE.md — Planyr Project Handoff | kept in CLAUDE.md (verbatim) |
| 8-24 | 🗂 How this handoff is organized (keep it token-lean — owner rule, 202 | [handoff-organization.md](handoff-organization.md) |
| 25-89 | 🧾 THE LEDGER LIVES ON ITS OWN GIT BRANCH, `ledger` — RECORDS NEED NO  | [ledger-branch.md](ledger-branch.md) |
| 90-97 | ⛔ TOUCHING PERSISTENCE, SYNC, UNDO, OR DELETE? READ `docs/DATA.md` FIR | [data-bible-pointer.md](data-bible-pointer.md) |
| 98-108 | ⛔ WORKING ON NOTES? READ `docs/NOTES-CARRY-FORWARD.md` FIRST — before  | [notes-carry-forward-pointer.md](notes-carry-forward-pointer.md) |
| 109-114 | Touching the Notes editor ENGINE, its Tiptap version, or the paste pip | [notes-editor-engine.md](notes-editor-engine.md) |
| 115-118 | 🔢 MINTING (history, one line so a stale memory does not resurrect it) | [minting-history.md](minting-history.md) |
| 119-122 | ⛔ ONE MEASURED FACT THAT STILL APPLIES (B6867): RE-RUNNING A FAILED `b | [stale-pr-rerun.md](stale-pr-rerun.md) |
| 123-129 | 🔄 Keep the per-folder pointers fresh. Some module folders carry a sho | [folder-pointers.md](folder-pointers.md) |
| 130-138 | 🎨 ADDING OR CHANGING ANY UI? READ `docs/DESIGN.md` FIRST — before wri | [design-bible-pointer.md](design-bible-pointer.md) |
| 139-149 | 📱 TESTING ON A PHONE? READ `docs/PHONE-TESTING.md` FIRST — before say | [phone-testing-pointer.md](phone-testing-pointer.md) |
| 150-176 | 🗺 Two generated, committed indexes save you from cold-searching — but | [generated-indexes.md](generated-indexes.md) |
| 177-196 | ⛔ STANDING RULE #1 — when Michael drops in a problem, FIX IT AND SHIP  | [standing-rule-1-fix-and-ship.md](standing-rule-1-fix-and-ship.md) |
| 197-207 | 📥 Owner CHAT BLOCKS are SHIP ORDERS, not filing requests (owner rule, | [owner-chat-blocks-are-ship-orders.md](owner-chat-blocks-are-ship-orders.md) |
| 208-241 | ⛔ STANDING RULE #2 — NEVER-PARK: AN OWNER-REPORTED SYMPTOM IS NEVER CL | [standing-rule-2-never-park.md](standing-rule-2-never-park.md) |
| 242-270 | ⛔ STANDING RULE #3 — ONE TASK PER SESSION; COST PER TASK, NOT MODEL TI | [standing-rule-3-one-task-per-session.md](standing-rule-3-one-task-per-session.md) |
| 271-288 | ⛔ STANDING RULE — NAMES HAVE ONE SOURCE OF TRUTH; NEVER COPY A NAME IN | [names-one-source-of-truth.md](names-one-source-of-truth.md) |
| 289-304 | ⛔ STANDING RULE — ALL SHARED DATA HAS ONE SOURCE OF TRUTH; NEVER COPY  | [shared-data-one-source-of-truth.md](shared-data-one-source-of-truth.md) |
| 305-310 | 📋 The BACKLOG (`ledger/backlog/` on the `ledger` branch) = the single | [backlog-ledger.md](backlog-ledger.md) |
| 311-320 | ⏳ THREE-STATE LIFECYCLE (B645): items move 🔲 Open → ⏳ Verify → ✅ Done | [three-state-lifecycle.md](three-state-lifecycle.md) |
| 321-332 | ⛔ MERGED ≠ LIVE — a reconciliation/audit may call a `Verify: live` ite | [merged-is-not-live.md](merged-is-not-live.md) |
| 333-339 | 🔍 The VERIFICATION ledger (`ledger/verification/` on the `ledger` bra | [verification-ledger.md](verification-ledger.md) |
| 340-364 | ⛔ SESSIONS SIGN IN AND VERIFY THEIR OWN WORK — `Blocker: auth` NO LONG | [sessions-verify-their-own-work.md](sessions-verify-their-own-work.md) |
| 365-380 | ⛔ STANDING RULE — A COWORK SESSION RECORDS ITS OWN LIVE VERIFY, DIRECT | [cowork-records-its-own-verify.md](cowork-records-its-own-verify.md) |
| 381-383 | 📦 The `done` folders of the ledger (`ledger/backlog/done`, `ledger/ve | [done-folders-write-only.md](done-folders-write-only.md) |
| 384-429 | ## How to talk to me (Michael) — IMPORTANT, applies to every reply | kept in CLAUDE.md (verbatim) |
| 430-444 | ## Owner product constraints — decisions already made, do not relitiga | kept in CLAUDE.md (verbatim) |
| 445-449 | Constraint #1 | [constraint-1.md](constraint-1.md) |
| 450-452 | Constraint #2 | [constraint-2.md](constraint-2.md) |
| 453-456 | Constraint #3 | [constraint-3.md](constraint-3.md) |
| 457-459 | Constraint #4 | [constraint-4.md](constraint-4.md) |
| 460-462 | Constraint #5 | [constraint-5.md](constraint-5.md) |
| 463-465 | Constraint #6 | [constraint-6.md](constraint-6.md) |
| 466-468 | Constraint #7 | [constraint-7.md](constraint-7.md) |
| 469-496 | Constraint #8 | [constraint-8.md](constraint-8.md) |
| 497-502 | Constraint #9 | [constraint-9.md](constraint-9.md) |
| 503-532 | Constraint #10 | [constraint-10.md](constraint-10.md) |
| 533-557 | Constraint #11 | [constraint-11.md](constraint-11.md) |
| 558-559 | Constraint #12 | [constraint-12.md](constraint-12.md) |
| 560-568 | Constraint #13 | [constraint-13.md](constraint-13.md) |
| 569-575 | Constraint #14 | [constraint-14.md](constraint-14.md) |
| 576-584 | Constraint #15 | [constraint-15.md](constraint-15.md) |
| 585-592 | Constraint #16 | [constraint-16.md](constraint-16.md) |
| 593-601 | Constraint #17 | [constraint-17.md](constraint-17.md) |
| 602-610 | Constraint #18 | [constraint-18.md](constraint-18.md) |
| 611-613 | Constraint #19 | [constraint-19.md](constraint-19.md) |
| 614-621 | Constraint #20 | [constraint-20.md](constraint-20.md) |
| 622-631 | Constraint #21 | [constraint-21.md](constraint-21.md) |
| 632-636 | Constraint #22 | [constraint-22.md](constraint-22.md) |
| 637-645 | Constraint #23 | [constraint-23.md](constraint-23.md) |
| 646-652 | Constraint #24 | [constraint-24.md](constraint-24.md) |
| 653-654 | Constraint #25 | [constraint-25.md](constraint-25.md) |
| 655-656 | Constraint #26 | [constraint-26.md](constraint-26.md) |
| 657-658 | Constraint #27 | [constraint-27.md](constraint-27.md) |
| 659-666 | Constraint #28 | [constraint-28.md](constraint-28.md) |
| 667-668 | Constraint #29 | [constraint-29.md](constraint-29.md) |
| 669-670 | Constraint #30 | [constraint-30.md](constraint-30.md) |
| 671-672 | Constraint #31 | [constraint-31.md](constraint-31.md) |
| 673-674 | Constraint #32 | [constraint-32.md](constraint-32.md) |
| 675-676 | Constraint #33 | [constraint-33.md](constraint-33.md) |
| 677-677 | Constraint #35a | [constraint-35a.md](constraint-35a.md) |
| 678-679 | Constraint #34 | [constraint-34.md](constraint-34.md) |
| 680-681 | Constraint #35b | [constraint-35b.md](constraint-35b.md) |
| 682-683 | Constraint #36 | [constraint-36.md](constraint-36.md) |
| 684-685 | Constraint #37 | [constraint-37.md](constraint-37.md) |
| 686-687 | Constraint #38 | [constraint-38.md](constraint-38.md) |
| 688-689 | Constraint #39 | [constraint-39.md](constraint-39.md) |
| 690-691 | Constraint #40 | [constraint-40.md](constraint-40.md) |
| 692-693 | Constraint #41a | [constraint-41a.md](constraint-41a.md) |
| 694-695 | Constraint #41b | [constraint-41b.md](constraint-41b.md) |
| 696-697 | Constraint #42 | [constraint-42.md](constraint-42.md) |
| 698-699 | Constraint #43 | [constraint-43.md](constraint-43.md) |
| 700-701 | Constraint #44 | [constraint-44.md](constraint-44.md) |
| 702-703 | Constraint #45 | [constraint-45.md](constraint-45.md) |
| 704-705 | Constraint #46 | [constraint-46.md](constraint-46.md) |
| 706-708 | Constraint #47 | [constraint-47.md](constraint-47.md) |
| 709-709 | Constraint #48 | [constraint-48.md](constraint-48.md) |
| 710-711 | Constraint #49 | [constraint-49.md](constraint-49.md) |
| 712-713 | Constraint #50 | [constraint-50.md](constraint-50.md) |
| 714-715 | Constraint #51 | [constraint-51.md](constraint-51.md) |
| 716-717 | Constraint #52 | [constraint-52.md](constraint-52.md) |
| 718-719 | Constraint #53 | [constraint-53.md](constraint-53.md) |
| 720-721 | Constraint #54 | [constraint-54.md](constraint-54.md) |
| 722-723 | Constraint #55 | [constraint-55.md](constraint-55.md) |
| 724-725 | Constraint #56 | [constraint-56.md](constraint-56.md) |
| 726-727 | Constraint #57 | [constraint-57.md](constraint-57.md) |
| 728-729 | Constraint #58 | [constraint-58.md](constraint-58.md) |
| 730-731 | Constraint #59 | [constraint-59.md](constraint-59.md) |
| 732-733 | Constraint #60 | [constraint-60.md](constraint-60.md) |
| 734-759 | ## Grading model (owner rules 2026-10-16; round 4 2026-10-19) | [docs/site-planner/grading-model.md](../site-planner/grading-model.md) |
| 760-818 | ## What Planyr is | kept in CLAUDE.md (verbatim) |
| 819-829 | ### Dependency notes (client bundle) | [dependency-notes.md](dependency-notes.md) |
| 830-1021 | ## Workflow & deploy | [workflow-and-deploy.md](workflow-and-deploy.md) |
| 1022-1028 | ## Engineering rules (invoke by name) + Definition of Done (B649) | kept in CLAUDE.md (verbatim) |
| 1029-1032 | Rule LOUD-FAILURE | [loud-failure.md](loud-failure.md) |
| 1033-1036 | Rule AUDIT-FIRST | [audit-first.md](audit-first.md) |
| 1037-1040 | Rule PDF-PARITY | [pdf-parity.md](pdf-parity.md) |
| 1041-1043 | Rule MODULE-SCOPE-COMPONENTS | [module-scope-components.md](module-scope-components.md) |
| 1044-1056 | Rule VIEWPORT-STABLE | [viewport-stable.md](viewport-stable.md) |
| 1057-1145 | Rule CHROME-NEVER-EATS-A-PRESS | [chrome-never-eats-a-press.md](chrome-never-eats-a-press.md) |
| 1146-1214 | Rule FOREGROUND-OR-VOID | [foreground-or-void.md](foreground-or-void.md) |
| 1215-1280 | Rule DRIVER-SCROLL-IS-NOT-APP-SCROLL | [driver-scroll-is-not-app-scroll.md](driver-scroll-is-not-app-scroll.md) |
| 1281-1296 | Rule COUNT-EVERY-KIND | [count-every-kind.md](count-every-kind.md) |
| 1297-1338 | Rule NO-ONE-OWNS-A-COMPOSITE | [no-one-owns-a-composite.md](no-one-owns-a-composite.md) |
| 1339-1376 | Rule SYNTHETIC-KEYS-DONT-EDIT | [synthetic-keys-dont-edit.md](synthetic-keys-dont-edit.md) |
| 1377-1411 | Rule PERCEPTUAL-PARITY | [perceptual-parity.md](perceptual-parity.md) |
| 1412-1443 | Rule WRONG-CASE | [wrong-case.md](wrong-case.md) |
| 1444-1447 | Rule DEDUPE-FIRST | [dedupe-first.md](dedupe-first.md) |
| 1448-1450 | Rule TOMBSTONE-DELETES | [tombstone-deletes.md](tombstone-deletes.md) |
| 1451-1480 | Rule TIER-BY-REBUILDABILITY | [tier-by-rebuildability.md](tier-by-rebuildability.md) |
| 1481-1492 | Rule ROWS-CANONICAL-ON-SEED | [rows-canonical-on-seed.md](rows-canonical-on-seed.md) |
| 1493-1512 | Rule DANGEROUS-MEANS-UNOBSERVABLE | [dangerous-means-unobservable.md](dangerous-means-unobservable.md) |
| 1513-1518 | Rule LIVE-VERIFY | [live-verify.md](live-verify.md) |
| 1519-1564 | Rule EDITOR-EXIT-CONTRACT | [editor-exit-contract.md](editor-exit-contract.md) |
| 1565-1596 | Rule PANEL-BREVITY | [panel-brevity.md](panel-brevity.md) |
| 1597-1648 | Rule VIEW-INDEPENDENT-ONCE | [view-independent-once.md](view-independent-once.md) |
| 1649-1660 | Rule NO-PER-MOVE-WORK | [no-per-move-work.md](no-per-move-work.md) |
| 1661-1662 | Rule NO-RETRYABLE-ERRCODE | [no-retryable-errcode.md](no-retryable-errcode.md) |
| 1663-1674 | Rule CONSTRAINT-CAPTURE | [constraint-capture.md](constraint-capture.md) |
| 1675-1688 | Rule ONE-SHELL-ONE-TOOLBAR-ONE-SWEEP | [one-shell-one-toolbar-one-sweep.md](one-shell-one-toolbar-one-sweep.md) |
| 1689-1707 | ### Definition of Done (every item) | kept in CLAUDE.md (verbatim) |
| 1708-1711 | ## What's already built — see `docs/SHIPPED.md` | kept in CLAUDE.md (verbatim) |
| 1712-1712 | ## KEY DECISIONS (must persist) | kept in CLAUDE.md (verbatim) |
| 1713-1731 | - Theming: light / dark / system + the text-hierarchy rule (owner rule | [key-decision-theming.md](key-decision-theming.md) |
| 1732-1749 | - Project-status palette + map markers (owner rules, B433/B434; the si | [key-decision-project-status.md](key-decision-project-status.md) |
| 1750-1755 | - No dialog-box edits — inline editors only (owner rule, 2026-06-17).  | [key-decision-no-dialog-box.md](key-decision-no-dialog-box.md) |
| 1756-1760 | - Brand spelling — Planyr (P-L-A-N-Y-R). Human-readable text → Planyr  | [key-decision-brand-spelling.md](key-decision-brand-spelling.md) |
| 1761-1781 | - Module naming — the Document Review workspace is user-facing "Review | [key-decision-module-naming.md](key-decision-module-naming.md) |
| 1782-1783 | - Private by default. Any future sharing or shared workspaces default  | [key-decision-private-by-default.md](key-decision-private-by-default.md) |
| 1784-1796 | - No cross-customer admin view — amended 2026-08-30 (owner go-ahead),  | [key-decision-no-cross-customer.md](key-decision-no-cross-customer.md) |
| 1797-1800 | - Secrets stay in env/secrets, never committed. Covers Supabase keys,  | [key-decision-secrets.md](key-decision-secrets.md) |
| 1801-1801 | - Logged-in users' data lives in the cloud. | [key-decision-logged-in.md](key-decision-logged-in.md) |
| 1802-1804 | - Monorepo, one repo, folder per workspace. The `/server` folder's sec | [key-decision-monorepo.md](key-decision-monorepo.md) |
| 1805-1811 | - DWG handling (Document Review): Michael normally receives DWG (and P | [key-decision-dwg.md](key-decision-dwg.md) |
| 1812-1815 | - Auto-filing never auto-guesses. Files matched confidently to one of  | [key-decision-auto-filing.md](key-decision-auto-filing.md) |
| 1816-1832 | - Screening fetches: recompute is free, re-fetch is user-action-driven | [key-decision-screening.md](key-decision-screening.md) |
| 1833-1854 | ## DEFERRED (with reasons — waiting creates no rework debt) | kept in CLAUDE.md (verbatim) |
| 1855-1921 | ## Two backends — don't conflate | [two-backends.md](two-backends.md) |

The old file's title/intro, the named-rules intro and the KEY DECISIONS heading are in [claude-md-original-headings.md](claude-md-original-headings.md).

## Site Planner folder pointer
Every entry of the old `src/workspaces/site-planner/CLAUDE.md` is in one of the ten topic notes under [docs/site-planner/](../site-planner/) (the entry-point bullets are in `entry-points-and-chunks.md`); the pointer keeps only a signpost.
