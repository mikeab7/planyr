/* test/controlKind.test.js — NEW-2, B1176976.
 *
 * WHAT THIS PROTECTS. `classifyIsolatedControl` (ui-audit/lib/controlKind.mjs) is the pure decision
 * behind ui-inventory.mjs's isolatedKindMismatches() — the check that catches a rounded, actionable
 * control with no rounded containing ancestor and no rounded row-peer using the wrong RADIUS token
 * (the exact shape of HelpReportControl.jsx's floating help/report FAB, which shipped as
 * `RADIUS.pill` on a standalone button and was invisible to every prior check). This is the
 * DECISION half only — no browser, no DOM — the FACT-GATHERING half (isolatedKindMismatches() in
 * ui-audit/ui-inventory.mjs) runs inside a real headless Chromium crawl and has no headless-DOM
 * equivalent worth mocking here, same as this repo's other browser-driving checks
 * (test/uiInventoryAuthGate.test.js's own header makes the identical call).
 */
import { describe, it, expect } from "vitest";
import { classifyIsolatedControl, SURFACE_HEIGHT_THRESHOLD_PX, ROW_ALIGN_TOLERANCE_PX } from "../ui-audit/lib/controlKind.mjs";
import { RADIUS } from "../src/shared/ui/radius.js";

describe("classifyIsolatedControl (NEW-2, B1176976)", () => {
  it("classifies a lone actionable control (0 interactive descendants) as standalone-control, expecting md — the exact HelpReportControl.jsx shape", () => {
    const verdict = classifyIsolatedControl({ interactiveDescendantCount: 0, descendantRowAligned: true, height: 44, radius: RADIUS.pill });
    expect(verdict.kind).toBe("standalone-control");
    expect(verdict.expectedRadius).toBe(RADIUS.md);
    expect(verdict.compliant).toBe(false); // 999 !== 8 — this is the defect being caught
  });

  it("reports compliant:true for the same standalone control once it actually uses md", () => {
    const verdict = classifyIsolatedControl({ interactiveDescendantCount: 0, descendantRowAligned: true, height: 44, radius: RADIUS.md });
    expect(verdict.kind).toBe("standalone-control");
    expect(verdict.compliant).toBe(true);
  });

  it("classifies a single interactive descendant (e.g. one child button) the same as zero — one control is still standalone, not a container", () => {
    const verdict = classifyIsolatedControl({ interactiveDescendantCount: 1, descendantRowAligned: true, height: 30, radius: RADIUS.md });
    expect(verdict.kind).toBe("standalone-control");
    expect(verdict.compliant).toBe(true);
  });

  it("classifies 2+ interactive descendants in one row, control-ish height, as a segmented-container expecting pill", () => {
    const verdict = classifyIsolatedControl({ interactiveDescendantCount: 2, descendantRowAligned: true, height: 26, radius: RADIUS.pill });
    expect(verdict.kind).toBe("segmented-container");
    expect(verdict.expectedRadius).toBe(RADIUS.pill);
    expect(verdict.compliant).toBe(true);
  });

  it("flags a segmented-container-shaped candidate that is NOT actually pill", () => {
    const verdict = classifyIsolatedControl({ interactiveDescendantCount: 3, descendantRowAligned: true, height: 30, radius: RADIUS.md });
    expect(verdict.kind).toBe("segmented-container");
    expect(verdict.compliant).toBe(false);
  });

  it("classifies 2+ interactive descendants that are STACKED (not row-aligned) as a surface expecting lg, even at a small height", () => {
    const verdict = classifyIsolatedControl({ interactiveDescendantCount: 2, descendantRowAligned: false, height: 20, radius: RADIUS.lg });
    expect(verdict.kind).toBe("surface");
    expect(verdict.expectedRadius).toBe(RADIUS.lg);
    expect(verdict.compliant).toBe(true);
  });

  it("classifies 2+ row-aligned interactive descendants that exceed the control-ish height threshold as a surface, not a segmented-container", () => {
    const verdict = classifyIsolatedControl({
      interactiveDescendantCount: 2, descendantRowAligned: true,
      height: SURFACE_HEIGHT_THRESHOLD_PX + 1, radius: RADIUS.lg,
    });
    expect(verdict.kind).toBe("surface");
    expect(verdict.expectedRadius).toBe(RADIUS.lg);
    expect(verdict.compliant).toBe(true);
  });

  it("stays a segmented-container exactly AT the height threshold (boundary is inclusive)", () => {
    const verdict = classifyIsolatedControl({
      interactiveDescendantCount: 2, descendantRowAligned: true,
      height: SURFACE_HEIGHT_THRESHOLD_PX, radius: RADIUS.pill,
    });
    expect(verdict.kind).toBe("segmented-container");
    expect(verdict.compliant).toBe(true);
  });

  it("never returns compliant:true unless radius exactly equals the expected step for every legal RADIUS value", () => {
    // Cheap mutation-style sweep: for a fixed standalone-control shape, only RADIUS.md may pass.
    const passing = Object.entries(RADIUS)
      .filter(([, radius]) => classifyIsolatedControl({ interactiveDescendantCount: 0, descendantRowAligned: true, height: 44, radius }).compliant);
    expect(passing).toEqual([["md", RADIUS.md]]);
  });

  it("ROW_ALIGN_TOLERANCE_PX and SURFACE_HEIGHT_THRESHOLD_PX are exported, positive constants (regression pin — a caller measures against these, not a re-typed literal)", () => {
    expect(ROW_ALIGN_TOLERANCE_PX).toBeGreaterThan(0);
    expect(SURFACE_HEIGHT_THRESHOLD_PX).toBeGreaterThan(0);
  });
});
