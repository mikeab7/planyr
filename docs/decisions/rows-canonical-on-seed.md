# Named rule ROWS-CANONICAL-ON-SEED

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

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
