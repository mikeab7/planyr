import { describe, it, expect } from "vitest";
import { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom } from "../src/workspaces/site-planner/lib/parcelDisplayZoom.js";

/* NEW-1 (owner decision 2026-09-24) — the pure decision behind the three-regime parcel
 * display that replaced the "capped this view at N lots" banner: far (nothing) / wide
 * (server image) / close (vector). See that module's own header for the full rationale. */
describe("parcelDisplayRegimeForZoom", () => {
  it("is far below PARCEL_MINZOOM — the pre-existing draw-nothing floor, unchanged", () => {
    expect(parcelDisplayRegimeForZoom(PARCEL_MINZOOM - 0.01)).toBe("far");
    expect(parcelDisplayRegimeForZoom(0)).toBe("far");
  });

  it("is wide from PARCEL_MINZOOM up to (not including) PARCEL_VECTOR_MINZOOM", () => {
    expect(parcelDisplayRegimeForZoom(PARCEL_MINZOOM)).toBe("wide");
    expect(parcelDisplayRegimeForZoom((PARCEL_MINZOOM + PARCEL_VECTOR_MINZOOM) / 2)).toBe("wide");
    expect(parcelDisplayRegimeForZoom(PARCEL_VECTOR_MINZOOM - 0.01)).toBe("wide");
  });

  it("is close at and above PARCEL_VECTOR_MINZOOM", () => {
    expect(parcelDisplayRegimeForZoom(PARCEL_VECTOR_MINZOOM)).toBe("close");
    expect(parcelDisplayRegimeForZoom(PARCEL_VECTOR_MINZOOM + 5)).toBe("close");
  });

  it("degrades to far rather than throwing on an unreadable zoom", () => {
    for (const junk of [null, undefined, NaN, Infinity, -Infinity, "17"]) {
      expect(parcelDisplayRegimeForZoom(junk)).toBe("far");
    }
  });

  it("the two constants stay in the order the regime split assumes", () => {
    expect(PARCEL_VECTOR_MINZOOM).toBeGreaterThan(PARCEL_MINZOOM);
  });
});
