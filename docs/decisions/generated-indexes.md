# Generated indexes a branch never touches

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**🗺 Two generated, committed indexes save you from cold-searching — but a BRANCH NEVER TOUCHES
THEM (SUPERSEDED 2026-09-08, NEW-1, B<PENDING>).** Reading this section as "regenerate each in
the same commit that changes its inputs" is now WRONG and will fail your PR — that used to be
the rule, and it meant every PR that touched a source file (nearly all of them) or `BACKLOG.md`
also had to regenerate and commit the same generated file, so any two such PRs open at once
conflicted on it by construction; GitHub can't compute a test-merge ref for a conflicted PR, so
the required `build` check never ran at all ("Expected — waiting for status to be reported"
forever — measured live 2026-09-08, PR #1529 re-conflicted on these files three times in one
hour). **`scripts/generated-doc-touch-guard.mjs` now fails a PR that modifies either file — leave
them exactly as they are in your diff, however stale they look.** They are kept fresh
automatically instead, by `.github/workflows/regen-derived-docs.yml` (a nightly scheduled job
that opens its own small PR when either has drifted — that PR needs a human or a Claude Code
session to merge it, since the workflow's own token can't arm auto-merge). **⚠ AS OF 2026-11-05 THE JOB CANNOT OPEN ITS PR** (GitHub: "Actions is not permitted to create or approve pull requests" — every run since at least Nov 1, B2671188): it pushes `chore/regen-derived-docs-<stamp>` and stops, so until the owner flips that setting a session opens the PR from the newest such branch (the touch guard exempts that branch name) and arms auto-merge. Being briefly stale
between refreshes is fine — neither is a runtime source of truth.
- **`MAP.md`** (repo root) — every source file → its module owner, one-line responsibility, and
  exported symbols. **Grep `MAP.md` to find a path or symbol** instead of sweeping `src/`, but
  expect it to lag a recent rename/add by up to a day. `node scripts/build-map.mjs --check` still
  exists for the scheduled job and for local curiosity — it is no longer a required CI gate.
- **`BACKLOG_OPEN.md`** (repo root, STAYS on main — the claude.ai Project syncs it from main) — one line per Open / ⏳ Verify
  item (B#, title, module, `#tags`, Verify status) + a by-tag rollup. It is generated FROM THE LEDGER BRANCH by the nightly
  `regen-derived-docs.yml` (so it can lag the branch by up to a day — the branch is the truth). The **tag-legend rule stays
  enforced** on the ledger (`node scripts/build-backlog-index.mjs --tags-only`, run by `ledger-health.yml`).
- The same rule covers **`docs/UI-INVENTORY.md`** (the generated control-signature inventory — see
  `docs/DESIGN.md`): never touch it either. Its real design-quality gate (the per-surface
  signature BUDGET) stays required via `node ui-audit/ui-inventory.mjs --budget-only`; only the
  requirement that the committed file match a fresh crawl moved to the scheduled job.
