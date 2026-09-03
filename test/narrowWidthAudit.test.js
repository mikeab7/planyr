/* NEW-2 (phone-width structural gate) — the pure half: the viewport verdict and the squeeze/
 * overflow verdict-formatting, split out of their browser-dependent callers the same way
 * tabTiming.mjs's visibilityVerdict/rafVerdict are (see ui-audit/lib/narrowWidthAudit.mjs's own
 * header for the measurement behind the 120px/20-char thresholds and the DOM-scanning half this
 * file can't unit-test without a browser).
 */
import { describe, it, expect } from "vitest";
import {
  PHONE_MIN_CONTENT_WIDTH, SENTENCE_MIN_CHARS, OVERFLOW_EPSILON_PX,
  viewportVerdict, narrowWidthVerdict,
} from "../ui-audit/lib/narrowWidthAudit.mjs";

describe("thresholds — sane, and bracketing the measured broken/fixed gap", () => {
  it("PHONE_MIN_CONTENT_WIDTH sits strictly between the measured broken (56.9px) and fixed (299-344px) banner widths", () => {
    expect(PHONE_MIN_CONTENT_WIDTH).toBeGreaterThan(56.9);
    expect(PHONE_MIN_CONTENT_WIDTH).toBeLessThan(299);
  });
  it("SENTENCE_MIN_CHARS excludes short real UI labels but not real sentence copy", () => {
    expect(SENTENCE_MIN_CHARS).toBeGreaterThan("Select parcels".length);
    expect(SENTENCE_MIN_CHARS).toBeLessThan("A newer version of Planyr is available.".length);
  });
  it("OVERFLOW_EPSILON_PX matches verify-phone-layout.mjs's own existing tolerance (reused, not a second number)", () => {
    expect(OVERFLOW_EPSILON_PX).toBe(2);
  });
});

describe("viewportVerdict — never trust the requested viewport", () => {
  it("passes when the reported width matches the requested one", () => {
    const v = viewportVerdict({ innerWidth: 390 }, { width: 390 });
    expect(v.ok).toBe(true);
  });
  it("fails, naming both numbers, on any mismatch", () => {
    const v = viewportVerdict({ innerWidth: 980 }, { width: 390 }, "some-harness");
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/some-harness/);
    expect(v.message).toMatch(/requested a 390px/);
    expect(v.message).toMatch(/innerWidth=980/);
  });
});

describe("narrowWidthVerdict — combined squeeze/overflow verdict", () => {
  it("passes clean when nothing squeezed and nothing overflows", () => {
    const v = narrowWidthVerdict([], null);
    expect(v.pass).toBe(true);
    expect(v.detail).toBe("clean");
  });

  it("fails and names the exact element/text/width for a squeezed block — the update-banner case", () => {
    const squeezed = [{
      tag: "span", testId: "app-update-banner",
      text: "A newer version of Planyr is available. Reload when you're ready — your work is …",
      width: 56.92,
    }];
    const v = narrowWidthVerdict(squeezed, null, { label: "update-banner (phone)", minContentWidth: 120 });
    expect(v.pass).toBe(false);
    expect(v.detail).toContain("update-banner (phone)");
    expect(v.detail).toContain("1 squeezed text block(s) under 120px wide");
    expect(v.detail).toContain('data-testid="app-update-banner"');
    expect(v.detail).toContain("56.92px");
  });

  it("fails and names the overflow numbers when the page overflows horizontally", () => {
    const v = narrowWidthVerdict([], { scrollWidth: 430, innerWidth: 390 }, { label: "some-surface" });
    expect(v.pass).toBe(false);
    expect(v.detail).toContain("horizontal overflow: scrollWidth=430 > innerWidth=390");
  });

  it("reports both problems at once when both are present", () => {
    const squeezed = [{ tag: "p", testId: null, text: "x".repeat(30), width: 40 }];
    const v = narrowWidthVerdict(squeezed, { scrollWidth: 500, innerWidth: 390 });
    expect(v.pass).toBe(false);
    expect(v.detail).toContain("squeezed text block");
    expect(v.detail).toContain("horizontal overflow");
  });

  it("omits the label prefix when none is given", () => {
    const v = narrowWidthVerdict([{ tag: "p", testId: null, text: "x".repeat(30), width: 40 }], null);
    expect(v.detail.startsWith("1 squeezed")).toBe(true);
  });
});
