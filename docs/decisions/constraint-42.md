# Owner product constraint #42

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

42. **(2026-10-29) EVERY overlay layer starts at 100% opacity when first turned on.** Michael, after seeing DeSoto zoning live: at lower defaults "it isn't clear the layer is even there." One place decides it (`layers.js` normalises `cfg.opacity` to 1 for the whole registry; the old tier opacity ceilings in `layerWeight.js` are all 1 now — this REVERSES the NEW-4 "reference recedes" ceilings 0.85 / 0.55 / 0.4, which remain only for stroke WEIGHT). A value a user already set (per-project opacity, B2448033) is kept; only the default moved. Do not lower a default again without a new decision. Guard: `test/layerHierarchy.test.js`. (B2507060.)
