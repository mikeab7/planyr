/* siteLabelStack — NEW-1 amendment (B2018608). Attaches the SITE PLAN map's label layers to a Leaflet map
 * that is NOT the Site tab's map finder (i.e. /food's default option), driven by the very same pure
 * `siteStack(zoom)` the finder reads — so the two show the same layers at every zoom:
 *   · Planyr's own city-name layer, zooms 3..13 (`placeNamesGate` / `placeNamesLayer`, moved to shared)
 *   · the clean vector road lines + names, from SITE_ROADS_FROM up — never at metro zoom
 * The map finder keeps its own React-state wiring (its Layers panel toggles) but reads the same
 * `siteStack`; `test/siteStackParity.test.js` pins that neither can grow its own gate. */
import { siteStack, VECTOR_SOURCE } from "./basemaps.js";
import { attachPlaceNames } from "./placeNamesGate.js";
import { addVectorLabels } from "./vectorLabelLayer.js";

export function attachSiteLabelStack(L, map, { source = VECTOR_SOURCE, onStatus } = {}) {
  let roads = null, city = null, wantCity = false, removed = false;
  const apply = () => {
    if (removed) return;
    const stack = siteStack(map.getZoom());
    if (stack.includes("roadNames")) {
      if (!roads) roads = addVectorLabels(L, map, { source, mode: "site", includePois: false, onStatus });
    } else if (roads) {
      roads.remove(); roads = null;
      if (onStatus) onStatus("none");
    }
    wantCity = stack.includes("cityNames");
    if (wantCity) {
      attachPlaceNames(map).then((c) => { if (c && !removed) { city = c; c.setEnabled(wantCity); } });
    } else if (city) {
      city.setEnabled(false);
    }
  };
  map.on("zoomend", apply);
  apply();
  return {
    remove() {
      removed = true;
      map.off("zoomend", apply);
      if (roads) { roads.remove(); roads = null; }
      if (city) city.setEnabled(false);
    },
  };
}
