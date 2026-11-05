# The Planyr ledger branch

This branch holds the BACKLOG and VERIFICATION records — one file per entry under `ledger/<kind>/<state>/<ID>.md`.
It has **no required checks and no pull requests**: a session commits records straight here.

- Read:  `npm run ledger -- list open`  (from a code clone of `main`; it checks this branch out into `.ledger/`)
- Write: `npm run ledger -- add|move|put|mint|push …`  — never hand-edit and push; the commands fetch, retry on a lost race, and mint ids atomically.
- Rules: see the LEDGER section of `CLAUDE.md` on `main`.

Created 2026-11-05 from main@48a3e4e083 (history of every entry is preserved: this commit's parent is that main commit).
