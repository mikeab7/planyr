# `docs/` — on-demand reference (read only when the task touches it)

These files were split out of `CLAUDE.md` on 2026-07-02 so the always-loaded handoff stays
lean. `CLAUDE.md` (repo root) is still the core every session reads to orient; pull one of
these up only when your task needs it.

| File | What's in it | Read when |
|------|--------------|-----------|
| `SHIPPED.md` | Full catalog of shipped-and-verified features (Site Planner, Supabase backend, multi-workspace foundation, Document Review) + the retired GitHub-Pages deploy note. | You need the history/detail of a specific already-built feature. |
| `ROADMAP.md` | The two-track roadmap — Site Planner maturation + Document Review buildout — and deferred/decision-gated items. | Planning new feature work. |
| `REFERENCE.md` | Deep implementation detail: Site Model schema, map-layer/GIS plumbing, Supabase DDL/RLS, Document Review persistence internals, the sandbox Playwright quirk. | You're editing that subsystem and need the internals. |
| `test-data-loss.md` | Manual persistence test script. | Testing persistence by hand. |

## Token discipline (why this split exists)

The costly habit was loading big files just to find one small thing. Two rules keep it cheap:

1. **`CLAUDE.md` is the lean core** — standing rules, how to talk to Michael, the architecture
   spine, KEY DECISIONS, workflow. Bulky detail lives here in `docs/` and is read on demand.
2. **Grep the big tracking files; don't slurp them.** `BACKLOG.md`, `VERIFICATION.md`, and the
   two `*-DONE.md` archives are hundreds of KB. To find work, `Grep` the headings
   (`^### B` / `^### V`) then `Read` only the one block you'll act on. The `*-DONE.md` archives
   are write-only — never read them except to look up one specific past ID.

## Per-folder notes

Some module folders carry a short `CLAUDE.md` pointer (e.g. `src/workspaces/site-planner/`,
`src/workspaces/doc-review/`, `src/shared/`). Claude Code auto-loads a folder's `CLAUDE.md`
only when a session is working in that subtree — so they add targeted context without bloating
the root. **Keep them short pointers** (what's here + key files + where the deep detail is),
never duplicated detail, so they don't go stale.
