# Named rule COUNT-EVERY-KIND

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **COUNT-EVERY-KIND** — **A PLAN'S CONTENTS ARE ITS FIVE DRAWN KINDS. A count that reads `[data-el-id]`
  sees ONE of them and reports the other four as NOTHING HAPPENED.** (NEW-2, 2026-08-09.) Measured live on
  the owner's Silvestri pair: a cross-plan paste landed three markup objects, the app correctly said so, and
  the element count read **120 before, 120 after** — a false "paste succeeds silently but writes nothing"
  was one keystroke from being filed against a working feature. The plan holds **145 distinct features**
  against those 120 elements. Every feature stamps `data-feature="<kind>:<id>"` (el · markup · measure ·
  callout · parcel); count **DISTINCT KEYS, never NODES** — chrome carries its owner's key too, so a node
  count drifts with selection and hover. Use `ui-audit/lib/featureCensus.mjs`; a targeted
  `[data-el-id="b3"]` lookup is untouched, and a genuine element-tier read says so with an `el-tier:`
  marker naming why. Enforced by `test/featureCensus.test.js` (source sweep + the counting rule) and
  `e2e/feature-census.spec.js` (one of each kind = five, with an el-only counter answering ONE beside it).
  **⛔ AND THE THING THAT RESCUED IT: Ctrl+Z, then diff the feature list. WHEN A COUNT SAYS NOTHING HAPPENED
  BUT THE APP SAYS IT DID, THE UNDO KNOWS** — an undo frame exists only if something was really committed,
  and undoing it names exactly what went in. A counter can be blind to a kind; the model's own history cannot.
  The same trap applies to picking a "blank" canvas point: free of ELEMENTS is not free of FEATURES, and a
  pan started on a markup DRAGS IT (`BLANK_POINT_EXCLUDE`).
