import { describe, it, expect } from "vitest";
import { normalizeCityNamesPref, loadCityNamesPref, saveCityNamesPref, CITY_NAMES_DEFAULT, CITY_NAMES_PREF_KEY } from "../src/workspaces/site-planner/lib/cityNamesPref.js";

const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, m }; };

describe("planner city-names pref (B2391216 ×2)", () => {
  it("defaults ON, like the map finder's row", () => {
    expect(loadCityNamesPref(mem())).toEqual(CITY_NAMES_DEFAULT);
    expect(CITY_NAMES_DEFAULT.on).toBe(true);
  });
  it("round-trips on/off", () => {
    const s = mem();
    expect(saveCityNamesPref({ on: false }, s)).toBe(true);
    expect(loadCityNamesPref(s)).toEqual({ on: false });
  });
  it("garbage falls back to the default", () => {
    expect(normalizeCityNamesPref({ on: "yes" })).toEqual(CITY_NAMES_DEFAULT);
    expect(normalizeCityNamesPref(null)).toEqual(CITY_NAMES_DEFAULT);
    const s = mem(); s.setItem(CITY_NAMES_PREF_KEY, "{not json");
    expect(loadCityNamesPref(s)).toEqual(CITY_NAMES_DEFAULT);
  });
  it("a blocked store never throws", () => {
    const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(loadCityNamesPref(bad)).toEqual(CITY_NAMES_DEFAULT);
    expect(saveCityNamesPref({ on: true }, bad)).toBe(false);
  });
  it("is a separate device key from road names", () => {
    expect(CITY_NAMES_PREF_KEY).toBe("planyr:cityNames");
  });
});
