# Names have one source of truth

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ STANDING RULE — NAMES HAVE ONE SOURCE OF TRUTH; NEVER COPY A NAME INTO COMPONENT STATE
(owner rule, 2026-09-29, after B1934528: the exhibit kept the old project name because
SitePlanner seeded `siteLabel` once at mount).** A project's name is the group's authoritative
`site` and a plan's is its record's `name`; every display reads them through
`src/shared/names/names.js` (`useProjectName` / `usePlanName`), which re-reads on the app's one
`onProjectsChanged` signal, and every rename goes through `renameProjectChecked` /
`renamePlanChecked` (validate → the one storage write → a visible notice on rejection or failure;
an empty name is refused, never defaulted). Derived strings (PDF filename, exhibit title, tab
title) are computed from the selector at render/export time, never cached. Guards:
`test/namesSingleSource.test.js` (fails on `useState` seeded from a name) and
`e2e/names-matrix.spec.js` (every entry point × every display, red-proofed).
**THE RULE ALSO COVERS OTHER TABLES (B1991040, 2026-09-30):** a stored copy of a project's name
(`schedules.linked_site_name`, `doc_reviews.project`, a title composed from it) is only ever the
FALLBACK for a link that cannot be resolved — every display resolves it by id at read time
(`scheduleOwnership.liveSiteName`, `reviewNaming.liveReviewProject`), an auto-composed title follows
the rename and a typed one never moves. `test/nameCopiesGuard.test.js` fails on any new
project/plan-name-like SQL column that isn't declared with its read-time rule.
