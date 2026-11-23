# Owner product constraint #19

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

19. **(2026-10-08) Unnamed lots stay unnamed.** Michael: "Do not derive a name from street address, owner or legal description." A parcel with no name the owner typed shows a grey "Unnamed" in the list and on its page (source line unchanged) and its name field stays empty. Never re-add a derived name (`parcelFallbackName`, `addr`) to `parcelDisplayInfo` or the Parcels UI. Combine's "Tract A" and split's "<name> · A" (entry 18) still count as named. (B2194745.)
    **AMENDED 2026-10-16 (owner, Cowork chat) — the LIST no longer says "Unnamed".** A drawn / other / no-source parcel with no typed name reads by its STABLE NUMBER in the list ("Parcel 4", "Parcel 5" — `siteModel.parcelNumbers`, the stamped `parcelNo`; a number stays with its lot when an earlier one is deleted, never renumbered), instead of a row of identical "Unnamed" labels; an unnamed COUNTY lot still reads "Acct …". The number is a handle, not a derived name: nothing is taken from address, owner or legal description, the name FIELD on the parcel's page stays empty with its grey "Unnamed" placeholder, and a typed name still wins. (B2289936.)
