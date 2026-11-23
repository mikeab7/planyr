# All shared data has one source of truth

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ STANDING RULE — ALL SHARED DATA HAS ONE SOURCE OF TRUTH; NEVER COPY SHARED DATA INTO COMPONENT STATE
(owner rule, 2026-09-29, generalising the names rule above after the B1953792 audit found ~27 more
stale-copy sites).** Any value more than one surface can change — acreage, counts, status, owner,
jurisdiction, dates, account prefs, rule tables, filing facts — lives in ONE home; every reader reads it
through one selector/subscribe (never a `useState`/`useRef`/module cache seeded once from it); every
writer goes through one function that does a fresh read-modify-write of only the keys it changed; a
derived value is computed at read time, never persisted next to its source; a snapshot that is
intentional (issued revision, history, export) is labelled as such in code. Inventory + verdicts:
`docs/audit-single-source-of-truth.md`. Guard: `test/entityStateCopy.test.js` (fails on a new seeded
copy; escape is an inline `// stale-ok: <reason>`).
**Copies in OTHER TABLES / jsonb blobs (B2064896, 2026-10-04):** every migration column that could hold a copy
must be declared in `scripts/denormalisedCopies.json` (COPY with verdict + how it stays right + cited code, or
OWNED) or `test/denormalisedCopies.test.js` fails; `npm run drift-report` (`scripts/drift-report.sql`, read-only)
lists rows where a stored copy disagrees with its source in production — run it after any change that adds or
moves a copy. A project's STATUS is read only through `projectModel.groupStatusOf`.
