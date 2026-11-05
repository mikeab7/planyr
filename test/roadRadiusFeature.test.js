import { describe, it, expect } from "vitest";
import { roadRadiusReviewOn, ROAD_RADIUS_REVIEW_KEY } from "../src/workspaces/site-planner/lib/roadRadiusFeature.js";

const store = (v) => ({ getItem: (k) => (k === ROAD_RADIUS_REVIEW_KEY ? v : null) });

describe("road minimum-radius review flag (hidden feature, NEW-3)", () => {
  it("is OFF by default — no env, no stored opt-in", () => {
    expect(roadRadiusReviewOn({}, store(null))).toBe(false);
    expect(roadRadiusReviewOn({ VITE_ROAD_RADIUS_REVIEW: "" }, store(undefined))).toBe(false);
    expect(roadRadiusReviewOn({ VITE_ROAD_RADIUS_REVIEW: "0" }, store("0"))).toBe(false);
  });
  it("one switch brings it back: the build env OR the stored opt-in", () => {
    expect(roadRadiusReviewOn({ VITE_ROAD_RADIUS_REVIEW: "1" }, store(null))).toBe(true);
    expect(roadRadiusReviewOn({ VITE_ROAD_RADIUS_REVIEW: "true" }, store(null))).toBe(true);
    expect(roadRadiusReviewOn({}, store("1"))).toBe(true);
  });
  it("an unreadable store reads as OFF, never a throw", () => {
    expect(roadRadiusReviewOn({}, { getItem() { throw new Error("blocked"); } })).toBe(false);
  });
});
