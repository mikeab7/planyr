/* City names on the planner canvas — the DEVICE-LEVEL on/off memory (B2391216 ×2).
 *
 * The twin of roadNamesPref.js, for the same reason: the city-name layer is a reference label
 * (Planyr's own dataset, `shared/basemaps` placeNames), not a GIS overlay, so its switch is a
 * presentation taste that follows the DEVICE across plans — never a site-model field. Default ON,
 * like the map finder's row. Every access is guarded; a blocked/empty store yields the default. Pure. */
export const CITY_NAMES_PREF_KEY = "planyr:cityNames";
export const CITY_NAMES_DEFAULT = { on: true };

export function normalizeCityNamesPref(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  return { on: typeof o.on === "boolean" ? o.on : CITY_NAMES_DEFAULT.on };
}

export function loadCityNamesPref(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try { return normalizeCityNamesPref(JSON.parse(storage.getItem(CITY_NAMES_PREF_KEY))); }
  catch (_) { return { ...CITY_NAMES_DEFAULT }; }
}

export function saveCityNamesPref(pref, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try { storage.setItem(CITY_NAMES_PREF_KEY, JSON.stringify(normalizeCityNamesPref(pref))); return true; }
  catch (_) { return false; }
}
