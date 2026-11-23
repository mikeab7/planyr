# Owner product constraint #17

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

17. **(2026-10-05) In Food, on a phone held SIDEWAYS, the place card docks to the RIGHT as a side panel
    (like desktop) — never the bottom sheet — and the map keeps the pin in view.** Michael, approved fix
    ("dock the card to the side, and improve on it"): the header collapses to one row, a pick centres its
    pin in the map to the LEFT of the card, the "Search live for more here" chip is centred in that visible
    part, "Log a visit" stays at the card's bottom, and the notch/home-bar safe areas are respected.
    Upright phones keep the bottom sheet; desktop keeps the rail. "Landscape phone" is one query
    (`LANDSCAPE_PHONE_QUERY`, `src/workspaces/food/lib/phoneLayout.js`: landscape + short + touch);
    `ui-audit/verify-food-landscape.mjs` fails if the pin is hidden or the sheet comes back. (B2046224 ×4.)
