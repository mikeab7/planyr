/* Notification-position guard (NEW-3, docs/DESIGN.md "Floating notifications", B1000400/B1000402).
 * Mirrors test/designDrift.test.js's pattern: pure-logic unit cases against small in-memory
 * fixtures (so the scan rule is pinned regardless of how the real tree happens to read today),
 * plus a live check that every registered surface in the real repo currently passes. A failure
 * here means a floating banner regressed off bottom-center, not that this test is stale.
 *
 * ⛔ The mutation case below ("flags a raw top:84 fixed div with no FloatingNotice wrapper as the
 * exact pre-fix shape") is the RED-PROOF this item's brief made mandatory — this is the unit-test
 * form of it; the CLI was also run end to end against a reverted AppHeader.jsx and confirmed
 * non-zero exit (see BACKLOG.md B1000402 / docs/archive for the recorded run and its output).
 */
import { describe, it, expect } from "vitest";
import {
  checkText, auditAll, NOTIFICATION_SURFACES,
} from "../ui-audit/notification-position-audit.mjs";

describe("notification-position-audit — pure scan rule", () => {
  it("passes a testid rendered inside <FloatingNotice>", () => {
    const src = `
      {open && (
        <FloatingNotice maxWidth="min(440px, calc(100vw - 16px))">
          <div role="status" data-testid="my-banner" style={{ background: "var(--surface-raised)" }}>
            hello
          </div>
        </FloatingNotice>
      )}
    `;
    expect(checkText(src, "my-banner")).toEqual({ ok: true });
  });

  it("⛔ RED-PROOF: flags the exact pre-fix shape — a raw top:84 fixed div, no FloatingNotice wrapper", () => {
    const src = `
      {fsNotice && (
        <div role="status" data-testid="my-banner" style={{ position: "fixed", top: 84, left: "50%", transform: "translateX(-50%)", zIndex: 5999 }}>
          {fsNotice}
        </div>
      )}
    `;
    const result = checkText(src, "my-banner");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not bottom-centered via FloatingNotice/);
    expect(result.reason).toMatch(/top:84/);
    expect(result.reason).toMatch(/zIndex:5999/);
  });

  it("fails loudly (not silently) when the testid has been renamed or removed", () => {
    const src = `<div data-testid="renamed-banner">hi</div>`;
    const result = checkText(src, "my-banner");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it("does not false-positive on a testid that sits after an unrelated, already-closed FloatingNotice", () => {
    const src = `
      <FloatingNotice><div data-testid="other-banner">x</div></FloatingNotice>
      <div data-testid="my-banner" style={{ position: "fixed", top: 84 }}>y</div>
    `;
    const result = checkText(src, "my-banner");
    expect(result.ok).toBe(false);
  });

  it("treats the FloatingNotice wrapper's own testid as satisfying the check too", () => {
    const src = `<FloatingNotice testId="my-banner" maxWidth={520}><div role="status">hi</div></FloatingNotice>`;
    expect(checkText(src, "my-banner")).toEqual({ ok: true });
  });
});

describe("notification-position-audit — the real repo, right now", () => {
  it("every registered floating-notice surface is bottom-centered via FloatingNotice", () => {
    expect(NOTIFICATION_SURFACES.length).toBeGreaterThan(0);
    const report = auditAll();
    expect(report.total, JSON.stringify(report.violations, null, 2)).toBe(0);
  });
});
