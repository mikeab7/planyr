# Owner product constraint #27

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

27. **(2026-10-20) While the Parcels tool is up, the parcels are the TOP of the drawing.** Michael, verbatim: "When I click the parcels tool, the parcels should show above anything that I've got on the screen. Like if I click add county lots, that should show above anything else." "Up" = the Land panel open (docked or floating), Pick county lots, Draw / Split / Combine / Edit corners — one function, `mapStack.parcelsOnTop`. Both the county lots on offer and the plan's own lots (fill, outline, selection weight, setback ring, chips) paint over buildings, markups, callouts, references and every GIS layer, and a press follows that order (in Pick county lots a click on a lot covered by something picks the LOT). It is RENDER ORDER only: nothing stored, no saved layer order touched, no new control, and closing the tool restores the fixed model; the PDF/PNG sheet always shows the normal order. Parcels still never move outside Edit parcels. Do not make it permanent, add a toggle, or reorder saved layers. (B2370480.)
