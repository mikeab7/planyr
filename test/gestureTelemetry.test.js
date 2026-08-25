import { describe, it, expect } from "vitest";
import {
  shouldLogPinch,
  pinchEventDetail,
  PINCH_COMPLETE_SAMPLE_RATE,
} from "../src/shared/telemetry/gestureTelemetry.js";

describe("shouldLogPinch — sampled completions, unconditional cancels/anomalies", () => {
  it("always logs a cancelled gesture regardless of the draw", () => {
    expect(shouldLogPinch("cancelled", 0)).toBe(true);
    expect(shouldLogPinch("cancelled", 0.9999)).toBe(true);
  });

  it("always logs an anomaly regardless of the draw", () => {
    expect(shouldLogPinch("anomaly", 0)).toBe(true);
    expect(shouldLogPinch("anomaly", 0.9999)).toBe(true);
  });

  it("logs a completed gesture only below the sample rate", () => {
    expect(shouldLogPinch("completed", 0)).toBe(true); // 0 < rate
    expect(shouldLogPinch("completed", PINCH_COMPLETE_SAMPLE_RATE - 0.0001)).toBe(true);
    expect(shouldLogPinch("completed", PINCH_COMPLETE_SAMPLE_RATE)).toBe(false);
    expect(shouldLogPinch("completed", 0.5)).toBe(false);
    expect(shouldLogPinch("completed", 0.9999)).toBe(false);
  });

  it("honors a caller-supplied sample rate", () => {
    expect(shouldLogPinch("completed", 0.3, 0.5)).toBe(true);
    expect(shouldLogPinch("completed", 0.7, 0.5)).toBe(false);
  });

  it("an unreadable draw (non-finite/missing) never over-samples a completion", () => {
    expect(shouldLogPinch("completed", undefined)).toBe(false);
    expect(shouldLogPinch("completed", NaN)).toBe(false);
    expect(shouldLogPinch("completed", Infinity)).toBe(false);
  });
});

describe("pinchEventDetail — the recorded payload shape", () => {
  it("carries surface/source/fingers/outcome", () => {
    const d = pinchEventDetail({ surface: "site-planner", eventSource: "touch", fingerCount: 2, outcome: "completed" });
    expect(d).toEqual({ surface: "site-planner", source: "touch", fingers: 2, outcome: "completed" });
  });

  it("includes the cancel reason only for a non-completed outcome", () => {
    const d = pinchEventDetail({ surface: "doc-review", eventSource: "touch", fingerCount: 2, outcome: "cancelled", cancelReason: "touchcancel" });
    expect(d.reason).toBe("touchcancel");
    const clean = pinchEventDetail({ surface: "doc-review", eventSource: "touch", fingerCount: 2, outcome: "completed", cancelReason: "touchcancel" });
    expect(clean.reason).toBeUndefined();
  });

  it("includes a rounded duration only when finite and non-negative", () => {
    expect(pinchEventDetail({ surface: "s", outcome: "completed", durationMs: 123.7 }).ms).toBe(124);
    expect(pinchEventDetail({ surface: "s", outcome: "completed", durationMs: -5 }).ms).toBeUndefined();
    expect(pinchEventDetail({ surface: "s", outcome: "completed", durationMs: NaN }).ms).toBeUndefined();
    expect(pinchEventDetail({ surface: "s", outcome: "completed" }).ms).toBeUndefined();
  });

  it("defaults surface/source/outcome so a caller can never produce an unreadable row", () => {
    const d = pinchEventDetail({});
    expect(d.surface).toBe("unknown");
    expect(d.source).toBe("touch");
    expect(d.outcome).toBe("completed");
    expect(d.fingers).toBe(0);
  });
});
