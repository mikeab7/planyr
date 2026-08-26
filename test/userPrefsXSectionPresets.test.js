import { describe, it, expect } from "vitest";
import { EMPTY_PREFS, _normalizePrefs } from "../src/workspaces/site-planner/lib/userPrefs.js";

describe("userPrefs — roadCrossSectionPresets (NEW-1)", () => {
  it("defaults to an empty array — additive, no migration needed for an existing prefs row", () => {
    expect(EMPTY_PREFS.roadCrossSectionPresets).toEqual([]);
    expect(_normalizePrefs(null).roadCrossSectionPresets).toEqual([]);
    expect(_normalizePrefs({}).roadCrossSectionPresets).toEqual([]);
  });

  it("keeps a well-formed preset, normalizing its bands", () => {
    const p = _normalizePrefs({ roadCrossSectionPresets: [{ id: "a", name: "My section", bands: [{ type: "travel", w: 12 }] }] });
    expect(p.roadCrossSectionPresets).toEqual([{ id: "a", name: "My section", bands: [{ type: "travel", w: 12 }] }]);
  });

  it("drops a preset with no name or no bands", () => {
    const p = _normalizePrefs({ roadCrossSectionPresets: [
      { id: "a", name: "", bands: [{ type: "travel", w: 12 }] },
      { id: "b", name: "Empty", bands: [] },
      { id: "c", bands: [{ type: "travel", w: 12 }] },
    ] });
    expect(p.roadCrossSectionPresets).toEqual([]);
  });

  it("mints an id for a preset that arrived without one", () => {
    const p = _normalizePrefs({ roadCrossSectionPresets: [{ name: "No id", bands: [{ type: "travel", w: 12 }] }] });
    expect(p.roadCrossSectionPresets).toHaveLength(1);
    expect(typeof p.roadCrossSectionPresets[0].id).toBe("string");
    expect(p.roadCrossSectionPresets[0].id.length).toBeGreaterThan(0);
  });

  it("normalizes an unknown band type inside a saved preset rather than rejecting the whole preset", () => {
    const p = _normalizePrefs({ roadCrossSectionPresets: [{ id: "a", name: "Weird", bands: [{ type: "bogus", w: 10 }] }] });
    expect(p.roadCrossSectionPresets[0].bands).toEqual([{ type: "travel", w: 10 }]);
  });

  it("ignores non-array input entirely", () => {
    expect(_normalizePrefs({ roadCrossSectionPresets: "nope" }).roadCrossSectionPresets).toEqual([]);
  });
});
