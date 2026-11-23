# Owner product constraint #36

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

36. **(2026-10-23) A Schedule row-drag has THREE zones, and the centre one NESTS — amending the 2026-08-25 "two bands only" rule (B763472).** Michael could not drag rows under a task that has no children yet (no gap to aim at), so the centre of ANY row now means "make the dragged rows children of this row" (last child), shown as a boxed, tinted row with a "Nest inside" chip, visually distinct from the insertion line. **The centre zone must stay the SMALLEST of the three (30% vs 35% / 35%)** — the 2026-08-25 rule existed because the old "into" band was the biggest target and nested rows by accident; never widen it, never make it the default. The centre of a dragged row / its own descendants shows a red "Not allowed" box and a release there says why (never a silent no-op). A childless row that becomes a parent is announced in a toast and Ctrl+Z restores it. Logic: pure `rowDropIntent` in `public/sequence/index.html`; guards `test/scheduleDropNest.test.js` + `ui-audit/verify-schedule-row-move.mjs` (section N, NESTBAND mutation). (B2445008.)
