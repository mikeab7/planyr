# Owner product constraint #41b

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

41. **(2026-10-29) DeSoto County zoning is real polygons, Olive Branch included, labelled by the jurisdiction the SITE falls in — never a PDF link, never "the county's" or "the city's" by layer.** Michael corrected the dispatch brief's premise ("the layer may cover only the unincorporated county; Olive Branch may be a PDF"): measured, `CountyWebMap/Zoning/MapServer/20` holds Olive Branch's own zoning (832 polygons inside its limits, rezoning cases to 2026-08-18, Municode ordinance links). One table holds several governments' zoning with NO jurisdiction field, so a result is labelled from the county's own Municipalities limits ("Olive Branch" / "Unincorporated DeSoto County"). Do not build the "Official Olive Branch zoning map (PDF)" fallback. (B2507058; `desotoZoning.js`, `desotoJurisdiction.js`.)
