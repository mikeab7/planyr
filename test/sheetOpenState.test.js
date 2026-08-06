import { describe, it, expect } from "vitest";
import { sheetOpenState, OPEN_CHIP_TIMEOUT_MS } from "../src/workspaces/doc-review/lib/sheetOpenState.js";

/* NEW-6 — the owner's report: the "Opening A227…" toast was still on screen long after the drawing
 * had finished rendering. The old rule was a bare `renderedPage !== page`, and the ONLY writer of
 * renderedPage was one success line — so every bail and every swallowed throw left the chip up
 * forever AND the sheet pinned at 0.35 opacity. These assert the OUTCOMES: what the user sees. */
const at = (o) => sheetOpenState({ requestedAt: 1000, now: 1000, ...o });

describe("sheetOpenState — the Opening chip can never outlive the work", () => {
  it("shows while the requested sheet genuinely is not on the canvas yet", () => {
    expect(at({ requestedPage: 27, renderedPage: 12 })).toMatchObject({ opening: true, dimmed: true, error: null });
  });

  it("CLEARS the moment the sheet is actually open — chip gone AND the dim lifted", () => {
    const s = at({ requestedPage: 27, renderedPage: 27 });
    expect(s.opening).toBe(false);
    expect(s.dimmed).toBe(false);
    expect(s.error).toBe(null);
  });

  it("clears on the backstop timeout rather than claiming to be opening forever", () => {
    const stuck = sheetOpenState({ requestedPage: 27, renderedPage: 12, requestedAt: 1000, now: 1000 + OPEN_CHIP_TIMEOUT_MS });
    expect(stuck.opening).toBe(false);
    expect(stuck.timedOut).toBe(true);
    // and it must not leave the sheet permanently dimmed either — that was the silent half.
    expect(stuck.dimmed).toBe(false);
  });

  it("is still opening just BEFORE the backstop — the timeout is a backstop, not the norm", () => {
    const s = sheetOpenState({ requestedPage: 27, renderedPage: 12, requestedAt: 1000, now: 1000 + OPEN_CHIP_TIMEOUT_MS - 1 });
    expect(s.opening).toBe(true);
  });

  it("turns a REAL render failure into a visible error, never a progress message (LOUD-FAILURE)", () => {
    const s = at({ requestedPage: 27, renderedPage: 12, failed: { page: 27, message: "Sheet A227 couldn’t be drawn." } });
    expect(s.opening).toBe(false);
    expect(s.error).toBe("Sheet A227 couldn’t be drawn.");
    expect(s.dimmed).toBe(false);
  });

  it("ignores a failure recorded against a DIFFERENT sheet than the one now requested", () => {
    const s = at({ requestedPage: 5, renderedPage: 4, failed: { page: 27, message: "boom" } });
    expect(s.error).toBe(null);
    expect(s.opening).toBe(true);
  });

  it("says nothing at all when no sheet has been requested", () => {
    expect(at({ requestedPage: 0, renderedPage: 0 })).toMatchObject({ opening: false, dimmed: false, error: null });
  });

  it("a failure without a message still reads as an error, never as silence", () => {
    const s = at({ requestedPage: 3, renderedPage: 1, failed: { page: 3 } });
    expect(s.opening).toBe(false);
    expect(typeof s.error).toBe("string");
    expect(s.error.length).toBeGreaterThan(0);
  });
});
