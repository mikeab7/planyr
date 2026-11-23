# Owner product constraint #21

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

21. **(2026-10-11, decided 2026-10-05) A project's OVERLAYS and COMPS follow the project's sharing; REVIEWS do not (still undecided).**
    Michael, 2026-10-11: "if I share a site with someone, they should have access to all the overlays that I have as a default."
    And 2026-10-05: "if I have a project, like an individual site, and there's like comps attached to it or overlays, those should
    all be visible." Anyone who can open a shared, live plan can see and load every overlay on it (Site tab `sheetOverlays` files
    included), and anyone who can read a project can read its Map/Comps overlays, their rasters and its comps. Visibility is
    DERIVED by additive SELECT policies (`site-planner/db/project_follow_sharing.sql`) — never by rewriting `team_id` columns, never
    a data migration. This AMENDS the 2026-08-09 "sharing is decided per item, site plans only" rule for overlays and comps only.
    Review visibility stays exactly as it is. Unshared stays private; the `guard_team_share` trigger is untouched. And: a failed
    overlay download outside the reader's own storage folder may never erase the record's pointer (`lib/overlayHeal.js`). (B2244016, B2244017.)
