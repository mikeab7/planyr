# Owner product constraint #44

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

44. **(2026-10-29) The "Discover DeSoto — I-269 Corridor Study Areas" layer is REMOVED and is not to be re-added** (owner: he cannot tell what it is from the name, and it is a transportation-model study, not site intelligence). It also froze the tab (12 polygons, 707,071 vertices, a 28 MB answer — B2507064), so every esri feature layer now passes a DRAW BUDGET (`layerRequest.FEATURE_VERTEX_BUDGET` / `FEATURE_VERTEX_TOTAL`, enforced in `layers.buildFeatureLayer`): a batch over it is declined and the layer reports "too detailed to draw at this zoom" instead of hanging. Guards: `test/layerDrawBudget.test.js`; live ui-audit `verify-layer-no-freeze`.
