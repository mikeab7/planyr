# Owner product constraint #20

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

20. **(2026-10-11) The Parcels list is LAYOUT C and stays calm.** Michael chose it from a mockup, after saying the list "keeps
    showing up like shit when it gets to the real thing": grouped by source (County lots · Combined · Drawn · Other), each
    group header carrying its ACTIVE acres; ONE summary line at body size ("174.28 AC in site · 10 of 11 active" — never a
    display-size figure, "this is a professional software"; the figure is the SAME WEIGHT as the words around it, so the line reads as one sentence); names and source lines wrap and are NEVER ellipsised; acres in one
    fixed column with a shared right edge; **it is a real TABLE (2026-10-16, replacing "no column-heading row"): ONE heading row above the whole list — "Acres" over the figures, a lock icon over the lock column, an eye icon over the visibility column, the overlap icon over its column only while one exists — and every row shows its padlock (closed / open) and eye (open / struck) ALL THE TIME, each a click with Undo; only ⋯ waits for hover**; the icons live in the right-hand icon slot (never in the name block); rename is a ⋯ menu item; the site total stays the TRUE (dissolved) area and overlapping parcels are DISCLOSED (a muted overlap ICON in the icon slot per row — never a pill, never in the name block; the slot has FIXED seats overlap | padlock | eye | ⋯, so each icon kind has one x on every row, and a heading icon sits centred over it — and a second short muted summary line "N AC overlaps, counted once"; neither summary line wraps), never silent. A change to this list
    is judged on real-shaped data at every panel width in both themes — `ui-audit/verify-parcel-list-layout.mjs` (a required
    CI gate) — not on tidy fixtures. (B2243424.)
