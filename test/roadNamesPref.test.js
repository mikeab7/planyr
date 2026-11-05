import { describe, it, expect } from "vitest";
import { normalizeRoadNamesPref, loadRoadNamesPref, saveRoadNamesPref, ROAD_NAMES_DEFAULT, ROAD_NAMES_PREF_KEY } from "../src/workspaces/site-planner/lib/roadNamesPref.js";

const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, m }; };

describe("planner road-names pref (NEW-1)", () => {
  it("defaults ON at the finder's opacity", () => {
    expect(loadRoadNamesPref(mem())).toEqual(ROAD_NAMES_DEFAULT);
    expect(ROAD_NAMES_DEFAULT.on).toBe(true);
  });
  it("round-trips on/off + opacity", () => {
    const s = mem();
    expect(saveRoadNamesPref({ on: false, opacity: 0.4 }, s)).toBe(true);
    expect(loadRoadNamesPref(s)).toEqual({ on: false, opacity: 0.4 });
  });
  it("garbage / out-of-range falls back per field", () => {
    expect(normalizeRoadNamesPref({ on: "yes", opacity: 7 })).toEqual(ROAD_NAMES_DEFAULT);
    expect(normalizeRoadNamesPref(null)).toEqual(ROAD_NAMES_DEFAULT);
    const s = mem(); s.setItem(ROAD_NAMES_PREF_KEY, "{not json");
    expect(loadRoadNamesPref(s)).toEqual(ROAD_NAMES_DEFAULT);
  });
  it("a blocked store never throws", () => {
    const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(loadRoadNamesPref(bad)).toEqual(ROAD_NAMES_DEFAULT);
    expect(saveRoadNamesPref({ on: true, opacity: 1 }, bad)).toBe(false);
  });
});
