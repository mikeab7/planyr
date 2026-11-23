# Owner product constraint #18

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

18. **(2026-10-05) Combine and Split on parcels NEVER ask for a name, and the map toolbar and the Parcels panel are ONE
    action.** Michael, verbatim: "Owner is on the fly; never block on a name" — a combine auto-names the tract
    ("Tract A", "Tract B", …) and a split names its pieces "<name> · A", "· B"; renaming is an optional pencil afterwards,
    never a prompt. Both operations show an Undo toast, keep the originals reachable (Restore) and never alter county data.
    And: "if I do the split without ever coming into the left-hand menu, just from the right-hand menu, it'll still work,
    same thing with merge" — the map's Split tool / Merge banner and the panel call the same single functions
    (`site-planner/lib/parcelOps.js`; `test/parcelOpsParity.test.js` fails if a second implementation grows back). In the
    Parcels table the checkbox only SELECTS rows; the eye includes/excludes a parcel from the site total. (B2134368–B2134370.)
