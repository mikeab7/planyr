# Owner product constraint #11

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

11. **(2026-09-23) The two overlay systems converge in CODE ONLY — never in storage.** The Site
    tab's `sheetOverlays` (in the site model) and the Map/Comps `site_plan_overlays` table stay
    exactly as they are: do NOT merge the stores, and do NOT propose or build any data migration,
    ownership or sharing change. Michael does not care where the data lives; what he does not
    want is the same FEATURE written twice. So crop, georeference, scale and rasterising each have
    ONE shared engine used by both surfaces — no second copy of the logic, no forked crop model.
    Crop is already shared (`overlayCrop.js` + `ImageCropTool`); the rest is B1838705. Also
    measured the same day, so nobody re-hunts it: nothing is double-saved (the Goose Creek master
    site plan on four plans points at ONE stored object), and canvas overlays with a null
    `storageKey` naming a real PDF are the old local-only-overlay problem, NOT duplication — keep
    them out of this work.
    **AMENDED 2026-10-08 (owner-authorised exception, NEW-1) — sibling plans of ONE site share
    overlays as OPTIONS, not as stored data.** Michael, verbatim: "overlays should go to each
    individual plan or like should flow through each individual plan. Like if I've got a project or
    a site and I put an overlay on one like concept A, it should also show up on concept B as an
    option. It shouldn't automatically overlay, but if I go to show it, it should, I should be able
    to show it if that makes sense." He approved the design and said ship it. What this does NOT
    change: the Site tab / Map-Comps split above is untouched (no store merge, Map/Comps surface out
    of scope), there is still NO site-level overlay store and NO migration — every plan keeps its own
    `sheetOverlays` exactly as stored. What it ADDS: the Overlays panel lists an overlay held by a
    sibling plan on the same site (and not by this plan) as a hidden "added on <that plan>" row; its
    eye COPIES the record into THIS plan only (new id, re-framed through `resolveClipFrame`, a
    `sharedFrom` stamp), after which it is this plan's own record and edits never propagate.
    Remove is this-plan-only. Pure rules: `lib/siblingOverlays.js`. The null-`storageKey` carve-out
    above and #12 (crop is keep-inside only) stand.
