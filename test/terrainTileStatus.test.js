import { describe, it, expect } from "vitest";
import { isPartialCover, paintStatus } from "../src/workspaces/site-planner/lib/terrainTileStatus.js";

describe("terrainTileStatus — B802400 round 4 (the honest pending indicator)", () => {
  describe("isPartialCover", () => {
    it("is false when every tile in the cover is already painted", () => {
      expect(isPartialCover(3, 3)).toBe(false);
      expect(isPartialCover(0, 0)).toBe(false);
    });
    it("is true when the cover holds tiles that were not among the painted ones", () => {
      expect(isPartialCover(2, 3)).toBe(true);
      expect(isPartialCover(0, 1)).toBe(true);
    });
  });

  describe("paintStatus", () => {
    it("reports loading while partial, regardless of whether something painted", () => {
      expect(paintStatus(true, true)).toBe("loading");
      expect(paintStatus(true, false)).toBe("loading");
    });
    it("reports loaded/empty exactly as before once the cover is NOT partial", () => {
      expect(paintStatus(false, true)).toBe("loaded");
      expect(paintStatus(false, false)).toBe("empty");
    });
    it("regression guard: the pre-fix rule (status ignores partial entirely) would have said 'loaded' for a partial-but-painted cover — this must not", () => {
      const preFixRule = (n) => (n ? "loaded" : "empty"); // the exact rule this replaces
      const partial = true, hasContent = true;
      expect(preFixRule(hasContent)).toBe("loaded"); // what the old code said
      expect(paintStatus(partial, hasContent)).not.toBe(preFixRule(hasContent)); // the fix disagrees
      expect(paintStatus(partial, hasContent)).toBe("loading");
    });
  });
});
