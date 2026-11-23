# Owner product constraint #14

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

14. **(2026-10-04) On a phone, the page keeps its THINNER grey margin around the sheet — do not widen it to match
    desktop, do not re-ask.** Michael, in answer to whether the phone's paper margin (16 vs 40 per side) should be
    made identical to desktop's after the B2078593 full-width work: "keep the thinner grey margin around the page on
    phones as you have it. No change needed there." Box widths, tables and line breaks must still be identical on
    every device (asserted by `ui-audit/verify-notes-box-width-parity.mjs`); only this margin may differ. (See
    B2078593.)
