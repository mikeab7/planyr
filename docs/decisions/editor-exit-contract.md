# Named rule EDITOR-EXIT-CONTRACT

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **EDITOR-EXIT-CONTRACT** — **EVERY WAY OUT OF AN EDITOR KEEPS WHAT THE EDITOR SHOWS AS FINISHED.
  An editor that draws part of its value in FINISHED form while still holding it as unsaved state is
  a defect by construction — not a keystroke to patch.** (Owner report 2026-09-15, B1341728/B1341729,
  measured on his own account on a throwaway duplicate schedule.)
  1. **THE CASE.** The Schedule grid's Owner cell let you click a contact out of a list; it appeared
     as a **chip with its own remove control** — pixel-for-pixel how a SAVED owner looks. It was
     unsaved component state. Escape threw it away. Enter threw it away and moved the cursor on, so
     the loss was silent. Tab and click-away saved. Owners saved BEFORE the edit survived all four,
     so it destroyed new work only — the least likely kind of loss to be noticed, and the most
     annoying to redo.
  2. **THREE EDITOR CLASSES. Pick one; a hybrid is the bug.**
     · **text** — the value in flight is text the person is still typing. **Enter / Tab /
       click-away COMMIT; Escape abandons the typed text.** Nothing is drawn as finished, so Escape
       destroys nothing anyone could mistake for saved. (Excel's contract, and the right one here.)
     · **select** — a menu. **CHOOSING is the commit.** The arrow-key highlight is in progress, not
       finished, so an exit taken without choosing correctly leaves the value alone — and **every**
       exit, Tab included, CLOSES the menu rather than leaving it floating over the grid.
     · **tokens** — a chip / token field. **Every token is written through the instant it is added,
       removed or reordered**; every exit merely closes, and none can discard. Undo is the recovery
       for a mistaken add or removal, exactly as for any other committed edit.
  3. **THE INVARIANT THAT BINDS ALL THREE: no exit may remove anything the editor renders in
     FINISHED form.** If you want a token to be abandonable, it has to LOOK pending. Shipping it in
     the finished style and calling it pending is the defect, whichever exit happens to expose it.
  4. **⛔ AND THE REASON THIS IS A RULE RATHER THAN A FIX: THE REPORTED KEY IS NEVER THE SCOPE.**
     Escape reproduced instantly in the sandbox; **Enter did not** — it committed correctly on every
     route tried (double-click, Enter-to-open, type-to-edit; no prior owner, one, several; one add,
     three). Patching the key that reproduced would have left the one that did not, on his machine,
     unexplained and unfixed. Closing the STATE GAP retires both, plus the unmount nobody planned
     for. When a user reports one exit, audit all four, on every editor of that surface.
     **⛔ AND THE OUTCOME, WHICH IS THE PART THAT MATTERS AND MUST NOT BE READ OFF THE SENTENCE
     ABOVE: THE ENTER ARM WAS REAL.** Michael re-ran his own four-exit test on his signed-in
     browser against the merge commit itself (V978448, passed 2026-09-15, build named in the same
     observation) and reported Enter both **saving** and no longer jumping the cursor down a row
     with the value discarded. So "Enter did not reproduce here" was a statement about the
     SANDBOX — logged out, local fixture, no cloud round-trip — and never about the defect. Do not
     read this clause as "the unreproduced arm was imaginary": it is the cleanest instance this
     repo has of **STANDING RULE #2 clause 1** — a first-hand owner report is evidence, a failed
     reproduction is not a refutation, and when the two disagree the INSTRUMENT is on trial. Had
     the null been taken as a disposition, Enter would have shipped unfixed.
  5. **MACHINE-ENFORCED, both halves.** `ui-audit/verify-cell-editor-exit-contract.mjs` drives every
     editable cell in the Schedule grid through Escape · Enter · Tab · click-away in a real browser
     and prints the audit table (it carries a known-good arm and declares the run VOID rather than
     scoring it if that arm does not report its known value). `test/cellEditorExitContract.test.js`
     is the CI-runnable half: it fails if a cell editor omits an exit, if the token editor grows a
     deferred-commit path again, or if this rule is deleted from CLAUDE.md.
