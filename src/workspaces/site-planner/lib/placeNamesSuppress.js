/* ONE SET OF PLACE NAMES (B2507065 / NEW-10, owner constraint #47). The City Names layer (Planyr's own dataset, dots at old town centres) and the Counties & Cities
 * layer's own labels (each city's name inside its own limits) both name the same towns, so with the layer on every town read twice ("Walls", "Walls"). While ANY member of
 * the Counties & Cities row is on, the City Names layer stays hidden — its own switch is untouched, so turning Counties & Cities off brings the names straight back.
 * Pure. */
import { ALL_LAYERS } from "./layers.js";

export const COUNTIES_CITIES_GROUP = "counties_cities";

/* Is any member of the Counties & Cities merged row on in this overlays state? */
export function countiesCitiesOn(overlays) {
  for (const [k, st] of Object.entries(overlays || {})) {
    if (st && st.on && ALL_LAYERS[k] && ALL_LAYERS[k].mergeGroup === COUNTIES_CITIES_GROUP) return true;
  }
  return false;
}

/* The City Names layer's effective on/off: the user's own switch, and not while Counties & Cities is showing its own names. */
export const cityNamesEffective = (userOn, overlays) => !!userOn && !countiesCitiesOn(overlays);
