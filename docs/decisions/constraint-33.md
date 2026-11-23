# Owner product constraint #33

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

33. **(2026-10-21) The editable PDF raises NO hover note box, and a rebuilt measurement is never an opaque block.** Michael, after hovering a building in Chrome's viewer: the huge yellow "Planyr / Building 1" box is unnecessary. No site element, parcel label or measurement annotation writes `/Contents`, no annotation is titled "Planyr" (`/T` is the author only when known), no `/Popup` is ever written (PDFium ignores them), and `/Subj` stays (Bluebeam's Markups list names items by it). Only text a person typed (a markup's Comment, a callout's own text) is `/Contents`. A translucent measurement fill is never stored as `/IC` (Bluebeam paints it solid when it rebuilds the measurement); the page carries a `/VP` scale so Bluebeam asks for none. Guards: `test/pdfHoverAndRegen.test.js`; ui-audit **verify-pdf-hover-popup** (real Chrome). (B2431296, B2431297.)
