# Named rule SYNTHETIC-KEYS-DONT-EDIT

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **SYNTHETIC-KEYS-DONT-EDIT** — **A SYNTHETIC KEYSTROKE DOES NOT MUTATE THE PLAN, AND ONE DOM READ IS NOT
  A CHECK. Drive the real input, then RE-READ UNTIL THE FEATURE IS GENUINELY ABSENT.** (NEW-3, 2026-08-09.
  Sits beside FOREGROUND-OR-VOID because it is the same species: a harness that believes its own instrument.)
  1. **THE COST, which is the reason it is a rule and not a note.** This has taken **two cleanup rounds on
     the owner's LIVE plans** — a stray easement left on Bain / "Concept - Original" (2026-08-08) and three
     pasted markups left on Silvestri (V27088, 2026-08-09). Both times the harness "deleted" the object,
     **reported success, and the object was still on his plan**, so a human had to finish it by hand.
  2. **THE MECHANISM, MEASURED rather than reasoned** (build 7307342, one selected building, count before →
     after). The planner's key handler is bound to **`window`**, and `new KeyboardEvent(…)` defaults
     **`bubbles: false`** — a real key event never does — so a synthetic event dispatched on `document` or
     `document.body` never propagates to it:

         document.dispatchEvent(new KeyboardEvent("keydown", {key:"Delete"}))        1 → 1  ✗
         document.body.dispatchEvent(…)                                              1 → 1  ✗
         window.dispatchEvent(…)                    (the listener's own target)      1 → 0  ✓
         …any of the three with { bubbles: true }                                    1 → 0  ✓
         page.keyboard.press("Delete")              (a real key event)               1 → 0  ✓

     So it is NOT that the app rejects untrusted events — it never checks `isTrusted`. It is one missing
     option, and it fails in **total silence**: no error, nothing in the console, the object still selected.
  3. **AND TWO MORE GATES SWALLOW THE KEY BY DESIGN**, so a driver can do everything right and still no-op:
     a **FOCUSED FIELD** (while `activeElement` is an input/select/textarea/contentEditable the handler
     returns early so you can type — correct product behaviour, invisible to a driver that did not blur),
     and an **INACTIVE PLANNER** (`if (!active) return` — a keep-alive planner behind another workspace
     must never eat keys).
  4. **THE RULE.** Never dispatch a synthetic keystroke to mutate the plan. Use the driver's real key input
     (`page.keyboard.press` / CDP `Input.dispatchKeyEvent`), or press the control that does the job — the
     Properties panel's **Delete element**, or the right-click menu's. **And RE-READ BETWEEN ATTEMPTS:** the
     DOM read races the re-render, which is exactly how a pass was reported for an object still present.
     Poll until the feature is ABSENT, then **reload and confirm** — a removal that never reached storage
     comes back.
  5. **MACHINE-ENFORCED, both halves.** `ui-audit/lib/deleteFeature.mjs` is the only supported deletion
     driver (`deleteFeatureUntilGone` escalates key → panel → menu, re-reading between each, and **THROWS
     rather than reporting a pass it did not earn**); `test/deleteDrive.test.js` pins the verdict table and
     **sweeps `ui-audit/` + `e2e/` for the banned shape**. The claim itself cannot become folklore:
     `ui-audit/verify-delete-drive.mjs` re-measures the table above against the real app every run and
     **fails if the banned shape ever starts working** — the day the key wiring changes, the rule says so
     instead of quietly going stale.
