/* The white-knockout pixel pass (B654) — pure, no DOM: near-white (all channels ≥ 247)
 * goes fully transparent; linework and tinted fills keep their alpha. */
import { describe, it, expect } from "vitest";
import { knockoutNearWhite } from "../src/workspaces/site-planner/lib/overlayPdf.js";

const px = (...rgba) => new Uint8ClampedArray(rgba);

describe("knockoutNearWhite (B654)", () => {
  it("zeroes alpha for near-white pixels only (threshold 247 per channel)", () => {
    const d = px(
      255, 255, 255, 255, // pure white -> knocked out
      247, 247, 247, 255, // at threshold -> knocked out
      246, 255, 255, 255, // one channel below -> kept
      0, 0, 0, 255,       // black linework -> kept
      250, 240, 250, 255, // tinted near-white (g below) -> kept
    );
    knockoutNearWhite(d);
    expect(d[3]).toBe(0);
    expect(d[7]).toBe(0);
    expect(d[11]).toBe(255);
    expect(d[15]).toBe(255);
    expect(d[19]).toBe(255);
  });
  it("mutates in place and returns the same array; empty input is a no-op", () => {
    const d = px(255, 255, 255, 200);
    expect(knockoutNearWhite(d)).toBe(d);
    expect(d[3]).toBe(0); // knocked out regardless of prior alpha
    expect(knockoutNearWhite(px()).length).toBe(0);
  });
  it("leaves color channels untouched (alpha-only pass)", () => {
    const d = px(255, 255, 255, 255, 10, 20, 30, 40);
    knockoutNearWhite(d);
    expect([...d]).toEqual([255, 255, 255, 0, 10, 20, 30, 40]);
  });
});
