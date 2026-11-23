# Named rule PANEL-BREVITY

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **PANEL-BREVITY** — **LESS IS BETTER. The default view is the scarcest space in the product; every
  line must earn its place.** (Owner rule, 2026-07-28, verbatim: *"you keep adding words to the yield
  panel. So make a rule somewhere in the repo that that's not what we want to do. Less is better. I just
  want the information literally as brief as it can be."* Written after three consecutive sessions each
  added individually-correct copy — the honest storage explainer, the five-case berm state, the
  reconciliation paragraph — and nobody consolidated, so the panel became a wall of text.)
  1. **VERDICT + NUMBER FIRST, then at most ONE short line per group.** Everything else collapses
     behind the group's existing `Assumptions & method ▸` disclosure (the B862 pattern).
  2. **New copy REPLACES, it does not ACCUMULATE.** A change that adds a sentence to a panel must
     **name the sentence it removed**, in the commit and on the item.
  3. **Prefer a NAMED STATE over a sentence explaining the state.** A short labelled chip beats a
     clause: `berm ring 17.4 · below flood 12.2` beats *"17.4 ac-ft is taken up by the earthen berm
     ring built inside the outline, and 12.2 sits below the flood level…"*.
  4. **Numbers over prose; absolute values over percentages** (a percentage against a near-zero
     denominator is noise — B1034).
  5. **Never render the same sentence in more than one place.** State it once; elsewhere reference it.
  6. **Honesty stays REACHABLE, not VISIBLE.** Collapsing is the tool — deleting facts is not.
     **Brevity is never bought with accuracy.** If you find yourself removing a fact to shorten a
     panel, you have taken the wrong branch: shorten the DEFAULT VIEW, not the information.
  7. **Measure it.** Any change touching yield / pond panel copy reports the visible line + character
     count per group **before and after**. A net increase requires explicit justification on the item.
  - **MACHINE-ENFORCED, because a markdown rule rots.** `node ui-audit/panel-copy-budget.mjs --check`
    (in the `/improve` gate + `test/panelBrevity.test.js`) measures the visible default-view copy of
    each panel region against **zero-headroom budgets** in `ui-audit/panel-copy-budget.json`, so an
    accumulating change goes **red in CI** instead of relying on a reviewer noticing. Copy inside a
    `<Collapse>`, in a `title=` / `basis=` hover, or in a `keyedNote(...)` method note is **exempt** —
    those are the sanctioned escape valves, which is why collapsing gets you under budget and deleting
    is never necessary. Raising a budget number is allowed but never silent: justify it on the item.
    (Extends the per-line caps this repo already had — B823's 110-char `warnNote` cap in
    `test/drainageNoteLength.test.js`, and `test/pondCopyLint.test.js` — from *"no one line may be a
    paragraph"* to *"no group may accumulate lines."*)
