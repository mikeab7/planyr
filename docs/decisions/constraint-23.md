# Owner product constraint #23

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

23. **(2026-10-11) Parcel & setback styling is three objects, one default + one override, and weight is SCREEN PIXELS.** Only the
    parcel boundary, the setback line and the dimension labels are styleable (colour via the full native picker — any hex; weight
    1–6; dashed on/off; labels show · colour · size 8–16 pt). **Weight is screen pixels, constant across zoom** — a 2 px line stays
    2 px at any zoom; the boundary and setback ring never take a zoom factor. Resolution is parcel override → the user's workspace
    default (`profiles.prefs.parcelLook`, private) → built-in; "reset to workspace default" clears the override. A failed write
    reverts and says so — never a change that looks applied but isn't saved. **Out, do not build:** style presets, a no-build band,
    buildable-envelope styling, a swatch palette, a dash-pattern picker. The per-side label toggle waits on edge grouping (B2254145).
    (B2254144.)
